// functions/consultar.js
const { formatFechaDia } = require('./agendar');

module.exports = {
  consultarCitas: async (sender, pool) => {

    const result = await pool.query(
      `SELECT a.id AS appointment_id, a.date, a.time, a.reason, a.status 
       FROM appointments a 
       JOIN patients p ON a.patient_id = p.id 
       WHERE p.sender = $1 
       AND a.status NOT IN ('cancelada','completada')
       ORDER BY a.date, a.time`,
      [sender]
    );

    
    // Filtrar citas futuras (>= hoy)
    const hoy = new Date();
    hoy.setHours(0,0,0,0); // normalizar a inicio de dia
    
    const citasFuturas = result.rows.filter(row => {
      try {
        const fechaObj = new Date(row.date); // row.date ya es Date/ISO
        fechaObj.setHours(0,0,0,0);

        return fechaObj >= hoy;
      } catch (err) {
        console.error("❌ Error parseando fecha:", row.date, err);
        return false;
      }
    });

    if (citasFuturas.length === 0) {
      return { 
        respuesta: "📭 No tienes citas activas registradas en nuestro sistema.\n\n" +
                   "👉 Opciones disponibles:\n" +
                   "1️⃣ 📅 Agendar una cita\n" +
                   "2️⃣ ❌ Salir del chat", 
        citas: [] 
      };
    }

    let respuesta = "📅 Estas son tus citas activas:\n\n";
    citasFuturas.forEach((row, idx) => {
      const fechaObj = new Date(row.date); // convertir fecha desde BD
      respuesta += `${idx + 1}. ${formatFechaDia(fechaObj)} a las ${row.time}\n   Motivo: ${row.reason}\n   Estado: ${row.status}\n\n`;
    });

    respuesta += "👉 ¿Deseas modificar o cancelar alguna cita? Responde con 'modificar' o 'cancelar'.\n\n" +
                 "Si prefieres:\n" +
                 "1️⃣ 📅 Agendar una nueva cita\n" +
                 "2️⃣ ❌ Salir del chat";

    return { respuesta, citas: citasFuturas };
  }
};
