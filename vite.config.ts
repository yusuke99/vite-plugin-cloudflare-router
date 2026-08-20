import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['./src/index.ts', './src/runtime.ts'],
    outDir: './dist',
    format: ['esm'],
    clean: true,
    dts: true,
  },
  fmt: {
    ignorePatterns: ['*.md', '**/dist', '**/node_modules', '**/.cloudflare-router'],
    singleQuote: true,
    sortPackageJson: false,
    sortImports: {
      newlinesBetween: false,
      groups: [
        'type',
        ['builtin', 'subpath'],
        'external',
        ['internal', 'parent', 'sibling', 'index'],
        ['import', 'unknown'],
      ],
    },
  },
  lint: {
    ignorePatterns: ['**/dist', '**/node_modules', '**/.cloudflare-router'],
    plugins: ['oxc', 'typescript'],
    rules: {
      curly: ['error', 'all'],
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ['**/*.test.ts'],
  },
  staged: {
    '*': 'vp check --fix',
  },
});
