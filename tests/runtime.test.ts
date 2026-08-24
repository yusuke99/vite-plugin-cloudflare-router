import type { ExecutionContext, HttpMethod, RouteDefinition } from '../src/runtime.js';
import { describe, expect, test } from 'vite-plus/test';
import { createRouter, defineHandler, defineMiddleware, json } from '../src/runtime.js';

const ctx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

const routes: RouteDefinition[] = [
  {
    pattern: '/',
    segments: [],
    module: {
      ALL: () => json({ message: 'ALL /' }),
    },
  },
  {
    pattern: '/api/test',
    segments: [
      { kind: 'static', value: 'api' },
      { kind: 'static', value: 'test' },
    ],
    module: {
      GET: () => json({ message: 'GET /api/test' }),
    },
  },
  {
    pattern: '/api/test/[id]',
    segments: [
      { kind: 'static', value: 'api' },
      { kind: 'static', value: 'test' },
      { kind: 'param', name: 'id' },
    ],
    module: {
      GET: ({ params }) => json({ message: 'GET /api/test/[id]', params }),
      PATCH: ({ params }) => json({ message: 'PATCH /api/test/[id]', params }),
      PUT: ({ params }) => json({ message: 'PUT /api/test/[id]', params }),
      DELETE: ({ params }) => json({ message: 'DELETE /api/test/[id]', params }),
    },
  },
  {
    pattern: '/api/catchall/[...catchall]',
    segments: [
      { kind: 'static', value: 'api' },
      { kind: 'static', value: 'catchall' },
      { kind: 'catchall', name: 'catchall' },
    ],
    module: {
      GET: ({ params }) => json({ message: 'GET /api/catchall/[...catchall]', params }),
    },
  },
];

async function request(method: HttpMethod, path: string, env: Cloudflare.Env = {}) {
  const router = createRouter(routes);
  return router.handle(new Request(`https://example.com${path}`, { method }), env, ctx);
}

describe('createRouter', () => {
  test('routes by path and method', async () => {
    const res = await request('GET', '/api/test');
    const body = await res.json();

    expect(body).toStrictEqual({ message: 'GET /api/test' });
  });

  test('collects catch-all params', async () => {
    const res = await request('GET', '/api/catchall/foo/bar/baz');
    const body = await res.json();

    expect(body).toStrictEqual({
      message: 'GET /api/catchall/[...catchall]',
      params: { catchall: ['foo', 'bar', 'baz'] },
    });
  });

  test('requires at least one segment for catch-all routes', async () => {
    const res = await request('GET', '/api/catchall');
    expect(res.status).toBe(404);
  });

  test('matches any route with the ALL handler', async () => {
    const res = await request('GET', '/');
    const body = await res.json();

    expect(body).toStrictEqual({ message: 'ALL /' });
  });

  test('returns 405 with Allow for unsupported methods', async () => {
    const res = await request('POST', '/api/test/123');

    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, PATCH, PUT, DELETE, HEAD');
  });

  test('serves HEAD method with GET', async () => {
    const router = createRouter(routes);
    const res = await router.handle(
      new Request('https://example.com/api/test', { method: 'HEAD' }),
      {},
      ctx,
    );

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  test('ignores trailing slashes', async () => {
    const res = await request('GET', '/api/test/');
    const body = await res.json();

    expect(body).toStrictEqual({ message: 'GET /api/test' });
  });

  test('decodes params', async () => {
    const res = await request('GET', '/api/test/a%20b%20c');
    const body = await res.json();

    expect(body).toStrictEqual({
      message: 'GET /api/test/[id]',
      params: { id: 'a b c' },
    });
  });

  test('fallback to ASSETS binding when no route matches', async () => {
    const response = new Response('fallback');
    const env = { ASSETS: { fetch: async () => response } };
    const res = await request('GET', '/missing', env);

    expect(res).toBe(response);
  });

  test('fallback to 404 response without ASSETS binding', async () => {
    const res = await request('GET', '/missing');
    expect(res.status).toBe(404);
  });

  test('supports a custom fallback', async () => {
    const response = new Response('teapot', { status: 418 });
    const router = createRouter(routes, { fallback: () => response });
    const res = await router.handle(new Request('https://example.com/missing'), {}, ctx);

    expect(res).toBe(response);
  });
});

describe('defineMiddleware', () => {
  function dispatch(handler: (context: any) => Response | Promise<Response>) {
    return handler({
      request: new Request('https://example.com/'),
      env: {},
      ctx,
      params: {},
    });
  }

  test('guarantees order', async () => {
    const order: number[] = [];

    const mw1 = defineMiddleware().handle((_, next) => {
      order.push(1);
      return next();
    });
    const mw2 = defineMiddleware().handle((_, next) => {
      order.push(2);
      return next();
    });
    const handler = defineHandler()
      .use(mw1)
      .use(mw2)
      .handle(() => {
        order.push(3);
        return json({});
      });

    await dispatch(handler);

    expect(order).toStrictEqual([1, 2, 3]);
  });

  test('merges context', async () => {
    const mw1 = defineMiddleware().handle((_, next) => {
      return next({ mw1: true });
    });
    const mw2 = defineMiddleware().handle((_, next) => {
      return next({ mw2: true });
    });
    const handler = defineHandler()
      .use(mw1)
      .use(mw2)
      .handle((c) => {
        return json({ mw1: c.mw1, mw2: c.mw2 });
      });

    const res = await dispatch(handler);
    const response = await res.json();

    expect(response).toStrictEqual({ mw1: true, mw2: true });
  });

  test('early returns', async () => {
    let handled = false;

    const mw = defineMiddleware().handle(() => {
      return json({});
    });
    const handler = defineHandler()
      .use(mw)
      .handle(() => {
        handled = true;
        return json({});
      });

    await dispatch(handler);

    expect(handled).toBe(false);
  });

  test('throws when next() is not called or Response is not returned', async () => {
    // @ts-expect-error
    const mw = defineMiddleware().handle(() => {});
    const handler = defineHandler()
      .use(mw)
      .handle(() => json({}));

    await expect(dispatch(handler)).rejects.toThrow(
      'Middleware must call next() or return a Response',
    );
  });

  test('throws when next() is called multiple times', async () => {
    const mw = defineMiddleware().handle(async (_, next) => {
      await next();
      return await next();
    });
    const handler = defineHandler()
      .use(mw)
      .handle(() => json({}));

    await expect(dispatch(handler)).rejects.toThrow('next() called multiple times');
  });
});
