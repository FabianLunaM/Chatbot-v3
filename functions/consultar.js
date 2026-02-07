// functions/consultar.js
const { formatFechaDia } = require('./agendar');
const { Validators } = require('./validators');

module.exports = {
  consultarCitas: async (sender, pool, input = null) => {
    const result = await pool.query(
      `SELECT a.id AS appointment_id, a.date, a.time, a.reason, a.status 
       FROM appointments a 
       JOIN patients p ON a.patient_id = p.id 
       WHERE p.phone = $1 
       AND a.status NOT IN ('cancelada','completada')
       ORDER BY a.date, a.time`,
      [sender]
    );

    // Filtrar citas futuras (>= hoy)
    const hoy = new Date();
    const citasFuturas = result.rows.filter(row => {
      try {
        const [dd, mm, yyyy] = row.date.split('/');
        const fechaObj = new Date(yyyy, mm - 1, dd);
        return fechaObj >= hoy;
      } catch (err) {
        console.error("❌ Error parseando fecha:", row.date, err);
        return false;
      }
    });

    let respuesta;

    // Si no hay citas activas
    if (citasFuturas.length === 0) {
      respuesta = "📭 No tienes citas activas registradas en nuestro sistema.\n\n" +
                  "👉 Opciones disponibles:\n" +
                  "1️⃣ 📅 Agendar una cita\n" +
                  "2️⃣ ❌ Salir del chat";

      // Procesar input después de mostrar el mensaje
      if (input) {
        const v = Validators.consultarOption(input.trim());
        if (!v.ok) {
          return { respuesta: v.error, citas: [] };
        }
        if (v.value === '1') {
          return { respuesta: "📅 Perfecto, iniciemos el proceso para agendar tu cita.", citas: [] };
        }
        if (v.value === '2') {
          return { respuesta: "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!", citas: [] };
        }
      }

      return { respuesta, citas: [] };
    }

    // Si hay citas activas
    respuesta = "📅 Estas son tus citas activas:\n\n";
    citasFuturas.forEach((row, idx) => {
      const [dd, mm, yyyy] = row.date.split('/');
      const fechaObj = new Date(yyyy, mm - 1, dd);
      respuesta += `${idx + 1}. ${formatFechaDia(fechaObj)} a las ${row.time}\n   Motivo: ${row.reason}\n   Estado: ${row.status}\n\n`;
    });

    respuesta += "👉 ¿Deseas modificar o cancelar alguna cita? Responde con 'modificar' o 'cancelar'.\n\n" +
                 "O si prefieres:\n" +
                 "1️⃣ 📅 Agendar una nueva cita\n" +
                 "2️⃣ ❌ Salir del chat";

    // Procesar input después de mostrar las citas
    if (input) {
      const v = Validators.consultarOption(input.trim());
      if (!v.ok) {
        return { respuesta: v.error, citas: citasFuturas };
      }
      if (v.value === '1') {
        return { respuesta: "📅 Perfecto, iniciemos el proceso para agendar tu cita.", citas: citasFuturas };
      }
      if (v.value === '2') {
        return { respuesta: "👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!", citas: citasFuturas };
      }
    }

    return { respuesta, citas: citasFuturas };
  }
};
