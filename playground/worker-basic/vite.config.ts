import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import cloudflareRouter from 'vite-plugin-cloudflare-router';

export default defineConfig({
  plugins: [cloudflare(), cloudflareRouter()],
});
