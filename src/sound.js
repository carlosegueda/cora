// Efectos de sonido generados con la Web Audio API (sin archivos de audio).
// El navegador solo permite sonar después de una interacción del usuario, así que el
// contexto de audio se crea la primera vez que se reproduce algo (tras pulsar un botón).
export function createSound(isEnabled) {
  let ctx = null;

  function audio() {
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
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
      if (isEnabled()) sounds[name]?.();
    },
  };
}
