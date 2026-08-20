import type { DefineHandler } from '../src/runtime.js';
import { describe, expectTypeOf, test } from 'vite-plus/test';
import { defineHandler as _defineHandler, json } from '../src/runtime.js';

describe('defineHandler', () => {
  test('infers params', () => {
    const defineHandler = _defineHandler as DefineHandler<{ message: string }>;
    const GET = defineHandler(({ params }) => json({ message: params.message }));

    type Payload = Awaited<ReturnType<ReturnType<typeof GET>['json']>>;
    expectTypeOf<Payload>().toEqualTypeOf<{ message: string }>();
  });

  test('inters catch-all params', () => {
    const defineHandler = _defineHandler as DefineHandler<{ catchall: string[] }>;
    const GET = defineHandler(({ params }) => json({ message: params.catchall.join(',') }));

    type Payload = Awaited<ReturnType<ReturnType<typeof GET>['json']>>;
    expectTypeOf<Payload>().toEqualTypeOf<{ message: string }>();
  });
});
