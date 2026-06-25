const db = require('./db');
const { sendText, sendLocationRequest, sendMissingAlert, broadcastToPhones } = require('./whatsapp');
const { getPhonesInRadius, findMatches } = require('./geo');

// Sesiones temporales en memoria para flujos multi-paso
const sessions = new Map();

async function handleMessage(phone, text, location) {
  const cmd = (text || '').trim().toUpperCase();

  // Flujo de ubicación pendiente
  if (sessions.has(phone)) {
    const session = sessions.get(phone);
    if (session.type === 'awaiting_location') {
      sessions.delete(phone);
      return handleLocationProvided(phone, text, location, session);
    }
    if (session.type === 'awaiting_missing_description') {
      sessions.delete(phone);
      return handleMissingDescription(phone, text, session);
    }
  }

  if (cmd === 'SANO' || cmd.startsWith('SANO ')) {
    return handleSano(phone, text, location);
  }

  if (cmd.startsWith('BUSCO ')) {
    return handleBusco(phone, text.slice(6).trim());
  }

  if (cmd === 'CENTRO') {
    return handleCentros(phone);
  }

  if (cmd.startsWith('SÍ ') || cmd.startsWith('SI ')) {
    return handleConfirmSighting(phone, text, true);
  }

  if (cmd.startsWith('NO ')) {
    return handleConfirmSighting(phone, text, false);
  }

  if (cmd === 'AYUDA' || cmd === 'HELP' || cmd === 'HOLA') {
    return sendHelp(phone);
  }

  if (cmd.startsWith('VER ')) {
    return handleVerSearch(phone, text.slice(4).trim());
  }

  return sendText(phone,
    'No entendí el comando. Escribe *AYUDA* para ver las opciones disponibles.'
  );
}

async function handleSano(phone, text, location) {
  const centerName = text.length > 4 ? text.slice(5).trim() : null;
  const activeDisaster = db.prepare(
    'SELECT * FROM disasters WHERE active = 1 ORDER BY triggered_at DESC LIMIT 1'
  ).get();

  if (!activeDisaster) {
    return sendText(phone, 'No hay un evento de emergencia activo en este momento.');
  }

  if (location) {
    return registerSano(phone, location.latitude, location.longitude, null, activeDisaster);
  }

  if (centerName) {
    const center = db.prepare(
      `SELECT * FROM assistance_centers WHERE disaster_id = ? AND name LIKE ? AND active = 1`
    ).get(activeDisaster.id, `%${centerName}%`);

    if (center) {
      db.prepare('UPDATE assistance_centers SET current_count = current_count + 1 WHERE id = ?')
        .run(center.id);
      return registerSano(phone, center.lat, center.lng, center.name, activeDisaster);
    }

    sessions.set(phone, { type: 'awaiting_location', disaster: activeDisaster, locationText: centerName });
    return sendText(phone,
      `No encontré un centro con ese nombre. ¿Dónde estás exactamente?\n` +
      `Comparte tu ubicación GPS o descríbela con más detalle.`
    );
  }

  sessions.set(phone, { type: 'awaiting_location', disaster: activeDisaster });
  return sendLocationRequest(phone);
}

async function registerSano(phone, lat, lng, locationText, disaster) {
  const existing = db.prepare(
    'SELECT id FROM safe_persons WHERE phone = ? AND disaster_id = ?'
  ).get(phone, disaster.id);

  if (existing) {
    db.prepare(
      'UPDATE safe_persons SET lat = ?, lng = ?, location_text = ?, registered_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(lat, lng, locationText, existing.id);
  } else {
    db.prepare(
      'INSERT INTO safe_persons (phone, lat, lng, location_text, disaster_id) VALUES (?, ?, ?, ?, ?)'
    ).run(phone, lat, lng, locationText, disaster.id);
  }

  const mapUrl = `${process.env.BASE_URL}/mapa`;
  await sendText(phone,
    `✅ *Registrado como SANO*\n` +
    `${locationText ? `📍 ${locationText}` : `📍 Coordenadas registradas`}\n\n` +
    `Tu familia puede buscarte aquí:\n${mapUrl}\n\n` +
    `Para buscar a alguien: escribe *BUSCO [nombre y descripción]*`
  );

  // Notificar a quien busca a esta persona (si hay búsqueda activa con este número)
  const pendingSearches = db.prepare(`
    SELECT * FROM searches WHERE reporter_phone = ? AND status = 'active' AND disaster_id = ?
  `).all(phone, disaster.id);

  if (pendingSearches.length > 0) {
    for (const s of pendingSearches) {
      db.prepare('UPDATE searches SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('found', s.id);
    }
  }
}

async function handleLocationProvided(phone, text, location, session) {
  if (location) {
    return registerSano(phone, location.latitude, location.longitude, null, session.disaster);
  }
  return registerSano(phone, null, null, text, session.disaster);
}

async function handleBusco(phone, query) {
  const activeDisaster = db.prepare(
    'SELECT * FROM disasters WHERE active = 1 ORDER BY triggered_at DESC LIMIT 1'
  ).get();

  if (!activeDisaster) {
    return sendText(phone, 'No hay un evento de emergencia activo en este momento.');
  }

  const [missingName, ...descParts] = query.split(/\s+(?=\d|\b(?:años?|camisa|hombre|mujer|niño|niña)\b)/i);
  const description = descParts.join(' ') || query;

  const search = db.prepare(`
    INSERT INTO searches (reporter_phone, missing_name, description, disaster_id)
    VALUES (?, ?, ?, ?)
  `).run(phone, missingName || query, description, activeDisaster.id);

  const searchId = search.lastInsertRowid;
  const searchRecord = db.prepare('SELECT * FROM searches WHERE id = ?').get(searchId);

  // Buscar matches inmediatos
  const matches = findMatches(db, searchRecord);

  if (matches.length > 0) {
    const matchText = matches.map((m, i) =>
      `${i + 1}. ${m.name || 'Sin nombre'} — ${m.location_text || 'ubicación registrada'} (${Math.round(m.score * 100)}% coincidencia)`
    ).join('\n');

    await sendText(phone,
      `🔍 Encontré posibles coincidencias para *${missingName}*:\n\n${matchText}\n\n` +
      `Verifica en el mapa: ${process.env.BASE_URL}/buscar/${searchId}\n` +
      `ID de búsqueda: *#${searchId}*`
    );
  } else {
    await sendText(phone,
      `🔍 *Búsqueda registrada* — ID: #${searchId}\n\n` +
      `Buscando a: *${missingName}*\n` +
      `${description}\n\n` +
      `No encontré coincidencias aún. Enviando alerta a voluntarios en la zona...`
    );

    // Geofenced broadcast asíncrono
    setImmediate(() => broadcastMissingAlert(searchRecord, activeDisaster));
  }
}

async function broadcastMissingAlert(search, disaster) {
  const radiusKm = parseFloat(process.env.DEFAULT_ALERT_RADIUS_KM) || 10;

  // Personas registradas en radio (si no hay coordenadas, usar centro del desastre)
  const lat = search.last_known_lat || disaster.lat;
  const lng = search.last_known_lng || disaster.lng;
  const phones = getPhonesInRadius(db, lat, lng, radiusKm, disaster.id);

  // Excluir al propio reportador
  const targets = phones.filter(p => p !== search.reporter_phone);

  // Excluir a quienes ya recibieron alerta de esta búsqueda
  const alreadyNotified = new Set(
    db.prepare('SELECT recipient_phone FROM notifications WHERE search_id = ?')
      .all(search.id).map(r => r.recipient_phone)
  );
  const toNotify = targets.filter(p => !alreadyNotified.has(p));

  const results = await broadcastToPhones(toNotify, async (phone) => {
    await sendMissingAlert(phone, search, disaster.name);
    db.prepare('INSERT INTO notifications (search_id, recipient_phone) VALUES (?, ?)').run(search.id, phone);
  });

  const sent = results.filter(r => r.sent).length;
  await sendText(search.reporter_phone,
    `📡 Alerta enviada a *${sent}* personas en un radio de ${radiusKm}km.\n` +
    `Te notificamos en cuanto alguien tenga información.`
  );
}

async function handleConfirmSighting(phone, text, hasSeen) {
  const idMatch = text.match(/ID:?(\d+)/i);
  if (!idMatch) return sendText(phone, 'Formato incorrecto. Ejemplo: SÍ ID:42');

  const searchId = parseInt(idMatch[1]);
  const search = db.prepare('SELECT * FROM searches WHERE id = ?').get(searchId);
  if (!search) return sendText(phone, `No encontré la búsqueda #${searchId}.`);

  db.prepare('UPDATE notifications SET response = ? WHERE search_id = ? AND recipient_phone = ?')
    .run(hasSeen ? 'yes' : 'no', searchId, phone);

  if (hasSeen) {
    await sendText(phone, '¡Gracias! Notificando a la familia...');
    await sendText(search.reporter_phone,
      `🙌 ¡Buenas noticias! Alguien vio a *${search.missing_name}* en la zona.\n` +
      `Comunícate directamente: wa.me/${phone}\n` +
      `Búsqueda ID: #${searchId}`
    );
  } else {
    await sendText(phone, 'Gracias. Seguimos buscando.');
  }
}

async function handleCentros(phone) {
  const activeDisaster = db.prepare(
    'SELECT * FROM disasters WHERE active = 1 ORDER BY triggered_at DESC LIMIT 1'
  ).get();
  if (!activeDisaster) return sendText(phone, 'No hay eventos activos.');

  const centers = db.prepare(`
    SELECT * FROM assistance_centers WHERE disaster_id = ? AND active = 1
  `).all(activeDisaster.id);

  if (!centers.length) {
    return sendText(phone, 'No hay centros asistenciales registrados aún.');
  }

  const list = centers.map(c =>
    `📍 *${c.name}*\n${c.address || ''}\nPersonas: ${c.current_count}${c.capacity ? `/${c.capacity}` : ''}`
  ).join('\n\n');

  await sendText(phone, `*Centros asistenciales activos:*\n\n${list}\n\nPara registrarte: escribe *SANO [nombre del centro]*`);
}

async function handleVerSearch(phone, idStr) {
  const id = parseInt(idStr);
  if (!id) return sendText(phone, 'Formato: VER 42 (número de búsqueda)');
  const search = db.prepare('SELECT * FROM searches WHERE id = ?').get(id);
  if (!search) return sendText(phone, `No encontré la búsqueda #${id}.`);

  const responses = db.prepare(
    'SELECT COUNT(*) as total, SUM(response="yes") as seen FROM notifications WHERE search_id = ?'
  ).get(id);

  await sendText(phone,
    `*Búsqueda #${id}*\n` +
    `Buscando: ${search.missing_name}\n` +
    `Estado: ${search.status === 'active' ? '🔴 Activa' : '✅ Resuelta'}\n` +
    `Alertas enviadas: ${responses.total}\n` +
    `Personas que lo vieron: ${responses.seen || 0}\n` +
    `Creada: ${search.created_at}`
  );
}

async function sendHelp(phone) {
  await sendText(phone,
    `*AlertaPersonas* — Búsqueda en emergencias\n\n` +
    `*SANO* — Registrarme como sobreviviente\n` +
    `*SANO [centro]* — Registrarme en un centro específico\n` +
    `*BUSCO Juan Pérez 45 años* — Buscar a alguien\n` +
    `*CENTRO* — Ver centros asistenciales activos\n` +
    `*VER 42* — Ver estado de búsqueda #42\n\n` +
    `Mapa en tiempo real: ${process.env.BASE_URL}/mapa\n\n` +
    `🆘 En caso de emergencia médica llama al 171`
  );
}

module.exports = { handleMessage };
