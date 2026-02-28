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

function horariosAtencionMensaje() {
  return (
    "📌 Nuestros horarios de atención:\n\n" +
    "• Lunes a Viernes: 09:00 a 11:30 y 14:30 a 19:00\n" +
    "• Sábados: 09:00 a 11:30\n" +
    "• Domingos: cerrado\n\n"
  );
}

/* ---------------------------------------------------------
   Generar horarios válidos del día
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
   FLUJO PRINCIPAL
--------------------------------------------------------- */
module.exports = {
  
  formatFechaDia,
  generarHorariosDia, 
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
        return { siguiente: 'telefono', respuesta: `❌ ${v.error}\nEjemplo: 60510522` }; 
      
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
        respuesta: "🗓️ Perfecto. ¿Qué fecha deseas para tu cita?\nFormato: DD/MM/AAAA\nEjemplo: 11/12/2026"
      };
    }

    // ------------------------------
    // 4. FECHA
    // ------------------------------
    if (paso === 'fecha') {
      const v = Validators.fecha(dato);
      if (!v.ok){
        return { siguiente: 'fecha', respuesta: `❌ ${v.error}\nEjemplo: 11/12/2026` };
      }

      contexto.fecha = v.value;
      contexto.fechaStr =
        `${String(contexto.fecha.getDate()).padStart(2, '0')}/` +
        `${String(contexto.fecha.getMonth() + 1).padStart(2, '0')}/` +
        `${contexto.fecha.getFullYear()}`;

      // 👉 Generar lista de horarios disponibles
      const horariosDia = generarHorariosDia(contexto.fecha);
      const disponibles = [];
      for (let h of horariosDia) {
        const result = await pool.query(
          'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1',
          [contexto.fecha, h]
        );
        if (result.rowCount === 0) disponibles.push(h);
      }

      if (disponibles.length === 0) {
        return { siguiente: 'fecha', respuesta: "❌ No hay horarios disponibles en esa fecha. Por favor elige otra." };
      }

      contexto.horariosDisponibles = disponibles;

      const lista = disponibles.map((h, idx) => `${idx+1}️⃣ ${h}`).join("\n");

      return {
        siguiente: 'hora',
        respuesta:
          `📅 Excelente. La fecha seleccionada es *${formatFechaDia(contexto.fecha)}*.\n\n` +
          "⏰ Estos son los horarios disponibles:\n\n" +
          lista + "\n\n" +
          "👉 Por favor responde con el número de la opción."
      };
    }

    // ------------------------------
    // 5. HORA (selección por número)
    // ------------------------------
    if (paso === 'hora') {
      const idx = parseInt(dato.trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= contexto.horariosDisponibles.length) {
        const lista = contexto.horariosDisponibles.map((h, i) => `${i+1}️⃣ ${h}`).join("\n");
        return { siguiente: 'hora', respuesta: `❌ Número inválido. Selecciona un horario de la lista:\n\n${lista}` };
      }

      contexto.horaStr = contexto.horariosDisponibles[idx];

      return { 
        siguiente: 'confirmacion', 
        respuesta: `📅 Has seleccionado *${formatFechaDia(contexto.fecha)}* a las *${contexto.horaStr}*.\n\n` + 
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
        let paciente = await pool.query('SELECT * FROM patients WHERE sender = $1', [sender]);
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
            respuesta: "❌ Ya tienes 3 citas activas registradas. No puedes agendar más hasta que alguna se complete o se cancele.\n\n👋 Gracias por conversar con Amalgama. ¡Que tengas un excelente día!"
          }; 
        }

        // Verificar disponibilidad (aunque ya se filtró antes, se revalida)
        const ocupado = await pool.query(
          'SELECT 1 FROM appointments WHERE date = $1 AND time = $2 LIMIT 1',
          [contexto.fecha, contexto.horaStr]
        );

        if (ocupado.rowCount > 0) {
          return {
            siguiente: 'hora',
            respuesta: "⚠️ Ese horario ya está ocupado. Por favor selecciona otro de la lista disponible."
          };
        }     

        // Registrar cita
        await pool.query(
          'INSERT INTO appointments (patient_id, date, time, reason, duration, status) VALUES ($1, $2, $3, $4, $5, $6)',
          [patientId, contexto.fecha, contexto.horaStr, contexto.motivo, 30, 'pendiente']
        );

        return {
          siguiente: 'completo',
          respuesta:
            `🎉 La cita se agendó para el paciente *${contexto.nombre}*, con el número de celular *${contexto.telefono}*, para la fecha:\n\n` +
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
