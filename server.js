console.log("Iniciando servidor Amalgama 🚀");

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const agenda = require('./functions/agendar'); // 👈 Importamos la lógica de agendar
console.log("Agenda cargada:", agenda);

const app = express();
app.use(cors());
app.use(express.json());

// Helper para respetar rate limit
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Configuración de conexión a PostgreSQL en Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // necesario en Railway
  }
});

// Contexto de agenda en memoria
const agendaContext = {}; 
// Estructura: { sender: { paso: 'nombre'|'motivo'|'fecha_hora', nombre:'', motivo:'' } }

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
    await sleep(5000); // respetar límite
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
  console.log('Headers recibidos:', req.headers);
  console.log('Body recibido:', req.body);

  const signature = req.headers['x-webhook-signature'];
  if (signature !== process.env.WASENDER_WEBHOOK_SECRET) {
    console.error('❌ Firma inválida');
    return res.status(401).send('Firma inválida');
  }

  let sender, content, pushName;

  if (req.body.event === 'webhook.test' && req.body.data?.message) {
    sender = 'WaSenderTest';
    content = req.body.data.message;
  } else if (req.body.event === 'messages.received' && req.body.data?.messages) {
    const msg = req.body.data.messages;
    sender = msg.remoteJid;
    content = msg.messageBody;
    pushName = msg.pushName || '';
  }

  console.log(`📩 Mensaje recibido de ${sender}: ${content}`);

  try {
    if (content && sender) {
      await pool.query(
        'INSERT INTO interactions (patient_id, message_in, sender) VALUES ($1, $2, $3)',
        [null, content, sender]
      );
      console.log('💾 Mensaje guardado en BD');

      const check = await pool.query(
        'SELECT COUNT(*) FROM interactions WHERE sender = $1',
        [sender]
      );
      const count = parseInt(check.rows[0].count, 10);

      let respuesta;

      if (count === 1) {
        // Primer contacto → saludo genérico
        respuesta =
          "🦷✨ ¡Hola! Bienvenido(a) al Consultorio Dental Ortodent 💙\n" +
          "Tu sonrisa es nuestra prioridad 😁✨\n\n" +
          "Soy Amalgama, tu asistente virtual 🤖💬, y estoy aquí para ayudarte.\n\n" +
          "👉 ¿Qué deseas hacer hoy?\n\n" +
          "1️⃣ 📅 Agendar una cita\n" +
          "2️⃣ 📖 Revisar tus citas agendadas\n" +
          "3️⃣ ❓💡 Preguntar o consultar sobre nuestros servicios\n\n" +
          "✨ ¡Tu salud dental está en buenas manos!";
      } else {
        // Flujo de agenda paso a paso
        if (content.trim() === "1") {
          agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
          respuesta = await agenda.iniciarAgenda(sender, pool);
        } else if (agendaContext[sender]) {
          const ctx = agendaContext[sender];
          const paso = ctx.paso;
          const result = await agenda.procesarPaso(sender, pool, paso, content.trim(), ctx);
          ctx.paso = result.siguiente;
          respuesta = result.respuesta;
          if (ctx.paso === 'completo') {
            delete agendaContext[sender]; // limpiar contexto
          }
        } else {
          respuesta =
            `¡Hola! ${pushName} 👋, bienvenido nuevamente. Te saluda Amalgama, tu asistente virtual🤖\n\n` +
            "👉 ¿Qué deseas hacer hoy?\n\n" +
            "1️⃣ 📅 Agendar una cita\n" +
            "2️⃣ 📖 Revisar tus citas agendadas\n" +
            "3️⃣ ❓💡 Preguntar o consultar sobre nuestros servicios\n\n" +
            "✨ Tu sonrisa es nuestra prioridad 😁";
        }
      }

      await sleep(5000); // respetar límite
      await axios.post(
        `${process.env.WASENDER_API_URL}/send-message`,
        { to: sender, text: respuesta },
        {
          headers: {
            Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`🤖 Respuesta enviada a ${sender}`);
    }
  } catch (err) {
    console.error('❌ Error en webhook:', err);
  }

  res.send('ok');
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
