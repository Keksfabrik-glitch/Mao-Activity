import {defineConfig} from 'vite';

const cacheBust = Date.now().toString(36);
const devCacheBustPlugin = {
  name: 'dev-cache-bust',
  apply: 'serve',
  enforce: 'pre',
  transformIndexHtml(html) {
    return html.replace('src="/main.js"', `src="/main.js?v=${cacheBust}"`);
  },
  transform(code, id) {
    if (!/[\\/]client[\\/]main\.js$/.test(id)) return null;
    return code.replace('import "./style.css";', `import "./style.css?v=${cacheBust}";`);
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../',
  plugins: [devCacheBustPlugin],
  server: {
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    allowedHosts: ['mao.andi.org.uk'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
    hmr: {
      clientPort: 443,
    },
  },
});
