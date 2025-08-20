import { defineConfig, loadEnv } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';
import strip from '@rollup/plugin-strip';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const isProduction = mode === 'production';

  return {
    server: {
      open: '/index.html',
      port: 3000,
      host: true,
      allowedHosts: true,
      watch: {
        usePolling: true,
        ignored: ['node_modules/**', 'dist/**']
      }
    },
    build: {
      emptyOutDir: true,
      outDir: 'dist',
      rollupOptions: {
        input: {
          widget: 'src/main.js',
          embed: 'src/embed.js'
        },
        output: [
          {
            entryFileNames: `${env.VITE_APP_VERSION}/widget.min.js`,
            format: 'iife',
            sourcemap: false,
            compact: true,
            name: 'ChatWidgetBundle'
          },
          {
            entryFileNames: 'embed.js',
            format: 'iife',
            sourcemap: false,
            compact: true,
            name: 'ChatWidgetEmbed'
          }
        ],
        plugins: [
          isProduction &&
            strip({
              include: ['**/*.js'],
              functions: ['console.*'],
              debugger: true
            })
        ]
      },
      minify: 'terser'
    },
    plugins: [createHtmlPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION),
      __API_URL__: JSON.stringify(
        env.VITE_API_URL?.endsWith('/') ? env.VITE_API_URL.slice(0, -1) : env.VITE_API_URL || ''
      ),
      __SCRIPT_URL__: JSON.stringify(env.VITE_SCRIPT_URL),
            __SSE_URL__: JSON.stringify(env.VITE_SSE_URL || 'http://localhost:8080/events'),
      __SSE_MAX_RECONNECT_ATTEMPTS__: JSON.stringify(
        env.VITE_SSE_MAX_RECONNECT_ATTEMPTS || 5
      ),
      __SSE_RECONNECT_DELAY__: JSON.stringify(env.VITE_SSE_RECONNECT_DELAY || 1000)
    }
  };
});
