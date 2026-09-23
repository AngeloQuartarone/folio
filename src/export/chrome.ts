/*
 * Locate a Chromium-based browser and print a page to PDF with it.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * No puppeteer: Chrome's own `--headless --print-to-pdf` is enough and
 * keeps the extension free of heavy dependencies.
 */
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function chromeCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  switch (platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ];
    case 'win32': {
      const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(
        (root): root is string => !!root,
      );
      return roots.flatMap((root) => [
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(root, 'Chromium', 'Application', 'chrome.exe'),
        join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ]);
    }
    default:
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/brave-browser',
      ];
  }
}

export function findChrome(configuredPath: string): string | undefined {
  if (configuredPath) {
    return existsSync(configuredPath) ? configuredPath : undefined;
  }
  return chromeCandidates().find((candidate) => existsSync(candidate));
}

/**
 * Print `htmlPath` to `pdfPath`. `waitMs` is Chrome's virtual time budget,
 * which lets scripts such as Mermaid finish before printing.
 *
 * Recent Chrome versions do not always exit after `--print-to-pdf`, so the
 * process is stopped as soon as the PDF is complete (ends with `%%EOF` and
 * no longer grows).
 */
export function printToPdf(
  chromePath: string,
  htmlPath: string,
  pdfPath: string,
  waitMs = 5000,
  timeoutMs = 120_000,
): Promise<void> {
  // A throwaway profile, so a running Chrome instance is never involved.
  const profile = mkdtempSync(join(tmpdir(), 'mtp-chrome-'));
  const args = [
    '--headless',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    `--virtual-time-budget=${waitMs}`,
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).toString(),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    let settled = false;
    let lastSize = -1;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      if (child.exitCode === null) {
        child.kill();
      }
      error ? reject(error) : resolve();
    };

    const poll = setInterval(() => {
      const size = completePdfSize(pdfPath);
      if (size > 0 && size === lastSize) {
        finish();
      }
      lastSize = size;
    }, 250);

    const timer = setTimeout(
      () => finish(new Error(`Chrome did not finish within ${timeoutMs / 1000}s.`)),
      timeoutMs,
    );

    // The profile can only be removed once Chrome has let go of it.
    const removeProfile = () => {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Left in the OS temp directory; harmless.
      }
    };

    child.on('error', (error) => {
      removeProfile();
      finish(error);
    });
    child.on('exit', (code) => {
      removeProfile();
      if (completePdfSize(pdfPath) > 0) {
        finish();
      } else {
        finish(new Error(lastLines(stderr) || `Chrome exited with code ${code}.`));
      }
    });
  });
}

/** Size of `path` if it is a complete PDF, else 0. */
export function completePdfSize(path: string): number {
  try {
    const size = statSync(path).size;
    if (size < 16) {
      return 0;
    }
    const fd = openSync(path, 'r');
    try {
      const tail = Buffer.alloc(16);
      readSync(fd, tail, 0, 16, size - 16);
      return tail.toString('latin1').includes('%%EOF') ? size : 0;
    } finally {
      closeSync(fd);
    }
  } catch {
    return 0;
  }
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-3).join('\n');
}
