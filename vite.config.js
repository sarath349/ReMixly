import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiProxyPlugin } from './server/aiProxy.js';
import { reelAudioPlugin } from './server/reelAudio.js';

export default defineConfig({
  plugins: [react(), reelAudioPlugin(), aiProxyPlugin()],
  server: { port: 5190 },
  preview: { port: 5190 },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'es',
  },
});
