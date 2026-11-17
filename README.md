# Cora · ¿Dónde está?

Un juego de geografía sobre una Tierra en 3D: aparece una pista (el nombre y/o la bandera de un país) y hay que hacer clic en ese país del globo. Diez países por partida, cuatro dificultades, cronómetro y puntuación. El globo se puede girar y acercar, con imágenes de satélite que ganan detalle al hacer zoom; de fondo hay un sol, una luna y un cielo de estrellas. Incluye una página con la lista de todos los países.

## Cómo ejecutarlo

Requisitos: Node.js (probado con v24) y npm. Hace falta conexión a internet para las imágenes de alta resolución.

```bash
npm install      # solo la primera vez
npm run dev      # servidor de desarrollo en http://localhost:5173
```

| Script            | Qué hace                                                      |
| ----------------- | ------------------------------------------------------------- |
| `npm run dev`     | Servidor de desarrollo con recarga automática al guardar.     |
| `npm run build`   | Genera la versión de producción en `dist/` (las dos páginas). |
| `npm run preview` | Sirve la carpeta `dist/` para probar el build de producción.  |

> Al hacer `build`, Vite avisa de que un archivo supera 500 kB. Es normal con Three.js y no es un error.

| Página | URL |
| --- | --- |
| Globo | http://localhost:5173/ |
| Lista de países | http://localhost:5173/paises.html (también enlazada desde el menú del juego) |

## El juego

### Cómo se juega

1. **Menú principal**: *Jugar*, *Modo prueba* o *Configuración*. Detrás, el globo gira solo.
2. **Jugar** → se elige la dificultad.
3. **Cuenta atrás** 3, 2, 1 y “¡Ya!”: en ese momento aparece la primera pista y el cronómetro empieza en 0.
4. **10 países al azar** (sin repetir). Para cada uno se hace clic en el globo:
   - **Acierto** (1 punto): el país se pinta de verde y aparece su nombre sobre el pin.
   - **Fallo** (0 puntos): el país elegido se pinta de rojo, el correcto de verde, y la cámara viaja hasta el correcto.
   - Un clic en el **mar** lejos del país no cuenta como respuesta: avisa “Eso es mar, prueba otra vez”.
5. **Resultado**: puntos, tiempo total y la lista de los 10 países con ✓/✗. *Jugar otra vez* empieza otra partida con la misma dificultad (países nuevos); *Volver al menú* vuelve al menú principal.

Durante la partida se puede girar y hacer zoom con normalidad (un arrastre no cuenta como clic), y el botón **Salir** vuelve al menú.

El **tiempo** cuenta solo mientras se está buscando el país: se para durante las pausas que muestran si se acertó (1.2 s al acertar, 2.6 s al fallar), para no penalizar la animación.

### Dificultades

| Dificultad | Países | Pista | Extra |
| --- | --- | --- | --- |
| Fácil | 198 estados | Nombre + bandera | Se ven las fronteras |
| Normal | 198 estados | Solo el nombre | — |
| Difícil | Todos (239 con bandera) | Solo la bandera | — |
| Hardcore | Todos (239 con bandera) | Solo la bandera | **10 segundos por país**; si se acaban, cuenta como fallo (barra de tiempo bajo la pista) |

- En difícil y hardcore entran también territorios dependientes e indeterminados. Quedan fuera los 3 que no tienen bandera (Somalilandia, Chipre del Norte, Glaciar de Siachen), porque su pista sería imposible.
- Con pista **solo de bandera**, vale cualquier país que tenga **esa misma bandera** (p. ej. los territorios australianos usan la de Australia).
- **Países diminutos** (Vaticano, Mónaco, islas del Pacífico…): si el país ocupa en pantalla menos de 25 px, vale un clic a menos de 15 px de él, porque si no serían casi imposibles de acertar sin mucho zoom.

### Modo prueba

Para practicar con reglas a medida. Desde el menú principal, *Modo prueba* abre una pantalla con:

| Opción | Valores |
| --- | --- |
| Continentes | Varios a la vez: África, Asia, Europa, América del Norte (incluye Centroamérica y el Caribe), América del Sur, Oceanía, Antártida e Islas oceánicas (Maldivas, Mauricio, Seychelles…). Con atajos *Todos* / *Ninguno*. |
| Tipos de país | Estados, territorios dependientes, estatus indeterminado (varios a la vez). |
| Pista | Nombre del país y/o bandera (al menos una). |
| Mapa | Mostrar fronteras o no. |
| Idioma de los nombres | Español, English, Português (independiente del idioma de *Configuración*). |
| Tiempo por país | Sin límite, 5, 10, 20 o 30 s. Si se acaba, cuenta como fallo. |
| Países por partida | 5, 10, 20 o todos los de la selección. |

- Junto a cada continente y tipo se ve cuántos países aporta con el resto de filtros, y abajo el total disponible (“12 países disponibles · partida de 5”).
- Si la combinación no deja jugar (sin pista, sin continentes, sin tipos o ningún país que cumpla las reglas), el botón *Empezar* se desactiva y se explica por qué.
- Con pista solo de bandera se excluyen los países sin bandera.
- La partida funciona igual que las normales (cuenta atrás, cronómetro, resultado); *Jugar otra vez* repite las mismas reglas con países nuevos.
- La última configuración se recuerda entre visitas.

### Configuración

Se guarda en el navegador (`localStorage`), así que se recuerda entre visitas:

- **Sonido**: activa o desactiva los efectos (cuenta atrás, acierto, fallo, tiempo agotado, fin de partida). Se generan en el navegador, sin archivos de audio.
- **Idioma de las pistas**: español, inglés o portugués. Cambia el nombre de los países en las pistas, en el aviso de fallo, en la etiqueta del pin y en la lista del resultado; el resto de la interfaz sigue en español.

## Estructura de archivos

```
cora/
├── index.html                    Página del globo
├── paises.html                   Página con la lista de países
├── vite.config.js                Declara las dos páginas para el build
├── package.json                  Dependencias (three; vite y flag-icons para desarrollo)
├── README.md                     Este documento
├── public/                       (se sirve tal cual en la raíz del sitio)
│   ├── data/
│   │   ├── countries.json        Los 242 países con nombres, bandera y polígonos (lo carga el globo)
│   │   └── countries-list.json   Lo mismo sin polígonos (lo carga paises.html; legible a mano)
│   ├── flags/                    Banderas en SVG, una por código ISO (es.svg, fr.svg…)
│   └── textures/
│       └── earth_day_4k.jpg      Textura global de la Tierra (base bajo las teselas)
├── scripts/
│   └── prepare-countries.mjs     Genera data/ y flags/ a partir de Natural Earth y flag-icons
└── src/
    ├── main.js        El globo: escena, astros, Tierra, navegación, pin, clics y API para el juego
    ├── game.js        El juego: menús, dificultades, partida, cronómetro, resultado
    ├── settings.js    Configuración (sonido, idioma) guardada en el navegador
    ├── sound.js       Efectos de sonido generados con Web Audio
    ├── tiles.js       Capa de teselas de alta resolución con nivel de detalle
    ├── countries.js   Carga de países, detección, fronteras y relleno del país
    ├── geo.js         Utilidades geográficas: lon/lat ↔ 3D, Mercator, parches de esfera
    ├── style.css      Estilos del juego: menús, HUD, cuenta atrás, etiqueta del pin, créditos
    ├── paises.js      Lógica de la lista de países (tabla y buscador)
    └── paises.css     Estilos de la lista de países
```

## Países

### Cuántos son

**242 en total**, según Natural Earth (escala 1:50 millones):

| Tipo | Cuántos | Qué incluye |
| --- | --- | --- |
| Estado | 198 | Se gobierna a sí mismo. Además de los miembros de la ONU incluye, por ejemplo, el Vaticano, Taiwán, Kosovo, Somalilandia y la República Turca del Norte de Chipre. |
| Territorio dependiente | 40 | Depende de otro estado: Puerto Rico, Groenlandia, Hong Kong, Islas Malvinas… |
| Estatus indeterminado | 4 | Antártida, Sahara Occidental, Palestina y el Glaciar de Siachen. |

La clasificación la hace `scripts/prepare-countries.mjs` (función `classify`): es *estado* si en Natural Earth el territorio es su propio soberano (`ADMIN = SOVEREIGNT`), *indeterminado* si Natural Earth lo marca así, y *territorio* en el resto de casos.

### Dónde ver la lista

- **En el navegador**: http://localhost:5173/paises.html, con bandera, nombre en español, inglés y portugués, código ISO, tipo y continente, y un buscador (busca en los tres idiomas, el código y el continente, sin importar tildes).
- **En un archivo**: `public/data/countries-list.json`. Cada país tiene esta forma:

```json
{
  "name_es": "España",
  "name_en": "Spain",
  "name_pt": "Espanha",
  "iso": "ES",
  "iso3": "ESP",
  "type": "estado",
  "sovereign": "Spain",
  "continent": "Europe",
  "flag": "/flags/es.svg"
}
```

### Banderas

239 de los 242 tienen bandera, guardada en `public/flags/<iso>.svg` (del paquete [flag-icons](https://github.com/lipis/flag-icons), licencia MIT, proporción 4:3). Algunos territorios comparten la del país del que dependen (por ejemplo, los territorios australianos usan la de Australia), por eso hay 237 archivos. **Sin bandera** (no tienen código ISO oficial): Somalilandia, República Turca del Norte de Chipre y Glaciar de Siachen; en la lista aparecen con “—” y en la etiqueta del pin solo con el nombre.

### Regenerar los datos

```bash
curl -L -o ne.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
node scripts/prepare-countries.mjs ne.geojson
```

El script redondea las coordenadas a 3 decimales (~100 m), ordena los países por su nombre en español, regenera `public/data/` y `public/flags/`, e imprime el recuento por tipo y los países sin bandera.

Limitación: a esta escala los contornos están simplificados (precisión de ~1 km). Al acercarse mucho se nota que fronteras y costas no coinciden exactamente con la imagen, y un clic muy pegado a la costa de un país diminuto (Mónaco, por ejemplo) puede caer en “Océano”.

## Código

### `index.html` y `src/style.css`

- **Pantallas** (`.screen`): `#screen-menu`, `#screen-difficulty`, `#screen-practice`, `#screen-settings` y `#screen-results`. El formulario del modo prueba (`#practice-form`) lo crea `game.js`. Cada una es un panel centrado; la capa que lo contiene deja pasar el ratón, así que el globo se puede seguir girando detrás. Los botones de dificultad y de idioma los crea `game.js`.
- **HUD** (`#hud`): marcador arriba a la izquierda (país X/10, puntos, cronómetro), botón *Salir* arriba a la derecha, y en el centro la pista (`#hint`: bandera y/o nombre), la barra de tiempo de hardcore (`#round-timer`) y el aviso de acierto/fallo (`#feedback`).
- `#countdown`: números grandes de la cuenta atrás, con una animación de “pop”.
- `.pin-label`: etiqueta sobre el pin con bandera y nombre; borde verde (`.is-correct`) o rojo (`.is-wrong`).
- `#credits`: créditos de las imágenes y los datos, abajo a la derecha. Las licencias de las imágenes (CC BY 4.0 y CC BY-NC-SA 4.0) obligan a citar la fuente, así que no conviene quitarlo.
- Los colores están en variables CSS al principio (`--correct`, `--wrong`, `--accent`…).

### `src/main.js`

#### Constantes de configuración (al principio del archivo)

| Constante | Valor | Para qué sirve |
| --- | --- | --- |
| `SPHERE_RADIUS` | `1` | Radio de la Tierra en la escena (equivale a `EARTH_RADIUS_KM` = 6371 km). |
| `CLICK_MOVE_TOLERANCE` | `5` | Píxeles de movimiento a partir de los cuales es arrastre y no clic. |
| `SHOW_BORDERS` | `false` | Fronteras en el menú. Durante la partida las decide la dificultad (solo en fácil). |
| `TILE_URL` | Sentinel-2 cloudless 2024 | Plantilla de URL de las teselas (`{z}`, `{x}`, `{y}`). En el comentario está la URL de la versión 2016, por si hace falta uso comercial. |
| `TILE_MAX_ZOOM` | `14` | Nivel máximo de teselas (≈ 10 m por píxel). |
| `ZOOM_MIN_ALTITUDE_KM` | `650` | **Límite de zoom**: lo más cerca del suelo que se puede llegar. Por debajo de ~10 km las teselas se verían borrosas. |
| `ZOOM_MAX_ALTITUDE_KM` | `57000` | Lo más lejos que se puede alejar (la vista inicial está a ~19 000 km). |
| `ZOOM_SENSITIVITY` | `0.003` | Cuánto zoom da cada movimiento de la rueda. Más alto = zoom más rápido. |
| `ZOOM_SMOOTHING` | `12` | Rapidez con la que la cámara alcanza el zoom pedido. Más alto = más directo; más bajo = más suave. |
| `ROTATE_SPEED` | `0.25` | Velocidad del arrastre, relativa a la altura. Más alto = gira más por cada píxel arrastrado. |

#### Escena básica

- `camera`: perspectiva de 45°, empieza en `(0, 0, 4)` (≈ 19 000 km de altura). Su plano cercano se ajusta cada frame a la altura (`updateCameraNear`) para que el suelo no se recorte de cerca.
- `renderer`: WebGL a pantalla completa con antialiasing, densidad de píxeles limitada a 2 y **buffer de profundidad logarítmico**, que permite tener en la misma escena el suelo a pocos km y el sol muy lejos sin que las capas (teselas, fronteras) parpadeen entre sí.

#### Astros de fondo (sol y luna)

| Función | Qué hace |
| --- | --- |
| `createGlowingSphereMaterial(edgeColor)` | Shader propio: blanco en el centro que se funde hacia `edgeColor` en el borde. Ignora las luces, así que el astro “brilla por sí mismo”. El `3.0` de `pow(vFacing, 3.0)` controla el tamaño de la zona blanca. Incluye los fragmentos de profundidad logarítmica de three. |
| `createGlowTexture()` | Degradado radial en un canvas que sirve de textura para el aura (compartida por sol y luna). |
| `createLuminousBody(opciones)` | Esfera + aura (`Sprite` aditivo) + `DirectionalLight` desde su posición hacia el centro. Opciones: `position`, `radius`, `edgeColor`, `auraColor`, `auraOpacity`, `lightColor`, `lightIntensity`. |

- **Sol**: en `(-30, 12, -40)`, radio `SUN_RADIUS = 3`, borde ocre `0x8a7550`, luz `0xfff6ea` de intensidad `SUN_LIGHT_INTENSITY = 1.4`.
- **Luna**: en `(26, 9, -30)`, radio `SUN_RADIUS * 0.27`, borde gris azulado, aura azul pálido al 50 %, luz fría al 10 % de la del sol (`MOON_LIGHT_RATIO`).
- **Luz ambiental**: azulada, intensidad `0.55`, para que la cara de noche no quede negra.

#### Fondo de estrellas

`createStarfield({ count = 4000, minRadius = 60, maxRadius = 85 })`: puntos en direcciones aleatorias, detrás del sol y la luna, con brillo variado (la mayoría tenues), un tinte sutil frío o cálido, forma circular y tamaño fijo en pantalla (`size: 2.5`).

#### Navegación

- **Arrastre**: `OrbitControls` con inercia (`dampingFactor = 0.08`) y sin desplazamiento lateral. `updateRotateSpeed(altitude)` pone la velocidad de giro en `ROTATE_SPEED × altura` (entre 0.002 y 1), así que de cerca arrastrar mueve más o menos lo que se ve.
- **Zoom con rueda o trackpad**: no lo hace `OrbitControls`; se intercepta el evento `wheel` y cada movimiento **multiplica la altura** sobre el suelo (no la distancia al centro), por lo que el zoom es igual de ágil a 20 000 km que a 25 km. `updateZoom(dt)` lleva la cámara hacia la altura pedida de forma progresiva, interpolando en escala logarítmica para que se vea igual de suave a cualquier altura.
- **Pellizco**: lo gestiona `OrbitControls` (`zoomSpeed = 1.2`), con los mismos límites.
- **Límite de zoom**: `controls.minDistance` y `controls.maxDistance` salen de `ZOOM_MIN_ALTITUDE_KM` y `ZOOM_MAX_ALTITUDE_KM`, y los respetan tanto la rueda como el pellizco.

#### La Tierra

Se dibuja en dos capas:

1. **Textura global** (`earthTexture`): `public/textures/earth_day_4k.jpg`, 4096 × 2048, de [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0). Se ve al instante al abrir la página, en los polos (las teselas no pasan de ±85°) y si no hay conexión. Su esfera (`sphere`, 128 segmentos) va un 0.02 % por debajo del radio real para quedar siempre bajo las teselas.
2. **Teselas** (`tileLayer`, ver `src/tiles.js`): [Sentinel-2 cloudless 2024](https://s2maps.eu) de EOX, un mosaico sin nubes con el mar en azul y colores naturales, sin clave, hasta el nivel 14 (≈ 10 m por píxel).

> **Licencia de las imágenes**: la versión 2024 es **CC BY-NC-SA 4.0, solo para uso no comercial**. Para un uso comercial hay que comprar una licencia a EOX o volver a la versión 2016 (CC BY 4.0, uso comercial permitido; su URL está en un comentario junto a `TILE_URL`). La de 2016 tiene dos defectos visibles: franjas verticales (las pasadas del satélite en fechas distintas, muy visibles en África) y desiertos muy claros.

- `createEarthMaterial(texture)`: material de la Tierra para una textura (la global y cada tesela). `MeshStandardMaterial` con la textura como color base y como **emisiva**, para que el planeta tenga luz propia (`EARTH_GLOW` = 0.45).
- `earthShader`: se engancha en `onBeforeCompile` y modifica el shader estándar de three para:
  - subir la **saturación** de la textura (`EARTH_SATURATION` = 1.1; 1 = colores originales);
  - suavizar las **zonas muy claras** (desiertos, hielo) sin tocar las oscuras: por encima de `EARTH_HIGHLIGHT_KNEE` (0.2) de luminosidad el brillo crece cada vez menos, según `EARTH_HIGHLIGHT_COMPRESSION` (2.5; 0 = sin efecto). Una zona de arena pierde ~20 % de brillo y el hielo ~50 %; bosques y sabanas no cambian;
  - pintar el **relleno verde del país** con pin: calcula la longitud y latitud de cada píxel a partir de su posición y mira si cae dentro del país en la máscara de `createCountryMask`. Así el relleno va pegado al suelo a cualquier zoom, sin geometría extra.

  Es una sola función compartida, así que todas las teselas usan el mismo programa de GPU, y los uniforms del relleno son los mismos objetos para todos los materiales.

#### Países: fronteras y resaltado

- `loadCountries()` descarga `/data/countries.json` en segundo plano (`countriesReady` es la promesa). Al llegar se crean las fronteras (`borders`), líneas blancas semitransparentes ~250 m por encima del suelo.
- `setBordersVisible(visible)`: muestra u oculta las fronteras.
- `CORRECT_COLOR` (verde `#2ecc71`) y `WRONG_COLOR` (rojo `#ff4d4f`): colores de los países acertado y fallado. `MASK_OPACITY` (0.45) deja ver el terreno debajo.
- `masks`: dos máscaras de `createCountryMask` (`correctMask` y `wrongMask`) que pinta el shader de la Tierra.
- `setHighlights({ correct, wrong })`: rellena y contornea el país correcto en verde y, si lo hay, el equivocado en rojo. Sin argumentos lo quita todo.

#### Pin y etiqueta

| Función / variable | Qué hace |
| --- | --- |
| `PIN_HEIGHT`, `PIN_STICK_RADIUS`, `PIN_HEAD_RADIUS` | Medidas del pin (0.12, 0.004 y 0.023: 2/3 del pin original) a la distancia de referencia `PIN_REFERENCE_DISTANCE` = 3, que es la de la vista inicial. |
| `createPin()` | Aguja roja (`0xff5a5f`) con la punta en cono y una cabeza esférica. La punta está en el origen del grupo y apunta hacia +Y. |
| `pin` | El único pin, hijo de la Tierra. |
| `label` / `labelEl` | Etiqueta HTML (`CSS2DObject`) encima de la cabeza del pin, con bandera y nombre. |
| `placePin(localPoint)` | Coloca el pin sobre la superficie, perpendicular a ella. |
| `removePin()` | Oculta el pin (y con él la etiqueta). |
| `setPinLabel({ flag, text, kind })` | Contenido de la etiqueta: bandera, texto y estilo (`correct` o `wrong`). |
| `updatePin()` | Cada frame escala el pin según su distancia a la cámara: **al hacer zoom se acorta**, de modo que en pantalla mide siempre lo mismo y no tapa países pequeños. Además oculta la etiqueta si el pin queda en la cara oculta del planeta. |

#### Clic vs. arrastre

En `pointerdown` se guarda la posición; en `pointerup`, si el puntero se movió más de `CLICK_MOVE_TOLERANCE` px, fue un arrastre. Si fue un clic, se lanza un rayo desde la cámara contra la **esfera matemática exacta** (`earthBounds`), no contra la malla, para que el punto caiga justo donde se hace clic incluso a pocos km del suelo. Si corta la Tierra, se llama a `globe.onEarthClick` con `{ lon, lat, localPoint, kmPerPixel, country }`: el país bajo el clic (o `null` si es mar) y cuántos km de suelo ocupa un píxel en ese punto (para la ayuda con países diminutos).

#### Vuelo de la cámara

`flyTo(lon, lat, duración)` gira la cámara alrededor del planeta hasta quedar sobre ese punto, con aceleración y frenado suaves. Mantiene la altura, pero sin bajar de ~2200 km ni subir de ~19 000 km, para que se vea el país entero. Mientras vuela, los controles se desactivan. El juego lo usa para enseñar el país correcto tras un fallo.

#### API del globo para el juego

Al final, `main.js` crea el objeto `globe` y llama a `createGame(globe)`:

| Propiedad | Qué es |
| --- | --- |
| `countriesReady` | Promesa con la lista de países. |
| `onEarthClick` | Función que el juego asigna para recibir los clics sobre la Tierra. |
| `menuBordersVisible` | Si se ven las fronteras en el menú (`SHOW_BORDERS`). |
| `setBordersVisible`, `setHighlights`, `placePin`, `removePin`, `setPinLabel`, `flyTo` | Las funciones descritas arriba. |
| `setAutoRotate(enabled)` | Giro automático lento del globo (en los menús). |

#### Bucle

`setAnimationLoop`, en cada frame: aplica el zoom suave y el vuelo de la cámara, ajusta la velocidad de giro y el plano cercano a la altura, actualiza los controles, decide qué teselas mostrar o descargar, escala el pin y dibuja la escena y la capa de etiquetas.

### `src/tiles.js`

`createTileLayer(opciones)` devuelve `{ group, update(camera, viewportHeight) }`.

Cómo decide qué teselas hacen falta (como Google Maps, pero sobre una esfera):

1. Parte de las 16 teselas del nivel 2 y recorre un árbol cuaternario (cada tesela tiene 4 hijas en el nivel siguiente).
2. Descarta las que quedan detrás del horizonte o fuera del campo de visión de la cámara.
3. Si una tesela ocupa en pantalla más de `tileSize × splitFactor` (256 × 1.1 px) y no es el nivel máximo, la subdivide; si no, es una de las necesarias.

Mientras una tesela se descarga se muestra su antecesora más cercana ya descargada (o la textura global), así que nunca aparecen huecos. Cada nivel se dibuja ~13 m más alto que el anterior, así que el más detallado queda encima. Las imágenes se decodifican **fuera del hilo principal** (`ImageBitmapLoader`), así que la llegada de teselas no provoca tirones. Las mallas de las teselas grandes tienen más segmentos (paso máximo `maxSegmentDeg` = 1.4°) para seguir la curvatura.

**Polos.** Las teselas Web Mercator solo llegan a ±85.05°. Para que no quede un círculo con la textura global (blanca y borrosa en los polos), las teselas de la fila del borde llevan un **casquete hasta el polo** que estira su última fila de píxeles, así que el color continúa sin corte. El polo cuenta como parte de esas teselas al decidir si se ven, para que también se carguen al mirar un polo desde muy cerca. Justo en el polo el casquete se ve como un color liso, sin detalle.

Opciones: `url`, `maxZoom`, `radius`, `createMaterial`, `anisotropy` y, con valores por defecto, `minZoom` (2), `tileSize` (256), `splitFactor` (1.1), `maxSegmentDeg` (1.4), `maxConcurrent` (12 descargas a la vez) y `maxCached` (300 teselas en memoria; al pasar de ahí se liberan las que llevan más tiempo sin usarse).

**Usar otro proveedor de imágenes.** Sirve cualquier servicio de teselas XYZ en Web Mercator: cambia `TILE_URL` y `TILE_MAX_ZOOM` y, si da más o menos detalle, ajusta `ZOOM_MIN_ALTITUDE_KM`. Revisa sus condiciones de uso: muchos exigen clave o atribución, o limitan el uso comercial. EOX ofrece este servicio gratis, pero para producción con mucho tráfico recomienda contratar su plan.

### `src/countries.js`

| Función | Qué hace |
| --- | --- |
| `loadCountries(url)` | Descarga el JSON y precalcula la caja lon/lat de cada polígono para que la búsqueda sea rápida. |
| `findCountry(countries, lon, lat)` | Devuelve el país que contiene el punto, o `null` si es mar. Descarta por caja y luego aplica *ray casting* (point-in-polygon) respetando los huecos (Lesoto dentro de Sudáfrica; el Vaticano y San Marino dentro de Italia). Tarda ~0.2 ms. |
| `createBorders(countries, radius, material)` | Todas las fronteras en un único `LineSegments`. Los tramos de más de 0.25° se subdividen para que sigan la curva de la Tierra y no se hundan bajo el terreno de cerca. |
| `createCountryOutline(country, radius, material)` | El contorno de un solo país. |
| `createCountryMask({ name, color, opacity })` | Pinta el país en un canvas que cubre solo su recuadro lon/lat (hasta 2048 px de lado, así que los países pequeños tienen mucha resolución), con regla *even-odd* para respetar los huecos. `name` es el prefijo de sus uniforms, para poder tener varias a la vez. Devuelve `uniforms` (los enlaza el shader de la Tierra) y `draw(country)`. |
| `distanceKm(lon1, lat1, lon2, lat2)` | Distancia sobre la superficie (haversine). |
| `distanceToCountryKm(country, lon, lat)` | Distancia desde un punto al vértice más cercano del contorno del país. |
| `countrySizeKm(country)` | Tamaño aproximado del país (diagonal de su recuadro). |
| `countryCenter(country)` | Centro de su polígono más grande, para llevar la cámara hasta él. |

Natural Earth corta los países en el antimeridiano (±180°), así que Rusia o Fiyi no necesitan tratamiento especial.

### `src/geo.js`

| Función | Qué hace |
| --- | --- |
| `lonLatToVector3(lon, lat, radius)` | De coordenadas geográficas a un punto 3D. Longitud 0° (Greenwich) en +X, 90°E en −Z, polo norte en +Y (la misma orientación que las texturas). |
| `vector3ToLonLat(v)` | La inversa. |
| `mercatorToLat(t)` | Latitud de una fila de teselas Web Mercator (`t` = 0 borde norte, 1 borde sur; ±85.05°). |
| `createSpherePatch(opciones)` | Malla de un rectángulo lon/lat de la esfera con su UV cubriendo toda la textura. La latitud de cada fila la da `latAt(s)` y, opcionalmente, su coordenada v la da `vAt(s)` (los casquetes polares la fijan en el borde de la tesela). |

### `src/game.js`

`createGame(globe)` monta los menús y el juego. Estados: `menu` → `countdown` → `playing` ⇄ `feedback` → `results`.

Una partida siempre se juega con un **objeto de reglas** (`rules`): `{ label, pool, showName, showFlag, borders, timeLimit, rounds, language }`. Las dificultades fijas (`DIFFICULTIES`) y el modo prueba (`rulesFromPractice`) producen ese mismo objeto, así que el resto del juego no distingue entre ellos.

| Constante / función | Qué hace |
| --- | --- |
| `ROUNDS` | Países por partida (10). |
| `COUNTDOWN_FROM` | Desde dónde cuenta la cuenta atrás (3). |
| `FEEDBACK_CORRECT_MS` / `FEEDBACK_WRONG_MS` | Pausa tras acertar (1200 ms) y tras fallar (2600 ms) antes del siguiente país. |
| `SMALL_COUNTRY_PX` / `CLICK_TOLERANCE_PX` | Ayuda para países diminutos (25 px / 15 px). |
| `DIFFICULTIES` | Cada dificultad: `label`, `description`, `pool` (qué países entran), `showName`, `showFlag`, `borders`, `timeLimit` (segundos por país o `null`) y `rounds`. Para añadir o cambiar una dificultad basta con tocar este objeto: los botones se generan a partir de él. |
| `CONTINENTS` / `TYPES` | Continentes y tipos de país del modo prueba, con su nombre en pantalla. |
| `TIME_OPTIONS` / `ROUND_OPTIONS` | Opciones de tiempo por país y de países por partida del modo prueba. |
| `rulesFromPractice(practice)` | Convierte la configuración del modo prueba en reglas de partida. |
| `setupPractice()` | Construye el formulario del modo prueba, guarda cada cambio y actualiza los recuentos y el botón *Empezar*. |
| `startGame(rules)` | Elige al azar `rules.rounds` países del `pool` (o todos, si hay menos), reinicia marcador y cronómetro, configura el globo (fronteras, sin giro automático) y lanza la cuenta atrás. |
| `startRound()` | Muestra la pista del país actual y limpia el resaltado. |
| `isCorrect(info)` | Acierto si se hizo clic en el país; con pista solo de bandera, también en uno con la misma bandera; y en países diminutos, también cerca de ellos. |
| `answer(correct, clicked)` | Suma el punto, pinta verde/rojo, pone la etiqueta, suena y, si falló, lleva la cámara al país correcto. |
| `finish()` | Pantalla de resultado con puntos, tiempo y lista. |
| `frame()` | Bucle propio (`requestAnimationFrame`): avanza el cronómetro solo en estado `playing` y, en hardcore, da el país por fallado al agotarse el tiempo. |

Todos los temporizadores (`later`) se cancelan al salir al menú, así que salir en mitad de la cuenta atrás o de una pausa no deja nada colgando.

### `src/settings.js` y `src/sound.js`

- `settings.js`: `loadSettings()` / `saveSettings()` con `localStorage` (clave `cora-settings`), con valores por defecto si el navegador no deja guardar. `LANGUAGES` define los idiomas de las pistas y `DEFAULT_PRACTICE` la configuración inicial del modo prueba (Europa, estados, nombre + bandera, con fronteras, sin límite de tiempo, 10 países).
- `sound.js`: `createSound(isEnabled)` devuelve `play(nombre)` con los efectos `tick`, `go`, `correct`, `wrong`, `timeout`, `finish` y `click`, hechos con osciladores de Web Audio. El contexto de audio se crea con el primer sonido (los navegadores solo dejan sonar tras una interacción).

### `paises.html`, `src/paises.js` y `src/paises.css`

Página independiente que carga `countries-list.json`, muestra el recuento por tipo y una tabla con todos los países. El buscador filtra al escribir. En pantallas estrechas se ocultan las columnas de inglés, portugués y continente.

## Capas de la escena

| Elemento | Distancia al centro |
| --- | --- |
| Textura global | radio 0.9998 |
| Teselas | radio 1.000006–1.00003 (sube con el nivel) |
| Fronteras | radio 1.00004 (~250 m sobre el suelo) |
| Contorno del país | radio 1.00005 |
| Cámara | entre 1.10 (650 km) y 9.95 (57 000 km) |
| Luna | ~41 |
| Sol | ~51 |
| Estrellas | entre 60 y 85 |
| Límite de dibujo | 100 desde la cámara |

## Ajustes rápidos

| Quiero… | Cambiar |
| --- | --- |
| Poder acercarme más o menos | `ZOOM_MIN_ALTITUDE_KM` (y `ZOOM_MAX_ALTITUDE_KM` para alejarse) |
| Zoom más rápido o más lento | `ZOOM_SENSITIVITY` |
| Zoom más suave o más directo | `ZOOM_SMOOTHING` |
| Arrastre más rápido o más lento | `ROTATE_SPEED` |
| Más o menos inercia al soltar | `controls.dampingFactor` |
| Países por partida | `ROUNDS` en `game.js` |
| Tiempo por país en hardcore | `timeLimit` de `hardcore` en `DIFFICULTIES` |
| Qué países entran en cada dificultad | `pool` en `DIFFICULTIES` |
| Opciones del modo prueba | `TIME_OPTIONS`, `ROUND_OPTIONS`, `CONTINENTS` en `game.js`; valores iniciales en `DEFAULT_PRACTICE` (`settings.js`) |
| Duración de las pausas tras responder | `FEEDBACK_CORRECT_MS` / `FEEDBACK_WRONG_MS` |
| Más o menos ayuda con países diminutos | `SMALL_COUNTRY_PX` / `CLICK_TOLERANCE_PX` |
| Mostrar u ocultar las fronteras en el menú | `SHOW_BORDERS` |
| Fronteras más o menos visibles | `opacity` de `bordersMaterial` |
| Pin más grande o más fino | `PIN_HEIGHT`, `PIN_HEAD_RADIUS`, `PIN_STICK_RADIUS` |
| Color del pin | `material` en `createPin()` |
| Colores de acierto y fallo | `CORRECT_COLOR` / `WRONG_COLOR` en `main.js` y `--correct` / `--wrong` en `style.css` |
| Relleno más o menos opaco | `MASK_OPACITY` (0.45) |
| Colores más o menos vivos | `EARTH_SATURATION` |
| Desiertos y hielo más o menos brillantes | `EARTH_HIGHLIGHT_COMPRESSION` (más = más apagados) y `EARTH_HIGHLIGHT_KNEE` |
| Más o menos luz propia del planeta | `EARTH_GLOW` |
| Otras imágenes de satélite | `TILE_URL`, `TILE_MAX_ZOOM` y `ZOOM_MIN_ALTITUDE_KM` |
| Mover el sol o la luna | `position` en su llamada a `createLuminousBody` |
| Más o menos luz del sol / de la luna | `SUN_LIGHT_INTENSITY` / `MOON_LIGHT_RATIO` |
| Más o menos estrellas | `count` en `createStarfield` |
| Sensibilidad clic/arrastre | `CLICK_MOVE_TOLERANCE` |
