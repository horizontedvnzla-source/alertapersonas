const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

const headers = () => ({
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
});

async function sendText(to, text) {
  return axios.post(BASE_URL, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  }, { headers: headers() });
}

async function sendTemplate(to, templateName, components = []) {
  return axios.post(BASE_URL, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'es' },
      components,
    },
  }, { headers: headers() });
}

async function sendLocationRequest(to) {
  return axios.post(BASE_URL, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: '¿Dónde estás ahora? Comparte tu ubicación para registrarte como SANO.' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'share_location', title: '📍 Compartir ubicación' } },
          { type: 'reply', reply: { id: 'type_location', title: '✏️ Escribir lugar' } },
        ],
      },
    },
  }, { headers: headers() });
}

async function sendMissingAlert(to, search, centerName) {
  const text = `🚨 *ALERTA BÚSQUEDA* — ${centerName || 'zona del desastre'}\n\n` +
    `Se busca: *${search.missing_name}*\n` +
    `${search.description || ''}\n\n` +
    `¿Lo/la has visto? Responde:\n` +
    `*SÍ [ID:${search.id}]* — si lo viste\n` +
    `*NO [ID:${search.id}]* — si no lo viste\n\n` +
    `Si está SANO, dile que escriba SANO en este número.`;
  return sendText(to, text);
}

async function broadcastToPhones(phones, messageBuilder) {
  const results = [];
  // Rate limit: 80 msg/s max en WhatsApp Cloud API
  for (let i = 0; i < phones.length; i++) {
    try {
      await messageBuilder(phones[i]);
      results.push({ phone: phones[i], sent: true });
    } catch (err) {
      results.push({ phone: phones[i], sent: false, error: err.message });
    }
    if (i % 50 === 49) await new Promise(r => setTimeout(r, 700));
  }
  return results;
}

module.exports = { sendText, sendTemplate, sendLocationRequest, sendMissingAlert, broadcastToPhones };
