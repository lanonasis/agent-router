'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AIServiceRouter = require('../core/ai-service-router');

// Reported from Slack 2026-09-03 and reproduced on both the ask-ai and
// dashboard-assistant lanes:
//
//   User: "can you search my memory bank for the agent banks project status?"
//   L0:   "Done — I ran memory.search. Ask me to summarise the result if you
//          need more detail."
//
// The search SUCCEEDED. Both follow-up guards were right to distrust the
// vendor's second pass (minimax returned incomplete_turn; openclaw re-emitted
// the tool call), but they discarded the tool RESULT along with the bad
// completion — so the product's core function looked broken.
//
// The reply also offered a follow-up the architecture cannot honour: requests
// are independent by design, so "ask me to summarise" starts a fresh request
// that just re-runs the search.

const router = new AIServiceRouter({});
const render = (results) => router._renderToolResultsForUser(results);
const fallback = (results) => router._fallbackAfterToolCall(results);

const searchResult = (records) => ([{
  name: 'memory.search',
  payload: JSON.stringify({ data: records }),
}]);

test('memory records reach the user instead of being dropped', () => {
  const out = fallback(searchResult([
    { title: 'Agent Banks status', content: 'Paused pending review of the execution adapter.' },
    { title: 'Agent Banks tools', content: 'system, desktop, github-mcp-server' },
  ]));
  assert.match(out, /Agent Banks status/);
  assert.match(out, /Paused pending review/);
  assert.match(out, /Agent Banks tools/);
});

test('the impossible follow-up offer is gone', () => {
  // There is no next turn to ask in — each request is independent.
  const out = fallback(searchResult([{ title: 'x', content: 'y' }]));
  assert.doesNotMatch(out, /ask me to summarise/i);
  assert.doesNotMatch(out, /if you need more detail/i);
});

test('it is honest that no summary was composed', () => {
  const out = fallback(searchResult([{ title: 'x', content: 'y' }]));
  assert.match(out, /could not compose a summary/i,
    'must not present raw records as though they were a considered answer');
});

test('common result envelopes are all understood', () => {
  for (const key of ['data', 'results', 'memories', 'items', 'matches']) {
    const out = render([{ name: 'memory.search', payload: JSON.stringify({ [key]: [{ title: 'Found', content: 'body' }] }) }]);
    assert.match(out, /Found/, `envelope "${key}" should render`);
  }
  assert.match(render([{ name: 'memory.search', payload: JSON.stringify([{ title: 'Bare', content: 'b' }]) }]), /Bare/);
});

test('an empty search says so rather than inventing an apology', () => {
  const out = render(searchResult([]));
  assert.match(out, /no matches/i);
});

test('result counts are reported and long lists are capped', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Memory ${i}`, content: 'c' }));
  const out = render(searchResult(many));
  assert.match(out, /returned 20 results/);
  assert.match(out, /\(\+12 more\)/, 'the user should know the list was truncated');
  assert.ok(!out.includes('Memory 15'));
});

test('a truncated payload still yields partial data, not nothing', () => {
  // formatToolPayload() appends an ellipsis past maxToolResultChars, which
  // makes the payload invalid JSON. Partial data beats none.
  const out = render([{ name: 'memory.search', payload: '{"data":[{"title":"Half a rec' }]);
  assert.ok(out && out.includes('Half a rec'));
});

test('a tool error is surfaced, not swallowed', () => {
  const out = render([{ name: 'memory.search', payload: JSON.stringify({ error: 'Memory search failed' }) }]);
  assert.match(out, /Memory search failed/);
});

test('nothing renderable falls back to honest wording, not a fake success', () => {
  const out = fallback([{ name: 'memory.search', payload: '' }]);
  assert.match(out, /could not read anything usable/i);
  assert.doesNotMatch(out, /here are the raw results/i);
});

test('no tool results at all keeps the original wording', () => {
  assert.match(fallback([]), /unable to complete/i);
  assert.match(fallback(undefined), /unable to complete/i);
});

test('malformed entries never throw', () => {
  // This runs on an error path; throwing here would turn a degraded answer
  // into a 500 — the shape of finding #12.
  for (const input of [[null], [{}], [{ name: 'x' }], [{ payload: 42 }], [undefined]]) {
    assert.doesNotThrow(() => fallback(input));
  }
});

test('rendering does not leak vendor or model identifiers', () => {
  const out = fallback(searchResult([{ title: 'ok', content: 'body' }]));
  for (const forbidden of ['minimax', 'openclaw', 'ollama', 'anthropic', 'qwen']) {
    assert.ok(!out.toLowerCase().includes(forbidden), `must not disclose "${forbidden}"`);
  }
});

// Truncation is the COMMON case for memory.search, not an edge case:
// TOOL_RESULT_MAX_CHARS defaults to 6000 and memory records are prose.
// Verified live 2026-09-03 — the ask-ai lane hit exactly this and dumped raw
// JSON at the user.

const salvage = (payload) => router._salvageTruncatedRecords(payload);

test('whole records survive truncation; the partial one is dropped', () => {
  const out = salvage('{"data":[{"id":"1","title":"First"},{"id":"2","title":"Second"},{"id":"3","title":"Par');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.title), ['First', 'Second']);
});

test('a brace inside a string does not end a record early', () => {
  const out = salvage('{"data":[{"id":"1","content":"code like } or { here","title":"T"}');
  assert.equal(out.length, 1);
  assert.equal(out[0].content, 'code like } or { here');
});

test('an escaped quote does not end a string early', () => {
  const out = salvage('{"data":[{"id":"1","title":"a \\" b","content":"c"}');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'a " b');
});

test('a nested object is not mistaken for a record', () => {
  // Outermost-only reduction: the record must win over its own metadata.
  const out = salvage('{"data":[{"id":"1","title":"T","meta":{"id":"inner"}}');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'T');
});

test('objects without record-ish keys are ignored', () => {
  assert.deepEqual(salvage('{"pagination":{"page":1,"limit":10}}'), []);
});

test('salvage never throws on junk', () => {
  for (const junk of ['', '{{{{', '}}}}', 'not json at all', '{"a":', '[[[', '"']) {
    assert.doesNotThrow(() => salvage(junk), `input ${JSON.stringify(junk)}`);
  }
});

test('a truncated search renders as a list, not a JSON dump', () => {
  const out = render([{
    name: 'memory.search',
    payload: '{"data":[{"id":"1","title":"Agent Banks","content":"status: paused"},{"id":"2","title":"Next","content":"x',
  }]);
  assert.match(out, /returned 1 result/);
  assert.match(out, /Agent Banks — status: paused/);
  assert.ok(!out.includes('{"data"'), 'must not dump raw JSON at the user');
});
