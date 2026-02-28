// functions/modificar.js
const { formatFechaDia } = require('./agendar');
const { Validators, parseFechaStr } = require('./validators');

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

  modificarCita: async (pool, citaId, nuevaFecha, nuevaHora) => {
    const fechaObj = parseFechaStr(nuevaFecha);
    if (!fechaObj) return "❌ La fecha no es válida. Usa el formato DD/MM/AAAA.";

    // Validar que el horario no esté ocupado
    const ocupado = await pool.query(
      'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 AND status = $3',
      [fechaObj, nuevaHora, 'pendiente']
    );
    if (ocupado.rowCount > 0) {
      return "⚠️ Ese horario ya está ocupado. Por favor selecciona otro.";
    }

    await pool.query(
      'UPDATE appointments SET date = $1, time = $2 WHERE id = $3',
      [fechaObj, nuevaHora, citaId]
    );

    return `✅ La cita ha sido reprogramada para el día ${nuevaFecha} a las ${nuevaHora}.`;
  }
};
