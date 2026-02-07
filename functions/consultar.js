// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { Validators } = require('./functions/validators');
const consultar = require('./functions/consultar');
const agendar = require('./functions/agendar');

const app = express();
app.use(bodyParser.json());

let agendaContext = {};
let menuContext = {};

app.post('/webhook', async (req, res) => {
  const body = req.body;
  const sender = body.data.messages.remoteJid;
  const content = body.data.messages.messageBody.trim();
  let respuesta = "";

  try {
    // Menú principal
    if (!agendaContext[sender]) {
      switch (content) {
        case '1':
          agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
          respuesta = "📅 Perfecto, iniciemos el proceso para agendar tu cita.";
          break;

        case '2':
          // Entrar al flujo de consultar citas
          const consulta = await consultar.consultarCitas(sender, pool); // 👈 sin content
          respuesta = consulta.respuesta;

          // Guardar contexto para saber que estamos en el submenú de consultar
          agendaContext[sender] = { paso: 'consultar_menu', citas: consulta.citas };
          break;

        case '3':
          respuesta = "ℹ️ Información general de Amalgama...";
          break;

        default:
          respuesta = "❌ Opción inválida. Por favor selecciona 1, 2 o 3.";
      }
    }

    // Submenú de consultar
    else if (agendaContext[sender]?.paso === 'consultar_menu') {
      const v = Validators.menuOption(content.trim(), ['1','2']);
      if (!v.ok) {
        respuesta = v.error;
      } else {
        if (v.value === '1') {
          agendaContext[sender] = { paso: 'nombre', nombre: '', motivo: '' };
          respuesta = "📅 Perfecto, iniciemos el proceso para agendar tu cita.";
        }
        if (v.value === '2') {
          respuesta = "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!";
          delete agendaContext[sender];
          delete menuContext[sender];
        }
      }
    }

    // Otros pasos de agenda (ejemplo: nombre, motivo, etc.)
    else if (agendaContext[sender]?.paso === 'nombre') {
      const v = Validators.nombre(content);
      if (!v.ok) {
        respuesta = v.error;
      } else {
        agendaContext[sender].nombre = v.value;
        agendaContext[sender].paso = 'motivo';
        respuesta = "✍️ Por favor escribe el motivo de tu cita.";
      }
    }

    else if (agendaContext[sender]?.paso === 'motivo') {
      const v = Validators.motivo(content);
      if (!v.ok) {
        respuesta = v.error;
      } else {
        agendaContext[sender].motivo = v.value;
        agendaContext[sender].paso = 'fecha';
        respuesta = "📅 Ingresa la fecha de tu cita en formato DD/MM/AAAA.";
      }
    }

    // ... resto de pasos (fecha, hora, confirmación, etc.)

    // Enviar respuesta
    res.json({ respuesta });

  } catch (err) {
    console.error("❌ Error en webhook:", err);
    res.json({ respuesta: "⚠️ Ocurrió un error, intenta nuevamente." });
  }
});

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000");
});
