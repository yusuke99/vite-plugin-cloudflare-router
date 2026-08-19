# vite-plugin-cloudflare-router

File-based router for Cloudflare Workers.

```
worker/
├── api/
│   ├── index.ts        -> /api
│   ├── auth/
│   │   └── index.ts    -> /api/auth
│   └── users/
│       └── [id].ts     -> /api/users/:id
└── docs/
    └── [...slug].ts    -> /docs/* (catch-all)
```

## Setup

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import cloudflareRouter from 'vite-plugin-cloudflare-router';

export default defineConfig({
  plugins: [
    cloudflare(),
    cloudflareRouter(),
  ],
});
```

### `worker/index.ts`

```ts
// Your worker entry point
import { routes } from 'virtual:cloudflare-router';
import { createRouter } from 'vite-plugin-cloudflare-router/runtime';

const router = createRouter<Env>(routes);

export default {
  fetch: (request, env, ctx) => router.handle(request, env, ctx),
} satisfies ExportedHandler<Env>;
```

## Usage

### Route handler

```ts
// e.g. `worker/api/index.ts`
import { json } from 'vite-plugin-cloudflare-router/runtime';

export const GET = () => {
  return json({ message: 'ok' });
};
```
