# AlertaPersonas 🚨

Sistema de búsqueda de personas en desastres via WhatsApp y Telegram.

Desarrollado en respuesta a los sismos de magnitud 7.1 y 7.5 que sacudieron
Venezuela el 24 de junio de 2026.

## ¿Qué hace?

A diferencia de registros pasivos (como Google Person Finder), AlertaPersonas
**notifica activamente** a las personas en el radio geográfico correcto:

- Alguien escribe `SANO` → se registra con su ubicación
- Alguien escribe `BUSCO [nombre]` → el sistema notifica a voluntarios/sobrevivientes en un radio configurable
- El bot de Telegram **lee listas en grupos** y cruza nombres automáticamente con búsquedas activas

## Canales

| Canal | Funcionalidad |
|---|---|
| WhatsApp (Meta Cloud API) | Comandos, registro, notificaciones |
| Telegram Bot | Comandos + detección automática de listas en grupos |
| Mapa web (Leaflet) | Visualización pública en tiempo real |
| Admin panel | Activar eventos, centros asistenciales, estadísticas |

## Inicio rápido

```bash
npm install
cp .env.example .env
# Editar .env con tus tokens
node server.js
```

## Variables de entorno

Ver `.env.example` para la lista completa. Las mínimas para arrancar con Telegram:

```env
TELEGRAM_BOT_TOKEN=token_de_botfather
ADMIN_SECRET=tu_clave_admin
```

## Comandos del bot

```
SANO                    → Registrarse como sobreviviente
SANO [nombre del lugar] → Registrarse en un centro específico
BUSCO [nombre desc.]    → Buscar a alguien
CENTRO                  → Ver centros asistenciales activos
VER [id]                → Estado de una búsqueda
AYUDA                   → Lista de comandos
```

## Arquitectura

```
WhatsApp Webhook ──┐
                   ├── Bot Core (bot.js) ── SQLite (db.js)
Telegram Bot ──────┘         │
                             ├── Geo Engine (geo.js)    Haversine, sin API externa
                             ├── List Extractor (telegram.js)  NLP para grupos
                             └── Notif Dispatcher (whatsapp.js / telegraf)

Admin API ── Express (server.js)
Mapa público ── Leaflet + OpenStreetMap
```

## Costos de operación

| Componente | Costo |
|---|---|
| Telegram Bot API | Gratis, sin límites |
| Meta Cloud API (WhatsApp) | Gratis hasta 1000 conversaciones/mes |
| VPS mínimo (1vCPU/2GB) | ~$5-10 USD/mes |

## Colaboración con Meta

Este proyecto busca colaboración con el programa
[Meta Social Impact](https://socialimpact.facebook.com/) para acceso
humanitario gratuito a WhatsApp Cloud API a escala.

## Licencia

MIT — libre para uso por ONGs, gobiernos y organizaciones humanitarias.
