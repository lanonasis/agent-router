#!/usr/bin/env node

/**
 * AI Service Router Server
 * Express server wrapper for AIServiceRouter
 */

const express = require('express');
const AIServiceRouter = require('./core/ai-service-router');
const { summariseHealth } = require('./core/health-status');
const openaiCompat = require('./core/openai-compat');
require('dotenv').config();

// ── Phase 5: startup lane-typing validation (spec §7) ──
// Fails fast if the shipped configuration violates lane contracts.
//
// `assertLaneConfiguration` throws with a formatted, actionable message;
// the process-level exit lives here so the validation itself stays
// importable and testable from a unit test.
const { assertLaneConfiguration } = require('./vendors/vendor-config');
const { USE_CASES, VENDOR_REGISTRY } = require('./vendors');
try {
  assertLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: VENDOR_REGISTRY,
  });
} catch (error) {
  console.error('FATAL: %s', error.message);
  process.exit(1);
}

const app = express();
// Keep fallback aligned with production systemd defaults to avoid local port collisions.
const PORT = process.env.PORT || 8000;

// nginx is the only thing in front of this process — trust its X-Forwarded-For
// so req.ip reflects the real client instead of always resolving to 127.0.0.1.
app.set('trust proxy', 1);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS — restrict to configured origins in production.
// Set CORS_ALLOWED_ORIGINS as a comma-separated list (e.g. "https://app.example.com").
// Dev mode requires explicit ALLOW_DEV_CORS=true to allow all origins (prevents accidental exposure).
const _corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? new Set(process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()))
  : null;
const _allowDevCors = process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_CORS === 'true';

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Only allow wildcard in dev mode with explicit opt-in
  if (_allowDevCors && !origin) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && _corsAllowedOrigins && _corsAllowedOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (origin && _allowDevCors) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.header('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging with PII sanitization
const _sanitizeLog = (str) => {
  if (!str) return str;
  return str
    .replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key[=:]\s*)[a-zA-Z0-9_\-\.]+/gi, '$1[REDACTED]')
    .replace(/(email[=:]\s*)[^\s,]+@[^\s,]+/gi, '$1[REDACTED]');
};

app.use((req, res, next) => {
  const safePath = _sanitizeLog(req.path);
  console.log(`${new Date().toISOString()} ${req.method} ${safePath}`);
  next();
});

// Per-IP rate limiting on the live request path — the only rate limiting
// that existed anywhere in this service lived in dead routers
// (unified-router.js, multi-platform-router.js) that server.js never
// mounts. Deliberately dependency-free (single-process, fixed-window,
// in-memory) rather than pulling in express-rate-limit for one middleware;
// consistent with the existing in-memory circuit-breaker/prefetch-cache
// patterns elsewhere in this service. /health is exempt (monitoring probes).
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '120', 10);
const _rateLimitBuckets = new Map(); // ip -> { count, windowStart }

app.use((req, res, next) => {
  if (req.path === '/health') return next();

  const ip = req.ip || 'unknown';
  const now = Date.now();
  const bucket = _rateLimitBuckets.get(ip);

  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    _rateLimitBuckets.set(ip, { count: 1, windowStart: now });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: {
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
        retry_after_seconds: retryAfterSec,
      }
    });
  }
  return next();
});

// Periodic sweep so the bucket map doesn't grow unbounded under many
// distinct IPs — buckets older than one window are stale and safe to drop.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, bucket] of _rateLimitBuckets) {
    if (bucket.windowStart < cutoff) _rateLimitBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Initialize AI Service Router
const aiRouter = new AIServiceRouter({
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaChatPath: process.env.OLLAMA_CHAT_PATH,
  ollamaModel: process.env.OLLAMA_MODEL,
  ollamaToolModel: process.env.OLLAMA_TOOL_MODEL,
  apiBaseUrl: process.env.API_BASE_URL,
  authGatewayUrl: process.env.AUTH_GATEWAY_URL,
});

// Mount AI router routes
app.use('/', aiRouter.getRoutes());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Onasis AI Service Router',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      chat: '/api/v1/ai-chat',
      services: '/ai-services',
      health: '/ai-health',
      openai_compatible: {
        models: '/v1/models',
        chat_completions: '/v1/chat/completions'
      }
    },
    // Branded capability metadata only. This route is unauthenticated and
    // publicly reachable at https://ai.vortexcore.app/, and it previously
    // published `ai_provider: 'Ollama'` plus the real OLLAMA_MODEL name —
    // exactly the vendor/model disclosure sanitizeVendorResponse() strips from
    // every answer. Never name a vendor or upstream model here.
    model: openaiCompat.MODEL_ID,
    provider: openaiCompat.MODEL_OWNER,
    capabilities: {
      streaming: true,
      tools: true,
      memory: true
    }
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const aiHealth = await aiRouter.checkAIServicesHealth();
    // A single dead vendor is the fallback path working, not an outage — see
    // core/health-status.js. Only "no vendor can answer" is a real 503.
    const summary = summariseHealth(aiHealth);

    res.status(summary.httpStatus).json({
      status: summary.status,
      timestamp: new Date().toISOString(),
      vendors_healthy: `${summary.healthy}/${summary.total}`,
      services: {
        api: 'healthy',
        ai: aiHealth
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      code: 'NOT_FOUND',
      path: req.path
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    }
  });
});

// Start server — loopback only. The only consumer is nginx's
// ai.vortexcore.app vhost, which already proxies to 127.0.0.1:8000; port
// 8000 is not in ufw's allowlist and has no Tailscale Serve mapping, so the
// previous 0.0.0.0 bind was exposed on every interface for no reason other
// than ufw's default-deny happening to catch it.
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const server = app.listen(PORT, BIND_HOST, () => {
  const promptDiagnostics = aiRouter.getPromptDiagnostics();
  console.log('\n🚀 Onasis AI Service Router');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🤖 AI Model: ${process.env.OLLAMA_MODEL || 'qwen2:1.5b'}`);
  console.log(`🔗 Ollama: ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}`);
  console.log(`🧠 Prompt mode: ${promptDiagnostics.mode}`);
  console.log(`📂 Prompt root: ${promptDiagnostics.promptLabel}`);
  console.log('\n📚 Endpoints:');
  console.log(`   GET  http://localhost:${PORT}/`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   GET  http://localhost:${PORT}/ai-health`);
  console.log(`   GET  http://localhost:${PORT}/ai-services`);
  console.log(`   POST http://localhost:${PORT}/api/v1/ai-chat`);
  console.log(`   POST http://localhost:${PORT}/functions/v1/ai-chat`);
  console.log('\n✨ Ready to serve AI requests\n');

  // Warm the vendor health cache in the background. /health serves stale
  // results while refreshing, so the only request that would ever pay for a
  // cold cache is the first one after boot — which is exactly when a monitoring
  // probe is most likely to arrive.
  aiRouter.warmHealthCache().then(() => {
    console.log('🩺 Vendor health cache warmed');
  }).catch(() => { /* already logged by the router */ });
});

// Node's 5s default keepAliveTimeout is short enough to race an upstream
// proxy/load-balancer holding connections open longer, causing sporadic
// ECONNRESET/502s under load. headersTimeout must exceed keepAliveTimeout
// per Node's documented invariant.
server.keepAliveTimeout = parseInt(process.env.SERVER_KEEPALIVE_TIMEOUT_MS || '65000', 10);
server.headersTimeout = parseInt(process.env.SERVER_HEADERS_TIMEOUT_MS || '66000', 10);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⏳ SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n⏳ SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = app;
