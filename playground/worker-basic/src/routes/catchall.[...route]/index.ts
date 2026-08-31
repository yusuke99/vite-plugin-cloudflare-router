import { defineHandler } from './+types';

export const GET = defineHandler().handle((c) => {
  const params = c.params.route.join('/');
  return Response.json({ message: `Catch-all route: (params=${params})` });
});
