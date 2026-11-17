// Lista de países: lee public/data/countries-list.json (generado por scripts/prepare-countries.mjs).
// Usa el mismo idioma que el juego (el elegido en Configuración; inglés por defecto).
import { loadSettings } from './settings.js';
import { t, setLanguage } from './i18n.js';

setLanguage(loadSettings().language);

const summaryEl = document.getElementById('summary');
const rowsEl = document.getElementById('rows');
const searchEl = document.getElementById('search');

const countries = await (await fetch('/data/countries-list.json')).json();

const count = (type) => countries.filter((c) => c.type === type).length;
summaryEl.textContent = t('list.summary', {
  total: countries.length,
  states: count('estado'),
  territories: count('territorio'),
  undetermined: count('indeterminado'),
});

const typeLabel = (type) => t(`listType.${type}`);
const continentLabel = (continent) => t(`continent.${continent}`);

// Texto en el que busca el buscador (sin tildes ni mayúsculas)
const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const rows = countries.map((c) => {
  const tr = document.createElement('tr');
  const cell = (text) => {
    const td = document.createElement('td');
    td.textContent = text ?? '—';
    tr.append(td);
    return td;
  };

  const flagCell = cell('');
  if (c.flag) {
    const img = document.createElement('img');
    img.src = c.flag;
    img.alt = t('list.flagOf', { name: c.name_en });
    img.loading = 'lazy';
    flagCell.append(img);
  } else {
    flagCell.textContent = '—';
  }
  cell(c.name_es);
  cell(c.name_en);
  cell(c.name_pt);
  cell(c.iso);
  const typeCell = cell(typeLabel(c.type));
  if (c.type !== 'estado') typeCell.title = t('list.sovereign', { sovereign: c.sovereign });
  cell(continentLabel(c.continent));

  rowsEl.append(tr);
  // Se puede buscar en los tres idiomas, por código, continente (en el idioma actual y en inglés) o tipo
  const text = [c.name_es, c.name_en, c.name_pt, c.iso, c.iso3, c.continent, continentLabel(c.continent), typeLabel(c.type)];
  return { tr, text: normalize(text.join(' ')) };
});

searchEl.addEventListener('input', () => {
  const query = normalize(searchEl.value.trim());
  for (const { tr, text } of rows) tr.hidden = query !== '' && !text.includes(query);
});
