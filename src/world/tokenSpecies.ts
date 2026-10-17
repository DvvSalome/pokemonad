// Token de Arc → monstruo, port 1:1 de research/pokegrass-source/lib/species.js (lineOf, stageOf, rarityOf,
// catchRate, levelOf, faintedOf, cleanText, fmtUsd). La dirección del contrato es la identidad: el mismo token
// es siempre la misma especie para todos los jugadores, porque todo sale de un hash determinista de ella.
import { SPECIES_CATALOG, type Species, type Tier, type ZoneKey } from './species';

/** Nombres y modelos por etapa (1: < $100k, 2: < $1M, 3: ≥ $1M), del `LINES` original. */
const STAGES: Record<string, { names: [string, string, string]; models: [string, string, string] }> = {
  bird: { names: ['Coopip', 'Birble', 'Skybble'], models: ['Pigeon', 'Birb', 'Birb'] },
  chick: { names: ['Clucklet', 'Cluckadoo', 'Roostorm'], models: ['Chicken', 'Chicken', 'Chicken'] },
  bunny: { names: ['Bunnib', 'Hopmire', 'Harebold'], models: ['Bunny', 'Bunny', 'Bunny'] },
  bee: { names: ['Buzzlet', 'Armabuzz', 'Hivequeen'], models: ['Armabee', 'ArmabeeEvolved', 'ArmabeeEvolved'] },
  cat: { names: ['Kitbit', 'Tabbuff', 'Grandpaw'], models: ['Cat', 'Cat', 'Cat'] },
  mush: { names: ['Sporelet', 'Shroomble', 'Mushking'], models: ['Mushnub', 'MushnubEvolved', 'MushroomKing'] },
  pink: { names: ['Pinkle', 'Blushbell', 'Lovelune'], models: ['PinkBlob', 'PinkBlob', 'PinkBlob'] },
  fish: { names: ['Finnip', 'Fangfin', 'Leviafin'], models: ['Fish', 'FishEvolved', 'FishEvolved'] },
  frog: { names: ['Tadpip', 'Toadium', 'Kingribbit'], models: ['Frog', 'Frog', 'Frog'] },
  slime: { names: ['Goolet', 'Spikoo', 'Toxigoo'], models: ['GreenBlob', 'GreenSpikyBlob', 'GreenSpikyBlob'] },
  glub: { names: ['Glubby', 'Glubwing', 'Glubmare'], models: ['Glub', 'GlubEvolved', 'GlubEvolved'] },
  monkey: { names: ['Monchi', 'Monkroose', 'Grandroose'], models: ['Monkroose', 'Monkroose', 'Monkroose'] },
  ninja: { names: ['Shadlet', 'Ninjinx', 'Kagemaru'], models: ['Ninja', 'NinjaEvolved', 'NinjaEvolved'] },
  ghost: { names: ['Wispook', 'Skullcry', 'Phantomb'], models: ['Ghost', 'GhostSkull', 'GhostSkull'] },
  golem: { names: ['Pebwing', 'Gargoyl', 'Gargolord'], models: ['Goleling', 'GolelingEvolved', 'GolelingEvolved'] },
  demon: { names: ['Impling', 'Impyre', 'Infernimp'], models: ['Squidle', 'Demon', 'DemonEvolved'] },
  tiki: { names: ['Tikindle', 'Tikiflare', 'Tikinferno'], models: ['Tribal', 'Tribal', 'Tribal'] },
  dragon: { names: ['Dinomber', 'Drakoal', 'Pyrowyrm'], models: ['Dino', 'Dragon', 'DragonEvolved'] },
  yeti: { names: ['Frostub', 'Yetoo', 'Yetitan'], models: ['Yeti', 'YetiEvolved', 'YetiEvolved'] },
  brute: { names: ['Clubbit', 'Frostclub', 'Glaciogre'], models: ['BlueDemon', 'BlueDemon', 'BlueDemon'] },
  alpaca: { names: ['Helmlet', 'Alpaking', 'Aurumwing'], models: ['Alpaking', 'AlpakingEvolved', 'AlpakingEvolved'] },
  cactus: { names: ['Pricklet', 'Cactoro', 'Sombrerex'], models: ['Cactoro', 'CactoroEvolved', 'CactoroEvolved'] },
  orc: { names: ['Grumblet', 'Orcrash', 'Warlorc'], models: ['OrcEnemy', 'Orc', 'Orc'] },
  wisp: { names: ['Hywisp', 'Hywirl', 'Stormwirl'], models: ['Hywirl', 'Hywirl', 'Hywirl'] },
  wizard: { names: ['Hexie', 'Hexwick', 'Grimoire'], models: ['Wizard', 'Wizard', 'Wizard'] },
  alien: { names: ['Zorblet', 'Xenolith', 'Cosmarch'], models: ['Alien', 'AlienEvolved', 'AlienEvolved'] },
  rat: { names: ['Squeakit', 'Ratchet', 'Rattlord'], models: ['Rat', 'Rat', 'Rat'] },
  wasp: { names: ['Stingo', 'Hornex', 'Waspire'], models: ['Wasp', 'Wasp', 'Wasp'] },
  para: { names: ['Parablo', 'Crestor', 'Trumpasaur'], models: ['Parasaurolophus', 'Parasaurolophus', 'Parasaurolophus'] },
  koi: { names: ['Koilet', 'Goldkoi', 'Koiking'], models: ['Goldfish', 'Koi', 'FlowerHorn'] },
  puffer: { names: ['Puffip', 'Puffurr', 'Blobmaw'], models: ['Puffer', 'Puffer', 'Blobfish'] },
  shark: { names: ['Chompfin', 'Sharkle', 'Megalodont'], models: ['Piranha', 'Shark', 'GoblinShark'] },
  angler: { names: ['Spinelure', 'Lumelure', 'Abyssmaw'], models: ['Lionfish', 'Anglerfish', 'Anglerfish'] },
  apato: { names: ['Neckling', 'Lochsaur', 'Brontitan'], models: ['Apatosaurus', 'Apatosaurus', 'Apatosaurus'] },
  spider: { names: ['Webbit', 'Tarantox', 'Arachnarch'], models: ['Spider', 'Spider', 'Spider'] },
  rex: { names: ['Raptix', 'Rexcoal', 'Tyrannox'], models: ['Velociraptor', 'TRex', 'TRex'] },
  trike: { names: ['Trikit', 'Hornodon', 'Tritank'], models: ['Triceratops', 'Triceratops', 'Triceratops'] },
  stego: { names: ['Stegling', 'Platesaur', 'Steglord'], models: ['Stegosaurus', 'Stegosaurus', 'Stegosaurus'] },
  snake: { names: ['Hissle', 'Sandviper', 'Cobrahx'], models: ['Snake', 'Snake', 'Snake'] },
};

const TIERS: Tier[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const TIER_WEIGHT: Record<string, number> = { Common: 10, Uncommon: 5, Rare: 2, Epic: 0.7 };
const WILD_ZONES: ZoneKey[] = ['meadow', 'lake', 'woods', 'volcano', 'peak', 'ruins'];
const lineInfo = (line: string): Species => SPECIES_CATALOG.find((s) => s.id === line) ?? SPECIES_CATALOG.find((s) => s.id === 'slime')!;

// Tabla acumulada: cada zona salvaje recibe la misma porción de tokens y sus líneas se la reparten por tier
// (un Common sale ~14× más que un Epic).
const PICK: [number, string][] = (() => {
  const out: [number, string][] = [];
  let acc = 0;
  for (const z of WILD_ZONES) {
    const lines = SPECIES_CATALOG.filter((s) => s.zone === z);
    const tot = lines.reduce((a, s) => a + TIER_WEIGHT[s.tier], 0);
    for (const s of lines) { acc += TIER_WEIGHT[s.tier] / tot / WILD_ZONES.length; out.push([acc, s.id]); }
  }
  return out;
})();
const pickLine = (u: number) => (PICK.find(([c]) => u < c) ?? PICK[PICK.length - 1])[1];

/** Palabras clave del nombre → línea. En orden, gana la primera. */
const KEYWORDS: [RegExp, string][] = [
  [/\b(ai|gpt|bot|robot|agent|neural|brain|cpu|gpu|llm|jev|claude)\b|artificial|intellig|volt|thunder|electr|energy|power|spark/i, 'wisp'],
  [/\b(rat|rats|mouse|mice|cheese|rodent)\b/i, 'rat'],
  [/wasp|hornet|sting/i, 'wasp'],
  [/shark|piranha|jaws|megalodon/i, 'shark'],
  [/\bkoi\b|goldfish|carp|karp/i, 'koi'],
  [/puffer|fugu|blowfish|\bpuff/i, 'puffer'],
  [/angler|abyss|deep ?sea|lantern/i, 'angler'],
  [/bronto|diplo|apato|nessie|\bloch\b|long ?neck/i, 'apato'],
  [/spider|\bweb\b|tarantula|arachn/i, 'spider'],
  [/t-?rex|raptor|jurassic|tyranno/i, 'rex'],
  [/tricera|\btrike\b/i, 'trike'],
  [/stego/i, 'stego'],
  [/snake|viper|cobra|python|serpent|hiss/i, 'snake'],
  [/parasaur|duckbill/i, 'para'],
  [/cat|kitty|kitten|meow|neko|miau|typing/i, 'cat'],
  [/frog|pepe|froge|toad|ribbit|kek/i, 'frog'],
  [/goose|duck|bird|birb|pigeon|eagle|crow|raven|owl|hawk|parrot|penguin|swan/i, 'bird'],
  [/chick|chicken|hen|rooster|egg|cluck/i, 'chick'],
  [/fish|whale|shark|dolphin|ocean|sea\b|squid|octo|crab|salmon|tuna|koi|splash|water|wave|lake|river/i, 'fish'],
  [/dragon|drake|wyrm|dino|rex|raptor|lizard/i, 'dragon'],
  [/ghost|spirit|skull|dead|rip\b|zombie|grave|spooky|phantom|soul/i, 'ghost'],
  [/alien|space|mars|astro|moon|ufo|uranus|planet|galaxy|cosmic|star|rocket|orbit/i, 'alien'],
  [/mush|shroom|fungi|spore|truffle/i, 'mush'],
  [/cactus|desert|taco|sombrero|spike|sand|sun\b|pharaoh|pyramid/i, 'cactus'],
  [/ninja|samurai|shadow|shinobi|katana|ronin/i, 'ninja'],
  [/wizard|magic|witch|mage|spell|potion|arcane/i, 'wizard'],
  [/\bbee\b|bees|honey|wasp|bug|ant\b|beetle|fly\b/i, 'bee'],
  [/llama|alpaca|lama|camel|goat|sheep|king|crown|royal/i, 'alpaca'],
  [/rock|stone|golem|diamond|gold|gem|crystal|rich|bank|money|cash|coin|dollar|standard|index/i, 'golem'],
  [/devil|demon|hell|fire|flame|burn|666|lava|inferno|hot\b/i, 'demon'],
  [/bunny|rabbit|hare|carrot|easter/i, 'bunny'],
  [/monkey|ape|chimp|gorilla|banana|kong|baboon/i, 'monkey'],
  [/\b(dog|doge|inu|shib|shiba|puppy|pup|woof|bark|bork|wolf|fox|bear|yeti|bigfoot)\b|doggo|inu$|snow|ice\b|frost|freeze|cold/i, 'yeti'],
  [/cow|moo|bull|ox\b|bison|buffalo|horn|tank|robo|ogre/i, 'brute'],
  [/pink|love|heart|cute|kawaii|baby|girl|princess|cupid|fairy/i, 'pink'],
  [/goblin|orc|troll|grunt|chump/i, 'orc'],
  [/slime|blob|goo|jelly|toxic|poison|acid/i, 'slime'],
  [/tiki|tribal|mask|totem|voodoo/i, 'tiki'],
  [/grass|leaf|tree|plant|garden|green|seed|flower/i, 'mush'],
];

/** Hash FNV-1a de 32 bits. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Especie de un token. Si el nombre casa con una palabra clave sale esa especie ($FROG es una rana), salvo
 * que una palabra clave sola nunca vuelve común a un Rare o un Epic: esos conservan sus probabilidades.
 */
export function lineOf(token: string, name = '', symbol = ''): string {
  const h = hash32(token.toLowerCase());
  const text = `${name} ${symbol}`;
  for (const [re, line] of KEYWORDS) {
    if (!re.test(text)) continue;
    const tier = lineInfo(line).tier, roll = (h >>> 8) % 100;
    if (tier === 'Rare' && roll >= 30) break;
    if (tier === 'Epic' && roll >= 12) break;
    return line;
  }
  return pickLine((h % 1_000_000) / 1_000_000);
}

export const STAGE_CAPS = [100_000, 1_000_000];
/** Etapa evolutiva por market cap. */
export function stageOf(mcap: number): 1 | 2 | 3 {
  if (!(mcap >= STAGE_CAPS[0])) return 1;
  return mcap >= STAGE_CAPS[1] ? 3 : 2;
}
export const speciesName = (line: string, stage: number) => (STAGES[line]?.names ?? ['?', '?', '?'])[Math.max(0, Math.min(2, stage - 1))];
export const modelOf = (line: string, stage: number) =>
  `/monsters/${(STAGES[line] ?? STAGES.slime).models[Math.max(0, Math.min(2, stage - 1))]}.glb`;

// Umbrales de market cap (USD) → rareza. Calibrados contra la distribución real de Arc (dexscreener.com/arc):
// la mayoría son < $150k, un puñado pasa de $1M y los > $5M son ballenas. El market cap es lo ÚNICO que decide
// la rareza del salvaje (espejo de supabase/functions/game/pokemath.ts: si cambias uno, cambia el otro).
export const TIER_MCAP: [number, Tier][] = [
  [5_000_000, 'Legendary'],
  [750_000, 'Epic'],
  [150_000, 'Rare'],
  [25_000, 'Uncommon'],
  [0, 'Common'],
];
/** Rareza del salvaje según su market cap: más grande el token, más raro el monstruo. */
export function rarityOf(mcap: number, _line?: string): Tier {
  for (const [min, tier] of TIER_MCAP) if ((mcap || 0) >= min) return tier;
  return 'Common';
}
/** Nivel del salvaje según su market cap (más cap = más nivel = más stats). ~Lv 5 pequeños, ~Lv 29 en $5M, tope 50. */
export function wildLevelOf(mcap: number): number {
  if (!(mcap > 0)) return 5;
  return Math.max(5, Math.min(50, Math.round(5 + 8 * Math.log10(mcap / 5000))));
}

/** Probabilidad por tiro con bola normal: la tasa de la especie, y las evoluciones / tokens grandes resisten más. */
export function catchRate(mcap: number, line: string): number {
  const rate = lineInfo(line).rate;
  const k = [1, 0.8, 0.65][stageOf(mcap) - 1] * (mcap >= 10_000_000 ? 0.85 : 1);
  return Math.max(0.04, Math.min(0.85, (0.08 + 0.72 * Math.pow(rate / 255, 0.9)) * k));
}

/** Nivel de una captura: 5 al atraparla, +13 por cada duplicación del market cap desde entonces, 1..100. */
export function levelOf(m0: number, mcapNow: number): number {
  if (!(m0 > 0) || !(mcapNow > 0)) return 5;
  return Math.max(1, Math.min(100, Math.round(5 + 13 * Math.log2(mcapNow / m0))));
}
/** Debilitado: el token perdió la mayor parte de su valor desde la captura. */
export const faintedOf = (m0: number, mcapNow: number) => m0 > 0 && mcapNow > 0 && mcapNow < 0.35 * m0;

// Filtro de contenido para nombres y símbolos de lanzamientos sin permiso (mismo listado que el original).
const BLOCK = new RegExp([
  'n[i1!|]gg', 'f[a@4]gg?[o0]t', '\\bfag', 'retard', 'kike', 'chink', '\\bspic\\b', 'tranny', 'coon\\b', 'wetback', 'nazi', 'hitler', '\\bisis\\b', 'jihad', '\\bkkk\\b',
  'rape', 'porn', 'nsfw', 'hentai', 'onlyfans', '\\bxxx\\b', '\\bsex', 'sexy', 'horny', 'nude', 'naked', 'milf', 'loli', 'pedo', 'incest',
  'pussy', 'penis', 'vagina', 'dildo', '\\bdick', '\\bcock', '\\bcum\\b', '\\bcum[s]?\\b', 'boob', '\\btits?\\b', '\\banal\\b', '\\bass(hole)?\\b', '\\bbutt(hole)?\\b', 'orgasm', 'erect', 'testicle', '\\bballs?ack',
  'fuck', '\\bfuk', '\\bcunt', '\\bwhore', '\\bslut', '\\bbitch', 'motherf', '\\bjews?\\b', 'holocaust', 'suicide', '\\bkill ?(all|your)',
  '\\bputes?\\b', '\\bputas?\\b', 'salope', '\\bencul', '\\bpd\\b', '\\bbite\\b', '\\bchatte\\b', '\\bconnard', '\\bconnasse', '\\bnique', '\\bniquer', '\\bpedal', '\\bpolla\\b', '\\bcoño', '\\bmaric[oó]n', '\\bzorra\\b', '\\bputain\\b',
].join('|'), 'i');
export const cleanText = (s: string) => !BLOCK.test(String(s || ''));

export function fmtUsd(n: number): string {
  if (!(n > 0)) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return `$${n.toFixed(0)}`;
}
