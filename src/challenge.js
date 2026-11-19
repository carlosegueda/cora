// Desafío: salas de 2 a 10 jugadores, por turnos ("papa caliente"). Ver convex/challenge.ts.
//
//  - Pantallas: inicio (crear sala o unirse con un código), sala de espera, partida y resultado.
//  - Todo el estado vive en el servidor: aquí solo se pinta lo que llega por la suscripción a
//    la sala y se envía la respuesta del jugador cuando es su turno.
//  - El reloj que se ve se calcula con la hora del servidor (se mide el desfase al entrar).
//  - Lo que hace el jugador al que le toca se ve en directo: lo que va escribiendo y, en el
//    globo, hacia dónde se mueve y cuánto zoom hace (la cámara de los demás le sigue).
//  - Países: se hace clic en el globo. Banderas y capitales: se escribe, con la misma
//    tolerancia que en los minijuegos.
import { t, getLanguage } from './i18n.js';
import { countryCenter } from './countries.js';
import { answerKey, matches, countryNames, capitalNames } from './minigames.js';
import {
  leaderboardAvailable,
  getPlayerName,
  setPlayerName,
  getPlayerCountry,
  challengeCall,
  watchChallengeRoom,
  watchChallengeLive,
  serverClockOffset,
} from './leaderboard.js';

const GAMES = { map: 'ch.gameMap', flags: 'ch.gameFlags', capitals: 'ch.gameCapitals' };
const MAX_PLAYERS = 10;
const DELTA = { correct: '+5 s', wrong: '−3 s', timeout: '−5 s' };
const RESULTS_DELAY_MS = 2400; // se ve el último turno antes de pasar al resultado
const QUIT_CONFIRM_MS = 3000;
const KNOWN_ERRORS = ['ROOM_NOT_FOUND', 'ROOM_FULL', 'NEED_PLAYERS', 'NOT_HOST', 'NOT_READY'];
const LIVE_TEXT_MS = 120; // cada cuánto se envía, como mucho, lo que se va escribiendo
const LIVE_VIEW_MS = 200; // … y hacia dónde se mira en el globo

const unique = (list) => [...new Set(list.filter(Boolean))];
const seconds = (ms) => (Math.max(0, ms) / 1000).toFixed(1);

export function createChallenge({ sound, showScreen, getScreen, globe, isHit }) {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const nameInput = $('ch-name');
  const codeInput = $('ch-code');
  const homeStatus = $('ch-home-status');
  const playScreen = $('screen-challenge-play');
  const card = $('ch-card');
  const turnText = $('ch-turn');
  const flagImg = $('ch-flag');
  const promptText = $('ch-prompt-text');
  const input = $('ch-input');
  const barFill = $('ch-bar-fill');
  const feedback = $('ch-feedback');
  const seats = $('ch-seats');
  const quitButton = $('ch-quit');
  const countdown = $('countdown');

  let countries = [];
  let byIso3 = new Map();
  let code = null; // sala en la que se está (null = ninguna)
  let room = null; // último estado recibido del servidor
  let stopWatch = null;
  let stopLive = null;
  let latestLive = null; // lo último recibido del jugador al que le toca
  let liveTimer = 0;
  let lastView = null; // última vista del globo enviada
  let lastViewAt = 0;
  let clockOffset = 0; // hora del servidor − hora de este dispositivo
  let seenTurn = 0; // último turno del que ya se procesó el cambio
  let promptTurn = 0; // turno cuyo país ya se enseñó
  let sentTurn = 0; // turno al que ya se respondió
  let raf = 0;
  let resultsTimer = 0;
  let quitTimer = 0;
  let lastCount = null; // último número de la cuenta atrás que sonó
  let goTimer = 0;
  let clocks = new Map(); // playerId → elemento con su reloj
  let typing = null; // banderas / capitales: { accepted, others } del país del turno

  const serverNow = () => Date.now() + clockOffset;
  const onScreen = (name) => getScreen() === name;
  const playerOf = (id) => room?.players.find((p) => p.playerId === id);
  const isHost = () => Boolean(room?.you) && room.hostId === room.you;
  const nameOf = (c) => c?.[`name_${getLanguage()}`] ?? c?.name_en ?? '';
  const capitalOf = (c) => c?.capital?.[getLanguage()] ?? c?.capital?.en ?? '';
  const answerOf = (c) => (room?.game === 'capitals' ? capitalOf(c) : nameOf(c));
  const myTurn = () => Boolean(room?.you) && room.current?.playerId === room.you;

  const playerFlag = (country) => {
    if (!country) return el('span', 'no-flag');
    const img = el('img', 'country-flag');
    img.src = `/flags/${country.toLowerCase()}.svg`;
    img.alt = country;
    img.addEventListener('error', () => img.replaceWith(el('span', 'no-flag')), { once: true });
    return img;
  };

  function errorText(err) {
    const data = typeof err?.data === 'string' ? err.data : '';
    return t(KNOWN_ERRORS.includes(data) ? `ch.err.${data}` : 'ch.err.generic');
  }

  // --- Inicio: crear sala o unirse con un código ---
  function open(prefill) {
    nameInput.value = getPlayerName();
    if (prefill) codeInput.value = prefill;
    homeStatus.textContent = leaderboardAvailable ? '' : t('board.unavailable');
    for (const id of ['ch-create', 'ch-join']) $(id).disabled = !leaderboardAvailable;
    showScreen('challenge');
    if (prefill && nameInput.value.trim().length >= 2) $('ch-join').focus();
  }

  async function enter(joinCode) {
    const name = nameInput.value.trim();
    if (name.length < 2) {
      homeStatus.textContent = t('ch.needName');
      nameInput.focus();
      return;
    }
    if (joinCode != null && joinCode.trim().length < 5) {
      homeStatus.textContent = t('ch.needCode');
      codeInput.focus();
      return;
    }
    setPlayerName(name);
    homeStatus.textContent = t('board.loading');
    for (const id of ['ch-create', 'ch-join']) $(id).disabled = true;
    try {
      const country = await getPlayerCountry();
      const result =
        joinCode != null
          ? await challengeCall('join', { name, country, code: joinCode })
          : await challengeCall('create', { name, country });
      clockOffset = await serverClockOffset();
      if (!onScreen('challenge')) return; // se fue mientras cargaba
      homeStatus.textContent = '';
      watch(result.code);
    } catch (err) {
      homeStatus.textContent = errorText(err);
    } finally {
      for (const id of ['ch-create', 'ch-join']) $(id).disabled = false;
    }
  }

  function watch(newCode) {
    stopWatch?.();
    code = newCode;
    room = null;
    seenTurn = promptTurn = sentTurn = 0;
    setInviteUrl(code);
    stopWatch = watchChallengeRoom(code, onRoom);
    stopLive?.();
    latestLive = null;
    stopLive = watchChallengeLive(code, onLive);
  }

  // La dirección lleva el código de la sala: sirve de enlace de invitación y para volver
  // a entrar si se recarga la página
  function setInviteUrl(value) {
    const url = new URL(location.href);
    if (value) url.searchParams.set('room', value);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }

  // --- Cambios de la sala ---
  function onRoom(view) {
    if (!code) return;
    if (view === undefined) return; // fallo de conexión: se reintenta solo
    if (view === null) {
      // La sala ya no existe
      forget();
      open();
      homeStatus.textContent = t('ch.err.ROOM_NOT_FOUND');
      return;
    }
    room = view;
    if (view.status === 'lobby') {
      endPlay();
      renderLobby();
      // Si está mirando la configuración o la clasificación, no se le saca de ahí
      if (getScreen()?.startsWith('challenge') && !onScreen('challengeLobby')) showScreen('challengeLobby');
      return;
    }
    if (view.status === 'playing') {
      beginPlay();
      if (view.turn !== seenTurn) {
        if (seenTurn && view.last?.turn === seenTurn) reveal(view.last);
        seenTurn = view.turn;
      }
      renderSeats();
      return;
    }
    // Terminada: si se estaba viendo la partida, primero el último turno y luego el resultado
    if (onScreen('challengePlay')) {
      if (seenTurn && view.last?.turn === seenTurn) {
        seenTurn = 0;
        reveal(view.last);
      }
      renderSeats();
      clearTimeout(resultsTimer);
      resultsTimer = setTimeout(() => showResults(true), RESULTS_DELAY_MS);
    } else {
      showResults(false);
    }
  }

  // --- Sala de espera ---
  function renderLobby() {
    $('ch-room-code').textContent = room.code;
    const host = isHost();
    const games = $('ch-game');
    games.replaceChildren();
    for (const [value, label] of Object.entries(GAMES)) {
      const option = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'ch-game';
      radio.checked = room.game === value;
      radio.disabled = !host;
      radio.addEventListener('change', () => {
        sound.play('click');
        challengeCall('setGame', { code, game: value }).catch(() => {});
      });
      option.append(radio, t(label));
      games.append(option);
    }
    games.classList.toggle('is-readonly', !host);
    $('ch-game-desc').textContent = t(`${GAMES[room.game]}Desc`);
    $('ch-players-label').textContent = t('ch.players', { n: room.players.length, max: MAX_PLAYERS });
    $('ch-lobby-players').replaceChildren(...room.players.map((p) => playerRow(p, null, true)));
    const me = playerOf(room.you);

    // Sugerencias de juego: las ve todo el mundo; el anfitrión las acepta con un clic
    $('ch-suggestions').replaceChildren(
      ...room.players
        .filter((p) => p.suggest && p.playerId !== room.hostId)
        .map((p) => {
          const text = t('ch.suggests', { name: p.name, game: t(GAMES[p.suggest]) });
          if (!host) return el('span', 'ch-suggestion', text);
          const button = el('button', 'ch-suggestion', text);
          button.type = 'button';
          button.title = t('ch.acceptSuggestion');
          button.addEventListener('click', () => {
            sound.play('click');
            challengeCall('setGame', { code, game: p.suggest }).catch(() => {});
          });
          return button;
        })
    );
    // Los demás jugadores proponen un juego (otro clic en el mismo retira la propuesta)
    const suggestBox = $('ch-suggest');
    suggestBox.hidden = host || !me;
    suggestBox.replaceChildren(
      el('span', 'ch-suggest-label', t('ch.suggestLabel')),
      ...Object.entries(GAMES).map(([value, label]) => {
        const button = el('button', `link-button${me?.suggest === value ? ' is-on' : ''}`, t(label));
        button.type = 'button';
        button.addEventListener('click', () => {
          sound.play('click');
          challengeCall('suggest', { code, game: me?.suggest === value ? null : value }).catch(() => {});
        });
        return button;
      })
    );

    // "Listo": cada jugador lo marca; el anfitrión empieza cuando lo están todos
    const waiting = room.players.filter((p) => p.playerId !== room.hostId && !p.ready).length;
    const ready = $('ch-ready');
    ready.hidden = host || !me;
    ready.className = me?.ready ? 'ghost' : 'primary';
    ready.textContent = me?.ready ? t('ch.readyOn') : t('ch.ready');
    const start = $('ch-start');
    start.hidden = !host;
    start.disabled = room.players.length < 2 || waiting > 0;
    $('ch-lobby-status').textContent = !me
      ? t('ch.spectating')
      : !host
        ? t(me.ready ? 'ch.waitingHost' : 'ch.pressReady')
        : room.players.length < 2
          ? t('ch.needPlayers')
          : waiting > 0
            ? t('ch.waitingReady', { n: waiting })
            : '';
  }

  // Fila de un jugador: [puesto], bandera, nombre, etiquetas (tú, anfitrión) y, en la sala de
  // espera, la marca de "listo"
  function playerRow(p, place = null, lobby = false) {
    const li = el('li', p.playerId === room.you ? 'is-me' : '');
    if (place != null) li.append(el('span', 'ch-place', String(place)));
    li.append(playerFlag(p.country), el('span', 'ch-name', p.name));
    if (p.playerId === room.you) li.append(el('span', 'you-tag', t('board.you')));
    if (p.playerId === room.hostId) li.append(el('span', 'ch-host', t('ch.host')));
    else if (lobby) {
      const mark = el('span', `ch-ready-mark${p.ready ? ' is-ready' : ''}`, p.ready ? `✓ ${t('ch.ready')}` : t('ch.notReady'));
      li.append(mark);
    }
    return li;
  }

  // --- Partida ---
  function beginPlay() {
    if (onScreen('challengePlay')) return;
    clearTimeout(resultsTimer);
    const map = room.game === 'map';
    playScreen.classList.toggle('is-map', map);
    showScreen('challengePlay');
    globe.setHighlights();
    globe.removePin();
    globe.setAutoRotate(!map);
    if (map) globe.setBordersVisible(true);
    disarmQuit();
    feedback.textContent = '';
    feedback.className = 'ch-feedback';
    lastCount = null;
    hidePrompt();
    turnText.textContent = '';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  // Deja el globo y la cuenta atrás como en los menús
  function endPlay() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(resultsTimer);
    clearTimeout(goTimer);
    clearTimeout(liveTimer);
    liveTimer = 0;
    globe.followView(null);
    countdown.hidden = true;
    if (!onScreen('challengePlay')) return;
    globe.setHighlights();
    globe.removePin();
    globe.setBordersVisible(globe.menuBordersVisible);
    globe.setAutoRotate(true);
  }

  function hidePrompt() {
    flagImg.hidden = true;
    promptText.textContent = '';
    input.hidden = true;
    input.disabled = true;
    input.value = '';
    input.className = 'text-input text-input-big ch-input';
    card.classList.remove('is-mine');
    barFill.style.transform = 'scaleX(0)';
  }

  function renderSeats() {
    clocks = new Map();
    seats.replaceChildren(
      ...room.players.map((p) => {
        const active = room.status === 'playing' && room.current?.playerId === p.playerId;
        const li = el('li', `ch-seat${active ? ' is-active' : ''}${p.alive ? '' : ' is-out'}${p.playerId === room.you ? ' is-me' : ''}`);
        const clock = el('span', 'ch-clock', p.alive ? seconds(p.timeMs) : '—');
        li.append(playerFlag(p.country), el('span', 'ch-name', p.name), clock);
        if (p.alive) clocks.set(p.playerId, clock);
        return li;
      })
    );
  }

  // Bucle de la partida: cuenta atrás inicial, reloj del jugador al que le toca y barra del turno
  function frame() {
    raf = requestAnimationFrame(frame);
    const current = room?.status === 'playing' ? room.current : null;
    if (!current || !onScreen('challengePlay')) return;
    const sinceStart = serverNow() - current.startsAt;
    const player = playerOf(current.playerId);

    if (sinceStart < 0) {
      // Antes del turno: en el primero de la partida, 3, 2, 1
      if (!room.last) tickCountdown(Math.ceil(-sinceStart / 1000));
      return;
    }
    if (promptTurn !== room.turn) showPrompt();
    const clock = clocks.get(current.playerId);
    if (clock && player) clock.textContent = seconds(player.timeMs - sinceStart);
    barFill.style.transform = `scaleX(${Math.max(0, 1 - sinceStart / current.limitMs)})`;

    // Países, en su turno: envía hacia dónde mira en el globo cuando cambia, para los demás
    if (room.game === 'map' && canAnswer() && performance.now() - lastViewAt > LIVE_VIEW_MS) {
      const view = globe.getView();
      const moved =
        !lastView ||
        Math.abs(view.lon - lastView.lon) > 0.2 ||
        Math.abs(view.lat - lastView.lat) > 0.2 ||
        Math.abs(view.alt / lastView.alt - 1) > 0.02;
      if (moved) {
        lastView = view;
        lastViewAt = performance.now();
        const round = (n, digits) => Number(n.toFixed(digits));
        sendLive('', { lon: round(view.lon, 2), lat: round(view.lat, 2), alt: round(view.alt, 4) });
      }
    }
  }

  // --- En directo ---
  function sendLive(text, view) {
    challengeCall('live', { code, turn: room.turn, text, ...(view ? { view } : {}) }).catch(() => {});
  }

  // Lo que hace el jugador al que le toca: su texto aparece en el cuadro (bloqueado) de los
  // demás, y en el globo la cámara de los demás sigue a la suya
  function onLive(live) {
    latestLive = live ?? null;
    applyLive();
  }
  function applyLive() {
    const live = latestLive;
    if (!live || room?.status !== 'playing' || !onScreen('challengePlay')) return;
    if (live.turn !== room.turn || promptTurn !== room.turn || live.playerId === room.you) return;
    if (room.game === 'map') {
      if (live.view) globe.followView(live.view);
    } else {
      input.value = live.text;
    }
  }

  function popCountdown(text, soundName) {
    countdown.hidden = false;
    countdown.textContent = text;
    countdown.classList.toggle('is-go', soundName === 'go');
    countdown.classList.remove('pop');
    void countdown.offsetWidth;
    countdown.classList.add('pop');
    sound.play(soundName);
  }

  function tickCountdown(n) {
    if (n === lastCount || n > 3) return;
    lastCount = n;
    popCountdown(String(n), 'tick');
    const next = playerOf(room.current.playerId);
    turnText.textContent = myTurn() ? t('ch.youStart') : t('ch.starts', { name: next?.name ?? '' });
  }

  // Empieza a correr el turno: se enseña el país (hasta ahora oculto, para que nadie lo piense
  // con el reloj parado) y, si le toca a este jugador, se le deja responder
  function showPrompt() {
    promptTurn = room.turn;
    if (lastCount != null) {
      lastCount = null;
      popCountdown(t('countdown.go'), 'go');
      clearTimeout(goTimer);
      goTimer = setTimeout(() => (countdown.hidden = true), 700);
    }
    const country = byIso3.get(room.current.iso3);
    const mine = myTurn();
    const player = playerOf(room.current.playerId);
    turnText.textContent = mine ? t('ch.yourTurn') : t('ch.turnOf', { name: player?.name ?? '' });
    card.classList.toggle('is-mine', mine);
    feedback.textContent = '';
    feedback.className = 'ch-feedback';
    const game = room.game;
    flagImg.hidden = !country?.flag;
    if (country?.flag) flagImg.src = country.flag;
    promptText.textContent = game === 'flags' ? '' : nameOf(country);
    if (game === 'map') {
      globe.setHighlights();
      globe.removePin();
      globe.followView(null); // si le toca, vuelve a mover él el globo
      lastView = null;
    } else {
      input.hidden = false;
      input.disabled = !mine;
      input.value = '';
      input.placeholder = mine ? t(game === 'capitals' ? 'mini.capitalPh' : 'mini.countryPh') : '';
      typing = mine ? typingKeys(country) : null;
      if (mine) input.focus();
    }
    if (mine) sound.play('tick');
    else applyLive();
  }

  // Claves aceptadas para el país del turno, y las de los demás (para no dar por buena la de otro)
  function typingKeys(country) {
    const capitals = room.game === 'capitals';
    const names = capitals ? capitalNames : countryNames;
    const valid = (c) => Boolean(c.flag && (!capitals || c.capital));
    const accepted = unique(names(country).map(answerKey));
    const own = new Set(accepted);
    const others = new Set();
    for (const c of countries) {
      if (c === country || !valid(c)) continue;
      for (const name of names(c)) {
        const key = answerKey(name);
        if (!own.has(key)) others.add(key);
      }
    }
    return { accepted, others };
  }

  // ¿Puede responder este jugador ahora mismo?
  const canAnswer = () =>
    room?.status === 'playing' &&
    myTurn() &&
    onScreen('challengePlay') &&
    promptTurn === room.turn &&
    sentTurn !== room.turn;

  function send(correct, clicked = null) {
    sentTurn = room.turn;
    input.disabled = true;
    challengeCall('answer', { code, turn: room.turn, correct, clicked }).catch(() => {});
  }

  // Resultado del turno anterior, igual para todos: quién, qué país era y qué le pasó a su reloj
  function reveal(last) {
    const player = playerOf(last.playerId);
    const country = byIso3.get(last.iso3);
    const name = player?.name ?? '';
    const answer = answerOf(country);
    globe.followView(null);
    hidePrompt();
    const text = {
      correct: () => `${name}: ${answer}`,
      wrong: () => `${name}: ${t('ch.itWas', { answer })}`,
      timeout: () => `${name}: ${t('ch.noAnswer', { answer })}`,
      left: () => t('ch.left', { name }),
    }[last.outcome]();
    feedback.className = `ch-feedback is-${last.outcome === 'correct' ? 'correct' : 'wrong'}`;
    feedback.replaceChildren(
      el('span', 'dot'),
      el('span', null, text),
      ...(DELTA[last.outcome] ? [el('b', null, DELTA[last.outcome])] : []),
      ...(last.eliminated ? [el('span', 'ch-out', t('ch.eliminated'))] : [])
    );
    if (last.outcome !== 'left') sound.play(last.outcome);

    if (room.game === 'map' && country) {
      const clicked = last.clicked ? byIso3.get(last.clicked) : null;
      const mine = last.playerId === room.you;
      if (!mine) globe.removePin();
      globe.setHighlights({ correct: country, wrong: last.outcome === 'wrong' && clicked !== country ? clicked : null });
      if (!(mine && last.outcome === 'correct')) {
        const { lon, lat } = countryCenter(country);
        globe.flyTo(lon, lat);
      }
    }
    if (room.status === 'playing') {
      const next = playerOf(room.current.playerId);
      turnText.textContent = myTurn() ? t('ch.youNext') : t('ch.nextUp', { name: next?.name ?? '' });
    } else {
      turnText.textContent = '';
    }
  }

  // --- Resultado ---
  function showResults(withSound) {
    if (!room || room.status !== 'finished') return;
    endPlay();
    const winner = playerOf(room.winnerId);
    $('ch-winner').textContent = !winner
      ? ''
      : winner.playerId === room.you
        ? t('ch.youWin')
        : t('ch.wins', { name: winner.name });
    const ranking = [...room.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
    $('ch-ranking').replaceChildren(...ranking.map((p) => playerRow(p, p.place ?? '—')));
    const host = isHost();
    $('ch-again').hidden = !host;
    $('ch-results-wait').textContent = host ? '' : t('ch.waitingHost');
    if (!onScreen('challengeResults')) {
      showScreen('challengeResults');
      if (withSound) sound.play('finish');
    }
  }

  // --- Salir ---
  // Deja de escuchar la sala y limpia (sin avisar al servidor ni cambiar de pantalla)
  function forget() {
    endPlay();
    stopWatch?.();
    stopWatch = null;
    stopLive?.();
    stopLive = null;
    latestLive = null;
    code = null;
    room = null;
    setInviteUrl(null);
  }

  // Sale de la sala: en partida, el jugador queda eliminado
  function leave() {
    if (!code) return;
    challengeCall('leave', { code }).catch(() => {});
    forget();
  }

  function disarmQuit() {
    clearTimeout(quitTimer);
    quitButton.classList.remove('is-armed');
    quitButton.textContent = t('ch.quit');
  }

  // --- Eventos ---
  $('ch-create').addEventListener('click', () => {
    sound.play('click');
    enter(null);
  });
  $('ch-join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sound.play('click');
    enter(codeInput.value);
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  $('ch-copy').addEventListener('click', async () => {
    sound.play('click');
    const url = new URL(location.href);
    url.search = `?room=${room?.code ?? code}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      $('ch-copy').textContent = t('ch.copied');
    } catch {
      $('ch-copy').textContent = url.toString();
    }
    setTimeout(() => ($('ch-copy').textContent = t('ch.copy')), 2000);
  });
  $('ch-start').addEventListener('click', async () => {
    sound.play('click');
    try {
      await challengeCall('start', { code });
    } catch (err) {
      $('ch-lobby-status').textContent = errorText(err);
    }
  });
  $('ch-ready').addEventListener('click', () => {
    sound.play('click');
    challengeCall('setReady', { code, ready: !playerOf(room?.you)?.ready }).catch(() => {});
  });
  for (const id of ['ch-leave', 'ch-results-leave']) {
    $(id).addEventListener('click', () => {
      sound.play('click');
      leave();
      open();
    });
  }
  $('ch-again').addEventListener('click', () => {
    sound.play('click');
    challengeCall('backToLobby', { code }).catch(() => {});
  });
  // Salir en mitad de la partida pide confirmación (un segundo clic)
  quitButton.addEventListener('click', () => {
    sound.play('click');
    if (!quitButton.classList.contains('is-armed')) {
      quitButton.classList.add('is-armed');
      quitButton.textContent = t('ch.quitConfirm');
      quitTimer = setTimeout(disarmQuit, QUIT_CONFIRM_MS);
      return;
    }
    leave();
    open();
  });

  // Banderas y capitales: en cuanto lo escrito coincide exactamente se da por bueno; con Enter
  // se responde (con tolerancia a erratas) y, si no vale, es un fallo
  input.addEventListener('input', () => {
    if (!canAnswer()) return;
    // Los demás ven lo que va escribiendo
    if (!liveTimer) {
      liveTimer = setTimeout(() => {
        liveTimer = 0;
        if (room?.status === 'playing' && myTurn()) sendLive(input.value);
      }, LIVE_TEXT_MS);
    }
    if (typing && matches(input.value, typing.accepted, typing.others, true)) send(true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!canAnswer() || !typing || !input.value.trim()) return;
    send(matches(input.value, typing.accepted, typing.others, false));
  });
  // En su turno el foco no sale del cuadro de texto
  playScreen.addEventListener('pointerdown', (e) => {
    if (input.hidden || input.disabled || e.target === input || e.target.closest('button')) return;
    e.preventDefault();
    input.focus();
  });

  // Solo en desarrollo: para comprobar desde la consola (o una prueba) hacia dónde mira el globo
  if (import.meta.env.DEV) window.__challengeView = () => globe.getView();

  globe.countriesReady.then((data) => {
    countries = data;
    byIso3 = new Map(data.map((c) => [c.iso3, c]));
  });

  return {
    open,
    leave,
    inRoom: () => Boolean(code),
    // Países: ¿puede este jugador elegir un país en el globo ahora?
    canSelect: () => room?.game === 'map' && canAnswer(),
    // Países: clic en el globo durante su turno. Cualquier clic cuenta como respuesta.
    onEarthClick(info) {
      if (room?.game !== 'map' || !canAnswer()) return;
      const target = byIso3.get(room.current.iso3);
      if (!target) return;
      globe.placePin(info.localPoint);
      send(isHit(target, info), info.country?.iso3 ?? null);
    },
    // Si la dirección trae ?room=CÓDIGO (enlace de invitación), abre la pantalla para unirse
    checkInvite() {
      const invite = new URLSearchParams(location.search).get('room');
      if (invite && /^[A-Za-z]{5}$/.test(invite)) open(invite.toUpperCase());
    },
    // Al cambiar de idioma
    rebuild() {
      if (!room) return;
      disarmQuit();
      if (room.status === 'lobby') renderLobby();
      else if (room.status === 'finished') showResults(false);
    },
  };
}
