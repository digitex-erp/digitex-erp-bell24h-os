import 'dotenv/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// vitest/config's defineConfig is a drop-in superset of vite's own (same
// return shape vite build/dev read; it just also types the `test` field
// below) -- the officially recommended way to add Vitest to an existing
// vite.config.ts without a second, duplicate config file.
import {defineConfig} from 'vitest/config';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_KEY': JSON.stringify(process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
