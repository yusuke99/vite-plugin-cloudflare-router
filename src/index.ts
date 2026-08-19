import type { Segment } from './runtime.js';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { exactRegex } from '@rolldown/pluginutils';
import { generateVirtualModule } from './codegen.js';

const PLUGIN_NAME = 'vite-plugin-cloudflare-router';
const VIRTUAL_MODULE_ID = 'virtual:cloudflare-router';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

interface PluginConfig {
  /**
   * Directory containing route files.
   *
   * @default './worker/routes'
   *
   * @example
   * ```
   * import { defineConfig } from 'vite';
   * import { cloudflareRouter } from 'vite-plugin-cloudflare-router';
   *
   * export default defineConfig({
   *   plugins: [
   *     cloudflareRouter({ routesDir: './worker/routes' }),
   *   ],
   * });
   * ```
   */
  routesDir?: string;
}

export default function cloudflareRouter(pluginConfig: PluginConfig = {}): Plugin {
  let routesDir = '';

  return {
    name: PLUGIN_NAME,

    configResolved(config) {
      routesDir = path.resolve(config.root, pluginConfig.routesDir ?? './worker/routes');
    },

    resolveId: {
      filter: {
        id: exactRegex(VIRTUAL_MODULE_ID),
      },
      handler() {
        return RESOLVED_VIRTUAL_MODULE_ID;
      },
    },

    load: {
      filter: {
        id: exactRegex(RESOLVED_VIRTUAL_MODULE_ID),
      },
      handler() {
        this.addWatchFile(routesDir);
        const routes = scanRoutes(routesDir);
        return generateVirtualModule(routes);
      },
    },

    hotUpdate({ type, file }) {
      if (type === 'update') {
        return;
      }
      if (!isFileInsideOf(file, routesDir)) {
        return;
      }
      const module = this.environment.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
      return module ? [module] : [];
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
   *   filePath: '/my-project/worker/routes/api/example.ts',
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
 * Files and directories starting with `_` and `.` are ignored, so shared
 * files can live next to routes (e.g. `/worker/routes/_utils.ts`).
 * Declaration files (`.d.ts`) and test files (`*.test.*`, `*.spec.*`) are also ignored.
 *
 * @param {string} routesDir - Absolute path to the directory to scan for route files.
 * @returns {Routes[]} A list of routes sorted by match priority.
 *
 * @example
 * ```ts
 * const routes = scanRoutes('/my-project/worker/routes');
 * // [
 * //   { filePath: '/my-project/worker/routes/api/example.ts', pattern: '/api/example' },
 * //   { filePath: '/my-project/worker/routes/api/example/[id].ts', pattern: '/api/example/[id]' },
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
  const routes = sortRoutes(rawRoutes);

  const routePattern = new Map<string, string>();

  for (const route of routes) {
    const existing = routePattern.get(route.pattern);
    if (existing) {
      throw new Error(
        `Duplicate route pattern "${route.pattern}":\n` +
          `  - "${toDisplayPath(path.relative(routesDir, existing))}"\n` +
          `  - "${toDisplayPath(path.relative(routesDir, route.filePath))}"`,
      );
    }
    routePattern.set(route.pattern, route.filePath);
  }

  return routes;
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
 *   { filePath: '/my-project/worker/routes/api/example.ts', pattern: '/api/example' },
 *   { filePath: '/my-project/worker/routes/api/example/[id].ts', pattern: '/api/example/[id]' },
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

function walk(dir: string) {
  const filePaths: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...walk(fullPath));
    }
    if (entry.isFile() && isRouteFile(entry.name)) {
      filePaths.push(fullPath);
    }
  }

  return filePaths;
}

function isRouteFile(name: string) {
  const ROUTE_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs']);

  if (name.startsWith('_') || name.startsWith('.')) {
    return false;
  }
  if (name.endsWith('.d.ts')) {
    return false;
  }
  if (/\.(test|spec)\.[^.]+$/.test(name)) {
    return false;
  }

  return ROUTE_EXTENSIONS.has(path.extname(name));
}

function filePathToPattern(relativeFilePath: string) {
  const VALID_SEGMENT_RE = /^(\[\.\.\.[A-Za-z_$][\w$]*\]|\[[A-Za-z_$][\w$]*\]|[\w.~-]+)$/;
  const withoutExtension = relativeFilePath.replace(/\.[^./]+$/, '');
  const segments = withoutExtension.split(path.sep).filter(Boolean);

  // An `index` file maps to root route (e.g. `/api/example/index.ts` -> `/api/example`).
  // Remove the trailing `index` segment so it becomes `['api', 'example']` instead of
  // `['api', 'example', 'index']`.
  if (segments[segments.length - 1] === 'index') {
    segments.pop();
  }

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

function toDisplayPath(relativeFilePath: string) {
  return `/${relativeFilePath.split(path.sep).join('/')}`;
}
