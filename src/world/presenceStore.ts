// Presencia: ver a los otros jugadores en el mapa. Canal Realtime `world` de Supabase (anon key): la
// presence lleva quién está (id, nombre, avatar) y el broadcast `pos` las posiciones. Las posiciones van a
// un Map mutable que OtherPlayers lee cada frame; la UI solo se entera de altas/bajas/nombres (máx. 1/s).
// `hint` es un aviso suelto a un entrenador (p. ej. "te llegó un intercambio"): solo UI, no es autoridad.
import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

export interface RemotePlayer {
  id: string; name: string; avatar: string;
  x: number; z: number; rot: number; moving: boolean; seenAt: number;
}

interface Me { id: string; name: string; avatar: string }
interface PosMsg { id: string; x: number; z: number; rot: number; m: boolean }

/** Última posición recibida de cada jugador remoto (t = Date.now() al llegar). */
export const livePositions = new Map<string, { x: number; z: number; rot: number; t: number }>();
const liveMoving = new Map<string, boolean>();
/** Metadatos de presence (quién está conectado) y cuándo entró. */
const meta = new Map<string, { name: string; avatar: string; joinedAt: number }>();

const SEND_EVERY = 250;
const HEARTBEAT = 5000;
const STALE = 20_000;
/** Al desmontar no salimos al instante: el HUD se desmonta durante el combate y vuelve después. */
const LINGER = 120_000;

interface State { players: RemotePlayer[]; connected: boolean }
let s: State = { players: [], connected: false };
let sig = '';
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const usePresence = (): State => useSyncExternalStore(subscribe, () => s, () => s);
export const getRemote = (id: string) => s.players.find((p) => p.id === id);
/** Si el último `pos` de ese jugador decía que se estaba moviendo. */
export const isRemoteMoving = (id: string) => liveMoving.get(id) ?? false;

let me: Me | null = null;
let channel: RealtimeChannel | null = null;
let publishTimer: ReturnType<typeof setInterval> | null = null;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
let last = { x: NaN, z: NaN, rot: NaN, t: 0, m: false };
let force = false;
const hintCbs = new Set<(fromId: string, kind: string) => void>();

// Lista para la UI: solo cambia si entra/sale alguien o cambia un nombre/avatar.
function publish() {
  const now = Date.now();
  const list: RemotePlayer[] = [];
  for (const [id, m] of meta) {
    if (id === me?.id) continue;
    const p = livePositions.get(id);
    const seenAt = p?.t ?? m.joinedAt;
    if (now - seenAt > STALE) continue;
    list.push({
      id, name: m.name, avatar: m.avatar,
      x: p?.x ?? 0, z: p?.z ?? 0, rot: p?.rot ?? 0, moving: liveMoving.get(id) ?? false, seenAt,
    });
  }
  for (const id of livePositions.keys()) if (!meta.has(id)) { livePositions.delete(id); liveMoving.delete(id); }
  const next = list.map((p) => `${p.id}|${p.name}|${p.avatar}`).sort().join(',');
  if (next === sig) return;
  sig = next;
  s = { ...s, players: list };
  emit();
}

function setConnected(v: boolean) {
  if (s.connected === v) return;
  s = { ...s, connected: v };
  emit();
}

function syncMeta(ch: RealtimeChannel) {
  const state = ch.presenceState<Me>();
  const seen = new Set<string>();
  for (const metas of Object.values(state)) {
    const m = metas[metas.length - 1];
    if (!m?.id || m.id === me?.id) continue;
    seen.add(m.id);
    const old = meta.get(m.id);
    meta.set(m.id, { name: String(m.name ?? 'Trainer').slice(0, 24), avatar: String(m.avatar ?? ''), joinedAt: old?.joinedAt ?? Date.now() });
  }
  for (const id of [...meta.keys()]) if (!seen.has(id)) meta.delete(id);
}

function teardown() {
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = null;
  if (publishTimer) clearInterval(publishTimer);
  publishTimer = null;
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  me = null;
  meta.clear(); livePositions.clear(); liveMoving.clear();
  sig = '';
  s = { players: [], connected: false };
  emit();
}

/** Entra al canal `world`. Devuelve la limpieza (que sale con retraso por si se vuelve a montar enseguida). */
export function startPresence(who: Me): () => void {
  if (channel && me?.id === who.id) {
    if (lingerTimer) clearTimeout(lingerTimer);
    lingerTimer = null;
    updatePresenceIdentity(who);
  } else {
    teardown();
    me = { ...who };
    const ch = supabase.channel('world', {
      config: { presence: { key: who.id }, broadcast: { self: false } },
    });
    channel = ch;
    ch.on('presence', { event: 'sync' }, () => { syncMeta(ch); })
      .on('presence', { event: 'join' }, () => { force = true; })
      .on('broadcast', { event: 'pos' }, ({ payload }) => {
        const p = payload as PosMsg;
        if (!p?.id || p.id === me?.id || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
        livePositions.set(p.id, { x: p.x, z: p.z, rot: Number.isFinite(p.rot) ? p.rot : 0, t: Date.now() });
        liveMoving.set(p.id, !!p.m);
      })
      .on('broadcast', { event: 'hint' }, ({ payload }) => {
        const h = payload as { to?: string; from?: string; kind?: string };
        if (!h?.from || h.to !== me?.id || typeof h.kind !== 'string') return;
        hintCbs.forEach((cb) => cb(h.from!, h.kind!));
      })
      .subscribe((status) => {
        if (ch !== channel) return;
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          force = true;
          if (me) void ch.track({ id: me.id, name: me.name, avatar: me.avatar });
        } else {
          setConnected(false);
        }
      });
    publishTimer = setInterval(publish, 1000);
  }
  return () => {
    if (me?.id !== who.id || lingerTimer) return;
    lingerTimer = setTimeout(teardown, LINGER);
  };
}

export function updatePresenceIdentity(p: Partial<{ name: string; avatar: string }>) {
  if (!me) return;
  const next = { ...me, ...p };
  if (next.name === me.name && next.avatar === me.avatar) return;
  me = next;
  if (channel && s.connected) void channel.track({ id: me.id, name: me.name, avatar: me.avatar });
}

/** Manda la posición propia. Se puede llamar cada frame: aquí se limita a 4/s y solo si cambió algo. */
export function sendPresencePos(x: number, z: number, rot: number) {
  if (!channel || !me || !s.connected || lingerTimer) return;
  const now = Date.now();
  if (now - last.t < SEND_EVERY) return;
  const moved = !(Math.hypot(x - last.x, z - last.z) <= 0.15);
  const turned = !(Math.abs(rot - last.rot) <= 0.05);
  const stopped = last.m && !moved;
  if (!moved && !turned && !stopped && !force && now - last.t < HEARTBEAT) return;
  force = false;
  last = { x, z, rot, t: now, m: moved };
  void channel.send({
    type: 'broadcast', event: 'pos',
    payload: { id: me.id, x: +x.toFixed(2), z: +z.toFixed(2), rot: +rot.toFixed(3), m: moved } satisfies PosMsg,
  });
}

export function sendHint(toId: string, kind: string) {
  if (!channel || !me || !s.connected) return;
  void channel.send({ type: 'broadcast', event: 'hint', payload: { to: toId, from: me.id, kind } });
}

export function onHint(cb: (fromId: string, kind: string) => void): () => void {
  hintCbs.add(cb);
  return () => { hintCbs.delete(cb); };
}
