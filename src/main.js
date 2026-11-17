//Country 
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadCountries, findCountry, createBorders, createCountryOutline, createCountryMask } from './countries.js';
import { vector3ToLonLat, lonLatToVector3 } from './geo.js';
import { createTileLayer } from './tiles.js';
import { createGame, HOLD_TO_SELECT_MS } from './game.js';

const SPHERE_RADIUS = 1;
const CLICK_MOVE_TOLERANCE = 5; // px: más movimiento que esto cuenta como arrastre, no clic
const SHOW_BORDERS = false; // fronteras en el menú (en el juego las decide la dificultad: solo en fácil)

// Teselas de alta resolución que se cargan al acercarse (ver src/tiles.js).
// Sentinel-2 cloudless 2024 de EOX (https://s2maps.eu): mosaico sin nubes, sin franjas, con el
// mar en azul y colores naturales. Nivel 14 ≈ 10 m/píxel. Sin clave.
// LICENCIA: CC BY-NC-SA 4.0 → solo uso NO comercial. Para uso comercial hay que comprar una
// licencia a EOX, o volver a la versión 2016 (CC BY 4.0, comercial permitido, pero con franjas):
//   https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg
const TILE_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg';
const TILE_MAX_ZOOM = 14;

// Límites de zoom, en km de altura sobre el suelo
const EARTH_RADIUS_KM = 6371; // SPHERE_RADIUS = 1 equivale al radio real de la Tierra
const ZOOM_MIN_ALTITUDE_KM = 650; // lo más cerca que se puede llegar (≥ 10 para no ver teselas borrosas)
const ZOOM_MAX_ALTITUDE_KM = 20000; // lo más lejos (la vista inicial está a ~19 000 km)

// Navegación
const ZOOM_SENSITIVITY = 0.003; // cuánto cambia la altura por cada píxel de rueda (más = zoom más rápido)
const ZOOM_SMOOTHING = 12; // velocidad con la que la cámara alcanza el zoom pedido (más = más directo)
const ROTATE_SPEED = 0.25; // giro respecto a la altura (más = arrastre más rápido)

// --- Escena básica ---------------------------------------------------------
const scene = new THREE.Scene();

// El plano lejano se ajusta más abajo, cuando se conoce la distancia del sol
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 0, 4);

// Buffer de profundidad logarítmico: permite ver a la vez el suelo a pocos km y el sol a
// millones sin que las capas (teselas, fronteras) parpadeen entre sí
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Sol y luna ----------------------------------------------------------------
// Tamaños y distancias REALES, en radios terrestres (la Tierra de la escena tiene radio 1):
//   Luna: radio 1737 km, a 384 400 km   →  radio 0.273, distancia 60.3
//   Sol:  radio 696 000 km, a 149.6 M km →  radio 109,  distancia 23 481
// Por eso, como en la vida real, los dos se ven del mismo tamaño aparente (~0.5°), como
// discos pequeños, y no crecen al hacer zoom (el zoom acerca la cámara a la Tierra, no a ellos).
// Al verse siempre tan pequeños, bastan texturas de 256 × 128 y mallas de pocos polígonos.
// Texturas de Solar System Scope (CC BY 4.0).
const textureLoader = new THREE.TextureLoader();
function loadColorTexture(url) {
  const texture = textureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Sol: superficie con textura que se aclara hacia blanco en el centro y se tiñe de `edgeColor`
// en el borde. No le afecta la luz de la escena: brilla por sí mismo.
function createSunMaterial(texture, edgeColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      edgeColor: { value: new THREE.Color(edgeColor) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vFacing;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        vFacing = max(dot(viewNormal, normalize(-mvPosition.xyz)), 0.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map;
      uniform vec3 edgeColor;
      varying float vFacing;
      varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 surface = texture2D(map, vUv).rgb * 1.4;
        // Borde teñido de edgeColor, superficie con textura y centro casi blanco
        vec3 color = mix(edgeColor * 0.8, surface, smoothstep(0.0, 0.5, vFacing));
        color = mix(color, vec3(1.0), pow(vFacing, 4.0) * 0.6);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// Textura del aura del sol para un sprite de `sizeInRadii` radios de ancho. La luz es intensa
// justo en el borde del sol y se apaga poco a poco (decae aproximadamente con la distancia),
// así parece un halo de luz y no un disco.
function createGlowTexture(sizeInRadii) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const edge = 2 / sizeInRadii; // borde del sol en unidades del gradiente (0 = centro, 1 = borde del sprite)
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255, 250, 235, 1)');
  g.addColorStop(edge, 'rgba(255, 238, 205, 0.95)');
  // Caída suave: alfa a 1.5, 2, 3, 5 y 8 radios del centro, y nada al borde del sprite
  for (const [radii, alpha] of [
    [1.5, 0.6],
    [2, 0.42],
    [3, 0.24],
    [5, 0.1],
    [8, 0.035],
  ]) {
    const stop = radii * edge;
    if (stop < 1) g.addColorStop(stop, `rgba(255, 210, 150, ${alpha})`);
  }
  g.addColorStop(1, 'rgba(255, 190, 120, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Sol: esfera con textura + aura + la luz direccional principal, que sale de él hacia la Tierra
// Escala visual de sol y luna sobre su tamaño real (1 = real; 1.3 = un 30 % más grandes)
const CELESTIAL_SCALE = 1.3;
// Escala de sus distancias sobre la real (1 = real; 0.7 = un 30 % más cerca). La luna debe
// quedar siempre más allá del zoom máximo (~10 radios), así que no conviene bajar de ~0.2.
const CELESTIAL_DISTANCE_SCALE = 0.7;
const SUN_RADIUS = (696000 / EARTH_RADIUS_KM) * CELESTIAL_SCALE;
const SUN_DISTANCE = (149.6e6 / EARTH_RADIUS_KM) * CELESTIAL_DISTANCE_SCALE;
const SUN_DIRECTION = new THREE.Vector3(-22, 8, -40).normalize(); // detrás a la izquierda
const SUN_LIGHT_INTENSITY = 1.8;
const SUN_AURA_SIZE = 24; // ancho del aura de luz, en radios del sol (más = aura más grande)
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(SUN_RADIUS, 24, 16),
  createSunMaterial(loadColorTexture('/textures/sun_256.jpg'), 0xff9e22)
);
sun.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
const sunAura = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: createGlowTexture(SUN_AURA_SIZE),
    color: 0xffc24a,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
);
sunAura.scale.setScalar(SUN_RADIUS * SUN_AURA_SIZE);
sun.add(sunAura);
const sunLight = new THREE.DirectionalLight(0xfff6ea, SUN_LIGHT_INTENSITY);
sunLight.position.copy(sun.position);
scene.add(sun, sunLight);

// El sol está a ~23 500 radios terrestres: el plano lejano de la cámara tiene que llegar más allá
// (el buffer de profundidad logarítmico mantiene la precisión con distancias tan distintas)
camera.far = SUN_DISTANCE + SUN_RADIUS * SUN_AURA_SIZE;
camera.updateProjectionMatrix();

// Luna: esfera con textura iluminada por el sol (así muestra fases reales, sin brillo propio),
// con un poco de luz propia para que no desaparezca la cara oscura. Además ilumina la Tierra
// con el 10 % de la luz del sol.
const MOON_RADIUS = (1737.4 / EARTH_RADIUS_KM) * CELESTIAL_SCALE;
const MOON_DISTANCE = (384400 / EARTH_RADIUS_KM) * CELESTIAL_DISTANCE_SCALE;
const MOON_DIRECTION = new THREE.Vector3(26, 9, -30).normalize(); // detrás a la derecha
const MOON_LIGHT_RATIO = 0.1;
const moonTexture = loadColorTexture('/textures/moon_256.jpg');
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_RADIUS, 24, 16),
  new THREE.MeshStandardMaterial({
    map: moonTexture,
    emissiveMap: moonTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.15,
    roughness: 1,
    metalness: 0,
  })
);
moon.position.copy(MOON_DIRECTION).multiplyScalar(MOON_DISTANCE);
const moonLight = new THREE.DirectionalLight(0xcfdcff, SUN_LIGHT_INTENSITY * MOON_LIGHT_RATIO);
moonLight.position.copy(moon.position);
scene.add(moon, moonLight);

// Luz ambiental baja para que el lado nocturno no quede negro del todo
const AMBIENT_LIGHT_INTENSITY = 0.9; // luz que llega a todo el planeta por igual (más = más claro en todas partes)
scene.add(new THREE.AmbientLight(0xc8d4ff, AMBIENT_LIGHT_INTENSITY));

// --- Fondo: el cielo real --------------------------------------------------------
// Panorámica de 360° de todo el cielo (la Vía Láctea con sus nubes de polvo, nebulosas como
// la de Carina, las Nubes de Magallanes y miles de estrellas): fotografía de ESO/S. Brunier,
// licencia CC BY 4.0 (https://www.eso.org/public/images/eso0932a/).
// Está en coordenadas galácticas (la Vía Láctea en el ecuador de la imagen). Se inclina
// SKY_TILT_DEG, el ángulo real entre el plano de la galaxia y el ecuador terrestre, para que
// la Vía Láctea cruce el cielo con la inclinación que tiene vista desde la Tierra.
// Es un fondo infinito: gira con la cámara pero no se acerca al hacer zoom.
const SKY_BRIGHTNESS = 0.35; // 1 = como la foto; menos = más oscuro (para que destaque la Tierra)
// Versión de 2048 × 1024: a esta resolución las estrellas débiles se funden en un brillo suave y
// quedan la Vía Láctea, el polvo y las nebulosas (hay 6000 × 3000 en el original de ESO, si se quiere más detalle)
const SKY_TEXTURE = '/textures/milky_way_2k.jpg';
const SKY_TILT_DEG = 62.87;
const skyTexture = new THREE.TextureLoader().load(SKY_TEXTURE);
skyTexture.mapping = THREE.EquirectangularReflectionMapping;
skyTexture.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTexture;
scene.backgroundIntensity = SKY_BRIGHTNESS;
// Qué tramo de la Vía Láctea queda detrás de la Tierra en la vista inicial (giro a lo largo de la
// propia galaxia; 0 = su núcleo, que quedaría tapado por la Tierra)
const SKY_TURN_DEG = 125;
// Orden ZYX: primero se gira la galaxia sobre su eje (Y) y luego se inclina (Z), así la Vía
// Láctea cruza en diagonal por detrás de la Tierra
scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(SKY_TURN_DEG), THREE.MathUtils.degToRad(SKY_TILT_DEG), 'ZYX');

// --- Controles: rotar y zoom ------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08; // inercia al soltar: más alto = se frena antes
controls.enablePan = false;
controls.minDistance = SPHERE_RADIUS * (1 + ZOOM_MIN_ALTITUDE_KM / EARTH_RADIUS_KM);
controls.maxDistance = SPHERE_RADIUS * (1 + ZOOM_MAX_ALTITUDE_KM / EARTH_RADIUS_KM);
controls.zoomSpeed = 1.2; // solo para el pellizco en pantallas táctiles; la rueda va aparte (abajo)

// Velocidad de giro proporcional a la altura: de cerca, arrastrar la pantalla mueve
// aproximadamente lo que se ve, en vez de dar media vuelta al planeta.
function updateRotateSpeed(altitude) {
  controls.rotateSpeed = THREE.MathUtils.clamp(ROTATE_SPEED * altitude, 0.002, 1);
}

// Zoom con la rueda (o el trackpad): suave y proporcional a la altura. Cada paso de rueda
// multiplica la altura sobre el suelo, no la distancia al centro, así que el zoom va igual de
// ágil a 20 000 km que a 10 km. La cámara se acerca a la altura pedida de forma progresiva.
const MIN_ALTITUDE = controls.minDistance - SPHERE_RADIUS;
const MAX_ALTITUDE = controls.maxDistance - SPHERE_RADIUS;
let targetAltitude = camera.position.length() - SPHERE_RADIUS;
let zooming = false;

window.addEventListener(
  'wheel',
  (e) => {
    if (e.target !== renderer.domElement || controlsLocked) return;
    // Se intercepta en captura para que OrbitControls no aplique también su propio zoom
    e.preventDefault();
    e.stopPropagation();
    const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const current = zooming ? targetAltitude : camera.position.length() - SPHERE_RADIUS;
    targetAltitude = THREE.MathUtils.clamp(current * Math.exp(pixels * ZOOM_SENSITIVITY), MIN_ALTITUDE, MAX_ALTITUDE);
    zooming = true;
  },
  { capture: true, passive: false }
);

function updateZoom(dt) {
  if (!zooming) return;
  const altitude = camera.position.length() - SPHERE_RADIUS;
  // Interpolación en escala logarítmica: el acercamiento se ve igual de suave a cualquier altura
  const t = 1 - Math.exp(-dt * ZOOM_SMOOTHING);
  let next = Math.exp(THREE.MathUtils.lerp(Math.log(altitude), Math.log(targetAltitude), t));
  if (Math.abs(next - targetAltitude) < targetAltitude * 1e-3) {
    next = targetAltitude;
    zooming = false;
  }
  camera.position.setLength(SPHERE_RADIUS + next);
}

// Plano cercano de la cámara según la altura: tiene que quedar por delante del suelo
function updateCameraNear(altitude) {
  const near = THREE.MathUtils.clamp(altitude * 0.3, 1e-5, 0.01);
  if (near !== camera.near) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
}

// --- Esfera (Tierra) --------------------------------------------------------
const EARTH_SATURATION = 1.15; // 1 = colores originales; más alto = más vivos (las imágenes 2024 ya son vivas)
const EARTH_GLOW = 0.75; // luz propia del planeta (0 = solo la del sol/luna/ambiente)
// Suaviza las zonas muy claras (desiertos, hielo) sin tocar las oscuras: por encima de
// EARTH_HIGHLIGHT_KNEE de luminosidad, el brillo crece cada vez menos. 0 = sin efecto.
const EARTH_HIGHLIGHT_KNEE = 0.2;
const EARTH_HIGHLIGHT_COMPRESSION = 2.5;
const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();

// Relleno de países: lo pinta el propio shader de la Tierra (ver createCountryMask).
// Verde = país correcto; rojo = país en el que se hizo clic por error.
const CORRECT_COLOR = '#2ecc71';
const WRONG_COLOR = '#ff4d4f';
const MASK_OPACITY = 0.45;
const masks = [
  createCountryMask({ name: 'correctMask', color: CORRECT_COLOR, opacity: MASK_OPACITY }),
  createCountryMask({ name: 'wrongMask', color: WRONG_COLOR, opacity: MASK_OPACITY }),
];
const [correctMask, wrongMask] = masks;

// Modifica el shader estándar de three para la Tierra:
//  - sube la saturación de la textura y suaviza las zonas muy claras
//  - mezcla los rellenos de países (verde y rojo), calculando lon/lat de cada píxel
// Es una única función compartida, así que todos los materiales de la Tierra usan el mismo
// programa, y los uniforms de los rellenos son los mismos objetos para todos.
function earthShader(shader) {
  Object.assign(shader.uniforms, ...masks.map((m) => m.uniforms), {
    saturation: { value: EARTH_SATURATION },
    highlightKnee: { value: EARTH_HIGHLIGHT_KNEE },
    highlightCompression: { value: EARTH_HIGHLIGHT_COMPRESSION },
    earthGlow: { value: EARTH_GLOW },
  });

  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec3 vEarthPos;\nvoid main() {')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEarthPos = position;');

  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      /* glsl */ `uniform float saturation;
      uniform float highlightKnee;
      uniform float highlightCompression;
      // Comprime solo la parte de la luminosidad que pasa de highlightKnee (curva tipo Reinhard)
      vec3 compressHighlights(vec3 c) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        if (l <= highlightKnee || highlightCompression <= 0.0) return c;
        float over = l - highlightKnee;
        return c * (highlightKnee + over / (1.0 + over * highlightCompression)) / l;
      }
      ${masks
        .map(
          ({ name }) => `uniform sampler2D ${name};
      uniform vec4 ${name}Bounds;
      uniform float ${name}Opacity;
      uniform vec3 ${name}Color;`
        )
        .join('\n')}
      uniform float earthGlow;
      // Cuánto tapa una máscara este punto (0 = nada); bounds = lon0, lon1, latS, latN
      float maskAmount(sampler2D tex, vec4 bounds, float opacity, vec2 lonLat) {
        if (opacity <= 0.0) return 0.0;
        vec2 uv = (lonLat - bounds.xz) / (bounds.yw - bounds.xz);
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
        return texture2D(tex, uv).a * opacity;
      }
      varying vec3 vEarthPos;
      void main() {`
    )
    .replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
      float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = compressHighlights(max(mix(vec3(luma), diffuseColor.rgb, saturation), 0.0));

      vec3 ep = normalize(vEarthPos);
      vec2 lonLat = vec2(degrees(atan(-ep.z, ep.x)), degrees(asin(clamp(ep.y, -1.0, 1.0))));
      ${masks
        .map(
          ({ name }) => `float ${name}Mix = maskAmount(${name}, ${name}Bounds, ${name}Opacity, lonLat);
      diffuseColor.rgb = mix(diffuseColor.rgb, ${name}Color, ${name}Mix);`
        )
        .join('\n')}`
    )
    .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      float eLuma = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));
      totalEmissiveRadiance = max(mix(vec3(eLuma), totalEmissiveRadiance, saturation), 0.0);
      // La emisiva es textura × EARTH_GLOW: se comprime la textura y se vuelve a escalar
      if (earthGlow > 0.0) {
        totalEmissiveRadiance = compressHighlights(totalEmissiveRadiance / earthGlow) * earthGlow;
      }
      ${masks
        .map(({ name }) => `totalEmissiveRadiance = mix(totalEmissiveRadiance, ${name}Color * earthGlow, ${name}Mix);`)
        .join('\n')}`
    );
}

// Material de la Tierra para una textura dada (la global y cada tesela)
function createEarthMaterial(texture) {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    // La propia textura como emisiva: el planeta se ilumina con sus colores, también en la cara de noche
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: EARTH_GLOW,
    roughness: 0.75,
    metalness: 0,
  });
  material.onBeforeCompile = earthShader;
  return material;
}

// Textura global 4K (equirectangular, longitud -180° en el borde izquierdo), servida desde public/.
// Se ve al instante, en los polos (las teselas no llegan más allá de ±85°) y si no hay conexión.
// Va un pelo por debajo del radio real para quedar siempre bajo las teselas.
let resolveEarthTexture;
const earthTextureReady = new Promise((resolve) => (resolveEarthTexture = resolve));
const earthTexture = new THREE.TextureLoader().load('/textures/earth_day_4k.jpg', resolveEarthTexture, undefined, resolveEarthTexture);
earthTexture.colorSpace = THREE.SRGBColorSpace;
earthTexture.anisotropy = MAX_ANISOTROPY;

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(SPHERE_RADIUS * (1 - 2e-4), 128, 128),
  createEarthMaterial(earthTexture)
);
scene.add(sphere);

// Teselas encima de la textura global: más detalle cuanto más cerca está la cámara
const tileLayer = createTileLayer({
  url: TILE_URL,
  maxZoom: TILE_MAX_ZOOM,
  radius: SPHERE_RADIUS,
  createMaterial: createEarthMaterial,
  anisotropy: MAX_ANISOTROPY,
});
sphere.add(tileLayer.group);

// --- Países: fronteras y resaltado -----------------------------------------
const bordersMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
const outlineMaterials = {
  correct: new THREE.LineBasicMaterial({ color: CORRECT_COLOR }),
  wrong: new THREE.LineBasicMaterial({ color: WRONG_COLOR }),
};

let countries = null; // se rellena cuando termina de cargar el JSON
let borders = null; // todas las fronteras (LineSegments)
let bordersVisible = SHOW_BORDERS;
const outlines = { correct: null, wrong: null }; // contornos de los países resaltados

const countriesReady = loadCountries().then((data) => {
  countries = data;
  // Un pelo por encima de las teselas más detalladas (~250 m): pegadas al suelo incluso de cerca
  borders = createBorders(countries, SPHERE_RADIUS * (1 + 4e-5), bordersMaterial);
  borders.visible = bordersVisible;
  sphere.add(borders);
  return countries;
});
countriesReady.catch((err) => console.error(err));

function setBordersVisible(visible) {
  bordersVisible = visible;
  if (borders) borders.visible = visible;
}

// Resalta el país correcto (verde) y, si lo hay, el que se eligió por error (rojo)
function setHighlights({ correct = null, wrong = null } = {}) {
  correctMask.draw(correct);
  wrongMask.draw(wrong);
  for (const [kind, country] of Object.entries({ correct, wrong })) {
    if (outlines[kind]) {
      sphere.remove(outlines[kind]);
      outlines[kind].geometry.dispose();
      outlines[kind] = null;
    }
    if (country) {
      outlines[kind] = createCountryOutline(country, SPHERE_RADIUS * (1 + 5e-5), outlineMaterials[kind]);
      sphere.add(outlines[kind]);
    }
  }
}

// --- Pin --------------------------------------------------------------------
// Medidas a la distancia inicial de la cámara al suelo (PIN_REFERENCE_DISTANCE = 3): 2/3 del
// pin original. Cada frame se escala según su distancia a la cámara, así que al hacer zoom se
// acorta a la vez y en pantalla mantiene siempre el mismo tamaño (no tapa países pequeños).
const PIN_REFERENCE_DISTANCE = 3;
const PIN_HEIGHT = 0.12;
const PIN_STICK_RADIUS = 0.004;
const PIN_HEAD_RADIUS = 0.023;

function createPin() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xff5a5f, roughness: 0.4 });

  // La punta acaba en cono para marcar el punto exacto
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(PIN_STICK_RADIUS, 0, PIN_HEIGHT, 12), material);
  stick.position.y = PIN_HEIGHT / 2;

  const head = new THREE.Mesh(new THREE.SphereGeometry(PIN_HEAD_RADIUS, 24, 24), material);
  head.position.y = PIN_HEIGHT;

  group.add(stick, head);
  group.visible = false;
  return group;
}

const pin = createPin();
sphere.add(pin); // hijo de la esfera: se mueve con ella si algún día rota

// Etiqueta HTML que sigue a la cabeza del pin
const labelEl = document.createElement('div');
labelEl.className = 'pin-label';
const label = new CSS2DObject(labelEl);
label.position.y = PIN_HEIGHT + PIN_HEAD_RADIUS * 1.5;
label.center.set(0.5, 1); // anclada por su borde inferior: queda justo encima del pin
pin.add(label);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
document.body.appendChild(labelRenderer.domElement);

const UP = new THREE.Vector3(0, 1, 0);

function placePin(localPoint) {
  const normal = localPoint.clone().normalize();
  pin.position.copy(normal).multiplyScalar(SPHERE_RADIUS);
  pin.quaternion.setFromUnitVectors(UP, normal);
  pin.visible = true;
}

function removePin() {
  pin.visible = false;
}

// Contenido de la etiqueta del pin: bandera + texto; kind = 'correct' | 'wrong' | 'ocean'
function setPinLabel({ flag = null, text = '', kind = 'correct' } = {}) {
  labelEl.replaceChildren();
  if (flag) {
    const img = document.createElement('img');
    img.src = flag;
    img.alt = '';
    img.className = 'pin-flag';
    labelEl.append(img);
  }
  labelEl.append(text);
  labelEl.className = `pin-label is-${kind}`;
}

// Cada frame: escala el pin según la distancia a la cámara y oculta la etiqueta
// cuando el pin queda en la cara oculta del planeta
const pinWorld = new THREE.Vector3();
const pinNormal = new THREE.Vector3();
const toCamera = new THREE.Vector3();
function updatePin() {
  if (!pin.visible) {
    label.visible = false;
    return;
  }
  pin.getWorldPosition(pinWorld);
  pin.scale.setScalar(camera.position.distanceTo(pinWorld) / PIN_REFERENCE_DISTANCE);
  pinNormal.copy(pinWorld).sub(sphere.getWorldPosition(toCamera)).normalize();
  toCamera.copy(camera.position).sub(pinWorld).normalize();
  label.visible = pinNormal.dot(toCamera) > 0.05;
}

// --- Selección de país: mantener pulsado ----------------------------------------
// Con ratón, un clic normal no hace nada: para elegir un país hay que mantener pulsado sobre el globo
// HOLD_TO_SELECT_MS (1.5 s): mientras tanto se llena un anillo de carga junto al puntero.
// Si el puntero se mueve (se está girando el globo), se suelta antes o entra un segundo dedo
// (pellizco), se cancela. Al completarse se elige el punto que hay bajo el puntero en ese momento.
// En pantallas táctiles (móvil, tablet) basta con un toque: sin anillo ni espera. Si el dedo se
// mueve (se gira el globo) o entra un segundo dedo (pellizco), no cuenta como toque.
const raycaster = new THREE.Raycaster();
const earthBounds = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SPHERE_RADIUS);
const pointer = new THREE.Vector2();
const holdRing = document.getElementById('hold-ring');
// El anillo no aparece hasta pasado este tiempo manteniendo pulsado: así, al empezar a arrastrar
// para girar el globo, no da la impresión de que se está cargando una selección. Luego se llena
// en lo que queda hasta HOLD_TO_SELECT_MS (el tiempo total para elegir no cambia).
const HOLD_RING_DELAY_MS = 500;
holdRing.style.setProperty('--hold-ms', `${HOLD_TO_SELECT_MS - HOLD_RING_DELAY_MS}ms`);
const activePointers = new Set();
let hold = null; // { id, x, y, timer }
let tap = null; // toque en pantalla táctil: { id, startX, startY }

// Punto de la Tierra bajo unas coordenadas de pantalla (o null si no hay Tierra debajo)
function earthInfoAt(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // Contra la esfera matemática exacta (no contra la malla, que es poligonal y va algo más baja):
  // así el punto cae justo donde se pulsa aunque la cámara esté a pocos km del suelo
  const hit = raycaster.ray.intersectSphere(earthBounds, new THREE.Vector3());
  if (!hit) return null;
  const localPoint = sphere.worldToLocal(hit.clone());
  const { lon, lat } = vector3ToLonLat(localPoint);
  // Cuántos km de suelo ocupa un píxel de pantalla en ese punto
  const distanceKm = camera.position.distanceTo(hit) * EARTH_RADIUS_KM;
  const kmPerPixel =
    (2 * distanceKm * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / renderer.domElement.clientHeight;
  return { lon, lat, localPoint, kmPerPixel, country: countries ? findCountry(countries, lon, lat) : null };
}

function showHoldRing(x, y) {
  holdRing.style.left = `${x}px`;
  holdRing.style.top = `${y}px`;
  holdRing.classList.remove('is-filling', 'is-done');
  holdRing.hidden = false;
  void holdRing.offsetWidth; // reinicia la animación
  holdRing.classList.add('is-filling');
}

function hideHoldRing(done = false) {
  if (done) {
    holdRing.classList.add('is-done');
    setTimeout(() => (holdRing.hidden = true), 220);
  } else {
    holdRing.hidden = true;
  }
  holdRing.classList.remove('is-filling');
}

function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  clearTimeout(hold.ringTimer);
  hold = null;
  hideHoldRing();
}

function selectAt(x, y) {
  if (!globe.canSelect?.() || !globe.onEarthClick) return;
  const info = earthInfoAt(x, y);
  if (info) globe.onEarthClick(info);
}

function completeHold() {
  const { x, y } = hold;
  clearTimeout(hold.ringTimer);
  hold = null;
  hideHoldRing(true);
  selectAt(x, y);
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) {
    tap = null;
    return cancelHold(); // pellizco con dos dedos
  }
  if (e.button !== 0 || !globe.canSelect?.() || !earthInfoAt(e.clientX, e.clientY)) return;
  cancelHold();
  if (e.pointerType === 'touch') {
    tap = { id: e.pointerId, startX: e.clientX, startY: e.clientY }; // se elige al levantar el dedo
    return;
  }
  hold = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
  hold.timer = setTimeout(completeHold, HOLD_TO_SELECT_MS);
  hold.ringTimer = setTimeout(() => showHoldRing(hold.x, hold.y), HOLD_RING_DELAY_MS);
});

canvas.addEventListener('pointermove', (e) => {
  if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY) > CLICK_MOVE_TOLERANCE) {
    tap = null; // es un arrastre para girar el globo
  }
  if (!hold || e.pointerId !== hold.id) return;
  // Moverse más de unos píxeles es girar el globo, no seleccionar
  if (Math.hypot(e.clientX - hold.startX, e.clientY - hold.startY) > CLICK_MOVE_TOLERANCE) cancelHold();
});

for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  canvas.addEventListener(type, (e) => {
    activePointers.delete(e.pointerId);
    if (tap && e.pointerId === tap.id) {
      const done = tap;
      tap = null;
      if (type === 'pointerup') selectAt(done.startX, done.startY); // toque: se elige ya
    }
    if (hold && e.pointerId === hold.id) cancelHold(); // se soltó antes de tiempo
  });
}

// En pantallas táctiles, mantener pulsado no debe abrir el menú contextual del navegador
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// --- Vuelo de la cámara hasta un punto -------------------------------------
// Gira la cámara alrededor del planeta hasta quedar sobre (lon, lat), manteniendo la altura
// (o alejándose un poco si está muy cerca, para que se vea el país entero).
let flight = null;
let controlsLocked = false; // true con la partida en pausa
// `targetAltitude` (opcional, en radios terrestres) fija la altura final, p. ej. para acercarse
// a un país pequeño; siempre dentro de los límites de zoom.
function flyTo(lon, lat, duration = 1.2, targetAltitude = null) {
  const altitude = camera.position.length() - SPHERE_RADIUS;
  const toAltitude =
    targetAltitude == null
      ? THREE.MathUtils.clamp(altitude, 0.35, 3)
      : THREE.MathUtils.clamp(targetAltitude, MIN_ALTITUDE, Math.min(3, MAX_ALTITUDE));
  flight = {
    from: camera.position.clone().normalize(),
    to: lonLatToVector3(lon, lat, 1),
    fromAltitude: altitude,
    toAltitude,
    t: 0,
    duration,
  };
  controls.enabled = false;
  zooming = false;
}

const flightRotation = new THREE.Quaternion();
const identity = new THREE.Quaternion();
function updateFlight(dt) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / flight.duration);
  const e = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2; // ease in-out
  flightRotation.setFromUnitVectors(flight.from, flight.to);
  const dir = flight.from.clone().applyQuaternion(identity.clone().slerp(flightRotation, e));
  const altitude = THREE.MathUtils.lerp(flight.fromAltitude, flight.toAltitude, e);
  camera.position.copy(dir.multiplyScalar(SPHERE_RADIUS + altitude));
  if (flight.t >= 1) {
    flight = null;
    controls.enabled = !controlsLocked;
  }
}

// --- API del globo para el juego ----------------------------------------------
const globe = {
  countriesReady, // promesa con la lista de países
  onEarthClick: null, // (info) => void; info = { lon, lat, localPoint, kmPerPixel, country }
  canSelect: null, // () => boolean: si ahora se puede elegir país (lo asigna el juego)
  menuBordersVisible: SHOW_BORDERS,
  setBordersVisible,
  setHighlights,
  placePin,
  removePin,
  setPinLabel,
  flyTo,
  setViewShift,
  // Bloquea o desbloquea girar y hacer zoom (p. ej. con la partida en pausa)
  setControlsEnabled(enabled) {
    if (!enabled) {
      cancelHold();
      tap = null;
    }
    controlsLocked = !enabled;
    controls.enabled = enabled && !flight;
    if (!enabled) zooming = false;
  },
  // Punto de la Tierra que queda bajo la cámara: { lon, lat }
  getViewCenter: () => vector3ToLonLat(camera.position),
  setAutoRotate(enabled) {
    controls.autoRotate = enabled;
    controls.autoRotateSpeed = 0.4;
  },
};

// --- Desplazamiento lateral de la vista ----------------------------------------
// En los menús el planeta se aparta a la derecha para dejar sitio al panel. Se hace con
// setViewOffset (como si se recortara una imagen más ancha), así la cámara y los controles
// siguen girando alrededor del centro de la Tierra. La transición es suave.
let viewShift = 0;
let targetViewShift = 0;
function setViewShift(fraction) {
  targetViewShift = fraction;
}
function updateViewShift(dt) {
  const diff = targetViewShift - viewShift;
  viewShift = Math.abs(diff) < 1e-4 ? targetViewShift : viewShift + diff * (1 - Math.exp(-dt * 5));
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  if (viewShift === 0) {
    if (camera.view?.enabled) camera.clearViewOffset();
  } else {
    camera.setViewOffset(w, h, -viewShift * w, 0, w, h);
  }
}

// --- Pantalla de carga --------------------------------------------------------------
// Se quita cuando están la textura global, los países y las primeras teselas (así no se ve
// el planeta a medio cargar). Si algo tarda demasiado, se quita igual a los 8 segundos.
const loadingScreen = document.getElementById('loading');
let baseReady = false;
Promise.all([countriesReady, earthTextureReady]).finally(() => (baseReady = true));
const loadingStart = performance.now();
function updateLoading() {
  if (!loadingScreen || loadingScreen.classList.contains('is-done')) return;
  if ((baseReady && tileLayer.isIdle()) || performance.now() - loadingStart > 8000) {
    loadingScreen.classList.add('is-done');
  }
}

createGame(globe);

// --- Loop y resize ----------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = performance.now();
renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  updateZoom(dt);
  updateFlight(dt);
  updateViewShift(dt);
  if (!zooming) targetAltitude = camera.position.length() - SPHERE_RADIUS; // p. ej. tras un pellizco
  const altitude = camera.position.length() - SPHERE_RADIUS;
  updateRotateSpeed(altitude);
  updateCameraNear(altitude);
  controls.update();
  tileLayer.update(camera, renderer.domElement.clientHeight);
  updateLoading();
  updatePin();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
