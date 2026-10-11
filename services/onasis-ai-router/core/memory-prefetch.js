'use strict';

/**
 * Optional memory-brief enrichment for the chat hot path.
 *
 * Extracted verbatim from core/ai-service-router.js (2026-08-27). No behaviour
 * change: still swallows its own errors to '' so a memory outage degrades the
 * answer rather than failing the request, still warm-caches for 2 minutes, and
 * still de-duplicates concurrent fetches for the same key.
 *
 * `buildAuthHeaders` is injected rather than moved because the tool
 * implementations share it.
 */

const { fetchWithRetry } = require('../vendors/_shared/http-client');

class MemoryPrefetch {
  constructor({
    apiBaseUrl, memorySearchPath, topK, timeoutMs, enabled, maxChars,
    buildAuthHeaders, logger,
  }) {
    this.apiBaseUrl = apiBaseUrl;
    this.memorySearchPath = memorySearchPath;
    this.topK = topK;
    this.timeoutMs = timeoutMs;
    this.enabled = enabled;
    this.maxChars = maxChars;
    this.buildAuthHeaders = buildAuthHeaders;
    this.logger = logger;

    this._cache = new Map();
    // Tracks in-flight prefetch requests to prevent duplicate concurrent fetches
    this._inflight = new Map();
  }

  getLatestUserMessage(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i] && messages[i].role === 'user' && typeof messages[i].content === 'string') {
        return messages[i].content;
      }
    }
    return '';
  }

  /**
   * Cache identity for one prefetch.
   *
   * This instance is a process-wide singleton (core/ai-service-router.js:60),
   * so its Maps are shared by every caller, while the search underneath is
   * per-caller via buildAuthHeaders(req). The key must therefore carry the
   * authenticated identity: keyed on the question alone, two tenants asking the
   * same thing inside the TTL shared a brief, and the brief is injected into the
   * prompt as a system message. Filters are included because they change the
   * result set for the same question.
   *
   * Returns null when the caller cannot be identified — that response is not
   * attributable to anyone, so it is fetched fresh and never stored.
   */
  _cacheKey(req, body, latestUserMessage) {
    const uai = (req && req.uai) || {};
    const authId = uai.authId || '';
    const organizationId = uai.organizationId || '';
    if (!authId && !organizationId) return null;

    const memoryType = body.memory_type || body.type || '';
    // Sorted so tag order does not fragment the cache into equivalent entries.
    const tags = Array.isArray(body.tags) ? [...body.tags].sort().join(',') : '';

    return JSON.stringify([
      authId, organizationId, memoryType, tags, latestUserMessage.slice(0, 200),
    ]);
  }

  async brief(req, messages, body) {
    if (!this.enabled) return '';

    const latestUserMessage = this.getLatestUserMessage(messages);
    if (!latestUserMessage) return '';

    const cacheKey = this._cacheKey(req, body, latestUserMessage);

    // Unidentified caller: fetch, but never read from or write to the shared
    // cache — an unattributable result must not be served to anyone else.
    if (cacheKey === null) {
      return this._executeFetch(req, body, null, latestUserMessage);
    }

    // Check warm cache first
    const cached = this._cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Deduplicate concurrent requests for the same cache key (race condition fix)
    if (this._inflight.has(cacheKey)) {
      return this._inflight.get(cacheKey);
    }

    const fetchPromise = this._executeFetch(req, body, cacheKey, latestUserMessage)
      .finally(() => this._inflight.delete(cacheKey));

    this._inflight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  async _executeFetch(req, body, cacheKey, latestUserMessage) {
    const searchBody = {
      query: latestUserMessage,
      limit: this.topK,
      memory_type: body.memory_type || body.type || undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined
    };

    try {
      const response = await fetchWithRetry(`${this.apiBaseUrl}${this.memorySearchPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(req)
        },
        body: JSON.stringify(searchBody),
        timeoutMs: this.timeoutMs,
        // No retry: this is optional enrichment already wrapped in a swallow-to-''
        // fallback — retrying would double the worst-case hot-path delay for no
        // correctness benefit.
        retries: 0,
      });

      if (!response.ok) return '';

      const data = await response.json();
      const brief = this.buildWorkingMemoryBrief(data);

      if (brief && cacheKey !== null) {
        this._cache.set(cacheKey, {
          value: brief,
          expiresAt: Date.now() + 2 * 60 * 1000
        });
      }

      return brief;
    } catch (error) {
      // Guarded: this is the swallow that keeps a memory outage from failing the
      // request. If it throws, it defeats its own purpose — which is exactly
      // what happened when the logger was wired in undefined.
      this.logger?.warn?.('Memory prefetch failed', { error: error.message });
      return '';
    }
  }

  buildWorkingMemoryBrief(searchResponse) {
    const results = searchResponse?.data || [];
    if (!Array.isArray(results) || results.length === 0) return '';

    const lines = ['Working memory brief (prefetch):'];
    results.forEach((entry, index) => {
      const title = entry.title || 'Untitled';
      const content = typeof entry.content === 'string' ? entry.content : '';
      const snippet = content.length > 220 ? `${content.slice(0, 220)}…` : content;
      const tags = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
      const updated = entry.updated_at || entry.created_at || '';
      const id = entry.id || '';
      const line = `#${index + 1} [${id}] ${title} | ${tags} | ${updated} | ${snippet}`.trim();
      lines.push(line);
    });

    let brief = lines.join('\n');
    if (brief.length > this.maxChars) {
      brief = `${brief.slice(0, this.maxChars)}…`;
    }
    return brief;
  }
}

module.exports = { MemoryPrefetch };
