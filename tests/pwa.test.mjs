import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createPreviewServer } from '../scripts/serve.mjs';
import { releaseFiles, releaseVersion } from '../scripts/build.mjs';

const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

test('every shipped asset contributes to the automatic cache version and unchanged builds stay stable', async () => {
  const sources = new Map(await Promise.all(releaseFiles.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url))])));
  const original = releaseVersion(sources);
  assert.equal(releaseVersion(sources), original);
  for (const file of releaseFiles) {
    const changed = new Map(sources);
    changed.set(file, Buffer.concat([changed.get(file), Buffer.from('changed')]));
    assert.notEqual(releaseVersion(changed), original, file);
  }
});

function workerHarness({ scope = 'https://school.example/planner/', rejectPath } = {}) {
  const listeners = new Map();
  const storage = new Map();
  const network = [];
  let online = true;
  let skipCount = 0;
  let claimCount = 0;
  const fakeFetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    network.push(url);
    if (!online || (rejectPath && new URL(url).pathname.endsWith(rejectPath))) throw new TypeError('Network unavailable');
    return new Response(`asset:${url}`);
  };
  const cacheStorage = {
    keys: async () => [...storage.keys()],
    delete: async (name) => storage.delete(name),
    open: async (name) => {
      if (!storage.has(name)) storage.set(name, new Map());
      const items = storage.get(name);
      return {
        addAll: async (requests) => {
          const responses = await Promise.all(requests.map(fakeFetch));
          requests.forEach((request, index) => items.set(request.url, responses[index]));
        },
        match: async (url) => items.get(typeof url === 'string' ? url : url.url)?.clone(),
      };
    },
  };
  const self = {
    registration: { scope },
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: async () => { skipCount++; },
    clients: { claim: async () => { claimCount++; } },
  };
  vm.runInNewContext(workerSource, { self, caches: cacheStorage, fetch: fakeFetch, URL, Request, Set, Promise });
  return {
    storage, network,
    setOnline(value) { online = value; },
    get skipped() { return skipCount; },
    get claimed() { return claimCount; },
    async dispatch(type, extra = {}) {
      const waits = [];
      let response;
      listeners.get(type)({ ...extra, waitUntil(promise) { waits.push(promise); }, respondWith(promise) { response = promise; } });
      await Promise.all(waits);
      return response ? await response : undefined;
    },
  };
}

test('PWA manifest stays inside its deployment directory and has usable maskable PNGs', async () => {
  const base = new URL('https://school.example/tools/planner/manifest.webmanifest');
  assert.equal(new URL(manifest.start_url, base).href, 'https://school.example/tools/planner/');
  assert.equal(new URL(manifest.scope, base).href, 'https://school.example/tools/planner/');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(`../${icon.src}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.ok(icon.purpose.includes('maskable'));
  }
});

test('install precaches a complete shell; navigation and modules work without network', async () => {
  const harness = workerHarness();
  await harness.dispatch('install');
  assert.equal(harness.skipped, 0, 'install must not activate over an edited page');
  assert.equal(harness.claimed, 0);
  const entries = [...harness.storage.values()][0];
  assert.equal(entries.size, 10);
  assert.ok([...entries.keys()].every((url) => url.startsWith('https://school.example/planner/')));
  const networkBefore = harness.network.length;
  harness.setOnline(false);
  for (const path of ['', 'index.html', 'src/app.js', 'src/calculator.js', 'src/plan-image.js', 'styles.css']) {
    const response = await harness.dispatch('fetch', { request: new Request(`https://school.example/planner/${path}`) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /^asset:/);
  }
  assert.equal(harness.network.length, networkBefore);
});

test('a missing image module rejects install instead of accepting a partial offline release', async () => {
  const harness = workerHarness({ rejectPath: 'src/plan-image.js' });
  await assert.rejects(harness.dispatch('install'), /Network unavailable/);
  assert.equal([...harness.storage.values()][0].size, 0);
  assert.equal(harness.skipped, 0);
});

test('activation removes only obsolete caches for this app at this exact scope', async () => {
  const harness = workerHarness();
  const old = 'invigilation-shell:/planner/:previous';
  harness.storage.set(old, new Map());
  harness.storage.set('other-app-cache', new Map());
  harness.storage.set('invigilation-shell:/second-planner/:previous', new Map());
  await harness.dispatch('install');
  await harness.dispatch('activate');
  assert.equal(harness.storage.has(old), false);
  assert.equal(harness.storage.has('other-app-cache'), true);
  assert.equal(harness.storage.has('invigilation-shell:/second-planner/:previous'), true);
  assert.equal(harness.claimed, 1);
  assert.equal(harness.storage.size, 3);
});

test('worker ignores unrelated URLs and never caches requests or query strings at runtime', async () => {
  const harness = workerHarness();
  await harness.dispatch('install');
  const cacheBefore = [...harness.storage.values()][0];
  const keysBefore = [...cacheBefore.keys()];
  for (const request of [
    new Request('https://other.example/planner/styles.css'),
    new Request('https://school.example/api/plan'),
    new Request('https://school.example/planner/export.json'),
    new Request('https://school.example/planner/index.html', { method: 'POST', body: 'teachers=69' }),
    new Request('https://school.example/planner/sw.js'),
  ]) assert.equal(await harness.dispatch('fetch', { request }), undefined);
  const response = await harness.dispatch('fetch', {
    request: new Request('https://school.example/planner/?teachers=69'),
  });
  assert.equal(response.status, 200);
  assert.deepEqual([...cacheBefore.keys()], keysBefore);
  assert.equal(harness.network.length, 10);
});

test('only an explicit update message activates a waiting worker', async () => {
  const harness = workerHarness();
  await harness.dispatch('message', { data: { type: 'OTHER' } });
  assert.equal(harness.skipped, 0);
  await harness.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(harness.skipped, 1);
});

test('local preview serves the actual shell with MIME types and excludes private/development paths', async (t) => {
  const server = createPreviewServer({ basePath: '/planner/' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = await fetch(`${base}/planner/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);
  assert.match(root.headers.get('content-security-policy'), /script-src 'self'/);
  const manifestResponse = await fetch(`${base}/planner/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  for (const file of ['src/calculator.js', 'src/plan-image.js']) {
    const module = await fetch(`${base}/planner/${file}`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /text\/javascript/);
  }
  const head = await fetch(`${base}/planner/sw.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const redirect = await fetch(`${base}/planner`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  for (const path of ['/planner/wrangler.jsonc', '/planner/tests/pwa.test.mjs', '/planner/%2e%2e%2fsigning/signing.properties', '/planner/%5c..%5csigning', '/planner/not-found.js']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/planner/`, { method: 'POST', body: 'data' })).status, 405);
  assert.equal((await fetch(`${base}/planner/%E0%A4%A`)).status, 400);
});
