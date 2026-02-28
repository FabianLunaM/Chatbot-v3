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

const app = express();
app.use(cors());
app.use(express.json());

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function enviarMensaje(sender, texto) {
  if (!texto || texto.trim() === "") return;
  await sleep(5000);
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

const agendaContext = {}; 
const menuContext = {};   
const chatTimeouts = {}; 

function iniciarTimeout(sender) {
  if (chatTimeouts[sender]) clearTimeout(chatTimeouts[sender]);
  chatTimeouts[sender] = setTimeout(async () => {
    delete agendaContext[sender];
    delete menuContext[sender];
    delete chatTimeouts[sender];
    await enviarMensaje(sender, "⏰ El chat se ha cerrado automáticamente por inactividad. Gracias por conversar con Amalgama.");
  }, 300000);
}

app.get('/', (req, res) => res.send('Ok'));

app.post('/webhook', async (req, res) => {
  let sender, content, pushName;
  if (req.body.event === 'messages.received' && req.body.data?.messages) {
    const msg = req.body.data.messages;
    sender = msg.remoteJid;
    content = msg.messageBody;
    pushName = msg.pushName || '';
  }

  let respuesta;
  try {
    if (content && sender) {
      console.log(`📩 Mensaje recibido de ${sender}: ${content}`);

      // 👉 Insertar interacción en la BD 
      try { await pool.query( 
         'INSERT INTO interactions (message_in, sender, pushname, created_at) VALUES ($1, $2, $3, NOW())', 
         [content, sender, pushName] 
        ); 
        console.log(`🗄️ Interacción guardada en BD: mensaje="${content}", sender="${sender}", pushName="${pushName}"`); 
       } catch (err) { 
       console.error("❌ Error insertando interacción en BD:", err.message); 
      }
     
      const check = await pool.query('SELECT COUNT(*) FROM interactions WHERE sender = $1',[sender]);
      const count = parseInt(check.rows[0].count, 10);

      if (count === 1) {
        respuesta = mostrarMenuPrincipal(pushName);
        menuContext[sender] = true;
      } else {
        // --- Flujo de selección de cita ---
        if (agendaContext[sender]?.paso === 'seleccion_cita') {
          console.log("➡️ Entrando en flujo seleccion_cita");
          const ctx = agendaContext[sender];
          const totalOpciones = ctx.citas.length + 2;
          const opcionesValidas = Array.from({length: totalOpciones}, (_, i) => String(i+1));
          const v = Validators.menuOption(content.trim(), opcionesValidas);
          if (!v.ok) respuesta = `❌ ${v.error}\n\n👉 Responde con un número entre 1 y ${totalOpciones}.`;
          else {
            const opcion = parseInt(v.value, 10);
            if (opcion <= ctx.citas.length) {
              const citaId = ctx.citas[opcion - 1].id;
              agendaContext[sender].citaId = citaId;
              if (ctx.accion === 'cancelar') {
                const cita = ctx.citas[opcion - 1];
                respuesta = cancelar.pedirConfirmacionCancelacion(new Date(cita.date), cita.time);
                agendaContext[sender].paso = 'confirmacion';
                agendaContext[sender].accion = 'cancelar';
              } else if (ctx.accion === 'modificar') {
                respuesta = modificar.pedirNuevaFecha();
                agendaContext[sender].paso = 'modificar_fecha';
                agendaContext[sender].accion = 'modificar';
              }
            } else if (opcion === ctx.citas.length + 1) {
              respuesta = mostrarMenuPrincipal(pushName);
              delete agendaContext[sender];
              menuContext[sender] = true;
            } else {
              respuesta = "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
              delete agendaContext[sender];
              delete menuContext[sender];
            }
          }
        } 
        // --- Flujo de modificar ---
        else if (agendaContext[sender]?.paso === 'modificar_fecha') {
          console.log("➡️ Entrando en flujo modificar_fecha");
          const v = modificar.validarNuevaFecha(content.trim());
          if (v.error) respuesta = v.error;
          else {
            agendaContext[sender].nuevaFechaObj = v.fechaObj;
            const horarios = await modificar.pedirNuevaHora(pool, v.fechaObj);
            if (horarios.error) respuesta = horarios.error;
            else {
              agendaContext[sender].paso = 'modificar_hora';
              agendaContext[sender].disponibles = horarios.disponibles;
              respuesta = horarios.mensaje;
            }
          }
        } else if (agendaContext[sender]?.paso === 'modificar_hora') {
          console.log("➡️ Entrando en flujo modificar_hora");
          const opcionesValidas = agendaContext[sender].disponibles.map((_, idx) => String(idx+1));
          const v = Validators.menuOption(content.trim(), opcionesValidas);
          if (!v.ok) respuesta = `❌ ${v.error}\n\n👉 Responde con un número válido.`;
          else {
            const idx = parseInt(v.value, 10) - 1;
            agendaContext[sender].nuevaHora = agendaContext[sender].disponibles[idx];
            respuesta = modificar.pedirConfirmacionModificacion(agendaContext[sender].nuevaFechaObj, agendaContext[sender].nuevaHora);
            agendaContext[sender].paso = 'confirmacion';
            agendaContext[sender].accion = 'modificar';
          }
        // --- Flujo de agendar cita ---
        } else if (agendaContext[sender]?.paso && ['nombre','telefono','motivo','fecha','hora','confirmacion'].includes(agendaContext[sender].paso)) {
          console.log(`➡️ Entrando en flujo agendar: paso ${agendaContext[sender].paso}`);
          const resultado = await agenda.procesarPaso(sender, pool, agendaContext[sender].paso, content.trim(), agendaContext[sender]);

          respuesta = resultado?.respuesta || "⚠️ Error: no se generó respuesta en agendar.";
          agendaContext[sender].paso = resultado?.siguiente;

          if (resultado?.siguiente === 'completo') {
            delete agendaContext[sender];
            delete menuContext[sender];
            // ❌ No concatenes nada aquí, la respuesta ya está lista desde agendar.js
          }
        // --- Confirmacion ---
        } else if (agendaContext[sender]?.paso === 'confirmacion') {
          console.log("➡️ Entrando en flujo confirmacion");
          const v = Validators.menuOption(content.trim(), ['1','2']);
          if (!v.ok) respuesta = `❌ ${v.error}\n\n👉 Responde con 1 (Sí) o 2 (No).`;
          else {
            if (v.value === '1') {
              if (agendaContext[sender].accion === 'cancelar') {
                respuesta = await cancelar.aplicarCancelacion(pool, agendaContext[sender].citaId);
              } else if (agendaContext[sender].accion === 'modificar') {
                respuesta = await modificar.aplicarModificacion(pool, agendaContext[sender].citaId, agendaContext[sender].nuevaFechaObj, agendaContext[sender].nuevaHora);
              }
              respuesta += "\n\n👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
              delete agendaContext[sender];
              delete menuContext[sender];
            } else {
              respuesta = mostrarMenuPrincipal(pushName);
              delete agendaContext[sender];
              menuContext[sender] = true;
            }
          }
        } 
       
        // --- Flujo de consultar_menu ---
        else if (agendaContext[sender]?.paso === 'consultar_menu') {
        console.log("➡️ Entrando en flujo consultar_menu");
        const ctx = agendaContext[sender];
        const v = Validators.menuOption(content.trim(), ['1','2','3','4','5']);
        if (!v.ok) {
          respuesta = `❌ ${v.error}\n\n👉 Responde con un número válido.`;
        } else {
          switch (v.value) {
            case '1': // Modificar cita
              const mod = await modificar.listarCitasParaModificar(sender, pool);
              respuesta = mod.respuesta;
              agendaContext[sender] = { paso: 'seleccion_cita', citas: mod.citas, accion: 'modificar' };
              break;
            case '2': // Cancelar cita
              const canc = await cancelar.listarCitasParaCancelar(sender, pool);
              respuesta = canc.respuesta;
              agendaContext[sender] = { paso: 'seleccion_cita', citas: canc.citas, accion: 'cancelar' };
              break;
            case '3': // Agendar nueva cita
              agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
              respuesta = await agenda.iniciarAgenda();
              break;
            case '4': // Regresar al menú principal
              respuesta = mostrarMenuPrincipal(pushName);
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
        // --- Menú principal ---
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
                  console.log("➡️ Usuario eligió agendar cita");
                  
                  // 👉 Verificar si el paciente ya tiene 3 citas pendientes 
                  const paciente = await pool.query('SELECT * FROM patients WHERE sender = $1', [sender]); 
                  if (paciente.rowCount > 0) { 
                    const patientId = paciente.rows[0].id; 
                    const citasActivas = await pool.query( 
                      'SELECT COUNT(*) FROM appointments WHERE patient_id = $1 AND status = $2', 
                      [patientId, 'pendiente'] 
                    ); 
                    
                    if (parseInt(citasActivas.rows[0].count, 10) >= 3) { 
                      respuesta = "❌ Ya tienes 3 citas activas registradas. No puedes agendar más hasta que alguna se complete o se cancele.\n\n👋 Te Regresamos al menu principal..."; 
                      
                      // Enviar segundo mensaje con menú principal 
                      await enviarMensaje(sender, mostrarMenuPrincipal(pushName)); 
                      
                      // No iniciar flujo de agendar
                      break; 
                    }
                  }

                  agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
                  respuesta = await agenda.iniciarAgenda();
                  break;
                case '2':
                  console.log("➡️ Usuario eligió consultar citas");
                  const consulta = await consultar.consultarCitas(sender, pool); 
                  respuesta = consulta.respuesta; 
                  agendaContext[sender] = { paso: 'consultar_menu', citas: consulta.citas };
                  break;
                case '3':
                  console.log("➡️ Usuario eligió consultar servicios");
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
      } else if (chatTimeouts[sender]) {
        clearTimeout(chatTimeouts[sender]);
        delete chatTimeouts[sender];
      }

      await enviarMensaje(sender, respuesta);
    }
  } catch (err) {
    console.error('❌ Error en webhook:', err);
  }

  res.send('ok');
});

// --- Configuración del servidor ---
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
