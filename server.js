console.log("Iniciando servidor Amalgama 🚀");

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión a PostgreSQL en Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // necesario en Railway
  }
});

// Health check para Railway
app.get('/', (req, res) => {
  res.send('Ok');
});

// Endpoint de prueba de BD
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as fecha');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en la BD:', err);
    res.status(500).send('Error en la conexión a la BD');
  }
});

// ✅ Endpoint para enviar mensajes vía WaSender
app.post('/send-message', async (req, res) => {
  const { to, text } = req.body;
  try {
    const response = await axios.post(
      `${process.env.WASENDER_API_URL}/send-message`,
      { to, text },
      {
        headers: {
          Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('❌ Error enviando mensaje:', err.response?.data || err.message);
    res.status(500).send('Error enviando mensaje');
  }
});

// ✅ Endpoint Webhook para recibir mensajes desde WaSender
app.post('/webhook', async (req, res) => {
  // Validar firma con el secret
  const signature = req.headers['x-wasender-signature'];
  if (signature !== process.env.WASENDER_WEBHOOK_SECRET) {
    return res.status(401).send('Firma inválida');
  }

  const { from, text } = req.body;
  console.log(`📩 Mensaje recibido de ${from}: ${text}`);

  try {
    await pool.query(
      'INSERT INTO interactions (patient_id, message_in) VALUES ($1, $2)',
      [null, text]
    );
    console.log('💾 Mensaje guardado en BD');
  } catch (err) {
    console.error('❌ Error guardando mensaje en BD:', err);
  }

  res.send('ok');
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
