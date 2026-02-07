// functions/modificar.js
const { formatFechaDia } = require('./agendar');

module.exports = {
  listarCitasParaModificar: async (sender, pool) => {
    const result = await pool.query(
      'SELECT id, date, time, reason, status FROM appointments a JOIN patients p ON a.patient_id = p.id WHERE p.phone = $1 AND status != $2 ORDER BY date, time',
      [sender, 'cancelada']
    );

    if (result.rowCount === 0) {
      return "📭 No tienes citas activas para modificar o cancelar.";
    }

    let respuesta = "📅 Estas son tus citas activas:\n\n";
    result.rows.forEach((row, idx) => {
      const fechaParts = row.date.split('/');
      const fechaObj = new Date(fechaParts[2], fechaParts[1] - 1, fechaParts[0]);
      respuesta += `${idx + 1}. ${formatFechaDia(fechaObj)} a las ${row.time}\n   Motivo: ${row.reason}\n   Estado: ${row.status}\n\n`;
    });

    respuesta += "👉 Responde con el número de la cita que deseas modificar o cancelar.";
    return { respuesta, citas: result.rows };
  },

  cancelarCita: async (pool, citaId) => {
    await pool.query('UPDATE appointments SET status = $1 WHERE id = $2', ['cancelada', citaId]);
    return "❌ Tu cita ha sido cancelada correctamente.";
  },

  modificarCita: async (pool, citaId, nuevaFecha, nuevaHora) => {
    await pool.query(
      'UPDATE appointments SET date = $1, time = $2 WHERE id = $3',
      [nuevaFecha, nuevaHora, citaId]
    );
    return `🔄 Tu cita ha sido reprogramada para ${nuevaFecha} a las ${nuevaHora}.`;
  }
};
