// Genera los datos de países que usa la app a partir del GeoJSON de Natural Earth:
//
//   public/data/countries.json       nombres, códigos, tipo, bandera y polígonos (lo que carga el globo)
//   public/data/countries-list.json  lo mismo sin polígonos (lista ligera, la usa paises.html)
//   public/flags/<iso>.svg           bandera de cada país (del paquete flag-icons, licencia MIT)
//
// Uso: node scripts/prepare-countries.mjs <países.geojson> [lugares.geojson]
// Fuentes (dominio público): https://github.com/nvkelso/natural-earth-vector
//   ne_50m_admin_0_countries.geojson  → países
//   ne_50m_populated_places.geojson   → capitales (opcional; para el minijuego de capitales)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [input, placesInput] = process.argv.slice(2);
if (!input) {
  console.error('Uso: node scripts/prepare-countries.mjs <países.geojson> [lugares.geojson]');
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

// Las banderas que ya existen no se sobrescriben (así una versión nueva de flag-icons no cambia
// banderas sin querer); solo se añaden las que falten
mkdirSync(flagsDir, { recursive: true });

// --- Nombres alternativos de cada país (para los minijuegos de escribir) ---------------
// Además de los nombres en inglés, español y portugués, se aceptan los nombres largos/oficiales
// de Natural Earth y estas variantes habituales (ISO3 → nombres)
const EXTRA_ALIASES = {
  SWZ: ['Swaziland', 'Suazilandia', 'Essuatíni', 'eSwatini'],
  CZE: ['Czech Republic', 'Republica Checa', 'República Checa', 'Chequia', 'Tchequia', 'Tchéquia'],
  CIV: ["Côte d'Ivoire", 'Ivory Coast', 'Costa de Marfil', 'Costa do Marfim'],
  MMR: ['Burma', 'Birmania', 'Birmânia'],
  TLS: ['East Timor', 'Timor Oriental', 'Timor-Leste', 'Timor Leste'],
  MKD: ['Macedonia', 'Macedonia del Norte', 'Macedônia do Norte', 'FYROM'],
  COD: ['DR Congo', 'DRC', 'Congo-Kinshasa', 'Democratic Republic of Congo', 'RD Congo', 'RDC', 'Zaire'],
  COG: ['Congo', 'Congo-Brazzaville', 'Republic of Congo', 'Republica del Congo'],
  CPV: ['Cape Verde', 'Cabo Verde'],
  VAT: ['Vatican', 'Holy See', 'Santa Sede', 'Vaticano'],
  USA: ['USA', 'US', 'United States', 'America', 'EEUU', 'EE UU', 'Estados Unidos', 'EUA'],
  GBR: ['UK', 'United Kingdom', 'Great Britain', 'Britain', 'Reino Unido', 'Gran Bretaña', 'Grã-Bretanha'],
  ARE: ['UAE', 'Emirates', 'EAU', 'Emiratos Arabes', 'Emirados Arabes'],
  KOR: ['South Korea', 'Korea', 'Corea', 'Coreia', 'Republic of Korea'],
  PRK: ['North Korea', 'DPRK', 'Corea del Norte', 'Coreia do Norte'],
  RUS: ['Russian Federation', 'Federacion Rusa'],
  NLD: ['Holland', 'Holanda', 'The Netherlands', 'Netherlands'],
  TUR: ['Turkey', 'Türkiye', 'Turkiye', 'Turquía', 'Turquia'],
  BIH: ['Bosnia', 'Bosnia-Herzegovina'],
  DOM: ['Dominican Rep', 'Rep Dominicana'],
  CAF: ['CAR', 'Central African Rep'],
  BLR: ['Belorussia', 'Bielorrusia', 'Bielorrússia'],
  KGZ: ['Kirghizia', 'Kirguistán', 'Quirguistão'],
  LAO: ['Laos', 'Lao PDR'],
  FSM: ['Micronesia'],
  STP: ['Sao Tome', 'Santo Tome'],
  VCT: ['St Vincent', 'Saint Vincent'],
  KNA: ['St Kitts', 'Saint Kitts', 'St Kitts and Nevis'],
  LCA: ['St Lucia'],
  PSE: ['Palestinian Territories', 'State of Palestine'],
  TWN: ['Taiwan', 'Republic of China', 'Formosa'],
};

// --- Capitales -----------------------------------------------------------------------
// Se toman de Natural Earth (lugares con FEATURECLA "Admin-0 capital"). Sus "capitales
// alternativas" mezclan capitales reales con ciudades que no lo son (Johannesburgo, Lagos,
// Kioto, Tel Aviv…), así que solo se aceptan para los países con varias capitales oficiales:
const ALT_CAPITALS_OK = new Set(['BOL', 'ZAF', 'NLD', 'MYS', 'LKA', 'SWZ', 'BEN', 'CIV', 'TZA']);
// Países y territorios sin capital en Natural Earth (nombre en inglés, español, portugués y variantes)
const EXTRA_CAPITALS = {
  SSD: ['Juba', 'Yuba'],
  NRU: ['Yaren'],
  PRI: ['San Juan'],
  GRL: ['Nuuk', 'Godthab'],
  FRO: ['Tórshavn', 'Torshavn'],
  ABW: ['Oranjestad'],
  CUW: ['Willemstad'],
  SXM: ['Philipsburg'],
  MAF: ['Marigot'],
  BLM: ['Gustavia'],
  GUM: ['Hagåtña', 'Hagatna', 'Agana'],
  MNP: ['Saipan'],
  VIR: ['Charlotte Amalie'],
  ASM: ['Pago Pago'],
  VGB: ['Road Town'],
  TCA: ['Cockburn Town'],
  AIA: ['The Valley', 'El Valle'],
  CYM: ['George Town'],
  MSR: ['Brades', 'Plymouth'],
  SHN: ['Jamestown'],
  PCN: ['Adamstown'],
  FLK: ['Stanley', 'Puerto Argentino'],
  NIU: ['Alofi'],
  COK: ['Avarua'],
  SPM: ['Saint-Pierre', 'San Pedro'],
  WLF: ['Mata-Utu', 'Mata Utu'],
  PYF: ['Papeete'],
  NCL: ['Nouméa', 'Noumea'],
  NFK: ['Kingston'],
  JEY: ['Saint Helier', 'St Helier'],
  GGY: ['Saint Peter Port', 'St Peter Port'],
  IMN: ['Douglas'],
  ALA: ['Mariehamn'],
  BMU: ['Hamilton'],
  CYN: ['North Nicosia', 'Nicosia del Norte', 'Lefkoşa', 'Lefkosa'],
};

// Natural Earth a veces marca como capital principal la sede de gobierno o la ciudad más grande;
// aquí se fija la capital que se muestra (y se acepta igualmente la otra)
const DISPLAY_CAPITAL = {
  ZAF: { en: 'Pretoria', es: 'Pretoria', pt: 'Pretória' },
  TZA: { en: 'Dodoma', es: 'Dodoma', pt: 'Dodoma' },
  BEN: { en: 'Porto-Novo', es: 'Porto Novo', pt: 'Porto-Novo' },
  LKA: { en: 'Sri Jayawardenepura Kotte', es: 'Sri Jayawardenepura Kotte', pt: 'Sri Jayawardenepura Kotte' },
};
// Ciudades que Natural Earth marca como "capital alternativa" pero no lo son
const NOT_CAPITALS = new Set(['Johannesburg', 'Johannesburgo', 'Joanesburgo']);

function loadCapitals(path) {
  if (!path) return new Map();
  const places = JSON.parse(readFileSync(path, 'utf8')).features.map((f) => f.properties);
  const byCountry = new Map();
  for (const p of places) {
    const primary = p.FEATURECLA === 'Admin-0 capital';
    const alt = p.FEATURECLA === 'Admin-0 capital alt' && ALT_CAPITALS_OK.has(p.ADM0_A3);
    if (!primary && !alt) continue;
    const names = [p.NAME_EN, p.NAME_ES, p.NAME_PT, p.NAME, p.NAMEASCII, ...(p.NAMEALT ?? '').split('|')]
      .map((n) => n?.trim())
      .filter(Boolean);
    const entry = byCountry.get(p.ADM0_A3) ?? { display: null, names: [] };
    if (primary && !entry.display) entry.display = { en: p.NAME_EN ?? p.NAME, es: p.NAME_ES ?? p.NAME, pt: p.NAME_PT ?? p.NAME };
    entry.names.push(...names.filter((n) => !NOT_CAPITALS.has(n)));
    byCountry.set(p.ADM0_A3, entry);
  }
  for (const [code, display] of Object.entries(DISPLAY_CAPITAL)) {
    const entry = byCountry.get(code);
    if (entry) entry.display = display;
  }
  for (const [code, names] of Object.entries(EXTRA_CAPITALS)) {
    if (!byCountry.has(code)) byCountry.set(code, { display: { en: names[0], es: names[0], pt: names[0] }, names });
  }
  return byCountry;
}
const capitals = loadCapitals(placesInput);
const unique = (list) => [...new Set(list.filter(Boolean).map((n) => n.trim()))];
mkdirSync(dataDir, { recursive: true });

const countries = source.features
  .map(({ properties: p, geometry: g }) => {
    const iso = isoCode(p);
    const flagFile = iso && join(flagSource, `${iso.toLowerCase()}.svg`);
    let flag = null;
    if (flagFile && existsSync(flagFile)) {
      flag = `/flags/${iso.toLowerCase()}.svg`;
      const target = join(root, 'public', flag);
      if (!existsSync(target)) copyFileSync(flagFile, target);
    }
    const iso3 = p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3;
    const capital = capitals.get(p.ADM0_A3) ?? capitals.get(iso3) ?? null;
    // Siempre como MultiPolygon: lista de polígonos, cada uno lista de anillos (exterior + huecos)
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return {
      name_es: p.NAME_ES || p.NAME,
      name_en: p.NAME_EN || p.NAME,
      name_pt: p.NAME_PT || p.NAME,
      iso,
      iso3,
      // Otros nombres aceptados en los minijuegos (largos, oficiales, abreviaturas y variantes)
      aliases: unique([p.NAME, p.NAME_LONG, p.FORMAL_EN, p.NAME_ALT, p.BRK_NAME, p.NAME_SORT, p.ADMIN, ...(EXTRA_ALIASES[iso3] ?? [])]),
      // Capital: nombre a mostrar en cada idioma y todos los nombres aceptados (null si no tiene)
      capital: capital?.display ? { ...capital.display, names: unique(capital.names) } : null,
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
console.log(`  con capital: ${count((c) => c.capital)}`);
console.log(`  sin capital: ${countries.filter((c) => !c.capital).map((c) => c.name_es).join(', ')}`);
