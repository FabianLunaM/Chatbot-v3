// functions/validators.js

// Utilidades de fecha/hora
function parseFechaStr(fechaStr) {
  const m = fechaStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const fecha = new Date(yyyy, mm - 1, dd);
  if (fecha.getFullYear() !== yyyy || fecha.getMonth() !== mm - 1 || fecha.getDate() !== dd) return null;
  return fecha;
}

function parseHoraStr(horaStr) {
  const m = horaStr.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

// Validadores reforzados
const Validators = {
  // Permite letras (con acentos), espacios, apóstrofes y guiones. No números ni símbolos raros.
  nombre(value) {
    if (typeof value !== 'string') return { ok: false, error: 'Por favor escribe tu nombre como texto.' };
    const v = value.trim();
    if (v.length < 3) return { ok: false, error: 'El nombre parece muy corto. Escribe tu nombre completo.' };
    // Solo letras y separadores habituales de nombres
    if (!/^[A-Za-zÁÉÍÓÚáéíóúÑñ\s'-]+$/.test(v)) {
      return { ok: false, error: 'El nombre contiene caracteres no permitidos. Usa solo letras, espacios, guiones o apóstrofes.' };
    }
    return { ok: true, value: v };
  },

  // Permite letras (con acentos), espacios, números y puntuación básica para frases. Bloquea símbolos potencialmente peligrosos.
  motivo(value) {
    if (typeof value !== 'string') return { ok: false, error: 'Por favor escribe el motivo como texto.' };
    const v = value.trim();
    if (v.length < 3) return { ok: false, error: 'El motivo parece muy corto. Describe brevemente tu consulta.' };
    // Frase de texto: letras, espacios, dígitos y puntuación básica . , ; : ! ? ( ) -
    if (!/^[A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s\.,;:!\?\(\)\-]+$/.test(v)) {
      return { ok: false, error: 'El motivo contiene caracteres no permitidos. Usa solo texto y puntuación básica.' };
    }
    return { ok: true, value: v };
  },

  fechaHora(value) {
    if (typeof value !== 'string') return { ok: false, error: 'Por favor usa el formato DD/MM/AAAA HH:MM.' };
    const parts = value.trim().split(/\s+/);
    if (parts.length !== 2) return { ok: false, error: 'Falta la hora. Usa el formato DD/MM/AAAA HH:MM.' };

    const [fechaStr, horaStr] = parts;
    const fecha = parseFechaStr(fechaStr);
    const hora = parseHoraStr(horaStr);

    if (!fecha) return { ok: false, error: 'La fecha no es válida. Usa DD/MM/AAAA (ej. 12/12/2025).' };
    if (!hora) return { ok: false, error: 'La hora no es válida. Usa HH:MM en 24 horas (ej. 09:30).' };

    return { ok: true, value: { fechaStr, horaStr, fecha } };
  },

  // Valida que el usuario ingrese sólo números de las opciones disponibles (ej. ['1','2','3'])
  menuOption(value, opcionesValidas = []) {
    const v = String(value).trim();
    if (!/^\d+$/.test(v)) {
      return { ok: false, error: 'Por favor ingresa solo el número de la opción.' };
    }
    if (!opcionesValidas.includes(v)) {
      return { ok: false, error: `La opción ${v} no es válida. Opciones disponibles: ${opcionesValidas.join(', ')}` };
    }
    return { ok: true, value: v };
  }
};

module.exports = { Validators, parseFechaStr, parseHoraStr };
