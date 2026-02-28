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
const chatTimeouts = {}; // 👈 Nuevo: manejar temporizadores

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

// 👇 Función centralizada para mostrar el menú principal
function obtenerMenuPrincipal(pushName = "") {
  return (
    `¡Hola ${pushName} 👋! Qué gusto saludarte nuevamente.\n\n` +
    "👉 ¿Qué deseas hacer hoy?\n\n" +
    "1️⃣ 📅 Agendar una cita\n" +
    "2️⃣ 📖 Revisar tus citas agendadas\n" +
    "3️⃣ ❓💡 Preguntar o consultar sobre nuestros servicios\n\n" +
    "✨ Tu sonrisa es nuestra prioridad 😁"
  );
}

// 👇 Función para construir menú de citas con formato uniforme
function construirMenuCitas(citas) {
  let mensaje = "👉 Selecciona la cita que deseas gestionar:\n\n";
  citas.forEach((cita, index) => {
    mensaje += `${index + 1}️⃣ 📅 ${cita.fecha} a las ${cita.hora} - ${cita.motivo}\n`;
  });
  mensaje += "\n4️⃣ 🔙 Regresar al menú principal\n";
  mensaje += "5️⃣ 🚪 Finalizar la conversación";
  return mensaje;
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
        // --- Flujo de agenda y gestión de citas ---
        if (agendaContext[sender]?.paso === 'seleccion_cita') {
          const ctx = agendaContext[sender];
          const v = Validators.menuOption(
            content.trim(),
            [...Array(ctx.citas.length).keys()].map(i => (i+1).toString()).concat(['4','5'])
          );

          if (!v.ok) {
            respuesta = `❌ ${v.error}\n\n👉 Selecciona una cita con su número, o usa 4 para regresar al menú principal, o 5 para finalizar la conversación.`;
          } else {
            switch (v.value) {
              case '4':
                respuesta = obtenerMenuPrincipal(pushName);
                menuContext[sender] = true;
                delete agendaContext[sender];
                break;
              case '5':
                respuesta = "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
                delete agendaContext[sender];
                delete menuContext[sender];
                break;
              default:
                const idx = parseInt(v.value, 10) - 1;
                const citaSeleccionada = ctx.citas[idx];
                if (ctx.accion === 'cancelar') {
                  respuesta = await modificar.cancelarCita(pool, citaSeleccionada.id);
                  delete agendaContext[sender];
                } else if (ctx.accion === 'modificar') {
                  respuesta = "🔄 Por favor indícame la nueva fecha (DD/MM/AAAA) para tu cita.";
                  ctx.paso = 'modificar_fecha';
                  ctx.citaId = citaSeleccionada.id;
                }
                break;
            }
          }
        }
                // --- Flujo consultar_menu ---
        else if (agendaContext[sender]?.paso === 'consultar_menu') {
          console.log("➡️ Entrando en flujo consultar_menu");
          const v = Validators.menuOption(content.trim(), ['1','2','3','4','5']); 
          if (!v.ok) { 
            respuesta = `❌ ${v.error}\n\n👉 Responde con 1, 2, 3, 4 o 5.`; 
          } else {
            switch (v.value) {
              case '1': // Modificar cita
                const listadoMod = await modificar.listarCitasParaModificar(sender, pool);
                respuesta = construirMenuCitas(listadoMod.citas);
                agendaContext[sender].paso = 'seleccion_cita';
                agendaContext[sender].accion = 'modificar';
                agendaContext[sender].citas = listadoMod.citas;
                break;

              case '2': // Cancelar cita
                const listadoCanc = await modificar.listarCitasParaModificar(sender, pool);
                respuesta = construirMenuCitas(listadoCanc.citas);
                agendaContext[sender].paso = 'seleccion_cita';
                agendaContext[sender].accion = 'cancelar';
                agendaContext[sender].citas = listadoCanc.citas;
                break;

              case '3': // Agendar nueva cita
                agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
                respuesta = await agenda.iniciarAgenda();
                if (!respuesta || respuesta.trim() === ""){
                  respuesta = "📝 Vamos a agendar tu cita. Por favor dime tu nombre completo:";
                }
                break;

              case '4': // Regresar al menú principal
                respuesta = obtenerMenuPrincipal(pushName);
                menuContext[sender] = true;
                delete agendaContext[sender];
                break;

              case '5': // Finalizar conversación
                respuesta = "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
                delete agendaContext[sender];
                delete menuContext[sender]; 
                break;
            }
          }
        }

        // --- Flujo menú principal ---
        else {
          console.log("➡️ Entrando en menú principal");
          if (!menuContext[sender]) {
            respuesta = obtenerMenuPrincipal(pushName);
            menuContext[sender] = true;
          } else {
            const v = Validators.menuOption(content.trim(), ['1','2','3']);
            if (!v.ok) {
              respuesta = `❌ ${v.error}\n\n👉 Por favor responde con el número de la opción.`;
            } else {
              switch (v.value) {
                case '1':
                  // Validar citas pendientes antes de iniciar agenda 
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
                  // Si no tiene 3 pendientes, iniciar flujo normal
                  agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
                  respuesta = await agenda.iniciarAgenda();
                  break;

                case '2':
                  const consulta = await consultar.consultarCitas(sender, pool); 
                  respuesta = construirMenuCitas(consulta.citas);
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

      // 👇 Fallback global 
      if (!respuesta || respuesta.trim() === "") { 
        console.error("⚠️ Flujo sin respuesta, aplicando fallback"); 
        respuesta = "⚠️ Hubo un error en el flujo. Escribe '1' para agendar una cita o '2' para salir."; 
      }

      // Reiniciar temporizador de inactividad SOLO si el chat sigue activo
      if (agendaContext[sender] || menuContext[sender]) {
        iniciarTimeout(sender);
      } else {
        // Si el flujo terminó, limpiar cualquier timeout pendiente
        if (chatTimeouts[sender]) {
          clearTimeout(chatTimeouts[sender]);
          delete chatTimeouts[sender];
        }
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
