// El temario del Coliseo Monad: tres jefes, un módulo cada uno, de menos a más.
//
// Cada pregunta lleva su explicación y el sitio donde leerlo. La explicación NO es el premio por
// acertar: se enseña justo cuando se falla, que es cuando hace falta, y es lo que convierte perder vida
// en aprender algo. Por eso está escrita como respuesta a "por qué me he equivocado", no como resumen.
//
// Las preguntas de cada combate salen barajadas de este banco, así que repetir pelea no es repetir
// examen. Si se añaden más, basta con ponerlas en la lista del jefe que toque.

export interface Question {
  q: string;
  /** Opciones; la correcta es `answer`. */
  options: string[];
  answer: number;
  /** Lo que se enseña al fallar (y se resume al acertar). */
  why: string;
  /** Dónde estudiarlo. */
  doc: string;
}

export interface Boss {
  id: number;
  key: string;
  name: string;
  /** Lo que enseña, en una línea. */
  topic: string;
  /** Lo que te dice al acercarte, antes de la pelea. */
  challenge: string;
  /** Las tres ideas con las que sales de su combate. */
  beats: [string, string, string];
  level: 'Principiante' | 'Intermedio' | 'Avanzado';
  /** Modelo 3D del jefe (public/monsters). */
  model: string;
  /** Altura en metros a la que se planta en la arena. */
  height: number;
  /** Color de su aura y de su barra de vida. */
  color: number;
  /** Vida: también es el número de preguntas que hay que acertar para tumbarlo. */
  hp: number;
  questions: Question[];
}

const DOCS = 'https://docs.monad.xyz';

export const BOSSES: Boss[] = [
  {
    id: 0,
    key: 'spectre',
    name: 'El Espectro de los Bloques',
    topic: 'Qué es Monad: MON, chain ID y testnet',
    challenge: 'En Monad un token no se entiende leyendo un explorador. Si no sabes qué paga MON, qué es el chain ID 10143 y por qué la testnet no vale nada, no pasas de esta explanada.',
    beats: ['MON paga el gas, y aquí es casi gratis', 'El chain ID 10143 es la testnet', 'Firmar un mensaje no es una transacción'],
    level: 'Principiante',
    model: '/monsters/GhostSkull.glb',
    height: 3.4,
    color: 0x8b5cf6,
    hp: 5,
    questions: [
      {
        q: '¿Qué es exactamente una transacción firmada?',
        options: [
          'Un mensaje que prueba criptográficamente quién lo manda, sin revelar la clave privada',
          'Un correo cifrado que solo puede leer el validador',
          'Una copia de la clave privada enviada al nodo',
        ],
        answer: 0,
        why: 'La firma se genera con la clave privada pero no la contiene: cualquiera puede verificar con la clave pública que el mensaje salió de esa cuenta. La clave privada NUNCA viaja — si viajara, quien la viera sería dueño de la cuenta.',
        doc: `${DOCS}/getting-started`,
      },
      {
        q: 'En Monad, ¿qué se paga con el token MON?',
        options: ['El gas de las transacciones', 'Solo el alquiler de almacenamiento', 'Nada: Monad no tiene comisiones'],
        answer: 0,
        why: 'MON es el token nativo y paga el gas, igual que ETH en Ethereum. Lo barato del gas en Monad no viene de que no exista, sino de que la red procesa mucho más por bloque.',
        doc: `${DOCS}/monad-arch`,
      },
      {
        q: '¿Qué hace que una cadena sea "compatible con EVM"?',
        options: [
          'Que ejecuta el mismo bytecode que Ethereum, así que el contrato compilado vale igual',
          'Que usa el mismo logo y la misma documentación',
          'Que copia los bloques de Ethereum cada cierto tiempo',
        ],
        answer: 0,
        why: 'Compatibilidad a nivel de bytecode significa que el .bin que produce solc se despliega tal cual. Por eso Foundry, Hardhat, viem o ethers funcionan en Monad sin cambios.',
        doc: `${DOCS}/developer-essentials/differences`,
      },
      {
        q: 'Tu wallet te pide "firmar un mensaje" (no una transacción). ¿Qué implica?',
        options: [
          'No cuesta gas y no cambia nada en la cadena: solo demuestra que controlas la cuenta',
          'Envía tus fondos al contrato que lo pide',
          'Siempre despliega un contrato nuevo',
        ],
        answer: 0,
        why: 'Firmar un mensaje es gratis y off-chain: sirve para identificarte. Una transacción, en cambio, se incluye en un bloque, cuesta gas y sí modifica el estado.',
        doc: `${DOCS}/developer-essentials/wallets`,
      },
      {
        q: '¿Qué es la finalidad (finality) de un bloque?',
        options: [
          'El momento a partir del cual ese bloque ya no puede revertirse',
          'El tiempo que tarda la wallet en mostrar el saldo',
          'El límite de transacciones que caben en el bloque',
        ],
        answer: 0,
        why: 'Hasta que un bloque es final puede quedar fuera de la cadena si gana otra rama. MonadBFT da finalidad en una sola ranura (single-slot): cuando el bloque se confirma, está cerrado.',
        doc: `${DOCS}/monad-arch/consensus/monad-bft`,
      },
      {
        q: 'Un contrato inteligente es, antes que nada…',
        options: [
          'Código desplegado en una dirección, que cualquiera puede llamar y nadie puede cambiar',
          'Un contrato en PDF firmado digitalmente',
          'Un acuerdo entre dos wallets guardado en un servidor',
        ],
        answer: 0,
        why: 'Una vez desplegado, el bytecode de esa dirección es inmutable (salvo patrones de proxy explícitos). De ahí viene su garantía: las reglas no cambian a mitad de partida.',
        doc: `${DOCS}/guides/deploy-smart-contract`,
      },
      {
        q: '¿Para qué sirve una red de pruebas (testnet) como la de Monad?',
        options: [
          'Para desplegar y probar con tokens sin valor antes de ir a mainnet',
          'Para minar MON reales más rápido',
          'Para guardar copias de seguridad de mainnet',
        ],
        answer: 0,
        why: 'La testnet se comporta como mainnet pero su MON sale de un faucet y no vale nada. Es donde se rompen cosas sin consecuencias.',
        doc: `${DOCS}/developer-essentials/network-information`,
      },
      {
        q: '¿Qué identifica de forma única a una red EVM para tu wallet?',
        options: ['Su chain ID (Monad testnet usa el 10143)', 'El nombre que le pongas en MetaMask', 'La URL del explorador'],
        answer: 0,
        why: 'El chain ID va dentro de la firma (EIP-155): es lo que impide que una transacción firmada para una red se reenvíe en otra. Monad testnet es 10143.',
        doc: `${DOCS}/developer-essentials/network-information`,
      },
    ],
  },
  {
    id: 1,
    key: 'devourer',
    name: 'El Devorador de Paralelismo',
    topic: 'Por qué Monad es rápida',
    challenge: 'La velocidad no es un eslogan. Paralelo optimista, ejecución diferida, MonadBFT y RaptorCast. Si los confundes con magia, te los explico a golpes.',
    beats: ['El paralelo no cambia el orden del bloque', 'El consenso acuerda el orden; ejecutar va detrás', 'RaptorCast reparte el bloque a trozos'],
    level: 'Intermedio',
    model: '/monsters/Hywirl.glb',
    height: 4,
    color: 0x22d3ee,
    hp: 6,
    questions: [
      {
        q: 'Monad ejecuta transacciones en paralelo de forma OPTIMISTA. ¿Qué significa eso?',
        options: [
          'Las lanza a la vez suponiendo que no chocan, y vuelve a ejecutar solo las que sí tocaron el mismo estado',
          'Ejecuta únicamente las transacciones que el usuario marca como independientes',
          'Reordena las transacciones para que nunca coincidan',
        ],
        answer: 0,
        why: 'No hace falta declarar por adelantado a qué estado accede cada transacción: se ejecutan en paralelo y, si dos entran en conflicto, la posterior se re-ejecuta con el resultado correcto. El resultado final es idéntico al de ejecutarlas en serie.',
        doc: `${DOCS}/monad-arch/execution/parallel-execution`,
      },
      {
        q: 'Con la ejecución en paralelo, ¿cambia el ORDEN final de las transacciones del bloque?',
        options: [
          'No: el orden del bloque se respeta; el paralelismo es solo cómo se calcula',
          'Sí: gana la que termine antes',
          'Sí: el orden lo decide el validador después de ejecutar',
        ],
        answer: 0,
        why: 'El paralelismo es un detalle de implementación. El estado resultante es exactamente el de ejecutar el bloque en orden, o la red no sería determinista y los nodos no podrían ponerse de acuerdo.',
        doc: `${DOCS}/monad-arch/execution/parallel-execution`,
      },
      {
        q: '¿Qué es la "ejecución diferida" (deferred execution) de Monad?',
        options: [
          'El consenso acuerda el ORDEN de las transacciones y la ejecución va un bloque por detrás',
          'Las transacciones caras se posponen a bloques con menos carga',
          'El usuario elige cuándo se ejecuta su transacción',
        ],
        answer: 0,
        why: 'Separar ordenar de ejecutar es lo que da tiempo real de cómputo: los validadores no tienen que terminar de ejecutar un bloque antes de votar el siguiente, así que el presupuesto de ejecución deja de estar atado al tiempo de consenso.',
        doc: `${DOCS}/monad-arch/consensus/deferred-execution`,
      },
      {
        q: 'MonadBFT consigue finalidad…',
        options: [
          'en una sola ranura (single-slot): el bloque queda cerrado al confirmarse',
          'tras 32 bloques, como el checkpoint de Ethereum',
          'cuando lo confirma un puente externo',
        ],
        answer: 0,
        why: 'MonadBFT es un BFT pipelineado derivado de HotStuff con finalidad de ranura única y responsivo en el camino feliz: no hay que esperar épocas ni confirmaciones probabilísticas.',
        doc: `${DOCS}/monad-arch/consensus/monad-bft`,
      },
      {
        q: '¿Para qué sirve RaptorCast?',
        options: [
          'Para repartir el bloque del líder entre los validadores troceándolo con códigos de borrado',
          'Para comprimir el estado en disco',
          'Para ordenar el mempool por precio de gas',
        ],
        answer: 0,
        why: 'RaptorCast divide el bloque en fragmentos con redundancia y los difunde por un árbol de validadores: cada uno reconstruye el bloque entero con un subconjunto de trozos, sin que el líder tenga que mandárselo completo a todos.',
        doc: `${DOCS}/monad-arch/consensus/raptorcast`,
      },
      {
        q: 'MonadDb existe porque…',
        options: [
          'leer y escribir el árbol de estado en disco es el cuello de botella real, y hacerlo asíncrono sobre SSD lo desatasca',
          'hace falta una base de datos SQL para los contratos',
          'el estado no cabe en un disco normal',
        ],
        answer: 0,
        why: 'MonadDb guarda el trie de estado en una estructura pensada para NVMe y hace I/O asíncrona: sin eso, da igual cuántos núcleos tengas ejecutando en paralelo, todos acabarían esperando al disco.',
        doc: `${DOCS}/monad-arch/execution/monaddb`,
      },
      {
        q: 'El "pipelining" de Monad consiste en…',
        options: [
          'solapar las etapas (propagar, votar, ejecutar) como una cadena de montaje, en vez de hacerlas una tras otra',
          'enviar las transacciones por una tubería HTTP persistente',
          'agrupar varios bloques en uno solo',
        ],
        answer: 0,
        why: 'Igual que un procesador superescalar: mientras una etapa trabaja en el bloque N, otra ya está con el N+1. El tiempo total por bloque baja sin que ninguna etapa tenga que ser más rápida.',
        doc: `${DOCS}/monad-arch`,
      },
      {
        q: 'Dos transacciones del mismo bloque tocan el MISMO slot de almacenamiento. ¿Qué pasa?',
        options: [
          'Se detecta el conflicto y la segunda se re-ejecuta sobre el estado ya actualizado',
          'Las dos se descartan y vuelven al mempool',
          'La segunda falla con "state conflict"',
        ],
        answer: 0,
        why: 'El conflicto no es un error: es el caso que el ejecutor espera. Re-ejecutar la transacción afectada cuesta mucho menos que serializar el bloque entero por si acaso.',
        doc: `${DOCS}/monad-arch/execution/parallel-execution`,
      },
    ],
  },
  {
    id: 2,
    key: 'bytecode',
    name: 'El Guardián del Bytecode',
    topic: 'Contratos, gas y la insignia que no se vende',
    challenge: 'El mismo bytecode de Ethereum corre aquí. Demuestra que sabes desplegarlo, leer un evento y por qué la insignia de esta academia no se puede transferir.',
    beats: ['Nada del código cambia: solo el RPC y el chain ID', 'Un evento es para el indexador, no para otro contrato', 'Soulbound: si no hay transfer, no se vende'],
    level: 'Avanzado',
    model: '/monsters/Goleling.glb',
    height: 4.4,
    color: 0xf59e0b,
    hp: 7,
    questions: [
      {
        q: '¿Qué hay que cambiar en un contrato de Ethereum para desplegarlo en Monad?',
        options: [
          'Nada en el código: el mismo bytecode vale; solo cambian RPC y chain ID',
          'Hay que recompilarlo con un compilador propio de Monad',
          'Hay que reescribir el almacenamiento en un formato paralelo',
        ],
        answer: 0,
        why: 'Monad es equivalente a nivel de bytecode EVM. Ni el compilador ni las herramientas cambian: el despliegue solo apunta a otro RPC y otro chain ID.',
        doc: `${DOCS}/developer-essentials/differences`,
      },
      {
        q: 'En Solidity, ¿qué diferencia hay entre `view` y una función que escribe?',
        options: [
          'Una `view` no modifica el estado y puede resolverse con `eth_call`, sin transacción ni gas para quien llama',
          '`view` es solo una convención de nombres sin efecto',
          'Una `view` también cuesta gas siempre',
        ],
        answer: 0,
        why: 'Al no tocar el estado, la llamada la puede ejecutar un nodo en local y devolver el resultado al momento. Solo cuesta gas lo que entra en un bloque.',
        doc: `${DOCS}/guides/deploy-smart-contract`,
      },
      {
        q: '¿Qué es un evento (`event`) y por qué importa aquí?',
        options: [
          'Un registro indexable que no se puede leer desde otro contrato, pensado para que lo consuman indexadores y frontends',
          'Una función que se ejecuta sola cada bloque',
          'Un error controlado que revierte la transacción',
        ],
        answer: 0,
        why: 'Los logs son mucho más baratos que el almacenamiento y están pensados para leerse desde fuera. Por eso el contrato de la academia emite `BadgeMinted`: un indexador reconstruye el progreso de cualquier wallet sin tocar el estado.',
        doc: `${DOCS}/guides/indexers`,
      },
      {
        q: 'Una insignia SOULBOUND se implementa, en esencia,…',
        options: [
          'no implementando la transferencia: si no hay forma de mover el token, no se puede vender',
          'poniendo el precio a cero en el marketplace',
          'guardándola en una base de datos privada',
        ],
        answer: 0,
        why: 'Un certificado transferible no certifica a nadie. El contrato de esta academia ni siquiera tiene `transferFrom`: la insignia vive atada a la dirección que la ganó.',
        doc: 'https://eips.ethereum.org/EIPS/eip-5192',
      },
      {
        q: 'El gas de una operación en la EVM mide…',
        options: [
          'el trabajo que cuesta ejecutarla (cómputo, memoria y, sobre todo, tocar estado)',
          'los segundos que tarda el validador',
          'el tamaño en bytes de la transacción, y nada más',
        ],
        answer: 0,
        why: 'Escribir un slot nuevo cuesta órdenes de magnitud más que una suma, porque el coste real no es la CPU sino el estado que la red tendrá que guardar para siempre.',
        doc: `${DOCS}/developer-essentials/gas-on-monad`,
      },
      {
        q: 'Para escribir en un contrato desde el frontend con viem necesitas…',
        options: [
          'un `walletClient` con la cuenta del usuario; con `publicClient` solo se lee',
          'la clave privada del usuario en el código',
          'desplegar un backend que firme por él',
        ],
        answer: 0,
        why: 'El `publicClient` habla con el RPC y solo lee. Escribir exige una firma, y la firma la da la wallet del usuario a través del `walletClient`. La clave privada no sale nunca de la wallet.',
        doc: 'https://viem.sh/docs/contract/writeContract',
      },
      {
        q: '¿Qué es `revert` con un error personalizado (`error NotEnrolled()`)?',
        options: [
          'Una forma barata de abortar devolviendo un selector de 4 bytes en vez de una cadena de texto',
          'Un `console.log` que solo ve el desarrollador',
          'Un aviso que permite que la transacción continúe',
        ],
        answer: 0,
        why: 'Revertir deshace todos los cambios de la llamada. Con error personalizado el motivo viaja como selector de 4 bytes en lugar de un string, que es bastante más caro.',
        doc: `${DOCS}/guides/deploy-smart-contract`,
      },
      {
        q: 'Tu transacción se queda "pending" para siempre. La causa más probable es…',
        options: [
          'un nonce o un precio de gas por debajo de lo que el mempool acepta',
          'que el contrato tiene un bug de lógica',
          'que la red tiene finalidad diferida',
        ],
        answer: 0,
        why: 'Pendiente significa que ni siquiera se ha incluido: es un problema de nonce o de precio, no de la ejecución. Un bug del contrato se vería como transacción incluida y revertida.',
        doc: `${DOCS}/developer-essentials/gas-on-monad`,
      },
    ],
  },
];

export const bossById = (id: number): Boss => BOSSES.find((b) => b.id === id) ?? BOSSES[0];

/**
 * Baraja estable a partir de una semilla: la misma pelea repetida no repite el mismo examen.
 *
 * Baraja DOS cosas: qué preguntas salen y en qué orden van sus opciones. Lo segundo importa más de lo
 * que parece — escritas a mano, la respuesta correcta tiende a quedar la primera, y entonces el combate
 * se gana pulsando siempre la A sin leer nada, que es exactamente lo contrario de lo que esto enseña.
 */
export function pickQuestions(boss: Boss, n: number, seed: number): Question[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T,>(list: T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  return shuffle(boss.questions).slice(0, Math.min(n, boss.questions.length)).map((q) => {
    const order = shuffle(q.options.map((_, i) => i));
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      answer: order.indexOf(q.answer),
    };
  });
}
