// Runs test/integration inside a downloaded VS Code (Extension Development Host).
import { runTests } from '@vscode/test-electron';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// When started from a terminal inside VS Code this is set, and would make the
// test instance start as plain Node.
delete process.env['ELECTRON_RUN_AS_NODE'];

// A short path: the IPC socket inside it must stay under 103 characters.
const userDataDir = mkdtempSync(join(tmpdir(), 'mtp-'));

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'out/test/integration/index.js'),
    launchArgs: [
      join(root, 'test/fixtures'),
      '--disable-extensions',
      '--disable-workspace-trust',
      `--user-data-dir=${userDataDir}`,
    ],
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}
