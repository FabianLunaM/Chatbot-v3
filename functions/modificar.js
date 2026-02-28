// functions/modificar.js
const { formatFechaDia, generarHorariosDia } = require('./agendar');
const { Validators } = require('./validators');

module.exports = {
  listarCitasParaModificar: async (sender, pool) => {
    const result = await pool.query(
      `SELECT a.id, a.date, a.time, a.reason, a.status
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE p.sender = $1 AND a.status = 'pendiente'
       ORDER BY a.date, a.time`,
      [sender]
    );

    if (result.rowCount === 0) {
      return { respuesta: "📭 No tienes citas activas para modificar.", citas: [] };
    }

    let respuesta = "✏️ Estas son tus citas activas:\n\n";
    result.rows.forEach((row, idx) => {
      const fechaObj = new Date(row.date);
      respuesta += `${idx + 1}. ${formatFechaDia(fechaObj)} a las ${row.time}\n   Motivo: ${row.reason}\n\n`;
    });

    respuesta += "👉 Responde con el número de la cita que deseas modificar.\n" +
                 "O escribe '0' para volver al menú principal.";

    return { respuesta, citas: result.rows };
  },

  pedirNuevaFecha: () => {
    return "🗓️ Por favor indícame la nueva fecha (DD/MM/AAAA) para tu cita.";
  },

  validarNuevaFecha: (dato) => {
    const v = Validators.fecha(dato); // ✅ aplica todas las restricciones unificadas
    if (!v.ok) {
      return { error: `❌ ${v.error}\nEjemplo: 11/12/2026` };
    }
    return { fechaObj: v.value };
  },

  pedirNuevaHora: async (pool, fechaObj) => {
    const horariosDia = generarHorariosDia(fechaObj);
    const disponibles = [];
    for (let h of horariosDia) {
      const result = await pool.query(
        'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 AND status = $3',
        [fechaObj, h, 'pendiente']
      );
      if (result.rowCount === 0) disponibles.push(h);
    }

    if (disponibles.length === 0) {
      return { error: "❌ No hay horarios disponibles en esa fecha. Por favor elige otra." };
    }

    const lista = disponibles.map((h, idx) => `${idx+1}️⃣ ${h}`).join("\n");
    return {
      disponibles,
      mensaje: `⏰ Estos son los horarios disponibles para *${formatFechaDia(fechaObj)}*:\n\n${lista}\n\n👉 Responde con el número de la opción.`
    };
  },

  modificarCita: async (pool, citaId, nuevaFechaObj, nuevaHoraStr) => {
    await pool.query(
      'UPDATE appointments SET date = $1, time = $2 WHERE id = $3',
      [nuevaFechaObj, nuevaHoraStr, citaId]
    );

    return `✅ La cita ha sido reprogramada para el día ${formatFechaDia(nuevaFechaObj)} a las ${nuevaHoraStr}.`;
  }
};
