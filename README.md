<div id="top"></div>

<h1>
  <code>vite-plugin-cloudflare-router</code>
  <div>
    <a href="https://github.com/yusuke99/vite-plugin-cloudflare-router/actions?query=workflow%3ACI"><img src="https://img.shields.io/github/actions/workflow/status/yusuke99/vite-plugin-cloudflare-router/ci.yml" alt="CI status"></a>
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/npm/l/vite-plugin-cloudflare-router" alt="License"></a>
    <a href="https://www.npmjs.com/package/vite-plugin-cloudflare-router"><img src="https://img.shields.io/npm/v/vite-plugin-cloudflare-router" alt="npm version"></a>
  </div>
</h1>

A file-based router for Cloudflare Workers.

## Quickstart

### Install

```
npm install -D vite-plugin-cloudflare-router
```

### Setup

#### `vite.config.ts`

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

#### `tsconfig.json`

```json
{
  "extends": "./.cloudflare-router/tsconfig.json",
}
```

### Usage

Example project structure:

```
.
├── src/
│   ├── routes/
│   │   └── index.ts      -> Route handler
│   └── index.ts          -> Cloudflare Workers entry point
└── package.json
```

#### Cloudflare Workers entry point

```ts
// src/index.ts
import { routes } from 'virtual:cloudflare-router';
import { createRouter } from 'vite-plugin-cloudflare-router/runtime';

const router = createRouter(routes);

export default router;
```

#### Route handler

```ts
// src/routes/index.ts
export const GET = () => {
  return new Response('ok');
};
```

## Routing Conventions

Every route is defined as a folder with an `index.ts` file.

### Basic

```
routes/
├── index.ts               -> /
└── api/
    └── index.ts           -> /api
```

### Nested Routes

A `.` in a folder name becomes a `/` in the URL.

```
routes/
├── index.ts               -> /
├── api/
│   └── index.ts           -> /api
└── api.users/
    └── index.ts           -> /api/users
```

### Dynamic Segments

Wrap a parameter name with `[]` to make a dynamic segment.

```
routes/
├── index.ts               -> /
├── api/
│   └── index.ts           -> /api
├── api.users/
│   └── index.ts           -> /api/users
└── api.users.[id]/
    └── index.ts           -> /api/users/:id
```

### Catch-all

Use `[...]` in a folder name to catch the rest of the path.

```
routes/
├── index.ts               -> /
├── api/
│   └── index.ts           -> /api
├── api.users/
│   └── index.ts           -> /api/users
├── api.users.[id]/
│   └── index.ts           -> /api/users/:id
└── api.docs.[...slug]/
    └── index.ts           -> /api/docs/* (catch-all)
```

### Colocated Modules

Only the `index.ts` file directly under the route folder (e.g. `/api.users.[id]/index.ts`) is a route. Any other file — including files in subfolders — is a colocated module, not a route.

```
routes/
├── index.ts               -> /
├── api/
│   └── index.ts           -> /api
├── api.users/
│   └── index.ts           -> /api/users
├── api.users.[id]/
│   ├── index.ts           -> /api/users/:id
│   └── shared/
│       ├── index.ts       -> colocated module
│       └── schema.ts      -> colocated module
└── api.docs.[...slug]/
    └── index.ts           -> /api/docs/* (catch-all)
```

## Route Handlers

To handle an incoming request, export a function named after the HTTP method.

```ts
export const GET = () => {};

export const POST = () => {};

export const PATCH = () => {};

export const PUT = () => {};

export const DELETE = () => {};
```

A route handler receives one argument with the following properties:

- `request`: The incoming HTTP request.
- `env`: The bindings available to the Worker.
- `executionContext`: The Worker's execution context.
- `params`: Parameters for the route.

```ts
// e.g. GET /api/users/123
export const GET = (c: {
  request: Request;
  env: Env;
  executionContext: ExecutionContext;
  params: { id: string };
}) => {
  return new Response(c.params.id); // '123'
};
```

The example above is a bare-bones route handler, use `defineHandler` instead.

### `defineHandler`

To define a route handler, use `defineHandler()`.

`defineHandler` infers types for you, including dynamic params. `.handle()` takes the same arguments as above.

```ts
import { defineHandler } from './+types';

export const GET = defineHandler()
  .handle((c) => {
    return new Response(c.params.id);
  });
```

Note that the import specifier is `./+types`. This plugin auto-generates types when running a Vite dev server.

## Middleware

Middleware runs before and after the route handler. It allows you to prepare the request and post-process the response.

### `defineMiddleware`

To create a middleware, use `defineMiddleware()`. Call `next()` to continue to the next middleware or route handler.

```ts
import { defineMiddleware } from './+types';

export const middleware = defineMiddleware()
  .handle((_c, next) => {
    return next();
  });
```

To use middleware, use `.use()` method.

```ts
export const GET = defineHandler()
  .use(middleware)
  .handle(() => {
    return new Response('ok');
  });
```

To apply multiple middlewares, chain the `.use()` method.

```ts
export const GET = defineHandler()
  .use(middleware1)
  .use(middleware2)
  .use(middleware3)
  .handle(() => {
    return new Response('ok');
  });
```

`next()` accepts arbitrary data as an argument. This data will be merged onto the handler's context and passed down to the route handler.

```ts
const middleware = defineMiddleware()
  .handle((_c, next) => {
    return next({ message: 'ok' });
  });

export const GET = defineHandler()
  .use(middleware)
  .handle((c) => {
    return new Response(c.message); // 'ok'
  });
```

A middleware must always return a response.

To continue the chain, return `next()`.
To post-process the response, await the response from `next()` and then return it.

```ts
const middleware = defineMiddleware()
  .handle(async (c, next) => {
    // Simply return
    return await next();

    // or
    const response = await next();
    // post-process the response
    // e.g. response.headers.set('x-custom-header', 'hello');
    // and then return the response
    return response;
  });
```

### Execution Order

Middleware runs in the order in which they were registered.

```ts
const middleware1 = defineMiddleware()
  .handle(async (c, next) => {
    console.log('Middleware 1 start');
    const response = await next();
    console.log('Middleware 1 end');
    return response;
  });

const middleware2 = defineMiddleware()
  .handle(async (c, next) => {
    console.log('Middleware 2 start');
    const response = await next();
    console.log('Middleware 2 end');
    return response;
  });

const middleware3 = defineMiddleware()
  .handle(async (c, next) => {
    console.log('Middleware 3 start');
    const response = await next();
    console.log('Middleware 3 end');
    return response;
  });

export const GET = defineHandler()
  .use(middleware1)
  .use(middleware2)
  .use(middleware3)
  .handle((c) => {
    console.log('Handler called');
    return new Response('ok');
  });
```

Output:

```
Middleware 1 start
  Middleware 2 start
    Middleware 3 start
      Handler called
    Middleware 3 end
  Middleware 2 end
Middleware 1 end
```

<br />
<br />

---

[⬆️ Back to top](#top)
