'use strict';

/**
 * Does the latest user turn plainly need the user's memory bank?
 *
 * Used only to ORDER the vendor chain (native-tool vendors first). A false
 * negative costs nothing new — the request runs on the declared order, and
 * non-native vendors can still call tools through the in-text protocol. A
 * false positive costs only latency preference. So this is tuned for
 * precision on the phrasings concierge users actually send, not for recall.
 */

const MEMORY_INTENT = [
  /\bmemor(y|ies)\b/i,
  /\b(my|our)\s+(notes?|entries|records|saved|knowledge|context|history)\b/i,
  /\b(last|latest|recent|newest|previous)\s+(\d+\s+)?(entries|entry|memories|notes|items|records|saves?)\b/i,
  /\b(search|find|look\s*up|recall|retrieve|fetch|list|show)\b[^.?!\n]{0,40}\b(entries|notes|memor|saved|records)/i,
  /\bwhat\s+(do|did)\s+(i|we)\s+(know|save|note|write|record)\b/i,
  /\b(remember|recall)\s+(when|what|that|the)\b/i,
  /\b(summari[sz]e|recap)\b[^.?!\n]{0,40}\b(entries|notes|memor|saved|week|today)/i,
];

function latestUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.role === 'user') {
      return typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    }
  }
  return '';
}

/**
 * @param {Array}       messages      caller messages
 * @param {Set<string>} offeredNames  tool names offered on this request
 */
function wantsMemoryTools(messages, offeredNames) {
  const names = offeredNames instanceof Set ? offeredNames : new Set(offeredNames || []);
  const hasMemoryTool = [...names].some((n) => String(n).startsWith('memory.'));
  if (!hasMemoryTool) return false;
  const text = latestUserText(messages).slice(0, 2000);
  return MEMORY_INTENT.some((re) => re.test(text));
}

module.exports = { wantsMemoryTools, latestUserText };
