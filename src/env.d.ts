// Ambient declarations for the widget source.

// Build-time constants, replaced by Rollup (rollup.config.ts) and Vite
// (vite.config.ts). Undefined when the source runs un-bundled (the tests), so
// read them behind a `typeof` guard.
declare const __APP_VERSION__: string;
declare const __API_URL__: string;
declare const __SCRIPT_URL__: string;
declare const __DEV__: boolean;
declare const __REVERB_APP_KEY__: string;
declare const __REVERB_HOST__: string;
declare const __REVERB_PORT__: string;
declare const __REVERB_SCHEME__: string;

// Stylesheets imported for their side effect; the bundler injects them.
declare module '*.css';

interface Window {
  /** The embed snippet's command queue, replaced by the public API once the widget starts. */
  chatvia?: import('./types').ChatviaStub | import('./types').ChatviaApi;
  /** Parsed icon SVGs, shared by every widget on the page (see ui.ts). */
  __chatIconCache?: Record<string, Node>;
}

interface Navigator {
  /** Internet Explorer's name for `navigator.language`. */
  readonly userLanguage?: string;
}
