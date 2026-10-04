import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/Refund-Right/' : '/',
  envDir: mode === 'pages' ? false : undefined,
  plugins: mode === 'pages' ? [{ name: 'pages-entry', transformIndexHtml: { order: 'pre', handler: (html: string) => html.replace('/src/main.tsx', '/src/pages.tsx') } }] : [],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4331' } },
  build: { outDir: mode === 'pages' ? 'dist-pages' : 'dist', emptyOutDir: true, sourcemap: false },
}));
