import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import strip from '@rollup/plugin-strip';
import { visualizer } from 'rollup-plugin-visualizer';
import gzipPlugin from 'rollup-plugin-gzip';
import postcss from 'rollup-plugin-postcss';
import { brotliCompressSync } from 'zlib';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const appVersion = process.env.VITE_APP_VERSION || '1.0.0';

const sharedEnv = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  __APP_VERSION__: JSON.stringify(appVersion),
  __API_URL__: JSON.stringify(process.env.VITE_API_URL),
  __SCRIPT_URL__: JSON.stringify(process.env.VITE_SCRIPT_URL || 'https://chatvia.test/agents/1/widget'),
  __SSE_URL__: JSON.stringify(process.env.VITE_SSE_URL || 'http://localhost:8080/events'),
  __SSE_RECONNECT_DELAY__: JSON.stringify(process.env.VITE_SSE_RECONNECT_DELAY || 1000),
  __SSE_MAX_RECONNECT_ATTEMPTS__: JSON.stringify(
    process.env.VITE_SSE_MAX_RECONNECT_ATTEMPTS || 5
  ),
  __DEV__: JSON.stringify(!isProduction)
};

const commonPlugins = [
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
  terser({
    format: {
      comments: false
    },
    compress: {
      drop_console: false,
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
      }),
    !isProduction &&
      visualizer({
        filename: 'bundle-analysis.html',
        open: false
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
    isProduction && gzipPlugin({ fileName: '.gz' }),
    isProduction &&
      gzipPlugin({
        fileName: '.br',
        customCompression: content => brotliCompressSync(Buffer.from(content)),
        additionalFiles: []
      })
  ]
};

export default [mainBundleConfig, embedScriptConfig];
