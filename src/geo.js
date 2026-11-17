import * as THREE from 'three';

// --- Conversión lon/lat ↔ 3D -------------------------------------------------
// Coincide con las UV de SphereGeometry y con las texturas equirectangulares:
// longitud 0° en +X, 90°E en -Z, latitud 90° (polo norte) en +Y.
export function lonLatToVector3(lon, lat, radius, target = new THREE.Vector3()) {
  const lambda = THREE.MathUtils.degToRad(lon);
  const phi = THREE.MathUtils.degToRad(lat);
  return target.set(
    radius * Math.cos(phi) * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(lambda)
  );
}

export function vector3ToLonLat(v) {
  const n = v.clone().normalize();
  return {
    lon: THREE.MathUtils.radToDeg(Math.atan2(-n.z, n.x)),
    lat: THREE.MathUtils.radToDeg(Math.asin(n.y)),
  };
}

// Latitud (grados) de una fila de teselas Web Mercator: t = 0 borde norte del mundo, 1 borde sur
export function mercatorToLat(t) {
  return THREE.MathUtils.radToDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * t))));
}

// --- Parche de esfera ---------------------------------------------------------
// Rectángulo de la esfera entre lon0 y lon1. `latAt(s)` da la latitud para s ∈ [0, 1]
// (0 = borde norte, 1 = borde sur), lo que permite parches equirectangulares (lineal)
// o Web Mercator. La UV recorre la textura entera: (0,1) arriba a la izquierda.
// `vAt(s)` permite cambiar la coordenada v de cada fila (por defecto 1 - s).
export function createSpherePatch({ lon0, lon1, latAt, radius, segmentsX, segmentsY, vAt = (s) => 1 - s }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const p = new THREE.Vector3();

  for (let j = 0; j <= segmentsY; j++) {
    const s = j / segmentsY;
    const lat = latAt(s);
    for (let i = 0; i <= segmentsX; i++) {
      const u = i / segmentsX;
      lonLatToVector3(lon0 + (lon1 - lon0) * u, lat, radius, p);
      positions.push(p.x, p.y, p.z);
      p.normalize();
      normals.push(p.x, p.y, p.z);
      uvs.push(u, vAt(s));
    }
  }

  // Triángulos con orden antihorario vistos desde fuera (cara frontal hacia el exterior)
  const row = segmentsX + 1;
  for (let j = 0; j < segmentsY; j++) {
    for (let i = 0; i < segmentsX; i++) {
      const a = j * row + i; // arriba-izquierda
      const b = a + 1; // arriba-derecha
      const c = a + row; // abajo-izquierda
      const d = c + 1; // abajo-derecha
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
