import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn('[supabase] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env.local');
}

/** Indica si el proyecto está configurado: sin env, el juego funciona en local (modo exploración). */
export const supabaseConfigured = Boolean(url && anonKey);

// Sin env, un cliente apuntando a un host local que nunca responde: las llamadas fallan (y los stores
// caen a su camino offline) en vez de reventar el módulo al importarse, que dejaba la pantalla en negro.
// Y con la sesión apagada, porque si no el cliente se pone a refrescar el token contra ese host que no
// existe y llena la consola de errores de red en un modo que ni siquiera usa el servidor.
export const supabase = supabaseConfigured
  ? createClient(url!, anonKey!)
  : createClient('http://localhost:54321', 'anon', { auth: { autoRefreshToken: false, persistSession: false } });
