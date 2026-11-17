// Lista de países: lee public/data/countries-list.json (generado por scripts/prepare-countries.mjs)
const TYPE_LABELS = {
  estado: 'Estado',
  territorio: 'Territorio dependiente',
  indeterminado: 'Estatus indeterminado',
};

const summaryEl = document.getElementById('summary');
const rowsEl = document.getElementById('rows');
const searchEl = document.getElementById('search');

const countries = await (await fetch('/data/countries-list.json')).json();

const count = (type) => countries.filter((c) => c.type === type).length;
summaryEl.textContent =
  `${countries.length} en total: ${count('estado')} estados, ${count('territorio')} territorios dependientes ` +
  `y ${count('indeterminado')} de estatus indeterminado.`;

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
    img.alt = `Bandera de ${c.name_es}`;
    img.loading = 'lazy';
    flagCell.append(img);
  } else {
    flagCell.textContent = '—';
  }
  cell(c.name_es);
  cell(c.name_en);
  cell(c.name_pt);
  cell(c.iso);
  const typeCell = cell(TYPE_LABELS[c.type]);
  if (c.type !== 'estado') typeCell.title = `Soberanía: ${c.sovereign}`;
  cell(c.continent);

  rowsEl.append(tr);
  return { tr, text: normalize([c.name_es, c.name_en, c.name_pt, c.iso, c.iso3, c.continent, TYPE_LABELS[c.type]].join(' ')) };
});

searchEl.addEventListener('input', () => {
  const query = normalize(searchEl.value.trim());
  for (const { tr, text } of rows) tr.hidden = query !== '' && !text.includes(query);
});
