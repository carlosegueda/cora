import * as THREE from 'three';
import { lonLatToVector3 } from './geo.js';

// Datos generados con scripts/prepare-countries.mjs:
// [{ name_es, name_en, name_pt, iso, iso3, type, sovereign, continent, flag,
//    polygons: [ [ anilloExterior, hueco1, ... ], ... ] }], anillos = [[lon, lat], ...]
export async function loadCountries(url = '/data/countries.json') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudieron cargar los países (${response.status})`);
  const countries = await response.json();

  // Caja lon/lat de cada polígono para descartar rápido en la búsqueda
  for (const country of countries) {
    country.bboxes = country.polygons.map(([outer]) => {
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const [lon, lat] of outer) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      return { minLon, minLat, maxLon, maxLat };
    });
  }
  return countries;
}

// --- Búsqueda del país en un punto -------------------------------------------
// Ray casting en el plano lon/lat. Natural Earth corta los polígonos en el antimeridiano
// (±180°), así que no hace falta tratar polígonos que lo crucen.
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lon, lat, [outer, ...holes]) {
  return pointInRing(lon, lat, outer) && !holes.some((hole) => pointInRing(lon, lat, hole));
}

export function findCountry(countries, lon, lat) {
  for (const country of countries) {
    for (let i = 0; i < country.polygons.length; i++) {
      const b = country.bboxes[i];
      if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
      if (pointInPolygon(lon, lat, country.polygons[i])) return country;
    }
  }
  return null;
}

// --- Geometría de fronteras --------------------------------------------------
const MAX_SEGMENT_DEG = 0.25; // tramos más largos se subdividen para que sigan la curvatura (y no se hundan bajo el terreno de cerca)

function ringToSegments(ring, radius, out) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1)) / MAX_SEGMENT_DEG));
    for (let s = 0; s < steps; s++) {
      const t1 = s / steps;
      const t2 = (s + 1) / steps;
      lonLatToVector3(lon1 + (lon2 - lon1) * t1, lat1 + (lat2 - lat1) * t1, radius, a);
      lonLatToVector3(lon1 + (lon2 - lon1) * t2, lat1 + (lat2 - lat1) * t2, radius, b);
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
}

function polygonsToGeometry(polygons, radius) {
  const positions = [];
  for (const polygon of polygons) {
    for (const ring of polygon) ringToSegments(ring, radius, positions);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

// Todas las fronteras del mundo en un único objeto (una sola llamada de dibujo)
export function createBorders(countries, radius, material) {
  return new THREE.LineSegments(
    polygonsToGeometry(countries.flatMap((c) => c.polygons), radius),
    material
  );
}

// Contorno de un solo país (para resaltarlo)
export function createCountryOutline(country, radius, material) {
  return new THREE.LineSegments(polygonsToGeometry(country.polygons, radius), material);
}

// --- Máscara de un país (relleno) ----------------------------------------------
// El país se pinta en un canvas que cubre solo su recuadro lon/lat, y el shader de la
// Tierra (textura global y teselas) mezcla ese canvas con el terreno. Así el relleno queda
// pegado al suelo a cualquier zoom, sin geometría extra que pueda flotar o atravesarse.
//
// Devuelve `uniforms` (objetos compartidos: el shader de la Tierra los enlaza tal cual,
// así que basta con cambiar su `value`) y `draw(country)` para cambiar de país.
export function createCountryMask({ color, opacity, maxSize = 2048 }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const empty = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  empty.needsUpdate = true;

  const uniforms = {
    countryMask: { value: empty },
    countryMaskBounds: { value: new THREE.Vector4(0, 1, 0, 1) }, // lon0, lon1, latS, latN (grados)
    countryMaskOpacity: { value: 0 },
    countryMaskColor: { value: new THREE.Color(color) },
  };

  function draw(country) {
    if (!country) {
      uniforms.countryMaskOpacity.value = 0;
      return;
    }

    // Recuadro del país con un pequeño margen
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const b of country.bboxes) {
      minLon = Math.min(minLon, b.minLon);
      maxLon = Math.max(maxLon, b.maxLon);
      minLat = Math.min(minLat, b.minLat);
      maxLat = Math.max(maxLat, b.maxLat);
    }
    const pad = Math.max(0.05, 0.02 * Math.max(maxLon - minLon, maxLat - minLat));
    const lon0 = Math.max(-180, minLon - pad);
    const lon1 = Math.min(180, maxLon + pad);
    const latS = Math.max(-90, minLat - pad);
    const latN = Math.min(90, maxLat + pad);

    // Canvas con la misma escala en los dos ejes, sin pasar de maxSize por lado
    const pxPerDeg = Math.min(maxSize / (lon1 - lon0), maxSize / (latN - latS));
    canvas.width = Math.max(2, Math.round((lon1 - lon0) * pxPerDeg));
    canvas.height = Math.max(2, Math.round((latN - latS) * pxPerDeg));
    const toX = (lon) => (lon - lon0) * pxPerDeg;
    const toY = (lat) => (latN - lat) * pxPerDeg;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    for (const polygon of country.polygons) {
      for (const ring of polygon) {
        ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(toX(lon), toY(lat)) : ctx.moveTo(toX(lon), toY(lat))));
        ctx.closePath();
      }
    }
    ctx.fillStyle = '#fff'; // solo importa el canal alfa; el color lo pone el shader
    ctx.fill('evenodd'); // los huecos (p. ej. Lesoto dentro de Sudáfrica) quedan sin pintar
    // Un trazo fino garantiza que los países diminutos ocupen al menos un par de píxeles
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // El canvas cambia de tamaño en cada país, así que la textura se crea de nuevo
    if (uniforms.countryMask.value !== empty) uniforms.countryMask.value.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    // Sin mipmaps: el shader calcula la UV con atan(), que salta en ±180°, y con mipmaps
    // ese salto dibujaría una línea en países que cruzan el antimeridiano (Rusia, Fiyi)
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    uniforms.countryMask.value = texture;
    uniforms.countryMaskBounds.value.set(lon0, lon1, latS, latN);
    uniforms.countryMaskOpacity.value = opacity;
  }

  return { uniforms, draw };
}
