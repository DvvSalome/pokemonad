import React, { useEffect, useMemo, useState } from 'react';
import { scatterIn, clearOf, heightAt, placeAt, WATER_Y, LAKE, POND, ell, dist, PLAZA, CAMP, PLACES } from './terrain';
import { loadVariantSet, type ModelSet } from './modelLoader';
import { buildInstanced, scaleForSize, type Placement } from './instancing';

/**
 * Tamaño real de cada prop, en metros de su dimensión mayor. Es la tabla que mantiene el mundo a una sola
 * escala, y existe porque los tres packs de props vienen en escalas distintas: los de Kenney rondan los
 * 20-100 cm nativos, los del Cube World Kit son cubos de 2 m, y los del campamento y el parque sí están
 * en metros. Antes cada prop se colocaba con un multiplicador a ojo entre 0.8 y 1.6, que sobre esas bases
 * tan dispares dejaba setas y troncos del tamaño de un guijarro junto a cajones de dos metros — de ahí la
 * sensación de basura esparcida en vez de decoración.
 *
 * La referencia para calibrar es el jugador, que mide ~1.8 m.
 */
const PROP_SIZE: Record<string, number> = {
  '/nature/mushroom_red.glb': 0.4,
  '/nature/mushroom_tan.glb': 0.4,
  '/nature/mushroom_redGroup.glb': 0.7,
  '/nature/mushroom_tanGroup.glb': 0.7,
  '/nature/mushroom_redTall.glb': 0.75,
  '/nature/stump_round.glb': 0.9,
  '/nature/stump_roundDetailed.glb': 1.0,
  '/nature/stump_old.glb': 1.6,
  '/nature/stump_oldTall.glb': 2.3,
  '/nature/log.glb': 1.8,
  '/nature/log_large.glb': 2.6,
  '/nature/log_stack.glb': 1.7,
  '/nature/hanging_moss.glb': 2.0,
  '/nature/cactus_short.glb': 1.3,
  '/nature/cactus_tall.glb': 3.0,
  '/nature/statue_column.glb': 5.0,
  '/nature/statue_columnDamaged.glb': 3.2,
  '/nature/statue_block.glb': 1.2,
  '/nature/statue_head.glb': 1.7,
  '/nature/statue_ring.glb': 4.0,
  '/nature/lily_large.glb': 1.2,
  '/nature/lily_small.glb': 0.8,
  '/nature/sign.glb': 2.1,
  '/camp/tent.glb': 3.2,
  '/camp/campfire.glb': 1.2,
  '/camp/fire.glb': 1.0,
  '/camp/log-w-axe.glb': 2.0,
  '/camp/log.glb': 2.0,
  '/camp/tree.glb': 5.0,
  '/camp/rock.glb': 1.2,
  '/props/big-crystal.glb': 2.2,
  '/props/crystal.glb': 1.3,
  '/props/wood-chest.glb': 1.1,
  '/props/chest-open.glb': 1.1,
  '/props/crate.glb': 0.9,
};

// Small ground clutter scattered densely across every biome — this is the "MUCHA decoracion" pass:
// mushrooms, stumps, logs, cacti, ruins statuary, lily pads on the water, camp props.
const BIOME_CLUTTER: Record<string, string[]> = {
  meadow: ['/nature/mushroom_red.glb', '/nature/mushroom_tan.glb', '/nature/stump_round.glb', '/nature/log.glb'],
  woods: ['/nature/mushroom_redGroup.glb', '/nature/mushroom_tanGroup.glb', '/nature/stump_roundDetailed.glb', '/nature/log_large.glb', '/nature/log_stack.glb', '/nature/hanging_moss.glb'],
  volcano: ['/nature/stump_old.glb', '/nature/cactus_short.glb', '/nature/cactus_tall.glb'],
  peak: ['/nature/stump_oldTall.glb', '/nature/mushroom_redTall.glb'],
  ruins: ['/nature/statue_column.glb', '/nature/statue_columnDamaged.glb', '/nature/statue_block.glb', '/nature/statue_head.glb'],
  lake: ['/nature/stump_round.glb', '/nature/log.glb'],
};

const BIOME_CLUTTER_COUNT: Record<string, number> = {
  meadow: 90, woods: 140, volcano: 50, peak: 45, ruins: 40, lake: 45,
};

/** `s` ya no es la escala final sino una variación alrededor del tamaño que declara PROP_SIZE. */
interface Placed { url: string; x: number; y: number; z: number; r: number; s: number }

function scatterClutter(zone: string): Placed[] {
  const models = BIOME_CLUTTER[zone];
  const count = BIOME_CLUTTER_COUNT[zone];
  const scattered = scatterIn(0xC10 + zone.charCodeAt(0), count, (x, z) => {
    if (!clearOf(x, z, 1.2)) return false;
    if (heightAt(x, z) < WATER_Y + 0.2) return false;
    return placeAt(x, z) === zone;
  }, (r) => 0.85 + r() * 0.35);

  return scattered.map((s, i) => ({
    url: models[i % models.length],
    x: s.x, z: s.z, r: s.r, s: s.s,
    y: heightAt(s.x, s.z),
  }));
}

function scatterLilies(): Placed[] {
  const models = ['/nature/lily_large.glb', '/nature/lily_small.glb'];
  const scattered = scatterIn(0x11C, 26, (x, z) => {
    const onLake = ell(x, z, LAKE) < 0.85;
    const onPond = dist(x, z, POND) < POND.r * 0.8;
    return onLake || onPond;
  }, (r) => 0.8 + r() * 0.4, { x0: LAKE.x - LAKE.rx, x1: LAKE.x + LAKE.rx, z0: LAKE.z - LAKE.rz, z1: LAKE.z + LAKE.rz });
  const pondLilies = scatterIn(0x22C, 6, (x, z) => dist(x, z, POND) < POND.r * 0.75, (r) => 0.8 + r() * 0.4,
    { x0: POND.x - POND.r, x1: POND.x + POND.r, z0: POND.z - POND.r, z1: POND.z + POND.r });
  return [...scattered, ...pondLilies].map((s, i) => ({
    url: models[i % models.length],
    x: s.x, z: s.z, r: s.r, s: s.s,
    y: WATER_Y + 0.05,
  }));
}

function ruinsPlazaProps(): Placed[] {
  // A ring of columns framing the ruins plaza, like a broken temple courtyard.
  const out: Placed[] = [];
  const cols = ['/nature/statue_column.glb', '/nature/statue_columnDamaged.glb'];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = PLAZA.x + Math.cos(a) * (PLAZA.r + 2);
    const z = PLAZA.z + Math.sin(a) * (PLAZA.r + 2);
    out.push({ url: cols[i % 2], x, z, r: a, s: 1, y: heightAt(x, z) });
  }
  out.push({ url: '/nature/statue_ring.glb', x: PLAZA.x, z: PLAZA.z - PLAZA.r - 6, r: 0, s: 1, y: heightAt(PLAZA.x, PLAZA.z - PLAZA.r - 6) });
  return out;
}

function campProps(): Placed[] {
  // Same creator/style as the playable CUTES characters, so the camp vignette reads as one cohesive
  // scene instead of clashing kits.
  return [
    { url: '/camp/tent.glb', x: CAMP.x, z: CAMP.z + 2.5, r: 0.4, s: 1, y: heightAt(CAMP.x, CAMP.z + 2.5) },
    { url: '/camp/campfire.glb', x: CAMP.x + 2, z: CAMP.z - 1, r: 0, s: 1, y: heightAt(CAMP.x + 2, CAMP.z - 1) },
    { url: '/camp/fire.glb', x: CAMP.x + 2, z: CAMP.z - 1, r: 0, s: 1, y: heightAt(CAMP.x + 2, CAMP.z - 1) + 0.05 },
    { url: '/camp/log-w-axe.glb', x: CAMP.x - 2, z: CAMP.z - 2, r: 1.1, s: 1, y: heightAt(CAMP.x - 2, CAMP.z - 2) },
    { url: '/camp/log.glb', x: CAMP.x - 1.2, z: CAMP.z - 3, r: 0.6, s: 1, y: heightAt(CAMP.x - 1.2, CAMP.z - 3) },
    { url: '/camp/tree.glb', x: CAMP.x - 4, z: CAMP.z + 1, r: 0.3, s: 1, y: heightAt(CAMP.x - 4, CAMP.z + 1) },
    { url: '/camp/rock.glb', x: CAMP.x + 3.5, z: CAMP.z + 2, r: 0.9, s: 1, y: heightAt(CAMP.x + 3.5, CAMP.z + 2) },
  ];
}

function treasureProps(): Placed[] {
  // Crystals as a magical accent in volcano/peak/ruins; chests and crates as loot flavor near camp
  // and the ruins plaza. Curated picks from Cube World Kit (CC0) — the blocky trees/rocks in that
  // pack clash with the smoother Kenney kit already covering general scatter, so only these
  // style-neutral accent props were pulled in.
  const crystalSpots = scatterIn(0x7C0, 22, (x, z) => {
    if (!clearOf(x, z, 1.5)) return false;
    if (heightAt(x, z) < WATER_Y + 0.2) return false;
    const zone = placeAt(x, z);
    return zone === 'volcano' || zone === 'peak' || zone === 'ruins';
  }, (r) => 0.8 + r() * 0.5);

  const crystals: Placed[] = crystalSpots.map((s, i) => ({
    url: i % 3 === 0 ? '/props/big-crystal.glb' : '/props/crystal.glb',
    x: s.x, z: s.z, r: s.r, s: s.s, y: heightAt(s.x, s.z),
  }));

  const loot: Placed[] = [
    { url: '/props/wood-chest.glb', x: CAMP.x + 3, z: CAMP.z - 3, r: 0.5, s: 1, y: heightAt(CAMP.x + 3, CAMP.z - 3) },
    { url: '/props/crate.glb', x: CAMP.x + 3.8, z: CAMP.z - 2.5, r: 0.2, s: 1, y: heightAt(CAMP.x + 3.8, CAMP.z - 2.5) },
    { url: '/props/chest-open.glb', x: PLAZA.x + 4, z: PLAZA.z + 2, r: 1.4, s: 1, y: heightAt(PLAZA.x + 4, PLAZA.z + 2) },
    { url: '/props/crate.glb', x: PLAZA.x - 3, z: PLAZA.z - 4, r: 0.8, s: 1, y: heightAt(PLAZA.x - 3, PLAZA.z - 4) },
  ];

  return [...crystals, ...loot];
}

function signposts(): Placed[] {
  return Object.entries(PLACES)
    .filter(([k]) => k !== 'summit')
    .map(([, place]) => {
      const x = place.entry[0] + 1.5, z = place.entry[1] + 1.5;
      return { url: '/nature/sign.glb', x, z, r: Math.random() * Math.PI, s: 1, y: heightAt(x, z) };
    });
}

export const Decor: React.FC = () => {
  const placements = useMemo(() => {
    const all: Placed[] = [];
    for (const zone of Object.keys(BIOME_CLUTTER)) all.push(...scatterClutter(zone));
    all.push(...scatterLilies());
    all.push(...ruinsPlazaProps());
    all.push(...campProps());
    all.push(...signposts());
    all.push(...treasureProps());
    return all;
  }, []);

  const urls = useMemo(() => Array.from(new Set(placements.map((p) => p.url))), [placements]);
  const [models, setModels] = useState<Map<string, ModelSet> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadVariantSet(urls).then((m) => { if (!cancelled) setModels(m); });
    return () => { cancelled = true; };
  }, [urls]);

  const instances = useMemo(() => {
    if (!models) return [];
    const resolved: Placement[] = [];
    for (const p of placements) {
      const set = models.get(p.url);
      if (!set) continue;
      const s = scaleForSize(set, PROP_SIZE[p.url] ?? 1) * p.s;
      resolved.push({
        key: p.url,
        x: p.x,
        // La base del modelo puede estar por debajo de su origen, y al escalar ese hueco se multiplica.
        // Compensarlo aquí es lo que mantiene el prop apoyado en el suelo en vez de medio enterrado.
        y: p.y - set.base * s,
        z: p.z,
        r: p.r,
        s,
      });
    }
    // Contorno fino: estos props son mucho más pequeños que un árbol, así que el mismo grosor los
    // ahogaría. Solo los sólidos lo reciben; buildInstanced descarta las cartas con alfa por su cuenta.
    return buildInstanced(models, resolved, { outline: 0.01, receiveShadow: true });
  }, [models, placements]);

  return <group>{instances.map((m, i) => <primitive key={i} object={m} />)}</group>;
};
