'use strict';

/**
 * Per-request tool guide, appended to the system prompt.
 *
 * Why this exists — observed on the Slack concierge, 2026-11-02:
 *
 *   User:  "please search for the last 10 entries and summarise"
 *   Agent: "I need access to the memory store ... provide the command or API"
 *   User:  "please run lanonasis memory search"
 *   Agent: "I can't run that here. Run it locally and paste the output."
 *
 * Reproduced live the same night: 2 of 3 identical memory-analysis requests
 * answered "no memory/search tool is available". Three causes, all fixed
 * together because any one of them alone still produces that reply:
 *
 *  1. NOTHING TOLD THE MODEL WHAT IT COULD DO. The lane prompt never names a
 *     tool, and the role prompt documents tools that do not exist
 *     (web_search, search_memory). Tool schemas alone carry one-line
 *     descriptions with no policy: nothing said "you can act; never ask the
 *     user to run commands", or which tool answers "the last 10".
 *
 *  2. NON-NATIVE VENDORS GOT NO TOOLS AT ALL. The Pi adapter runs
 *     `--no-tools` unconditionally (a deliberate, load-bearing security
 *     choice — Pi's own tools are a shell on this host). It silently dropped
 *     the router's `tools` array, so whenever the chain landed on Pi the
 *     model had no way to reach memory and said so. The router already
 *     recovers in-text calls (vendors/_shared/tool-markup.js) and executes
 *     them through its own allow-listed tool loop; what was missing was
 *     telling the model the syntax. This guide does that, so Pi-served
 *     requests can call memory.* through the ROUTER's tools — never Pi's.
 *
 *  3. The guide is built from the tools ACTUALLY OFFERED on this request,
 *     after profile narrowing and offered-tools filtering. A prompt that
 *     advertises a tool the request never offers produces an agent that asks
 *     the human to run it by hand — so this never names anything else.
 *
 * Kept out of the lane files on purpose: lanes are pinned by
 * test/__baselines__/lane-prompts.json and describe the persona; this is
 * runtime capability, and it varies per request and per vendor.
 */

const PROTOCOL_EXAMPLE = '<tool_call>{"name": "memory.list", "arguments": {"limit": 10}}</tool_call>';

function toolName(t) {
  return t?.function?.name || t?.name || '';
}

function describeParams(t) {
  const props = t?.function?.parameters?.properties || t?.parameters?.properties || {};
  const required = new Set(t?.function?.parameters?.required || t?.parameters?.required || []);
  const parts = Object.entries(props).map(([key, schema]) => {
    const type = schema?.enum ? schema.enum.map((v) => JSON.stringify(v)).join('|') : (schema?.type || 'any');
    return `${key}${required.has(key) ? '' : '?'}: ${type}`;
  });
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/**
 * Selection guidance for the router's own memory tools. Only lines for tools
 * actually offered are emitted.
 */
const MEMORY_HINTS = {
  'memory.list': '"latest", "recent", "last N", "what did I save today/this week" → memory.list (newest first, includes content).',
  'memory.search': 'A topic, project, person, decision or keyword → memory.search with a descriptive query.',
  'memory.get': 'You need the full text of specific ids from a previous result → memory.get.',
  'memory.write': 'The user explicitly asks you to save/remember/note something → memory.write. Never save on your own initiative.',
};

/**
 * @param {object}  opts
 * @param {Array}   opts.tools        tools offered on this request (post-filtering)
 * @param {boolean} opts.nativeTools  vendor returns structured tool calls
 * @returns {string} guide text, or '' when no tools are offered
 */
function buildToolGuide({ tools, nativeTools }) {
  const offered = (Array.isArray(tools) ? tools : []).filter((t) => toolName(t));
  if (offered.length === 0) return '';

  const names = offered.map(toolName);
  const lines = [];
  lines.push('## Tools you can use on this request');
  lines.push('');
  lines.push('You have direct, live access to the tools below. The platform executes them for you, '
    + 'already authenticated as this user, and returns the results to you.');
  lines.push('');
  for (const t of offered) {
    const desc = String(t?.function?.description || t?.description || '').trim();
    lines.push(`- ${toolName(t)} ${describeParams(t)}${desc ? ` — ${desc}` : ''}`);
  }

  const hints = names.map((n) => MEMORY_HINTS[n]).filter(Boolean);
  if (hints.length) {
    lines.push('');
    lines.push('Choosing a tool:');
    for (const h of hints) lines.push(`- ${h}`);
  }

  lines.push('');
  lines.push('Rules:');
  lines.push('- When the request needs the user\'s data, call the tool yourself, immediately. Do not announce that you will, and do not ask permission.');
  lines.push('- Never ask the user to run a command, open a terminal, provide a file path, or paste data a tool can fetch. Never say you lack access to something these tools cover.');
  lines.push('- You get ONE tool round. Request everything you need in that turn — several calls at once is fine.');
  lines.push('- After results arrive, answer directly from them: lead with the answer, group related items, and cite memory titles and dates. Do not invent memories or details that are not in the results.');
  lines.push('- If a tool returns an error or nothing, say so plainly in one sentence and suggest a next step (rephrase, widen the search). Do not expose ids, URLs or error internals unless asked.');

  if (!nativeTools) {
    lines.push('');
    lines.push('### How to call a tool');
    lines.push('Write each call on its own line in exactly this form, and nothing else in that message:');
    lines.push('');
    lines.push(PROTOCOL_EXAMPLE);
    lines.push('');
    lines.push('The arguments must be valid JSON matching the tool\'s parameters. '
      + `Use only these tool names: ${names.join(', ')}. `
      + 'You will then receive the results and write your answer.');
  }

  return lines.join('\n');
}

/** Short note shown when earlier turns of the conversation were restored. */
function buildSessionNote(turnCount) {
  if (!turnCount) return '';
  return [
    '## Conversation continuity',
    `The ${turnCount} message(s) before the latest one are earlier turns of this same conversation, restored by the platform. `
      + 'Use them to resolve references such as "those", "that entry", "do it again", or "summarise them" without asking the user to repeat themselves.',
  ].join('\n');
}

/**
 * Wrap a prompt bundle so every vendor attempt receives the base prompt plus
 * the guide variant that matches its tool protocol. The wrapped object keeps
 * the bundle's interface (`systemPromptForVendor`), so ChainExecutor needs no
 * knowledge of it.
 *
 * @param {object}   bundle               from PromptComposer.compose()
 * @param {object}   opts
 * @param {Array}    opts.tools
 * @param {function} opts.supportsNativeTools (vendorId) => boolean
 * @param {string}   [opts.sessionNote]
 */
function withToolGuide(bundle, { tools, supportsNativeTools, sessionNote = '' }) {
  const nativeGuide = buildToolGuide({ tools, nativeTools: true });
  const textGuide = buildToolGuide({ tools, nativeTools: false });
  if (!nativeGuide && !sessionNote) return bundle;

  return {
    ...bundle,
    _baseBundle: bundle,
    systemPromptForVendor(vendorId) {
      const base = bundle.systemPromptForVendor(vendorId);
      // `null` is a deliberate "send no system prompt" for embedded mode;
      // respect it rather than conjuring one.
      if (base === null) return base;
      const guide = supportsNativeTools(vendorId) ? nativeGuide : textGuide;
      return [base, sessionNote, guide].filter((s) => s && String(s).trim()).join('\n\n');
    },
  };
}

module.exports = { buildToolGuide, buildSessionNote, withToolGuide, PROTOCOL_EXAMPLE };
