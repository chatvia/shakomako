import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

// Flat config (ESLint 9+/10), loaded through jiti as TypeScript:
// - js.configs.recommended        -> ESLint's recommended rules
// - tseslint.configs.recommended  -> typescript-eslint's parser and recommended rules
// - eslintPluginPrettierRecommended must be LAST so eslint-config-prettier
//   disables formatting rules that would fight Prettier
// `semi` and `quotes` are intentionally omitted — Prettier owns formatting.
export default defineConfig(
  globalIgnores(['dist/**', 'node_modules/**']),

  js.configs.recommended,
  tseslint.configs.recommended,

  // Source: browser + node globals, ESM, latest syntax.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },

  // Tests import describe/it/expect explicitly from 'vitest', so no test globals
  // are needed; console is unrestricted in tests.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-console': 'off'
    }
  },

  // Prettier — keep last.
  eslintPluginPrettierRecommended
);
