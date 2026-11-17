// Genera los datos de países que usa la app a partir del GeoJSON de Natural Earth:
//
//   public/data/countries.json       nombres, códigos, tipo, bandera y polígonos (lo que carga el globo)
//   public/data/countries-list.json  lo mismo sin polígonos (lista ligera, la usa paises.html)
//   public/flags/<iso>.svg           bandera de cada país (del paquete flag-icons, licencia MIT)
//
// Uso: node scripts/prepare-countries.mjs <entrada.geojson>
// Fuente: https://github.com/nvkelso/natural-earth-vector (ne_50m_admin_0_countries.geojson, dominio público)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [input] = process.argv.slice(2);
if (!input) {
  console.error('Uso: node scripts/prepare-countries.mjs <entrada.geojson>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public/data');
const flagsDir = join(root, 'public/flags');
const flagSource = join(dirname(createRequire(import.meta.url).resolve('flag-icons/package.json')), 'flags/4x3');

const round = (n) => Math.round(n * 1000) / 1000; // ~100 m de precisión (los microestados no se deforman)
const roundRing = (ring) => ring.map(([lon, lat]) => [round(lon), round(lat)]);

// Clasificación propia, más clara que el campo TYPE de Natural Earth (que, por ejemplo,
// pone a Estados Unidos como "Country" y a Israel o Kosovo como "Disputed"):
//  - estado: se gobierna a sí mismo (ADMIN = SOVEREIGNT)
//  - territorio: depende de otro estado (Puerto Rico, Groenlandia, Hong Kong…)
//  - indeterminado: estatus internacional sin resolver (Antártida, Sahara Occidental…)
function classify(p) {
  if (p.TYPE === 'Indeterminate') return 'indeterminado';
  return p.ADMIN === p.SOVEREIGNT ? 'estado' : 'territorio';
}

// Código ISO 3166-1 alfa-2; Natural Earth usa -99 cuando no hay uno oficial
function isoCode(p) {
  if (p.ISO_A2 === 'CN-TW') return 'TW';
  if (p.ISO_A2 !== '-99') return p.ISO_A2;
  if (p.ISO_A2_EH !== '-99') return p.ISO_A2_EH;
  return null;
}

const source = JSON.parse(readFileSync(input, 'utf8'));

rmSync(flagsDir, { recursive: true, force: true });
mkdirSync(flagsDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

const countries = source.features
  .map(({ properties: p, geometry: g }) => {
    const iso = isoCode(p);
    const flagFile = iso && join(flagSource, `${iso.toLowerCase()}.svg`);
    let flag = null;
    if (flagFile && existsSync(flagFile)) {
      flag = `/flags/${iso.toLowerCase()}.svg`;
      copyFileSync(flagFile, join(root, 'public', flag));
    }
    // Siempre como MultiPolygon: lista de polígonos, cada uno lista de anillos (exterior + huecos)
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return {
      name_es: p.NAME_ES || p.NAME,
      name_en: p.NAME_EN || p.NAME,
      name_pt: p.NAME_PT || p.NAME,
      iso,
      iso3: p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3,
      type: classify(p),
      sovereign: p.SOVEREIGNT,
      continent: p.CONTINENT,
      flag,
      polygons: polygons.map((poly) => poly.map(roundRing)),
    };
  })
  .sort((a, b) => a.name_es.localeCompare(b.name_es, 'es'));

writeFileSync(join(dataDir, 'countries.json'), JSON.stringify(countries));
writeFileSync(
  join(dataDir, 'countries-list.json'),
  JSON.stringify(countries.map(({ polygons, ...rest }) => rest), null, 2)
);

// Países del modo Diario (solo estados), para el servidor de Convex: el servidor elige los
// 10 países de cada día de esta lista, así son los mismos para todos los jugadores
const dailyCodes = countries.filter((c) => c.type === 'estado').map((c) => c.iso3);
if (new Set(dailyCodes).size !== dailyCodes.length) throw new Error('Hay códigos ISO3 repetidos entre los estados');
writeFileSync(
  join(root, 'convex/dailyCountries.ts'),
  `// Generado por scripts/prepare-countries.mjs: códigos ISO 3166-1 alfa-3 de los ${dailyCodes.length} estados.\n` +
    `// El modo Diario elige de aquí los 10 países de cada día.\n` +
    `export const DAILY_COUNTRIES: readonly string[] = ${JSON.stringify(dailyCodes)};\n`
);

const count = (fn) => countries.filter(fn).length;
console.log(`${countries.length} países y territorios`);
console.log(`  estados: ${count((c) => c.type === 'estado')}`);
console.log(`  territorios dependientes: ${count((c) => c.type === 'territorio')}`);
console.log(`  estatus indeterminado: ${count((c) => c.type === 'indeterminado')}`);
console.log(`  con bandera: ${count((c) => c.flag)}`);
console.log(`  sin bandera: ${countries.filter((c) => !c.flag).map((c) => c.name_es).join(', ')}`);
