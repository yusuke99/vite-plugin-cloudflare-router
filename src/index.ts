import type { Segment } from './runtime.js';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { exactRegex } from '@rolldown/pluginutils';
import {
  TYPES_ROOT_DIR,
  generateHandlerRuntime,
  generateVirtualRoutesModule,
  writeGeneratedTypes,
} from './codegen.js';

const PLUGIN_NAME = 'vite-plugin-cloudflare-router';
const VIRTUAL_ROUTES_MODULE_ID = 'virtual:cloudflare-router';
const RESOLVED_VIRTUAL_ROUTES_MODULE_ID = '\0' + VIRTUAL_ROUTES_MODULE_ID;
const VIRTUAL_HANDLER_MODULE_ID = 'virtual:cloudflare-router/+types';
const RESOLVED_VIRTUAL_HANDLER_MODULE_ID = '\0' + VIRTUAL_HANDLER_MODULE_ID;
const HANDLER_IMPORT_RE = /^\.\/\+types(?:\/|$)/;

interface PluginConfig {
  /**
   * Directory containing route files.
   *
   * @default './src/routes'
   *
   * @example
   * ```
   * import { defineConfig } from 'vite';
   * import { cloudflareRouter } from 'vite-plugin-cloudflare-router';
   *
   * export default defineConfig({
   *   plugins: [
   *     cloudflareRouter(),
   *   ],
   * });
   * ```
   */
  routesDir?: string;
}

export default function cloudflareRouter(pluginConfig: PluginConfig = {}): Plugin {
  let rootDir = '';
  let routesDir = '';

  function syncGeneratedTypes() {
    const routes = scanRoutes(routesDir);
    writeGeneratedTypes(rootDir, routes);
  }

  return {
    name: PLUGIN_NAME,

    config() {
      return {
        server: {
          watch: {
            ignored: [`**/${TYPES_ROOT_DIR}/**`],
          },
        },
      };
    },

    configResolved(config) {
      rootDir = config.root;
      routesDir = path.resolve(rootDir, pluginConfig.routesDir ?? './src/routes');
      syncGeneratedTypes();
    },

    resolveId: {
      filter: {
        id: [exactRegex(VIRTUAL_ROUTES_MODULE_ID), HANDLER_IMPORT_RE],
      },
      handler(id) {
        if (id === VIRTUAL_ROUTES_MODULE_ID) {
          return RESOLVED_VIRTUAL_ROUTES_MODULE_ID;
        }
        return resolveHandlerImport(id);
      },
    },

    load: {
      filter: {
        id: [
          exactRegex(RESOLVED_VIRTUAL_ROUTES_MODULE_ID),
          exactRegex(RESOLVED_VIRTUAL_HANDLER_MODULE_ID),
        ],
      },
      handler(id) {
        if (id === RESOLVED_VIRTUAL_HANDLER_MODULE_ID) {
          return generateHandlerRuntime();
        }
        this.addWatchFile(routesDir);
        const routes = scanRoutes(routesDir);
        return generateVirtualRoutesModule(routes);
      },
    },

    hotUpdate({ type, file, modules }) {
      if (type === 'update' || !isFileInsideOf(file, routesDir)) {
        return;
      }
      syncGeneratedTypes();
      const virtualModule = this.environment.moduleGraph.getModuleById(
        RESOLVED_VIRTUAL_ROUTES_MODULE_ID,
      );
      return virtualModule ? [...modules, virtualModule] : undefined;
    },
  };
}

export interface Routes {
  /**
   * Absolute path to route file.
   *
   * @example
   * ```
   * {
   *   filePath: '/my-project/worker/routes/api.example/index.ts',
   *   pattern: '/api/example',
   * }
   * ```
   */
  filePath: string;

  /**
   * Route pattern to handle incoming requests.
   *
   * @example
   * ```
   * /api/example
   * /api/example/[id]
   * /api/example/[...catchall]
   * ```
   */
  pattern: string;
}

/**
 * Scans plugin options' `routesDir` and returns routes sorted by
 * match priority (static before param before catch-all).
 * Scanned routes are consumed by `createRouter` to handle routes.
 *
 * Directories starting with `_` are ignored. Every route should have
 * an `index` file for route handlers. Any file other than an `index` file or
 * a subdirectory is ignored.
 *
 * @param {string} routesDir - Absolute path to the directory to scan for route files.
 * @returns {Routes[]} A list of routes sorted by match priority.
 *
 * @example
 * ```ts
 * const routes = scanRoutes('/my-project/worker/routes');
 * // [
 * //   { filePath: '/my-project/worker/routes/api.example/index.ts', pattern: '/api/example' },
 * //   { filePath: '/my-project/worker/routes/api.example.[id]/index.ts', pattern: '/api/example/[id]' },
 * // ]
 * ```
 */
export function scanRoutes(routesDir: string): Routes[] {
  if (!fs.existsSync(routesDir)) {
    return [];
  }

  const filePaths = walk(routesDir);
  const rawRoutes = filePaths.map((filePath) => {
    const relativeFilePath = path.relative(routesDir, filePath);
    const pattern = filePathToPattern(relativeFilePath);
    return {
      filePath,
      pattern,
    };
  });

  assertNoDuplicateRoutePattern(rawRoutes);

  return sortRoutes(rawRoutes);
}

/**
 * Returns routes sorted by match priority: static before param before catch-all.
 *
 * @param {Routes[]} routes - A list of routes to sort.
 * @returns {Routes[]} A list of routes sorted by match priority.
 *
 * @example
 * ```ts
 * const routes = sortRoutes([
 *   { filePath: '/my-project/worker/routes/api.example/index.ts', pattern: '/api/example' },
 *   { filePath: '/my-project/worker/routes/api.example.[id]/index.ts', pattern: '/api/example/[id]' },
 * ]);
 */
export function sortRoutes(routes: Routes[]) {
  return routes.toSorted((a, b) => {
    const segA = patternToSegments(a.pattern);
    const segB = patternToSegments(b.pattern);
    const specificity = compareSegmentSpecificity(segA, segB);
    if (specificity !== 0) {
      return specificity;
    }
    return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
  });
}

/**
 * Parses a route pattern into segments — the "matching instructions" that
 * the runtime executes against request routes. Runs at build time only:
 * the result is baked into the virtual module.
 *
 * @param {string} pattern - A route pattern to parse.
 * @returns {Segment[]} A list of segments.
 *
 * @example
 * ```ts
 * patternToSegments('/api/example/[id]');
 * // [
 * //   { kind: 'static', value: 'api' },
 * //   { kind: 'static', value: 'example' },
 * //   { kind: 'param', name: 'id' },
 * // ]
 * ```
 */
export function patternToSegments(pattern: string): Segment[] {
  const normalizedPattern = pattern.replace(/^\/+|\/+$/g, '');

  if (normalizedPattern === '') {
    return [];
  }

  const segments = normalizedPattern.split('/');

  return segments.map((segment, index, arr) => {
    const catchallName = /^\[\.\.\.([^\]]+)\]$/.exec(segment)?.[1];

    if (catchallName !== undefined) {
      if (index !== arr.length - 1) {
        throw new Error(
          `Catch-all segment "[...${catchallName}]" must be the last segment in "${pattern}"`,
        );
      }
      return { kind: 'catchall', name: catchallName };
    }

    const paramName = /^\[([^\].]+)\]$/.exec(segment)?.[1];

    if (paramName !== undefined) {
      return { kind: 'param', name: paramName };
    }

    return { kind: 'static', value: segment };
  });
}

function isFileInsideOf(file: string, dir: string) {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Maps handler types import (`./+types`) to runtime module.
 *
 * @param {string} id - The import specifier.
 * @returns {string | undefined} The resolved virtual module id.
 *
 * @example
 * ```ts
 * resolveHandlerTypesImport('./+types');
 * // '\0virtual:cloudflare-router/+types'
 * ```
 */
export function resolveHandlerImport(id: string) {
  const specifier = id.split('?')[0] ?? id;
  if (!HANDLER_IMPORT_RE.test(specifier)) {
    return;
  }
  return RESOLVED_VIRTUAL_HANDLER_MODULE_ID;
}

function compareSegmentSpecificity(a: Segment[], b: Segment[]) {
  const SPECIFICITY = { static: 0, param: 1, catchall: 2 };
  const length = Math.max(a.length, b.length);
  const higher = -1;
  const lower = 1;

  for (let i = 0; i < length; i++) {
    const segA = a[i];
    const segB = b[i];
    if (!segA) {
      return higher;
    }
    if (!segB) {
      return lower;
    }
    const specificity = SPECIFICITY[segA.kind] - SPECIFICITY[segB.kind];
    if (specificity !== 0) {
      return specificity;
    }
    if (segA.kind === 'static' && segB.kind === 'static' && segA.value !== segB.value) {
      return segA.value < segB.value ? -1 : 1;
    }
  }

  return 0;
}

function walk(routesDir: string) {
  const filePaths: string[] = [];

  for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) {
      continue;
    }
    const fullPath = path.join(routesDir, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(routeIndexFile(fullPath));
    }
    if (entry.isFile() && isIndexFile(entry.name)) {
      filePaths.push(fullPath);
    }
  }

  return filePaths;
}

function routeIndexFile(routeFileDir: string) {
  for (const entry of fs.readdirSync(routeFileDir, { withFileTypes: true })) {
    if (entry.isFile() && isIndexFile(entry.name)) {
      return path.join(routeFileDir, entry.name);
    }
  }
  throw new Error(`No index file found in "${routeFileDir}"`);
}

function isIndexFile(name: string) {
  const INDEX_FILES = new Set(['index.ts', 'index.mts', 'index.js', 'index.mjs']);
  if (INDEX_FILES.has(name)) {
    return true;
  }
  return false;
}

function filePathToPattern(relativeFilePath: string) {
  const VALID_SEGMENT_RE = /^(\[\.\.\.[A-Za-z_$][\w$]*\]|\[[A-Za-z_$][\w$]*\]|[\w.~-]+)$/;
  const withoutExtension = relativeFilePath.replace(/\.[^./]+$/, '');
  const flatDir = withoutExtension.split(path.sep).slice(0, -1).join('.');
  const segments = flatDirToSegments(flatDir);

  segments.forEach((segment, index) => {
    if (!VALID_SEGMENT_RE.test(segment)) {
      throw new Error(
        `Invalid route segment "${segment}" in "${toDisplayPath(relativeFilePath)}". ` +
          `Use plain names, [param], or [...catchall].`,
      );
    }
    if (segment.startsWith('[...') && index !== segments.length - 1) {
      throw new Error(
        `Catch-all segment "${segment}" must be the last segment in "${toDisplayPath(relativeFilePath)}"`,
      );
    }
  });

  return `/${segments.join('/')}`;
}

function flatDirToSegments(flatDir: string) {
  if (flatDir === '') {
    return [];
  }

  const segments: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (const char of flatDir) {
    if (char === '[') {
      bracketDepth++;
    }
    if (char === ']') {
      bracketDepth--;
    }
    if (char === '.' && bracketDepth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments.map((segment) => segment.replaceAll('[.]', '.'));
}

function assertNoDuplicateRoutePattern(routes: Routes[]) {
  const seen = new Map<string, string>();
  for (const { pattern, filePath } of routes) {
    const existing = seen.get(pattern);
    if (existing) {
      throw new Error(
        `Duplicate route pattern "${pattern}":\n` + `  - "${existing}"\n` + `  - "${filePath}"`,
      );
    }
    seen.set(pattern, filePath);
  }
}

function toDisplayPath(relativeFilePath: string) {
  return `/${relativeFilePath.split(path.sep).join('/')}`;
}
