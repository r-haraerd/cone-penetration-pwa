import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// base: './' にしておくと GitHub Pages のサブパス（/geo-tools/ 等）でもそのまま動く。
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    VitePWA({
      // 新しいバージョンは利用者が「更新」を押したときだけ反映する（測定中に勝手に再読み込みしない）
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: '簡易動的コーン貫入試験 現場入力',
        short_name: '簡易貫入',
        description: '簡易動的コーン貫入試験の打撃回数・貫入量を現場で記録するアプリ（オフライン対応）',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f2f4f7',
        theme_color: '#0b3d91',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体を丸ごと事前キャッシュし、圏外でも起動できるようにする
        globPatterns: ['**/*.{html,js,css,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
