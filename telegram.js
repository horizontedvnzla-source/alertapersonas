const { Telegraf } = require('telegraf');
const db = require('./db');
const { sendText: waSend } = require('./whatsapp');
const { getPhonesInRadius } = require('./geo');
const { extractNames, isListMessage, matchScore } = require('./list-extractor');

let bot = null;

// ── Inicializar bot ───────────────────────────────────────────────────────────

function init() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN no configurado — bot desactivado');
    return null;
  }

  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.command('start', ctx => ctx.reply(helpText()));
  bot.command('ayuda', ctx => ctx.reply(helpText()));
  bot.command('sano', ctx => handleSano(ctx));
  bot.command('busco', ctx => handleBusco(ctx));
  bot.command('centro', ctx => handleCentros(ctx));
  bot.command('ver', ctx => handleVer(ctx));

  // Monitoreo de grupos: cualquier mensaje que parezca una lista
  bot.on('message', async ctx => {
    const text = ctx.message?.text || ctx.message?.caption || '';
    if (!text || ctx.message.from?.is_bot) return;

    // Comandos directos en grupos también
    if (text.startsWith('/')) return; // ya manejado por handlers de arriba

    // Flujo personal: sesión activa
    const userId = String(ctx.from.id);
    const chatType = ctx.chat.type; // 'private' | 'group' | 'supergroup' | 'channel'

    if (chatType === 'private') {
      return handlePrivateMessage(ctx, userId, text);
    }

    // En grupos: analizar si es una lista de personas
    if ((chatType === 'group' || chatType === 'supergroup') && isListMessage(text)) {
      await handleGroupList(ctx, text);
    }
  });

  bot.launch().catch(err => console.error('[telegram] Error lanzando bot:', err.message));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  console.log('[telegram] Bot activo — @' + (process.env.TELEGRAM_BOT_USERNAME || 'AlertaPersonasBot'));
  return bot;
}

// ── Sesiones en memoria (igual que bot.js de WhatsApp) ───────────────────────

const sessions = new Map();

async function handlePrivateMessage(ctx, userId, text) {
  const cmd = text.toUpperCase().trim();

  if (sessions.has(userId)) {
    const session = sessions.get(userId);
    sessions.delete(userId);
    if (session.type === 'awaiting_name') {
      return registerSano(ctx, userId, null, null, text, session.disaster);
    }
    if (session.type === 'awaiting_missing_info') {
      return registerSearch(ctx, userId, text, session.disaster);
    }
  }

  if (cmd === 'SANO' || cmd.startsWith('SANO ')) return handleSano(ctx);
  if (cmd.startsWith('BUSCO ')) return handleBusco(ctx);
  if (cmd === 'CENTRO') return handleCentros(ctx);

  ctx.reply('No entendí. Escribe /ayuda para ver los comandos disponibles.');
}

// ── Comando /sano ─────────────────────────────────────────────────────────────

async function handleSano(ctx) {
  const disaster = getActiveDisaster();
  if (!disaster) return ctx.reply('⚠️ No hay un evento de emergencia activo ahora mismo.');

  const args = ctx.message?.text?.split(' ').slice(1).join(' ') || '';
  const userId = String(ctx.from.id);
  const name = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');

  if (args) {
    return registerSano(ctx, userId, null, null, args, disaster, name);
  }

  sessions.set(userId, { type: 'awaiting_name', disaster });
  ctx.reply(
    '📍 ¿Dónde estás ahora?\n\n' +
    'Comparte tu ubicación con el botón 📎 → Ubicación\n' +
    'O escribe el nombre del lugar donde estás.'
  );
}

async function registerSano(ctx, userId, lat, lng, locationText, disaster, displayName) {
  const name = displayName || ctx.from?.first_name || 'Sin nombre';

  const existing = db.prepare(
    'SELECT id FROM safe_persons WHERE phone = ? AND disaster_id = ?'
  ).get(userId, disaster.id);

  if (existing) {
    db.prepare(
      'UPDATE safe_persons SET lat=?, lng=?, location_text=?, registered_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(lat, lng, locationText, existing.id);
  } else {
    db.prepare(
      'INSERT INTO safe_persons (phone, name, lat, lng, location_text, disaster_id) VALUES (?,?,?,?,?,?)'
    ).run(userId, name, lat, lng, locationText, disaster.id);
  }

  const mapUrl = `${process.env.BASE_URL || 'http://localhost:4000'}/mapa`;
  await ctx.reply(
    `✅ *Registrado como SANO*\n` +
    `📍 ${locationText || 'Ubicación registrada'}\n\n` +
    `Tu familia puede encontrarte en:\n${mapUrl}`,
    { parse_mode: 'Markdown' }
  );

  // Notificar a buscadores que hayan registrado búsqueda desde esta cuenta TG
  checkAndNotifySearchers(userId, disaster);
}

// ── Comando /busco ────────────────────────────────────────────────────────────

async function handleBusco(ctx) {
  const disaster = getActiveDisaster();
  if (!disaster) return ctx.reply('⚠️ No hay un evento de emergencia activo.');

  const query = ctx.message?.text?.split(' ').slice(1).join(' ') || '';
  if (!query) {
    sessions.set(String(ctx.from.id), { type: 'awaiting_missing_info', disaster });
    return ctx.reply('¿A quién buscas? Escribe nombre y descripción:\nEj: *Juan Pérez 45 años camisa azul*', { parse_mode: 'Markdown' });
  }

  return registerSearch(ctx, String(ctx.from.id), query, disaster);
}

async function registerSearch(ctx, userId, query, disaster) {
  const result = db.prepare(
    'INSERT INTO searches (reporter_phone, missing_name, description, disaster_id) VALUES (?,?,?,?)'
  ).run(userId, query, query, disaster.id);

  const searchId = result.lastInsertRowid;

  // Buscar en registros SANO existentes (incluyendo los auto-registrados desde listas TG)
  const matches = findSanoMatches(query, disaster.id);

  if (matches.length) {
    const list = matches.map((m, i) =>
      `${i + 1}. *${m.name}* — ${m.location_text || 'ubicación registrada'} (${Math.round(m.score * 100)}% coincidencia)`
    ).join('\n');
    await ctx.reply(`🔍 ¡Posibles coincidencias encontradas!\n\n${list}\n\nID búsqueda: *#${searchId}*`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(
      `🔍 *Búsqueda registrada* — ID: #${searchId}\n\n` +
      `Buscando: *${query}*\n\n` +
      `No encontré coincidencias aún. Te aviso si aparece en algún grupo o se registra como SANO.`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ── Detección automática de listas en grupos ──────────────────────────────────

async function handleGroupList(ctx, text) {
  const disaster = getActiveDisaster();
  if (!disaster) return;

  const names = extractNames(text);
  if (!names.length) return;

  const groupName = ctx.chat.title || 'grupo';
  const locationHint = inferLocationFromContext(text, groupName);

  let registered = 0;
  const matches = [];

  for (const name of names) {
    // Auto-registrar como SANO con fuente = 'telegram_list'
    const existing = db.prepare(
      `SELECT id FROM safe_persons WHERE name = ? AND disaster_id = ? AND location_text LIKE ?`
    ).get(name, disaster.id, `%${groupName}%`);

    if (!existing) {
      db.prepare(
        `INSERT INTO safe_persons (phone, name, lat, lng, location_text, disaster_id)
         VALUES (?, ?, NULL, NULL, ?, ?)`
      ).run(`tg_list_${Date.now()}_${Math.random().toString(36).slice(2)}`, name, locationHint || groupName, disaster.id);
      registered++;
    }

    // Cruzar con búsquedas activas
    const activeSearches = db.prepare(
      `SELECT * FROM searches WHERE disaster_id = ? AND status = 'active'`
    ).all(disaster.id);

    for (const search of activeSearches) {
      const score = matchScore(search.missing_name, name);
      if (score >= 0.55) {
        matches.push({ search, foundName: name, score, source: groupName });
      }
    }
  }

  // Notificar coincidencias a quienes buscan
  for (const match of matches) {
    await notifyMatch(match, ctx, locationHint);
  }

  // Responder en el grupo si hubo actividad
  if (registered > 0 || matches.length > 0) {
    let reply = `🤖 *AlertaPersonas detectó una lista*\n`;
    if (registered > 0) reply += `✅ ${registered} persona${registered > 1 ? 's' : ''} registrada${registered > 1 ? 's' : ''} como SANA\n`;
    if (matches.length > 0) reply += `🔔 ${matches.length} coincidencia${matches.length > 1 ? 's' : ''} con búsquedas activas — notificando familias\n`;
    reply += `\nVer mapa: ${process.env.BASE_URL || 'http://localhost:4000'}/mapa`;
    await ctx.reply(reply, { parse_mode: 'Markdown' });
  }
}

async function notifyMatch(match, ctx, locationHint) {
  const { search, foundName, score, source } = match;
  const pct = Math.round(score * 100);
  const loc = locationHint || source;

  // Notificar en Telegram si el reportador es usuario TG
  if (bot && !search.reporter_phone.startsWith('+')) {
    try {
      await bot.telegram.sendMessage(
        search.reporter_phone,
        `🙌 *¡Posible coincidencia!*\n\n` +
        `Buscabas: *${search.missing_name}*\n` +
        `Encontrado como: *${foundName}*\n` +
        `Fuente: ${source} (${pct}% coincidencia)\n` +
        `${loc ? `📍 ${loc}` : ''}\n\n` +
        `¿Es la misma persona? Responde /confirmar_${search.id} o /descartar_${search.id}`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
  }

  // Notificar por WhatsApp si el reportador tiene número telefónico
  if (search.reporter_phone.startsWith('+')) {
    try {
      await waSend(search.reporter_phone,
        `🙌 *¡Posible coincidencia!*\n\n` +
        `Buscabas: *${search.missing_name}*\n` +
        `Encontrado en lista de Telegram: *${foundName}*\n` +
        `Grupo: ${source}  (${pct}% similitud)\n` +
        `${loc ? `📍 ${loc}` : ''}\n\n` +
        `¿Es la misma persona? Responde SÍ ID:${search.id} o NO ID:${search.id}`
      );
    } catch (_) {}
  }

  // Marcar notificación en BD
  db.prepare(
    `INSERT INTO notifications (search_id, recipient_phone, response)
     VALUES (?, ?, 'pending_confirmation')`
  ).run(search.id, search.reporter_phone);
}

// ── Comando /centro ───────────────────────────────────────────────────────────

async function handleCentros(ctx) {
  const disaster = getActiveDisaster();
  if (!disaster) return ctx.reply('No hay eventos activos.');

  const centers = db.prepare(
    'SELECT * FROM assistance_centers WHERE disaster_id = ? AND active = 1'
  ).all(disaster.id);

  if (!centers.length) return ctx.reply('No hay centros registrados aún.');

  const list = centers.map(c =>
    `📍 *${c.name}*\n${c.address || ''}\nPersonas: ${c.current_count}${c.capacity ? `/${c.capacity}` : ''}`
  ).join('\n\n');

  ctx.reply(`*Centros asistenciales activos:*\n\n${list}`, { parse_mode: 'Markdown' });
}

// ── Comando /ver ──────────────────────────────────────────────────────────────

async function handleVer(ctx) {
  const args = ctx.message?.text?.split(' ');
  const id = parseInt(args?.[1]);
  if (!id) return ctx.reply('Uso: /ver 42');

  const search = db.prepare('SELECT * FROM searches WHERE id = ?').get(id);
  if (!search) return ctx.reply(`No encontré la búsqueda #${id}.`);

  const stats = db.prepare(
    'SELECT COUNT(*) as total, SUM(response="yes") as seen FROM notifications WHERE search_id = ?'
  ).get(id);

  ctx.reply(
    `*Búsqueda #${id}*\nBuscando: ${search.missing_name}\n` +
    `Estado: ${search.status === 'active' ? '🔴 Activa' : '✅ Resuelta'}\n` +
    `Alertas enviadas: ${stats.total}\nAvistamientos: ${stats.seen || 0}`,
    { parse_mode: 'Markdown' }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActiveDisaster() {
  return db.prepare('SELECT * FROM disasters WHERE active = 1 ORDER BY triggered_at DESC LIMIT 1').get();
}

function findSanoMatches(query, disasterId) {
  const safes = db.prepare('SELECT * FROM safe_persons WHERE disaster_id = ?').all(disasterId);
  return safes
    .map(p => ({ ...p, score: matchScore(query, p.name || '') }))
    .filter(p => p.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function checkAndNotifySearchers(userId, disaster) {
  // Cuando alguien se registra como SANO, revisar si alguien lo busca
  const searches = db.prepare(
    `SELECT * FROM searches WHERE reporter_phone = ? AND disaster_id = ? AND status = 'active'`
  ).all(userId, disaster.id);
  for (const s of searches) {
    db.prepare('UPDATE searches SET status=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?')
      .run('found', s.id);
  }
}

function inferLocationFromContext(text, groupName) {
  // Intentar extraer el nombre del lugar del texto del mensaje
  const locationMatch = text.match(
    /(?:en|@|en el|en la|ubicados en|se encuentran en)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]{3,30})/i
  );
  if (locationMatch) return locationMatch[1].trim();

  // Si el nombre del grupo menciona una ubicación conocida
  const knownPlaces = ['Altamira', 'Sambil', 'Chacao', 'Petare', 'Maracay', 'Valencia', 'Caracas', 'Carabobo'];
  for (const place of knownPlaces) {
    if (groupName.toLowerCase().includes(place.toLowerCase())) return place;
  }

  return null;
}

function helpText() {
  return (
    `🚨 *AlertaPersonas* — Bot de emergencias\n\n` +
    `/sano — Registrarme como sobreviviente\n` +
    `/sano [lugar] — Registrarme en un lugar específico\n` +
    `/busco [nombre descripción] — Buscar a alguien\n` +
    `/centro — Ver centros asistenciales activos\n` +
    `/ver [id] — Estado de una búsqueda\n\n` +
    `*En grupos:* El bot detecta automáticamente listas de personas ` +
    `y las cruza con búsquedas activas 🤖\n\n` +
    `Mapa en tiempo real: ${process.env.BASE_URL || 'http://localhost:4000'}/mapa`
  );
}

module.exports = { init };
