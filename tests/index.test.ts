import path from 'node:path';
import { vol } from 'memfs';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  patternToSegments,
  resolveHandlerTypesImport,
  scanRoutes,
  sortRoutes,
} from '../src/index.js';

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

  test('scans route directories', () => {
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/api/index.ts',
      '/api.test/index.ts',
      '/api.test.[id]/index.ts',
      '/api.test.[...catchall]/index.ts',
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

  test('ignores underscore-prefixed directories', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/api/index.ts',
      '/_shared/index.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    // oxfmt-ignore
    expect(patterns).toStrictEqual([
      '/',
      '/api',
    ]);
  });

  test('ignores non-index files', () => {
    const routesDir = genRoutesFixture([
      '/index.ts',
      '/utils.ts',
      '/api/index.ts',
      '/api/utils.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    // oxfmt-ignore
    expect(patterns).toStrictEqual([
      '/',
      '/api',
    ]);
  });

  test('ignores subdirectories', () => {
    const routesDir = genRoutesFixture([
      '/api.test/index.ts',
      '/api.test/shared/schema.ts',
      '/api.test/shared/utils.ts',
    ]);

    const routes = scanRoutes(routesDir);
    const patterns = routes.map((route) => route.pattern);

    // oxfmt-ignore
    expect(patterns).toStrictEqual([
      '/api/test',
    ]);
  });

  test('escapes literal dots with [.]', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api.v1[.]5/index.ts',
      '/test[.]json/index.ts',
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
      '/api.test.[id/index.ts',
    ]);

    expect(() => scanRoutes(routesDir)).toThrow(
      'Invalid route segment "[id" in "/api.test.[id/index.ts". ' +
        'Use plain names, [param], or [...catchall].',
    );
  });

  test('throws on catch-all segments with children', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api.test.[...catchall].invalid/index.ts',
    ]);

    expect(() => scanRoutes(routesDir)).toThrow(
      'Catch-all segment "[...catchall]" must be the last segment in "/api.test.[...catchall].invalid/index.ts"',
    );
  });

  test('throws on no index file', () => {
    // oxfmt-ignore
    const routesDir = genRoutesFixture([
      '/api/utils.ts',
    ]);

    expect(() => scanRoutes(routesDir)).toThrow('No index file found in "/routes/api"');
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

describe('resolveHandlerTypesImport', () => {
  const rootDir = '/my-app';

  beforeEach(() => {
    vol.reset();
  });

  test('maps ./+types/[params]', () => {
    const typesPath = path.join(
      rootDir,
      '.cloudflare-router',
      'types',
      'src',
      'routes',
      'api',
      'test',
      '+types',
      '[params].ts',
    );
    vol.fromJSON({
      [typesPath]: '',
    });

    const id = './+types/[params]';
    const importer = path.join(rootDir, './src/routes/api/test/[params].ts');
    const resolvedPath = resolveHandlerTypesImport(rootDir, id, importer);

    expect(resolvedPath).toBe(typesPath);
  });

  test('maps ./+types/[...catchall]', () => {
    const typesPath = path.join(
      rootDir,
      '.cloudflare-router',
      'types',
      'src',
      'routes',
      'api',
      'test',
      '+types',
      '[...catchall].ts',
    );
    vol.fromJSON({
      [typesPath]: '',
    });

    const id = './+types/[...catchall]';
    const importer = path.join(rootDir, './src/routes/api/test/[...catchall].ts');
    const resolvedPath = resolveHandlerTypesImport(rootDir, id, importer);

    expect(resolvedPath).toBe(typesPath);
  });

  test('maps ./+types to +types/index.ts', () => {
    const typesPath = path.join(
      rootDir,
      '.cloudflare-router',
      'types',
      'src',
      'routes',
      'api',
      '+types',
      'index.ts',
    );
    vol.fromJSON({
      [typesPath]: '',
    });

    const id = './+types';
    const importer = path.join(rootDir, './src/routes/api/index.ts');
    const resolvedPath = resolveHandlerTypesImport(rootDir, id, importer);

    expect(resolvedPath).toBe(typesPath);
  });
});
