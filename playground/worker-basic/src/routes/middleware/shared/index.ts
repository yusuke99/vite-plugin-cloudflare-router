import { defineMiddleware } from './+types';

export const logger = defineMiddleware().handle((c, next) => {
  console.log(`\n👉 [${c.request.method}] ${c.request.url}`);
  return next();
});

export const cache = defineMiddleware().handle(async (c, next) => {
  const key = new Request(new URL(c.request.url).toString(), c.request);
  const cached = await caches.default.match(key);

  if (cached) {
    console.log('✅ [Cache] HIT');
    return cached;
  }

  console.log('👻 [Cache] MISS');

  const res = await next();
  const response = new Response(res.body, res);
  response.headers.set('cache-control', 'max-age=5');
  c.executionContext.waitUntil(caches.default.put(key, response.clone()));

  return response;
});

export const userAgent = defineMiddleware().handle((c, next) => {
  const userAgent = c.request.headers.get('user-agent');
  return next({ userAgent });
});
