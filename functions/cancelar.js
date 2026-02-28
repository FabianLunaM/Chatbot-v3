// functions/cancelar.js
const { formatFechaDia } = require('./agendar');

function numeroEmoji(n) { 
  const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣']; 
  return emojis[n-1] || `${n}️⃣`; 
}

module.exports = {
  listarCitasParaCancelar: async (sender, pool) => {
    const result = await pool.query(
      `SELECT a.id, a.date, a.time, a.reason, a.status
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       WHERE p.sender = $1 AND a.status = 'pendiente'
       ORDER BY a.date, a.time
       LIMIT 3`, // máximo 3 citas
      [sender]
    );

    if (result.rowCount === 0) {
      return { respuesta: "📭 No tienes citas activas para cancelar.", citas: [] };
    }

    let respuesta = "❌ Estas son tus citas activas:\n\n";
    result.rows.forEach((row, idx) => {
      const fechaObj = new Date(row.date);
      respuesta += `${numeroEmoji(idx + 1)} ${formatFechaDia(fechaObj)} a las ${row.time}\n Motivo: ${row.reason}\n\n`;
    });

    // Opciones adicionales
    const regresarNum = result.rows.length + 1;
    const salirNum = result.rows.length + 2;

    respuesta += `${regresarNum}️⃣ 🔙 Regresar al menú principal\n`;
    respuesta += `${salirNum}️⃣ ❌ Finalizar la conversación`;

    return { respuesta, citas: result.rows };
  },

  cancelarCita: async (pool, citaId) => {
    await pool.query(
      'UPDATE appointments SET status = $1 WHERE id = $2',
      ['cancelada', citaId]
    );
    return "✅ La cita seleccionada ha sido cancelada correctamente.\n\n👋 Has vuelto al menú principal.";
  }
};
