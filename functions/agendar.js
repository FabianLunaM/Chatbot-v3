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
    "📌 Nuestros horarios de atención:\n\n" +
    "• Lunes a Viernes: 09:00 a 11:30 y 14:30 a 19:00\n" +
    "• Sábados: 09:00 a 11:30\n" +
    "• Domingos: cerrado\n\n"
  );
}

module.exports = {
  iniciarAgenda: async () => {
    return "📝 ¡Empecemos a agendar tu cita!\n\n" +
           horariosAtencionMensaje() +
           "Por favor, dime tu nombre completo:";
  },

  procesarPaso: async (sender, pool, paso, dato, contexto) => {

    // ------------------------------
    // 1. NOMBRE
    // ------------------------------
    if (paso === 'nombre') {
      const v = Validators.nombre(dato);
      if (!v.ok)
        return { siguiente: 'nombre', respuesta: `❌ ${v.error}\nEjemplo: Juan Pérez` };

      contexto.nombre = v.value;
      return {
        siguiente: 'motivo',
        respuesta: `✅ Gracias ${contexto.nombre}. Ahora dime el motivo de tu consulta:`
      };
    }

    // ------------------------------
    // 2. MOTIVO
    // ------------------------------
    if (paso === 'motivo') {
      const v = Validators.motivo(dato);
      if (!v.ok)
        return { siguiente: 'motivo', respuesta: `❌ ${v.error}\nEjemplo: Consulta inicial` };

      contexto.motivo = v.value;
      return {
        siguiente: 'fecha',
        respuesta: "🗓️ Perfecto. ¿Qué fecha deseas para tu cita?\nFormato: DD/MM/AAAA\nEjemplo: 11/12/2025"
      };
    }

    // ------------------------------
    // 3. FECHA
    // ------------------------------
    if (paso === 'fecha') {
      const v = Validators.fecha(dato);
      if (!v.ok)
        return { siguiente: 'fecha', respuesta: `❌ ${v.error}\nEjemplo: 11/12/2025` };

      contexto.fecha = v.value;
      contexto.fechaStr =
        `${String(contexto.fecha.getDate()).padStart(2, '0')}/` +
        `${String(contexto.fecha.getMonth() + 1).padStart(2, '0')}/` +
        `${contexto.fecha.getFullYear()}`;

      return {
        siguiente: 'hora',
        respuesta:
          `📅 Excelente. La fecha seleccionada es *${formatFechaDia(contexto.fecha)}*.\n\n` +
          "⏰ Ahora indícame la hora que deseas.\nFormato: HH:MM (24 horas)\nEjemplo: 09:30\n\n" +
          horariosAtencionMensaje()
      };
    }

    // ------------------------------
    // 4. HORA
    // ------------------------------
    if (paso === 'hora') {
      const v = Validators.hora(dato);
      if (!v.ok)
        return { siguiente: 'hora', respuesta: `❌ ${v.error}\nEjemplo: 09:30` };

      const horaStr = v.value;
      const fecha = contexto.fecha;

      if (!validarHorario(fecha, horaStr)) {
        return {
          siguiente: 'hora',
          respuesta:
            "❌ Ese horario no está dentro de la atención.\n\n" +
            horariosAtencionMensaje()
        };
      }

      // Guardar paciente
      let paciente = await pool.query('SELECT * FROM patients WHERE phone = $1', [sender]);
      let patientId;

      if (paciente.rowCount === 0) {
        const nuevo = await pool.query(
          'INSERT INTO patients (name, phone) VALUES ($1, $2) RETURNING id',
          [contexto.nombre, sender]
        );
        patientId = nuevo.rows[0].id;
      } else {
        patientId = paciente.rows[0].id;
      }

      // Verificar disponibilidad
      const ocupado = await pool.query(
        'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1',
        [contexto.fechaStr, horaStr]
      );

      if (ocupado.rowCount > 0) {
        return {
          siguiente: 'hora',
          respuesta:
            "⚠️ Ese horario ya está ocupado.\nPor favor elige otro dentro de los horarios permitidos."
        };
      }

      // Registrar cita
      await pool.query(
        'INSERT INTO appointments (patient_id, date, time, reason, duration, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [patientId, contexto.fechaStr, horaStr, contexto.motivo, 30, 'pendiente']
      );

      return {
        siguiente: 'completo',
        respuesta:
          `🎉 Tu cita fue agendada para *${formatFechaDia(fecha)}* a las *${horaStr}*.\n` +
          `Motivo: ${contexto.motivo}\n\n` +
          "Si necesitas reprogramar, solo dime y te ayudo."
      };
    }

    return {
      siguiente: 'completo',
      respuesta: "❌ Flujo no reconocido. Escribe '1' para iniciar de nuevo."
    };
  }
};
