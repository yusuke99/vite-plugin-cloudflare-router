import { defineHandler } from './+types';

export const GET = defineHandler().handle((c) => {
  return Response.json({ message: `Dynamic route (params=${c.params.route})` });
});
