import { defineHandler } from './+types';
import { cache, logger, userAgent } from './shared';

export const GET = defineHandler()
  .use(logger)
  .use(cache)
  .use(userAgent)
  .handle((c) => {
    return Response.json({
      message: 'Middleware route',
      userAgent: c.userAgent,
    });
  });
