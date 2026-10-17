import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * /api/img?u=<url>: reenvía el logo de un token con CORS abierto (los CDN de logos no lo mandan, y sin él
 * el juego no puede leer su paleta ni usarlo como textura). Solo https, solo imágenes, máx. 2 MB. En
 * producción hace falta el mismo endpoint en el hosting (una función serverless de pocas líneas).
 */
function imgProxy(): Plugin {
  const MAX = 2 * 1024 * 1024;
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/img')) return next();
    const u = new URL(req.url, 'http://x').searchParams.get('u') ?? '';
    const fail = (code: number) => { res.statusCode = code; res.end(); };
    if (!/^https:\/\//i.test(u)) return fail(400);
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.startsWith('image/')) return fail(502);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX) return fail(413);
      res.setHeader('Content-Type', type);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(buf);
    } catch {
      fail(504);
    }
  };
  return {
    name: 'pg-img-proxy',
    configureServer(server) { server.middlewares.use((req, res, next) => void handle(req, res, next)); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => void handle(req, res, next)); },
  };
}

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), imgProxy()],
    build: {
      chunkSizeWarningLimit: 2300,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

            // React en su propio chunk: dentro de vendor-core quedaba en un ciclo con vendor-r3f y en
            // producción r3f se evaluaba antes que React ("reading 'useLayoutEffect'" → pantalla en blanco).
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
              return 'vendor-react';
            }

            if (id.includes('/three/') || id.includes('three-stdlib') || id.includes('troika-') || id.includes('camera-controls')) {
              return 'vendor-three';
            }

            if (id.includes('@dimforge/rapier3d') || id.includes('@react-three/rapier')) {
              return 'vendor-physics';
            }

            if (id.includes('livekit-client') || id.includes('@livekit')) {
              return 'vendor-livekit';
            }

            if (id.includes('@mediapipe')) {
              return 'vendor-mediapipe';
            }

            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }

            if (id.includes('/phaser/')) {
              return 'vendor-phaser';
            }

            if (id.includes('framer-motion') || id.includes('lucide-react') || id.includes('driver.js')) {
              return 'vendor-ui';
            }

            return 'vendor-core';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
