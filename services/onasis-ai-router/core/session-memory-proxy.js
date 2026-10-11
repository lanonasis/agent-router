'use strict';

/**
 * Redis Agent Memory proxy — INTERNAL ONLY
 *
 * Holds the real Redis Agent Memory credentials server-side (via dotenvx,
 * same as every other secret in this service) so that client packages that
 * ship publicly — e.g. @lanonasis/repl-cli — never receive the raw
 * AGENT_MEMORY_API_KEY. Clients authenticate to THIS router with their own
 * lano_-style or OAuth credential (the same one already used for the
 * ai-chat route); the router resolves that to req.uai.authId and uses it
 * as the Agent Memory actorId, so one caller can never read or write
 * another's session.
 *
 * Session-memory tier only — this service does not proxy Agent Memory's
 * long-term memory/extraction tier. Long-term memory for repl-cli continues
 * to go through the existing @lanonasis/memory-client path.
 *
 * Uses the official @redis-iris/agent-memory SDK rather than a hand-rolled
 * fetch wrapper. Two things needed explicit configuration to match this
 * service's existing behavior rather than trusting SDK defaults:
 *  - retryConfig: {strategy: 'none'} — this write happens inside our own
 *    HTTP request/response cycle; retrying would double client-visible
 *    latency for zero benefit, the same class of bug fixed in
 *    vendors/_shared/http-client.js's isRetryableError().
 *  - timeoutMs — matches the AGENT_MEMORY_TIMEOUT_MS this service already
 *    exposed via .env.template.
 * The SDK wraps native fetch(), so it automatically inherits the process-
 * wide undici keep-alive Agent installed by vendors/_shared/http-client.js
 * — no separate connection-pooling setup needed here.
 */

const { AgentMemory } = require('@redis-iris/agent-memory');
const errors = require('@redis-iris/agent-memory/models/errors');

const AGENT_MEMORY_URL = process.env.AGENT_MEMORY_URL || '';
const AGENT_MEMORY_STORE_ID = process.env.AGENT_MEMORY_STORE_ID || '';
const AGENT_MEMORY_API_KEY = process.env.AGENT_MEMORY_API_KEY || '';
const TIMEOUT_MS = parseInt(process.env.AGENT_MEMORY_TIMEOUT_MS || '5000', 10);

function isConfigured() {
  return !!(AGENT_MEMORY_URL && AGENT_MEMORY_STORE_ID && AGENT_MEMORY_API_KEY);
}

let client = null;
function getClient() {
  if (!client) {
    client = new AgentMemory({
      serverURL: AGENT_MEMORY_URL,
      storeId: AGENT_MEMORY_STORE_ID,
      apiKey: AGENT_MEMORY_API_KEY,
      timeoutMs: TIMEOUT_MS,
      retryConfig: { strategy: 'none' },
    });
  }
  return client;
}

async function addEvent(sessionId, actorId, role, text) {
  await getClient().addSessionEvent({
    sessionId,
    actorId,
    role,
    content: [{ text }],
    createdAt: new Date(),
  });
}

async function getSession(sessionId) {
  try {
    const result = await getClient().getSessionMemory(sessionId);
    return { events: result.events || [], summary: result.summary };
  } catch (error) {
    if (error instanceof errors.NotFoundErrorResponseContent) {
      // Brand new sessionId, no events yet — not an error condition.
      return { events: [] };
    }
    throw error;
  }
}

module.exports = { isConfigured, addEvent, getSession };
