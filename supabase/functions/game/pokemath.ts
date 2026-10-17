// Matemática del juego para el servidor: la misma que usa el cliente en src/world/{species,tokenSpecies,
// battleMath}.ts (port 1:1 de research/pokegrass-source/lib/species.js y js/cards.js). Si cambias una
// fórmula allí, cámbiala aquí: el servidor es quien decide capturas y combates.

export type Tier = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export interface Species { id: string; name: string; type: string; tier: Tier; zone: string; rate: number }

export const CATALOG: Species[] = [
  { id: 'bird', name: 'Coopip', type: 'Flying', tier: 'Common', zone: 'meadow', rate: 255 },
  { id: 'chick', name: 'Clucklet', type: 'Normal', tier: 'Common', zone: 'meadow', rate: 255 },
  { id: 'bunny', name: 'Bunnib', type: 'Normal', tier: 'Common', zone: 'meadow', rate: 235 },
  { id: 'bee', name: 'Buzzlet', type: 'Bug', tier: 'Common', zone: 'meadow', rate: 235 },
  { id: 'cat', name: 'Kitbit', type: 'Normal', tier: 'Uncommon', zone: 'meadow', rate: 190 },
  { id: 'mush', name: 'Sporelet', type: 'Grass', tier: 'Uncommon', zone: 'meadow', rate: 150 },
  { id: 'pink', name: 'Pinkle', type: 'Fairy', tier: 'Rare', zone: 'meadow', rate: 90 },
  { id: 'fish', name: 'Finnip', type: 'Water', tier: 'Common', zone: 'lake', rate: 255 },
  { id: 'frog', name: 'Tadpip', type: 'Water', tier: 'Uncommon', zone: 'lake', rate: 190 },
  { id: 'slime', name: 'Goolet', type: 'Poison', tier: 'Common', zone: 'woods', rate: 235 },
  { id: 'glub', name: 'Glubby', type: 'Dark', tier: 'Uncommon', zone: 'woods', rate: 190 },
  { id: 'monkey', name: 'Monchi', type: 'Fighting', tier: 'Uncommon', zone: 'woods', rate: 150 },
  { id: 'ninja', name: 'Shadlet', type: 'Dark', tier: 'Rare', zone: 'woods', rate: 75 },
  { id: 'ghost', name: 'Wispook', type: 'Ghost', tier: 'Epic', zone: 'woods', rate: 45 },
  { id: 'golem', name: 'Pebwing', type: 'Rock', tier: 'Common', zone: 'volcano', rate: 225 },
  { id: 'demon', name: 'Impling', type: 'Fire', tier: 'Uncommon', zone: 'volcano', rate: 170 },
  { id: 'tiki', name: 'Tikindle', type: 'Fire', tier: 'Rare', zone: 'volcano', rate: 75 },
  { id: 'dragon', name: 'Dinomber', type: 'Dragon', tier: 'Epic', zone: 'volcano', rate: 45 },
  { id: 'yeti', name: 'Frostub', type: 'Ice', tier: 'Common', zone: 'peak', rate: 200 },
  { id: 'brute', name: 'Clubbit', type: 'Ice', tier: 'Uncommon', zone: 'peak', rate: 150 },
  { id: 'alpaca', name: 'Helmlet', type: 'Steel', tier: 'Rare', zone: 'peak', rate: 60 },
  { id: 'cactus', name: 'Pricklet', type: 'Grass', tier: 'Common', zone: 'ruins', rate: 235 },
  { id: 'orc', name: 'Grumblet', type: 'Fighting', tier: 'Uncommon', zone: 'ruins', rate: 190 },
  { id: 'wisp', name: 'Hywisp', type: 'Electric', tier: 'Uncommon', zone: 'ruins', rate: 150 },
  { id: 'wizard', name: 'Hexie', type: 'Psychic', tier: 'Rare', zone: 'ruins', rate: 75 },
  { id: 'alien', name: 'Zorblet', type: 'Psychic', tier: 'Epic', zone: 'ruins', rate: 25 },
  { id: 'rat', name: 'Squeakit', type: 'Normal', tier: 'Common', zone: 'meadow', rate: 235 },
  { id: 'wasp', name: 'Stingo', type: 'Bug', tier: 'Uncommon', zone: 'meadow', rate: 170 },
  { id: 'para', name: 'Parablo', type: 'Grass', tier: 'Uncommon', zone: 'meadow', rate: 170 },
  { id: 'koi', name: 'Koilet', type: 'Water', tier: 'Common', zone: 'lake', rate: 245 },
  { id: 'puffer', name: 'Puffip', type: 'Water', tier: 'Uncommon', zone: 'lake', rate: 180 },
  { id: 'shark', name: 'Chompfin', type: 'Water', tier: 'Rare', zone: 'lake', rate: 75 },
  { id: 'angler', name: 'Spinelure', type: 'Dark', tier: 'Rare', zone: 'lake', rate: 70 },
  { id: 'apato', name: 'Neckling', type: 'Dragon', tier: 'Epic', zone: 'lake', rate: 30 },
  { id: 'spider', name: 'Webbit', type: 'Bug', tier: 'Uncommon', zone: 'woods', rate: 170 },
  { id: 'rex', name: 'Raptix', type: 'Dragon', tier: 'Rare', zone: 'volcano', rate: 70 },
  { id: 'trike', name: 'Trikit', type: 'Rock', tier: 'Uncommon', zone: 'peak', rate: 160 },
  { id: 'stego', name: 'Stegling', type: 'Steel', tier: 'Rare', zone: 'peak', rate: 70 },
  { id: 'snake', name: 'Hissle', type: 'Ground', tier: 'Common', zone: 'ruins', rate: 225 },
];
export const speciesById = (id: string) => CATALOG.find((s) => s.id === id) ?? CATALOG.find((s) => s.id === 'slime')!;

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
const WILD_ZONES = ['meadow', 'lake', 'woods', 'volcano', 'peak', 'ruins'];
const PICK: [number, string][] = (() => {
  const out: [number, string][] = [];
  let acc = 0;
  for (const z of WILD_ZONES) {
    const lines = CATALOG.filter((s) => s.zone === z);
    const tot = lines.reduce((a, s) => a + TIER_WEIGHT[s.tier], 0);
    for (const s of lines) { acc += TIER_WEIGHT[s.tier] / tot / WILD_ZONES.length; out.push([acc, s.id]); }
  }
  return out;
})();
const pickLine = (u: number) => (PICK.find(([c]) => u < c) ?? PICK[PICK.length - 1])[1];

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

export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0;
}
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function lineOf(token: string, name = '', symbol = ''): string {
  const h = hash32(token.toLowerCase());
  const text = `${name} ${symbol}`;
  for (const [re, line] of KEYWORDS) {
    if (!re.test(text)) continue;
    const tier = speciesById(line).tier, roll = (h >>> 8) % 100;
    if (tier === 'Rare' && roll >= 30) break;
    if (tier === 'Epic' && roll >= 12) break;
    return line;
  }
  return pickLine((h % 1_000_000) / 1_000_000);
}

export function stageOf(mcap: number): 1 | 2 | 3 {
  if (!(mcap >= 100_000)) return 1;
  return mcap >= 1_000_000 ? 3 : 2;
}
export const speciesName = (line: string, stage: number) => (STAGES[line]?.names ?? ['?', '?', '?'])[Math.max(0, Math.min(2, stage - 1))];
export const modelOf = (line: string, stage: number) =>
  `/monsters/${(STAGES[line] ?? STAGES.slime).models[Math.max(0, Math.min(2, stage - 1))]}.glb`;

// Umbrales de market cap (USD) → rareza. Calibrados contra la distribución real de Arc (dexscreener.com/arc):
// hoy la mayoría son < $150k, un puñado pasa de $1M y los > $5M son las ballenas. Al crecer la cadena, más
// tokens irán subiendo de tier de forma natural. El market cap es lo ÚNICO que decide la rareza del salvaje.
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
/**
 * Nivel del salvaje según su market cap (más cap = más nivel = más stats, vía fighter()). Curva logarítmica
 * suave y determinista: ~Lv 5 en los diminutos, ~Lv 29 en $5M, tope 50. Un token sin cap (salvaje privado) es Lv 5.
 */
export function wildLevelOf(mcap: number): number {
  if (!(mcap > 0)) return WILD_LEVEL;
  return Math.max(WILD_LEVEL, Math.min(50, Math.round(5 + 8 * Math.log10(mcap / 5000))));
}
export const baseCatch = (rate: number) => Math.max(0.04, Math.min(0.85, 0.08 + 0.72 * Math.pow(rate / 255, 0.9)));
/** Probabilidad por tiro con bola normal, con market cap (token) o solo la especie (salvajes privados). */
export function catchRate(mcap: number | null, line: string): number {
  const rate = speciesById(line).rate;
  if (mcap === null) return baseCatch(rate);
  const k = [1, 0.8, 0.65][stageOf(mcap) - 1] * (mcap >= 10_000_000 ? 0.85 : 1);
  return Math.max(0.04, Math.min(0.85, (0.08 + 0.72 * Math.pow(rate / 255, 0.9)) * k));
}

export type BallKey = 'ball' | 'super' | 'hyper' | 'hood';
export const BALL_KEYS: BallKey[] = ['ball', 'super', 'hyper', 'hood'];
const BALL_MULT: Record<BallKey, number> = { ball: 1, super: 1.6, hyper: 2.3, hood: Infinity };
export function catchChance(base: number, ball: BallKey, quality = 1): number {
  const m = BALL_MULT[ball] ?? 1;
  if (m === Infinity) return 1;
  const q = Math.max(1, Math.min(1.35, quality));
  return Math.min(0.97, 1 - Math.pow(1 - base, m * q));
}

export function levelOf(m0: number, mcapNow: number): number {
  if (!(m0 > 0) || !(mcapNow > 0)) return 5;
  return Math.max(1, Math.min(100, Math.round(5 + 13 * Math.log2(mcapNow / m0))));
}
export const faintedOf = (m0: number, mcapNow: number) => m0 > 0 && mcapNow > 0 && mcapNow < 0.35 * m0;

const BLOCK = new RegExp([
  'n[i1!|]gg', 'f[a@4]gg?[o0]t', '\\bfag', 'retard', 'kike', 'chink', '\\bspic\\b', 'tranny', 'coon\\b', 'wetback', 'nazi', 'hitler', '\\bisis\\b', 'jihad', '\\bkkk\\b',
  'rape', 'porn', 'nsfw', 'hentai', 'onlyfans', '\\bxxx\\b', '\\bsex', 'sexy', 'horny', 'nude', 'naked', 'milf', 'loli', 'pedo', 'incest',
  'pussy', 'penis', 'vagina', 'dildo', '\\bdick', '\\bcock', '\\bcum\\b', '\\bcum[s]?\\b', 'boob', '\\btits?\\b', '\\banal\\b', '\\bass(hole)?\\b', '\\bbutt(hole)?\\b', 'orgasm', 'erect', 'testicle', '\\bballs?ack',
  'fuck', '\\bfuk', '\\bcunt', '\\bwhore', '\\bslut', '\\bbitch', 'motherf', '\\bjews?\\b', 'holocaust', 'suicide', '\\bkill ?(all|your)',
  '\\bputes?\\b', '\\bputas?\\b', 'salope', '\\bencul', '\\bpd\\b', '\\bbite\\b', '\\bchatte\\b', '\\bconnard', '\\bconnasse', '\\bnique', '\\bniquer', '\\bpedal', '\\bpolla\\b', '\\bcoño', '\\bmaric[oó]n', '\\bzorra\\b', '\\bputain\\b',
].join('|'), 'i');
export const cleanText = (s: string) => !BLOCK.test(String(s || ''));

// ---------- combate ----------
const MOVE_NAME: Record<string, string> = {
  Normal: 'Ape In', Fire: 'Burn Rate', Water: 'Liquidity Wave', Grass: 'Green Candle', Electric: 'Pump Shock',
  Ice: 'Frozen Chart', Fighting: 'Diamond Fist', Poison: 'Toxic FUD', Flying: 'To The Moon', Psychic: 'Mind Alpha',
  Bug: 'Bug Bounty', Rock: 'Hard Floor', Ghost: 'Rug Pull', Dragon: 'Whale Roar', Dark: 'Dump It', Steel: 'Cold Wallet', Fairy: 'Airdrop',
};
const CHART: Record<string, Record<string, number>> = {
  Normal: { Rock: 0.5, Ghost: 0.5, Steel: 0.5 }, Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Rock: 2, Dragon: 0.5 }, Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Electric: { Water: 2, Grass: 0.5, Electric: 0.5, Flying: 2, Dragon: 0.5 }, Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0.5, Dark: 2, Steel: 2, Fairy: 0.5 }, Poison: { Grass: 2, Poison: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0.5, Fairy: 2 },
  Flying: { Grass: 2, Electric: 0.5, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 }, Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0.5, Steel: 0.5 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 }, Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 }, Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 }, Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 }, Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};
export const effectiveness = (moveType: string, foeType: string): number => CHART[moveType]?.[foeType] ?? 1;

export interface Stats { maxHp: number; atk: number; def: number; spd: number }
export function fighter(id: string, level: number): Stats {
  const R = rng(hash32(`base-${id}`));
  const w = { hp: 0.8 + R() * 0.5, atk: 0.8 + R() * 0.5, def: 0.8 + R() * 0.5, spd: 0.7 + R() * 0.6 };
  const sum = w.hp + w.atk + w.def + w.spd;
  const b = { hp: Math.round((280 * w.hp) / sum), atk: Math.round((280 * w.atk) / sum), def: Math.round((280 * w.def) / sum), spd: Math.round((280 * w.spd) / sum) };
  const L = Math.max(1, Math.min(100, level));
  return { maxHp: Math.round(b.hp * (1 + L / 22)) + 18, atk: Math.round(b.atk * (1 + L / 30)), def: Math.round(b.def * (1 + L / 30)), spd: Math.round(b.spd * (1 + L / 40)) };
}
export interface Move { name: string; type: string; power: number }
export function movesFor(sp: Species): Move[] {
  return [
    { name: MOVE_NAME[sp.type] || 'Ape In', type: sp.type, power: 34 },
    { name: sp.type === 'Normal' ? 'Market Buy' : 'Ape In', type: 'Normal', power: 22 },
  ];
}
export function damageOf(move: Move, attacker: Stats, defender: Stats, defType: string): { dmg: number; eff: number } {
  const eff = effectiveness(move.type, defType);
  if (eff === 0) return { dmg: 0, eff };
  const ratio = attacker.atk / Math.max(20, defender.def);
  const raw = move.power * (0.55 + 0.6 * ratio) * eff * (0.9 + Math.random() * 0.2);
  return { dmg: Math.max(1, Math.round(raw)), eff };
}

export const WILD_LEVEL = 5;
export const LEAGUE_POINTS: Record<Tier, number> = { Common: 10, Uncommon: 20, Rare: 50, Epic: 120, Legendary: 300 };
export const FLEE_CHANCE: Record<Tier, number> = { Common: 0, Uncommon: 0.08, Rare: 0.18, Epic: 0.3, Legendary: 0.4 };
