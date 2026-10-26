import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const releaseFiles = [
  'index.html', 'styles.css', 'src/app.js', 'src/calculator.js',
  'sw.js', 'manifest.webmanifest', '_headers',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

export function releaseVersion(sources) {
  const hash = createHash('sha256');
  for (const file of releaseFiles) hash.update(file).update('\0').update(sources.get(file)).update('\0');
  return hash.digest('hex').slice(0, 20);
}

export async function buildRelease() {
  const output = path.join(webRoot, 'dist');
  // Read the complete release first; an incomplete source never becomes a release.
  const sources = new Map(await Promise.all(releaseFiles.map(async (file) => [file, await readFile(path.join(webRoot, file))])));
  const version = releaseVersion(sources);
  const worker = sources.get('sw.js').toString('utf8');
  if (!/^const CACHE_VERSION = '[^']+';$/m.test(worker)) throw new Error('Cannot locate Service Worker cache version.');
  sources.set('sw.js', Buffer.from(worker.replace(/^const CACHE_VERSION = '[^']+';$/m, `const CACHE_VERSION = '${version}';`)));
  for (const [file, body] of sources) {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body);
  }
  console.log(`Static release: ${output} (${releaseFiles.length} files; version ${version})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildRelease();
