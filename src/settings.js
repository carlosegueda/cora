// Configuración del juego, guardada en el navegador (localStorage) para que se recuerde
// entre visitas. Si el navegador no deja guardar (modo privado, etc.), se usan los valores
// por defecto y el juego funciona igual.
const STORAGE_KEY = 'cora-settings';

export const DEFAULT_SETTINGS = {
  sound: true,
  language: 'es', // idioma de las pistas: 'es' | 'en' | 'pt'
  practice: null, // configuración del entrenamiento (se completa con DEFAULT_PRACTICE)
};

// Configuración inicial del entrenamiento (luego se recuerda la última usada)
export const DEFAULT_PRACTICE = {
  continents: ['Europe'],
  types: ['estado'],
  showName: true,
  showFlag: true,
  borders: true,
  language: 'es',
  timeLimit: null, // segundos por país, o null = sin límite
  rounds: 10, // 5 | 10 | 20 | 'all'
};

export const LANGUAGES = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento: la configuración dura solo mientras la página esté abierta
  }
}
