# Widget Internationalization Integration Guide

## Overview
This guide explains how to integrate the i18n system into the chatvia widget.

## Files Created
1. `/languages/en.json` - English translations
2. `/src/i18n.js` - Translation utility

## Integration Steps

### 1. Update `src/widget.js`

**Add import at the top:**
```javascript
import { initI18n, t } from './i18n.js';
```

**In the `constructor`, add language option:**
```javascript
// After line 47 (after this.searchPosition)
this.language = this.options.language || 'auto';
```

**In `_initialize()` method, initialize i18n before other initializations:**
```javascript
async _initialize() {
  try {
    // Initialize i18n system first
    await initI18n({ language: this.language });
    
    await this._verifyClient();
    // ... rest of initialization
```

**Update error messages to use translations:**
```javascript
// Line 144 - replace hardcoded string
await this.disabledChat(t('errors.initialization_failed'));

// Line 153 - replace hardcoded string
await this.disabledChat(t('errors.verification_failed'));

// Line 165 - replace hardcoded string
await this.disabledChat(t('errors.session_failed'));
```

**Update dialog text (around line 416, 454, 460, 507, etc.):**
```javascript
// Line 416
'aria-label': t('widget.open_chat'),

// Line 443 (placeholder)
const placeholder = this.settings.welcome_message || this.options.placeholder || t('widget.ask_question');

// Line 454
textContent: isMac ? t('shortcuts.mac') : t('shortcuts.windows'),
title: t('widget.press_to_toggle')

// Line 460
'aria-label': t('widget.search')

// Line 466
title: t('widget.view_history')

// Line 704
placeholder: placeholder,
'aria-label': placeholder,

// Line 714
'aria-label': t('widget.send_message'),

// Line 752
textContent: t('confirm.cancel')

// Line 757
textContent: confirmText  // This comes from calling function
```

**Update menu options (around line 618-621):**
```javascript
this.newChatOption = this._createMenuOption(t('menu.new_chat'), 'new-chat', guardedAction(() => this.startNewThread()));
this.historyOption = this._createMenuOption(t('menu.chat_history'), 'history', guardedAction(() => this.loadChatHistory()));
this.clearCurrentOption = this._createMenuOption(t('menu.clear_current'), 'delete', guardedAction(() => this.confirmDeleteThread()));
this.clearAllOption = this._createMenuOption(t('menu.clear_all'), 'clear-all', guardedAction(() => this.confirmClearAllThreads()));
```

**Update delete button labels (around line 571-572):**
```javascript
this.deleteThreadButton = this._createHeaderButton('delete', t('widget.clear_current_chat'), CSS_CLASSES.DELETE_BUTTON);
this.expandButton = this._createHeaderButton('expand', t('widget.expand_chat'), CSS_CLASSES.EXPAND_BUTTON);
this.closeButton = this._createHeaderButton('close', t('widget.close_chat'), CSS_CLASSES.CLOSE_BUTTON);
this.menuButton = this._createHeaderButton('menu', t('widget.menu'), CSS_CLASSES.MENU_BUTTON, {...});
```

**Update loading indicator (around line 680):**
```javascript
'aria-label': t('widget.loading')
```

**Update lead form success/error messages (around line 849-888):**
```javascript
// Line 849-850
let successTitle = t('lead_form.thank_you');
let successMessage = t('lead_form.success_message');

// Line 887
textContent: t('lead_form.error_message')
```

### 2. Update `src/ui.js`

**Add import:**
```javascript
import { t } from './i18n.js';
```

**Update lead form (around line 97-103, 195-201, 283, 322):**
```javascript
// Line 97
textContent: t('lead_form.title')

// Line 103
textContent: t('lead_form.loading')

// Field configuration (line 195-201):
const fieldTypes = {
  name: { type: 'text', label: t('lead_form.fields.name'), placeholder: t('lead_form.fields.enter_name') },
  email: { type: 'email', label: t('lead_form.fields.email'), placeholder: t('lead_form.fields.enter_email') },
  phone: { type: 'tel', label: t('lead_form.fields.phone'), placeholder: t('lead_form.fields.enter_phone') },
  job_title: { type: 'text', label: t('lead_form.fields.job_title'), placeholder: t('lead_form.fields.enter_job_title') },
  company: { type: 'text', label: t('lead_form.fields.company'), placeholder: t('lead_form.fields.enter_company') },
  location: { type: 'text', label: t('lead_form.fields.location'), placeholder: t('lead_form.fields.enter_location') },
  message: { type: 'textarea', label: t('lead_form.fields.message'), placeholder: t('lead_form.fields.enter_message') }
};

// Line 283
textContent: t('lead_form.submit')

// Line 292
submitButton.textContent = t('lead_form.submitting');

// Line 322
textContent: t('lead_form.error_load')
```

### 3. Update `src/state/threads.js`

**Add import:**
```javascript
import { t } from '../i18n.js';
```

**Update confirmation dialogs (around line 339, 361-365):**
```javascript
// Line 339-343 (confirmDeleteThread)
widget._showConfirmationDialog(
  t('confirm.delete_chat_title'),
  t('confirm.delete_chat_message'),
  t('confirm.delete_button'),
  () => deleteThread(widget, widget.activeThreadId)
);

// Line 361-365 (confirmClearAllThreads)
widget._showConfirmationDialog(
  t('confirm.delete_all_title'),
  t('confirm.delete_all_message'),
  t('confirm.delete_all_button'),
  () => deleteAllThreads(widget)
);
```

**Update no history message (around line 379):**
```javascript
textContent: t('threads.no_history'),
```

**Update new conversation text (around line 407):**
```javascript
titleEl.textContent = thread.title || getFirstUserMessage(widget, thread) || t('threads.new_conversation');
```

**Update timestamp function (around line 457-515):**
```javascript
export function formatTimestamp(timestamp) {
  if (!timestamp) return t('threads.unknown_date');
  
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) {
    return t('threads.just_now');
  } else if (minutes < 60) {
    return minutes === 1 ? t('threads.minute_ago') : t('threads.minutes_ago', { count: minutes });
  } else if (hours < 24) {
    return hours === 1 ? t('threads.hour_ago') : t('threads.hours_ago', { count: hours });
  } else if (days === 1) {
    return t('threads.yesterday');
  } else if (days < 7) {
    return t('threads.days_ago', { count: days });
  } else {
    // ... rest of formatting
  }
}
```

### 4. Update `src/state/messages.js` (or `src/base.js`)

**Add import:**
```javascript
import { t } from '../i18n.js';
```

**Update message action buttons (around line 312-334):**
```javascript
// Copy button
'aria-label': t('messages.copy_message'),
title: t('messages.copy')

// Good response
'aria-label': t('messages.good_response'),
title: t('messages.good_response'),

// Bad response
'aria-label': t('messages.bad_response'),
title: t('messages.bad_response'),
```

**Update "Copied!" tooltip (in copy function):**
```javascript
// When showing copied confirmation
textContent: t('messages.copied')
```

### 5. Update `src/state/handoff.js`

**Add import:**
```javascript
import { t } from '../i18n.js';
```

**Update handoff messages (find the relevant sections):**
```javascript
// When creating "Talk to human" button
textContent: t('handoff.talk_to_human')

// Connection states
t('handoff.connecting')
t('handoff.connected', { name: adminName })
t('handoff.waiting_for_agent')
t('handoff.agent_typing', { name: adminName })
t('handoff.disconnected')
t('handoff.returned_to_bot')
```

### 6. Update `src/main.js` to expose language API

**Add to the API object (around line 142):**
```javascript
import { changeLanguage, getCurrentLanguage, getAvailableLanguages } from './i18n.js';

// In the api object:
/**
 * Get current language
 * @returns {string}
 */
getLanguage: () => {
  return getCurrentLanguage();
},

/**
 * Change widget language
 * @param {string} languageCode - Language code ('en', 'es', 'fr', etc.)
 * @returns {Promise<void>}
 */
setLanguage: async (languageCode) => {
  await changeLanguage(languageCode);
  // Optionally reload widget UI here
},

/**
 * Get available languages
 * @returns {Array}
 */
getAvailableLanguages: () => {
  return getAvailableLanguages();
},
```

## Usage Examples

### Setting Language on Widget Initialization

```javascript
// Auto-detect from browser (default)
const widget = new ChatWidget('your-agent-id', {
  language: 'auto'
});

// Specific language
const widget = new ChatWidget('your-agent-id', {
  language: 'es'  // Spanish
});

// English (explicit)
const widget = new ChatWidget('your-agent-id', {
  language: 'en'
});
```

### Changing Language Dynamically

```javascript
// Via API
await chatvia.setLanguage('fr');  // French

// Check current language
const currentLang = chatvia.getLanguage();
console.log(`Current language: ${currentLang}`);  // 'en', 'fr', 'es', etc.

// Get available languages
const languages = chatvia.getAvailableLanguages();
console.log('Available languages:', languages);
```

## Adding New Languages

1. Create a new JSON file in `/languages/` (e.g., `es.json` for Spanish)
2. Copy the structure from `en.json`
3. Translate all strings
4. Update `getAvailableLanguages()` in `i18n.js` to include the new language

Example `es.json`:
```json
{
  "widget": {
    "open_chat": "Abrir chat",
    "close_chat": "Cerrar chat",
    "send_message": "Enviar mensaje",
    "type_message": "Escribe un mensaje..."
  }
  // ... rest of translations
}
```

## Language Auto-Detection

The system automatically detects the browser language using:
- `navigator.language` (extracts language code, e.g., 'en' from 'en-US')
- `navigator.userLanguage` (IE fallback)
- Falls back to `en` if language file not found

## Notes

- All translation keys use dot notation (e.g., `widget.open_chat`)
- Variables in translations use `{variableName}` format
- Missing translations fall back to the key name (helps identify untranslated strings)
- Language files are loaded asynchronously on widget initialization
- Translations are cached in memory for performance

## Testing

1. Test auto-detection by changing browser language settings
2. Test manual language selection via options
3. Test fallback to English when language file doesn't exist
4. Test dynamic language switching
5. Verify all user-facing strings are translated

