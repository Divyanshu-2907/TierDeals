import react from '@vitejs/plugin-react';
import type { HmrOptions, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Under `shopify app dev` the CLI runs this dev server behind its HTTPS
 * proxy and injects:
 *   - FRONTEND_PORT: the port to listen on (the proxy forwards to it);
 *   - BACKEND_PORT:  the Express server, which /api is forwarded to;
 *   - APP_URL:       the public URL the admin loads the app from;
 *   - SHOPIFY_API_KEY, for App Bridge.
 * The defaults let `npm run dev` work on its own too.
 */
const frontendPort = Number(process.env.FRONTEND_PORT ?? process.env.PORT ?? 5173);
const backendPort = Number(process.env.BACKEND_PORT ?? 3000);
const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : undefined;

/**
 * Hot reload goes through the CLI proxy too, so the browser must connect to
 * the public URL's host and port (443 for a tunnel, or the localhost proxy
 * port with --use-localhost), not to Vite's own port.
 */
const hmr: HmrOptions | undefined = appUrl && {
  protocol: appUrl.protocol === 'https:' ? 'wss' : 'ws',
  host: appUrl.hostname,
  clientPort: Number(appUrl.port || (appUrl.protocol === 'https:' ? 443 : 80)),
};

const APP_BRIDGE_TAGS =
  /\s*<meta name="shopify-api-key"[^>]*>\s*<!--[^>]*-->\s*<script src="https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js"><\/script>/;

/**
 * Dev-only index.html fixes: fills in the API key, and moves App Bridge's
 * tags back to the top of <head>. App Bridge must be the first script on the
 * page, but the React plugin prepends its hot-reload preamble in dev.
 */
function appBridgeDevHtml(): Plugin {
  return {
    name: 'tierdeals:app-bridge-dev-html',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const withKey = html.replace('%SHOPIFY_API_KEY%', process.env.SHOPIFY_API_KEY ?? '');
        const tags = APP_BRIDGE_TAGS.exec(withKey)?.[0];
        if (tags === undefined) return withKey;
        return withKey.replace(tags, '').replace('<head>', `<head>${tags}`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), appBridgeDevHtml()],
  server: {
    port: frontendPort,
    strictPort: true,
    // Requests arrive through the CLI proxy with the public host name.
    allowedHosts: appUrl ? [appUrl.hostname] : [],
    ...(hmr ? { hmr } : {}),
    proxy: {
      '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
  },
});
