// Extrae nombres de listas informales que la gente posta en grupos de Telegram/WhatsApp
// después de un desastre: "Lista de sanos: Juan Pérez, María González..."

const TRIGGER_WORDS = [
  'lista', 'listado', 'sobrevivientes', 'sobreviviente', 'sanos', 'sano',
  'confirmados', 'confirmado', 'encontrados', 'encontrado', 'localizados',
  'localizado', 'refugio', 'refugiados', 'presentes', 'safe', 'survivors',
  'evacuados', 'evacuado', 'albergue', 'albergados',
];

// Palabras que NO son nombres (stop words contextuales)
const NOT_NAMES = new Set([
  'lista', 'listado', 'de', 'del', 'las', 'los', 'en', 'y', 'e', 'con',
  'sin', 'para', 'por', 'se', 'están', 'están', 'sanos', 'sano', 'bien',
  'todos', 'todas', 'aquí', 'acá', 'allá', 'salvo', 'salvos', 'gracias',
  'dios', 'favor', 'compartir', 'rt', 'repost', 'via', 'fuente', 'update',
  'actualización', 'actualizado', 'center', 'centro', 'refugio', 'sambil',
  'altamira', 'caracas', 'maracay', 'valencia', 'ubicados', 'hora',
  'personas', 'persona', 'niños', 'niño', 'adultos', 'adulto',
]);

function looksLikeName(token) {
  const clean = token.replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]/g, '').trim();
  if (clean.length < 3) return false;
  if (NOT_NAMES.has(clean.toLowerCase())) return false;
  // Al menos una letra mayúscula al inicio (nombre propio)
  if (!/^[A-ZÁÉÍÓÚÜÑ]/.test(clean)) return false;
  // No más de 4 palabras (evita frases)
  const words = clean.split(/\s+/);
  if (words.length > 4) return false;
  // La primera palabra no debe ser una stop word (filtra "SANOS EN CHACAO")
  if (NOT_NAMES.has(words[0].toLowerCase())) return false;
  // Rechazar si contiene preposiciones (indica frase, no nombre)
  const prepositions = new Set(['en', 'de', 'del', 'el', 'la', 'los', 'las', 'al', 'con', 'por', 'para', 'a']);
  if (words.some(w => prepositions.has(w.toLowerCase()) && words.length <= 2)) return false;
  return true;
}

function isListMessage(text) {
  const lower = text.toLowerCase();
  return TRIGGER_WORDS.some(w => lower.includes(w));
}

function extractNames(text) {
  if (!isListMessage(text)) return [];

  const names = new Set();

  // Patrón 1: listas con viñetas/guiones/números
  // "- Juan Pérez\n- María González"
  const bulletLines = text.match(/^[\s]*[-•*✓✅🙏\d.]+\s*([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s]{2,40})$/gm) || [];
  for (const line of bulletLines) {
    const name = line.replace(/^[\s\-•*✓✅🙏\d.]+\s*/, '').trim();
    if (looksLikeName(name)) names.add(normalize(name));
  }

  // Patrón 2: lista separada por comas tras trigger word
  // "Confirmados sanos: Juan Pérez, María González, Pedro"
  const afterColon = text.match(/(?:lista|listado|sanos?|confirmados?|encontrados?|localizados?|refugiados?|presentes)[^:]*:\s*([^\n]{5,200})/gi) || [];
  for (const match of afterColon) {
    const part = match.split(':').slice(1).join(':');
    const candidates = part.split(/,|;|\|/).map(s => s.trim());
    for (const c of candidates) {
      if (looksLikeName(c)) names.add(normalize(c));
    }
  }

  // Patrón 3: líneas que parecen nombres (sin viñeta, una por línea, capitalizadas)
  // Útil cuando el mensaje es solo la lista sin introducción
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    for (const line of lines) {
      // Línea de 2-4 palabras capitalizadas = probable nombre completo
      const words = line.split(/\s+/);
      if (words.length >= 2 && words.length <= 4) {
        const allCaps = words.every(w => /^[A-ZÁÉÍÓÚÜÑ]/.test(w));
        if (allCaps && looksLikeName(line)) names.add(normalize(line));
      }
    }
  }

  return [...names];
}

function normalize(name) {
  return name
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score de similitud entre nombre buscado y nombre encontrado en lista
function matchScore(searchName, foundName) {
  const a = searchName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const b = foundName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (a === b) return 1.0;

  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const score = intersection / Math.max(wordsA.size, wordsB.size);

  // Bonus si el primer apellido coincide
  const surnameA = a.split(/\s+/).slice(-1)[0];
  const surnameB = b.split(/\s+/).slice(-1)[0];
  if (surnameA && surnameB && surnameA === surnameB && surnameA.length > 3) {
    return Math.min(1, score + 0.3);
  }

  return score;
}

module.exports = { extractNames, isListMessage, matchScore };
