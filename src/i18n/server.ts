// Textos que manda el servidor (Edge Function `game`, siempre en inglés): errores de `Fail(...)` y líneas del regalo
// diario. Se traducen aquí para no tocar el servidor; lo que no esté en la lista se muestra tal cual.
type Lang = 'en' | 'es';

const ES_EXACT: Record<string, string> = {
  'admins only': 'solo para admins',
  'all incubators are busy': 'todas las incubadoras están ocupadas',
  'already caught': 'ya fue atrapado',
  'already collected': 'ya lo cobraste',
  'already incubating': 'ya se está incubando',
  'already paid': 'ya está pagado',
  'bad address': 'dirección no válida',
  'bad session': 'sesión no válida',
  'bad signature': 'firma no válida',
  'bad transaction hash': 'hash de transacción no válido',
  'connect your wallet first': 'primero conecta tu wallet',
  'could not reach the network, try again': 'no se pudo conectar con la red, inténtalo de nuevo',
  'that payment was already used': 'ese pago ya se usó',
  'that transaction was already used': 'esa transacción ya se usó',
  'fainted: use a Revive': 'debilitado: usa un Revivir',
  'forbidden': 'no permitido',
  'invite codes are for accounts less than 7 days old': 'los códigos de invitación son para cuentas de menos de 7 días',
  'keep walking: it is not ready yet': 'sigue caminando: aún no está listo',
  'no account with that key': 'no hay ninguna cuenta con esa clave',
  'no balls of that kind': 'no te quedan bolas de ese tipo',
  'no battle': 'no hay combate',
  'no encounter': 'no hay encuentro',
  'no session': 'sin sesión',
  'no such egg': 'ese huevo no existe',
  'no such offer': 'esa oferta no existe',
  'no such prize': 'ese premio no existe',
  'no such trainer': 'ese entrenador no existe',
  'not done yet': 'todavía no está completada',
  'no trainer': 'sin entrenador',
  'no trainer with that invite code': 'no hay ningún entrenador con ese código de invitación',
  'not your monster': 'ese monstruo no es tuyo',
  'pay with your wallet first (missing transaction)': 'primero paga con tu wallet (falta la transacción)',
  'pick a 3–20 letter name': 'elige un nombre de 3 a 20 letras',
  'pick another trainer': 'elige otro entrenador',
  'session expired': 'la sesión caducó',
  'sign-in expired, try again': 'el inicio de sesión caducó, inténtalo de nuevo',
  'slow down a little': 've un poco más despacio',
  'someone caught the Golden Monster first!': '¡alguien atrapó antes al Monstruo Dorado!',
  'that key does not look right': 'esa clave no parece correcta',
  'that monster is gone': 'ese monstruo ya no está',
  'that monster is not in the grass right now': 'ese monstruo no está en la hierba ahora',
  'that monster is not in your box': 'ese monstruo no está en tu Caja',
  'that payment is too old': 'ese pago es demasiado antiguo',
  'that prize is in another token/network': 'ese premio es de otro token o red',
  'that transaction failed on-chain': 'esa transacción falló en la cadena',
  'the Golden Monster is gone': 'el Monstruo Dorado ya no está',
  'the Mart is not set up yet': 'la Tienda aún no está configurada',
  'they do not have that monster anymore': 'ya no tiene ese monstruo',
  'too fast': 'demasiado rápido',
  'too many tries, wait a bit': 'demasiados intentos, espera un poco',
  'too many new players from your network': 'demasiados jugadores nuevos desde tu red',
  'type at least 3 letters': 'escribe al menos 3 letras',
  'unknown action': 'acción desconocida',
  'unknown item': 'objeto desconocido',
  'you already have 5 offers waiting': 'ya tienes 5 ofertas pendientes',
  'you already used an invite code': 'ya usaste un código de invitación',
  'you cannot use that code': 'no puedes usar ese código',
  '10 Grass Balls': '10 Grass Balls',
  '+15 Grass & 2 Super for your wallet': '+15 Grass y 2 Super por tu wallet',
};

const ES_PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^(.+) already caught it$/, (_, who) => `${who === 'someone' ? 'alguien' : who} ya lo atrapó`],
  [/^payment too small: (.+)$/, (_, v) => `pago insuficiente: ${v}`],
  [/^your egg bag is full \((\d+)\)$/, (_, n) => `tu bolsa de huevos está llena (${n})`],
  [/^(Ace|Veteran|Champion) holder bonus: (.+)$/, (_, tier, rest) => `Bonus de holder ${tier}: ${rest.replace(/ & /g, ' y ').replace(', shiny odds', ', probabilidad de shiny')}`],
];

export function serverText(lang: Lang, msg: string): string {
  if (lang !== 'es') return msg;
  const hit = ES_EXACT[msg];
  if (hit) return hit;
  for (const [re, fn] of ES_PATTERNS) {
    const m = msg.match(re);
    if (m) return fn(...m);
  }
  return msg;
}
