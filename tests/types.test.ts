import type { DefineHandler, DefineMiddleware } from '../src/runtime.js';
import { describe, expectTypeOf, test } from 'vite-plus/test';
import {
  defineHandler as $defineHandler,
  defineMiddleware as $defineMiddleware,
  json,
} from '../src/runtime.js';

describe('DefineHandler', () => {
  test('infers params', () => {
    const defineHandler: DefineHandler<{ message: string }> = $defineHandler;
    const GET = defineHandler().handle((c) => json({ message: c.params.message }));

    type Payload = Awaited<ReturnType<ReturnType<typeof GET>['json']>>;
    expectTypeOf<Payload>().toEqualTypeOf<{ message: string }>();
  });

  test('infers catch-all params', () => {
    const defineHandler: DefineHandler<{ catchall: string[] }> = $defineHandler;
    const GET = defineHandler().handle((c) => json({ message: c.params.catchall.join(',') }));

    type Payload = Awaited<ReturnType<ReturnType<typeof GET>['json']>>;
    expectTypeOf<Payload>().toEqualTypeOf<{ message: string }>();
  });
});

describe('DefineMiddleware', () => {
  test('infers extended context by .use()', () => {
    const defineHandler: DefineHandler<{ id: string }> = $defineHandler;
    const defineMiddleware: DefineMiddleware<{ id: string }> = $defineMiddleware;

    const mw1 = defineMiddleware().handle((_, next) => next({ mw1: true }));
    const mw2 = defineMiddleware().handle((_, next) => next({ mw2: true }));

    const GET = defineHandler()
      .use(mw1)
      .use(mw2)
      .handle(({ params, mw1, mw2 }) => {
        expectTypeOf(mw1).toEqualTypeOf<boolean>();
        expectTypeOf(mw2).toEqualTypeOf<boolean>();
        return json({ id: params.id, mw1, mw2 });
      });

    type Payload = Awaited<ReturnType<ReturnType<typeof GET>['json']>>;
    expectTypeOf<Payload>().toEqualTypeOf<{ id: string; mw1: boolean; mw2: boolean }>();
  });
});
