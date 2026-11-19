# CORA

[English](README.md) · **Español**

> Documentación técnica detallada en español. La presentación general del proyecto está en inglés en [README.md](README.md).

Un juego de geografía sobre una Tierra en 3D: aparece una pista (el nombre y/o la bandera de un país) y hay que hacer clic en ese país del globo. Diez países por partida, cuatro dificultades, cronómetro y puntuación. El globo se puede girar y acercar, con imágenes de satélite que ganan detalle al hacer zoom; de fondo hay un sol, una luna y una fotografía real del cielo con la Vía Láctea. Incluye una página con la lista de todos los países.

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
| `npm run convex`  | Conecta con Convex (clasificación online) y vigila `convex/`. Déjalo abierto junto a `npm run dev` mientras cambies funciones del servidor. |

> Al hacer `build`, Vite avisa de que un archivo supera 500 kB. Es normal con Three.js y no es un error.

| Página | URL |
| --- | --- |
| Globo | http://localhost:5173/ |
| Lista de países | http://localhost:5173/paises.html (enlazada desde Configuración) |

## El juego

### Cómo se juega

1. **Menú principal**: *Jugar* (reto diario), *Maratón*, *Supervivencia*, *Entrenamiento* y *Clasificación*, y a la derecha el **top 5 de hoy**. *Configuración* es el engranaje de abajo a la derecha. Detrás, el globo gira solo.
2. Al elegir un modo se pide **el nombre del jugador** y, salvo en *Jugar*, la dificultad.
3. **Cuenta atrás** 3, 2, 1 y “Ya”: en ese momento aparece la primera pista y el cronómetro empieza en 0.
4. Para cada país se **mantiene pulsado** sobre el globo **1.05 s** (un clic normal no hace nada): el anillo de carga aparece junto al puntero a los 0.5 s (para que al arrastrar no parezca que carga; `HOLD_RING_DELAY_MS` en `main.js`) y se llena en lo que queda; al completarse, se elige el punto que hay debajo. Si el puntero se mueve (se está girando el globo), se suelta antes o entra un segundo dedo (pellizco), se cancela. El tiempo está en `HOLD_TO_SELECT_MS` (`src/game.js`) y el gesto en `main.js` (*Selección de país: mantener pulsado*). **En pantallas táctiles** (móvil, tablet) no hace falta mantener: basta un toque, sin anillo; si el dedo se mueve (girar) o hay dos dedos (pellizco), no cuenta.
   - **Acierto**: el país se pinta de verde y aparece su nombre sobre el pin.
   - **Fallo**: el país elegido se pinta de rojo, el correcto de verde, y la cámara viaja hasta el correcto.
   - Un clic en el **mar** lejos del país no cuenta como respuesta (aviso “Mar”).
5. **Resultado** según el modo, con *Jugar otra vez* (salvo en *Jugar*) y *Menú*.

| Modo | Países | Objetivo | Un fallo… | Clasificación |
| --- | --- | --- | --- | --- |
| **Jugar** | 5 estados, los mismos para todos y distintos cada día | Más puntos (cercanía + rapidez) | puntúa según lo cerca que quedó | Tabla del día; **un intento al día** |
| **Maratón** | Todos los de la dificultad (198 o 239) | Completarlos todos en el menor tiempo | el país vuelve a salir más adelante | Por dificultad, por tiempo |
| **Supervivencia** | Todos los de la dificultad | Aguantar con el reloj (20 s, +5 s por acierto) | el país vuelve a salir más adelante | Por dificultad, por aciertos |
| **Entrenamiento** | Los que elijas | Practicar | cuenta como fallo y sigue | No |

En **Maratón** el marcador muestra *Quedan* (países por acertar), *Fallos* y *Tiempo*, y el resultado muestra el tiempo total y los fallos. Al tardar bastante (un par de centenares de países), la pausa es útil.

Durante la partida se puede girar y hacer zoom con normalidad (un arrastre no cuenta como clic).

**Pausa**: con el botón *Pausa* (arriba a la derecha) o la tecla `Esc`. La pantalla de pausa tiene *Reanudar* (o `Esc` otra vez) y *Salir* (vuelve al menú). Mientras está en pausa se detienen el cronómetro, el tiempo por país de hardcore, la cuenta atrás y la espera entre países, y el globo queda tapado y bloqueado para que no se pueda buscar el país sin que corra el tiempo. Si se cambia de pestaña o se minimiza la ventana en mitad de una partida, se pausa sola.

El **tiempo** cuenta solo mientras se está buscando el país: se para durante las pausas que muestran si se acertó (1.2 s al acertar, 3.4 s al fallar: 1 s quieta en el pin y luego viaja al país correcto), para no penalizar la animación.

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

### Jugar (reto diario)

Un reto al día igual para todo el mundo:

- **5 estados** (sin territorios dependientes ni indeterminados), **los mismos para todos** y distintos cada día. Los elige el servidor: baraja los 198 estados una vez cada 39 días y cada día toma un tramo de 5, así no se repite ningún país dentro de ese ciclo.
- El día cambia a las **00:00 de UTC−6** (06:00 UTC; a la misma hora en todo el mundo).
- La pista es **nombre y bandera**, en el idioma de *Configuración*, y **sin fronteras**.
- **Un intento por jugador y día.** El intento cuenta desde que empieza: si se sale a mitad (la pausa lo avisa: “Si sales, pierdes el intento de hoy”), ya no se puede repetir. Al volver a entrar se ve “Ya jugaste hoy” con el resultado y el puesto.
- **Puntos**: cada país vale hasta **1000** (máximo del día: 5000). En este modo **cualquier clic cuenta** como respuesta, también en el mar, y tras cada uno se ve la distancia y los puntos (“Era Guyana · a 520 km · +412”).

  | Parte | Puntos | Cómo |
  | --- | --- | --- |
  | Cercanía | hasta 700 | 700 si se acierta; si no, `700 × e^(−distancia / escala)`, con la distancia del clic al país. |
  | Ponderación por país | — | La escala depende del tamaño del territorio principal del país: de 1200 km (países diminutos) a 400 km (los más grandes). Fallar un país enorme por 800 km penaliza más que quedarse a 800 km de una isla diminuta. |
  | Rapidez | hasta 300 | Entera por debajo de 2 s, nada a partir de 20 s, multiplicada por la cercanía (hacer clic rápido al azar no puntúa). |

  Ejemplos: Francia acertada en 3 s → 983; a 800 km en 3 s → 457; Rusia a 800 km → 133; Vanuatu a 800 km → 501. Los valores están en las constantes `DAILY_*` de `src/game.js` (`dailyPoints`).
- **Clasificación del día**: primero quien más puntos tenga y, a igualdad, el más rápido. Al terminar se ve el puesto en la tabla completa (“Puesto 12 de 340 hoy”).
- **Resultado**: los puntos en grande, aciertos y tiempo, y la lista de los 5 países con los puntos de cada uno. **Al pulsar un país de la lista** se pinta de verde en el globo y la cámara va hasta él, acercándose según su tamaño (también funciona con el teclado: `Tab` y `Enter`).
- **Menú principal**: el top 5 del día, en directo, con *Ver todo*, que abre la pestaña *Diario* de la clasificación.

### Clasificación

Se abre con el **trofeo** (abajo a la derecha). Una sola pantalla con tres pestañas: **Diario** (la tabla de hoy, hasta 100 jugadores, con la fecha y cuántos han jugado), **Maratón** y **Supervivencia** (top 20 por dificultad). Los tres primeros salen en un **podio** (1.º en el centro, con medallas oro, plata y bronce); del 4.º en adelante, una tabla con cabeceras: puesto, jugador (con la bandera de su país), y dos columnas según la tabla (Diario: puntos y tiempo; Maratón: tiempo y fallos; Supervivencia: aciertos y tiempo). Tu fila se resalta con la etiqueta *Tú*. Se actualiza sola en directo. En desarrollo, `window.__renderBoard([...filas])` pinta filas de ejemplo para probar el diseño.
- La **bandera del país del jugador** sale de su IP: en Vercel la da la función `api/country.js` (ver más abajo). En local, sin esa función, se usa la región del idioma del navegador (es-MX → México), si la tiene.

El “un intento al día” va ligado al jugador (el token guardado en su navegador): quien borre los datos del navegador o use otro navegador puede volver a jugar como jugador nuevo. Para impedirlo del todo harían falta cuentas de usuario.

### Supervivencia

Desde el menú principal, *Supervivencia* lleva a la misma pantalla de dificultad (las 4 dificultades deciden qué países entran, qué pista se da y si se ven las fronteras).

- Un **reloj** empieza en **20 s** y va bajando. Cada **acierto suma 5 s**.
- Un país **acertado** se descarta: no vuelve a salir. Un país **fallado** vuelve a salir más adelante en la misma partida (nunca justo a continuación).
- La partida termina cuando el reloj llega a 0 (se enseña el país que estaba saliendo) o cuando se aciertan **todos** los países de la dificultad.
- El reloj solo baja mientras se busca el país (no durante la cuenta atrás, la pausa ni mientras se ve la respuesta).
- En hardcore no se aplica el límite de 10 s por país: manda el reloj de supervivencia.
- **HUD**: *Quedan* (países por acertar), *Aciertos* y *Reloj*, que se pone en rojo por debajo de 5 s; al acertar aparece “+5 s” junto a él.
- **Resultado**: aciertos sobre el total, tiempo jugado, número de fallos y las banderas de los países acertados.
- Tiene su propio **récord** por dificultad (más aciertos; a igualdad, menos tiempo), que se ve en la pantalla de dificultad al entrar desde *Supervivencia*.

### Desafío (multijugador)

Está en *Arcade → Desafío*. Es por turnos, de **2 a 10 jugadores**, estilo "papa caliente":

- Uno **crea una sala** y los demás se unen con su **código de 5 letras** o con el enlace de invitación (`?room=CÓDIGO`). Quien entra con la partida empezada, o con la sala llena, solo mira.
- El **anfitrión** elige el juego: **Países** (hay que hacer clic en el país en el globo), **Banderas** (se ve la bandera y se escribe el país) o **Capitales** (se ve el país y se escribe su capital), y empieza.
- Cada jugador tiene un **reloj de 30 s** que solo corre **durante su turno**. En cada turno le toca un país al azar: **acierto +5 s**, **fallo −3 s**, y si pasan **10 s sin responder, −5 s**. En los tres casos pasa el turno.
- En la sala de espera cada jugador pulsa **Listo** (el anfitrión solo puede empezar cuando lo están todos) y puede **sugerir un juego** al anfitrión, que lo acepta con un clic.
- Lo que hace el jugador al que le toca **se ve en directo**: lo que va escribiendo y, en el globo, hacia dónde se mueve y cuánto zoom hace (la cámara de los demás sigue a la suya).
- Quien se queda **sin tiempo queda eliminado** y sigue mirando. **Gana el último en pie.** Al terminar, el anfitrión puede devolver a todos a la sala para jugar otra.
- El reloj lo lleva el servidor (`convex/challenge.ts`); la interfaz está en `src/challenge.js`. Las reglas (segundos, límite del turno, jugadores) son las constantes del principio de `convex/challenge.ts`.

### Entrenamiento

Para practicar con reglas a medida. Desde el menú principal, *Entrenamiento* abre una pantalla con:

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

### Nombre y clasificación online

Al pulsar *Jugar*, *Maratón* o *Supervivencia* se pide **el nombre del jugador** (relleno con el último usado; *Continuar* se activa con 2–20 caracteres; `Enter` también continúa). Ese nombre aparece en la clasificación.

Al terminar una partida de *Maratón* (completa) o de *Supervivencia* con al menos 1 acierto, la puntuación se envía a la **clasificación online** y el resultado muestra el puesto (“Puesto 3 en la clasificación”). *Jugar* tiene su propia tabla diaria (ver arriba); el entrenamiento no cuenta.

La pantalla **Clasificación** (menú principal) tiene una tabla por **modo** (Maratón, Supervivencia) y **dificultad** (Fácil, Normal, Difícil, Hardcore): los 20 mejores. En *Maratón* se ordena por tiempo y se ven el tiempo y los fallos; en *Supervivencia*, por aciertos y luego tiempo. Cada jugador aparece una sola vez por tabla, con su mejor marca; la fila propia sale en ámbar. Se actualiza sola en tiempo real.

Sin conexión o sin Convex configurado, el juego funciona igual y la clasificación dice “Clasificación no disponible”.

### Minijuegos

El menú principal tiene 4 opciones: **Daily Game** (el reto del día), **Arcade** (Maratón y Supervivencia: en el globo, con dificultad y clasificación; “volver” y Esc desde nombre o dificultad llevan a Arcade), **Training** y **Minigames** (los juegos de escribir). En el menú, *Minigames/Minijuegos* (la clasificación pasa a ser el **trofeo** que hay a la izquierda del engranaje, abajo a la derecha). Código en **`src/minigames.js`**.

- **Adivina la bandera**: sale una bandera en grande y se escribe el país.
- **Adivina el país**: se ilumina un país en verde en el globo (la cámara viaja hasta él, más cerca cuanto más pequeño es) y se escribe su nombre. Los países de menos de 250 km llevan además un pin con “?” para que se vean. La tarjeta pasa a ser una barra abajo y el globo se puede girar y acercar mientras tanto; se ven las fronteras. En pausa se quita el resaltado.
- **Adivina la capital**: salen la bandera y el país y se escribe su capital.
- Antes de empezar se eligen continentes, tipos de país y cuántos (10, 20, 50 o todos); se recuerda en `settings.minigames`. Hay cuenta atrás 3, 2, 1 y un cronómetro (no cuenta con la pestaña oculta); al terminar se ve el tiempo total. **Sin clasificación**.
- **Saltar** (botón o Tab) manda el país al final de la cola: vuelve a salir.
- **Pausa** (botón arriba a la izquierda o Esc; también sola al cambiar de pestaña): para el cronómetro y tapa la bandera y el país para no poder mirarlos con el reloj parado. Desde ahí se reanuda o se sale a la lista de minijuegos. En la cuenta atrás Esc no hace nada.
- **Tolerancia** (`answerKey` y `matches`): vale en inglés, español o portugués; da igual tildes, mayúsculas, guiones, espacios y artículos (*La Paz* = *paz*), *St.* = *Saint*; se aceptan nombres oficiales y variantes (Eswatini/Suazilandia/Swaziland, Czechia/República Checa, Costa de Marfil/Côte d'Ivoire, Birmania/Myanmar, EEUU…); y se perdonan erratas (1 hasta 8 letras, 2 a partir de 9; dos letras intercambiadas cuentan como una). Nunca se acepta el nombre de **otro** país (*Mali* no vale por *Malta*, *Niger* no vale por *Nigeria*). Si lo escrito coincide exactamente, se acepta sin pulsar Enter; con erratas, al pulsar Enter.
- **Datos**: `countries.json` incluye `aliases` (nombres alternativos) y `capital` (`en`/`es`/`pt` y todos los nombres aceptados), generados por `scripts/prepare-countries.mjs` a partir de Natural Earth (`ne_50m_populated_places`) más unas listas propias en el script (`EXTRA_ALIASES`, `EXTRA_CAPITALS`, `DISPLAY_CAPITAL`). En países con varias capitales vale cualquiera (Bolivia: Sucre o La Paz; Sudáfrica: Pretoria, Bloemfontein o Ciudad del Cabo…). 230 países tienen capital; los que no (Antártida, Palestina, Sahara Occidental, Hong Kong, Macao y algunos territorios deshabitados) no salen en el de capitales.

    node scripts/prepare-countries.mjs ne_50m_admin_0_countries.geojson ne_50m_populated_places.geojson

### Idiomas

Toda la interfaz está en **inglés por defecto**, y también en español y portugués. Se cambia en *Configuración → Language/Idioma* y cambia al instante (sin recargar): menús, partida, resultados, clasificaciones, la lista de países y también los **nombres de los países**.

- Las traducciones están en **`src/i18n.js`**: `t('clave', variables)` devuelve el texto en el idioma actual (si falta, en inglés); en el HTML, `data-i18n="clave"` traduce el texto de un elemento y `data-i18n-attr="atributo:clave"` sus atributos (`aria-label`, `title`, `placeholder`…). Para añadir un idioma: un bloque nuevo en `STRINGS`, su locale en `LOCALES` y su nombre en `LANGUAGES` (`settings.js`); los países ya traen `name_en`, `name_es` y `name_pt`.
- **Migración**: la configuración guardada lleva un número de versión. Quien tenía guardado el español de antes (el juego guardaba el idioma por defecto al guardar cualquier cosa) pasa una sola vez al inglés; luego se respeta lo que elija.
- El *Entrenamiento* tiene además su propio “idioma de los nombres” (inglés por defecto).

### Configuración

Se guarda en el navegador (`localStorage`), así que se recuerda entre visitas:

- **Sonido**: activa o desactiva los efectos (cuenta atrás, acierto, fallo, tiempo agotado, fin de partida). Se generan en el navegador, sin archivos de audio.
- **Idioma de las pistas**: español, inglés o portugués. Por defecto, **inglés** (quien ya lo había cambiado conserva su elección). Cambia el nombre de los países en las pistas, en el aviso de fallo, en la etiqueta del pin y en la lista del resultado; el resto de la interfaz sigue en español.

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
│       ├── earth_day_4k.jpg      Textura global de la Tierra (base bajo las teselas)
│       ├── milky_way_2k.jpg      Fondo: panorámica real del cielo (ESO), 2048 × 1024
│       ├── sun_256.jpg           Textura del sol, 256 × 128 (Solar System Scope)
│       └── moon_256.jpg          Textura de la luna, 256 × 128 (Solar System Scope)
├── api/
│   └── country.js                Función de Vercel: país del visitante por IP (para el reto diario de *Jugar*)
├── convex/                       Backend (Convex): base de datos y funciones de servidor
│   ├── schema.ts                 Tablas: players, scores (Maratón/Supervivencia) y dailyAttempts (reto diario de Jugar)
│   ├── convex.config.ts          Componentes: dos rankings (@convex-dev/aggregate)
│   ├── rankings.ts               Los rankings: puesto y total de cada tabla
│   ├── scores.ts                 Maratón/Supervivencia: top y submit
│   ├── daily.ts                  Reto diario (Jugar): start, finish, top y los países de cada día
│   ├── players.ts                Utilidades: validar nombre/token, alta del jugador
│   ├── dailyCountries.ts         Los 198 estados (generado por el script de datos)
│   └── _generated/               Generado por Convex (se sube a git)
├── scripts/
│   └── prepare-countries.mjs     Genera data/ y flags/ a partir de Natural Earth y flag-icons
└── src/
    ├── main.js        El globo: escena, astros, Tierra, navegación, pin, clics y API para el juego
    ├── game.js        El juego: menús, dificultades, partida, cronómetro, resultado
    ├── settings.js    Configuración (sonido, idioma) guardada en el navegador
    ├── sound.js       Efectos de sonido generados con Web Audio
    ├── leaderboard.js Cliente de Convex: enviar puntuaciones y escuchar la clasificación
    ├── fonts.css      Tipografías de toda la web (se cambian aquí)
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

- **En el navegador**: http://localhost:5173/paises.html, con bandera, nombre en español, inglés y portugués, código ISO, tipo y continente, y un buscador (busca en los tres idiomas, el código y el continente, sin importar tildes). Las filas de `FLAGGED` (`src/paises.js`) salen en rojo sangre y su tipo se sustituye: Israel, *Estado ilegítimo* en lugar de *Estado* (`listType.illegitimate` en `i18n.js`). Es solo en esta lista; en el juego Israel es un estado más.
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

**Banderas cambiadas a mano** (el script no sobrescribe las que ya existen, así que se conservan al regenerar los datos):

- `cr.svg` (Costa Rica): la de flag-icons es la bandera civil, sin escudo; se usa la **bandera de Estado, con el escudo**, de [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Flag_of_Costa_Rica_(state).svg) (dominio público), recortada a 4:3 con `viewBox="100 0 800 600"` (solo se quita un poco de franja a cada lado; el escudo queda entero).

### Regenerar los datos

```bash
curl -L -o ne.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
node scripts/prepare-countries.mjs ne.geojson
```

El script redondea las coordenadas a 3 decimales (~100 m), ordena los países por su nombre en español, regenera `public/data/` y `public/flags/`, e imprime el recuento por tipo y los países sin bandera.

Limitación: a esta escala los contornos están simplificados (precisión de ~1 km). Al acercarse mucho se nota que fronteras y costas no coinciden exactamente con la imagen, y un clic muy pegado a la costa de un país diminuto (Mónaco, por ejemplo) puede caer en “Océano”.

## Código

### `index.html` y `src/style.css`: la interfaz

Dirección visual de **atlas editorial**, con una sola tipografía (Bricolage Grotesque) en toda la web y cifras de ancho fijo en los datos (cronómetro, puntos, recuentos), paneles a la izquierda sobre una sombra en lugar de tarjetas flotantes, líneas finas y el ámbar del sol como único color de acento. Solo se muestran los textos imprescindibles.

- **Pantalla de carga** (`#loading`): el logo CORA y una barra fina. Se quita cuando están la textura global, los países y las primeras teselas (o a los 8 s), así nunca se ve el planeta a medio cargar.
- Las etiquetas pequeñas (`.eyebrow`, `.field-label`, `.k`) van en minúscula normal y en negrita, sin mayúsculas forzadas.
- **Pantallas** (`.screen` > `.sheet`): `#screen-menu`, `#screen-difficulty`, `#screen-practice`, `#screen-settings` y `#screen-results`. Panel en la columna izquierda; en los menús el planeta se desplaza a la derecha para quedar a la vista (`setViewShift` en `main.js`). En pantallas de menos de 720 px el panel pasa a la parte de abajo.
- **Menú principal**: el logo y la lista de opciones (Jugar, Entrenamiento, Configuración) más el enlace a la lista de países.
- **Dificultad**: una fila por dificultad con su descripción, un indicador de nivel de 4 barras y, si existe, el récord (puntos y tiempo).
- **Entrenamiento**: solo el formulario hace scroll; el recuento y el botón *Empezar* quedan fijos abajo.
- **Resultado**: la dificultad como título, los puntos en grande, el tiempo, “Nuevo récord” si lo es, y la lista de los países con un punto verde o rojo.
- **HUD** (`#hud`): país, puntos y tiempo arriba a la izquierda; la pista (bandera y/o nombre) arriba en el centro; *Pausa* arriba a la derecha; la barra de tiempo y el aviso (`#feedback`: “Correcto”, “Era …”, “Mar”) bajo la pista.
- `#pause`: pantalla de pausa con *Reanudar* y *Salir*, sobre un fondo oscuro y desenfocado que tapa el globo.
- `#countdown`: 3, 2, 1 y “Ya” en grande.
- `.pin-label`: etiqueta sobre el pin con bandera y nombre; borde verde o rojo.
- `#settings-button`: engranaje abajo a la derecha (fuera de la partida) que abre *Configuración*: sonido, idioma de las pistas y los **créditos** de imágenes, datos, banderas y tipografías. Las licencias de las imágenes (CC BY 4.0 y CC BY-NC-SA 4.0) obligan a citar la fuente, así que los créditos no conviene quitarlos.
- Colores en variables CSS al principio de `style.css`: `--ink` (fondo), `--paper` (texto), `--muted`, `--faint` (líneas), `--sun` (acento), `--correct`, `--wrong`.

**Teclado** (funciona aunque no se indique en pantalla): `Esc` pausa y reanuda la partida, y en los menús vuelve al menú principal; `1`–`4` eligen dificultad; `Enter` juega otra vez en el resultado y empieza en el entrenamiento.

**Récords**: se guarda la mejor partida de cada dificultad (más puntos; a igualdad, menos tiempo) en el navegador, junto con la configuración. El entrenamiento no tiene récords.

### Tipografías: `src/fonts.css`

Todas las fuentes de la web (juego y lista de países) se definen en **un solo archivo**, `src/fonts.css`, con tres variables:

| Variable | Fuente actual | Dónde se usa |
| --- | --- | --- |
| `--serif` | Bricolage Grotesque | Logo, títulos, opciones del menú, nombre del país en la pista, cuenta atrás |
| `--sans` | Bricolage Grotesque | Texto general y botones |
| `--mono` | Bricolage Grotesque | Datos: cronómetro, puntos, recuentos, etiquetas pequeñas |

Ahora las tres usan la misma fuente; están separadas por si algún día se quiere otra distinta para títulos o datos.

Las fuentes vienen de paquetes npm de [Fontsource](https://fontsource.org) y se sirven desde el propio proyecto (no dependen de Google Fonts). **Para cambiar una**, por ejemplo la serif por Playfair Display:

```bash
npm install @fontsource-variable/playfair-display
```

y en `src/fonts.css` se cambia el `@import` y la variable (o las tres variables, para toda la web):

```css
@import '@fontsource-variable/playfair-display/wght.css';

:root {
  --serif: 'Playfair Display Variable', Georgia, serif;
}
```

El nombre exacto de la fuente (`'Playfair Display Variable'`) y los archivos que se pueden importar aparecen en la página de cada fuente en fontsource.org. Las fuentes no variables se importan por grosor (`@fontsource/nombre/400.css`, `/700.css`…).

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

#### Sol y luna

Con **tamaños y distancias reales**, en radios terrestres (la Tierra de la escena tiene radio 1):

| Astro | Datos reales | Radio | Distancia al centro |
| --- | --- | --- | --- |
| Luna | radio 1737 km, a 384 400 km | `MOON_RADIUS` = 0.273 × 1.3 = 0.355 | `MOON_DISTANCE` = 60.3 × 0.7 = 42.2 |
| Sol | radio 696 000 km, a 149.6 millones de km | `SUN_RADIUS` = 109 × 1.3 = 142 | `SUN_DISTANCE` = 23 481 × 0.7 = 16 437 |

Parten de los datos reales, con dos ajustes para que se vean mejor: los tamaños llevan `CELESTIAL_SCALE` = 1.3 (un 30 % más grandes) y las distancias `CELESTIAL_DISTANCE_SCALE` = 0.7 (un 30 % más cerca). Con las dos a 1 quedan exactamente a escala real.

Por eso, como en la vida real, los dos se ven del **mismo tamaño aparente** (~1°, unos 19 px, con los ajustes de tamaño y distancia): el sol como un pequeño disco naranja con su aura y la luna como un punto gris. No crecen al hacer zoom, porque el zoom acerca la cámara a la Tierra, no a ellos. Al verse siempre tan pequeños, usan texturas de 256 × 128 (`sun_256.jpg`, `moon_256.jpg`, ~15 KB cada una) y mallas de pocos polígonos (24 × 16), para optimizar.

- **Sol** (`createSunMaterial`): textura de Solar System Scope (CC BY 4.0) que el shader aclara hacia blanco en el centro y tiñe de naranja (`0xff9e22`) en el borde; no le afecta la luz de la escena. Lleva un aura de luz (`Sprite` aditivo, color `0xffc24a`) de `SUN_AURA_SIZE` = 24 radios de ancho, intensa en el borde del sol y que se apaga poco a poco (`createGlowTexture`) y de él sale la luz principal (`DirectionalLight` `0xfff6ea`, `SUN_LIGHT_INTENSITY` = 1.8). Está detrás a la izquierda (`SUN_DIRECTION`).
- **Luna**: textura de Solar System Scope con `MeshStandardMaterial`, así que la ilumina el sol y muestra fases reales; un poco de luz propia (0.15) evita que su cara oscura desaparezca. Ilumina la Tierra con el 10 % de la luz del sol (`MOON_LIGHT_RATIO`). Está detrás a la derecha (`MOON_DIRECTION`).
- **Luz ambiental**: azul muy suave (`0xc8d4ff`), intensidad `AMBIENT_LIGHT_INTENSITY = 0.9`. Ilumina todo el planeta por igual: cuanto más alta, más claro se ve todo y menos se nota la dirección del sol.
- El plano lejano de la cámara se ajusta a la distancia del sol (`camera.far`); el buffer de profundidad logarítmico mantiene la precisión aunque en la escena convivan el suelo a pocos km y el sol a 150 millones.

#### Fondo: el cielo real

El fondo es una **fotografía real de todo el cielo**: la panorámica de 360° de la Vía Láctea de [ESO/S. Brunier](https://www.eso.org/public/images/eso0932a/) (licencia CC BY 4.0, uso comercial permitido citando la fuente), con el núcleo de la galaxia, las nubes de polvo oscuro y nebulosas.

- Se usa a 2048 × 1024 (`milky_way_2k.jpg`, 0.7 MB): a esa resolución las estrellas débiles se funden en un brillo suave y quedan la Vía Láctea, el polvo y las nebulosas, sin tanto detalle. El original de ESO tiene 6000 × 3000 si algún día se quiere más.
- `SKY_BRIGHTNESS` = 0.35 lo deja oscuro para que destaque la Tierra (1 = como la foto).
- Se pone como `scene.background` (fondo infinito): gira con la cámara pero no se acerca al hacer zoom.
- La foto está en coordenadas galácticas. `scene.backgroundRotation` primero gira la galaxia sobre su eje (`SKY_TURN_DEG` = 125°: el núcleo y el polvo quedan abajo a la izquierda en la vista inicial, sin taparse con el planeta) y luego la inclina `SKY_TILT_DEG` = 62.87°, el ángulo real entre el plano de la galaxia y el ecuador terrestre.

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

- `createEarthMaterial(texture)`: material de la Tierra para una textura (la global y cada tesela). `MeshStandardMaterial` con la textura como color base y como **emisiva**, para que el planeta tenga luz propia (`EARTH_GLOW` = 0.75).
- `earthShader`: se engancha en `onBeforeCompile` y modifica el shader estándar de three para:
  - subir la **saturación** de la textura (`EARTH_SATURATION` = 1.15; 1 = colores originales);
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
| `setControlsEnabled(enabled)` | Bloquea o desbloquea girar y hacer zoom (la pausa lo usa). |
| `setViewShift(fraction)` / `getViewCenter()` | Desplaza el planeta a un lado (menús) / punto de la Tierra bajo la cámara. |

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
| `countrySizeKm(country)` | Tamaño característico del país en km: el de su territorio principal (polígono más grande), como la diagonal de un cuadrado de la misma área. No usa el recuadro de todo el país porque los territorios de ultramar o cruzar el meridiano 180° lo deforman. |
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

Una partida siempre se juega con un **objeto de reglas** (`rules`): `{ label, pool, showName, showFlag, borders, timeLimit, rounds, language }`. Las dificultades fijas (`DIFFICULTIES`) y el entrenamiento (`rulesFromPractice`) producen ese mismo objeto, así que el resto del juego no distingue entre ellos.

| Constante / función | Qué hace |
| --- | --- |
| `SURVIVAL_START_S` / `SURVIVAL_BONUS_S` / `SURVIVAL_LOW_S` | Supervivencia: tiempo inicial (20 s), segundos por acierto (5 s) y umbral del reloj en rojo (5 s). |
| `survivalRules(d)` | Reglas de supervivencia a partir de una dificultad (mismos países y pista, sin límite por país, todos los países). |
| `COUNTDOWN_FROM` | Desde dónde cuenta la cuenta atrás (3). |
| `FEEDBACK_CORRECT_MS` / `FEEDBACK_WRONG_MS` | Pausa tras acertar (1200 ms) y tras fallar (2600 ms) antes del siguiente país. |
| `SMALL_COUNTRY_PX` / `CLICK_TOLERANCE_PX` | Ayuda para países diminutos (25 px / 15 px). |
| `DIFFICULTIES` | Cada dificultad: `label`, `description`, `pool` (qué países entran), `showName`, `showFlag`, `borders`, `timeLimit` (segundos por país o `null`) y `rounds`. Para añadir o cambiar una dificultad basta con tocar este objeto: los botones se generan a partir de él. |
| `CONTINENTS` / `TYPES` | Continentes y tipos de país del entrenamiento, con su nombre en pantalla. |
| `TIME_OPTIONS` / `ROUND_OPTIONS` | Opciones de tiempo por país y de países por partida del entrenamiento. |
| `rulesFromPractice(practice)` | Convierte la configuración del entrenamiento en reglas de partida. |
| `setupPractice()` | Construye el formulario del entrenamiento, guarda cada cambio y actualiza los recuentos y el botón *Empezar*. |
| `startGame(rules)` | Prepara la cola de países (`queue`): `rules.rounds` países al azar del `pool` (o todos, si hay menos; en supervivencia, todos), reinicia marcador y cronómetro, configura el globo (fronteras, sin giro automático) y lanza la cuenta atrás. |
| `startRound()` | Muestra la pista del país actual y limpia el resaltado. |
| `isCorrect(info)` | Acierto si se hizo clic en el país; con pista solo de bandera, también en uno con la misma bandera; y en países diminutos, también cerca de ellos. |
| `answer(correct, clicked)` | Suma el punto, pinta verde/rojo, pone la etiqueta, suena y, si falló, lleva la cámara al país correcto. |
| `nextRound()` | Saca el país actual de la cola. En supervivencia, si se falló, lo vuelve a meter más adelante (posición aleatoria a partir de la 3.ª) y, si se acabó el reloj, termina. |
| `finish()` | Pantalla de resultado: puntos, tiempo y lista (en supervivencia, banderas acertadas y fallos). |
| `frame()` | Bucle propio (`requestAnimationFrame`): avanza el cronómetro solo en estado `playing` y, en hardcore, da el país por fallado al agotarse el tiempo. |

Los temporizadores (`later`) son propios en lugar de `setTimeout`: los descuenta el bucle `frame()` solo cuando la partida no está en pausa, así la pausa congela la cuenta atrás y la espera entre países. Se cancelan todos al salir al menú, así que salir en mitad de la cuenta atrás no deja nada colgando.

| Función | Qué hace |
| --- | --- |
| `pause()` / `resume()` | Pausa o reanuda (solo durante la partida): muestra u oculta `#pause` y bloquea o desbloquea el globo con `globe.setControlsEnabled`. |

### `src/settings.js` y `src/sound.js`

- `settings.js`: `loadSettings()` / `saveSettings()` con `localStorage` (clave `cora-settings`), con valores por defecto si el navegador no deja guardar. `LANGUAGES` define los idiomas de las pistas y `DEFAULT_PRACTICE` la configuración inicial del entrenamiento (Europa, estados, nombre + bandera, con fronteras, sin límite de tiempo, 10 países).
- `sound.js`: `createSound(isEnabled)` devuelve `play(nombre)` con los efectos `tick`, `go`, `correct`, `wrong`, `timeout`, `finish` y `click`, hechos con osciladores de Web Audio. El contexto de audio se crea con el primer sonido (los navegadores solo dejan sonar tras una interacción).

### `paises.html`, `src/paises.js` y `src/paises.css`

Página independiente que carga `countries-list.json`, muestra el recuento por tipo y una tabla con todos los países. El buscador filtra al escribir. En pantallas estrechas se ocultan las columnas de inglés, portugués y continente.

## Clasificación online (Convex)

El backend de la clasificación es [Convex](https://convex.dev): base de datos y funciones de servidor en la nube, sin servidor propio. Las consultas son reactivas, así que la tabla se actualiza sola cuando alguien entra o mejora.

### Cómo está hecho

- **`convex/schema.ts`**:
  - `players`: nombre y un token secreto que genera el navegador (no hay cuentas ni contraseñas).
  - `scores`: la mejor marca de cada jugador en cada tabla de *Maratón* / *Supervivencia* (modo + dificultad), con aciertos, total, tiempo y fallos. El campo `rank = aciertos × 10⁹ − tiempo` ordena con un solo índice: más aciertos primero y, a igualdad, menos tiempo (en *Maratón* todos completan, así que manda el tiempo).
  - `dailyAttempts`: un intento por jugador y día (cambia a las 00:00 de UTC−6), con el país del jugador, la hora de inicio y, al terminar, aciertos, tiempo y `rank`.
- **`convex/convex.config.ts`** y **`convex/rankings.ts`**: dos componentes [`@convex-dev/aggregate`](https://www.convex.dev/components/aggregate) (`boardRanking` y `dailyRanking`) que dan el **puesto** de una marca y el total de una tabla en O(log n), sin recorrer la tabla. Se actualizan en la misma mutación que cada escritura.
- **`convex/scores.ts`** (Maratón / Supervivencia):
  - `top({ mode, difficulty, limit })`: los mejores de una tabla (20 por defecto, máximo 100).
  - `submit({ token, name, mode, difficulty, score, total, timeMs, fails })`: valida y guarda la partida solo si mejora la marca del jugador; devuelve `{ improved, position, total }`.
- **`convex/daily.ts`** (reto diario de *Jugar*):
  - `start({ token, name, country })`: el servidor decide el día (cambia a las 00:00 de UTC−6). Si el jugador ya tiene intento hoy, devuelve “ya jugado” con su resultado y puesto; si no, crea el intento y devuelve los 10 países del día (`countriesForDay`).
  - `finish({ token, attemptId, score, timeMs })`: cierra el intento y devuelve el puesto y el total del día.
  - `top({ day, limit })`: la tabla de un día (5 para el menú, hasta 100 en la clasificación). El día lo pasa el cliente porque las consultas de Convex no deben leer el reloj.
- **`convex/players.ts`**: utilidades compartidas (validar nombre y token, alta del jugador y cambio de nombre).
- **`convex/dailyCountries.ts`**: los 198 estados (ISO3), generado por `scripts/prepare-countries.mjs`.
- **`src/leaderboard.js`**: el cliente (`ConvexClient`) con `VITE_CONVEX_URL`; guarda el token y el nombre en `localStorage`; expone `submitScore`, `watchLeaderboard`, `startDaily`, `finishDaily`, `watchDaily`, `utcDay` y `getPlayerCountry`. Si no hay URL, todo devuelve “no disponible” sin romper el juego.
- **`api/country.js`**: función de Vercel que devuelve el país del visitante (`{ "country": "ES" }`) a partir de la cabecera `x-vercel-ip-country` que añade el propio Vercel. No llama a servicios externos ni guarda la IP.

**Validaciones del servidor**:
- Nombre de 2–20 caracteres.
- *Maratón*: solo partidas completas (aciertos = total); *Supervivencia*: aciertos entre 1 y el total; al menos 0.7 s por acierto.
- *Jugar*: un intento por jugador y día; aciertos entre 0 y 10; el tiempo no puede ser menor de 3 s ni mayor que el tiempo real transcurrido desde que empezó el intento (el servidor lo mide).

Frenan los envíos inventados evidentes, pero como el juego corre en el navegador **no hacen las clasificaciones a prueba de trampas**.

### Desarrollo

```bash
npm run convex   # la primera vez pide iniciar sesión y crear el proyecto; escribe .env.local
npm run dev      # en otra terminal
```

`.env.local` (no se sube a git) guarda `CONVEX_DEPLOYMENT` y `VITE_CONVEX_URL` del despliegue de **desarrollo**. Si se crea o cambia `.env.local` con `npm run dev` abierto, hay que reiniciarlo para que lo lea. Los datos se ven y se editan en el panel de Convex (dashboard.convex.dev → proyecto → *Data*).

### Producción

Convex tiene un despliegue de **producción** separado del de desarrollo (otra URL y otra base de datos, que empieza vacía). El juego necesita, al compilarse, la URL del de producción en **`VITE_CONVEX_URL`**: Vite la escribe dentro del JavaScript al hacer `npm run build`. No es secreta (es la dirección pública del backend).

**Con Vercel o Netlify** (recomendado):

1. En el panel de Convex: proyecto → *Settings* → *Generate Production Deploy Key*.
2. En Vercel/Netlify, variable de entorno **`CONVEX_DEPLOY_KEY`** con esa clave (solo para producción).
3. Comando de build:
   ```bash
   npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'
   ```
   Publica las funciones (y los componentes) en producción y compila el juego con `VITE_CONVEX_URL` ya apuntando a producción. No hace falta añadir `VITE_CONVEX_URL` a mano; si existe a mano en Vercel con la URL de desarrollo, hay que borrarla.

   El log del build muestra a qué backend queda conectada la web: `Clasificación online conectada a: https://….convex.cloud`. En producción tiene que ser la URL de **producción**.

   La función `api/country.js` (país del jugador para el reto diario) la publica Vercel sola, sin configurar nada.

**A mano** (otro hosting estático):

```bash
npx convex deploy                                            # publica las funciones en producción
VITE_CONVEX_URL=https://<tu-produccion>.convex.cloud npm run build   # compila con la URL de producción
```

y se sube la carpeta `dist/`. La URL de producción está en el panel de Convex (*Settings* → *URL & Deploy Key*).

`CONVEX_DEPLOY_KEY` sí es secreta: nunca en el código ni en git.

## Capas de la escena

| Elemento | Distancia al centro |
| --- | --- |
| Textura global | radio 0.9998 |
| Teselas | radio 1.000006–1.00003 (sube con el nivel) |
| Fronteras | radio 1.00004 (~250 m sobre el suelo) |
| Contorno del país | radio 1.00005 |
| Cámara | entre 1.10 (650 km) y 9.95 (57 000 km) |
| Luna | 42.2 (real × 0.7), radio 0.355 (real × 1.3) |
| Sol | 16 437 (real × 0.7), radio 142 (real × 1.3) |
| Cielo (fondo) | infinito |
| Límite de dibujo | más allá del sol (`camera.far`) |

## Ajustes rápidos

| Quiero… | Cambiar |
| --- | --- |
| Poder acercarme más o menos | `ZOOM_MIN_ALTITUDE_KM` (y `ZOOM_MAX_ALTITUDE_KM` para alejarse) |
| Zoom más rápido o más lento | `ZOOM_SENSITIVITY` |
| Zoom más suave o más directo | `ZOOM_SMOOTHING` |
| Arrastre más rápido o más lento | `ROTATE_SPEED` |
| Más o menos inercia al soltar | `controls.dampingFactor` |
| Países y reglas del reto diario (*Jugar*) | `convex/daily.ts` (`PER_DAY`, `countriesForDay`); la lista de estados se genera en `convex/dailyCountries.ts` |
| Tiempo inicial y bonus de supervivencia | `SURVIVAL_START_S` / `SURVIVAL_BONUS_S` en `game.js` |
| Tiempo por país en hardcore | `timeLimit` de `hardcore` en `DIFFICULTIES` |
| Qué países entran en cada dificultad | `pool` en `DIFFICULTIES` |
| Opciones del entrenamiento | `TIME_OPTIONS`, `ROUND_OPTIONS`, `CONTINENTS` en `game.js`; valores iniciales en `DEFAULT_PRACTICE` (`settings.js`) |
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
| Planeta más o menos iluminado | `EARTH_GLOW` (luz propia), `AMBIENT_LIGHT_INTENSITY` (luz general) y `SUN_LIGHT_INTENSITY` (luz del sol) |
| Otras imágenes de satélite | `TILE_URL`, `TILE_MAX_ZOOM` y `ZOOM_MIN_ALTITUDE_KM` |
| Mover el sol o la luna | `SUN_DIRECTION` / `MOON_DIRECTION` (y `SUN_DISTANCE` / `MOON_DISTANCE`) |
| Aura del sol más grande o más pequeña | `SUN_AURA_SIZE` (en radios del sol); su intensidad, en los alfas de `createGlowTexture` |
| Sol y luna más grandes o más pequeños en pantalla | `CELESTIAL_SCALE` (tamaño; 1 = real) y `CELESTIAL_DISTANCE_SCALE` (distancia; 1 = real, no bajar de ~0.2 para que la luna quede más allá del zoom máximo) |
| Más o menos luz del sol / de la luna | `SUN_LIGHT_INTENSITY` / `MOON_LIGHT_RATIO` |
| Fondo más oscuro o más claro | `SKY_BRIGHTNESS` |
| Qué parte de la Vía Láctea se ve al empezar | `SKY_TURN_DEG` |
| Sensibilidad clic/arrastre | `CLICK_MOVE_TOLERANCE` |
