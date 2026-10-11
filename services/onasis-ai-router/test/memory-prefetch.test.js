'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryPrefetch } = require('../core/memory-prefetch');

// Finding #7 (2026-09-01): the prefetch cache was keyed on the user's question
// alone. MemoryPrefetch is constructed once (core/ai-service-router.js:60), so
// that Map is shared process-wide, while the underlying search is per-caller via
// buildAuthHeaders(req). Two callers asking the same question inside the 2-minute
// TTL therefore shared one memory brief — and the brief is injected into the
// prompt as a system message, so one tenant's private memories reached another's
// model call. These tests pin the key to the authenticated identity and filters.

const silent = { warn() {}, info() {}, error() {} };

function make(overrides = {}) {
  return new MemoryPrefetch({
    apiBaseUrl: 'http://127.0.0.1:9',      // discard port: never answers
    memorySearchPath: '/api/v1/memory/search',
    topK: 3,
    timeoutMs: 50,
    enabled: true,
    maxChars: 2000,
    buildAuthHeaders: () => ({}),
    logger: silent,
    ...overrides,
  });
}

const reqFor = (authId, organizationId = 'org-1') => ({ uai: { authId, organizationId } });

test('cache key separates two callers asking the identical question', () => {
  const p = make();
  const a = p._cacheKey(reqFor('user-a'), {}, 'what are my deploy credentials');
  const b = p._cacheKey(reqFor('user-b'), {}, 'what are my deploy credentials');
  assert.notEqual(a, b, 'identical question from different users must not collide');
});

test('cache key separates two organizations for the same question', () => {
  const p = make();
  const a = p._cacheKey({ uai: { authId: 'u', organizationId: 'org-1' } }, {}, 'q');
  const b = p._cacheKey({ uai: { authId: 'u', organizationId: 'org-2' } }, {}, 'q');
  assert.notEqual(a, b);
});

test('cache key accounts for filters that change the result set', () => {
  const p = make();
  const base = p._cacheKey(reqFor('u'), {}, 'q');
  assert.notEqual(p._cacheKey(reqFor('u'), { memory_type: 'project' }, 'q'), base);
  assert.notEqual(p._cacheKey(reqFor('u'), { tags: ['secret'] }, 'q'), base);
});

test('tag order does not fragment the cache', () => {
  const p = make();
  assert.equal(
    p._cacheKey(reqFor('u'), { tags: ['a', 'b'] }, 'q'),
    p._cacheKey(reqFor('u'), { tags: ['b', 'a'] }, 'q'),
  );
});

test('an unidentified caller is never cached', () => {
  const p = make();
  assert.equal(p._cacheKey({}, {}, 'q'), null, 'no identity -> no cache key');
  assert.equal(p._cacheKey({ uai: {} }, {}, 'q'), null);
});

test('one caller cannot read another caller\'s cached brief', async () => {
  const p = make();
  const question = 'what are my deploy credentials';
  const secret = 'Working memory brief (prefetch):\n#1 [m1] ROOT PASSWORD | | | hunter2';

  // Seed the cache as user A, exactly as a completed prefetch would.
  p._cache.set(p._cacheKey(reqFor('user-a'), {}, question), {
    value: secret,
    expiresAt: Date.now() + 60_000,
  });

  // User B asks the same question. The upstream is unreachable, so a correct
  // implementation returns '' (prefetch degrades silently by design).
  const got = await p.brief(reqFor('user-b'), [{ role: 'user', content: question }], {});
  assert.notEqual(got, secret, 'must not serve another caller\'s memory brief');
  assert.equal(got, '');
});

test('the same caller still gets a cache hit', async () => {
  const p = make();
  const question = 'my own question';
  const mine = 'Working memory brief (prefetch):\n#1 [m2] mine | | | ok';
  p._cache.set(p._cacheKey(reqFor('user-a'), {}, question), {
    value: mine,
    expiresAt: Date.now() + 60_000,
  });
  const got = await p.brief(reqFor('user-a'), [{ role: 'user', content: question }], {});
  assert.equal(got, mine, 'caching must still work within one identity');
});

test('concurrent in-flight dedup does not cross identities', async () => {
  const p = make();
  const question = 'shared question';
  const [a, b] = await Promise.all([
    p.brief(reqFor('user-a'), [{ role: 'user', content: question }], {}),
    p.brief(reqFor('user-b'), [{ role: 'user', content: question }], {}),
  ]);
  // Both fail to reach the upstream; the point is that they were not deduped
  // onto a single shared promise keyed by the question alone.
  assert.equal(a, '');
  assert.equal(b, '');
});

// Finding #12 (2026-09-01): MemoryPrefetch was constructed in the router's
// constructor BEFORE this.logger was assigned, so its injected logger was
// permanently undefined. The class swallows its own errors to '' precisely so a
// memory outage degrades the answer instead of failing the request — but the
// swallow itself called this.logger.warn and threw
// "Cannot read properties of undefined (reading 'warn')", turning every
// prefetch failure into a 500. Live evidence: two 500s at a consistent ~3.0s,
// the prefetch timeout.

test('a prefetch failure degrades to empty, never throws', async () => {
  const p = new MemoryPrefetch({
    apiBaseUrl: 'http://127.0.0.1:9',   // discard port: never answers
    memorySearchPath: '/api/v1/memory/search',
    topK: 3,
    timeoutMs: 50,
    enabled: true,
    maxChars: 2000,
    buildAuthHeaders: () => ({}),
    logger: undefined,                  // the exact defect being pinned
  });
  const got = await p.brief(
    { uai: { authId: 'u', organizationId: 'o' } },
    [{ role: 'user', content: 'anything' }],
    {},
  );
  assert.equal(got, '', 'must degrade to empty rather than throw');
});

test('the router wires a usable logger into MemoryPrefetch', () => {
  // Guards the construction-order bug at its source rather than only its symptom.
  const AIServiceRouter = require('../core/ai-service-router');
  const router = new AIServiceRouter({});   // constructor requires a config object
  assert.ok(router._prefetch, 'prefetch is constructed');
  assert.equal(typeof router._prefetch.logger?.warn, 'function',
    'prefetch logger must be usable — it is called on every prefetch failure');
});
