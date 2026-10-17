import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import type { Avatar3DConfig } from './shared';
import { DEFAULT_MODEL_URL } from './shared';

// Simplificado de cowork-v3: la versión original resolvía el avatar vía la tabla `usuarios`
// (avatar_3d_id del jugador autenticado). Todavía no hay sistema de cuentas de trainer en este
// proyecto, así que por ahora esto solo carga un avatar del catálogo por id, o el primero activo.
export const useAvatar3D = (avatarId?: string) => {
  const [avatarConfig, setAvatarConfig] = useState<Avatar3DConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const requestId = ++loadSeqRef.current;
    let cancelled = false;

    const fallback: Avatar3DConfig = {
      id: 'default',
      nombre: 'Default',
      modelo_url: DEFAULT_MODEL_URL,
      escala: 1,
    };

    const loadAvatar = async () => {
      try {
        setLoading(true);
        setError(null);

        // Sin proyecto configurado no hay catálogo que consultar: el avatar por defecto, y ni una
        // petición a la red (antes se reintentaba contra un host inexistente y llenaba la consola).
        if (!supabaseConfigured) {
          if (!cancelled && requestId === loadSeqRef.current) { setAvatarConfig(fallback); setLoading(false); }
          return;
        }

        let avatar: any = null;

        if (avatarId) {
          const { data } = await supabase.from('avatares_3d').select('*').eq('id', avatarId).maybeSingle();
          avatar = data;
        }

        if (!avatar) {
          const { data } = await supabase
            .from('avatares_3d')
            .select('*')
            .eq('activo', true)
            .order('orden', { ascending: true })
            .limit(1)
            .maybeSingle();
          avatar = data;
        }

        if (!avatar) {
          if (!cancelled && requestId === loadSeqRef.current) {
            setAvatarConfig(fallback);
            setLoading(false);
          }
          return;
        }

        const { data: anims } = await supabase
          .from('avatar_animaciones')
          .select('id, nombre, url, loop, orden, strip_root_motion')
          .eq('avatar_id', avatar.id)
          .eq('activo', true)
          .order('orden', { ascending: true });

        let animaciones = anims;
        let isFallback = false;
        if (!animaciones || animaciones.length === 0) {
          const { data: universalAnims } = await supabase
            .from('avatar_animaciones')
            .select('id, nombre, url, loop, orden, strip_root_motion')
            .eq('es_universal', true)
            .eq('activo', true)
            .order('orden', { ascending: true });
          if (universalAnims && universalAnims.length > 0) {
            animaciones = universalAnims;
            isFallback = true;
          }
        }

        const config: Avatar3DConfig = {
          id: avatar.id,
          nombre: avatar.nombre,
          modelo_url: avatar.modelo_url || DEFAULT_MODEL_URL,
          escala: avatar.escala || 1,
          textura_url: avatar.textura_url || null,
          animaciones: (animaciones || []).map((a: any) => ({
            id: a.id,
            nombre: a.nombre,
            url: a.url,
            loop: a.loop ?? false,
            orden: a.orden ?? 0,
            strip_root_motion: a.strip_root_motion ?? false,
            es_fallback: isFallback,
          })),
        };

        if (!cancelled && requestId === loadSeqRef.current) setAvatarConfig(config);
      } catch (err: any) {
        console.error('[useAvatar3D] error:', err);
        if (!cancelled && requestId === loadSeqRef.current) {
          setError(err.message || 'Error desconocido');
          setAvatarConfig(fallback);
        }
      } finally {
        if (!cancelled && requestId === loadSeqRef.current) setLoading(false);
      }
    };

    loadAvatar();
    return () => { cancelled = true; };
  }, [avatarId]);

  return { avatarConfig, loading, error };
};

/** El personaje del roster; si no hay uno, cae al avatar compartido de Supabase. */
export function useRosterAvatar(character?: Avatar3DConfig | null): Avatar3DConfig | null {
  const { avatarConfig: shared } = useAvatar3D();
  return useMemo(() => character ?? shared, [character, shared]);
}
