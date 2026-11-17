// CORA — juego "¿Dónde está?": se muestra una pista (nombre y/o bandera) y hay que hacer clic en el
// país correcto del globo. Menú principal → dificultad (o modo prueba) → cuenta atrás →
// rondas → resultado.
//
// Una partida se juega siempre con un objeto de reglas (`rules`): las dificultades fijas
// (DIFFICULTIES) y el modo prueba (rulesFromPractice) producen el mismo tipo de objeto:
//   { label, pool(country) → bool, showName, showFlag, borders, timeLimit, rounds, language }
//
// Este módulo maneja los menús, el estado de la partida y el HUD. Del globo solo usa la API
// que le pasa main.js (`globe`): clics sobre la Tierra, resaltar países, pin, vuelo de cámara…
import { loadSettings, saveSettings, LANGUAGES, DEFAULT_PRACTICE } from './settings.js';
import { createSound } from './sound.js';
import { countryCenter, countrySizeKm, distanceToCountryKm } from './countries.js';
import { leaderboardAvailable, submitScore, watchLeaderboard, getPlayerName, setPlayerName } from './leaderboard.js';

const ROUNDS = 10; // países por partida en las dificultades fijas
const COUNTDOWN_FROM = 3;
// Modo supervivencia: reloj que baja desde SURVIVAL_START_S; cada acierto suma SURVIVAL_BONUS_S
const SURVIVAL_START_S = 15;
const SURVIVAL_BONUS_S = 5;
const SURVIVAL_LOW_S = 5; // por debajo, el reloj se pone en rojo
const MENU_VIEW_SHIFT = 0.18; // en los menús el planeta se desplaza a la derecha (fracción del ancho)
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
    key: 'facil',
    level: 1, // 1–4, para el indicador de barras
    description: 'Nombre y bandera · con fronteras',
    meta: '198 estados',
    pool: isState,
    showName: true,
    showFlag: true,
    borders: true,
    timeLimit: null,
    rounds: ROUNDS,
  },
  normal: {
    label: 'Normal',
    key: 'normal',
    level: 2, // 1–4, para el indicador de barras
    description: 'Solo el nombre',
    meta: '198 estados',
    pool: isState,
    showName: true,
    showFlag: false,
    borders: false,
    timeLimit: null,
    rounds: ROUNDS,
  },
  dificil: {
    label: 'Difícil',
    key: 'dificil',
    level: 3, // 1–4, para el indicador de barras
    description: 'Solo la bandera',
    meta: '239 países y territorios',
    pool: hasFlag, // con pista de bandera solo valen los que tienen bandera (239 de 242)
    showName: false,
    showFlag: true,
    borders: false,
    timeLimit: null,
    rounds: ROUNDS,
  },
  hardcore: {
    label: 'Hardcore',
    key: 'hardcore',
    level: 4, // 1–4, para el indicador de barras
    description: 'Solo la bandera · 10 s por país',
    meta: '239 países y territorios',
    pool: hasFlag,
    showName: false,
    showFlag: true,
    borders: false,
    timeLimit: 10, // segundos por país; si se acaban, cuenta como fallo
    rounds: ROUNDS,
  },
};

// --- Modo prueba ---------------------------------------------------------------
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

// Convierte la configuración del modo prueba en reglas de partida
function rulesFromPractice(p) {
  const continents = new Set(p.continents);
  const types = new Set(p.types);
  const flagOnly = p.showFlag && !p.showName;
  return {
    label: 'Modo prueba',
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
    key: `supervivencia-${d.key}`,
    difficulty: d.key, // dificultad base (para la clasificación online)
    label: `Supervivencia · ${d.label}`,
    mode: 'survival',
    timeLimit: null,
    rounds: Infinity,
  };
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
    results: $('screen-results'),
  };
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
  let answers = []; // { country, correct, clicked }
  let elapsedMs = 0; // tiempo total respondiendo (sin contar cuenta atrás ni pausas de respuesta)
  let roundElapsedMs = 0;
  let timers = [];

  let paused = false;
  const pauseScreen = $('pause');

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
  const pad2 = (n) => String(n).padStart(2, '0');
  const wideScreen = () => window.innerWidth > 720;

  // --- Pantallas ---
  function showScreen(name) {
    if (screen === 'leaderboard' && name !== 'leaderboard') stopBoard();
    screen = name;
    for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
    // En los menús el planeta se aparta a la derecha para dejar sitio al panel
    globe.setViewShift(name && wideScreen() ? MENU_VIEW_SHIFT : 0);
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
    queue = pickRandom(pool, Math.min(rules.rounds, pool.length));
    total = queue.length;
    score = 0;
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
    hudKeys.round.textContent = isSurvival() ? 'Quedan' : 'País';
    hudKeys.score.textContent = isSurvival() ? 'Aciertos' : 'Puntos';
    hudKeys.time.textContent = isSurvival() ? 'Reloj' : 'Tiempo';
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
      show('Ya', 'go');
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

  globe.onEarthClick = (info) => {
    if (state !== 'playing' || paused) return;
    const correct = isCorrect(info);
    if (!correct && !info.country) {
      // Clic en el mar lejos del país: no cuenta como respuesta
      setFeedback('hint', 'Mar');
      return;
    }
    globe.placePin(info.localPoint);
    answer(correct, info.country);
  };

  // "+5 s" junto al reloj de supervivencia
  function showBonus() {
    hudBonus.textContent = `+${SURVIVAL_BONUS_S} s`;
    hudBonus.classList.remove('pop');
    void hudBonus.offsetWidth;
    hudBonus.classList.add('pop');
  }

  // timeout: se acabó el tiempo (por país en hardcore, o el reloj de supervivencia)
  function answer(correct, clicked, { timeout = false } = {}) {
    state = 'feedback';
    const target = current();
    answers.push({ country: target, correct, clicked, timeout });
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
      setFeedback('correct', 'Correcto');
    } else {
      sound.play(timeout ? 'timeout' : 'wrong');
      globe.setHighlights({ correct: target, wrong: clicked });
      if (clicked) globe.setPinLabel({ flag: clicked.flag, text: nameOf(clicked), kind: 'wrong' });
      setFeedback('wrong', timeout ? 'Tiempo · era ' : 'Era ', { b: nameOf(target) });
      const { lon, lat } = countryCenter(target);
      globe.flyTo(lon, lat);
    }
    updateHud();
    later(nextRound, correct ? FEEDBACK_CORRECT_MS : FEEDBACK_WRONG_MS);
  }

  function nextRound() {
    const last = answers.at(-1);
    const country = queue.shift();
    if (isSurvival()) {
      // Sin tiempo: fin de la partida
      if (timeLeftMs <= 0) return finish();
      // Fallado: vuelve a salir más adelante en esta misma partida (no justo a continuación)
      if (!last.correct) {
        const min = Math.min(3, queue.length);
        const at = min + Math.floor(Math.random() * (queue.length - min + 1));
        queue.splice(at, 0, country);
      }
    }
    if (queue.length === 0) finish();
    else startRound();
  }

  // Guarda la partida si es la mejor de su modo y dificultad (más aciertos; a igualdad, menos tiempo)
  function saveRecord() {
    if (!rules.key || score === 0) return false; // el modo prueba no tiene récords; 0 puntos no cuenta
    const best = settings.records[rules.key];
    const better = !best || score > best.score || (score === best.score && elapsedMs < best.timeMs);
    if (better) {
      settings.records[rules.key] = { score, total, timeMs: Math.round(elapsedMs) };
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

  function finish() {
    state = 'results';
    sound.play('finish');
    hud.hidden = true;
    resetGlobe();
    globe.setAutoRotate(true);

    const record = saveRecord();
    $('results-difficulty').textContent = rules.label;
    $('results-score').textContent = score;
    $('results-total').textContent = `/${total}`;
    $('results-time').textContent = formatTime(elapsedMs);
    $('results-record').hidden = !record;
    $('results-record').textContent = 'Nuevo récord';
    sendToLeaderboard();

    const list = $('results-list');
    const flags = $('results-flags');
    list.hidden = isSurvival();
    flags.hidden = !isSurvival();
    if (isSurvival()) {
      // Supervivencia: banderas de los países acertados y número de fallos
      const fails = answers.filter((a) => !a.correct).length;
      flags.replaceChildren(
        el('span', 'k', `Acertados · ${fails} ${fails === 1 ? 'fallo' : 'fallos'}`),
        el('div', 'flag-grid')
      );
      flags.lastChild.append(...answers.filter((a) => a.correct).map((a) => flagImg(a.country)));
    } else {
      list.replaceChildren(
        ...answers.map(({ country, correct }) => {
          const li = el('li', correct ? 'is-correct' : 'is-wrong');
          li.append(flagImg(country), el('span', 'name', nameOf(country)), el('span', 'dot'));
          li.title = correct ? 'Acierto' : 'Fallo';
          return li;
        })
      );
    }
    showScreen('results');
  }

  // --- HUD y cronómetro ---
  function updateHud() {
    hudScore.textContent = score;
    if (isSurvival()) {
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
    $('difficulty-title').textContent = difficultyMode === 'survival' ? 'Supervivencia' : 'Dificultad';
    difficultyList.replaceChildren(
      ...Object.values(DIFFICULTIES).map((d) => {
        const r = rulesFor(d);
        const button = el('button', 'row');
        button.dataset.difficulty = d.key;
        const level = el('span', 'level');
        level.setAttribute('aria-label', `Nivel ${d.level} de 4`);
        for (let n = 1; n <= 4; n++) level.append(el('i', n <= d.level ? 'on' : ''));
        const title = el('span', 'row-title', d.label);
        title.append(level);
        const side = el('span', 'row-side');
        const best = settings.records[r.key];
        if (best) {
          side.append('Récord', el('b', null, `${best.score}/${best.total} · ${formatTime(best.timeMs)}`));
        } else {
          side.append(d.meta);
        }
        // En supervivencia no hay límite por país (manda el reloj)
        const desc = difficultyMode === 'survival' ? d.description.replace(' · 10 s por país', '') : d.description;
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
    renderDifficulties();
    showScreen('difficulty');
  });

  // --- Clasificación online (Convex) ---
  const BOARD_MODES = { clasico: 'Jugar', supervivencia: 'Supervivencia' };
  const board = { mode: 'clasico', difficulty: 'facil', stop: null };
  const boardList = $('board-list');
  const boardStatus = $('board-status');

  // Envía la partida terminada (no las del modo prueba) y muestra el puesto en el resultado
  async function sendToLeaderboard() {
    const rank = $('results-rank');
    rank.hidden = true;
    if (!rules.key || !leaderboardAvailable || score === 0) return;
    if (getPlayerName().length < 2) {
      rank.hidden = false;
      rank.textContent = 'Sin nombre: no entras en la clasificación';
      return;
    }
    const sentRules = rules;
    const result = await submitScore({
      mode: isSurvival() ? 'supervivencia' : 'clasico',
      difficulty: rules.difficulty ?? rules.key,
      score,
      total,
      timeMs: elapsedMs,
    });
    // Si mientras tanto se empezó otra partida, no se toca la pantalla
    if (!result || state !== 'results' || rules !== sentRules) return;
    rank.hidden = false;
    rank.textContent = `Puesto ${result.position} en la clasificación`;
  }

  function stopBoard() {
    board.stop?.();
    board.stop = null;
  }

  function loadBoard() {
    stopBoard();
    boardList.replaceChildren();
    if (!leaderboardAvailable) {
      boardStatus.textContent = 'Clasificación no disponible';
      return;
    }
    boardStatus.textContent = 'Cargando…';
    const me = getPlayerName();
    board.stop = watchLeaderboard(board.mode, board.difficulty, (rows) => {
      if (rows === null) {
        boardStatus.textContent = 'No se pudo cargar la clasificación';
        return;
      }
      boardStatus.textContent = rows.length ? '' : 'Sin puntuaciones todavía';
      boardList.replaceChildren(
        ...rows.map((row) => {
          const li = el('li', row.name === me ? 'is-me' : '');
          li.append(
            el('span', 'board-name', row.name),
            el('span', 'board-score', `${row.score}/${row.total}`),
            el('span', 'board-time', formatTime(row.timeMs))
          );
          return li;
        })
      );
    });
  }

  function openBoard() {
    showScreen('leaderboard');
    loadBoard();
  }

  // Pestañas de modo y dificultad
  function setupBoard() {
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
        option.append(input, label);
        container.append(option);
      }
    };
    tabs($('board-mode'), BOARD_MODES, 'mode');
    tabs(
      $('board-difficulty'),
      Object.fromEntries(Object.values(DIFFICULTIES).map((d) => [d.key, d.label])),
      'difficulty'
    );
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
    if (action === 'play' || action === 'survival') {
      difficultyMode = action === 'survival' ? 'survival' : 'classic';
      askName();
    }
    else if (action === 'settings') showScreen('settings');
    else if (action === 'leaderboard') openBoard();
    else if (action === 'practice') showScreen('practice');
    else if (action === 'start-practice') startGame(rulesFromPractice(settings.practice));
    else if (action === 'menu') goToMenu();
    else if (action === 'pause') pause();
    else if (action === 'resume') resume();
    else if (action === 'replay') startGame(rules);
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
    } else if (state === 'results' && e.key === 'Enter' && !e.target.closest?.('button')) {
      sound.play('click');
      startGame(rules);
    }
  });

  // Si se cambia de pestaña o se minimiza en mitad de una partida, se pausa sola
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  window.addEventListener('resize', () => {
    if (screen) globe.setViewShift(wideScreen() ? MENU_VIEW_SHIFT : 0);
  });

  setupPractice();
  setupBoard();
  goToMenu();

  // --- Pantalla del modo prueba ---
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

    const continentField = field('Continentes');
    const continentInputs = checkList(continentField, 'continents', CONTINENTS);
    const quick = el('div', 'quick-select');
    for (const [label, all] of [
      ['Todos', true],
      ['Ninguno', false],
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

    checkList(field('Tipos de país'), 'types', TYPES);

    const hintField = field('Pista');
    toggle(hintField, 'showName', 'Nombre del país');
    toggle(hintField, 'showFlag', 'Bandera');
    toggle(field('Mapa'), 'borders', 'Mostrar fronteras');

    tabs(field('Idioma de los nombres'), 'language', Object.entries(LANGUAGES));
    tabs(
      field('Tiempo por país'),
      'timeLimit',
      TIME_OPTIONS.map((t) => [t, t ? `${t} s` : 'Sin límite'])
    );
    tabs(
      field('Países por partida'),
      'rounds',
      ROUND_OPTIONS.map((r) => [r, r === 'all' ? 'Todos' : String(r)])
    );

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
      if (!practice.showName && !practice.showFlag) problem = 'Elige al menos una pista: nombre o bandera';
      else if (!practice.continents.length) problem = 'Elige al menos un continente';
      else if (!practice.types.length) problem = 'Elige al menos un tipo de país';
      else if (!pool.length) problem = 'Ningún país cumple estas reglas';

      const rounds = Math.min(rules.rounds, pool.length);
      summary.textContent = problem ?? `${pool.length} países disponibles · partida de ${rounds}`;
      summary.classList.toggle('is-problem', Boolean(problem));
      startButton.disabled = Boolean(problem);
      startButton.replaceChildren(problem ? 'Empezar' : `Empezar · ${rounds} países`, el('kbd', null, '↵'));
    }

    // Enter en el modo prueba también empieza
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !startButton.disabled) startButton.click();
    });

    globe.countriesReady.then((data) => {
      countries = data;
      refresh();
    });
  }
}
