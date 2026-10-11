#!/usr/bin/env node
/**
 * Manual live verifier for outcome-typed circuit breaking (Phase 3).
 *
 * Forces openclaw and minimax to fail so the chain reaches the genuinely
 * credit-exhausted cloud vendors. openai/anthropic are NOT mocked — their real
 * 429/400 billing errors are the point.
 *
 * Run:
 *   export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
 *   dotenvx run --no-armor -f .env.production -- node scripts/verify-circuit-eject.js
 *
 * Expected: run 1 is slow (it discovers the dead vendors); runs 2+ are an order
 * of magnitude faster because openai/anthropic are skipped. Observed
 * 2026-08-27: 26995ms -> 971ms.
 */
// Resolve requires against the service root. This line was missing entirely —
// `R` was referenced on the four lines below but never defined, so the script
// threw ReferenceError on startup and had never actually been runnable as
// committed. Reported on PR #1 by Copilot, 2026-09-03.
const R = require('path').resolve(__dirname, '..');
const { ChainExecutor } = require(R+'/core/chain-executor');
const { VendorScoreboard } = require(R+'/core/vendor-scoreboard');
const { VENDOR_REGISTRY } = require(R+'/vendors');
const { assertUsableCompletion } = require(R+'/vendors/_shared/response-contract');

// Force the two working vendors to fail so the chain reaches the genuinely
// credit-exhausted cloud vendors. openai/anthropic are NOT mocked — their
// real 429/400 billing errors are what we want to observe.
for (const id of ['openclaw','minimax']) {
  VENDOR_REGISTRY[id].adapter.chat = async (ir) =>
    assertUsableCompletion({ message:{role:'assistant',content:"⚠️ Agent couldn't generate a response. Please try again."},
      done:true,done_reason:'stop',tool_calls:[],usage:{}},
      { vendorId:id, sentinels:[/^⚠️\s*Agent couldn't generate a response/i] });
}
const quiet={error(){},warn(){},info(){}};
const sb=new VendorScoreboard();
const ex=new ChainExecutor({scoreboard:sb,logger:quiet});
(async()=>{
  for(let i=0;i<3;i++){
    const t0=Date.now();
    try{
      const {selectedVendor}=await ex.run({useCase:'ask-ai',
        messages:[{role:'user',content:'Capital of France?'}],
        promptBundle:{systemPromptForVendor:()=>'One sentence.'},
        temperature:0.65,maxTokens:350,tools:[]});
      console.log(`run ${i+1}: ${String(Date.now()-t0).padStart(6)}ms via=${selectedVendor._vendorId}`);
    }catch(e){console.log(`run ${i+1}: ${String(Date.now()-t0).padStart(6)}ms ALL-FAILED (expected — every vendor is down)`);}
    console.log('   circuits: ' + ['openclaw','minimax','openai','anthropic','ollama']
      .map(v=>`${v}=${sb.isOpen(v)?'OPEN':'-'}`).join(' '));
  }
})();
