import * as THREE from 'three';
import { createSpherePatch, lonLatToVector3, mercatorToLat } from './geo.js';

// Capa de teselas (como Google Maps, pero sobre la esfera).
//
// Cada frame se decide qué teselas hacen falta con un árbol cuaternario: se parte de las
// 16 teselas del nivel 2 y se subdivide una tesela si mira hacia la cámara y ocupa en
// pantalla más de `tileSize * splitFactor` píxeles, hasta `maxZoom`. Así solo se descarga
// lo que se ve, y con más detalle cuanto más cerca está la cámara.
//
// Mientras una tesela carga se muestra su antecesora más cercana ya cargada; si no hay
// ninguna, se ve la textura global de la esfera que queda debajo. Cada nivel se dibuja un
// pelo más alto que el anterior, así que el más detallado siempre queda encima.
//
// Las imágenes se decodifican fuera del hilo principal (ImageBitmapLoader), así que la
// llegada de teselas no provoca tirones al girar o hacer zoom.
export function createTileLayer({
  url, // plantilla con {z}, {x}, {y}
  maxZoom,
  radius,
  createMaterial, // (texture) => Material
  anisotropy = 1,
  minZoom = 2,
  tileSize = 256,
  splitFactor = 1.1,
  maxSegmentDeg = 1.4, // paso máximo de la malla: las teselas grandes siguen bien la curvatura
  maxConcurrent = 12,
  maxCached = 300,
}) {
  const group = new THREE.Group();
  const loader = new THREE.ImageBitmapLoader();
  loader.setCrossOrigin('anonymous');
  loader.setOptions({ imageOrientation: 'flipY' }); // las ImageBitmap no se pueden voltear después

  const tiles = new Map(); // clave → { z, x, y, state: 'loading'|'ready'|'error', mesh, lastUsed }
  const nodes = new Map(); // clave → muestras 3D de la tesela para decidir visibilidad y tamaño
  let inFlight = 0;
  let frame = 0;

  const key = (z, x, y) => `${z}/${x}/${y}`;
  // ~13 m más alto por nivel: suficiente para que el más detallado quede encima y tan poco
  // que no se nota aunque la cámara esté a pocos km del suelo
  const tileRadius = (z) => radius * (1 + 2e-6 * (z + 1));

  function tileBounds(z, x, y) {
    const n = 2 ** z;
    return {
      lon0: (x / n) * 360 - 180,
      lon1: ((x + 1) / n) * 360 - 180,
      latAt: (s) => mercatorToLat((y + s) / n),
    };
  }

  // 9 puntos de la tesela (esquinas, centros de lado y centro) + tamaño aproximado
  function getNode(z, x, y) {
    const k = key(z, x, y);
    let node = nodes.get(k);
    if (node) return node;

    const { lon0, lon1, latAt } = tileBounds(z, x, y);
    const samples = [];
    for (const s of [0, 0.5, 1]) {
      for (const u of [0, 0.5, 1]) {
        samples.push(lonLatToVector3(lon0 + (lon1 - lon0) * u, latAt(s), radius));
      }
    }
    // Lado más largo de la tesela (en la esfera, el borde más cercano al ecuador)
    const size = Math.max(
      samples[0].distanceTo(samples[2]),
      samples[6].distanceTo(samples[8]),
      samples[0].distanceTo(samples[6]),
      samples[2].distanceTo(samples[8])
    );
    // Las teselas del borde llevan casquete hasta el polo (ver requestTile): el polo cuenta
    // como parte de la tesela para decidir si se ve
    const n = 2 ** z;
    if (y === 0) samples.push(new THREE.Vector3(0, radius, 0));
    if (y === n - 1) samples.push(new THREE.Vector3(0, -radius, 0));
    // Esfera que envuelve la tesela, para descartar las que quedan fuera del campo de visión
    const bounds = new THREE.Sphere(samples[4].clone(), Math.max(...samples.map((p) => p.distanceTo(samples[4]))));
    node = { samples, center: samples[4], size, bounds };
    if (nodes.size > 20000) nodes.clear();
    nodes.set(k, node);
    return node;
  }

  // Un punto p de la esfera es visible si queda por delante del horizonte: p · cam > r²
  function isFacing(node, camPos) {
    const limit = radius * radius;
    return node.samples.some((p) => p.dot(camPos) > limit);
  }

  function requestTile(z, x, y) {
    const k = key(z, x, y);
    if (tiles.has(k) || inFlight >= maxConcurrent) return;

    const tile = { z, x, y, state: 'loading', mesh: null, lastUsed: frame };
    tiles.set(k, tile);
    inFlight++;

    const src = url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    loader.load(
      src,
      (bitmap) => {
        inFlight--;
        if (tiles.get(k) !== tile) return bitmap.close(); // se descartó mientras cargaba
        const texture = new THREE.Texture(bitmap);
        texture.flipY = false; // ya viene volteada por imageOrientation
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        const bounds = tileBounds(z, x, y);
        const segments = THREE.MathUtils.clamp(Math.ceil((bounds.lon1 - bounds.lon0) / maxSegmentDeg), 2, 64);
        const geometry = createSpherePatch({
          ...bounds,
          radius: tileRadius(z),
          segmentsX: segments,
          segmentsY: segments,
        });
        tile.mesh = new THREE.Mesh(geometry, createMaterial(texture));

        // Las teselas Web Mercator acaban en ±85.05°. En la fila del borde se añade un casquete
        // hasta el polo que estira la última fila de píxeles: el color continúa sin dejar un
        // círculo con la textura global (que en los polos es blanca y no encaja).
        const n = 2 ** z;
        if (y === 0 || y === n - 1) {
          const north = y === 0;
          const edgeLat = bounds.latAt(north ? 0 : 1);
          const edgeV = north ? 1 - 0.5 / tileSize : 0.5 / tileSize; // centro de la fila de píxeles del borde
          const cap = createSpherePatch({
            lon0: bounds.lon0,
            lon1: bounds.lon1,
            latAt: north ? (s) => 90 - (90 - edgeLat) * s : (s) => edgeLat - (90 + edgeLat) * s,
            vAt: () => edgeV,
            radius: tileRadius(z),
            segmentsX: segments,
            // Filas cada 0.5°: con tramos más largos la malla se hunde por debajo de la textura
            // global (que va 1.3 km más baja) y esta asoma como un anillo blanco
            segmentsY: Math.ceil((90 - Math.abs(edgeLat)) / 0.5),
          });
          tile.mesh.add(new THREE.Mesh(cap, tile.mesh.material)); // hijo: se muestra y oculta con la tesela
        }
        tile.mesh.visible = false;
        group.add(tile.mesh);
        tile.state = 'ready';
      },
      undefined,
      () => {
        inFlight--;
        tile.state = 'error'; // no se reintenta; se seguirá viendo su antecesora
      }
    );
  }

  function disposeTile(k, tile) {
    if (tile.mesh) {
      group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      for (const cap of tile.mesh.children) cap.geometry.dispose();
      const map = tile.mesh.material.map;
      map?.source.data?.close?.(); // libera la ImageBitmap
      map?.dispose();
      tile.mesh.material.dispose();
    }
    tiles.delete(k);
  }

  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();

  function update(camera, viewportHeight) {
    frame++;
    const camPos = camera.position;
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    const pxPerUnit = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

    // 1. Teselas necesarias (hojas del árbol)
    const needed = [];
    const visit = (z, x, y) => {
      const node = getNode(z, x, y);
      if (!isFacing(node, camPos) || !frustum.intersectsSphere(node.bounds)) return;
      if (z < maxZoom) {
        const projected = (node.size / Math.max(camPos.distanceTo(node.center), 1e-6)) * pxPerUnit;
        if (projected > tileSize * splitFactor) {
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(z + 1, x * 2 + dx, y * 2 + dy);
          return;
        }
      }
      needed.push([z, x, y]);
    };
    const n0 = 2 ** minZoom;
    for (let x = 0; x < n0; x++) for (let y = 0; y < n0; y++) visit(minZoom, x, y);

    // 2. Qué se muestra: cada tesela necesaria si ya cargó; si no, su antecesora cargada más cercana
    const show = new Set();
    // Las de menos nivel primero, para que las peticiones vayan de lo general a lo detallado
    needed.sort((a, b) => a[0] - b[0]);
    for (const [z, x, y] of needed) {
      const tile = tiles.get(key(z, x, y));
      if (tile?.state === 'ready') {
        show.add(tile);
        continue;
      }
      if (!tile) requestTile(z, x, y);
      for (let pz = z - 1, px = x >> 1, py = y >> 1; pz >= minZoom; pz--, px >>= 1, py >>= 1) {
        const parent = tiles.get(key(pz, px, py));
        if (parent?.state === 'ready') {
          show.add(parent);
          break;
        }
      }
    }

    for (const tile of tiles.values()) {
      if (!tile.mesh) continue;
      tile.mesh.visible = show.has(tile);
      if (tile.mesh.visible) tile.lastUsed = frame;
    }

    // 3. Caché: si hay demasiadas, se liberan las que llevan más tiempo sin usarse
    if (tiles.size > maxCached) {
      const idle = [...tiles.entries()]
        .filter(([, t]) => t.state !== 'loading' && !show.has(t))
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [k, t] of idle.slice(0, tiles.size - maxCached)) disposeTile(k, t);
    }
  }

  // true cuando no hay descargas pendientes (tras al menos un par de frames): sirve para
  // quitar la pantalla de carga cuando las primeras teselas ya están puestas
  const isIdle = () => frame > 2 && inFlight === 0;

  return { group, update, isIdle };
}
