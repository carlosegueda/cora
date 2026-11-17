//Country 
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadCountries, findCountry, createBorders, createCountryOutline, createCountryMask } from './countries.js';
import { vector3ToLonLat } from './geo.js';
import { createTileLayer } from './tiles.js';

const SPHERE_RADIUS = 1;
const CLICK_MOVE_TOLERANCE = 5; // px: más movimiento que esto cuenta como arrastre, no clic
const SHOW_BORDERS = false; // fronteras entre países: true = visibles, false = ocultas

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
const ZOOM_MAX_ALTITUDE_KM = 57000; // lo más lejos (la vista inicial está a ~19 000 km)

// Navegación
const ZOOM_SENSITIVITY = 0.003; // cuánto cambia la altura por cada píxel de rueda (más = zoom más rápido)
const ZOOM_SMOOTHING = 12; // velocidad con la que la cámara alcanza el zoom pedido (más = más directo)
const ROTATE_SPEED = 0.25; // giro respecto a la altura (más = arrastre más rápido)

// --- Escena básica ---------------------------------------------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 4);

// Buffer de profundidad logarítmico: permite ver a la vez el suelo a pocos km y el sol a
// millones sin que las capas (teselas, fronteras) parpadeen entre sí
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Astros de fondo: esferas que brillan por sí mismas y emiten luz -------
// Esfera blanca en el centro que se apaga hacia `edgeColor` en el borde.
// No le afecta la luz de la escena.
function createGlowingSphereMaterial(edgeColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      centerColor: { value: new THREE.Color(0xffffff) },
      edgeColor: { value: new THREE.Color(edgeColor) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vFacing;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        vFacing = max(dot(viewNormal, normalize(-mvPosition.xyz)), 0.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 centerColor;
      uniform vec3 edgeColor;
      varying float vFacing;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(mix(edgeColor, centerColor, pow(vFacing, 3.0)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

// Textura del aura. El sprite mide 4 radios, así que el borde del astro cae en 0.5 del gradiente
function createGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 245, 225, 0.5)');
  g.addColorStop(0.5, 'rgba(255, 230, 190, 0.3)');
  g.addColorStop(0.7, 'rgba(220, 180, 130, 0.1)');
  g.addColorStop(1, 'rgba(200, 160, 110, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const glowTexture = createGlowTexture();

// Crea un astro: esfera + aura + luz direccional que sale de él hacia el origen
function createLuminousBody({ position, radius, edgeColor, auraColor, auraOpacity, lightColor, lightIntensity }) {
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), createGlowingSphereMaterial(edgeColor));
  body.position.copy(position);

  const aura = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: auraColor,
      opacity: auraOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    })
  );
  aura.scale.setScalar(radius * 4);
  body.add(aura);

  const light = new THREE.DirectionalLight(lightColor, lightIntensity);
  light.position.copy(position);

  scene.add(body, light);
  return { body, light };
}

// Sun
const SUN_RADIUS = 3;
const SUN_LIGHT_INTENSITY = 1.4;
const sun = createLuminousBody({
  position: new THREE.Vector3(-30, 12, -40),
  radius: SUN_RADIUS,
  edgeColor: 0xff9e22,
  auraColor: 0xffc24a,
  auraOpacity: 1,
  lightColor: 0xfff6ea,
  lightIntensity: SUN_LIGHT_INTENSITY,
});

// Luna: proporción real luna/tierra (~0.27) aplicada al tamaño del sol en pantalla,
// en el lado opuesto del cielo. Emite el 10% de la luz del sol.
const MOON_LIGHT_RATIO = 0.1;
const moon = createLuminousBody({
  position: new THREE.Vector3(26, 9, -30),
  radius: SUN_RADIUS * 0.27,
  edgeColor: 0x5a6070,
  auraColor: 0xc8d4ff,
  auraOpacity: 0.5,
  lightColor: 0xcfdcff,
  lightIntensity: SUN_LIGHT_INTENSITY * MOON_LIGHT_RATIO,
});

// Luz ambiental baja para que el lado nocturno no quede negro del todo
scene.add(new THREE.AmbientLight(0xb0c0ff, 0.55));

// --- Fondo de estrellas -----------------------------------------------------
// Puntos repartidos en una cáscara esférica lejana (dentro del `far` de la cámara)
function createStarfield({ count = 4000, minRadius = 60, maxRadius = 85 } = {}) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  const dir = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    dir.randomDirection().multiplyScalar(THREE.MathUtils.randFloat(minRadius, maxRadius));
    dir.toArray(positions, i * 3);

    // Brillo variado: la mayoría tenues, unas pocas brillantes; tinte frío o cálido sutil
    const brightness = 0.25 + Math.pow(Math.random(), 3) * 0.75;
    color.setHSL(Math.random() < 0.5 ? 0.6 : 0.1, 0.25, brightness);
    color.toArray(colors, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Textura circular suave para que las estrellas no sean cuadradas
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const material = new THREE.PointsMaterial({
    size: 2.5,
    sizeAttenuation: false, // tamaño fijo en píxeles: no cambian con el zoom
    map: new THREE.CanvasTexture(canvas),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}
scene.add(createStarfield());

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
    if (e.target !== renderer.domElement) return;
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
const EARTH_SATURATION = 1.1; // 1 = colores originales; más alto = más vivos (las imágenes 2024 ya son vivas)
const EARTH_GLOW = 0.45; // luz propia del planeta (0 = solo la del sol/luna/ambiente)
// Suaviza las zonas muy claras (desiertos, hielo) sin tocar las oscuras: por encima de
// EARTH_HIGHLIGHT_KNEE de luminosidad, el brillo crece cada vez menos. 0 = sin efecto.
const EARTH_HIGHLIGHT_KNEE = 0.2;
const EARTH_HIGHLIGHT_COMPRESSION = 2.5;
const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();

// Relleno del país con pin: lo pinta el propio shader de la Tierra (ver createCountryMask)
const HIGHLIGHT_COLOR = '#2ecc71'; // verde del país con pin (relleno, contorno y etiqueta)
const countryMask = createCountryMask({ color: HIGHLIGHT_COLOR, opacity: 0.45 });

// Modifica el shader estándar de three para la Tierra:
//  - sube la saturación de la textura (color base y emisivo)
//  - mezcla el relleno verde del país seleccionado, calculando lon/lat de cada píxel
// Es una única función compartida, así que todos los materiales de la Tierra usan el mismo
// programa, y los uniforms del relleno son los mismos objetos para todos.
function earthShader(shader) {
  Object.assign(shader.uniforms, countryMask.uniforms, {
    saturation: { value: EARTH_SATURATION },
    highlightKnee: { value: EARTH_HIGHLIGHT_KNEE },
    highlightCompression: { value: EARTH_HIGHLIGHT_COMPRESSION },
    countryMaskGlow: { value: EARTH_GLOW },
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
      uniform sampler2D countryMask;
      uniform vec4 countryMaskBounds;
      uniform float countryMaskOpacity;
      uniform vec3 countryMaskColor;
      uniform float countryMaskGlow;
      varying vec3 vEarthPos;
      void main() {`
    )
    .replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
      float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = compressHighlights(max(mix(vec3(luma), diffuseColor.rgb, saturation), 0.0));

      float countryMix = 0.0;
      if (countryMaskOpacity > 0.0) {
        vec3 ep = normalize(vEarthPos);
        float lonDeg = degrees(atan(-ep.z, ep.x));
        float latDeg = degrees(asin(clamp(ep.y, -1.0, 1.0)));
        vec2 maskUv = vec2(
          (lonDeg - countryMaskBounds.x) / (countryMaskBounds.y - countryMaskBounds.x),
          (latDeg - countryMaskBounds.z) / (countryMaskBounds.w - countryMaskBounds.z)
        );
        if (all(greaterThanEqual(maskUv, vec2(0.0))) && all(lessThanEqual(maskUv, vec2(1.0)))) {
          countryMix = texture2D(countryMask, maskUv).a * countryMaskOpacity;
        }
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, countryMaskColor, countryMix);`
    )
    .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      float eLuma = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));
      totalEmissiveRadiance = max(mix(vec3(eLuma), totalEmissiveRadiance, saturation), 0.0);
      // La emisiva es textura × EARTH_GLOW: se comprime la textura y se vuelve a escalar
      if (countryMaskGlow > 0.0) {
        totalEmissiveRadiance = compressHighlights(totalEmissiveRadiance / countryMaskGlow) * countryMaskGlow;
      }
      totalEmissiveRadiance = mix(totalEmissiveRadiance, countryMaskColor * countryMaskGlow, countryMix);`
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
const earthTexture = new THREE.TextureLoader().load('/textures/earth_day_4k.jpg');
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

// --- Países: fronteras, resaltado y detección -------------------------------
const bordersMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
const highlightMaterial = new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOR });

let countries = null; // se rellena cuando termina de cargar el JSON
let borders = null; // todas las fronteras (LineSegments)
let highlight = null; // contorno del país seleccionado
let highlightedCountry = null;


loadCountries()
  .then((data) => {
    countries = data;
    // Un pelo por encima de las teselas más detalladas (~250 m): pegadas al suelo incluso de cerca
    borders = createBorders(countries, SPHERE_RADIUS * (1 + 4e-5), bordersMaterial);
    borders.visible = SHOW_BORDERS;
    sphere.add(borders);
    if (pin.visible) updatePinInfo(); // por si se colocó el pin antes de que cargaran
  })
  .catch((err) => console.error(err));

function setHighlight(country) {
  if (country === highlightedCountry) return; // mismo país: no hace falta repintar
  highlightedCountry = country;

  if (highlight) {
    sphere.remove(highlight);
    highlight.geometry.dispose();
    highlight = null;
  }
  countryMask.draw(country);
  if (country) {
    highlight = createCountryOutline(country, SPHERE_RADIUS * (1 + 5e-5), highlightMaterial);
    sphere.add(highlight);
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
let pinLonLat = null;

function placePin(localPoint) {
  const normal = localPoint.clone().normalize();
  pin.position.copy(normal).multiplyScalar(SPHERE_RADIUS);
  pin.quaternion.setFromUnitVectors(UP, normal);
  pin.visible = true;
  pinLonLat = vector3ToLonLat(normal);
  updatePinInfo();
}

function removePin() {
  pin.visible = false;
  pinLonLat = null;
  setHighlight(null);
  updatePinInfo();
}

const coordsEl = document.getElementById('coords');
function updatePinInfo() {
  if (!pinLonLat) {
    coordsEl.textContent = '';
    return;
  }
  const { lon, lat } = pinLonLat;
  const country = countries ? findCountry(countries, lon, lat) : null;
  const name = !countries ? 'Cargando países…' : country ? country.name_es : 'Océano';

  setHighlight(country);
  labelEl.replaceChildren();
  if (country?.flag) {
    const flag = document.createElement('img');
    flag.src = country.flag;
    flag.alt = '';
    flag.className = 'pin-flag';
    labelEl.append(flag);
  }
  labelEl.append(name);
  labelEl.classList.toggle('is-ocean', countries !== null && !country);
  coordsEl.textContent = `${name} · lat ${lat.toFixed(2)}°, lon ${lon.toFixed(2)}°`;
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

// --- Clic vs. arrastre ------------------------------------------------------
const raycaster = new THREE.Raycaster();
const earthBounds = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SPHERE_RADIUS);
const pointer = new THREE.Vector2();
let downPos = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  downPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > CLICK_MOVE_TOLERANCE) return; // fue un arrastre para rotar

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Contra la esfera matemática exacta (no contra la malla, que es poligonal y va algo más baja):
  // así el pin cae justo donde se hace clic aunque la cámara esté a pocos km del suelo
  const hit = raycaster.ray.intersectSphere(earthBounds, new THREE.Vector3());
  if (hit) {
    placePin(sphere.worldToLocal(hit));
  } else {
    removePin();
  }
});

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
  if (!zooming) targetAltitude = camera.position.length() - SPHERE_RADIUS; // p. ej. tras un pellizco
  const altitude = camera.position.length() - SPHERE_RADIUS;
  updateRotateSpeed(altitude);
  updateCameraNear(altitude);
  controls.update();
  tileLayer.update(camera, renderer.domElement.clientHeight);
  updatePin();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
