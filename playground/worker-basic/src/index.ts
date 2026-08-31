import { routes } from 'virtual:cloudflare-router';
import { createRouter } from 'vite-plugin-cloudflare-router/runtime';

const router = createRouter(routes);

export default router;
