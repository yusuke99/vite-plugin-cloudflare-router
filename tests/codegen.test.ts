import { describe, expect, test } from 'vite-plus/test';
import { generateVirtualModule } from '../src/codegen.js';

describe('generateVirtualModule', () => {
  test('generates imports and route definitions', () => {
    const module = generateVirtualModule([
      { filePath: '/my-app/worker/routes/api/index.ts', pattern: '/api' },
      { filePath: '/my-app/worker/routes/api/test/[id].ts', pattern: '/api/test/[id]' },
    ]);

    expect(module).toMatchInlineSnapshot(`
      "import * as module$0 from "/my-app/worker/routes/api/index.ts";
      import * as module$1 from "/my-app/worker/routes/api/test/[id].ts";

      export const routes = [
        {
          pattern: "/api",
          segments: [
            { kind: "static", value: "api" },
          ],
          module: module$0,
        },
        {
          pattern: "/api/test/[id]",
          segments: [
            { kind: "static", value: "api" },
            { kind: "static", value: "test" },
            { kind: "param", name: "id" },
          ],
          module: module$1,
        },
      ];
      "
    `);
  });

  test('normalizes Windows path', () => {
    const module = generateVirtualModule([
      { filePath: 'C:\\my-app\\worker\\routes\\api.ts', pattern: '/api' },
    ]);

    expect(module).toMatchInlineSnapshot(`
      "import * as module$0 from "C:/my-app/worker/routes/api.ts";

      export const routes = [
        {
          pattern: "/api",
          segments: [
            { kind: "static", value: "api" },
          ],
          module: module$0,
        },
      ];
      "
    `);
  });
});
