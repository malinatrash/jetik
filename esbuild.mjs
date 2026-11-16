import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const flags = new Set(process.argv.slice(2));
const production = flags.has('--production');
const common = { bundle: true, minify: production, sourcemap: !production, logLevel: 'info' };

const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

const webview = {
  ...common,
  entryPoints: { log: 'webview/log/main.tsx', push: 'webview/push/main.tsx', commit: 'webview/commit/main.tsx' },
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
};

const tests = {
  ...common,
  entryPoints: readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`),
  outdir: 'dist/test',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outExtension: { '.js': '.cjs' },
};

function copyAssets() {
  mkdirSync('dist/webview', { recursive: true });
  cpSync('webview/styles.css', 'dist/webview/styles.css');
  for (const file of ['codicon.css', 'codicon.ttf']) {
    cpSync(`node_modules/@vscode/codicons/dist/${file}`, `dist/webview/${file}`);
  }
}

if (flags.has('--test')) {
  await build(tests);
} else if (flags.has('--watch')) {
  copyAssets();
  await Promise.all([extension, webview].map(async (options) => (await context(options)).watch()));
} else {
  copyAssets();
  await Promise.all([build(extension), build(webview)]);
}
