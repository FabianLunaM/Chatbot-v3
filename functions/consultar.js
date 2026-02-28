// functions/consultar.js
const { formatFechaDia } = require('./agendar');

module.exports = {
  consultarCitas: async (sender, pool) => {
    // 1️⃣ Actualizar automáticamente las citas vencidas a 'completada'
    await pool.query(
      `UPDATE appointments 
       SET status = 'completada' 
       WHERE date < CURRENT_DATE 
       AND status = 'pendiente'`
    );

    // 2️⃣ Consultar solo citas activas
    const result = await pool.query(
      `SELECT a.id AS appointment_id, a.date, a.time, a.reason, a.status 
       FROM appointments a 
       JOIN patients p ON a.patient_id = p.id 
       WHERE p.sender = $1 
       AND a.status = 'pendiente'
       ORDER BY a.date, a.time`,
      [sender]
    );

    // 3️⃣ Filtrar citas futuras (>= hoy)
    const hoy = new Date();
    hoy.setHours(0,0,0,0); // normalizar a inicio de día
    
    const citasActivas = result.rows.filter(row => {
      try {
        const fechaObj = new Date(row.date);
        fechaObj.setHours(0,0,0,0);
        return fechaObj >= hoy;
      } catch (err) {
        console.error("❌ Error parseando fecha:", row.date, err);
        return false;
      }
    });

    // 4️⃣ Si no hay citas activas
    if (citasActivas.length === 0) {
      return { 
        respuesta: "📭 No tienes citas activas registradas en nuestro sistema.\n\n" +
                   "👉 Opciones disponibles:\n" +
                   "1️⃣ 📅 Agendar una cita\n" +
                   "2️⃣ ❌ Salir del chat", 
        citas: [] 
      };
    }

    // 5️⃣ Construir respuesta con citas activas
    let respuesta = "📅 Estas son tus citas activas:\n\n";
    citasActivas.forEach((row, idx) => {
      const fechaObj = new Date(row.date);
      respuesta += `${idx + 1}. ${formatFechaDia(fechaObj)} a las ${row.time}\n   Motivo: ${row.reason}\n   Estado: ${row.status}\n\n`;
    });

    respuesta += "👉 ¿Deseas modificar o cancelar alguna cita?\n\n" +
                 "1️⃣ ✏️ Modificar una cita\n" + 
                 "2️⃣ ❌ Cancelar una cita\n" + 
                 "3️⃣ 📅 Agendar una nueva cita\n" + 
                 "4️⃣ 🔙 Salir al menú principal";

    return { respuesta, citas: citasActivas };
  }
};
