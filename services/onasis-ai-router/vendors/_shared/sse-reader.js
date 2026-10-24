'use strict';

/**
 * Parse a vendor SSE (Server-Sent Events) response into individual events.
 *
 * Most vendor streaming APIs (Ollama, OpenAI, MiniMax) use the SSE format:
 *
 *     data: {"json": ...}\n\n
 *
 * Anthropic uses a richer format with event labels:
 *
 *     event: content_block_delta\n\n
 *     data: {"type":"content_block_delta","delta":{"text":"…"}}\n\n
 *
 * This function handles both. It reads from a `Response.body` (ReadableStream)
 * and yields one decoded JSON object per SSE event.
 *
 * Mode is determined by the `vendorId` argument — not from buffer content —
 * because a TCP chunk can arrive mid-event and make content-based detection
 * unreliable (the bug that caused #4: Anthropic deltas misread depending on
 * network timing).
 *
 * Returns an async generator that yields { json, event_type?, raw } per event.
 * `event_type` is only present when the vendor sends an `event:` line.
 *
 * @param {Response} response — fetch Response whose body is the SSE stream
 * @param {object} [opts]
 * @param {string} [opts.vendorId] — determines parsing mode:
 *   `'anthropic'` → expect `event:` lines before each data block (SSE mode)
 *   anything else → split on `\n` (NDJSON / Ollama / OpenAI mode)
 * @yields {{ json: object, event_type?: string, raw: string }}
 */
async function* sseIterator(response, opts = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const vendorId = opts?.vendorId || '';
  // Anthropic always uses SSE with event labels; everything else is
  // NDJSON or flat SSE — split on `\n` only.
  const isAnthropic = vendorId === 'anthropic';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let parts = [];
      let partial = '';

      if (isAnthropic) {
        // SSE mode: split on `\n\n` first (event boundary).
        parts = buffer.split('\n\n');
        partial = parts.pop() ?? '';
      } else {
        // NDJSON / flat SSE: try `\n\n` first; if none found, fall back to `\n`.
        parts = buffer.split('\n\n');
        if (parts.length <= 1) {
          parts = buffer.split('\n');
          partial = parts.pop() ?? '';
        } else {
          partial = parts.pop() ?? '';
        }
      }

      // Keep the last partial chunk in the buffer for the next read.
      buffer = partial;

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        let eventType;
        let content = trimmed;

        // Check for an "event:" line (used by Anthropic)
        const eventMatch = content.match(/^event:\s*(\S+)\s*\n*/);
        if (eventMatch) {
          eventType = eventMatch[1];
          content = content.slice(eventMatch[0].length);
        }

        // Remove the optional "data: " prefix used by most vendors.
        const body = content.startsWith('data: ')
          ? content.slice(6)
          : content;

        if (!body) continue;

        // Some vendors send "data: [DONE]" to signal end-of-stream.
        if (body === '[DONE]') break;

        try {
          yield { json: JSON.parse(body), event_type: eventType, raw: body };
        } catch {
          // Corrupt SSE fragment — skip it.
        }
      }
    }

    // Flush any leftover content in the buffer (handles the final NDJSON line
    // or incomplete SSE event at EOF that never got a delimiter).
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      let eventType;
      let body = trimmed;

      const eventMatch = trimmed.match(/^event:\s*(\S+)\s*\n*/);
      if (eventMatch) {
        eventType = eventMatch[1];
        body = trimmed.slice(eventMatch[0].length);
      }

      body = body.startsWith('data: ') ? body.slice(6) : body;

      if (body && body !== '[DONE]') {
        try {
          yield { json: JSON.parse(body), event_type: eventType, raw: body };
        } catch {
          // Last fragment was corrupt — safe to drop.
        }
      }
    }
  } finally {
    // Always cancel the reader to release the underlying connection.
    try { reader.cancel(); } catch { /* already done */ }
  }
}

module.exports = { sseIterator };
