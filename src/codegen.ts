import type { Routes } from './index.js';
import type { Segment } from './runtime.js';
import { normalizePath } from 'vite';
import { patternToSegments } from './index.js';

/**
 * Generates virtual module source.
 * Generated `routes` is consumed by `createRouter` to handle routes.
 *
 * @param {Routes[]} routes - A list of routes to generate a virtual module for.
 * @returns {string} The virtual module source.
 *
 * @example
 * ```ts
 * import { routes } from 'virtual:cloudflare-router';
 * import { createRouter } from 'vite-plugin-cloudflare-router/runtime';
 *
 * const router = createRouter<Env>(routes);
 * ```
 */
export function generateVirtualModule(routes: Routes[]) {
  const imports = routes.map(
    (route, i) => `import * as module$${i} from ${JSON.stringify(normalizePath(route.filePath))};`,
  );
  const definitions = routes.map((route, i) =>
    [
      '  {',
      `    pattern: ${JSON.stringify(route.pattern)},`,
      `    segments: ${segmentsToLiteral(patternToSegments(route.pattern))},`,
      `    module: module$${i},`,
      '  },',
    ].join('\n'),
  );

  return [...imports, '', 'export const routes = [', ...definitions, '];', ''].join('\n');
}

function segmentsToLiteral(segments: Segment[]): string {
  if (segments.length === 0) {
    return '[]';
  }
  const lines = segments.map((segment) => `      ${segmentToLiteral(segment)},`);
  return ['[', ...lines, '    ]'].join('\n');
}

function segmentToLiteral(segment: Segment): string {
  if (segment.kind === 'static') {
    return `{ kind: "static", value: ${JSON.stringify(segment.value)} }`;
  }
  return `{ kind: "${segment.kind}", name: ${JSON.stringify(segment.name)} }`;
}
