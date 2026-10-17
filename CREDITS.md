# Créditos de los assets 3D

**Ningún modelo 3D de este repo es obra nuestra, y todos se sacaron del mismo sitio: [Poly
Pizza](https://poly.pizza).** Todo lo que se ve en el mundo —el avatar que controlas, los monstruos
salvajes, los árboles, las ruinas, los embarcaderos, los bancos del parque— se descargó durante el
desarrollo desde Poly Pizza, que es un buscador de modelos 3D libres: cada modelo llega ya con su autor y su
licencia (CC0 o CC-BY 3.0) declaradas en la ficha.

Lo nuestro es el terreno, la dirección de arte, el cel-shading, la instanciación y el juego. Los modelos
están tomados prestados y este documento dice de qué pack y de qué autor sale cada carpeta.

Son **327 archivos `.glb`, ~51 MB**, repartidos en 11 carpetas dentro de `public/`. Cada carpeta es un pack
distinto, y por eso están separadas: la carpeta *es* la unidad de atribución.

---

## Tabla de origen

Todos descargados de <https://poly.pizza>. La columna **Autor** es el crédito que pide la ficha de Poly
Pizza de ese pack.

| Carpeta | Archivos | Pack | Autor | Licencia | Qué hace en el juego |
|---|---|---|---|---|---|
| `public/mega/` | 68 | Stylized Nature MegaKit | Quaternius | CC0 | Toda la flora del mundo: árboles, pinos, helechos, setas, cantos rodados, losas de camino. Es el pack que define el aspecto de la región. |
| `public/monsters/` | 65 | Ultimate Monsters | Quaternius | CC0 | Los monstruos salvajes que capturas. Vienen con esqueleto y animaciones dentro del GLB (Idle, Walk, Punch, Bite, HitReact, Death, Dance). |
| `public/nature/` | 72 | Nature Kit | Kenney | CC0 | Props sueltos de bosque: troncos, tocones, setas, nenúfares, cactus, estatuas, musgo colgante. |
| `public/pirate/` | 28 | Pirate Kit | Kenney | CC0 | La costa: embarcaderos, barcos, cañones, casas, cofres, palmeras. Las palmeras además visten las dunas. |
| `public/dungeon/` | 27 | Modular Dungeons | Quaternius | CC0 | Las ruinas y el fuerte de la meseta: arcos, columnas, muros modulares, barriles, antorchas, cofres. |
| `public/characters/` | 17 | NPCs y avatares de ciudadano | **J-Toastie** | **CC-BY 3.0** | El elenco de entrenadores: ciudadanos, policías, trabajadores, crypto-bro, Papá Noel, el tipo-gallina. |
| `public/characters/` (4 de ellos) | 4 | Ultimate Monsters / Animated Monster Pack | Quaternius | CC0 | Los cuatro personajes jugables animados: goblin, esqueleto, dragón y blob. Ver *Modelos derivados* abajo. |
| `public/critters/` | 9 | Cube World Kit | Cube World Kit | CC0 | Fauna ambiental sin IA: ovejas, cerdos, gallinas, pollitos, mapaches, erizos, perros, gatos. |
| `public/park/` | 17 | Pretty Park Set | **Isa Lousberg** | CC0 | El jardín diseñado a mano del prado: banco, farola, papelera, setos, fuente. |
| `public/camp/` | 7 | Props de campamento | **J-Toastie** | **CC-BY 3.0** | El campamento inicial: tienda, hoguera, troncos, hacha. |
| `public/props/` | 5 | Cube World Kit | Cube World Kit | CC0 | Cristales, cofres y cajones repartidos por la plaza y el campamento. |
| `public/stylized/` | 12 | Ultimate Stylized Nature Pack | Quaternius | CC0 | **Pack anterior, ya no se carga.** Se queda en el repo como referencia del cambio de look (ver abajo). |

La paleta de texturas con la que se armonizan los packs entre sí es de **Kay Lousberg**.

### Dónde buscarlos

- **Poly Pizza** — <https://poly.pizza> — de aquí salió todo. Buscando el nombre del pack o del autor
  aparece la ficha con la licencia y la descarga en `.glb`, que es el formato que servimos tal cual.
- Páginas de los autores, por si se quiere el pack completo en origen:
  **Quaternius** <https://quaternius.com> · **Kenney** <https://kenney.nl/assets> ·
  **Kay Lousberg** <https://kaylousberg.com>

---

## Qué obliga cada licencia (y cómo lo cumplimos)

**CC0** (Quaternius, Kenney, Cube World Kit, Pretty Park Set). Dominio público: no exige crédito, ni
siquiera para uso comercial. Lo damos igualmente porque es lo correcto y porque alguien que lea el código
tiene derecho a saber de dónde salió cada cosa.

**CC-BY 3.0** (J-Toastie: `public/characters/` y `public/camp/`). **Sí exige crédito visible.** Por eso la
atribución no vive solo en este archivo: está impresa en la pantalla de selección de personaje, donde el
jugador la ve antes de empezar a jugar.

- Texto: `src/i18n/es.ts` → `select.credit` · `src/i18n/en.ts` → `select.credit`
- Render: `src/ui/CharacterSelectScreen.tsx` (el comentario del código marca que esa línea **no se puede
  borrar**)

> *"Personajes y objetos del campamento: J-Toastie (poly.pizza), CC-BY 3.0 — paleta de texturas: Kay Lousberg"*

---

## Modelos derivados: qué tocamos y por qué

Ningún modelo se ha remodelado. Las únicas modificaciones son de material y de formato, y cada una tiene su
script en `scripts/` para que sea reproducible y auditable.

### 1. `scripts/prepare-assets.mjs` — preparar un pack descargado para el navegador

```bash
node scripts/prepare-assets.mjs ../assets/stylized-nature public/stylized
```

- Quita el slot de *normal map* y el de oclusión. Bajo cel-shading la luz cae en bandas duras y el
  microrrelieve no llega a verse, pero pesa ~1 MB por árbol (en el Ultimate Stylized Nature eran ~10 de sus
  23 MB).
- Corrige `metalness`: los packs exportan 0.4 en assets de naturaleza, que es lo que dejaba árboles y rocas
  con brillo de plástico.
- `dedup` + `prune` y recompresión de texturas a WebP. Con tope de 512 px, el MegaKit baja de 13 MB a 4.

### 2. `scripts/harmonize-nature-pack.mjs` — meter el Nature Kit de Kenney en la paleta de Quaternius

El pack de Kenney trae `metallicFactor = 1` en sus 139 materiales y valores sRGB metidos en
`baseColorFactor`, que glTF define como lineal. Y sobre todo: su paleta no es la del mundo (sus verdes son
turquesa, su piedra azul hielo, su madera naranja brillante, frente al verde oliva y la roca gris cálida de
Quaternius). Con las dos paletas juntas la decoración no parecía decoración, parecía de otro juego. Los
colores objetivo salen de medir el color medio de las texturas del pack de Quaternius, no de elegirlos a
ojo. Es idempotente.

### 3. `scripts/brighten-model.mjs` — aclarar un modelo sin tocar geometría ni animaciones

```bash
node scripts/brighten-model.mjs public/monsters/GreenBlob.glb public/characters/blob.glb 3
```

**De aquí salen dos de los cuatro personajes jugables:** `characters/blob.glb` y `characters/dragon.glb` son
copias aclaradas de modelos del pack de monstruos de Quaternius. Algunos traen el `baseColorFactor` muy
oscuro (el blob verde está en 0.037/0.067/0.028 lineal, que en pantalla es un verde oliva casi negro). En un
prop repartido por el mundo no se nota; en el personaje que ocupa el centro de la pantalla, sí. Se multiplica
el factor —acotado a 1— y vuelve al color del render original del autor, sin repintar una sola textura.

---

## Por qué `public/stylized/` sigue ahí

Es el **Ultimate Stylized Nature Pack** de Quaternius, el que vestía la versión anterior del mundo. Lo
sustituyó el **Stylized Nature MegaKit**, del mismo autor, y el cambio fue deliberado: mismo acabado (así
que el mundo sigue siendo coherente) pero siluetas completamente distintas —árboles retorcidos de copa
ancha, pinos de capas marcadas, helechos, setas, cantos rodados— de modo que un prado del pack nuevo no se
confunde con uno del viejo ni mirándolo de lejos. Se documenta en `src/world/stylized.ts`.

---

## Lo que **no** viene de un pack

Para que quede claro dónde está la frontera:

- **El terreno** (`src/world/terrain.ts`): alturas, biomas, costa, caminos y sitios construidos son
  procedurales, generados por nuestro código.
- **El cel-shading y la armonización de color** (`src/world/toon.ts`, `src/world/instancing.ts`): los packs
  llegan con texturas muy saturadas y de paletas distintas; una sola luz toon y un tinte por rol de material
  es lo que hace que once packs de cinco autores parezcan un solo juego.
- **La hierba procedural con viento** (`src/world/GrassTufts.tsx`).
- **La colocación**: qué especie crece en qué bioma, a qué altura real en metros y en grupos de qué tamaño
  (`src/world/stylized.ts`); y los conjuntos puestos a mano —embarcadero pirata, puerto de dunas, ruinas,
  fuerte— en `src/world/Landmarks.tsx`.
- **El escalado a metros reales**: los packs vienen en escalas incompatibles (los de Kenney rondan 20-100 cm
  nativos, los del Cube World Kit son cubos de 2 m, los del campamento sí están en metros). La tabla
  `PROP_SIZE` de `src/world/Decor.tsx` los lleva a todos a la misma escala, calibrada contra el jugador
  (~1.8 m).
- **Los coliseos, el aula, la UI, los contratos y toda la capa Monad.**

---

## Y el juego en sí

El diseño del juego es una reinterpretación de **PokeGrass** (`pokegrass.com`) llevada a Monad. La auditoría
de qué tiene el original y qué tenemos nosotros está en [`docs/paridad-original.md`](docs/paridad-original.md).
