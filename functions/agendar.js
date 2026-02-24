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
  const m = horaStr.match(/^(\d{1,2}):(\d{2})$/);
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

/* ---------------------------------------------------------
   NUEVO: Generar horarios válidos del día
--------------------------------------------------------- */
function generarHorariosDia(fecha) {
  const diaSemana = fecha.getDay();
  const horarios = [];

  function pushRange(inicio, fin) {
    for (let min = inicio; min <= fin; min += 30) {
      const hh = String(Math.floor(min / 60)).padStart(2, '0');
      const mm = String(min % 60).padStart(2, '0');
      horarios.push(`${hh}:${mm}`);
    }
  }

  if (diaSemana >= 1 && diaSemana <= 5) {
    pushRange(9 * 60, 11 * 60 + 30);
    pushRange(14 * 60 + 30, 19 * 60);
  } else if (diaSemana === 6) {
    pushRange(9 * 60, 11 * 60 + 30);
  }

  return horarios;
}

/* ---------------------------------------------------------
   NUEVO: Sugerir horarios cercanos o siguiente día
--------------------------------------------------------- */
async function sugerirHorarios(pool, fecha, fechaStr, horaStr) {
  const horariosDia = generarHorariosDia(fecha);
  const idx = horariosDia.indexOf(horaStr);

  let sugerencias = [];

  if (idx !== -1) {
    const posibles = [
      horariosDia[idx - 2],
      horariosDia[idx - 1],
      horariosDia[idx + 1],
      horariosDia[idx + 2]
    ].filter(Boolean);

    for (let h of posibles) {
      const result = await pool.query(
        'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1',
        [fecha, h]
      );
      if (result.rowCount === 0) sugerencias.push(h);
    }
  }

  if (sugerencias.length > 0) {
    return {
      tipo: "mismo_dia",
      fechaStr,
      fechaLabel: formatFechaDia(fecha),
      horarios: sugerencias
    };
  }


  // Buscar siguiente día hábil
  let siguiente = new Date(fecha);
  do {
    siguiente.setDate(siguiente.getDate() + 1);
  } while (siguiente.getDay() === 0);

  const fechaSugStr =
    `${String(siguiente.getDate()).padStart(2, '0')}/` +
    `${String(siguiente.getMonth() + 1).padStart(2, '0')}/` +
    `${siguiente.getFullYear()}`;

  const horariosSiguiente = generarHorariosDia(siguiente);
  const horariosDisponibles = [];

  for (let h of horariosSiguiente) {
    const result = await pool.query(
      'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1',
      [siguiente, h]
    );
    if (result.rowCount === 0) horariosDisponibles.push(h);
    if (horariosDisponibles.length >= 4) break;
  }

  return {
    tipo: "otro_dia",
    fechaStr: fechaSugStr,
    fechaLabel: formatFechaDia(siguiente),
    horarios: horariosDisponibles
  };
}

/* ---------------------------------------------------------
   FLUJO PRINCIPAL
--------------------------------------------------------- */
module.exports = {
  
  formatFechaDia,
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
        siguiente: 'telefono',
        respuesta: `✅ Gracias ${contexto.nombre}. Ahora dime tu numero de celular:`
      };
    }
    // ----------------------------
    // 2. TELÉFONO 
    // ----------------------------

    if (paso === 'telefono') { 
      const v = Validators.telefono(dato); 
      if (!v.ok) 
        return { siguiente: 'telefono', respuesta: `❌ ${v.error}\nEjemplo: 78835733` }; 
      
      contexto.telefono = v.value; 
      return { 
        siguiente: 'motivo', 
        respuesta: "✅ Perfecto. Ahora dime el motivo de tu consulta:" 
      };
    }

    // ------------------------------
    // 3. MOTIVO
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
    // 4. FECHA
    // ------------------------------
    if (paso === 'fecha') {
      const v = Validators.fecha(dato);
      const FERIADOS = [
        "01/01/2026", // Año Nuevo 
        "25/12/2026", // Navidad 
        "16/02/2026", // Carnaval
        "17/02/2026" // Carnaval
      ];
      if (!v.ok)
        return { siguiente: 'fecha', respuesta: `❌ ${v.error}\nEjemplo: 11/12/2025` };

      contexto.fecha = v.value;
      contexto.fechaStr =
        `${String(contexto.fecha.getDate()).padStart(2, '0')}/` +
        `${String(contexto.fecha.getMonth() + 1).padStart(2, '0')}/` +
        `${contexto.fecha.getFullYear()}`;

      // Bloquear domingos 
      if (contexto.fecha.getDay() === 0) { 
        return { 
          siguiente: 'fecha', 
          respuesta: "❌ No puedes agendar citas en domingo. Por favor elige otra fecha.\nEjemplo: 11/12/2025" 
        };
      } 

      // Bloquear feriados 
      if (FERIADOS.includes(contexto.fechaStr)) {
        return { 
          siguiente: 'fecha', 
          respuesta: "❌ Ese día es feriado y no atendemos. Por favor elige otra fecha." 
        }; 
      }

      // Restricción: máximo 2 semanas 
      const hoy = new Date(); 
      hoy.setHours(0,0,0,0); 
      const limite = new Date(hoy); 
      limite.setDate(limite.getDate() + 14); 
      if (contexto.fecha > limite) { 
        return { siguiente: 'fecha', respuesta: "❌ Solo puedes agendar citas hasta 2 semanas desde hoy. Por favor elige una fecha más cercana." }; 
      }

      return {
        siguiente: 'hora',
        respuesta:
          `📅 Excelente. La fecha seleccionada es *${formatFechaDia(contexto.fecha)}*.\n\n` +
          "⏰ Ahora indícame la hora que deseas.\nFormato: HH:MM (24 horas)\nEjemplo: 09:30\n\n" +
          horariosAtencionMensaje()
      };
    }

        // ------------------------------
    // 5. HORA
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

      // Guardar hora en contexto, pero no registrar aún
      contexto.horaStr = horaStr; 
      return { 
        siguiente: 'confirmacion', 
        respuesta: `📅 Has seleccionado *${formatFechaDia(fecha)}* a las *${horaStr}*.\n\n` + 
        "¿Estás seguro de esta fecha y hora?\n\n" + 
        "1️⃣ Sí, confirmar\n" + 
        "2️⃣ No, elegir otra fecha"
      };
    }
      
    // ------------------------------
    // 6. CONFIRMACIÓN
    // ------------------------------
    
    if (paso === 'confirmacion') {
      const v = Validators.menuOption(dato, ['1','2']);
      if (!v.ok)
        return { siguiente: 'confirmacion', respuesta: `❌ ${v.error}\n\n👉 Responde con 1 o 2.` };

      if (v.value === '1') {
        // Guardar paciente
        let paciente = await pool.query('SELECT * FROM patients WHERE phone = $1', [sender]);
        let patientId;

        if (paciente.rowCount === 0) {
          const nuevo = await pool.query(
            'INSERT INTO patients (name, phone, sender) VALUES ($1, $2, $3) RETURNING id',
            [contexto.nombre, contexto.telefono, sender]
          );
          patientId = nuevo.rows[0].id;
        } else {
          patientId = paciente.rows[0].id;
        }

        // Restricción: máximo 3 citas activas 
        const citasActivas = await pool.query( 
          'SELECT COUNT(*) FROM appointments WHERE patient_id = $1 AND status = $2', 
          [patientId, 'pendiente'] 
        ); 
        
        if (parseInt(citasActivas.rows[0].count, 10) >= 3) { 
          return { 
            siguiente: 'completo', 
            respuesta: "❌ Ya tienes 3 citas activas registradas. No puedes agendar más hasta que alguna se complete o se cancele." 
          }; 
        }

        // Verificar disponibilidad
        const ocupado = await pool.query(
          'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1',
          [contexto.fecha, contexto.horaStr]
        );

        if (ocupado.rowCount > 0) {
          const sugerencias = await sugerirHorarios(pool, contexto.fecha, contexto.fechaStr, contexto.horaStr);

          if (sugerencias.horarios.length > 0) {
            const lista = sugerencias.horarios.map(h => `• ${h}`).join("\n");

            return {
              siguiente: 'hora',
              respuesta:
                `⚠️ Ese horario ya está ocupado.\n\n` +
                `👉 Opciones disponibles para *${sugerencias.fechaLabel}*:\n${lista}\n\n` +
                "Por favor elige una de estas opciones."
            };
          }

          return {
            siguiente: 'hora',
            respuesta:
              "⚠️ Ese horario ya está ocupado y no hay alternativas cercanas.\n\n" +
              horariosAtencionMensaje()
          };
        }     

        // Registrar cita
        //const partes = contexto.fechaStr.split('/'); 
        //const fechaISO = `${partes[2]}-${partes[1]}-${partes[0]}`; // YYYY-MM-DD
        
        await pool.query(
          'INSERT INTO appointments (patient_id, date, time, reason, duration, status) VALUES ($1, $2, $3, $4, $5, $6)',
          [patientId, contexto.fecha, contexto.horaStr, contexto.motivo, 30, 'pendiente']
        );

        return {
          siguiente: 'completo',
          respuesta:
            `🎉 La cita se agendó para el paciente *${contexto.nombre}*, con el numero de celular *${contexto.telefono}*, para la fecha:\n\n` +
            `*${formatFechaDia(contexto.fecha)}* a las *${contexto.horaStr}*.\n\n` +
            "Recuerda que puedes reprogramar o cancelar la cita hasta con 24 horas de anticipación.\n\n" +
            "Gracias por contactarte con el Consultorio Dental Ortodent."
        };
      }

      if (v.value === '2') {
        // Volver a pedir fecha
        return {
          siguiente: 'fecha',
          respuesta: "🔄 Entendido. Por favor indícame una nueva fecha (DD/MM/AAAA)."
        };
      }
    }


    // ------------------------------
    // FLUJO NO RECONOCIDO
    // ------------------------------
    return {
      siguiente: 'completo',
      respuesta: "❌ Flujo no reconocido. Escribe '1' para iniciar de nuevo."
    };
  }
};
