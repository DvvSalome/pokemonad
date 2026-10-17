// Profesores de campo: monstruos de PokeScout repartidos por toda la región. La lección no se lee
// al acercarse: solo se abre cuando la captura tiene éxito.
import { PLACES, coliseumDist, COLISEUM } from './terrain';
import { SPECIES_CATALOG, type Spawn } from './species';
import { modelOf } from './tokenSpecies';
import { getLang } from '../i18n';

interface Lesson { en: string; es: string }

const LESSONS: Lesson[] = [
  { en: 'A wallet is a key pair. The address is public. Only the private key can sign.', es: 'Una wallet es un par de llaves. La dirección es pública. Solo la llave privada firma.' },
  { en: 'A transaction is a signed order that changes the chain. Reading it is free.', es: 'Una transacción es una orden firmada que cambia la cadena. Leerla no cuesta.' },
  { en: 'Gas is the fee to run that order. On Monad it is almost nothing.', es: 'El gas es la tarifa por ejecutar esa orden. En Monad casi no cuesta.' },
  { en: 'The chain ID tells the wallet which network it is. Monad testnet is 10143.', es: 'El chain ID le dice a la wallet en qué red está. La testnet de Monad es 10143.' },
  { en: 'A smart contract is a program that lives on the chain and runs the same for everyone.', es: 'Un contrato inteligente es un programa que vive en la cadena y corre igual para todos.' },
  { en: 'Deployed bytecode does not get edited. A fix means deploying a new contract.', es: 'El bytecode desplegado no se edita. Arreglarlo es desplegar otro contrato.' },
  { en: 'A token balance is a number inside a contract, not a coin in your pocket.', es: 'El saldo de un token es un número dentro de un contrato, no una moneda en el bolsillo.' },
  { en: 'ERC-20 is the shared language of tokens: balanceOf, transfer and approve.', es: 'ERC-20 es el idioma común de los tokens: balanceOf, transfer y approve.' },
  { en: 'Approve lets another contract spend your tokens. Only approve what you trust.', es: 'Approve deja que otro contrato gaste tus tokens. Solo aprueba lo que confías.' },
  { en: 'A block is a batch of transactions the network agreed on.', es: 'Un bloque es un lote de transacciones en el que la red ya estuvo de acuerdo.' },
  { en: 'Finality means that block will not be undone.', es: 'La finalidad quiere decir que ese bloque ya no se va a deshacer.' },
  { en: 'A soulbound badge cannot be transferred. Selling it would prove nothing.', es: 'Una insignia soulbound no se transfiere. Venderla no demostraría nada.' },
  { en: 'An event is a log that indexers read. The contract state is what is true.', es: 'Un evento es un registro que leen los indexadores. Lo cierto es el estado del contrato.' },
  { en: 'A faucet gives test coins. They are for trying the chain, not for spending.', es: 'Un faucet da monedas de prueba. Sirven para ensayar la cadena, no para gastar.' },
  { en: 'The same bytecode on two chains is two different contracts.', es: 'El mismo bytecode en dos cadenas son dos contratos distintos.' },
  { en: 'A hash is a fingerprint. Change one letter and the whole hash changes.', es: 'Un hash es una huella. Cambias una letra y cambia el hash entero.' },
  { en: 'The nonce stops someone from sending your signed transaction twice.', es: 'El nonce impide que alguien reenvíe dos veces una transacción que ya firmaste.' },
  { en: 'Your signature proves it was you, without showing the private key.', es: 'Tu firma prueba que fuiste tú, sin enseñar la llave privada.' },
];

const LINES = [
  'bee', 'cat', 'frog', 'monkey', 'ghost', 'dragon', 'yeti', 'cactus', 'bird', 'bunny',
  'slime', 'golem', 'wizard', 'shark', 'rat', 'wisp', 'ninja', 'alpaca', 'koi', 'spider',
  'demon', 'orc', 'fish', 'pink',
];

const ZONES = ['meadow', 'lake', 'woods', 'volcano', 'peak', 'ruins', 'summit', 'storm', 'sands', 'crystal'] as const;

function placeAt(zone: string, i: number): { x: number; z: number } {
  const p = PLACES[zone];
  const a = (i / 3) * Math.PI * 2 + zone.length * 0.37;
  let r = p.r * (0.48 + (i % 3) * 0.12);
  let x = p.x + Math.cos(a) * r;
  let z = p.z + Math.sin(a) * r;
  if (coliseumDist(x, z) < COLISEUM.wall + COLISEUM.wallT + 6) {
    r = p.r * 0.88;
    x = p.x + Math.cos(a) * r;
    z = p.z + Math.sin(a) * r;
  }
  return { x, z };
}

const byLine = (id: string) => SPECIES_CATALOG.find((s) => s.id === id) ?? SPECIES_CATALOG[0];

export const PROFESSORS: Spawn[] = ZONES.flatMap((zone, zi) =>
  [0, 1, 2].map((i) => {
    const n = zi * 3 + i;
    const line = LINES[n % LINES.length];
    const base = byLine(line);
    const { x, z } = placeAt(zone, i);
    return {
      id: `prof-${zone}-${i}`,
      species: { ...base, name: `Prof. ${base.name}` },
      model: modelOf(line, 1),
      x, z,
      size: base.flying ? 2.3 : 2.5,
      stage: 1,
      kind: 'wild' as const,
    };
  }),
);

const lessonById = new Map<string, Lesson>(
  PROFESSORS.map((sp, i) => [sp.id, LESSONS[i % LESSONS.length]]),
);

export const isProfessor = (id: string) => lessonById.has(id);

export function professorLesson(id: string): string | null {
  const lesson = lessonById.get(id);
  if (!lesson) return null;
  return getLang() === 'es' ? lesson.es : lesson.en;
}
