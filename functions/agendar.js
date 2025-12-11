// functions/agendar.js
const { Validators, parseFechaStr } = require('./validators');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function formatFechaDia(fecha) {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const yyyy = fecha.getFullYear();
  const diaNombre = DIAS[fecha.getDay()];
  return `${diaNombre} ${dd}/${mm}/${yyyy}`;
}

function validarHorario(fecha, horaStr) {
  const m = horaStr.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const hh = Number(m[1]), mm = Number(m[2]);
  const minutos = hh * 60 + mm;
  const diaSemana = fecha.getDay();

  const turnoManana = (minutos >= 9 * 60 && minutos <= 11 * 60 + 30);
  const turnoTarde = (minutos >= 14 * 60 + 30 && minutos <= 19 * 60);

  if (diaSemana >= 1 && diaSemana <= 5) return turnoManana || turnoTarde;
  if (diaSemana === 6) return turnoManana;
  return false;
}

function horariosAtencionMensaje() {
  return (
    "📌 Nuestros horarios de atención:\n" +
    "• Lunes a Viernes: 09:00 a 11:30 y 14:30 a 19:00\n" +
    "• Sábados: 09:00 a 11:30\n" +
    "• Domingos: cerrado\n"
  );
}

module.exports = {
  iniciarAgenda: async () => {
    return "📝 ¡Empecemos a agendar tu cita!\n\n" +
           horariosAtencionMensaje() +
           "Por favor, dime tu nombre completo:";
  },

  procesarPaso: async (sender, pool, paso, dato, contexto) => {
    if (paso === 'nombre') {
      const v = Validators.nombre(dato);
      if (!v.ok) return { siguiente: 'nombre', respuesta: `❌ ${v.error}\nEjemplo: Juan Pérez` };
      contexto.nombre = v.value;
      return { siguiente: 'motivo', respuesta: `✅ Gracias ${contexto.nombre}. Ahora dime el motivo de tu consulta:` };
    }

    if (paso === 'motivo') {
      const v = Validators.motivo(dato);
      if (!v.ok) return { siguiente: 'motivo', respuesta: `❌ ${v.error}\nEjemplo: Consulta inicial` };
      contexto.motivo = v.value;
      return { siguiente: 'fecha_hora', respuesta: "🗓️ Perfecto. Indícame la fecha y hora en formato DD/MM/AAAA HH:MM\nEjemplo: 11/12/2025 09:30\n\n" + horariosAtencionMensaje() };
    }

    if (paso === 'fecha_hora') {
      const v = Validators.fechaHora(dato);
      if (!v.ok) return { siguiente: 'fecha_hora', respuesta: `❌ ${v.error}\nEjemplo: 11/12/2025 09:30\n\n` + horariosAtencionMensaje() };

      const { fechaStr, horaStr, fecha } = v.value;
      if (!validarHorario(fecha, horaStr)) {
        return { siguiente: 'fecha_hora', respuesta: "❌ Ese horario no está dentro de la atención.\n\n" + horariosAtencionMensaje() };
      }

      // Guardar paciente y cita
      let paciente = await pool.query('SELECT * FROM patients WHERE phone = $1', [sender]);
      let patientId;
      if (paciente.rowCount === 0) {
        const nuevo = await pool.query('INSERT INTO patients (name, phone) VALUES ($1, $2) RETURNING id', [contexto.nombre, sender]);
        patientId = nuevo.rows[0].id;
      } else {
        patientId = paciente.rows[0].id;
      }

      const ocupado = await pool.query('SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1', [fechaStr, horaStr]);
      if (ocupado.rowCount > 0) {
        return { siguiente: 'fecha_hora', respuesta: "⚠️ Ese horario ya está ocupado.\nPor favor elige otro dentro de los horarios permitidos." };
      }

      await pool.query(
        'INSERT INTO appointments (patient_id, date, time, reason, duration, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [patientId, fechaStr, horaStr, contexto.motivo, 30, 'pendiente']
      );

      return { siguiente: 'completo', respuesta: `🎉 Tu cita fue agendada para ${formatFechaDia(fecha)} a las ${horaStr}. Motivo: ${contexto.motivo}` };
    }

    return { siguiente: 'completo', respuesta: "❌ Flujo no reconocido. Escribe '1' para iniciar de nuevo." };
  }
};
