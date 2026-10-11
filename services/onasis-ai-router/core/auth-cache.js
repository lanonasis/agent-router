'use strict';

/**
 * Redis-backed cache for authenticateRequest's per-request auth-gateway
 * resolution — INTERNAL ONLY.
 *
 * Mirrors the graceful-degradation pattern already used by the sibling
 * auth-gateway service (onasis-core/services/auth-gateway/src/services/cache.service.ts):
 * Redis is optional, lazily connected, and every failure mode fails OPEN
 * (falls back to "no cache" so the direct auth-gateway call still runs) —
 * a cache outage must never block authentication.
 *
 * Backed by the existing onasis-maas Redis Cloud instance (REDIS_URL wired
 * into ecosystem.config.js for this app). Using Redis instead of an
 * in-process Map also means both PM2 cluster replicas share one cache
 * instead of diverging.
 */

const REDIS_ENABLED = !!(
  process.env.REDIS_URL ||
  process.env.REDIS_HOST ||
  process.env.REDIS_ENABLED === 'true'
);

let Redis = null;
let client = null;
let connectionFailed = false;
let lastErrorLogTime = 0;
const ERROR_LOG_THROTTLE_MS = 60000;

function getClient(logger) {
  if (!REDIS_ENABLED || connectionFailed) return null;

  if (!client) {
    try {
      Redis = Redis || require('ioredis').Redis || require('ioredis');
      const options = process.env.REDIS_URL
        ? { lazyConnect: true, maxRetriesPerRequest: 1 }
        : {
            host: process.env.REDIS_HOST || 'localhost',
            port: Number(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD,
            db: Number(process.env.REDIS_DB) || 0,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            retryStrategy: (times) => {
              if (times > 3) {
                connectionFailed = true;
                return null;
              }
              return Math.min(times * 200, 2000);
            },
          };

      client = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, options) : new Redis(options);

      client.on('error', (error) => {
        const now = Date.now();
        if (now - lastErrorLogTime > ERROR_LOG_THROTTLE_MS) {
          logger?.warn('Auth-cache Redis error (falling back to direct auth-gateway calls)', {
            code: error?.code,
            message: error?.message,
          });
          lastErrorLogTime = now;
        }
      });
    } catch (error) {
      connectionFailed = true;
      logger?.warn('Failed to initialise auth-cache Redis client — running without it', {
        error: error.message,
      });
      return null;
    }
  }

  return client;
}

function makeAuthCache(logger) {
  return {
    async get(key) {
      const redis = getClient(logger);
      if (!redis) return null;
      try {
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        logger?.warn('Auth-cache read failed — falling back to direct call', { error: error.message });
        return null;
      }
    },

    async set(key, value, ttlSeconds) {
      const redis = getClient(logger);
      if (!redis) return;
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (error) {
        logger?.warn('Auth-cache write failed — continuing without cache', { error: error.message });
      }
    },
  };
}

let instance = null;
function getAuthCache(logger) {
  if (!instance) instance = makeAuthCache(logger);
  return instance;
}

module.exports = { getAuthCache };
