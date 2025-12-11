// functions/agendar.js

// Helper: validar horario permitido
function validarHorario(fecha, horaStr) {
  const diaSemana = fecha.getDay(); // 0=Domingo, 6=Sábado
  const [h, m] = horaStr.split(':').map(Number);
  const minutos = h * 60 + m;

  const turnoManana = (minutos >= 9*60 && minutos <= 11*60 + 30);
  const turnoTarde = (minutos >= 14*60 + 30 && minutos <= 19*60);

  if (diaSemana >= 1 && diaSemana <= 5) {
    return turnoManana || turnoTarde;
  } else if (diaSemana === 6) {
    return turnoManana;
  }
  return false;
}

// Helper: sugerir horarios válidos cercanos
async function horariosDisponibles(pool, fechaStr, horaStr) {
  const [dia, mes, anio] = fechaStr.split('/').map(Number);
  const fecha = new Date(anio, mes - 1, dia);

  const [h, m] = horaStr.split(':').map(Number);
  const baseMin = h * 60 + m;

  const candidatos = [baseMin - 30, baseMin + 30, baseMin + 60];
  const libres = [];

  for (let min of candidatos) {
    if (min < 0 || min > 24*60) continue;
    const hh = String(Math.floor(min/60)).padStart(2,'0');
    const mm = String(min%60).padStart(2,'0');
    const horaCandidata = `${hh}:${mm}`;

    if (validarHorario(fecha, horaCandidata)) {
      const result = await pool.query(
        'SELECT * FROM appointments WHERE date = $1 AND time = $2',
        [fechaStr, horaCandidata]
      );
      if (result.rows.length === 0) {
        libres.push(horaCandidata);
      }
    }
  }
  return libres;
}

module.exports = {
  iniciarAgenda: async () => {
    return "📝 Para agendar tu cita necesito tu nombre completo.\n\n" +
           "📌 Recuerda que nuestros horarios de atención son:\n" +
           "🕘 Lunes a Viernes: 09:00 a 11:30 y 14:30 a 19:00\n" +
           "🕘 Sábados: 09:00 a 11:30\n" +
           "❌ Domingos no atendemos.\n\n" +
           "Por favor escribe tu nombre completo:";
  },

  procesarPaso: async (sender, pool, paso, dato, contexto) => {
    if (paso === 'nombre') {
      contexto.nombre = dato;
      return { siguiente: 'motivo', respuesta: "📌 Gracias. Ahora dime el motivo de tu consulta:" };
    }

    if (paso === 'motivo') {
      contexto.motivo = dato;
      return { siguiente: 'fecha_hora', respuesta: "📅 Perfecto. Indícame la fecha y hora (DD/MM/AAAA HH:MM):" };
    }

    if (paso === 'fecha_hora') {
      const [fechaStr, horaStr] = dato.split(' ');
      const [dia, mes, anio] = fechaStr.split('/').map(Number);
      const fecha = new Date(anio, mes - 1, dia);

      // Validar horario permitido
      if (!validarHorario(fecha, horaStr)) {
        const sugerencias = await horariosDisponibles(pool, fechaStr, horaStr);
        if (sugerencias.length > 0) {
          return { siguiente: 'fecha_hora', respuesta: "❌ Ese horario no está dentro de la atención del consultorio.\n" +
                                                       "👉 Horarios válidos cercanos disponibles: " + sugerencias.join(', ') };
        } else {
          return { siguiente: 'fecha_hora', respuesta: "❌ Ese horario no está dentro de la atención del consultorio.\n" +
                                                       "👉 Recuerda nuestros horarios:\n" +
                                                       "Lunes a Viernes: 09:00–11:30 y 14:30–19:00\n" +
                                                       "Sábados: 09:00–11:30\n" +
                                                       "Por favor elige otro horario válido." };
        }
      }

      // Buscar paciente
      let paciente = await pool.query('SELECT * FROM patients WHERE phone = $1', [sender]);
      let patientId;
      if (paciente.rows.length === 0) {
        const nuevo = await pool.query(
          'INSERT INTO patients (name, phone) VALUES ($1, $2) RETURNING id',
          [contexto.nombre, sender]
        );
        patientId = nuevo.rows[0].id;
      } else {
        patientId = paciente.rows[0].id;
        if (!paciente.rows[0].name && contexto.nombre) {
          await pool.query('UPDATE patients SET name = $1 WHERE id = $2', [contexto.nombre, patientId]);
        }
      }

      // Verificar disponibilidad
      const result = await pool.query(
        'SELECT * FROM appointments WHERE date = $1 AND time = $2',
        [fechaStr, horaStr]
      );

      if (result.rows.length > 0) {
        const sugerencias = await horariosDisponibles(pool, fechaStr, horaStr);
        if (sugerencias.length > 0) {
          return { siguiente: 'fecha_hora', respuesta: `⚠️ Ese horario ya está ocupado. Horarios cercanos disponibles:\n${sugerencias.join(', ')}` };
        } else {
          return { siguiente: 'fecha_hora', respuesta: "⚠️ Ese horario ya está ocupado y no hay espacios cercanos disponibles.\n" +
                                                       "👉 Recuerda nuestros horarios válidos:\n" +
                                                       "Lunes a Viernes: 09:00–11:30 y 14:30–19:00\n" +
                                                       "Sábados: 09:00–11:30\n" +
                                                       "Por favor elige otro horario." };
        }
      }

      // Guardar cita
      await pool.query(
        'INSERT INTO appointments (patient_id, date, time, reason, duration, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [patientId, fechaStr, horaStr, contexto.motivo, 30, 'pendiente']
      );

      return { siguiente: 'completo', respuesta: `✅ Tu cita fue agendada para el ${fechaStr} a las ${horaStr}. Motivo: ${contexto.motivo}. ¡Te esperamos!` };
    }

    return { siguiente: 'completo', respuesta: "❌ Flujo de agenda no reconocido." };
  }
};
