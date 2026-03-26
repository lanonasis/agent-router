#!/usr/bin/env node

/**
 * AI Service Router Server
 * Express server wrapper for AIServiceRouter
 */

const express = require('express');
const AIServiceRouter = require('./core/ai-service-router');
require('dotenv').config();

const app = express();
// Keep fallback aligned with production systemd defaults to avoid local port collisions.
const PORT = process.env.PORT || 8000;

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
      health: '/ai-health'
    },
    ai_provider: 'Ollama',
    model: process.env.OLLAMA_MODEL || 'qwen2:1.5b'
  });
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const aiHealth = await aiRouter.checkAIServicesHealth();
    const overallHealthy = Object.values(aiHealth).every(s => s.status === 'healthy');

    res.status(overallHealthy ? 200 : 503).json({
      status: overallHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
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

// Start server
const server = app.listen(PORT, () => {
  console.log('\n🚀 Onasis AI Service Router');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🤖 AI Model: ${process.env.OLLAMA_MODEL || 'qwen2:1.5b'}`);
  console.log(`🔗 Ollama: ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}`);
  console.log('\n📚 Endpoints:');
  console.log(`   GET  http://localhost:${PORT}/`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   GET  http://localhost:${PORT}/ai-health`);
  console.log(`   GET  http://localhost:${PORT}/ai-services`);
  console.log(`   POST http://localhost:${PORT}/api/v1/ai-chat`);
  console.log(`   POST http://localhost:${PORT}/functions/v1/ai-chat`);
  console.log('\n✨ Ready to serve AI requests\n');
});

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
