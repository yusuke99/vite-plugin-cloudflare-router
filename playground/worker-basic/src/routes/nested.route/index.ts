import { defineHandler } from './+types';

export const GET = defineHandler().handle(() => {
  return Response.json({ message: 'Nested route' });
});
