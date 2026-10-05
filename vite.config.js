import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiProxyPlugin } from './server/aiProxy.js';
import { reelAudioPlugin } from './server/reelAudio.js';

export default defineConfig(({ mode }) => {
  // Server-side only: AI_* vars from .env stay out of the browser bundle (no VITE_ prefix).
  Object.assign(process.env, { ...loadEnv(mode, process.cwd(), 'AI_'), ...process.env });

  return {
    plugins: [react(), reelAudioPlugin(), aiProxyPlugin()],
    server: { port: 5190 },
    preview: { port: 5190, allowedHosts: true },
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    worker: {
      format: 'es',
    },
  };
});
