// Juego "¿Dónde está?": se muestra una pista (nombre y/o bandera) y hay que hacer clic en el
// país correcto del globo. Menú principal → dificultad → cuenta atrás → 10 rondas → resultado.
//
// Este módulo maneja los menús, el estado de la partida y el HUD. Del globo solo usa la API
// que le pasa main.js (`globe`): clics sobre la Tierra, resaltar países, pin, vuelo de cámara…
import { loadSettings, saveSettings, LANGUAGES } from './settings.js';
import { createSound } from './sound.js';
import { countryCenter, countrySizeKm, distanceToCountryKm } from './countries.js';

const ROUNDS = 10;
const COUNTDOWN_FROM = 3;
const FEEDBACK_CORRECT_MS = 1200; // pausa tras acertar antes del siguiente país
const FEEDBACK_WRONG_MS = 2600; // pausa tras fallar (la cámara viaja al país correcto)
// Ayuda para países diminutos (Vaticano, Mónaco, islas del Pacífico…): si el país ocupa en
// pantalla menos de SMALL_COUNTRY_PX, vale un clic a menos de CLICK_TOLERANCE_PX de él.
const SMALL_COUNTRY_PX = 25;
const CLICK_TOLERANCE_PX = 15;

const isState = (c) => c.type === 'estado';
const hasFlag = (c) => Boolean(c.flag);

export const DIFFICULTIES = {
  facil: {
    label: 'Fácil',
    description: 'Nombre y bandera · 198 estados · con fronteras',
    pool: isState,
    showName: true,
    showFlag: true,
    borders: true,
    timeLimit: null,
  },
  normal: {
    label: 'Normal',
    description: 'Solo el nombre · 198 estados',
    pool: isState,
    showName: true,
    showFlag: false,
    borders: false,
    timeLimit: null,
  },
  dificil: {
    label: 'Difícil',
    description: 'Solo la bandera · todos los países y territorios',
    pool: hasFlag, // con pista de bandera solo valen los que tienen bandera (239 de 242)
    showName: false,
    showFlag: true,
    borders: false,
    timeLimit: null,
  },
  hardcore: {
    label: 'Hardcore',
    description: 'Solo la bandera · todos · 10 segundos por país',
    pool: hasFlag,
    showName: false,
    showFlag: true,
    borders: false,
    timeLimit: 10, // segundos por país; si se acaban, cuenta como fallo
  },
};

// Mezcla aleatoria (Fisher–Yates) y devuelve los primeros n
function pickRandom(list, n) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// 83 500 ms → "1:23.5"
function formatTime(ms) {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`;
}

export function createGame(globe) {
  const settings = loadSettings();
  const sound = createSound(() => settings.sound);
  const $ = (id) => document.getElementById(id);

  const screens = {
    menu: $('screen-menu'),
    difficulty: $('screen-difficulty'),
    settings: $('screen-settings'),
    results: $('screen-results'),
  };
  const hud = $('hud');
  const hudRound = $('hud-round');
  const hudScore = $('hud-score');
  const hudTime = $('hud-time');
  const hint = $('hint');
  const hintFlag = $('hint-flag');
  const hintName = $('hint-name');
  const roundTimer = $('round-timer');
  const roundTimerBar = $('round-timer-bar');
  const feedback = $('feedback');
  const countdown = $('countdown');

  // --- Estado de la partida ---
  let state = 'menu'; // menu | countdown | playing | feedback | results
  let difficultyKey = null;
  let rounds = []; // países de la partida
  let roundIndex = 0;
  let score = 0;
  let answers = []; // { country, correct, clicked }
  let elapsedMs = 0; // tiempo total respondiendo (sin contar cuenta atrás ni pausas de respuesta)
  let roundElapsedMs = 0;
  let timers = [];

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const nameOf = (country) => country[`name_${settings.language}`] ?? country.name_es;
  const difficulty = () => DIFFICULTIES[difficultyKey];
  const current = () => rounds[roundIndex];

  // --- Pantallas ---
  function showScreen(name) {
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  }

  function resetGlobe() {
    globe.setHighlights();
    globe.removePin();
  }

  function goToMenu() {
    clearTimers();
    state = 'menu';
    hud.hidden = true;
    countdown.hidden = true;
    resetGlobe();
    globe.setBordersVisible(globe.menuBordersVisible);
    globe.setAutoRotate(true);
    showScreen('menu');
  }

  // --- Partida ---
  async function startGame(key) {
    difficultyKey = key;
    const countries = await globe.countriesReady;
    rounds = pickRandom(countries.filter(difficulty().pool), ROUNDS);
    roundIndex = 0;
    score = 0;
    answers = [];
    elapsedMs = 0;
    roundElapsedMs = 0;

    clearTimers();
    resetGlobe();
    showScreen(null);
    globe.setAutoRotate(false);
    globe.setBordersVisible(difficulty().borders);
    hud.hidden = false;
    hint.hidden = true;
    roundTimer.hidden = true;
    feedback.textContent = '';
    updateHud();
    runCountdown();
  }

  function runCountdown() {
    state = 'countdown';
    countdown.hidden = false;
    const show = (text, soundName) => {
      countdown.textContent = text;
      // Reinicia la animación CSS en cada número
      countdown.classList.remove('pop');
      void countdown.offsetWidth;
      countdown.classList.add('pop');
      sound.play(soundName);
    };
    for (let i = 0; i < COUNTDOWN_FROM; i++) later(() => show(String(COUNTDOWN_FROM - i), 'tick'), i * 1000);
    later(() => {
      show('¡Ya!', 'go');
      startRound(); // el cronómetro arranca en 0 justo aquí
    }, COUNTDOWN_FROM * 1000);
    later(() => (countdown.hidden = true), COUNTDOWN_FROM * 1000 + 700);
  }

  function startRound() {
    state = 'playing';
    roundElapsedMs = 0;
    resetGlobe();
    feedback.textContent = '';
    feedback.className = '';

    const d = difficulty();
    const country = current();
    hint.hidden = false;
    hintFlag.hidden = !(d.showFlag && country.flag);
    if (!hintFlag.hidden) hintFlag.src = country.flag;
    hintName.hidden = !d.showName;
    hintName.textContent = d.showName ? nameOf(country) : '';
    roundTimer.hidden = !d.timeLimit;
    updateHud();
  }

  function isCorrect(info) {
    const target = current();
    const clicked = info.country;
    if (clicked === target) return true;
    // Con pista solo de bandera, vale cualquier país con la misma bandera
    // (p. ej. los territorios australianos usan la de Australia)
    if (!difficulty().showName && clicked?.flag && clicked.flag === target.flag) return true;
    // Países diminutos: vale un clic cerca de ellos
    const sizePx = countrySizeKm(target) / info.kmPerPixel;
    return (
      sizePx < SMALL_COUNTRY_PX && distanceToCountryKm(target, info.lon, info.lat) <= CLICK_TOLERANCE_PX * info.kmPerPixel
    );
  }

  globe.onEarthClick = (info) => {
    if (state !== 'playing') return;
    const correct = isCorrect(info);
    if (!correct && !info.country) {
      // Clic en el mar lejos del país: no cuenta como respuesta
      feedback.textContent = 'Eso es mar, prueba otra vez';
      feedback.className = 'is-hint';
      return;
    }
    globe.placePin(info.localPoint);
    answer(correct, info.country);
  };

  function answer(correct, clicked, { timeout = false } = {}) {
    state = 'feedback';
    const target = current();
    answers.push({ country: target, correct, clicked });
    roundTimer.hidden = true;

    if (correct) {
      score++;
      sound.play('correct');
      // Si acertó con otro país de la misma bandera, se resalta el que eligió
      const shown = clicked && clicked !== target && clicked.flag === target.flag ? clicked : target;
      globe.setHighlights({ correct: shown });
      globe.setPinLabel({ flag: shown.flag, text: nameOf(shown), kind: 'correct' });
      feedback.textContent = '¡Correcto!';
      feedback.className = 'is-correct';
    } else {
      sound.play(timeout ? 'timeout' : 'wrong');
      globe.setHighlights({ correct: target, wrong: clicked });
      if (clicked) globe.setPinLabel({ flag: clicked.flag, text: nameOf(clicked), kind: 'wrong' });
      feedback.textContent = `${timeout ? '¡Se acabó el tiempo! ' : ''}Era ${nameOf(target)}`;
      feedback.className = 'is-wrong';
      const { lon, lat } = countryCenter(target);
      globe.flyTo(lon, lat);
    }
    updateHud();
    later(nextRound, correct ? FEEDBACK_CORRECT_MS : FEEDBACK_WRONG_MS);
  }

  function nextRound() {
    roundIndex++;
    if (roundIndex >= ROUNDS) finish();
    else startRound();
  }

  function finish() {
    state = 'results';
    sound.play('finish');
    hud.hidden = true;
    resetGlobe();

    $('results-difficulty').textContent = difficulty().label;
    $('results-score').textContent = `${score} / ${ROUNDS}`;
    $('results-time').textContent = formatTime(elapsedMs);
    const list = $('results-list');
    list.replaceChildren(
      ...answers.map(({ country, correct }) => {
        const li = document.createElement('li');
        li.className = correct ? 'is-correct' : 'is-wrong';
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = correct ? '✓' : '✗';
        li.append(mark);
        if (country.flag) {
          const img = document.createElement('img');
          img.src = country.flag;
          img.alt = '';
          li.append(img);
        }
        li.append(nameOf(country));
        return li;
      })
    );
    showScreen('results');
  }

  // --- HUD y cronómetro ---
  function updateHud() {
    hudRound.textContent = `País ${Math.min(roundIndex + 1, ROUNDS)} / ${ROUNDS}`;
    hudScore.textContent = `${score} ${score === 1 ? 'punto' : 'puntos'}`;
    hudTime.textContent = formatTime(elapsedMs);
    const limit = difficulty()?.timeLimit;
    if (limit) {
      const left = Math.max(0, 1 - roundElapsedMs / (limit * 1000));
      roundTimerBar.style.transform = `scaleX(${left})`;
      roundTimer.classList.toggle('is-low', left < 0.3);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = now - last;
    last = now;
    if (state === 'playing') {
      elapsedMs += dt;
      roundElapsedMs += dt;
      const limit = difficulty().timeLimit;
      if (limit && roundElapsedMs >= limit * 1000) {
        roundElapsedMs = limit * 1000;
        answer(false, null, { timeout: true });
      }
      updateHud();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Botones y configuración ---
  const difficultyList = $('difficulty-list');
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const button = document.createElement('button');
    button.className = `difficulty is-${key}`;
    button.dataset.difficulty = key;
    const title = document.createElement('strong');
    title.textContent = d.label;
    const desc = document.createElement('span');
    desc.textContent = d.description;
    button.append(title, desc);
    difficultyList.append(button);
  }

  const soundToggle = $('setting-sound');
  soundToggle.checked = settings.sound;
  soundToggle.addEventListener('change', () => {
    settings.sound = soundToggle.checked;
    saveSettings(settings);
    sound.play('click');
  });

  const languageList = $('setting-language');
  for (const [code, label] of Object.entries(LANGUAGES)) {
    const option = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'language';
    input.value = code;
    input.checked = settings.language === code;
    input.addEventListener('change', () => {
      settings.language = code;
      saveSettings(settings);
      sound.play('click');
    });
    option.append(input, label);
    languageList.append(option);
  }

  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const { action, difficulty: key } = button.dataset;
    if (key) {
      sound.play('click');
      startGame(key);
      return;
    }
    if (!action) return;
    sound.play('click');
    if (action === 'play') showScreen('difficulty');
    else if (action === 'settings') showScreen('settings');
    else if (action === 'menu') goToMenu();
    else if (action === 'replay') startGame(difficultyKey);
  });

  goToMenu();
}
