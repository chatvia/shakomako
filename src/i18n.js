/**
 * Internationalization (i18n) System
 * Handles translation loading, language detection, and translation functions
 */

// Import language files directly (bundled with the widget)
import enTranslations from '../languages/en.json';
import arTranslations from '../languages/ar.json';
import daTranslations from '../languages/da.json';
import deTranslations from '../languages/de.json';
import esTranslations from '../languages/es.json';
import faTranslations from '../languages/fa.json';
import frTranslations from '../languages/fr.json';
import hiTranslations from '../languages/hi.json';
import idTranslations from '../languages/id.json';
import jaTranslations from '../languages/ja.json';
import koTranslations from '../languages/ko.json';
import ptTranslations from '../languages/pt.json';
import ruTranslations from '../languages/ru.json';
import trTranslations from '../languages/tr.json';
import viTranslations from '../languages/vi.json';
import zhTranslations from '../languages/zh.json';

// Available translations (bundled)
const availableTranslations = {
  en: enTranslations,
  ar: arTranslations,
  da: daTranslations,
  de: deTranslations,
  es: esTranslations,
  fa: faTranslations,
  fr: frTranslations,
  hi: hiTranslations,
  id: idTranslations,
  ja: jaTranslations,
  ko: koTranslations,
  pt: ptTranslations,
  ru: ruTranslations,
  tr: trTranslations,
  vi: viTranslations,
  zh: zhTranslations
};

// Translation cache
let translations = {};
let currentLanguage = 'en';
let userSetLanguage = null; // Language explicitly set by user/config

// Fallback to English
const fallbackLanguage = 'en';

// Languages that render right-to-left. Keep in sync with bundled translations.
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * Initialize i18n system
 * @param {Object} config - Configuration object
 * @param {string} config.language - Language code ('en', 'auto', etc.)
 * @returns {Promise<void>}
 */
export async function initI18n(config = {}) {
  // Determine which language to use
  let targetLanguage = fallbackLanguage;

  if (config.language && config.language !== 'auto') {
    // User specified a language
    userSetLanguage = normalizeLanguageCode(config.language);
    targetLanguage = userSetLanguage;
  } else {
    // Auto-detect from browser
    targetLanguage = detectBrowserLanguage();
  }

  // Load the translation file
  await loadLanguage(targetLanguage);
}

/**
 * Normalize language code to simple format
 * Examples: 'en' -> 'en', 'en-us' -> 'en', 'en_US' -> 'en', 'fr-FR' -> 'fr'
 */
function normalizeLanguageCode(code) {
  if (!code) return fallbackLanguage;

  // Remove whitespace and convert to lowercase
  code = code.trim().toLowerCase();

  // Extract just the language part (before '-' or '_')
  if (code.includes('-')) {
    code = code.split('-')[0];
  } else if (code.includes('_')) {
    code = code.split('_')[0];
  }

  // Validate it's a 2-letter code
  if (code.length === 2 && /^[a-z]{2}$/.test(code)) {
    return code;
  }

  return fallbackLanguage;
}

/**
 * Detect browser language
 */
function detectBrowserLanguage() {
  // Try to get language from browser
  const browserLang = navigator.language || navigator.userLanguage || fallbackLanguage;
  return normalizeLanguageCode(browserLang);
}

/**
 * Load language file (from bundled translations)
 * @param {string} languageCode - Language code (e.g., 'en', 'ar')
 */
async function loadLanguage(languageCode) {
  try {
    // Check if the language is available in bundled translations
    if (availableTranslations[languageCode]) {
      translations = availableTranslations[languageCode];
      currentLanguage = languageCode;
      console.log(`i18n: Loaded language: ${languageCode}`);
    } else {
      throw new Error(`Language not available: ${languageCode}`);
    }
  } catch (error) {
    console.warn(
      `i18n: Failed to load language ${languageCode}, falling back to ${fallbackLanguage}`,
      error
    );

    // Try to load fallback language if it's different
    if (languageCode !== fallbackLanguage && availableTranslations[fallbackLanguage]) {
      translations = availableTranslations[fallbackLanguage];
      currentLanguage = fallbackLanguage;
      console.log(`i18n: Loaded fallback language: ${fallbackLanguage}`);
    } else {
      console.error('i18n: Failed to load fallback language');
      // Use empty translations object as last resort
      translations = {};
    }
  }
}

/**
 * Get translation for a key
 * @param {string} key - Translation key in dot notation (e.g., 'widget.open_chat')
 * @param {Object} vars - Variables to replace in translation (e.g., {count: 5})
 * @returns {string} - Translated string
 */
export function t(key, vars = {}) {
  // Split the key by dots to navigate the object
  const keys = key.split('.');
  let value = translations;

  // Navigate through the translation object
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Key not found, return the key itself as fallback
      console.warn(`i18n: Translation key not found: ${key}`);
      return key;
    }
  }

  // If value is not a string, return the key
  if (typeof value !== 'string') {
    console.warn(`i18n: Translation value is not a string: ${key}`);
    return key;
  }

  // Replace variables in the string
  return replaceVars(value, vars);
}

/**
 * Replace variables in translation string
 * Example: "Hello {name}" with {name: "John"} -> "Hello John"
 */
function replaceVars(str, vars) {
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

/**
 * Get current language code
 */
export function getCurrentLanguage() {
  return currentLanguage;
}

/**
 * Whether the current language flows right-to-left.
 * Used to set `dir="rtl"` on the widget container so direction-sensitive CSS
 * (and the few `[dir="rtl"]` overrides in widget.css) flip into place.
 */
export function isRTL() {
  return RTL_LANGUAGES.has(currentLanguage);
}

/**
 * Resolve the current language's text direction.
 * @returns {'rtl' | 'ltr'}
 */
export function getDirection() {
  return isRTL() ? 'rtl' : 'ltr';
}

/**
 * Change language dynamically
 * @param {string} languageCode - New language code
 */
export async function changeLanguage(languageCode) {
  const normalized = normalizeLanguageCode(languageCode);
  await loadLanguage(normalized);

  // Emit event for components to re-render
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('chatvia:language-changed', {
        detail: { language: currentLanguage }
      })
    );
  }
}

/**
 * Get list of available languages (from bundled translations)
 */
export function getAvailableLanguages() {
  return Object.keys(availableTranslations).map(code => {
    const languageNames = {
      en: { name: 'English', nativeName: 'English' },
      ar: { name: 'Arabic', nativeName: 'العربية' },
      da: { name: 'Danish', nativeName: 'Dansk' },
      de: { name: 'German', nativeName: 'Deutsch' },
      fr: { name: 'French', nativeName: 'Français' },
      es: { name: 'Spanish', nativeName: 'Español' },
      pt: { name: 'Portuguese', nativeName: 'Português' }
    };
    return {
      code,
      name: languageNames[code]?.name || code,
      nativeName: languageNames[code]?.nativeName || code
    };
  });
}
