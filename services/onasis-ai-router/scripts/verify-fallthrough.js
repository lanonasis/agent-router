#!/usr/bin/env node
/**
 * Manual live verifier for the vendor response contract (Phase 2).
 *
 * Run:
 *   export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
 *   dotenvx run --no-armor -f .env.production -- node scripts/verify-fallthrough.js
 *
 * Expected: 0 LEAKED rows, every row served by a vendor other than openclaw.
 * A LEAKED row means a gateway error string reached the caller as an answer.
 */
// adapter's chat() is replaced — with the exact 200-body the live gateway
// returns when it fails — so the fall-through path runs for real.
const R = require('path').resolve(__dirname, '..');
const { VENDOR_REGISTRY } = require(R+'/vendors');
const { assertUsableCompletion } = require(R+'/vendors/_shared/response-contract');
const { ChainExecutor } = require(R+'/core/chain-executor');
const { VendorScoreboard } = require(R+'/core/vendor-scoreboard');

VENDOR_REGISTRY.openclaw.adapter.chat = async (internalRequest) =>
  assertUsableCompletion(
    { message: { role: 'assistant', content: "⚠️ Agent couldn't generate a response. Please try again." },
      done: true, done_reason: 'stop', tool_calls: [], usage: {} },
    { vendorId: 'openclaw', sentinels: internalRequest.errorSentinels },
  );

const quiet = { error(){}, warn(){}, info(){} };
const ex = new ChainExecutor({ scoreboard: new VendorScoreboard(), logger: quiet });
(async () => {
  let leaked = 0;
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    try {
      const { adapterResponse, selectedVendor } = await ex.run({
        useCase: 'ask-ai',
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
        promptBundle: { systemPromptForVendor: () => 'Answer in one sentence.' },
        temperature: 0.65, maxTokens: 350, tools: [],
      });
      const c = adapterResponse.message.content.trim();
      const bad = /Agent couldn't generate/i.test(c);
      if (bad) leaked++;
      console.log(`${i+1} ${String(Date.now()-t0).padStart(6)}ms via=${selectedVendor._vendorId.padEnd(9)} ${bad?'LEAKED':'ok    '} ${JSON.stringify(c.slice(0,58))}`);
    } catch (e) { console.log(`${i+1} ALL-FAILED ${e.message.slice(0,70)}`); }
  }
  console.log(`\nLEAKED rows: ${leaked}/4  (openclaw forced to fail every time)`);
})();
