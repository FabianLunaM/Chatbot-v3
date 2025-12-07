// functions/agendar.js
module.exports = {
  iniciarAgenda: async (sender) => {
    // Primer paso del flujo: pedir fecha y hora
    return "📅 Para agendar tu cita necesito que me indiques:\n\n- Fecha (DD/MM/AAAA)\n- Hora (HH:MM)";
  },

  guardarCita: async (sender, fecha, hora, pool) => {
    try {
      await pool.query(
        'INSERT INTO citas (sender, fecha, hora) VALUES ($1, $2, $3)',
        [sender, fecha, hora]
      );
      return `✅ Tu cita fue agendada para el ${fecha} a las ${hora}. ¡Te esperamos!`;
    } catch (err) {
      console.error('❌ Error guardando cita:', err);
      return "Hubo un problema al agendar tu cita. Intenta nuevamente.";
    }
  }
};
