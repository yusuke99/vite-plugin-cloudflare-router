import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['./src/index.ts'],
    outDir: './dist',
    format: ['esm'],
    clean: true,
    dts: true,
  },
  fmt: {
    ignorePatterns: ['*.md', '**/node_modules', '**/dist'],
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
    ignorePatterns: ['**/node_modules', '**/dist'],
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
