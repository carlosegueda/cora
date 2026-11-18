// CORA — juego "¿Dónde está?": se muestra una pista (nombre y/o bandera) y hay que hacer clic en el
// país correcto del globo. Menú principal → dificultad (o entrenamiento) → cuenta atrás →
// rondas → resultado.
//
// Una partida se juega siempre con un objeto de reglas (`rules`): las dificultades fijas
// (DIFFICULTIES) y el entrenamiento (rulesFromPractice) producen el mismo tipo de objeto:
//   { label, pool(country) → bool, showName, showFlag, borders, timeLimit, rounds, language }
//
// Este módulo maneja los menús, el estado de la partida y el HUD. Del globo solo usa la API
// que le pasa main.js (`globe`): clics sobre la Tierra, resaltar países, pin, vuelo de cámara…
import { loadSettings, saveSettings, LANGUAGES, DEFAULT_PRACTICE } from './settings.js';
import { createSound } from './sound.js';
import { t, setLanguage, locale } from './i18n.js';
import { createMinigames } from './minigames.js';
import { countryCenter, countrySizeKm, distanceToCountryKm } from './countries.js';
import {
  leaderboardAvailable,
  submitScore,
  watchLeaderboard,
  watchMinigame,
  getPlayerName,
  setPlayerName,
  startDaily,
  finishDaily,
  watchDaily,
  fetchDailyFirstDay,
  utcDay,
} from './leaderboard.js';

const COUNTDOWN_FROM = 3;
// Para elegir un país hay que mantener pulsado sobre el globo este tiempo (un clic normal no hace
// nada). El anillo de carga y el gesto los gestiona main.js; aquí solo se usa para los puntos.
export const HOLD_TO_SELECT_MS = 800;
// Modo supervivencia: reloj que baja desde SURVIVAL_START_S; cada acierto suma SURVIVAL_BONUS_S
const SURVIVAL_START_S = 20;
const SURVIVAL_BONUS_S = 5;
const SURVIVAL_LOW_S = 5; // por debajo, el reloj se pone en rojo
const MENU_VIEW_SHIFT = 0.18;
const EARTH_RADIUS_KM = 6371;

// Puntos del reto diario (Jugar): cada país vale hasta 1000
//  - Cercanía (hasta 700): 700 si se acierta; si no, baja con la distancia del clic al país.
//    La escala de distancia se ajusta al país: cuanto más grande es, más estricta (fallar un
//    país enorme por 800 km es fallar un objetivo gigante; quedarse a 800 km de una isla
//    diminuta es estar en la zona correcta de algo muy difícil). Va de 1200 km (países
//    diminutos) a 400 km (los más grandes).
//  - Rapidez (hasta 300): entera si se responde en menos de 2 s, nada a partir de 20 s, y
//    multiplicada por la cercanía (hacer clic rápido al azar no puntúa).
const DAILY_ACCURACY_POINTS = 700;
const DAILY_SPEED_POINTS = 300;
// Los umbrales incluyen lo que dura mantener pulsado para elegir el país (HOLD_TO_SELECT_MS)
const DAILY_FAST_S = 2 + HOLD_TO_SELECT_MS / 1000;
const DAILY_SLOW_S = 20 + HOLD_TO_SELECT_MS / 1000;
const DAILY_DISTANCE_MAX_KM = 1200;
const DAILY_DISTANCE_MIN_KM = 400;
const DAILY_DISTANCE_SIZE_FACTOR = 0.15;

function dailyPoints(country, distanceKm, seconds) {
  const scaleKm = Math.min(
    DAILY_DISTANCE_MAX_KM,
    Math.max(DAILY_DISTANCE_MIN_KM, DAILY_DISTANCE_MAX_KM - DAILY_DISTANCE_SIZE_FACTOR * countrySizeKm(country))
  );
  const accuracy = distanceKm <= 0 ? 1 : Math.exp(-distanceKm / scaleKm);
  const speed = Math.min(1, Math.max(0, (DAILY_SLOW_S - seconds) / (DAILY_SLOW_S - DAILY_FAST_S)));
  return Math.round(DAILY_ACCURACY_POINTS * accuracy + DAILY_SPEED_POINTS * speed * accuracy);
}

// 1234.5 km → "1235 km"; 0.4 → "0 km"
const formatKm = (km) => `${Math.round(km)} km`; // en los menús el planeta se desplaza a la derecha (fracción del ancho)
const FEEDBACK_CORRECT_MS = 1200; // pausa tras acertar antes del siguiente país
const FEEDBACK_WRONG_MS = 3400; // pausa tras fallar: 1 s quieta en el pin, luego viaja al país correcto
const FLY_TO_ANSWER_DELAY_MS = 1000; // tras fallar, cuánto se queda la cámara en el pin antes de viajar
// Ayuda para países diminutos (Vaticano, Mónaco, islas del Pacífico…): si el país ocupa en
// pantalla menos de SMALL_COUNTRY_PX, vale un clic a menos de CLICK_TOLERANCE_PX de él.
const SMALL_COUNTRY_PX = 25;
const CLICK_TOLERANCE_PX = 15;

const isState = (c) => c.type === 'estado';
const hasFlag = (c) => Boolean(c.flag);

export const DIFFICULTIES = {
  facil: {
    label: 'Fácil',
    key: 'facil',
    level: 1, // 1–4, para el indicador de barras
    description: 'Nombre y bandera · con fronteras',
    meta: 'diffMeta.states', // clave de traducción
    pool: isState,
    showName: true,
    showFlag: true,
    borders: true,
    timeLimit: null,
    rounds: Infinity, // Jugar: todos los países del grupo, en el menor tiempo posible
    requeue: true, // un país fallado vuelve a salir más adelante
    recordKey: 'completo-facil', // récord local
  },
  normal: {
    label: 'Normal',
    key: 'normal',
    level: 2, // 1–4, para el indicador de barras
    description: 'Solo el nombre',
    meta: 'diffMeta.states', // clave de traducción
    pool: isState,
    showName: true,
    showFlag: false,
    borders: false,
    timeLimit: null,
    rounds: Infinity, // Jugar: todos los países del grupo, en el menor tiempo posible
    requeue: true, // un país fallado vuelve a salir más adelante
    recordKey: 'completo-normal', // récord local
  },
  dificil: {
    label: 'Difícil',
    key: 'dificil',
    level: 3, // 1–4, para el indicador de barras
    description: 'Solo la bandera',
    meta: 'diffMeta.all', // clave de traducción
    pool: hasFlag, // con pista de bandera solo valen los que tienen bandera (239 de 242)
    showName: false,
    showFlag: true,
    borders: false,
    timeLimit: null,
    rounds: Infinity, // Jugar: todos los países del grupo, en el menor tiempo posible
    requeue: true, // un país fallado vuelve a salir más adelante
    recordKey: 'completo-dificil', // récord local
  },
  hardcore: {
    label: 'Hardcore',
    key: 'hardcore',
    level: 4, // 1–4, para el indicador de barras
    description: 'Solo la bandera · 10 s por país',
    meta: 'diffMeta.all', // clave de traducción
    pool: hasFlag,
    showName: false,
    showFlag: true,
    borders: false,
    timeLimit: 10, // segundos por país; si se acaban, cuenta como fallo
    rounds: Infinity, // Jugar: todos los países del grupo, en el menor tiempo posible
    requeue: true, // un país fallado vuelve a salir más adelante
    recordKey: 'completo-hardcore', // récord local
  },
};

// --- Entrenamiento ---------------------------------------------------------------
// Continentes tal como vienen en los datos de Natural Earth, con su nombre en pantalla
export const CONTINENTS = {
  Africa: 'África',
  Asia: 'Asia',
  Europe: 'Europa',
  'North America': 'América del Norte',
  'South America': 'América del Sur',
  Oceania: 'Oceanía',
  Antarctica: 'Antártida',
  'Seven seas (open ocean)': 'Islas oceánicas',
};

export const TYPES = {
  estado: 'Estados',
  territorio: 'Territorios dependientes',
  indeterminado: 'Estatus indeterminado',
};

const TIME_OPTIONS = [null, 5, 10, 20, 30]; // segundos por país (null = sin límite)
const ROUND_OPTIONS = [5, 10, 20, 'all']; // países por partida ('all' = todos los de la selección)

// Convierte la configuración del entrenamiento en reglas de partida
function rulesFromPractice(p) {
  const continents = new Set(p.continents);
  const types = new Set(p.types);
  const flagOnly = p.showFlag && !p.showName;
  return {
    mode: 'practice',
    // Con pista solo de bandera, los países sin bandera no pueden salir
    pool: (c) => continents.has(c.continent) && types.has(c.type) && (!flagOnly || Boolean(c.flag)),
    showName: p.showName,
    showFlag: p.showFlag,
    borders: p.borders,
    timeLimit: p.timeLimit,
    rounds: p.rounds === 'all' ? Infinity : p.rounds,
    language: p.language,
  };
}

// Reglas de supervivencia a partir de una dificultad: mismos países, pista y fronteras,
// sin límite por país (manda el reloj de supervivencia) y con todos los países del grupo
function survivalRules(d) {
  return {
    ...d,
    mode: 'survival',
    recordKey: `supervivencia-${d.key}`,
    difficulty: d.key, // dificultad base (para la clasificación online)
    // (la etiqueta se traduce al mostrarla: ver labelOf)
    timeLimit: null,
    rounds: Infinity,
  };
}

// Reglas del Diario: los 10 estados del día en el orden que da el servidor (los mismos para
// todos), un intento por país, nombre y bandera en el idioma del jugador, sin fronteras
function dailyRules(order, attemptId, language) {
  return {
    mode: 'daily',
    fixedOrder: order, // códigos ISO3
    attemptId,
    pool: (c) => order.includes(c.iso3),
    showName: true,
    showFlag: true,
    borders: false,
    timeLimit: null,
    rounds: order.length,
    requeue: false,
    language,
  };
}

// Nombre de la partida en el idioma actual (título del resultado)
function labelOf(rules) {
  if (rules.mode === 'daily') return t('menu.play');
  if (rules.mode === 'practice') return t('menu.training');
  const difficulty = t(`diff.${rules.difficulty ?? rules.key}`);
  return `${t(rules.mode === 'survival' ? 'menu.survival' : 'menu.marathon')} · ${difficulty}`;
}

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
  setLanguage(settings.language);
  settings.records ??= {}; // mejor partida por dificultad: { facil: { score, total, timeMs } }
  const sound = createSound(() => settings.sound);
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const screens = {
    menu: $('screen-menu'),
    name: $('screen-name'),
    difficulty: $('screen-difficulty'),
    settings: $('screen-settings'),
    practice: $('screen-practice'),
    leaderboard: $('screen-leaderboard'),
    dailyInfo: $('screen-daily-info'),
    results: $('screen-results'),
    arcade: $('screen-arcade'),
    minigames: $('screen-minigames'),
    minigameSetup: $('screen-minigame-setup'),
    minigamePlay: $('screen-minigame-play'),
    minigameResults: $('screen-minigame-results'),
  };
  const isMinigameScreen = (name) => name?.startsWith('minigame');
  const hud = $('hud');
  const hudRound = $('hud-round');
  const hudScore = $('hud-score');
  const hudTime = $('hud-time');
  const hudTimeBlock = $('hud-time-block');
  const hudBonus = $('hud-bonus');
  const hudKeys = { round: $('hud-k-round'), score: $('hud-k-score'), time: $('hud-k-time') };
  const hint = $('hint');
  const hintFlag = $('hint-flag');
  const hintName = $('hint-name');
  const roundTimer = $('round-timer');
  const roundTimerBar = $('round-timer-bar');
  const feedback = $('feedback');
  const countdown = $('countdown');

  // --- Estado de la partida ---
  let state = 'menu'; // menu | countdown | playing | feedback | results
  let screen = 'menu'; // pantalla de menú visible (cuando state es menu o results)
  let rules = null; // reglas de la partida actual (ver comentario al principio)
  let queue = []; // países pendientes; el actual es queue[0]
  let total = 0; // países distintos de la partida
  let timeLeftMs = 0; // supervivencia: tiempo que queda
  let difficultyMode = 'classic'; // qué empieza la pantalla de dificultad: 'classic' | 'survival'
  let score = 0;
  let points = 0; // reto diario: puntos acumulados
  let answers = []; // { country, correct, clicked }
  let elapsedMs = 0; // tiempo total respondiendo (sin contar cuenta atrás ni pausas de respuesta)
  let roundElapsedMs = 0;
  let timers = [];

  let paused = false;
  const pauseScreen = $('pause');
  const pauseNote = $('pause-note');

  // Temporizadores propios (en vez de setTimeout) para que se detengan con la pausa:
  // los descuenta el bucle frame() solo mientras la partida no está en pausa
  const later = (fn, ms) => timers.push({ fn, left: ms });
  const clearTimers = () => {
    timers = [];
  };
  function runTimers(dt) {
    for (const timer of [...timers]) {
      if (!timers.includes(timer)) continue; // lo canceló otro temporizador en este mismo frame
      timer.left -= dt;
      if (timer.left <= 0) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    }
  }

  // --- Pausa ---
  // Solo durante la partida (cuenta atrás, buscando un país o viendo la respuesta).
  // Mientras está en pausa se paran el cronómetro y los temporizadores, y el globo queda
  // tapado y bloqueado para que no se pueda buscar el país sin que corra el tiempo.
  const inGame = () => ['countdown', 'playing', 'feedback'].includes(state);
  function pause() {
    if (!inGame() || paused) return;
    paused = true;
    pauseScreen.hidden = false;
    globe.setControlsEnabled(false);
    pauseScreen.querySelector('.primary').focus({ preventScroll: true });
  }
  function resume() {
    if (!paused) return;
    paused = false;
    pauseScreen.hidden = true;
    globe.setControlsEnabled(true);
  }

  const language = () => rules?.language ?? settings.language;
  const nameOf = (country) => country[`name_${language()}`] ?? country.name_es;
  const current = () => queue[0];
  const isSurvival = () => rules?.mode === 'survival';
  const isDaily = () => rules?.mode === 'daily';
  // Cómo se lleva la partida: reloj de supervivencia, completar todos (Jugar) o rondas fijas
  const hudMode = () => (isSurvival() ? 'survival' : rules?.requeue ? 'complete' : 'rounds');
  const failsCount = () => answers.filter((a) => !a.correct).length;
  const pad2 = (n) => String(n).padStart(2, '0');
  const wideScreen = () => window.innerWidth > 720;
  // En el menú principal de pantallas anchas, el top 5 del Diario ocupa la derecha: el planeta
  // va casi al centro, entre el menú y esa columna. En el resto de menús, a la derecha.
  const viewShiftFor = (name) => {
    if (!name || name === 'minigamePlay' || !wideScreen()) return 0;
    if (name === 'menu' && leaderboardAvailable && window.innerWidth >= 1100) return 0.02;
    return MENU_VIEW_SHIFT;
  };

  // --- Pantallas ---
  const settingsButton = $('settings-button');
  const boardButton = $('board-button');
  let minigames = null;
  function showScreen(name) {
    // Durante la partida (sin pantalla de menú) y en un minijuego no se ven
    settingsButton.hidden = boardButton.hidden = !name || name === 'minigamePlay';
    settingsButton.classList.toggle('is-active', name === 'settings');
    boardButton.classList.toggle('is-active', name === 'leaderboard');
    if (screen === 'minigamePlay' && name !== 'minigamePlay') minigames?.stop();
    if (screen === 'minigameResults' && name !== 'minigameResults') minigames?.clearReview();
    if (screen === 'leaderboard' && name !== 'leaderboard') stopBoard();
    if (name === 'menu') watchDailyTop();
    screen = name;
    for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
    // En los menús el planeta se aparta a la derecha para dejar sitio al panel
    globe.setViewShift(viewShiftFor(name));
    // Lleva el foco al primer botón de la pantalla (navegación con teclado)
    if (name) screens[name].querySelector('.text-input, .menu-item, .row, .primary, .back')?.focus({ preventScroll: true });
  }

  function resetGlobe() {
    globe.setHighlights();
    globe.removePin();
  }

  function goToMenu() {
    clearTimers();
    resume();
    state = 'menu';
    hud.hidden = true;
    countdown.hidden = true;
    resetGlobe();
    globe.setBordersVisible(globe.menuBordersVisible);
    globe.setAutoRotate(true);
    showScreen('menu');
  }

  // --- Partida ---
  async function startGame(newRules) {
    rules = newRules;
    const countries = await globe.countriesReady;
    const pool = countries.filter(rules.pool);
    queue = rules.fixedOrder
      ? rules.fixedOrder.map((iso3) => pool.find((c) => c.iso3 === iso3)).filter(Boolean)
      : pickRandom(pool, Math.min(rules.rounds, pool.length));
    total = queue.length;
    score = 0;
    points = 0;
    answers = [];
    elapsedMs = 0;
    roundElapsedMs = 0;
    timeLeftMs = SURVIVAL_START_S * 1000;

    clearTimers();
    resume();
    resetGlobe();
    showScreen(null);
    globe.setAutoRotate(false);
    globe.setBordersVisible(rules.borders);
    hud.hidden = false;
    hud.classList.toggle('is-survival', isSurvival());
    const labels = {
      survival: [t('hud.left'), t('hud.hits'), t('hud.clock')],
      complete: [t('hud.left'), t('hud.misses'), t('hud.time')],
      rounds: [t('hud.country'), t('hud.points'), t('hud.time')],
    }[hudMode()];
    [hudKeys.round.textContent, hudKeys.score.textContent, hudKeys.time.textContent] = labels;
    pauseNote.hidden = !isDaily();
    hint.hidden = true;
    roundTimer.hidden = true;
    feedback.replaceChildren();
    updateHud();
    runCountdown();
  }

  function runCountdown() {
    state = 'countdown';
    countdown.hidden = false;
    const show = (text, soundName) => {
      countdown.textContent = text;
      countdown.classList.toggle('is-go', soundName === 'go');
      // Reinicia la animación CSS en cada número
      countdown.classList.remove('pop');
      void countdown.offsetWidth;
      countdown.classList.add('pop');
      sound.play(soundName);
    };
    for (let i = 0; i < COUNTDOWN_FROM; i++) later(() => show(String(COUNTDOWN_FROM - i), 'tick'), i * 1000);
    later(() => {
      show(t('countdown.go'), 'go');
      startRound(); // el cronómetro (o el reloj de supervivencia) arranca justo aquí
    }, COUNTDOWN_FROM * 1000);
    later(() => (countdown.hidden = true), COUNTDOWN_FROM * 1000 + 700);
  }

  function startRound() {
    state = 'playing';
    roundElapsedMs = 0;
    resetGlobe();
    feedback.replaceChildren();
    feedback.className = '';

    const country = current();
    const showFlag = rules.showFlag && Boolean(country.flag);
    hint.hidden = false;
    // Reinicia la animación de entrada de la pista
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    hint.classList.toggle('flag-only', showFlag && !rules.showName);
    hintFlag.hidden = !showFlag;
    if (showFlag) hintFlag.src = country.flag;
    hintName.hidden = !rules.showName;
    hintName.textContent = rules.showName ? nameOf(country) : '';
    roundTimer.hidden = !rules.timeLimit;
    updateHud();
  }

  function isCorrect(info) {
    const target = current();
    const clicked = info.country;
    if (clicked === target) return true;
    // Con pista solo de bandera, vale cualquier país con la misma bandera
    // (p. ej. los territorios australianos usan la de Australia)
    if (!rules.showName && clicked?.flag && clicked.flag === target.flag) return true;
    // Países diminutos: vale un clic cerca de ellos
    const sizePx = countrySizeKm(target) / info.kmPerPixel;
    return (
      sizePx < SMALL_COUNTRY_PX && distanceToCountryKm(target, info.lon, info.lat) <= CLICK_TOLERANCE_PX * info.kmPerPixel
    );
  }

  // Mensaje bajo la pista: punto de color + texto (los nombres en <b>)
  function setFeedback(kind, ...parts) {
    feedback.className = kind ? `is-${kind}` : '';
    feedback.replaceChildren(
      ...(kind === 'hint' ? [] : [el('span', 'dot')]),
      ...parts.map((p) => (typeof p === 'string' ? p : el('b', null, p.b)))
    );
  }

  // Solo se puede elegir país mientras se busca (no en la cuenta atrás, la respuesta ni la pausa)
  globe.canSelect = () => state === 'playing' && !paused;

  globe.onEarthClick = (info) => {
    if (state !== 'playing' || paused) return;
    const correct = isCorrect(info);
    if (!correct && !info.country && !isDaily()) {
      // Clic en el mar lejos del país: no cuenta como respuesta
      setFeedback('hint', t('feedback.sea'));
      return;
    }
    globe.placePin(info.localPoint);
    // Distancia del clic al país (0 si se acertó), para los puntos del reto diario
    const distanceKm = correct ? 0 : distanceToCountryKm(current(), info.lon, info.lat);
    answer(correct, info.country, { distanceKm });
  };

  // "+5 s" junto al reloj de supervivencia
  function showBonus() {
    hudBonus.textContent = `+${SURVIVAL_BONUS_S} s`;
    hudBonus.classList.remove('pop');
    void hudBonus.offsetWidth;
    hudBonus.classList.add('pop');
  }

  // timeout: se acabó el tiempo (por país en hardcore, o el reloj de supervivencia)
  function answer(correct, clicked, { timeout = false, distanceKm = null } = {}) {
    state = 'feedback';
    const target = current();
    const earned = isDaily() ? dailyPoints(target, distanceKm ?? Infinity, roundElapsedMs / 1000) : 0;
    points += earned;
    answers.push({ country: target, correct, clicked, timeout, distanceKm, points: earned });
    roundTimer.hidden = true;

    if (correct) {
      score++;
      sound.play('correct');
      if (isSurvival()) {
        timeLeftMs += SURVIVAL_BONUS_S * 1000;
        showBonus();
      }
      // Si acertó con otro país de la misma bandera, se resalta el que eligió
      const shown = clicked && clicked !== target && clicked.flag === target.flag ? clicked : target;
      globe.setHighlights({ correct: shown });
      globe.setPinLabel({ flag: shown.flag, text: nameOf(shown), kind: 'correct' });
      setFeedback('correct', isDaily() ? t('feedback.correctPoints', { points: earned }) : t('feedback.correct'));
    } else {
      sound.play(timeout ? 'timeout' : 'wrong');
      globe.setHighlights({ correct: target, wrong: clicked });
      if (clicked) globe.setPinLabel({ flag: clicked.flag, text: nameOf(clicked), kind: 'wrong' });
      setFeedback(
        'wrong',
        t(timeout ? 'feedback.timeWas' : 'feedback.was'),
        { b: nameOf(target) },
        ...(isDaily() ? [t('feedback.distance', { km: formatKm(distanceKm), points: earned })] : [])
      );
      // Se ve un momento dónde quedó el pin y luego la cámara viaja al país correcto
      // (temporizador del juego: se detiene con la pausa)
      const { lon, lat } = countryCenter(target);
      later(() => globe.flyTo(lon, lat), FLY_TO_ANSWER_DELAY_MS);
    }
    updateHud();
    later(nextRound, correct ? FEEDBACK_CORRECT_MS : FEEDBACK_WRONG_MS);
  }

  function nextRound() {
    const last = answers.at(-1);
    const country = queue.shift();
    // Supervivencia sin tiempo: fin de la partida
    if (isSurvival() && timeLeftMs <= 0) return finish();
    // Jugar y Supervivencia: un país fallado vuelve a salir más adelante (no justo a continuación)
    if (rules.requeue && !last.correct) {
      const min = Math.min(3, queue.length);
      const at = min + Math.floor(Math.random() * (queue.length - min + 1));
      queue.splice(at, 0, country);
    }
    if (queue.length === 0) finish();
    else startRound();
  }

  // Guarda la partida si es la mejor de su modo y dificultad (más aciertos; a igualdad, menos tiempo)
  function saveRecord() {
    if (!rules.recordKey || score === 0) return false; // entrenamiento y diario no tienen récord local
    const best = settings.records[rules.recordKey];
    const better = !best || score > best.score || (score === best.score && elapsedMs < best.timeMs);
    if (better) {
      settings.records[rules.recordKey] = { score, total, timeMs: Math.round(elapsedMs), fails: failsCount() };
      saveSettings(settings);
      renderDifficulties();
    }
    return better;
  }

  const flagImg = (country) => {
    if (!country.flag) return el('span', 'no-flag');
    const img = el('img');
    img.src = country.flag;
    img.alt = '';
    img.title = nameOf(country);
    return img;
  };

  // `review` (solo Diario): se está repasando un intento ya guardado, { position, total };
  // no suena ni se vuelve a enviar.
  function finish(review = null) {
    state = 'results';
    if (!review) sound.play('finish');
    hud.hidden = true;
    resetGlobe();
    globe.setAutoRotate(true);

    const record = saveRecord();
    $('results-difficulty').textContent = labelOf(rules);
    if (hudMode() === 'complete') {
      // Jugar: lo que importa es el tiempo en completarlos todos; al lado, los fallos
      $('results-score').textContent = formatTime(elapsedMs);
      $('results-total').textContent = '';
      $('results-time-k').textContent = t('results.misses');
      $('results-time').textContent = failsCount();
    } else if (isDaily()) {
      // Reto diario: puntos en grande; al lado, aciertos y tiempo
      $('results-score').textContent = points;
      $('results-total').textContent = ' pts';
      $('results-time-k').textContent = t('results.hitsTime');
      $('results-time').textContent = `${score}/${total} · ${formatTime(elapsedMs)}`;
    } else {
      $('results-score').textContent = score;
      $('results-total').textContent = `/${total}`;
      $('results-time-k').textContent = t('results.time');
      $('results-time').textContent = formatTime(elapsedMs);
    }
    $('results-record').hidden = !record;
    $('results-record').textContent = t('results.newRecord');
    // El Diario no se repite: en lugar de "Jugar otra vez", ver la tabla del día
    $('results-replay').hidden = isDaily();
    $('results-daily-board').hidden = !isDaily();
    if (review) {
      $('results-rank').hidden = false;
      $('results-rank').textContent = t('daily.position', review);
    } else if (isDaily()) sendDaily();
    else sendToLeaderboard();

    const list = $('results-list');
    const flags = $('results-flags');
    list.hidden = hudMode() !== 'rounds';
    flags.hidden = !isSurvival();
    if (hudMode() === 'complete') {
      // Jugar: no se listan los ~200 países
    } else if (isSurvival()) {
      // Supervivencia: banderas de los países acertados y número de fallos
      const fails = answers.filter((a) => !a.correct).length;
      flags.replaceChildren(
        el('span', 'k', t('results.found', { fails })),
        el('div', 'flag-grid')
      );
      flags.lastChild.append(...answers.filter((a) => a.correct).map((a) => flagImg(a.country)));
    } else {
      list.replaceChildren(
        ...answers.map(({ country, correct, clicked, distanceKm, points: earned }) => {
          const li = el('li', correct ? 'is-correct' : 'is-wrong');
          // Diario: puntos del país y, si se falló, a cuánto quedó el clic
          const missedBy = !correct && Number.isFinite(distanceKm) ? `${formatKm(distanceKm)} · ` : '';
          li.append(
            flagImg(country),
            el('span', 'name', nameOf(country)),
            el('span', 'pts', isDaily() ? `${missedBy}+${earned}` : ''),
            el('span', 'dot')
          );
          // Al pulsar un país de la lista se pinta de verde y la cámara va hasta él
          li.tabIndex = 0;
          li.setAttribute('role', 'button');
          li.title = t(correct ? 'results.showHit' : 'results.showMiss');
          const focus = () => focusResultCountry(country, li, correct ? null : clicked);
          li.addEventListener('click', focus);
          li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              focus();
            }
          });
          return li;
        })
      );
    }
    showScreen('results');
  }

  // Resultado: muestra un país de la lista en el globo (verde) y lleva la cámara hasta él.
  // Si se falló, en rojo el país donde se hizo clic.
  function focusResultCountry(country, li, clicked = null) {
    sound.play('click');
    globe.setAutoRotate(false);
    globe.removePin();
    globe.setHighlights({ correct: country, wrong: clicked });
    const { lon, lat } = countryCenter(country);
    // Altura para que el país ocupe buena parte de la vista: unas 3 veces su tamaño
    // (los límites de zoom la acotan; los países diminutos se ven desde el zoom máximo)
    globe.flyTo(lon, lat, 1.4, (countrySizeKm(country) / EARTH_RADIUS_KM) * 3);
    for (const item of $('results-list').children) item.classList.toggle('is-selected', item === li);
  }

  // --- HUD y cronómetro ---
  function updateHud() {
    hudScore.textContent = hudMode() === 'complete' ? failsCount() : isDaily() ? points : score;
    if (hudMode() === 'complete') {
      hudRound.textContent = queue.length - (state === 'feedback' && answers.at(-1)?.correct ? 1 : 0);
      hudTime.textContent = formatTime(elapsedMs);
      hudTimeBlock.classList.remove('is-low');
    } else if (isSurvival()) {
      hudRound.textContent = queue.length; // países que quedan por acertar
      hudTime.textContent = formatTime(Math.max(0, timeLeftMs));
      hudTimeBlock.classList.toggle('is-low', timeLeftMs < SURVIVAL_LOW_S * 1000);
    } else {
      // Número del país actual: mientras se ve la respuesta, sigue siendo el que se acaba de contestar
      const shown = answers.length + (state === 'feedback' ? 0 : 1);
      hudRound.textContent = `${pad2(Math.min(shown, total))}/${pad2(total)}`;
      hudTime.textContent = formatTime(elapsedMs);
      hudTimeBlock.classList.remove('is-low');
    }
    const limit = rules?.timeLimit;
    if (limit) {
      const left = Math.max(0, 1 - roundElapsedMs / (limit * 1000));
      roundTimerBar.style.transform = `scaleX(${left})`;
      roundTimer.classList.toggle('is-low', left < 0.3);
    }
  }

  let last = performance.now();
  function frame(now) {
    // Sin saltos enormes si el navegador se congeló (pestaña oculta); en un equipo lento
    // (frames de varios cientos de ms) el tiempo sigue avanzando a su ritmo real
    const dt = Math.min(now - last, 1000);
    last = now;
    if (!paused) runTimers(dt);
    if (state === 'playing' && !paused) {
      elapsedMs += dt;
      roundElapsedMs += dt;
      if (isSurvival()) {
        timeLeftMs -= dt;
        if (timeLeftMs <= 0) {
          timeLeftMs = 0;
          answer(false, null, { timeout: true }); // tras enseñar el país, termina (nextRound)
        }
      } else {
        const limit = rules.timeLimit;
        if (limit && roundElapsedMs >= limit * 1000) {
          roundElapsedMs = limit * 1000;
          answer(false, null, { timeout: true });
        }
      }
      updateHud();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Dificultades: filas con nivel y récord ---
  // La misma pantalla sirve para Jugar y para Supervivencia (difficultyMode)
  const difficultyList = $('difficulty-list');
  const rulesFor = (d) => (difficultyMode === 'survival' ? survivalRules(d) : d);
  function renderDifficulties() {
    $('difficulty-title').textContent = t(difficultyMode === 'survival' ? 'menu.survival' : 'menu.marathon');
    difficultyList.replaceChildren(
      ...Object.values(DIFFICULTIES).map((d) => {
        const r = rulesFor(d);
        const button = el('button', 'row');
        button.dataset.difficulty = d.key;
        const level = el('span', 'level');
        level.setAttribute('aria-label', t('diff.level', { level: d.level }));
        for (let n = 1; n <= 4; n++) level.append(el('i', n <= d.level ? 'on' : ''));
        const title = el('span', 'row-title', t(`diff.${d.key}`));
        title.append(level);
        const side = el('span', 'row-side');
        const best = settings.records[r.recordKey];
        if (best) {
          // Jugar: el récord es el tiempo en completarlos todos
          const text =
            difficultyMode === 'survival'
              ? `${best.score}/${best.total} · ${formatTime(best.timeMs)}`
              : formatTime(best.timeMs);
          side.append(t('diff.record'), el('b', null, text));
        } else {
          side.append(t(d.meta));
        }
        // En supervivencia no hay límite por país (manda el reloj)
        const desc = t(difficultyMode === 'survival' && d.key === 'hardcore' ? 'diffDesc.hardcoreSurvival' : `diffDesc.${d.key}`);
        button.append(title, el('span', 'row-desc', desc), side);
        return button;
      })
    );
  }
  renderDifficulties();

  // --- Nombre del jugador ---
  // Se pide tras pulsar Jugar o Supervivencia (relleno con el último usado) y se guarda para
  // la clasificación. Continuar solo se activa con 2–20 caracteres; Enter también continúa.
  const nameForm = $('name-form');
  const nameInput = $('player-name');
  const nameContinue = $('name-continue');
  const validName = () => nameInput.value.trim().length >= 2;
  const refreshName = () => (nameContinue.disabled = !validName());

  function askName() {
    // Maratón y Supervivencia están dentro de Arcade: "volver" lleva allí
    const back = $('name-back');
    const fromArcade = difficultyMode !== 'daily';
    back.dataset.action = fromArcade ? 'arcade' : 'menu';
    back.dataset.i18n = fromArcade ? 'arcade.back' : 'menu.back';
    back.textContent = t(back.dataset.i18n);
    nameInput.value = getPlayerName();
    refreshName();
    showScreen('name');
    nameInput.select();
  }

  nameInput.addEventListener('input', refreshName);
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validName()) return;
    setPlayerName(nameInput.value);
    sound.play('click');
    if (difficultyMode === 'daily') {
      startDailyFlow();
      return;
    }
    renderDifficulties();
    showScreen('difficulty');
  });

  // --- Clasificación online (Convex) ---
  // Pestañas de la clasificación (claves de traducción)
  const BOARD_MODES = {
    daily: 'board.daily',
    clasico: 'menu.marathon',
    supervivencia: 'menu.survival',
    // Minijuegos en modo ranked (una tabla por minijuego, sin dificultades)
    flags: 'board.flags',
    map: 'board.map',
    capitals: 'board.capitals',
  };
  const BOARD_LIMIT = { daily: 100, clasico: 20, supervivencia: 20, flags: 20, map: 20, capitals: 20 };
  const MINIGAME_BOARDS = ['flags', 'map', 'capitals'];
  const isMinigameBoard = () => MINIGAME_BOARDS.includes(board.mode);
  // day: día del Diario que se está viendo (null = hoy); firstDay: primer día con partidas
  const board = { mode: 'daily', difficulty: 'facil', day: null, firstDay: null, stop: null };
  const shiftDay = (day, n) => utcDay(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
  // El día que se ve en la tabla del Diario (nunca posterior a hoy)
  const boardDay = () => (board.day && board.day < utcDay() ? board.day : utcDay());
  const formatDay = (day, options) => new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), options);
  const boardList = $('board-list');
  const boardStatus = $('board-status');

  // Envía la partida terminada (no las del entrenamiento) y muestra el puesto en el resultado
  async function sendToLeaderboard() {
    const rank = $('results-rank');
    rank.hidden = true;
    if (!rules.recordKey || !leaderboardAvailable || score === 0) return;
    if (getPlayerName().length < 2) {
      rank.hidden = false;
      rank.textContent = t('board.noName');
      return;
    }
    const sentRules = rules;
    const result = await submitScore({
      mode: isSurvival() ? 'supervivencia' : 'clasico',
      difficulty: rules.difficulty ?? rules.key,
      score,
      total,
      timeMs: elapsedMs,
      fails: failsCount(),
    });
    // Si mientras tanto se empezó otra partida, no se toca la pantalla
    if (!result || state !== 'results' || rules !== sentRules) return;
    rank.hidden = false;
    rank.textContent = t('board.position', { position: result.position });
  }

  function stopBoard() {
    board.stop?.();
    board.stop = null;
  }

  // Lo que se muestra de cada fila según la tabla: [columna principal, columna secundaria]
  const boardColumns = () =>
    ({
      daily: ['board.colPoints', 'board.colTime'],
      clasico: ['board.colTime', 'board.colMisses'],
      supervivencia: ['board.colHits', 'board.colTime'],
    })[board.mode] ?? ['board.colTime', 'board.colSkips'];
  const boardValues = (row) =>
    ({
      daily: () => [`${row.points ?? 0}`, formatTime(row.timeMs)],
      clasico: () => [formatTime(row.timeMs), String(row.fails ?? 0)],
      supervivencia: () => [`${row.score}/${row.total}`, formatTime(row.timeMs)],
    })[board.mode]?.() ?? [formatTime(row.timeMs), String(row.skips ?? 0)];

  // Podio con los tres primeros (en pantalla: 2.º, 1.º, 3.º) y tabla con el resto
  function renderBoard(rows) {
    const me = getPlayerName();
    const podium = $('board-podium');
    podium.replaceChildren(
      ...rows.slice(0, 3).map((row, i) => {
        const [main, value] = boardValues(row);
        // En el podio, los fallos de Maratón con su palabra ("4 fallos"), que aquí no hay cabecera
        // (y lo mismo los saltos de los minijuegos)
        const extra =
          board.mode === 'clasico'
            ? t('board.fails', { fails: row.fails ?? 0 })
            : isMinigameBoard()
              ? t('board.skips', { n: row.skips ?? 0 })
              : value;
        const card = el('div', `podium-card place-${i + 1}${row.name === me ? ' is-me' : ''}`);
        const flag = countryFlag(row.country);
        flag.classList.add('podium-flag');
        card.append(
          el('span', 'podium-medal', String(i + 1)),
          flag,
          el('span', 'podium-name', row.name),
          el('span', 'podium-main', main),
          el('span', 'podium-extra', extra)
        );
        if (row.name === me) card.append(el('span', 'you-tag', t('board.you')));
        return card;
      })
    );
    podium.hidden = !rows.length;
    const rest = rows.slice(3);
    $('board-table').hidden = !rest.length;
    boardList.replaceChildren(
      ...rest.map((row, i) => {
        const [main, extra] = boardValues(row);
        const li = el('li', row.name === me ? 'is-me' : '');
        const player = el('span', 'board-player');
        player.append(countryFlag(row.country), el('span', 'board-name', row.name));
        if (row.name === me) player.append(el('span', 'you-tag', t('board.you')));
        li.append(el('span', 'board-rank', String(i + 4)), player, el('span', 'board-main', main), el('span', 'board-extra', extra));
        return li;
      })
    );
  }

  // Solo en desarrollo: para probar la tabla con filas de ejemplo desde la consola
  if (import.meta.env.DEV) window.__renderBoard = renderBoard;

  function loadBoard() {
    stopBoard();
    const daily = board.mode === 'daily';
    $('board-difficulty').hidden = daily || isMinigameBoard();
    const [a, b] = boardColumns();
    $('board-col-a').textContent = t(a);
    $('board-col-b').textContent = t(b);
    renderBoard([]);
    const sub = $('board-sub');
    sub.textContent = '';
    const day = boardDay();
    const isToday = day === utcDay();
    $('board-day').hidden = !daily;
    if (daily) {
      const date = formatDay(day, { day: 'numeric', month: 'long', year: 'numeric' });
      $('board-day-label').textContent = isToday ? `${t('board.today')} · ${date}` : date;
      $('board-day-prev').disabled = !board.firstDay || day <= board.firstDay;
      $('board-day-next').disabled = isToday;
    }
    if (!leaderboardAvailable) {
      boardStatus.textContent = t('board.unavailable');
      return;
    }
    boardStatus.textContent = t('board.loading');
    const onRows = (rows) => {
      if (rows === null) {
        boardStatus.textContent = t('board.loadError');
        return;
      }
      boardStatus.textContent = rows.length
        ? ''
        : daily
          ? t(isToday ? 'daily.nobody' : 'daily.nobodyDay')
          : t('board.empty');
      if (rows.length) {
        sub.textContent = daily
          ? t('board.players', { n: rows.length })
          : t('board.top', { n: BOARD_LIMIT[board.mode] });
      }
      renderBoard(rows);
    };
    board.stop = daily
      ? watchDaily(day, BOARD_LIMIT.daily, onRows)
      : isMinigameBoard()
        ? watchMinigame(board.mode, onRows)
        : watchLeaderboard(board.mode, board.difficulty, onRows);
  }

  // `mode` (opcional) abre directamente una pestaña (una clave de BOARD_MODES)
  function openBoard(mode) {
    if (mode) {
      board.mode = mode;
      setupBoard();
    }
    board.day = null; // siempre se abre en hoy
    showScreen('leaderboard');
    loadBoard();
    // Hasta dónde se puede retroceder en el Diario
    fetchDailyFirstDay().then((first) => {
      if (!first) return;
      board.firstDay = first;
      if (screen === 'leaderboard' && board.mode === 'daily') {
        $('board-day-prev').disabled = boardDay() <= first;
      }
    });
  }

  // Diario: día anterior / siguiente
  const stepBoardDay = (n) => {
    board.day = shiftDay(boardDay(), n);
    sound.play('click');
    loadBoard();
  };
  $('board-day-prev').addEventListener('click', () => stepBoardDay(-1));
  $('board-day-next').addEventListener('click', () => stepBoardDay(1));

  // Pestañas de modo y dificultad
  // Pestañas de modo y dificultad (se reconstruyen al cambiar de idioma)
  function setupBoard() {
    $('board-mode').replaceChildren();
    $('board-difficulty').replaceChildren();
    const tabs = (container, options, key) => {
      for (const [value, label] of Object.entries(options)) {
        const option = el('label');
        const input = el('input');
        input.type = 'radio';
        input.name = `board-${key}`;
        input.checked = board[key] === value;
        input.addEventListener('change', () => {
          board[key] = value;
          sound.play('click');
          loadBoard();
        });
        option.append(input, t(label));
        container.append(option);
      }
    };
    tabs($('board-mode'), BOARD_MODES, 'mode');
    tabs(
      $('board-difficulty'),
      Object.fromEntries(Object.values(DIFFICULTIES).map((d) => [d.key, `diff.${d.key}`])),
      'difficulty'
    );
  }

  // --- Diario ---
  // 10 estados al día, los mismos para todos (los elige el servidor) y un intento por jugador.
  // Tabla del día ordenada por aciertos y, a igualdad, por menos tiempo.
  const dailyInfoText = $('daily-info-text');

  // Bandera del país del jugador (por IP); si no hay, un hueco del mismo tamaño
  const countryFlag = (code) => {
    if (!code) return el('span', 'no-flag');
    const img = el('img', 'country-flag');
    img.src = `/flags/${code.toLowerCase()}.svg`;
    img.alt = code;
    img.title = code;
    img.addEventListener('error', () => img.replaceWith(el('span', 'no-flag', code)), { once: true });
    return img;
  };

  // Una fila de la tabla del Diario: puesto (CSS), bandera, nombre, aciertos y tiempo
  const dailyRow = (row) => {
    const li = el('li', row.name === getPlayerName() ? 'is-me' : '');
    li.append(
      countryFlag(row.country),
      el('span', 'board-name', row.name),
      el('span', 'board-score', `${row.points ?? 0} pts`),
      el('span', 'board-time', formatTime(row.timeMs))
    );
    return li;
  };

  function showDailyInfo(text) {
    dailyInfoText.textContent = text;
    showScreen('dailyInfo');
  }

  async function startDailyFlow() {
    if (!leaderboardAvailable) return showDailyInfo(t('daily.unavailable'));
    showDailyInfo(t('daily.loading'));
    const res = await startDaily();
    if (screen !== 'dailyInfo') return; // salió mientras cargaba
    if (res.status === 'error') return showDailyInfo(t('daily.startError'));
    if (res.status === 'played') {
      // Ya jugó hoy: se le enseña su resultado completo (los intentos antiguos, sin detalle
      // país a país, solo el resumen)
      if (res.finished && res.rounds?.length) return showDailyReview(res);
      return showDailyInfo(
        res.finished
          ? t('daily.played', {
              points: res.points,
              score: res.score,
              time: formatTime(res.timeMs),
              position: res.position,
              total: res.total,
            })
          : t('daily.usedAttempt')
      );
    }
    startGame(dailyRules(res.countries, res.attemptId, settings.language));
  }

  // Repaso del intento de hoy: la misma pantalla de resultado que al terminar, reconstruida
  // con lo que guardó el servidor (puntos, tiempo, puesto y qué pasó con cada país)
  async function showDailyReview(res) {
    const countries = await globe.countriesReady;
    if (screen !== 'dailyInfo') return; // salió mientras cargaba
    const byIso3 = new Map(countries.map((c) => [c.iso3, c]));
    rules = dailyRules(res.countries, null, settings.language);
    answers = res.rounds
      .map((r) => ({
        country: byIso3.get(r.iso3),
        correct: r.correct,
        clicked: (r.clicked && byIso3.get(r.clicked)) || null,
        distanceKm: r.distanceKm,
        points: r.points,
      }))
      .filter((a) => a.country);
    score = res.score;
    points = res.points;
    total = res.countries.length;
    elapsedMs = res.timeMs;
    finish({ position: res.position, total: res.total });
  }

  // Detalle país a país del intento, para poder repasarlo después
  const dailyRounds = () =>
    answers.map((a) => ({
      iso3: a.country.iso3,
      correct: a.correct,
      points: a.points,
      distanceKm: Number.isFinite(a.distanceKm) ? Math.round(a.distanceKm) : null,
      clicked: a.clicked?.iso3 ?? null,
    }));

  // Guarda el intento y muestra el puesto en la tabla general del día
  async function sendDaily() {
    const rank = $('results-rank');
    rank.hidden = false;
    rank.textContent = t('daily.saving');
    const sentRules = rules;
    const result = await finishDaily(rules.attemptId, score, points, elapsedMs, dailyRounds());
    if (state !== 'results' || rules !== sentRules) return;
    rank.textContent = result ? t('daily.position', result) : t('daily.saveError');
  }

  // Top 5 del día en el menú principal (se actualiza solo)
  const dailyCard = $('daily-card');
  const dailyTop = $('daily-top');
  const dailyEmpty = $('daily-empty');
  const dailyTopWatch = { day: null, stop: null };
  function watchDailyTop() {
    dailyCard.hidden = !leaderboardAvailable;
    const day = utcDay();
    if (!leaderboardAvailable || dailyTopWatch.day === day) return;
    dailyTopWatch.stop?.();
    dailyTopWatch.day = day;
    dailyTopWatch.stop = watchDaily(day, 5, (rows) => {
      dailyTop.replaceChildren(...(rows ?? []).map(dailyRow));
      dailyEmpty.textContent = rows === null ? t('daily.unavailable') : rows.length ? '' : t('daily.nobody');
    });
  }

  // --- Configuración ---
  const soundToggle = $('setting-sound');
  soundToggle.checked = settings.sound;
  soundToggle.addEventListener('change', () => {
    settings.sound = soundToggle.checked;
    saveSettings(settings);
    sound.play('click');
  });

  const languageList = $('setting-language');
  for (const [code, label] of Object.entries(LANGUAGES)) {
    const option = el('label');
    const input = el('input');
    input.type = 'radio';
    input.name = 'language';
    input.value = code;
    input.checked = settings.language === code;
    input.addEventListener('change', () => {
      settings.language = code;
      saveSettings(settings);
      sound.play('click');
      // Toda la interfaz cambia al momento: textos fijos, y lo que se construye en código
      setLanguage(code);
      renderDifficulties();
      setupBoard();
      rebuildPractice();
      minigames.rebuild();
    });
    option.append(input, label);
    languageList.append(option);
  }

  // --- Botones ---
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const { action, difficulty: key } = button.dataset;
    if (key) {
      sound.play('click');
      startGame(rulesFor(DIFFICULTIES[key]));
      return;
    }
    if (!action) return;
    sound.play('click');
    if (action === 'play' || action === 'survival' || action === 'daily') {
      difficultyMode = action === 'play' ? 'classic' : action;
      askName();
    }
    else if (action === 'settings') showScreen('settings');
    else if (action === 'leaderboard') openBoard();
    else if (action === 'minigames') showScreen('minigames');
    else if (action === 'arcade') showScreen('arcade');
    else if (action === 'practice') showScreen('practice');
    else if (action === 'start-practice') startGame(rulesFromPractice(settings.practice));
    else if (action === 'menu') goToMenu();
    else if (action === 'pause') pause();
    else if (action === 'resume') resume();
    else if (action === 'replay' && !isDaily()) startGame(rules);
    else if (action === 'daily-board') openBoard('daily');
  });

  // --- Teclado ---
  //  Esc: en partida, pausa / reanuda; en los menús, vuelve al menú principal
  //  1–4: elegir dificultad · Enter en el resultado: jugar otra vez
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return; // el popup de créditos gestiona su Esc
    if (e.key === 'Escape') {
      if (inGame()) {
        e.preventDefault();
        sound.play('click');
        if (paused) resume();
        else pause();
      } else if (state === 'menu' && ['name', 'difficulty'].includes(screen) && difficultyMode !== 'daily') {
        // Maratón y Supervivencia cuelgan de Arcade
        e.preventDefault();
        sound.play('click');
        showScreen('arcade');
      } else if (state === 'menu' && isMinigameScreen(screen)) {
        // En un minijuego en marcha, Esc pausa / reanuda; en el resto, vuelve a la lista
        e.preventDefault();
        sound.play('click');
        if (screen !== 'minigamePlay' || !minigames.togglePause()) showScreen('minigames');
      } else if (state !== 'menu' || screen !== 'menu') {
        e.preventDefault();
        sound.play('click');
        goToMenu();
      }
    } else if (paused) {
      // En pausa no se atiende ningún otro atajo
    } else if (state === 'menu' && screen === 'difficulty' && /^[1-4]$/.test(e.key)) {
      sound.play('click');
      startGame(rulesFor(Object.values(DIFFICULTIES)[Number(e.key) - 1]));
    } else if (state === 'results' && !isDaily() && e.key === 'Enter' && !e.target.closest?.('button')) {
      sound.play('click');
      startGame(rules);
    }
  });

  // Si se cambia de pestaña o se minimiza en mitad de una partida, se pausa sola
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  window.addEventListener('resize', () => {
    if (screen) globe.setViewShift(viewShiftFor(screen));
  });

  const rebuildPractice = setupPractice();
  minigames = createMinigames({
    settings,
    sound,
    showScreen,
    openBoard,
    globe,
    continents: CONTINENTS,
    types: TYPES,
  });
  setupBoard();
  goToMenu();

  // --- Pantalla del entrenamiento ---
  // Construye el formulario a partir de CONTINENTS, TYPES, LANGUAGES, TIME_OPTIONS y
  // ROUND_OPTIONS, y guarda cada cambio en settings.practice (se recuerda entre visitas).
  function setupPractice() {
    settings.practice = { ...DEFAULT_PRACTICE, ...settings.practice };
    const practice = settings.practice;
    const form = $('practice-form');
    const summary = $('practice-summary');
    const startButton = $('practice-start');
    let countries = null;

    const save = () => {
      saveSettings(settings);
      refresh();
    };

    const field = (label) => {
      const node = el('div', 'field');
      if (label) node.append(el('span', 'field-label', label));
      form.append(node);
      return node;
    };

    // Lista de casillas con recuento (varias a la vez) → array en practice[key]
    const checkList = (parent, key, options) => {
      const wrap = el('div', 'check-list');
      const inputs = [];
      for (const [value, label] of Object.entries(options)) {
        const row = el('label', 'check');
        const input = el('input');
        input.type = 'checkbox';
        input.value = value;
        input.checked = practice[key].includes(value);
        input.addEventListener('change', () => {
          practice[key] = inputs.filter((i) => i.checked).map((i) => i.value);
          sound.play('click');
          save();
        });
        const count = el('small');
        count.dataset.countFor = `${key}:${value}`;
        row.append(input, el('span', null, label), count);
        wrap.append(row);
        inputs.push(input);
      }
      parent.append(wrap);
      return inputs;
    };

    // Pestañas (una opción entre varias) → valor en practice[key]
    const tabs = (parent, key, options) => {
      const wrap = el('div', 'tabs');
      for (const [value, label] of options) {
        const option = el('label');
        const input = el('input');
        input.type = 'radio';
        input.name = `practice-${key}`;
        input.checked = practice[key] === value;
        input.addEventListener('change', () => {
          practice[key] = value;
          sound.play('click');
          save();
        });
        option.append(input, label);
        wrap.append(option);
      }
      parent.append(wrap);
    };

    // Interruptor → booleano en practice[key]
    const toggle = (parent, key, label) => {
      const row = el('label', 'field-row');
      const input = el('input', 'switch');
      input.type = 'checkbox';
      input.checked = practice[key];
      input.addEventListener('change', () => {
        practice[key] = input.checked;
        sound.play('click');
        save();
      });
      row.append(el('span', null, label), input);
      parent.append(row);
    };

    // Construye el formulario (y lo reconstruye al cambiar de idioma)
    function build() {
    form.replaceChildren();
    const continentField = field(t('practice.continents'));
    const continentInputs = checkList(
      continentField,
      'continents',
      Object.fromEntries(Object.keys(CONTINENTS).map((key) => [key, t(`continent.${key}`)]))
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
        practice.continents = all ? Object.keys(CONTINENTS) : [];
        sound.play('click');
        save();
      });
      quick.append(button);
    }
    continentField.append(quick);

    checkList(
      field(t('practice.types')),
      'types',
      Object.fromEntries(Object.keys(TYPES).map((key) => [key, t(`type.${key}`)]))
    );

    const hintField = field(t('practice.hint'));
    toggle(hintField, 'showName', t('practice.countryName'));
    toggle(hintField, 'showFlag', t('practice.flag'));
    toggle(field(t('practice.map')), 'borders', t('practice.showBorders'));

    tabs(field(t('practice.namesLanguage')), 'language', Object.entries(LANGUAGES));
    tabs(
      field(t('practice.timePerCountry')),
      'timeLimit',
      TIME_OPTIONS.map((s) => [s, s ? `${s} s` : t('practice.noLimit')])
    );
    tabs(
      field(t('practice.rounds')),
      'rounds',
      ROUND_OPTIONS.map((r) => [r, r === 'all' ? t('practice.roundsAll') : String(r)])
    );
    refresh();
    }
    build();

    // Recuento de países disponibles y validación del botón Empezar
    function refresh() {
      if (!countries) return;
      const rules = rulesFromPractice(practice);
      const pool = countries.filter(rules.pool);

      // Cuántos países aporta cada continente y cada tipo con el resto de filtros actuales
      for (const node of form.querySelectorAll('[data-count-for]')) {
        const [key, value] = node.dataset.countFor.split(':');
        const probe = { ...practice, [key]: [value] };
        node.textContent = countries.filter(rulesFromPractice(probe).pool).length;
      }

      let problem = null;
      if (!practice.showName && !practice.showFlag) problem = t('practice.needHint');
      else if (!practice.continents.length) problem = t('practice.needContinent');
      else if (!practice.types.length) problem = t('practice.needType');
      else if (!pool.length) problem = t('practice.noCountries');

      const rounds = Math.min(rules.rounds, pool.length);
      summary.textContent = problem ?? t('practice.summary', { available: pool.length, rounds });
      summary.classList.toggle('is-problem', Boolean(problem));
      startButton.disabled = Boolean(problem);
      startButton.replaceChildren(problem ? t('practice.start') : t('practice.startCount', { rounds }), el('kbd', null, '↵'));
    }

    // Enter en el entrenamiento también empieza
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !startButton.disabled) startButton.click();
    });

    globe.countriesReady.then((data) => {
      countries = data;
      refresh();
    });
    return build;
  }
}
