require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const telegram = require('./telegram');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/mapa'));
app.use('/webhook', require('./routes/webhook'));
app.use('/api', require('./routes/api'));

// Mapa público
app.get('/mapa', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mapa.html'));
});

// Búsqueda por ID (link que se comparte con familias)
app.get('/buscar/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buscar.html'));
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`AlertaPersonas corriendo en :${PORT}`);
  console.log(`Webhook WA: POST /webhook`);
  console.log(`Mapa: GET /mapa`);
  console.log(`Admin: GET /admin`);

  // Arrancar bot de Telegram (no bloquea Express)
  telegram.init();
});
