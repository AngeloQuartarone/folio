// Releases Folio: bumps the version, runs the tests, packages the .vsix, tags
// and pushes, then publishes it to GitHub Releases, Open VSX and the VS Code
// Marketplace.
//
//   npm run release -- <patch|minor|major|x.y.z> [--dry-run]
//   npm run release -- publish [github,openvsx,marketplace]
//
// The first form does everything; the second (re)publishes the version in
// package.json, already tagged, to the stores it is not on yet. Every store is
// skipped when it already has that version, so both can simply be run again
// after a failure.
//
// CHANGELOG.md must start with an "## Unreleased" section: it becomes
// "## x.y.z (date)" and its text the release notes.
//
// Tokens come from the environment (OVSX_PAT, VSCE_PAT) or the macOS keychain
// (services "folio-ovsx", "folio-vsce"); they are never printed. Without a
// Marketplace token the .vsix is shown in Finder and the publisher page is
// opened, to upload it there by hand.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB_ACCOUNT = 'AngeloQuartarone';
const BRANCH = 'main';
const OVSX = 'ovsx@1.2.0';
const STORES = ['github', 'openvsx', 'marketplace'];
const CHANGELOG = join(root, 'CHANGELOG.md');

const manifest = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed`);
  }
}

function output(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump;
  }
  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return fail(`Unknown version "${bump}": use patch, minor, major or x.y.z.`);
  }
}

/** The body of a "## <title>" section of the changelog. */
function changelogSection(title) {
  const lines = readFileSync(CHANGELOG, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${title}`));
  if (start < 0) {
    return undefined;
  }
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

function token(variable, service) {
  if (process.env[variable]) {
    return process.env[variable];
  }
  if (process.platform === 'darwin') {
    try {
      return output('security', ['find-generic-password', '-s', service, '-w']);
    } catch {
      // Not in the keychain.
    }
  }
  return undefined;
}

function checkRepository(version) {
  if (output('git', ['branch', '--show-current']) !== BRANCH) {
    fail(`Release from ${BRANCH}.`);
  }
  if (output('git', ['status', '--porcelain'])) {
    fail('The working tree has uncommitted changes.');
  }
  run('git', ['fetch', '--quiet', 'origin', BRANCH]);
  if (output('git', ['rev-parse', 'HEAD']) !== output('git', ['rev-parse', `origin/${BRANCH}`])) {
    fail(`${BRANCH} is not in sync with origin/${BRANCH}.`);
  }
  if (output('git', ['tag', '--list', `v${version}`])) {
    fail(`The tag v${version} already exists.`);
  }
  checkGitHubAccount();
}

function checkGitHubAccount() {
  const login = output('gh', ['api', 'user', '--jq', '.login']);
  if (login !== GITHUB_ACCOUNT) {
    fail(`gh is logged in as ${login}; switch to ${GITHUB_ACCOUNT} (gh auth switch).`);
  }
}

async function marketplaceVersions(id) {
  const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: id }] }], flags: 1 }),
  });
  const extension = (await response.json()).results?.[0]?.extensions?.[0];
  return (extension?.versions ?? []).map((v) => v.version);
}

async function publishGitHub({ version, vsix }) {
  checkGitHubAccount();
  const tag = `v${version}`;
  const exists = spawnSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' }).status === 0;
  if (exists) {
    run('gh', ['release', 'upload', tag, vsix, '--clobber']);
    return;
  }
  const notes = changelogSection(version) || `Folio ${version}`;
  run('gh', ['release', 'create', tag, vsix, '--verify-tag', '--title', `Folio ${version}`, '--notes', notes]);
}

async function publishOpenVsx({ publisher, name, version, vsix }) {
  const response = await fetch(`https://open-vsx.org/api/${publisher}/${name}/${version}`);
  if (response.ok) {
    console.log(`Open VSX already has ${version}.`);
    return;
  }
  const pat = token('OVSX_PAT', 'folio-ovsx');
  if (!pat) {
    fail('No Open VSX token: set OVSX_PAT or add it to the keychain (service "folio-ovsx").');
  }
  const env = { ...process.env, OVSX_PAT: pat };
  if (!(await fetch(`https://open-vsx.org/api/${publisher}`)).ok) {
    run('npx', ['--yes', OVSX, 'create-namespace', publisher], { env });
  }
  run('npx', ['--yes', OVSX, 'publish', vsix], { env });
}

async function publishMarketplace({ publisher, name, version, vsix }) {
  if ((await marketplaceVersions(`${publisher}.${name}`)).includes(version)) {
    console.log(`The Marketplace already has ${version}.`);
    return;
  }
  const pat = token('VSCE_PAT', 'folio-vsce');
  if (pat) {
    run('npx', ['vsce', 'publish', '--no-dependencies', '--packagePath', vsix], {
      env: { ...process.env, VSCE_PAT: pat },
    });
    return;
  }
  console.log(
    `\nNo Marketplace token: upload ${vsix} by hand.\n` +
      `  On the publisher page, open the "…" menu of ${name} → Update, and pick the file.`,
  );
  if (process.platform === 'darwin') {
    spawnSync('open', ['-R', vsix]);
    spawnSync('open', [`https://marketplace.visualstudio.com/manage/publishers/${publisher}`]);
  }
}

async function publish(stores) {
  const { publisher, name, version } = manifest();
  if (!output('git', ['tag', '--list', `v${version}`])) {
    fail(`v${version} is not tagged: release it first (npm run release -- <version>).`);
  }
  const vsix = join(root, `${name}-${version}.vsix`);
  if (!existsSync(vsix)) {
    if (output('git', ['rev-parse', 'HEAD']) !== output('git', ['rev-parse', `v${version}^{commit}`])) {
      fail(`${vsix} is missing; check out v${version} to package it again.`);
    }
    run('npm', ['run', 'package']);
  }
  const release = { publisher, name, version, vsix };
  const steps = { github: publishGitHub, openvsx: publishOpenVsx, marketplace: publishMarketplace };
  for (const store of stores) {
    console.log(`\n— ${store} —`);
    await steps[store](release);
  }
  console.log(`\n✓ Folio ${version} published to: ${stores.join(', ')}.`);
}

async function release(bump, dryRun) {
  const current = manifest().version;
  const version = nextVersion(current, bump);
  const notes = changelogSection('Unreleased');
  if (!notes) {
    fail('CHANGELOG.md has no "## Unreleased" section with something in it.');
  }
  checkRepository(version);
  console.log(`\nFolio ${current} → ${version}\n\n${notes}\n`);
  if (dryRun) {
    console.log('Dry run: nothing changed.');
    return;
  }

  run('npm', ['test']);
  run('npm', ['version', version, '--no-git-tag-version']);
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(CHANGELOG, readFileSync(CHANGELOG, 'utf8').replace('## Unreleased', `## ${version} (${date})`));
  run('npm', ['run', 'package']);

  run('git', ['commit', '--quiet', '-am', `Release ${version}`]);
  run('git', ['tag', '-a', `v${version}`, '-m', `Folio ${version}`]);
  run('git', ['push', '--atomic', 'origin', BRANCH, `refs/tags/v${version}`]);

  await publish(STORES);
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  fail('Usage: npm run release -- <patch|minor|major|x.y.z> [--dry-run] | publish [github,openvsx,marketplace]');
} else if (command === 'publish') {
  const stores = rest[0] ? rest[0].split(',') : STORES;
  const unknown = stores.filter((store) => !STORES.includes(store));
  if (unknown.length) {
    fail(`Unknown store: ${unknown.join(', ')}.`);
  }
  await publish(stores);
} else {
  await release(command, rest.includes('--dry-run'));
}
