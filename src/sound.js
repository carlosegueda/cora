// Efectos de sonido. Cada uno puede venir de un archivo en src/sounds/ (click.mp3, correct.ogg…;
// ver src/sounds/README.md); los que no tienen archivo se generan con la Web Audio API.
// El navegador solo permite sonar después de una interacción del usuario, así que el
// contexto de audio se crea la primera vez que se reproduce algo (tras pulsar un botón).
const FILES = Object.fromEntries(
  Object.entries(import.meta.glob('./sounds/*.{mp3,ogg,wav}', { query: '?url', import: 'default', eager: true })).map(
    ([path, url]) => [path.match(/([^/]+)\.\w+$/)[1], url]
  )
);
const FILE_VOLUME = 0.6;

export function createSound(isEnabled) {
  let ctx = null;
  const buffers = {}; // nombre → audio ya decodificado
  let loading = false;

  // Descarga y decodifica los archivos la primera vez que hay contexto de audio
  function loadFiles(ac) {
    if (loading) return;
    loading = true;
    for (const [name, url] of Object.entries(FILES)) {
      fetch(url)
        .then((res) => res.arrayBuffer())
        .then((data) => ac.decodeAudioData(data))
        .then((buffer) => (buffers[name] = buffer))
        .catch((err) => console.warn(`No se pudo cargar el sonido "${name}":`, err));
    }
  }

  function playFile(name) {
    const ac = audio();
    if (!ac || !buffers[name]) return false;
    const source = ac.createBufferSource();
    const gain = ac.createGain();
    source.buffer = buffers[name];
    gain.gain.value = FILE_VOLUME;
    source.connect(gain).connect(ac.destination);
    source.start();
    return true;
  }

  function audio() {
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
      loadFiles(ctx);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Una nota: frecuencia (Hz), inicio (s desde ahora), duración (s), forma de onda y volumen
  function tone(freq, start, duration, type = 'sine', volume = 0.2) {
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    // Envolvente: ataque rápido y caída suave para que no haga "clic"
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const sounds = {
    tick: () => tone(660, 0, 0.15, 'sine', 0.25), // cuenta atrás 3, 2, 1
    go: () => tone(990, 0, 0.35, 'sine', 0.3), // ¡Ya!
    correct: () => {
      tone(660, 0, 0.12, 'triangle', 0.25);
      tone(990, 0.1, 0.25, 'triangle', 0.25);
    },
    wrong: () => {
      tone(220, 0, 0.18, 'square', 0.12);
      tone(165, 0.15, 0.3, 'square', 0.12);
    },
    timeout: () => tone(140, 0, 0.5, 'sawtooth', 0.12),
    finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.22)),
    click: () => tone(880, 0, 0.05, 'sine', 0.12),
  };

  return {
    play(name) {
      if (isEnabled() && !playFile(name)) sounds[name]?.();
    },
  };
}
