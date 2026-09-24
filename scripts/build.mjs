// Build script for Folio.
//
//   node scripts/build.mjs            production build into dist/
//   node scripts/build.mjs --watch    rebuild on change (sourcemaps, no minify)
//   node scripts/build.mjs --tests    bundle unit tests into out/test/
import { build, context } from 'esbuild';
import less from 'less';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: [join(root, 'src/extension.ts')],
  outfile: join(dist, 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: [join(root, 'src/webview/main.ts')],
  outfile: join(dist, 'webview/preview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

/** Lets the VS Code task (.vscode/tasks.json) know when a rebuild is done. */
const watchLogger = {
  name: 'watch-logger',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const error of result.errors) {
        const at = error.location;
        console.error(`✘ [ERROR] ${at ? `${at.file}:${at.line}:${at.column}: ` : ''}${error.text}`);
      }
      console.log('[watch] build finished');
    });
  },
};

async function compileStyles() {
  const out = join(dist, 'styles');
  for (const dir of ['preview_theme', 'prism_theme']) {
    const src = join(root, 'styles', dir);
    mkdirSync(join(out, dir), { recursive: true });
    for (const file of readdirSync(src)) {
      if (file === 'github.less') {
        continue; // mixin, imported by the other themes
      }
      const input = join(src, file);
      if (file.endsWith('.css')) {
        cpSync(input, join(out, dir, file));
      } else if (file.endsWith('.less')) {
        const { css } = await less.render(readFileSync(input, 'utf8'), {
          filename: input,
          paths: [src],
        });
        writeFileSync(join(out, dir, basename(file, '.less') + '.css'), css);
      }
    }
  }
  const template = join(root, 'styles/style-template.less');
  const { css } = await less.render(readFileSync(template, 'utf8'), {
    filename: template,
  });
  writeFileSync(join(out, 'style-template.css'), css);
  cpSync(join(root, 'styles/preview.css'), join(out, 'preview.css'));
}

function copyVendorAssets() {
  const katex = join(root, 'node_modules/katex/dist');
  mkdirSync(join(dist, 'katex/fonts'), { recursive: true });
  cpSync(join(katex, 'katex.min.css'), join(dist, 'katex/katex.min.css'));
  // Only woff2 is shipped: every browser engine VS Code and Chrome use
  // supports it, and the stylesheet lists it first.
  for (const font of readdirSync(join(katex, 'fonts'))) {
    if (font.endsWith('.woff2')) {
      cpSync(join(katex, 'fonts', font), join(dist, 'katex/fonts', font));
    }
  }
  // Bergamot translation engine (worker script + WASM), run in a
  // worker_threads Worker by src/translation/offline/engine.ts.
  const bergamot = join(root, 'node_modules/@browsermt/bergamot-translator/worker');
  mkdirSync(join(dist, 'bergamot'), { recursive: true });
  for (const file of [
    'translator-worker.js',
    'bergamot-translator-worker.js',
    'bergamot-translator-worker.wasm',
  ]) {
    cpSync(join(bergamot, file), join(dist, 'bergamot', file));
  }
  mkdirSync(join(dist, 'mermaid'), { recursive: true });
  cpSync(
    join(root, 'node_modules/mermaid/dist/mermaid.min.js'),
    join(dist, 'mermaid/mermaid.min.js'),
  );
}

function findTests(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return findTests(path);
    }
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

async function buildTests() {
  rmSync(join(root, 'out/test'), { recursive: true, force: true });
  await build({
    entryPoints: findTests(join(root, 'test/unit')),
    outdir: join(root, 'out/test/unit'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode', 'mocha'],
    sourcemap: 'inline',
    logLevel: 'warning',
  });
  await build({
    entryPoints: [join(root, 'test/integration/index.ts')],
    outdir: join(root, 'out/test/integration'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode', 'mocha'],
    logLevel: 'warning',
  });
}

async function main() {
  if (tests) {
    await buildTests();
    return;
  }
  rmSync(dist, { recursive: true, force: true });
  await compileStyles();
  copyVendorAssets();
  if (watch) {
    const contexts = await Promise.all([
      context({ ...extensionConfig, plugins: [watchLogger] }),
      context({ ...webviewConfig, plugins: [watchLogger] }),
    ]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    return;
  }
  await Promise.all([build(extensionConfig), build(webviewConfig)]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
