import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import strip from '@rollup/plugin-strip';
import json from '@rollup/plugin-json';
import { visualizer } from 'rollup-plugin-visualizer';
import gzipPlugin from 'rollup-plugin-gzip';
import postcss from 'rollup-plugin-postcss';
import postcssImport from 'postcss-import';
import { brotliCompressSync } from 'zlib';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const appVersion = process.env.VITE_APP_VERSION;

// Use VITE_API_URL directly
const apiUrl = process.env.VITE_API_URL;
const scriptUrl = process.env.VITE_SCRIPT_URL;

// Pusher/Reverb configuration for handoff feature
// Dev fallbacks for local development with Laravel Herd
const reverbAppKey = process.env.VITE_REVERB_APP_KEY || (isProduction ? '' : 'laravel-herd');
const reverbHost = process.env.VITE_REVERB_HOST || (isProduction ? '' : 'reverb.herd.test');
const reverbPort = process.env.VITE_REVERB_PORT || '443';
const reverbScheme = process.env.VITE_REVERB_SCHEME || 'https';

// Warn if critical env vars are missing
if (!scriptUrl) {
  console.warn('⚠️  VITE_SCRIPT_URL is not set! The embed script will not work correctly.');
}
if (!apiUrl) {
  console.warn('⚠️  VITE_API_URL is not set! API calls will fail.');
}

const sharedEnv = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  __APP_VERSION__: JSON.stringify(appVersion),
  __API_URL__: JSON.stringify(apiUrl),
  __SCRIPT_URL__: JSON.stringify(scriptUrl),
  __DEV__: JSON.stringify(!isProduction),
  // Pusher/Reverb config for handoff
  __REVERB_APP_KEY__: JSON.stringify(reverbAppKey),
  __REVERB_HOST__: JSON.stringify(reverbHost),
  __REVERB_PORT__: JSON.stringify(reverbPort),
  __REVERB_SCHEME__: JSON.stringify(reverbScheme)
};

// Custom plugin to generate version.json
function generateVersionFile() {
  return {
    name: 'generate-version-file',
    generateBundle() {
      // Create version.json content
      const versionContent = JSON.stringify({ version: appVersion });

      // Emit the version.json file
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: versionContent
      });
    }
  };
}

const commonPlugins = [
  json(), // Add JSON plugin to handle .json imports
  nodeResolve({ browser: true, preferBuiltins: false }),
  commonjs(),
  replace({ ...sharedEnv, preventAssignment: true }),
  isProduction &&
    strip({
      include: ['**/*.js'],
      functions: [
        'console.log',
        'console.debug',
        'console.info',
        'console.warn',
        'console.error',
        'assert.*'
      ],
      debugger: true
    }),
  isProduction &&
    terser({
      format: {
        comments: false
      },
      compress: {
        drop_console: true,
        pure_getters: true,
        unsafe: true,
        unsafe_comps: true,
        passes: 2
      }
    })
];

const mainBundleConfig = {
  input: 'src/main.js',
  output: {
    dir: `dist/${appVersion}`,
    format: 'es',
    sourcemap: false,
    compact: true,
    entryFileNames: 'widget.min.js',
    chunkFileNames: '[name]-[hash].js'
  },
  plugins: [
    postcss({
      plugins: [postcssImport()],
      minimize: true,
      extract: false,
      inject: true,
      modules: false
    }),
    ...commonPlugins,
    generateVersionFile(), // Generate version.json
    isProduction && gzipPlugin({ fileName: '.gz' }),
    isProduction &&
      gzipPlugin({
        fileName: '.br',
        customCompression: content => brotliCompressSync(Buffer.from(content)),
        additionalFiles: []
      }),
    !isProduction &&
      visualizer({
        filename: 'bundle-analysis.html',
        open: false
      })
  ].filter(Boolean)
};

const searchBundleConfig = {
  input: 'src/search.js',
  output: {
    dir: `dist/${appVersion}`,
    format: 'es',
    sourcemap: false,
    compact: true,
    entryFileNames: 'search.min.js',
    chunkFileNames: '[name]-[hash].js'
  },
  plugins: [
    postcss({
      plugins: [postcssImport()],
      minimize: true,
      extract: false,
      inject: true,
      modules: false
    }),
    ...commonPlugins,
    isProduction && gzipPlugin({ fileName: '.gz' }),
    isProduction &&
      gzipPlugin({
        fileName: '.br',
        customCompression: content => brotliCompressSync(Buffer.from(content)),
        additionalFiles: []
      })
  ].filter(Boolean)
};

const embedScriptConfig = {
  input: 'src/embed.js',
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: false,
    compact: true,
    entryFileNames: 'embed.js',
    chunkFileNames: '[name]-[hash].js'
  },
  plugins: [
    ...commonPlugins,
    generateVersionFile(), // Generate version.json for embed script too
    isProduction && gzipPlugin({ fileName: '.gz' }),
    isProduction &&
      gzipPlugin({
        fileName: '.br',
        customCompression: content => brotliCompressSync(Buffer.from(content)),
        additionalFiles: []
      })
  ].filter(Boolean)
};

export default [mainBundleConfig, searchBundleConfig, embedScriptConfig];
