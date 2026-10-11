'use strict';

const { fetchWithRetry } = require('../vendors/_shared/http-client');

function createOpsEventClient({ logger }) {
  const url = process.env.OPS_WEBHOOK_URL;
  const secret = process.env.OPS_WEBHOOK_SECRET;

  return async function emit(event) {
    if (!url || !secret) {
      logger.warn('Ops event delivery is not configured', { kind: event.kind });
      return false;
    }
    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ surface: 'ai-router', ...event }),
        timeoutMs: 3000,
        retries: 0,
      });
      if (!response.ok) {
        throw new Error(`ops webhook returned ${response.status}`);
      }
      return true;
    } catch (error) {
      logger.error('Ops event delivery rejected', {
        kind: event.kind,
        requestId: event.requestId,
        error: error.message,
      });
      return false;
    }
  };
}

module.exports = { createOpsEventClient };
