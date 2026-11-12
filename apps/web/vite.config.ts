import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode demo` produces one self-contained HTML file that runs the
// whole portal in the browser on sample data (no server). The normal build
// talks to the API in apps/api.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', assetsInlineLimit: mode === 'demo' ? 100_000_000 : 4096 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
}));
