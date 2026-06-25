// Haversine distance — no external API needed
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPhonesInRadius(db, centerLat, centerLng, radiusKm, disasterId) {
  const persons = db.prepare(`
    SELECT DISTINCT phone, lat, lng FROM safe_persons
    WHERE disaster_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
  `).all(disasterId);

  return persons
    .filter(p => distanceKm(centerLat, centerLng, p.lat, p.lng) <= radiusKm)
    .map(p => p.phone);
}

// Simple text similarity for name matching (no ML needed for MVP)
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const normalize = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

function findMatches(db, search) {
  const safePersons = db.prepare(`
    SELECT * FROM safe_persons WHERE disaster_id = ?
  `).all(search.disaster_id);

  return safePersons
    .map(p => ({ ...p, score: nameSimilarity(search.missing_name, p.name) }))
    .filter(p => p.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

module.exports = { distanceKm, getPhonesInRadius, nameSimilarity, findMatches };
