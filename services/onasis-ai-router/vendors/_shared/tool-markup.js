'use strict';

/**
 * In-text tool-call markup — INTERNAL ONLY.
 *
 * Observed live 2026-09-26 on `use_case: repl-nlp`, HTTP 200. The request
 * offered only the router's own memory.search / memory.get / memory.write, and
 * the `response` text the client received contained:
 *
 *   ...Let me first inspect what's available...]<]Onasis[>[<tool_call>
 *   {"name": "bash", "arguments": {...
 *
 * Two things reached the client that never should have:
 *
 *  1. A tool call written INTO the text rather than returned as a structured
 *     call. A model emits this when the transport it was reached through gave
 *     it no native tool channel (the pi adapter runs `--no-tools`
 *     unconditionally, so a tool-trained model has nowhere else to put one), or
 *     when a provider fails to parse its own tool syntax. Nothing on the router
 *     recognised the syntax: extractSoftToolCalls() only finds bare JSON, and
 *     the tool-call blob guard only fires when the text BEGINS with `{`.
 *     And the tool — `bash` — was never offered.
 *
 *  2. A chat-template control token. `]<]…[>[` is a vendor template delimiter,
 *     not prose. The `Onasis` inside it is the persona sanitiser doing its job
 *     on the vendor name the token carried (PERSONA_LEAK_BLOCKLIST, whole-word)
 *     — the sanitiser did not mangle a delimiter, it renamed text inside one
 *     that should never have been there. So the fix is to remove the token
 *     BEFORE the sanitiser runs, not to change the sanitiser.
 *
 * This module recognises the in-text syntaxes vendors are known to emit,
 * parses the calls it can, and returns the text with every trace removed. It
 * never decides what is executable: the caller filters calls against the tools
 * actually offered on the request, and a call to anything else is dropped.
 *
 * Deliberately NOT stripped: prose that mentions a tag name, and fenced code
 * blocks. A `<tool_call>` wrapper is only treated as a call when its body looks
 * like one (JSON object, `<invoke>`, or a `name` line), so an explanation of the
 * syntax survives; template control tokens are removed unconditionally because
 * they never occur in legitimate prose.
 */

// Wrapper forms: an opening tag, a body, and a closing tag that may be missing
// when the model hit its token ceiling mid-call (the live sample was cut).
// `ns:` covers vendor-namespaced variants such as `<minimax:tool_call>`.
const BLOCK_OPENERS = [
  { open: /<(?:[a-z][\w-]{0,31}:)?tool_call>/i, close: /<\/(?:[a-z][\w-]{0,31}:)?tool_call>/i, requireCallBody: true },
  { open: /<(?:[a-z][\w-]{0,31}:)?tool_calls>/i, close: /<\/(?:[a-z][\w-]{0,31}:)?tool_calls>/i, requireCallBody: true },
  { open: /<(?:[a-z][\w-]{0,31}:)?function_calls>/i, close: /<\/(?:[a-z][\w-]{0,31}:)?function_calls>/i, requireCallBody: true },
  // Qwen3-coder style: <function=name> ... </function>
  { open: /<function=([\w.-]{1,64})>/i, close: /<\/function>/i, requireCallBody: false, namedOpener: true },
  // DeepSeek / Kimi section markers — strip-only; their inner grammar varies by release.
  { open: /<[|｜]tool[▁_]calls?[▁_](?:section[▁_])?begin[|｜]>/i, close: /<[|｜]tool[▁_]calls?[▁_](?:section[▁_])?end[|｜]>/i, requireCallBody: false, stripOnly: true },
];

// Chat-template control tokens. None of these occur in legitimate prose.
const TEMPLATE_TOKENS = [
  /\]<\][^\[\]\n]{0,64}\[>\[/g,          // ]<]name[>[   (observed live 2026-09-26)
  /\]~!?b\]/g,                            // ]~b]  ]~!b]
  /\]~!b\[/g,                             // ]~!b[
  /\[e~\[/g,                              // [e~[
  /<\|[A-Za-z0-9_▁.:-]{2,48}\|>/g,        // <|im_start|> <|eot_id|> <|tool_call_begin|> …
  /<｜[^｜\n]{1,48}｜>/g,                  // <｜tool▁sep｜> (full-width bars)
];

const FENCE_RE = /```[\s\S]*?```/g;

function coerceValue(raw) {
  const text = String(raw).trim();
  if (!text) return '';
  try { return JSON.parse(text); } catch { return text; }
}

function parseArgs(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'object') return raw;
  const parsed = coerceValue(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** `<invoke name="x"><parameter name="k">v</parameter></invoke>` (and unterminated). */
function parseInvokes(body) {
  const calls = [];
  const invokeRe = /<invoke\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)(?:<\/invoke>|$)/gi;
  let m;
  while ((m = invokeRe.exec(body)) !== null) {
    const args = {};
    const paramRe = /<parameter\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/parameter>/gi;
    let p;
    while ((p = paramRe.exec(m[2])) !== null) args[p[1]] = coerceValue(p[2]);
    calls.push({ name: m[1], arguments: args, complete: /<\/invoke>/i.test(m[0]) });
  }
  return calls;
}

/** `<parameter=k>v</parameter>` inside a `<function=name>` block. */
function parseEqualsParams(body) {
  const args = {};
  const re = /<parameter=([\w.-]{1,64})>([\s\S]*?)<\/parameter>/gi;
  let m;
  while ((m = re.exec(body)) !== null) args[m[1]] = coerceValue(m[2]);
  return args;
}

/** JSON body: one call object, an array of them, or `{tool_calls:[...]}`. */
function parseJsonBody(body) {
  const trimmed = body.trim();
  const start = trimmed.search(/[{[]/);
  if (start === -1) return null;
  const candidate = trimmed.slice(start);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // Truncated mid-emission — the live case. The name is still recoverable
    // for logging and for the offered-tools decision; the call is marked
    // incomplete so it can never be executed with half its arguments.
    const name = candidate.match(/"(?:name|tool)"\s*:\s*"([^"]{1,128})"/);
    return name ? [{ name: name[1], arguments: {}, complete: false }] : [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.tool_calls) ? parsed.tool_calls : [parsed];
  return list
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      name: c.name || c.tool || c.function?.name || '',
      arguments: parseArgs(c.arguments ?? c.parameters ?? c.function?.arguments),
      complete: true,
    }))
    .filter((c) => c.name);
}

/** GLM style: first line is the name, then <arg_key>k</arg_key><arg_value>v</arg_value>. */
function parseKeyValueBody(body) {
  const name = body.trim().split('\n')[0].trim();
  if (!/^[\w.-]{1,64}$/.test(name)) return [];
  const args = {};
  const re = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
  let m;
  while ((m = re.exec(body)) !== null) args[m[1].trim()] = coerceValue(m[2]);
  return [{ name, arguments: args, complete: true }];
}

function looksLikeCallBody(body) {
  const t = body.trim();
  return t === ''                              // an empty/truncated wrapper is still markup
    || /^[{[]/.test(t)
    || /<invoke\s+name=/i.test(t)
    || /<arg_key>/i.test(t);
}

function parseBlockBody(body, opener, openMatch) {
  if (opener.stripOnly) return [];
  if (opener.namedOpener) {
    return [{ name: openMatch[1], arguments: parseEqualsParams(body), complete: true }];
  }
  if (/<invoke\s+name=/i.test(body)) return parseInvokes(body);
  const json = parseJsonBody(body);
  if (json && json.length > 0) return json;
  if (/<arg_key>/i.test(body)) return parseKeyValueBody(body);
  return [];
}

/** Find the earliest wrapper opening at or after `from`, outside fenced code. */
function findNextOpener(text, from, fences) {
  let best = null;
  for (const opener of BLOCK_OPENERS) {
    const re = new RegExp(opener.open.source, opener.open.flags.includes('g') ? opener.open.flags : `${opener.open.flags}g`);
    re.lastIndex = from;
    let m;
    while ((m = re.exec(text)) !== null) {
      const inFence = fences.some(([s, e]) => m.index >= s && m.index < e);
      if (!inFence) break;
    }
    if (m && (!best || m.index < best.match.index)) best = { opener, match: m };
  }
  return best;
}

/**
 * Extract in-text tool calls and return the text with all tool/template markup removed.
 *
 * @param {string} text
 * @returns {{ text: string, calls: Array<{id:string,name:string,arguments:object,complete:boolean}>, found: boolean }}
 *   `found` is true when ANY markup was removed, even if no call was parseable.
 */
function extractInTextToolCalls(text) {
  if (typeof text !== 'string' || text === '') return { text, calls: [], found: false };

  const fences = [];
  let fm;
  FENCE_RE.lastIndex = 0;
  while ((fm = FENCE_RE.exec(text)) !== null) fences.push([fm.index, fm.index + fm[0].length]);

  const calls = [];
  let out = '';
  let cursor = 0;
  let found = false;

  for (;;) {
    const next = findNextOpener(text, cursor, fences);
    if (!next) break;
    const { opener, match } = next;
    const bodyStart = match.index + match[0].length;
    const closeRe = new RegExp(opener.close.source, opener.close.flags);
    const rest = text.slice(bodyStart);
    const close = closeRe.exec(rest);
    const body = close ? rest.slice(0, close.index) : rest;
    const blockEnd = close ? bodyStart + close.index + close[0].length : text.length;

    if (opener.requireCallBody && !looksLikeCallBody(body)) {
      // A tag that is being talked about, not used. Leave it in place.
      out += text.slice(cursor, bodyStart);
      cursor = bodyStart;
      continue;
    }

    found = true;
    for (const call of parseBlockBody(body, opener, match)) {
      calls.push({
        id: '',
        name: String(call.name),
        arguments: call.arguments || {},
        complete: close ? call.complete !== false : false,
      });
    }
    out += text.slice(cursor, match.index);
    cursor = blockEnd;
  }
  out += text.slice(cursor);

  for (const re of TEMPLATE_TOKENS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      found = true;
      re.lastIndex = 0;
      out = out.replace(re, '');
    }
  }

  if (found) {
    out = out
      .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')   // the seam left where a block was cut
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return { text: found ? out : text, calls, found };
}

/** Strip only — for the last-line guard on text that is about to leave the service. */
function stripToolMarkup(text) {
  return extractInTextToolCalls(text).text;
}

/** Names of the tools a request actually offered. */
function offeredToolNames(tools) {
  return new Set((Array.isArray(tools) ? tools : [])
    .map((t) => t?.function?.name || t?.name)
    .filter(Boolean));
}

module.exports = { extractInTextToolCalls, stripToolMarkup, offeredToolNames };
