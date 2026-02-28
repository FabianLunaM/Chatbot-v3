console.log("Iniciando servidor Amalgama 🚀");

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const agenda = require('./functions/agendar'); 
const consultar = require('./functions/consultar'); 
const modificar = require('./functions/modificar'); 
const cancelar = require('./functions/cancelar'); 
const { Validators } = require('./functions/validators'); 
console.log("Agenda cargada:", agenda);

const app = express();
app.use(cors());
app.use(express.json());

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 👇 Función para mostrar menú principal
function mostrarMenuPrincipal(pushName = "") {
  return (
    `¡Hola ${pushName} 👋! Qué gusto saludarte nuevamente.\n\n` +
    "👉 ¿Qué deseas hacer hoy?\n\n" +
    "1️⃣ 📅 Agendar una cita\n" +
    "2️⃣ 📖 Revisar tus citas agendadas\n" +
    "3️⃣ ❓💡 Preguntar o consultar sobre nuestros servicios\n\n" +
    "✨ Tu sonrisa es nuestra prioridad 😁"
  );
}

// 👇 Nueva función para enviar mensajes
async function enviarMensaje(sender, texto) {
  if (!texto || texto.trim() === "") {
    console.warn(`⚠️ No se envió mensaje a ${sender} porque la respuesta estaba vacía.`);
    return;
  }

  await sleep(5000); // respetar límite de 5s
  try {
    await axios.post(
      `${process.env.WASENDER_API_URL}/send-message`,
      { to: sender, text: texto },
      {
        headers: {
          Authorization: `Bearer ${process.env.WASENDER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`🤖 Respuesta enviada a ${sender}`);
  } catch (err) {
    console.error("❌ Error enviando mensaje:", err.response?.data || err.message);
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Contextos en memoria
const agendaContext = {}; 
const menuContext = {};   
const chatTimeouts = {}; 

function iniciarTimeout(sender) {
  if (chatTimeouts[sender]) {
    clearTimeout(chatTimeouts[sender]);
  }
  chatTimeouts[sender] = setTimeout(async () => {
    delete agendaContext[sender];
    delete menuContext[sender];
    delete chatTimeouts[sender];
    await enviarMensaje(sender, "⏰ El chat se ha cerrado automáticamente por inactividad. Gracias por conversar con Amalgama.");
  }, 300000); // 5 minutos
}

app.get('/', (req, res) => res.send('Ok'));

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as fecha');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en la BD:', err);
    res.status(500).send('Error en la conexión a la BD');
  }
});

app.post('/send-message', async (req, res) => {
  const { to, text } = req.body;
  try {
    await enviarMensaje(to, text);
    res.json({ status: "ok" });
  } catch (err) {
    console.error('❌ Error enviando mensaje:', err.response?.data || err.message);
    res.status(500).send('Error enviando mensaje');
  }
});

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

      if (content.trim().toLowerCase() === 'salir') {
        respuesta = "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
        delete agendaContext[sender];
        delete menuContext[sender];
      } else if (count === 1) {
        respuesta = mostrarMenuPrincipal(pushName);
        menuContext[sender] = true;
      } else {
        // Flujo de modificación/cancelación con confirmación
        if (agendaContext[sender]?.paso === 'modificar_fecha') {
          const v = modificar.validarNuevaFecha(content.trim());
          if (v.error) {
            respuesta = v.error;
          } else {
            agendaContext[sender].nuevaFechaObj = v.fechaObj;
            const horarios = await modificar.pedirNuevaHora(pool, v.fechaObj);
            if (horarios.error) {
              respuesta = horarios.error;
            } else {
              agendaContext[sender].paso = 'modificar_hora';
              agendaContext[sender].disponibles = horarios.disponibles;
              respuesta = horarios.mensaje;
            }
          }
        } else if (agendaContext[sender]?.paso === 'modificar_hora') {
          const opcionesValidas = agendaContext[sender].disponibles.map((_, idx) => String(idx+1));
          const v = Validators.menuOption(content.trim(), opcionesValidas);
          if (!v.ok) {
            respuesta = `❌ ${v.error}\n\n👉 Responde con un número válido.`;
          } else {
            const idx = parseInt(v.value, 10) - 1;
            agendaContext[sender].nuevaHora = agendaContext[sender].disponibles[idx];
            respuesta = modificar.pedirConfirmacionModificacion(
              agendaContext[sender].nuevaFechaObj,
              agendaContext[sender].nuevaHora
            );
            agendaContext[sender].paso = 'confirmacion';
          }
        } else if (agendaContext[sender]?.paso === 'confirmacion') {
          const v = Validators.menuOption(content.trim(), ['1','2']);
          if (!v.ok) {
            respuesta = `❌ ${v.error}\n\n👉 Responde con 1 (Sí) o 2 (No).`;
          } else {
            if (v.value === '1') {
              if (agendaContext[sender].accion === 'cancelar') {
                respuesta = await cancelar.aplicarCancelacion(pool, agendaContext[sender].citaId);
              } else if (agendaContext[sender].accion === 'modificar') {
                respuesta = await modificar.aplicarModificacion(
                  pool,
                  agendaContext[sender].citaId,
                  agendaContext[sender].nuevaFechaObj,
                  agendaContext[sender].nuevaHora
                );
              }
              respuesta += "\n\n👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
              delete agendaContext[sender];
              delete menuContext[sender];
            } else if (v.value === '2') {
              respuesta = mostrarMenuPrincipal(pushName);
              delete agendaContext[sender];
              menuContext[sender] = true;
            }
          }
        }

        // 👇 Menú principal
        else {
          console.log("➡️ Entrando en menú principal");
          if (!menuContext[sender]) {
            respuesta = mostrarMenuPrincipal(pushName);
            menuContext[sender] = true;
          } else {
            const v = Validators.menuOption(content.trim(), ['1','2','3']);
            if (!v.ok) {
              respuesta = `❌ ${v.error}\n\n👉 Por favor responde con el número de la opción.`;
            } else {
              switch (v.value) {
                case '1':
                  const paciente = await pool.query('SELECT id FROM patients WHERE sender = $1', [sender]); 
                  if (paciente.rowCount > 0) { 
                    const patientId = paciente.rows[0].id; 
                    const citasPendientes = await pool.query(
                      'SELECT COUNT(*) FROM appointments WHERE patient_id = $1 AND status = $2', 
                      [patientId, 'pendiente'] 
                    ); 
                    if (parseInt(citasPendientes.rows[0].count, 10) >= 3) { 
                      respuesta = 
                      "❌ Ya tienes 3 citas pendientes registradas. No puedes agendar más hasta que alguna se complete o se cancele.\n\n"+
                      "Gracias por cantactarte con el consultorio dental Ortodent. Hasta pronto✨"; 
                      delete agendaContext[sender];
                      delete menuContext[sender];
                      break; 
                    } 
                  } 
                  agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
                  respuesta = await agenda.iniciarAgenda();
                  break;

                case '2':
                  const consulta = await consultar.consultarCitas(sender, pool); 
                  respuesta = consulta.respuesta; 
                  agendaContext[sender] = { paso: 'consultar_menu', citas: consulta.citas };
                  break;

                case '3':
                  respuesta = "💡 Puedes consultar nuestros servicios odontológicos. ¿Qué deseas saber?";
                  break;
              }
            }
          }
        }
      }

      if (!respuesta || respuesta.trim() === "") { 
        console.error("⚠️ Flujo sin respuesta, aplicando fallback"); 
        respuesta = "⚠️ Hubo un error en el flujo. Escribe '1' para agendar una cita o '2' para salir."; 
      }

      if (agendaContext[sender] || menuContext[sender]) {
        iniciarTimeout(sender);
      } else {
        if (chatTimeouts[sender]) {
          clearTimeout(chatTimeouts[sender]);
          delete chatTimeouts[sender];
        }
      }

      await enviarMensaje(sender, respuesta);
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
