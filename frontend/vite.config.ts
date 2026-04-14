import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_PROXY_API || 'http://127.0.0.1:8000';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
        },
      },
      hmr:
        process.env.DISABLE_HMR === 'true'
          ? false
          : {
              path: '/__vite_hmr',
            },
    },
    build: {
      // Production build: console.* larni butunlay o'chirish (minifier darajasida)
      minify: 'terser',
      terserOptions: isProd
        ? {
            compress: {
              drop_console: false,
              drop_debugger: true,
              // console.error saqlanadi (prod monitoring / ErrorBoundary)
              pure_funcs: ['console.log', 'console.info', 'console.warn', 'console.debug'],
            },
          }
        : undefined,
    },
  };
});
