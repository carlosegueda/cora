// Minijuegos de escribir: adivinar la bandera (se ve una bandera y se escribe el país) y
// adivinar la capital (se ve la bandera y el país y se escribe su capital).
//
//  - Cada minijuego tiene dos modos:
//      · Casual: se eligen continentes, tipos de país y cuántos (se recuerda). Sin clasificación.
//      · Ranked: reglas fijas (todos los continentes, solo estados, todos los países) y el
//        tiempo en completarlos todos entra en la clasificación online.
//  - Cuenta atrás 3, 2, 1 y un cronómetro que cuenta hasta acertarlos todos.
//  - "Rendirse" (en los dos modos) para el cronómetro y enseña todos los países con su
//    respuesta. Una partida ranked abandonada no entra en la clasificación.
//  - "Saltar" (o Tab) manda el país al final de la cola: volverá a salir.
//  - Adivina el país: se ilumina un país en verde en el globo (la cámara viaja hasta él) y se
//    escribe su nombre. La tarjeta pasa a ser una barra abajo y el globo se puede mover.
//  - Las respuestas toleran idioma (inglés, español, portugués), tildes, mayúsculas, guiones,
//    nombres alternativos (Eswatini/Suazilandia, Czechia/República Checa…) y erratas pequeñas.
import { t, getLanguage } from './i18n.js';
import { saveSettings } from './settings.js';
import { countryCenter, countrySizeKm } from './countries.js';
import { lonLatToVector3 } from './geo.js';
import {
  leaderboardAvailable,
  submitMinigame,
  getPlayerName,
  setPlayerName,
} from './leaderboard.js';

const EARTH_RADIUS_KM = 6371;
// En el minijuego del mapa, los países más pequeños que esto llevan además un pin encima
// (si no, a la distancia mínima de zoom serían apenas unos píxeles verdes)
const PIN_BELOW_KM = 250;

const ROUND_OPTIONS = [10, 20, 50, 'all'];
const DEFAULT_MINIGAMES = {
  continents: ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Seven seas (open ocean)'],
  types: ['estado'],
  rounds: 20,
  mode: 'casual', // 'casual' | 'ranked'
};
// Reglas fijas del modo ranked: todos los continentes, solo estados, todos los países
const RANKED = { continents: DEFAULT_MINIGAMES.continents, types: ['estado'], rounds: 'all' };
const MODES = { casual: 'mini.casual', ranked: 'mini.ranked' };
const GIVE_UP_CONFIRM_MS = 3000; // tras el primer clic en "Rendirse", tiempo para confirmarlo

// --- Comparación tolerante de respuestas ------------------------------------------------
// Clave de comparación: sin tildes ni mayúsculas, sin artículos iniciales, "St." = "Saint",
// y sin espacios ni signos (así "Guinea Bissau" = "Guinea-Bissau").
const ARTICLES = /^(the|el|la|los|las|le|les|o|os|as) /;
export function answerKey(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(ARTICLES, '')
    .replace(/\bste\b/g, 'sainte')
    .replace(/\bst\b/g, 'saint')
    .replace(/ /g, '');
}

// Erratas permitidas según lo largo que sea el nombre
const tolerance = (key) => (key.length <= 4 ? 0 : key.length <= 8 ? 1 : 2);

// Distancia de edición (letras cambiadas, de más, de menos o dos seguidas intercambiadas)
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], before[j - 2] + 1);
      }
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1; // ya no puede bajar
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

// ¿`input` es una respuesta válida? `accepted`: claves del país/capital correcto;
// `others`: claves de todos los demás (para no aceptar "Mali" cuando era Malta).
// exact = true solo acepta coincidencias exactas (se usa mientras se escribe).
export function matches(input, accepted, others, exact = false) {
  const q = answerKey(input);
  if (q.length < 2) return false;
  if (accepted.includes(q)) return true;
  if (exact || others.has(q)) return false;
  let best = Infinity;
  for (const key of accepted) {
    const d = distance(q, key, tolerance(key));
    if (d <= tolerance(key)) best = Math.min(best, d);
  }
  if (best === Infinity) return false;
  // Si se parece aún más a otro nombre, no se da por buena
  for (const key of others) if (distance(q, key, best - 1) < best) return false;
  return true;
}

const unique = (list) => [...new Set(list.filter(Boolean))];
export const countryNames = (c) => unique([c.name_en, c.name_es, c.name_pt, ...(c.aliases ?? [])]);
export const capitalNames = (c) => unique([c.capital.en, c.capital.es, c.capital.pt, ...c.capital.names]);

const GAMES = {
  flags: {
    title: 'mini.flags',
    placeholder: 'mini.countryPh',
    valid: (c) => Boolean(c.flag),
    names: countryNames,
    shown: (c) => c[`name_${getLanguage()}`] ?? c.name_en,
    showCountry: false,
  },
  map: {
    title: 'mini.map',
    placeholder: 'mini.countryPh',
    valid: (c) => Boolean(c.polygons?.length),
    names: countryNames,
    shown: (c) => c[`name_${getLanguage()}`] ?? c.name_en,
    showCountry: false,
    globe: true,
  },
  capitals: {
    title: 'mini.capitals',
    placeholder: 'mini.capitalPh',
    valid: (c) => Boolean(c.flag && c.capital),
    names: capitalNames,
    shown: (c) => c.capital[getLanguage()] ?? c.capital.en,
    showCountry: true,
  },
};

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createMinigames({ settings, sound, showScreen, openBoard, globe, continents, types }) {
  const countriesReady = globe.countriesReady;
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  settings.minigames = { ...DEFAULT_MINIGAMES, ...settings.minigames };
  const prefs = settings.minigames;

  const form = $('minigame-form');
  const summary = $('minigame-summary');
  const startButton = $('minigame-start');
  const flagImg = $('mg-flag');
  const countryText = $('mg-country');
  const input = $('mg-input');
  const progress = $('mg-progress');
  const clock = $('mg-clock');
  const last = $('mg-last');
  const countdown = $('countdown');
  const card = document.querySelector('.mg-card');
  const pauseOverlay = $('mg-pause');
  const playScreen = $('screen-minigame-play');
  const modeTabs = $('minigame-mode');
  const rankedPanel = $('minigame-ranked');
  const nameInput = $('minigame-name');
  const giveUpButton = $('mg-giveup');
  const review = $('mg-review');
  const isRanked = () => prefs.mode === 'ranked';
  // Reglas en uso: las fijas en ranked, las elegidas en casual
  const rulesNow = () => (isRanked() ? RANKED : prefs);
  const usesGlobe = () => Boolean(GAMES[game]?.globe);

  // Minijuego del mapa: marca el país en verde y lleva la cámara hasta él
  function showOnGlobe(c) {
    const { lon, lat } = countryCenter(c);
    const size = countrySizeKm(c);
    globe.setHighlights({ correct: c });
    globe.flyTo(lon, lat, 1.2, (Math.max(size, 400) / EARTH_RADIUS_KM) * 3);
    if (size < PIN_BELOW_KM) {
      globe.placePin(lonLatToVector3(lon, lat, 1));
      globe.setPinLabel({ text: '?', kind: 'correct' });
    } else {
      globe.removePin();
    }
  }
  function clearGlobe() {
    globe.setHighlights();
    globe.removePin();
  }

  let countries = null;
  let game = null; // clave de GAMES
  let run = null; // { queue, all, ranked, total, skips, start, pausedAt, pausedMs, timeouts, raf, accepted, allKeys }
  let reviewOnGlobe = false; // hay un país del repaso resaltado en el globo
  let resultToken = 0; // para ignorar la respuesta del servidor si ya se empezó otra partida

  const pool = (g = game, p = rulesNow()) =>
    (countries ?? []).filter(
      (c) => GAMES[g].valid(c) && p.continents.includes(c.continent) && p.types.includes(c.type)
    );

  // --- Pantalla de configuración ---
  // Pestañas Casual / Ranked
  function buildModes() {
    modeTabs.replaceChildren();
    for (const [value, label] of Object.entries(MODES)) {
      const option = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'minigame-mode';
      radio.checked = prefs.mode === value;
      radio.addEventListener('change', () => {
        prefs.mode = value;
        sound.play('click');
        save();
      });
      option.append(radio, t(label));
      modeTabs.append(option);
    }
  }

  function buildForm() {
    buildModes();
    form.replaceChildren();
    const field = (label) => {
      const node = el('div', 'field');
      node.append(el('span', 'field-label', label));
      form.append(node);
      return node;
    };
    const checkList = (parent, key, options) => {
      const wrap = el('div', 'check-list');
      const inputs = [];
      for (const value of Object.keys(options)) {
        const row = el('label', 'check');
        const box = el('input');
        box.type = 'checkbox';
        box.value = value;
        box.checked = prefs[key].includes(value);
        box.addEventListener('change', () => {
          prefs[key] = inputs.filter((i) => i.checked).map((i) => i.value);
          sound.play('click');
          save();
        });
        const count = el('small');
        count.dataset.countFor = `${key}:${value}`;
        row.append(box, el('span', null, options[value]), count);
        wrap.append(row);
        inputs.push(box);
      }
      parent.append(wrap);
      return inputs;
    };

    // Continentes (sin la Antártida, que no tiene banderas ni capitales propias)
    const continentKeys = Object.keys(continents).filter((k) => k !== 'Antarctica');
    const continentField = field(t('practice.continents'));
    const continentInputs = checkList(
      continentField,
      'continents',
      Object.fromEntries(continentKeys.map((k) => [k, t(`continent.${k}`)]))
    );
    const quick = el('div', 'quick-select');
    for (const [label, all] of [
      [t('practice.all'), true],
      [t('practice.none'), false],
    ]) {
      const button = el('button', 'link-button', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        continentInputs.forEach((i) => (i.checked = all));
        prefs.continents = all ? continentKeys : [];
        sound.play('click');
        save();
      });
      quick.append(button);
    }
    continentField.append(quick);

    checkList(
      field(t('practice.types')),
      'types',
      Object.fromEntries(Object.keys(types).map((k) => [k, t(`type.${k}`)]))
    );

    const roundsWrap = el('div', 'tabs');
    for (const value of ROUND_OPTIONS) {
      const option = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'minigame-rounds';
      radio.checked = prefs.rounds === value;
      radio.addEventListener('change', () => {
        prefs.rounds = value;
        sound.play('click');
        save();
      });
      option.append(radio, value === 'all' ? t('practice.roundsAll') : String(value));
      roundsWrap.append(option);
    }
    field(t('practice.rounds')).append(roundsWrap);
    refresh();
  }

  function save() {
    saveSettings(settings);
    refresh();
  }

  const roundsFor = (available) => {
    const { rounds } = rulesNow();
    return rounds === 'all' ? available : Math.min(rounds, available);
  };
  // En ranked hace falta un nombre para la clasificación (si la hay)
  const validName = () => nameInput.value.trim().length >= 2;

  function refresh() {
    if (!game) return;
    form.hidden = isRanked();
    rankedPanel.hidden = !isRanked();
    if (!countries) return;
    for (const node of form.querySelectorAll('[data-count-for]')) {
      const [key, value] = node.dataset.countFor.split(':');
      node.textContent = pool(game, { ...prefs, [key]: [value] }).length;
    }
    const available = pool().length;
    if (isRanked()) {
      $('minigame-ranked-rules').textContent = t('mini.rankedRules', { total: available });
      $('minigame-name-field').hidden = !leaderboardAvailable;
      const needName = leaderboardAvailable && !validName();
      summary.textContent = leaderboardAvailable ? '' : t('board.unavailable');
      summary.classList.toggle('is-problem', !leaderboardAvailable);
      startButton.disabled = needName || !available;
      startButton.textContent = t('practice.startCount', { rounds: available });
      return;
    }
    let problem = null;
    if (!prefs.continents.length) problem = t('practice.needContinent');
    else if (!prefs.types.length) problem = t('practice.needType');
    else if (!available) problem = t('practice.noCountries');
    const rounds = roundsFor(available);
    summary.textContent = problem ?? t('practice.summary', { available, rounds });
    summary.classList.toggle('is-problem', Boolean(problem));
    startButton.disabled = Boolean(problem);
    startButton.textContent = problem ? t('practice.start') : t('practice.startCount', { rounds });
  }

  function openSetup(key) {
    game = key;
    $('minigame-setup-title').textContent = t(GAMES[key].title);
    nameInput.value = getPlayerName();
    buildForm();
    showScreen('minigameSetup');
  }

  // --- Partida ---
  function start() {
    stop();
    const g = GAMES[game];
    const ranked = isRanked();
    if (ranked && leaderboardAvailable && validName()) setPlayerName(nameInput.value);
    resultToken++;
    const list = pool();
    const queue = shuffle(list).slice(0, roundsFor(list.length));
    // Claves aceptadas de cada país, y las de todos los demás (para descartar confusiones)
    const accepted = new Map(list.map((c) => [c, unique(g.names(c).map(answerKey))]));
    const allKeys = new Map((countries ?? []).filter(g.valid).map((c) => [c, g.names(c).map(answerKey)]));
    run = { queue, all: [...queue], ranked, total: queue.length, skips: 0, start: 0, pausedAt: null, pausedMs: 0, timeouts: [], raf: 0, accepted, allKeys };

    playScreen.classList.toggle('is-map', usesGlobe());
    showScreen('minigamePlay');
    if (usesGlobe()) {
      globe.setAutoRotate(false);
      globe.setBordersVisible(true);
      clearGlobe();
    }
    input.placeholder = t(g.placeholder);
    input.value = '';
    input.disabled = true;
    input.className = 'text-input text-input-big mg-input';
    last.textContent = '';
    disarmGiveUp();
    giveUpButton.disabled = true; // hasta que acabe la cuenta atrás
    clock.textContent = formatTime(0);
    flagImg.hidden = true;
    countryText.textContent = '';
    progress.textContent = `0 / ${run.total}`;

    // Cuenta atrás 3, 2, 1
    countdown.hidden = false;
    const show = (text, soundName) => {
      countdown.textContent = text;
      countdown.classList.toggle('is-go', soundName === 'go');
      countdown.classList.remove('pop');
      void countdown.offsetWidth;
      countdown.classList.add('pop');
      sound.play(soundName);
    };
    const later = (fn, ms) => run.timeouts.push(setTimeout(fn, ms));
    for (let i = 0; i < 3; i++) later(() => show(String(3 - i), 'tick'), i * 1000);
    later(() => {
      show(t('countdown.go'), 'go');
      run.start = performance.now();
      input.disabled = false;
      giveUpButton.disabled = false;
      input.focus();
      showCurrent();
      tick();
    }, 3000);
    later(() => (countdown.hidden = true), 3700);
  }

  const elapsed = () => {
    if (!run?.start) return 0;
    const now = run.pausedAt ?? performance.now();
    return now - run.start - run.pausedMs;
  };

  function tick() {
    clock.textContent = formatTime(elapsed());
    run.raf = requestAnimationFrame(tick);
  }

  function showCurrent() {
    const c = run.queue[0];
    progress.textContent = `${run.total - run.queue.length} / ${run.total}`;
    if (usesGlobe()) return showOnGlobe(c);
    flagImg.hidden = false;
    flagImg.src = c.flag;
    flagImg.alt = t('hud.flagAlt');
    countryText.textContent = GAMES[game].showCountry ? (c[`name_${getLanguage()}`] ?? c.name_en) : '';
    progress.textContent = `${run.total - run.queue.length} / ${run.total}`;
  }

  // Claves de todos los demás países (para no aceptar el nombre de otro)
  function othersOf(c) {
    const own = new Set(run.accepted.get(c));
    const others = new Set();
    for (const [country, keys] of run.allKeys) {
      if (country === c) continue;
      for (const key of keys) if (!own.has(key)) others.add(key);
    }
    return others;
  }

  function check(exact) {
    if (!run?.start || !run.queue.length) return false;
    const c = run.queue[0];
    run.others ??= new Map();
    if (!run.others.has(c)) run.others.set(c, othersOf(c));
    if (!matches(input.value, run.accepted.get(c), run.others.get(c), exact)) return false;
    correct(c);
    return true;
  }

  function correct(c) {
    sound.play('correct');
    run.queue.shift();
    last.textContent = `✓ ${GAMES[game].shown(c)}`;
    input.value = '';
    input.classList.remove('is-wrong');
    input.classList.add('is-correct');
    setTimeout(() => input.classList.remove('is-correct'), 250);
    if (run.queue.length) showCurrent();
    else finish();
  }

  function skip() {
    if (!run?.start || run.queue.length < 1) return;
    sound.play('click');
    run.skips++;
    run.queue.push(run.queue.shift()); // vuelve a salir al final
    input.value = '';
    input.focus();
    showCurrent();
  }

  // Fin de la partida: completada, o abandonada con "Rendirse" (gaveUp). En los dos casos se
  // para el cronómetro y se enseñan todos los países con su respuesta.
  function finish(gaveUp = false) {
    const time = elapsed();
    const done = run;
    const key = game;
    const missed = [...done.queue];
    cancelAnimationFrame(done.raf);
    sound.play(gaveUp ? 'timeout' : 'finish');
    $('mg-results-title').textContent = `${t(GAMES[key].title)} · ${t(MODES[done.ranked ? 'ranked' : 'casual'])}`;
    $('mg-results-time').textContent = formatTime(time);
    $('mg-results-detail').textContent = gaveUp
      ? t('mini.gaveUp', { done: done.total - missed.length, total: done.total })
      : t('mini.detail', { total: done.total, skips: done.skips });
    renderReview(done.all, new Set(missed));
    run = null;
    disarmGiveUp();
    input.blur();
    if (usesGlobe()) restoreGlobe();

    // Ranked: solo las partidas completadas entran en la clasificación
    const rank = $('mg-results-rank');
    rank.hidden = true;
    $('mg-results-board').hidden = !done.ranked || !leaderboardAvailable;
    showScreen('minigameResults');
    if (done.ranked && !gaveUp) sendRanked(key, time, done);
  }

  async function sendRanked(key, timeMs, done) {
    const rank = $('mg-results-rank');
    rank.hidden = false;
    if (!leaderboardAvailable) {
      rank.textContent = t('board.unavailable');
      return;
    }
    if (getPlayerName().length < 2) {
      rank.textContent = t('board.noName');
      return;
    }
    rank.textContent = t('daily.saving');
    const token = resultToken;
    const result = await submitMinigame({ game: key, timeMs, total: done.total, skips: done.skips });
    if (token !== resultToken) return; // ya se empezó otra partida
    if (!result) rank.textContent = t('mini.rankError');
    else if (result.improved) rank.textContent = t('mini.rankNew', result);
    else rank.textContent = t('mini.rankKept', { ...result, best: formatTime(result.bestMs) });
  }

  // --- Rendirse: pide confirmación (un segundo clic) para no perder la partida por error ---
  let giveUpTimer = 0;
  function disarmGiveUp() {
    clearTimeout(giveUpTimer);
    giveUpButton.classList.remove('is-armed');
    giveUpButton.textContent = t('mini.giveUp');
  }
  function giveUp() {
    if (!run?.start || isPaused()) return;
    if (!giveUpButton.classList.contains('is-armed')) {
      sound.play('click');
      giveUpButton.classList.add('is-armed');
      giveUpButton.textContent = t('mini.giveUpConfirm');
      giveUpTimer = setTimeout(disarmGiveUp, GIVE_UP_CONFIRM_MS);
      input.focus();
      return;
    }
    finish(true);
  }

  // --- Repaso: todos los países de la partida con su nombre y su respuesta ---
  // Si se abandonó, primero los que faltaban. Al pulsar uno se ve en el globo.
  function renderReview(all, missed) {
    const g = GAMES[game];
    const countryName = (c) => c[`name_${getLanguage()}`] ?? c.name_en;
    const row = (c, wrong) => {
      const li = el('li', wrong ? 'is-wrong' : 'is-correct');
      let flag = el('span', 'no-flag');
      if (c.flag) {
        flag = el('img');
        flag.src = c.flag;
        flag.alt = '';
        flag.loading = 'lazy';
      }
      // Capitales: país y, a la derecha, su capital (la respuesta). En los otros, el país.
      li.append(flag, el('span', 'name', countryName(c)), el('span', 'answer', g.showCountry ? g.shown(c) : ''), el('span', 'dot'));
      if (c.polygons?.length) {
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.title = t('mini.showOnGlobe');
        const focus = () => focusReview(c, li);
        li.addEventListener('click', focus);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            focus();
          }
        });
      }
      return li;
    };
    const head = (text) => {
      const li = el('li', 'mg-review-head');
      li.append(el('span', 'k', text));
      return li;
    };
    const pending = all.filter((c) => missed.has(c));
    const guessed = all.filter((c) => !missed.has(c));
    review.replaceChildren(
      ...(pending.length ? [head(t('mini.missed', { n: pending.length })), ...pending.map((c) => row(c, true))] : []),
      ...(guessed.length ? [head(t('mini.guessed', { n: guessed.length })), ...guessed.map((c) => row(c, false))] : [])
    );
    review.scrollTop = 0;
  }

  function focusReview(c, li) {
    sound.play('click');
    reviewOnGlobe = true;
    globe.setAutoRotate(false);
    globe.removePin();
    globe.setHighlights({ correct: c });
    const { lon, lat } = countryCenter(c);
    globe.flyTo(lon, lat, 1.4, (countrySizeKm(c) / EARTH_RADIUS_KM) * 3);
    for (const item of review.children) item.classList.toggle('is-selected', item === li);
  }

  // Al salir del resultado: quita el país resaltado y deja el globo como en los menús
  function clearReview() {
    if (!reviewOnGlobe) return;
    reviewOnGlobe = false;
    clearGlobe();
    globe.setAutoRotate(true);
  }

  // --- Pausa: el cronómetro se para y se tapan la bandera y el país ---
  const isPaused = () => run?.pausedAt != null;
  function pause() {
    if (!run?.start || isPaused()) return; // en la cuenta atrás no hay pausa
    run.pausedAt = performance.now();
    card.classList.add('is-paused');
    if (usesGlobe()) {
      clearGlobe(); // tampoco se ve el país en pausa
      globe.setControlsEnabled(false);
    }
    input.disabled = true;
    pauseOverlay.hidden = false;
    $('mg-resume').focus();
  }
  function resume() {
    if (!isPaused()) return;
    run.pausedMs += performance.now() - run.pausedAt;
    run.pausedAt = null;
    card.classList.remove('is-paused');
    pauseOverlay.hidden = true;
    if (usesGlobe()) {
      globe.setControlsEnabled(true);
      showOnGlobe(run.queue[0]);
    }
    input.disabled = false;
    input.focus();
  }

  // Deja el globo como en los menús
  function restoreGlobe() {
    clearGlobe();
    globe.setControlsEnabled(true);
    globe.setBordersVisible(globe.menuBordersVisible);
    globe.setAutoRotate(true);
  }

  // Detiene una partida a medias (al salir de la pantalla)
  function stop() {
    pauseOverlay.hidden = true;
    card.classList.remove('is-paused');
    if (!run) return;
    disarmGiveUp();
    if (usesGlobe()) restoreGlobe();
    run.timeouts.forEach(clearTimeout);
    cancelAnimationFrame(run.raf);
    countdown.hidden = true;
    run = null;
  }

  // --- Eventos ---
  input.addEventListener('input', () => {
    input.classList.remove('is-wrong');
    check(true); // en cuanto lo escrito coincide exactamente, se da por bueno
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!input.value.trim() || check(false)) return;
      sound.play('wrong');
      input.classList.remove('is-wrong');
      void input.offsetWidth;
      input.classList.add('is-wrong');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      skip();
    }
  });
  $('mg-skip').addEventListener('click', skip);
  giveUpButton.addEventListener('click', giveUp);
  nameInput.addEventListener('input', refresh);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !startButton.disabled) startButton.click();
  });
  for (const id of ['minigame-board', 'mg-results-board']) {
    $(id).addEventListener('click', () => {
      sound.play('click');
      openBoard(game);
    });
  }

  // Durante la partida el foco no sale del cuadro de texto: clicar en cualquier sitio de la
  // pantalla (salvo un botón) lo devuelve, y escribir con el foco fuera también lo recupera
  const playing = () => run?.start && !isPaused() && !$('screen-minigame-play').hidden;
  $('screen-minigame-play').addEventListener('pointerdown', (e) => {
    if (!playing() || e.target === input || e.target.closest('button')) return;
    e.preventDefault(); // que el clic no le quite el foco
    input.focus();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (playing() && document.activeElement?.tagName !== 'BUTTON') input.focus({ preventScroll: true });
    });
  });
  document.addEventListener('keydown', (e) => {
    if (playing() && document.activeElement !== input && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      input.focus();
    }
  });
  startButton.addEventListener('click', () => {
    sound.play('click');
    start();
  });
  $('mg-replay').addEventListener('click', () => {
    sound.play('click');
    start();
  });
  for (const button of document.querySelectorAll('[data-minigame]')) {
    button.addEventListener('click', () => {
      sound.play('click');
      openSetup(button.dataset.minigame);
    });
  }
  $('mg-pause-button').addEventListener('click', () => {
    sound.play('click');
    pause();
  });
  $('mg-resume').addEventListener('click', () => {
    sound.play('click');
    resume();
  });
  // Si se cambia de pestaña o se minimiza, se pausa sola
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  countriesReady.then((data) => {
    countries = data;
    refresh();
  });

  return {
    stop,
    clearReview,
    // Esc durante la partida: pausa / reanuda (true si lo ha gestionado)
    togglePause() {
      if (!run) return false;
      if (!run.start) return true; // en la cuenta atrás, Esc no hace nada
      if (isPaused()) resume();
      else pause();
      return true;
    },
    // Al cambiar de idioma
    rebuild() {
      if (game) {
        $('minigame-setup-title').textContent = t(GAMES[game].title);
        buildForm();
      }
      if (run && game) {
        input.placeholder = t(GAMES[game].placeholder);
        disarmGiveUp();
      }
    },
  };
}
