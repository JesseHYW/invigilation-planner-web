import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFiles = new Set([
  'index.html', 'styles.css', 'src/app.js', 'src/calculator.js',
  'sw.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
]);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'";

export function createPreviewServer({ root = webRoot, basePath = '/' } = {}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath)) throw new Error('basePath must be / or /directory/.');
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', csp);
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    if (basePath !== '/' && pathname === basePath.slice(0, -1)) {
      response.writeHead(308, { Location: basePath }).end();
      return;
    }
    const relative = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : null;
    const file = relative === '' ? 'index.html' : relative;
    // An explicit allowlist also excludes tests, configuration and all Android files.
    if (!publicFiles.has(file)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    try {
      const body = await readFile(path.join(root, file));
      response.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '4173' },
    host: { type: 'string', default: '127.0.0.1' },
    base: { type: 'string', default: '/' },
    dist: { type: 'boolean', default: false },
  } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const server = createPreviewServer({ basePath: values.base, root: values.dist ? path.join(webRoot, 'dist') : webRoot });
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, values.host, () => console.log(`监考规划预览：http://${values.host}:${port}${values.base}`));
}
