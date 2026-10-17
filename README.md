# pokemonad

Región de PokeScout llevada a Monad. Caminas el mapa, compras bolas en la tienda y capturas profesores: solo después de atraparlos te explican blockchain, en un aula, no en la captura de siempre. El Coliseo Trueno cierra la lección con un duelo y una insignia.

Monad testnet, chain id 10143. Sin `VITE_ACADEMY_CONTRACT` el coliseo abre en modo demostración.

## Assets 3D

Ninguno de los 327 modelos `.glb` de este repo es obra nuestra: salen de packs libres (CC0 y CC-BY 3.0) de
**Quaternius**, **Kenney**, **J-Toastie**, **Isa Lousberg** y **Cube World Kit**, repartidos por carpetas en
`public/` — una carpeta por pack, que es la unidad de atribución.

👉 **[CREDITS.md](CREDITS.md)** dice de dónde sale cada carpeta, con qué licencia, qué obliga esa licencia,
qué modificamos de cada pack y por qué (y qué partes del mundo sí son nuestras: terreno, cel-shading,
colocación y escala).

Los personajes de `public/characters/` y los props de `public/camp/` son **CC-BY 3.0**, así que su crédito
tiene que seguir visible en la pantalla de selección de personaje (`src/ui/CharacterSelectScreen.tsx`).

## Documentación

- [`CREDITS.md`](CREDITS.md) — origen y licencia de los assets 3D
- [`docs/paridad-original.md`](docs/paridad-original.md) — qué tiene el PokeGrass original y qué tenemos nosotros
- [`docs/guia-web3.md`](docs/guia-web3.md) — la capa onchain
- [`docs/deploy.md`](docs/deploy.md) — despliegue
