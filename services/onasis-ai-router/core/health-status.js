'use strict';

/**
 * Summarise per-vendor health into an overall status and HTTP code.
 *
 * The router's whole design is that a dead vendor is routed around, so "one
 * vendor is unhealthy" is not an outage — it is the fallback path working. The
 * original check was `every(healthy)`, which returned 503 whenever any single
 * vendor was down; an authenticated chat request would succeed at the same
 * moment /health reported the service unavailable, so uptime probes and load
 * balancers saw a hard failure that did not exist.
 *
 * Three states:
 *   healthy     — every vendor answered            -> 200
 *   degraded    — at least one vendor answered     -> 200 (requests still served)
 *   unavailable — no vendor answered               -> 503 (genuinely cannot serve)
 */
function summariseHealth(aiHealth) {
  const vendors = Object.values(aiHealth || {});
  const total = vendors.length;
  const healthy = vendors.filter((v) => v && v.status === 'healthy').length;

  // No vendors configured at all is a misconfiguration, not a healthy service.
  if (total === 0) return { status: 'unavailable', httpStatus: 503, healthy: 0, total: 0 };
  if (healthy === total) return { status: 'healthy', httpStatus: 200, healthy, total };
  if (healthy === 0) return { status: 'unavailable', httpStatus: 503, healthy, total };
  return { status: 'degraded', httpStatus: 200, healthy, total };
}

module.exports = { summariseHealth };
