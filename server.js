console.log("Iniciando servidor Amalgama 🚀");

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const agenda = require('./functions/agendar'); 
const consultar = require('./functions/consultar'); 
const modificar = require('./functions/modificar'); 
const { Validators } = require('./functions/validators'); 
console.log("Agenda cargada:", agenda);

const app = express();
app.use(cors());
app.use(express.json());

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
        respuesta =
          "🦷✨ ¡Hola! Bienvenido(a) al Consultorio Dental Ortodent 💙\n" +
          "Tu sonrisa es nuestra prioridad 😁✨\n\n" +
          "Soy Amalgama, tu asistente virtual 🤖💬, y estoy aquí para ayudarte.\n\n" +
          "👉 ¿Qué deseas hacer hoy?\n\n" +
          "1️⃣ 📅 Agendar una cita\n" +
          "2️⃣ 📖 Revisar tus citas agendadas\n" +
          "3️⃣ ❓💡 Preguntar o consultar sobre nuestros servicios\n\n" +
          "✨ ¡Tu salud dental está en buenas manos!";
        menuContext[sender] = true;
      } else {
        if (agendaContext[sender] && agendaContext[sender].paso !== 'gestion_citas' && agendaContext[sender].paso !== 'consultar_menu') {
          const ctx = agendaContext[sender];
          const paso = ctx.paso;
          const result = await agenda.procesarPaso(sender, pool, paso, content.trim(), ctx);
          ctx.paso = result.siguiente;

          if (ctx.paso === 'fecha') { 
            delete ctx.fecha; 
            delete ctx.fechaStr; 
            delete ctx.horaStr; 
          }

          respuesta = result.respuesta;
          if (ctx.paso === 'completo') {
            delete agendaContext[sender];
            delete menuContext[sender];
          }
        }
        else if (agendaContext[sender]?.paso === 'gestion_citas') {
          console.log("➡️ Entrando en flujo gestion_citas");
          const ctx = agendaContext[sender];
          if (content.trim().toLowerCase() === 'modificar') {
            const listado = await modificar.listarCitasParaModificar(sender, pool);
            respuesta = listado.respuesta;
            ctx.paso = 'seleccion_cita';
            ctx.accion = 'modificar';
            ctx.citas = listado.citas;
          } else if (content.trim().toLowerCase() === 'cancelar') {
            const listado = await modificar.listarCitasParaModificar(sender, pool);
            respuesta = listado.respuesta;
            ctx.paso = 'seleccion_cita';
            ctx.accion = 'cancelar';
            ctx.citas = listado.citas;
          } else if (ctx.paso === 'seleccion_cita') {
            const idx = parseInt(content.trim(), 10) - 1;
            if (isNaN(idx) || idx < 0 || idx >= ctx.citas.length) {
              respuesta = "❌ Número inválido. Por favor selecciona una cita de la lista.";
            } else {
              const citaId = ctx.citas[idx].id;
              if (ctx.accion === 'cancelar') {
                respuesta = await modificar.cancelarCita(pool, citaId);
                delete agendaContext[sender];
              } else if (ctx.accion === 'modificar') {
                respuesta = "🔄 Por favor indícame la nueva fecha (DD/MM/AAAA) para tu cita.";
                ctx.paso = 'modificar_fecha';
                ctx.citaId = citaId;
              }
            }
          } else if (ctx.paso === 'modificar_fecha') {
            const v = Validators.fecha(content.trim());
            if (!v.ok) {
              respuesta = `❌ ${v.error}\nEjemplo: 11/12/2025`;
            } else {
              ctx.nuevaFecha = content.trim();
              respuesta = "⏰ Ahora indícame la nueva hora (HH:MM).";
              ctx.paso = 'modificar_hora';
            }
          } else if (ctx.paso === 'modificar_hora') {
            const v = Validators.hora(content.trim());
            if (!v.ok) {
              respuesta = `❌ ${v.error}\nEjemplo: 09:30`;
            } else {
              ctx.nuevaHora = content.trim();
              respuesta = await modificar.modificarCita(pool, ctx.citaId, ctx.nuevaFecha, ctx.nuevaHora);
              delete agendaContext[sender];
            }
          } else {
            // 👇 fallback específico para gestion_citas
            respuesta = "❌ Opción no válida en gestión de citas. Escribe 'modificar' o 'cancelar', o 'salir' para terminar.";
          }
        }
                else if (agendaContext[sender]?.paso === 'consultar_menu') { 
          console.log("➡️ Entrando en flujo consultar_menu");
          const v = Validators.menuOption(content.trim(), ['1','2']); 
          if (!v.ok) { 
            respuesta = v.error; 
          } else {
            if (v.value === '1') { 
              agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' }; 
              respuesta = await agenda.iniciarAgenda(); 
              if (!respuesta || respuesta.trim() === ""){
                respuesta = "📝 Vamos a agendar tu cita. Por favor dime tu nombre completo:";
              }
            } 
            if (v.value === '2') { 
              respuesta = "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
              delete agendaContext[sender];
              delete menuContext[sender]; 
            } 
          } 
        }

        // Menú principal
        else {
          console.log("➡️ Entrando en menú principal");
          if (!menuContext[sender]) {
            respuesta =
              `¡Hola ${pushName} 👋! Qué gusto saludarte nuevamente.\n\n` +
              "👉 ¿Qué deseas hacer hoy?\n\n" +
              "1️⃣ 📅 Agendar una cita\n" +
              "2️⃣ 📖 Revisar tus citas agendadas\n" +
              "3️⃣ ❓💡 Preguntar o consultar sobre nuestros servicios\n\n" +
              "✨ Tu sonrisa es nuestra prioridad 😁";
            menuContext[sender] = true;
          } else {
            const v = Validators.menuOption(content.trim(), ['1','2','3']);
            if (!v.ok) {
              respuesta = `❌ ${v.error}\n\n👉 Por favor responde con el número de la opción.`;
            } else {
              switch (v.value) {
                case '1':
                  agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
                  respuesta = await agenda.iniciarAgenda();
                  break;
                case '2':
                  const consulta = await consultar.consultarCitas(sender, pool); 
                  respuesta = consulta.respuesta; 
                  
                  if (consulta.citas.length > 0) {
                    agendaContext[sender] = { paso: 'gestion_citas', citas: consulta.citas }; 
                  } else { 
                    agendaContext[sender] = { paso: 'consultar_menu', citas: []}; 
                  } 
                  break;
                case '3':
                  respuesta = "💡 Puedes consultar nuestros servicios odontológicos. ¿Qué deseas saber?";
                  break;
              }
            }
          }
        }
      }

      // 👇 Fallback global 
      if (!respuesta || respuesta.trim() === "") { 
        console.error("⚠️ Flujo sin respuesta, aplicando fallback"); 
        respuesta = "⚠️ Hubo un error en el flujo. Escribe '1' para agendar una cita o '2' para salir."; 
      }

      // 👇 Enviar solo una vez
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
