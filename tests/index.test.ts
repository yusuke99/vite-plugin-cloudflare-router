import path from 'node:path';
import { vol } from 'memfs';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { patternToSegments, scanRoutes, sortRoutes } from '../src/index.js';

vi.mock('node:fs', async () => {
  const { fs } = await import('memfs');
  return { default: fs };
});

function genRoutesFixture(routes: string[]) {
  const routesDir = '/routes';
  const json: Record<string, string> = {};

  for (const route of routes) {
    const fullPath = path.join(routesDir, route);
    json[fullPath] = 'export const GET = () => new Response("ok");';
  }

  vol.fromJSON(json);
  return routesDir;
}

describe('scanRoutes', () => {
  beforeEach(() => {
    vol.reset();
  });

  test('scans route files', () => {
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/api/index.ts',
      '/api/test/index.ts',
      '/api/test/[id].ts',
      '/api/test/[...catchall].ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    expect(patterns).toStrictEqual([
      '/',
      '/api',
      '/api/test',
      '/api/test/[id]',
      '/api/test/[...catchall]',
    ]);
  });

  test('ignores underscore-prefixed files and directories', () => {
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/api/index.ts',
      '/api/test/index.ts',
      '/api/test/[id].ts',
      '/api/test/[...catchall].ts',
      '/api/_utils.ts',
      '/api/_shared/index.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    expect(patterns).toStrictEqual([
      '/',
      '/api',
      '/api/test',
      '/api/test/[id]',
      '/api/test/[...catchall]',
    ]);
  });

  test('ignores declaration files', () => {
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/api/index.ts',
      '/api/test/index.ts',
      '/api/test/[id].ts',
      '/api/test/[...catchall].ts',
      '/api/types.d.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    expect(patterns).toStrictEqual([
      '/',
      '/api',
      '/api/test',
      '/api/test/[id]',
      '/api/test/[...catchall]',
    ]);
  });

  test('ignores test files', () => {
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/api/index.ts',
      '/api/test/index.ts',
      '/api/test/[id].ts',
      '/api/test/[...catchall].ts',
      '/api/index.test.ts',
      '/api/index.spec.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    expect(patterns).toStrictEqual([
      '/',
      '/api',
      '/api/test',
      '/api/test/[id]',
      '/api/test/[...catchall]',
    ]);
  });

  test('keeps dots in route names', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api/v1.5/index.ts',
      '/test.json.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    // oxfmt-ignore
    expect(patterns).toStrictEqual([
      '/api/v1.5',
      '/test.json',
    ]);
  });

  test('throws on invalid segments', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api/test/[invalid.ts',
    ]);

    expect(() => scanRoutes(routesDir)).toThrow(
      'Invalid route segment "[invalid" in "/api/test/[invalid.ts". ' +
        'Use plain names, [param], or [...catchall].',
    );
  });

  test('throws on duplicate route patterns', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api.ts',
      '/api/index.ts',
    ]);

    expect(() => scanRoutes(routesDir)).toThrow(
      'Duplicate route pattern "/api":\n  - "/api/index.ts"\n  - "/api.ts"',
    );
  });

  test('throws on catch-all segments with children', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api/test/[...catchall]/invalid.ts',
    ]);

    expect(() => scanRoutes(routesDir)).toThrow(
      'Catch-all segment "[...catchall]" must be the last segment in "/api/test/[...catchall]/invalid.ts"',
    );
  });

  test('returns empty array for a missing directory', () => {
    expect(scanRoutes('/non-existent/routes/')).toStrictEqual([]);
  });
});

describe('sortRoutes', () => {
  test('sorts static before param before catch-all', () => {
    const routes = [
      { filePath: '/routes/api/test/[...catchall].ts', pattern: '/api/test/[...catchall]' },
      { filePath: '/routes/api/test.ts', pattern: '/api/test' },
      { filePath: '/routes/api/test/[id].ts', pattern: '/api/test/[id]' },
    ];

    const entries = sortRoutes(routes);
    const patterns = entries.map((route) => route.pattern);

    // oxfmt-ignore
    expect(patterns).toStrictEqual([
      '/api/test',
      '/api/test/[id]',
      '/api/test/[...catchall]',
    ]);
  });
});

describe('patternToSegments', () => {
  test('parses static and param segments', () => {
    expect(patternToSegments('/api/test/[id]')).toStrictEqual([
      { kind: 'static', value: 'api' },
      { kind: 'static', value: 'test' },
      { kind: 'param', name: 'id' },
    ]);
  });

  test('parses catch-all segments', () => {
    expect(patternToSegments('/api/test/[...catchall]')).toStrictEqual([
      { kind: 'static', value: 'api' },
      { kind: 'static', value: 'test' },
      { kind: 'catchall', name: 'catchall' },
    ]);
  });

  test('parses the root as no segments', () => {
    expect(patternToSegments('/')).toEqual([]);
  });

  test('throws on invalid catch-all segments', () => {
    expect(() => patternToSegments('/[...catchall]/invalid')).toThrow(
      'Catch-all segment "[...catchall]" must be the last segment in "/[...catchall]/invalid"',
    );
  });
});
