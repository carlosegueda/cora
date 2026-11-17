// Configuración del juego, guardada en el navegador (localStorage) para que se recuerde
// entre visitas. Si el navegador no deja guardar (modo privado, etc.), se usan los valores
// por defecto y el juego funciona igual.
const STORAGE_KEY = 'cora-settings';

// Versión de la configuración guardada. Sirve para aplicar cambios de valores por defecto a
// quien ya tenía una configuración guardada de antes:
//  2 → el idioma por defecto pasa de español a inglés. El juego guardaba la configuración
//      completa (con el idioma por defecto de entonces) al guardar cualquier cosa, así que el
//      español quedaba fijado aunque nadie lo hubiera elegido. Se aplica una sola vez.
const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  sound: true,
  language: 'en', // idioma de las pistas: 'es' | 'en' | 'pt' (inglés por defecto)
  practice: null, // configuración del entrenamiento (se completa con DEFAULT_PRACTICE)
};

// Configuración inicial del entrenamiento (luego se recuerda la última usada)
export const DEFAULT_PRACTICE = {
  continents: ['Europe'],
  types: ['estado'],
  showName: true,
  showFlag: true,
  borders: true,
  language: 'en',
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
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    if ((saved.version ?? 1) < 2) {
      delete saved.language; // vuelve al nuevo valor por defecto (inglés)
      if (saved.practice) delete saved.practice.language;
    }
    return { ...DEFAULT_SETTINGS, ...saved, version: SETTINGS_VERSION };
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
