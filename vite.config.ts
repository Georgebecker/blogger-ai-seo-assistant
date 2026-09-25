import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

// O manifest.json é a fonte da verdade da extensão.
// O plugin @crxjs/vite-plugin injeta os caminhos compilados no manifest do dist/.
export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
