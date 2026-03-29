// functions/preguntas.js
const dialogflow = require('dialogflow');

// Parsear credenciales desde variable de entorno en Railway
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

const sessionClient = new dialogflow.SessionsClient({
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key,
  },
  projectId: credentials.project_id,
});

const projectId = process.env.DIALOGFLOW_PROJECT_ID;

/**
 * Consulta a Dialogflow con el texto del paciente
 * @param {string} sender - ID único del usuario (ej: número de WhatsApp)
 * @param {string} pregunta - Texto de la consulta
 * @returns {Promise<string>} - Respuesta de Dialogflow
 */
async function consultarDialogflow(sender, pregunta) {
  const sessionPath = sessionClient.sessionPath(projectId, sender);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: pregunta,
        languageCode: 'es',
      },
    },
  };

  const responses = await sessionClient.detectIntent(request);
  const result = responses[0].queryResult;

  return result.fulfillmentText || "⚠️ No entendí tu consulta, ¿puedes reformularla?";
}

module.exports = { consultarDialogflow };
