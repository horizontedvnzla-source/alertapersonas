const express = require('express');
const router = express.Router();
const { handleMessage } = require('../bot');

// Verificación del webhook (Meta requiere esto al configurar)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recibir mensajes entrantes de WhatsApp
router.post('/', async (req, res) => {
  res.sendStatus(200); // responder inmediatamente para evitar timeout de Meta

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (!messages?.length) return;

    for (const msg of messages) {
      const phone = msg.from;
      let text = null;
      let location = null;

      if (msg.type === 'text') {
        text = msg.text?.body || '';
      } else if (msg.type === 'location') {
        location = { latitude: msg.location.latitude, longitude: msg.location.longitude };
        text = 'LOCATION';
      } else if (msg.type === 'interactive') {
        const reply = msg.interactive?.button_reply;
        if (reply?.id === 'share_location') {
          text = '__REQUEST_LOCATION__';
        } else if (reply?.id === 'type_location') {
          text = '__TYPE_LOCATION__';
        }
      }

      if (text || location) {
        await handleMessage(phone, text, location);
      }
    }
  } catch (err) {
    console.error('[webhook] Error procesando mensaje:', err.message);
  }
});

module.exports = router;
