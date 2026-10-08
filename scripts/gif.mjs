// Turns a screen recording into the README's demo GIF (docs/images/demo.gif),
// with a palette computed for the clip. Needs ffmpeg.
//   node scripts/gif.mjs <recording.mov> [--width 960] [--fps 12] [--out path]
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const input = args[0];
if (!input || input.startsWith('--')) {
  console.error('Usage: node scripts/gif.mjs <recording.mov> [--width 960] [--fps 12] [--out path]');
  process.exit(1);
}
const width = Number(option('width', '960'));
const fps = Number(option('fps', '12'));
const out = option('out', join(root, 'docs/images/demo.gif'));

const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
const filter = `${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', filter, '-loop', '0', out], {
  stdio: 'inherit',
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.log(`${out}: ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
