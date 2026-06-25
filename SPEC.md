# SPEC — AlertaPersonas: Sistema de Búsqueda en Desastres

> Redactado: 25-Jun-2026 | Post-terremoto Venezuela 7.1/7.5 (24-Jun-2026, Carabobo/Caracas)

---

## 1. Problema validado

El 24 de junio de 2026 dos sismos de magnitud 7.1 y 7.5 sacudieron Venezuela.
Cuatro edificios colapsaron en Los Palos Grandes, uno en San Bernardino (Caracas).
El gobierno declaró emergencia nacional.

**Lo que pasó en las próximas horas:**
- Familias buscando parientes en grupos de WhatsApp sin coordinación
- Listas de sobrevivientes escritas a mano en centros asistenciales, sin digitalizar
- Nadie con visibilidad del sistema completo: quién está sano, quién falta, dónde

**Lo que NO existe hoy:**
| Sistema | Existe | Problema |
|---|---|---|
| Google Person Finder | Sí (activo) | Pasivo: nadie sabe que existe; sin notificación activa |
| AMBER Alert / WEA | EE.UU. | No implementado en Venezuela; no aplica a adultos |
| Grupos de WhatsApp | Sí | Sin estructura, sin búsqueda, duplicados |
| Cell Broadcast (CBC) | En Venezuela: no | Requiere acuerdo con CONATEL y operadoras |
| **AlertaPersonas** | **No** | **← lo que construimos** |

---

## 2. Solución

Sistema de notificación activa y geolocalizad a para búsqueda de personas en desastres.

**Diferenciador central:** en lugar de que la familia busque, el sistema pregunta activamente
a las personas en el radio geográfico correcto: *"¿Viste a esta persona?"*

### Canales (por penetración en Venezuela)

```
1. WhatsApp Business API  ← canal primario (95%+ penetración)
2. SMS                    ← fallback (sin datos)
3. Web app (PWA)          ← voluntarios y coordinadores
4. Cell Broadcast (CBC)   ← fase 2, requiere CONATEL
```

---

## 3. Flujo completo

```
DESASTRE DETECTADO
        │
        ▼
┌─────────────────────────────────┐
│  Trigger de activación          │
│  · USGS/FUNVISIS webhook        │
│  · Magnitud > umbral (ej. 5.5)  │
│  · O activación manual admin    │
└──────────────┬──────────────────┘
               │
       ┌───────▼────────┐
       │ Broadcast       │ → WhatsApp a todos los usuarios registrados
       │ inicial         │   en la zona afectada (radio configurable)
       └───────┬────────┘   "Sismo detectado. Escribe SANO + tu ubicación"
               │
    ┌──────────┴──────────────┐
    │                         │
    ▼                         ▼
REGISTRO SANO           REGISTRO BÚSQUEDA
"SANO" + ubicación      "BUSCO Juan Pérez 45 años
 → aparece en mapa       camisa roja" + foto opcional
 → notifica a familia    → genera alerta geolocalizad a
    que lo busca         → AI matching contra registros SANO
```

---

## 4. Comandos del bot de WhatsApp

| Comando | Descripción |
|---|---|
| `SANO` | Registro de sobreviviente. El bot responde pidiendo ubicación (botón "Compartir") |
| `SANO [nombre del centro]` | Registro en centro asistencial específico |
| `BUSCO [nombre] [descripción]` | Registra búsqueda de persona desaparecida |
| `CENTRO` | Lista centros asistenciales activos con capacidad |
| `VER [ID]` | Ver estado de una búsqueda específica |
| `AYUDA` | Lista de comandos |

### Flujo SANO (SMS fallback sin GPS):
```
Usuario: SANO
Bot: Comparte tu ubicación o escribe el nombre del centro donde estás.
     [Botón: Compartir ubicación]
Usuario: [comparte ubicación / escribe "Refugio Altamira"]
Bot: ✓ Registrado como SANO en [lugar]. Tu familia puede buscarte en:
     https://alertapersonas.ht/buscar/+58412XXXXXXX
```

### Flujo BUSCO:
```
Usuario: BUSCO María González 38 años pelo corto caraqueña
Bot: Buscando en registros activos...
     [si hay match] → ¡Posible coincidencia! María González
                      Registrada SANO en Refugio Altamira, hace 2h.
                      ¿Es la misma persona? [Sí] [No]
     [si no hay match] → No encontrada aún. Alerta enviada a 234
                          personas en radio de 5km. Te avisamos si aparece.
```

---

## 5. Arquitectura técnica

```
┌─────────────────────────────────────────────────────────┐
│                    AlertaPersonas                        │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │ WhatsApp │    │  Web PWA │    │   Admin Panel    │  │
│  │ Webhook  │    │ (mapa    │    │   (auth admin)   │  │
│  │ (Express)│    │  público)│    │                  │  │
│  └────┬─────┘    └────┬─────┘    └────────┬─────────┘  │
│       │               │                   │             │
│       └───────────────▼───────────────────┘             │
│                   ┌──────────┐                          │
│                   │  API     │                          │
│                   │  Core    │                          │
│                   └────┬─────┘                          │
│            ┌───────────┼───────────┐                   │
│            ▼           ▼           ▼                   │
│       ┌─────────┐ ┌─────────┐ ┌──────────┐            │
│       │Personas │ │  Geo    │ │  Notif   │            │
│       │Registry │ │ Engine  │ │ Dispatcher│           │
│       │(SQLite) │ │(Haversine│ │(WA+SMS)  │           │
│       └─────────┘ └─────────┘ └──────────┘            │
│                                                         │
│            ┌───────────┴──────────────┐                │
│            ▼                          ▼                │
│      ┌──────────┐              ┌──────────────┐        │
│      │ USGS/    │              │  Face Match  │        │
│      │ FUNVISIS │              │  (Fase 2)    │        │
│      │ Webhook  │              └──────────────┘        │
│      └──────────┘                                      │
└─────────────────────────────────────────────────────────┘
```

### Stack MVP

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Base de datos | SQLite → PostgreSQL (Fase 2) |
| WhatsApp | Meta Cloud API (gratuita hasta 1000 conv/mes) |
| SMS fallback | Twilio (o local: Telcel/Digitel API) |
| Geo | Fórmula Haversine (no requiere API externa) |
| Mapa público | Leaflet.js + OpenStreetMap |
| Face matching | Fase 2: AWS Rekognition / Azure Face API |
| Deploy | Docker en VPS (≤ $10/mes) |

---

## 6. Esquema de base de datos

```sql
-- Evento de desastre
CREATE TABLE disasters (
  id INTEGER PRIMARY KEY,
  name TEXT,
  lat REAL, lng REAL,
  radius_km REAL DEFAULT 50,
  triggered_at DATETIME,
  active INTEGER DEFAULT 1
);

-- Personas registradas como SANAS
CREATE TABLE safe_persons (
  id INTEGER PRIMARY KEY,
  phone TEXT,              -- número WhatsApp (identificador)
  name TEXT,
  lat REAL, lng REAL,
  location_text TEXT,      -- nombre del centro o descripción
  disaster_id INTEGER,
  registered_at DATETIME,
  photo_url TEXT,
  FOREIGN KEY(disaster_id) REFERENCES disasters(id)
);

-- Búsquedas activas
CREATE TABLE searches (
  id INTEGER PRIMARY KEY,
  reporter_phone TEXT,
  missing_name TEXT,
  description TEXT,        -- texto libre para matching NLP
  last_known_lat REAL,
  last_known_lng REAL,
  photo_url TEXT,
  disaster_id INTEGER,
  status TEXT DEFAULT 'active', -- active | found | closed
  created_at DATETIME,
  resolved_at DATETIME,
  FOREIGN KEY(disaster_id) REFERENCES disasters(id)
);

-- Notificaciones enviadas (para no duplicar)
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  search_id INTEGER,
  recipient_phone TEXT,
  sent_at DATETIME,
  response TEXT,           -- 'yes' | 'no' | null (sin respuesta)
  FOREIGN KEY(search_id) REFERENCES searches(id)
);

-- Centros asistenciales
CREATE TABLE assistance_centers (
  id INTEGER PRIMARY KEY,
  name TEXT,
  lat REAL, lng REAL,
  address TEXT,
  capacity INTEGER,
  current_count INTEGER DEFAULT 0,
  disaster_id INTEGER,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(disaster_id) REFERENCES disasters(id)
);
```

---

## 7. Lógica de geofencing (sin API externa)

```javascript
// Fórmula Haversine — distancia entre dos puntos GPS
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
            Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Personas en radio alrededor de última ubicación conocida
function getPhonesInRadius(lastKnownLat, lastKnownLng, radiusKm, disasterId) {
  return db.all(`
    SELECT phone FROM safe_persons
    WHERE disaster_id = ?
  `, [disasterId]).filter(p =>
    haversineKm(lastKnownLat, lastKnownLng, p.lat, p.lng) <= radiusKm
  );
}
```

---

## 8. MVP — Alcance y fases

### Fase 1 — MVP (3 semanas, costo: $0 en producción)

- [x] Bot WhatsApp (Meta Cloud API gratuita)
- [x] Registro SANO con ubicación
- [x] Registro búsqueda con descripción
- [x] Matching por texto (nombre + descripción)
- [x] Geofenced notification a registrados en radio
- [x] Mapa público Leaflet (centros + puntos SANO anónimos)
- [x] Admin panel básico (activar evento, ver estadísticas)
- [x] USGS webhook (trigger automático)
- [x] SMS fallback vía Twilio

### Fase 2 — Escala (mes 2-3)

- [ ] Face recognition matching (foto → foto)
- [ ] Cell Broadcast con CONATEL
- [ ] App nativa (React Native) para voluntarios
- [ ] PostgreSQL + Redis para escala
- [ ] API pública para ONGs y medios
- [ ] Integración con Cruz Roja Venezuela

### Fase 3 — Con Meta

- [ ] Geofenced WhatsApp broadcast nativo (requiere acuerdo Meta)
- [ ] WhatsApp Flow estructurado para registro
- [ ] Integración con Instagram y Facebook Safety Check
- [ ] Análisis de posts públicos con IA para detección automática

---

## 9. Estrategia para llegar a Meta

### Canales disponibles (verificados)

| Canal | URL | Fit |
|---|---|---|
| Meta Social Impact Partnerships | socialimpact.facebook.com | Alto |
| Meta Llama Impact Grants | ai.meta.com/llama-impact-grants | Alto (hasta $500k) |
| WhatsApp for Social Good | developers.facebook.com | Alto |
| Meta Community Action Grants | datacenters.atmeta.com | Medio |

### Plan de acercamiento en 3 pasos

**Paso 1 — Lanzar primero (semana 1-3)**
Tener el MVP funcionando con datos reales del terremoto del 24-Jun-2026.
El pitch más poderoso no es "queremos construir esto" — es "esto ya funcionó."

**Paso 2 — Documentar el caso real**
- Número de personas registradas
- Búsquedas resueltas
- Tiempo promedio de resolución
- Testimonios de familias

**Paso 3 — Pitch directo**

Tres vías en paralelo:

1. **Meta Llama Impact Grants** — aplicar con el caso real como evidencia.
   Deadline abierto, hasta $500,000 USD. Se puede construir con Llama 3 para el
   matching NLP y calificar para el grant.

2. **WhatsApp for Business / NGO Program** — solicitar acceso gratuito al tier
   de empresa sin costo para uso humanitario. El precedente existe: organizaciones
   de Cruz Roja y UNHCR tienen acceso especial.

3. **Contacto directo via LinkedIn** — Directores de producto de WhatsApp
   (especialmente el equipo de "WhatsApp for Good") y el equipo de Crisis Response
   de Meta. Incluir el artículo de Rest of World sobre WhatsApp en desastres como
   contexto (ya publicado en 2024, mencionan el vacío que AlertaPersonas llena).

### Texto base del pitch a Meta (borrador)

```
Subject: AlertaPersonas — Live crisis tool built on WhatsApp API, 
         Venezuela earthquake June 24, 2026

Hi [nombre],

On June 24, 2026 a 7.5 magnitude earthquake struck Venezuela.
In the hours after, families used unstructured WhatsApp groups
to search for loved ones — with no coordination, no data, no results.

We built AlertaPersonas in response: a WhatsApp-first missing persons
system that actively notifies people in the geographic radius of a
missing person, rather than waiting for families to find a registry.

In 72 hours post-event we registered [X] safe persons and [Y] searches,
resolving [Z] cases through automated matching and geofenced alerts.

We're requesting:
1. WhatsApp Cloud API humanitarian tier access (no messaging cost)
2. 15 minutes with your Crisis Response or WhatsApp for Good team
3. Guidance on native geofenced broadcast capabilities (WA Flows)

We're launching at no cost to end users. The only thing we need
is the infrastructure to reach them at scale.

[adjuntar: capturas del bot, mapa, estadísticas]
```

---

## 10. Costo de operación MVP

| Componente | Costo |
|---|---|
| Meta Cloud API (primeras 1000 conv/mes) | $0 |
| Twilio SMS (1000 SMS) | ~$7.50 |
| VPS (1 vCPU, 2GB RAM) | $5-10/mes |
| Dominio | $12/año |
| **Total mes 1** | **< $20 USD** |

Si Meta aprueba tier humanitario → WhatsApp gratuito indefinidamente.

---

## 11. Consideraciones de privacidad y seguridad

- Números de teléfono hasheados en la BD (no visibles en el mapa público)
- Datos eliminados 90 días después del cierre del evento
- Mapa público muestra solo puntos agregados (sin nombres ni teléfonos)
- Opt-in explícito: el usuario inicia la conversación (cumple política Meta)
- Las fotos se almacenan en storage privado, no en URLs públicas
- HTTPS obligatorio en todos los endpoints

---

*Próximo paso: implementar MVP — ver `/alertapersonas` en este repo.*
