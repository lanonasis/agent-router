'use strict';

/**
 * Pi Vendor Adapter — local agent CLI, invoked as a subprocess.
 *
 * Every other adapter here speaks HTTP to a remote endpoint. Pi is a CLI on
 * this host, so this one spawns a process per request. That buys one thing the
 * HTTP adapters cannot offer: a NORMALISED contract across providers.
 *
 * The concrete motivation. On 2026-09-04 every `ask-ai` reply came back cut
 * mid-word, because MiniMax-M3 counts reasoning tokens against `max_tokens`
 * without ever putting them in the content — the lane's budget was spent
 * thinking rather than answering, and nothing in the OpenAI-shaped response said
 * so. Each vendor spells that control differently, or not at all. Pi exposes one
 * flag, `--thinking`, and maps it per provider. Routing a lane through Pi means
 * the router states its intent once instead of learning each vendor's dialect
 * the hard way.
 *
 * ── Everything below is deliberate, and most of it is load-bearing ──────────
 *
 * 1. NO TOOLS, ALWAYS. Pi ships read, bash, edit and write tools. This process
 *    runs as the router, on the router's host. A vendor that can run bash here
 *    is not a vendor, it is a remote shell. `--no-tools` is passed
 *    unconditionally and is not configurable — the router runs its own tool loop
 *    (core/tool-loop.js) against an allowlist, and that is the only tool path
 *    this service has.
 *
 * 2. NEVER PI'S DEFAULTS. `pi`'s configured default provider on this host is
 *    `hetz` with `defaultThinkingLevel: "high"` — the same upstream credential
 *    that was returning 401 for OpenClaw, and the same thinking level that
 *    caused the truncation above. `--provider` and `--model` are always passed
 *    explicitly; a request that cannot name both is refused rather than silently
 *    falling through to a broken default.
 *
 * 3. NO EXTENSIONS, SKILLS OR PROMPT TEMPLATES. Measured on this host: a bare
 *    `pi -p` took 89 SECONDS and returned nothing, because it loads the full
 *    extension stack (agent-flow, subagents, mcp-adapter and more) on every
 *    invocation. With `-ne -ns -np` the same call takes 1.6s. It is also third
 *    party code executing inside a request path.
 *
 * 4. NO CONTEXT FILES. Pi discovers AGENTS.md and CLAUDE.md from its working
 *    directory. This router's own repository instructions have no business
 *    shaping a caller's answer, so `--no-context-files` is passed and the
 *    process is started in an empty directory as a second line of defence.
 *
 * 5. NO SESSIONS. `--no-session` keeps this stateless, matching the router's
 *    contract that each request is independent.
 *
 * 6. PROMPT ON STDIN, ARGS AS AN ARRAY. The prompt never goes through argv or a
 *    shell string: `spawn` is called with an argument array, so there is no
 *    shell to inject into and no length limit to trip over.
 */

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { assertUsableCompletion } = require('../_shared/response-contract');

const PI_BIN = process.env.PI_BIN || 'pi';
const TIMEOUT_MS = parseInt(process.env.PI_TIMEOUT_MS || '30000', 10);

// The provider Pi should route to. Explicit because Pi's own default on this
// host is a credential that has been failing; see note 2 above.
const DEFAULT_PROVIDER = process.env.PI_PROVIDER || 'minimax';

/**
 * off | minimal | low | medium | high | xhigh | max
 *
 * `off` by default. The router asks vendors for an ANSWER of a given length;
 * reasoning that eats that budget without appearing in the answer is exactly
 * the overhead this adapter exists to remove. Raise it per deployment if a lane
 * genuinely benefits.
 */
const THINKING = process.env.PI_THINKING || 'off';

// Started here so there is no AGENTS.md/CLAUDE.md within reach even if the
// --no-context-files behaviour ever changes.
let neutralCwd = null;
function workingDirectory() {
  if (neutralCwd && fs.existsSync(neutralCwd)) return neutralCwd;
  neutralCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'onasis-pi-'));
  return neutralCwd;
}

/**
 * Environment for the child process.
 *
 * HOME is redirected because Pi writes a credential store under `$HOME/.pi`. The
 * router runs as its own service user with no home directory, so the default
 * inherited HOME made every call fail with
 * `EACCES: permission denied, mkdir '/home/onasis-ai-router/.pi/agent'` —
 * which the health probe correctly reported as an unhealthy vendor.
 *
 * Pointing HOME at the same throwaway directory used as cwd also means Pi never
 * reads whatever credentials happen to sit in the invoking user's `~/.pi`. The
 * API key comes from the inherited environment instead (Pi falls back to the
 * provider's own env var), which keeps it out of argv — and therefore out of
 * `ps` on a shared host — where `--api-key` would have put it.
 */
function childEnv() {
  return { ...process.env, HOME: workingDirectory() };
}

/**
 * Flatten a message array into one prompt.
 *
 * Pi takes a single prompt rather than a conversation, so multi-turn history is
 * rendered with explicit role labels. This is a real fidelity loss versus the
 * HTTP adapters — the model sees a transcript rather than structured turns —
 * and is why Pi is not a drop-in replacement for them.
 *
 * `system` is NOT folded in here: it goes to --system-prompt, so that the
 * service's own instruction stays distinguishable from conversation content,
 * exactly as core/message-policy.js requires everywhere else.
 */
function renderConversation(messages) {
  const turns = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue;
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
    if (role === 'system' || role === 'developer') continue; // owned by systemPrompt
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content ?? '');
    if (!content) continue;
    if (role === 'assistant') turns.push(`Assistant: ${content}`);
    else if (role === 'tool') turns.push(`Tool result (${message.tool_name || 'tool'}): ${content}`);
    else turns.push(`User: ${content}`);
  }
  return turns.join('\n\n');
}

/** Map Pi's stop reason onto the internal contract's `done_reason`. */
function mapStopReason(stopReason, rawStopReason) {
  const raw = String(rawStopReason || '').toLowerCase();
  const mapped = String(stopReason || '').toLowerCase();
  if (raw.includes('max_token') || raw === 'length' || mapped === 'length') return 'length';
  return 'stop';
}

/**
 * Parse Pi's `--mode json` output.
 *
 * The stream is JSONL. Only the terminal `message_end`/`turn_end` events carry
 * final content, usage and stop reason, so text deltas are ignored rather than
 * reassembled — reassembling would risk disagreeing with what Pi itself
 * considers the final message.
 */
function parsePiStream(stdout) {
  let content = '';
  let usage = null;
  let stopReason = null;
  let rawStopReason = null;

  for (const line of String(stdout).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // a partial line from a killed process
    }
    if (event.type !== 'message_end' && event.type !== 'turn_end') continue;

    const message = event.message;
    if (!message || message.role !== 'assistant') continue;

    const text = Array.isArray(message.content)
      ? message.content.filter((part) => part && part.type === 'text').map((part) => part.text).join('')
      : '';
    if (text) content = text;
    if (message.usage) usage = message.usage;
    if (message.stopReason) stopReason = message.stopReason;
    if (message.rawStopReason) rawStopReason = message.rawStopReason;
  }

  return { content, usage, stopReason, rawStopReason };
}

function normaliseResponse({ content, usage, stopReason, rawStopReason }) {
  return {
    message: { role: 'assistant', content },
    done_reason: mapStopReason(stopReason, rawStopReason),
    // Pi never returns native tool calls here: --no-tools is unconditional.
    tool_calls: [],
    usage: {
      prompt_tokens:     Number(usage?.input) || 0,
      completion_tokens: Number(usage?.output) || 0,
      total_tokens:      Number(usage?.totalTokens)
        || (Number(usage?.input) || 0) + (Number(usage?.output) || 0),
    },
  };
}

function buildArgs(internalRequest, model) {
  const provider = internalRequest.piProvider || DEFAULT_PROVIDER;
  const thinking = internalRequest.piThinking || THINKING;

  const args = [
    '--print',              // non-interactive
    '--mode', 'json',
    '--no-tools',           // see note 1 — not configurable
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--no-session',
    '--offline',            // no startup network calls in a request path
    '--thinking', String(thinking),
    '--provider', String(provider),
    '--model', String(model),
  ];

  if (internalRequest.systemPrompt) {
    args.push('--system-prompt', String(internalRequest.systemPrompt));
  }

  return args;
}

async function chat(internalRequest, model) {
  if (!model) {
    // Refused rather than defaulted: Pi's own default is a provider that has
    // been returning 401 on this host.
    throw new Error('Pi adapter: no model supplied — refusing to fall back to Pi defaults');
  }

  const prompt = renderConversation(internalRequest.messages);
  if (!prompt) {
    throw new Error('Pi adapter: no user content to send');
  }

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;
  const args = buildArgs(internalRequest, model);

  const { stdout, stderr, code, timedOut } = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(PI_BIN, args, {
        cwd: workingDirectory(),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Inherit the environment for provider credentials, but never a shell.
        shell: false,
        env: childEnv(),
      });
    } catch (error) {
      reject(new Error(`Pi adapter: failed to spawn ${PI_BIN} — ${error.message}`));
      return;
    }

    let out = '';
    let err = '';
    let settled = false;
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Pi adapter: ${error.message}`));
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code: exitCode, timedOut: killed });
    });

    child.stdin.on('error', () => { /* closed early; the close handler reports */ });
    child.stdin.end(prompt);
  });

  if (timedOut) {
    throw new Error(`Pi adapter: timed out after ${timeoutMs}ms`);
  }

  const parsed = parsePiStream(stdout);

  if (code !== 0 && !parsed.content) {
    // stderr is truncated hard: Pi is verbose on startup and the tail is the
    // part that says what went wrong.
    throw new Error(`Pi adapter: exited ${code} — ${String(stderr).trim().slice(-200) || 'no output'}`);
  }

  return assertUsableCompletion(normaliseResponse(parsed), {
    vendorId: 'pi',
    sentinels: internalRequest.errorSentinels,
  });
}

/**
 * Liveness. Deliberately NOT a completion probe: core/vendor-health.js already
 * issues a real one through chat(), and spawning a second process here would
 * double the cost of every health refresh for no extra signal.
 */
async function healthCheck() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(PI_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 5000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

module.exports = {
  chat,
  healthCheck,
  // Exported for tests — the parsing and flattening rules are the parts most
  // likely to drift as Pi's event stream evolves.
  _renderConversation: renderConversation,
  _parsePiStream: parsePiStream,
  _mapStopReason: mapStopReason,
  _buildArgs: buildArgs,
};
