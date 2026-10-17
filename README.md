# pokemonad

Región de PokeMonad llevada a Monad. Caminas el mapa, compras bolas en la tienda y capturas profesores: solo después de atraparlos te explican blockchain, en un aula, no en la captura de siempre. El Coliseo Trueno cierra la lección con un duelo y una insignia.

Monad testnet, chain id 10143. Sin `VITE_ACADEMY_CONTRACT` el coliseo abre en modo demostración.

## Assets 3D

Ninguno de los 327 modelos `.glb` de este repo es obra nuestra: **todos se sacaron de [Poly
Pizza](https://poly.pizza)** durante el desarrollo. Son packs libres (CC0 y CC-BY 3.0) de **Quaternius**,
**Kenney**, **J-Toastie**, **Isa Lousberg** y **Cube World Kit**, guardados por carpetas en `public/` — una
carpeta por pack, que es la unidad de atribución.

👉 **[CREDITS.md](CREDITS.md)** dice de dónde sale cada carpeta, con qué licencia, qué obliga esa licencia,
qué modificamos de cada pack y por qué (y qué partes del mundo sí son nuestras: terreno, cel-shading,
colocación y escala).

Los personajes de `public/characters/` y los props de `public/camp/` son **CC-BY 3.0**, así que su crédito
tiene que seguir visible en la pantalla de selección de personaje (`src/ui/CharacterSelectScreen.tsx`).

## Smart contracts (Monad testnet)

Red: Monad testnet · chainId `10143` · RPC `https://testnet-rpc.monad.xyz` · explorador [MonadVision](https://testnet.monadvision.com).
Desplegados por `0x80d80c6C22568Fd0C03477520cFDDBD23F343f79`.

| Contrato | Archivo | Dirección on-chain | Tx de despliegue |
|---|---|---|---|
| `AcademyGatekeeper`: entrada al Coliseo Monad (matrícula, intentos e insignias soulbound de los jefes) | [`contracts/AcademyGatekeeper.sol`](contracts/AcademyGatekeeper.sol) | [`0xf78eb07A3F8eE9dac89BA396E7D7110025C84C0f`](https://testnet.monadvision.com/address/0xf78eb07A3F8eE9dac89BA396E7D7110025C84C0f) | [`0x052913bc…08a3`](https://testnet.monadvision.com/tx/0x052913bc40332c69e63b25c5f5f2b008f97857446975625221eb7055142208a3) |
| `PokeMart`: tienda del Poké Mart que cobra en MON y reenvía el pago a la tesorería (`0x80d8…3f79`) | [`contracts/PokeMart.sol`](contracts/PokeMart.sol) | [`0x96814bbf393a72f4Ef89d290F8bfe50B8bb76F87`](https://testnet.monadvision.com/address/0x96814bbf393a72f4Ef89d290F8bfe50B8bb76F87) | [`0x288daca2…954c`](https://testnet.monadvision.com/tx/0x288daca2422892455159e647cdcc3221cb6fdbae627bdb29f036e106dca2954c) |

- La dirección de `AcademyGatekeeper` va en `VITE_ACADEMY_CONTRACT` (`.env.local`). La de `PokeMart` es el secret `MON_MART_CONTRACT` de la función `game`; el cliente la recibe con la acción `mon-mart`.
- Tests: `forge test` (11 pruebas en `test/`). Pasos de despliegue en [`docs/deploy.md`](docs/deploy.md).
- Compra de ejemplo con el contrato: [tx `0x969892fe…affb`](https://testnet.monadvision.com/tx/0x969892fe7507b763a031448721a618dbb466d6b15e3c8f290bff75d4523aaffb).

## Documentación

- [`CREDITS.md`](CREDITS.md) — origen y licencia de los assets 3D
- [`docs/guia-web3.md`](docs/guia-web3.md) — la capa onchain
- [`docs/deploy.md`](docs/deploy.md) — despliegue
