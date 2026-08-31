import { defineHandler } from './+types';

export const GET = defineHandler().handle(() => {
  return Response.json({
    message: 'Static route',
    routes: ['/', '/dynamic/:route', '/catchall/*', '/middleware', '/nested/route'],
  });
});
