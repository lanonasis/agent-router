#!/usr/bin/env node

/**
 * Onasis-CORE Unified Router
 * Single URL endpoint that routes all requests to appropriate Supabase edge functions
 * Provides privacy protection while leveraging Supabase infrastructure
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
// Node 18+ provides fetch globally — no node-fetch import needed.
const winston = require('winston');
require('dotenv').config();

const app = express();
const PORT = process.env.ROUTER_PORT || 3000;

// Enhanced logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'onasis-unified-router' },
  transports: [
    new winston.transports.File({ filename: 'logs/router-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/router-combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.error('Missing required Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

app.use(cors({
  origin: function (origin, callback) {
    // Log origin anonymously
    const hashedOrigin = origin ? 
      crypto.createHash('sha256').update(origin).digest('hex').substring(0, 12) : 
      'direct';
    logger.info(`Request from hashed origin: ${hashedOrigin}`);
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service', 'X-Vendor', 'X-API-Key']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting with privacy protection
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message, code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sessionId = req.headers['x-session-id'] || 
                     req.headers['authorization']?.substring(0, 20) || 
                     req.headers['x-api-key']?.substring(0, 20) ||
                     'anonymous';
    return crypto.createHash('sha256').update(sessionId).digest('hex').substring(0, 16);
  }
});

// Different rate limits for different services
const generalRateLimit = createRateLimit(60 * 1000, 500, 'General API rate limit exceeded');
const aiRateLimit = createRateLimit(60 * 1000, 100, 'AI API rate limit exceeded');
const mediaRateLimit = createRateLimit(60 * 1000, 50, 'Media processing rate limit exceeded');

// Privacy protection middleware
const privacyProtection = (req, res, next) => {
  // Generate anonymous request ID
  req.anonymousId = crypto.randomBytes(16).toString('hex');
  req.timestamp = Date.now();
  
  // Strip identifying headers before forwarding to Supabase
  const originalHeaders = { ...req.headers };
  delete req.headers['x-real-ip'];
  delete req.headers['x-forwarded-for'];
  delete req.headers['x-forwarded-host'];
  delete req.headers['cf-connecting-ip'];
  delete req.headers['x-forwarded-proto'];
  
  // Generate client fingerprint for analytics
  req.clientFingerprint = crypto.createHash('sha256')
    .update(originalHeaders['user-agent'] || '')
    .update(originalHeaders['accept-language'] || '')
    .digest('hex').substring(0, 12);
  
  // Add Onasis headers
  res.setHeader('X-Powered-By', 'Onasis-CORE');
  res.setHeader('X-Privacy-Level', 'High');
  res.setHeader('X-Request-ID', req.anonymousId);
  res.setHeader('X-Router-Version', '1.0.0');
  
  logger.info('Router request processed', {
    requestId: req.anonymousId,
    clientFingerprint: req.clientFingerprint,
    path: req.path,
    method: req.method,
    service: req.headers['x-service'] || 'unknown'
  });
  
  next();
};

app.use(privacyProtection);

// Service routing configuration
const SERVICE_ROUTES = {
  // AI Services
  'ai-chat': {
    path: '/functions/v1/ai-chat',
    rateLimit: aiRateLimit,
    description: 'Multi-model AI conversation with privacy protection'
  },
  
  // Media Processing
  'text-to-speech': {
    path: '/functions/v1/elevenlabs-tts',
    rateLimit: mediaRateLimit,
    description: 'Privacy-protected text-to-speech conversion'
  },
  'speech-to-text': {
    path: '/functions/v1/elevenlabs-stt',
    rateLimit: mediaRateLimit,
    description: 'Privacy-protected speech-to-text transcription'
  },
  'transcribe': {
    path: '/functions/v1/whisper-transcribe',
    rateLimit: mediaRateLimit,
    description: 'Advanced speech transcription with privacy'
  },
  
  // Content Processing
  'extract-tags': {
    path: '/functions/v1/extract-tags',
    rateLimit: generalRateLimit,
    description: 'AI-powered content tag extraction'
  },
  'generate-summary': {
    path: '/functions/v1/generate-summary',
    rateLimit: generalRateLimit,
    description: 'Intelligent content summarization'
  },
  'generate-embedding': {
    path: '/functions/v1/generate-embedding',
    rateLimit: generalRateLimit,
    description: 'Vector embedding generation for semantic search'
  },
  
  // Tool Integration
  'mcp-handler': {
    path: '/functions/v1/mcp-handler',
    rateLimit: generalRateLimit,
    description: 'Model Context Protocol tool integration hub'
  }
};

// Utility functions
const sanitizeRequestBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  
  const sanitized = JSON.parse(JSON.stringify(body));
  
  // Remove PII fields
  const piiFields = [
    'user_id', 'email', 'ip_address', 'session_id', 'phone', 'address',
    'name', 'firstname', 'lastname', 'ssn', 'credit_card', 'passport'
  ];
  
  const removePII = (obj) => {
    if (typeof obj === 'object' && obj !== null) {
      for (const field of piiFields) {
        delete obj[field];
      }
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          removePII(obj[key]);
        }
      }
    }
  };
  
  removePII(sanitized);
  return sanitized;
};

const sanitizeResponse = (data) => {
  if (!data || typeof data !== 'object') return data;
  
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // Add Onasis branding to responses
  if (sanitized.provider) {
    sanitized.provider = 'onasis-core';
  }
  
  // Replace vendor model names with Onasis branding
  if (sanitized.model) {
    sanitized.model = sanitized.model
      .replace(/gpt-|claude-|palm-|llama-/, 'onasis-')
      .replace(/openai|anthropic|google|meta/, 'onasis');
  }
  
  // Add privacy metadata
  sanitized.onasis_metadata = {
    ...(sanitized.onasis_metadata || {}),
    privacy_level: 'high',
    vendor_masked: true,
    pii_removed: true
  };
  
  return sanitized;
};

// Route to Supabase edge function
const routeToSupabase = async (req, serviceName, supabasePath) => {
  const url = `${SUPABASE_URL}${supabasePath}`;
  const sanitizedBody = sanitizeRequestBody(req.body);
  const requestStartTime = Date.now();
  
  // Prepare headers for Supabase
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'apikey': SUPABASE_ANON_KEY,
    'User-Agent': 'Onasis-CORE/1.0',
    // Forward specific headers while maintaining privacy
    ...(req.headers['x-service'] && { 'X-Service': req.headers['x-service'] }),
    ...(req.headers['x-vendor'] && { 'X-Vendor': req.headers['x-vendor'] })
  };
  
  logger.info('Routing to Supabase', {
    requestId: req.anonymousId,
    service: serviceName,
    url: url,
    method: req.method,
    bodySize: JSON.stringify(sanitizedBody).length
  });
  
  try {
    const routeController = new AbortController();
    const routeTimer = setTimeout(() => routeController.abort(), 60000);
    let response;
    try {
      response = await fetch(url, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? JSON.stringify(sanitizedBody) : undefined,
        signal: routeController.signal
      });
    } finally {
      clearTimeout(routeTimer);
    }
    
    const responseTime = Date.now() - requestStartTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Supabase function error', {
        requestId: req.anonymousId,
        service: serviceName,
        status: response.status,
        error: errorText
      });
      throw new Error(`Supabase function error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    const sanitizedResponse = sanitizeResponse(data);
    
    // Add routing metadata
    sanitizedResponse.onasis_metadata = {
      ...sanitizedResponse.onasis_metadata,
      service: serviceName,
      response_time: responseTime,
      request_id: req.anonymousId,
      routed_via: 'supabase'
    };
    
    logger.info('Supabase request completed', {
      requestId: req.anonymousId,
      service: serviceName,
      responseTime: responseTime,
      status: 'success'
    });
    
    return sanitizedResponse;
    
  } catch (error) {
    logger.error('Routing to Supabase failed', {
      requestId: req.anonymousId,
      service: serviceName,
      error: error.message
    });
    throw error;
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Onasis-CORE Unified Router',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    available_services: Object.keys(SERVICE_ROUTES),
    privacy_level: 'high',
    features: [
      'unified_routing',
      'privacy_protection',
      'supabase_integration',
      'service_discovery',
      'anonymous_tracking'
    ],
    timestamp: new Date().toISOString()
  });
});

// Service discovery endpoint
app.get('/services', generalRateLimit, (req, res) => {
  const services = Object.entries(SERVICE_ROUTES).map(([name, config]) => ({
    name,
    endpoint: `/api/${name}`,
    description: config.description,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    privacy_protected: true
  }));
  
  res.json({
    available_services: services,
    total_count: services.length,
    base_url: req.protocol + '://' + req.get('host'),
    documentation: 'https://docs.onasis.io'
  });
});

// Dynamic service routing
app.use('/api/:service', (req, res, next) => {
  const serviceName = req.params.service;
  const serviceConfig = SERVICE_ROUTES[serviceName];
  
  if (!serviceConfig) {
    return res.status(404).json({
      error: {
        message: `Service '${serviceName}' not found`,
        type: 'service_not_found',
        code: 'INVALID_SERVICE'
      },
      available_services: Object.keys(SERVICE_ROUTES),
      request_id: req.anonymousId
    });
  }
  
  // Apply service-specific rate limiting
  serviceConfig.rateLimit(req, res, async (err) => {
    if (err) {
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded for this service',
          type: 'rate_limit_exceeded',
          code: 'SERVICE_RATE_LIMIT'
        },
        service: serviceName,
        request_id: req.anonymousId
      });
    }
    
    try {
      const result = await routeToSupabase(req, serviceName, serviceConfig.path);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: {
          message: 'Service temporarily unavailable',
          type: 'service_error',
          code: 'ROUTING_FAILURE'
        },
        service: serviceName,
        request_id: req.anonymousId
      });
    }
  });
});

// Legacy API compatibility routes
app.post('/api/v1/chat/completions', aiRateLimit, async (req, res) => {
  try {
    req.headers['x-service'] = 'ai-chat';
    const result = await routeToSupabase(req, 'ai-chat', SERVICE_ROUTES['ai-chat'].path);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: {
        message: 'AI chat service unavailable',
        type: 'ai_service_error',
        code: 'CHAT_FAILURE'
      },
      request_id: req.anonymousId
    });
  }
});

// Webhook endpoint for external integrations
app.post('/webhook/:service', generalRateLimit, async (req, res) => {
  const serviceName = req.params.service;
  
  logger.info('Webhook received', {
    service: serviceName,
    requestId: req.anonymousId,
    headers: Object.keys(req.headers)
  });
  
  // Forward webhook to appropriate service
  if (SERVICE_ROUTES[serviceName]) {
    try {
      const result = await routeToSupabase(req, serviceName, SERVICE_ROUTES[serviceName].path);
      res.json({ success: true, result });
    } catch (error) {
      // Do not leak internal error details in responses
      logger.error('Webhook routing failed', { requestId: req.anonymousId, service: serviceName, error: error.message });
      res.status(500).json({ success: false, error: 'Webhook processing failed', request_id: req.anonymousId });
    }
  } else {
    res.status(404).json({ success: false, error: 'Webhook service not found' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Router error', {
    requestId: req.anonymousId,
    error: error.message,
    stack: error.stack
  });
  
  res.status(500).json({
    error: {
      message: 'Internal router error',
      type: 'router_error',
      code: 'INTERNAL_ERROR'
    },
    request_id: req.anonymousId
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      type: 'not_found',
      code: 'ENDPOINT_NOT_FOUND'
    },
    available_endpoints: [
      '/health',
      '/services',
      '/api/{service_name}',
      '/api/v1/chat/completions',
      '/webhook/{service_name}'
    ],
    documentation: 'https://docs.onasis.io',
    request_id: req.anonymousId
  });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully`);
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Onasis-CORE Unified Router started', {
    port: PORT,
    supabase_url: SUPABASE_URL,
    available_services: Object.keys(SERVICE_ROUTES),
    environment: process.env.NODE_ENV || 'development'
  });
  
  console.log(`🌐 Onasis-CORE Unified Router running on port ${PORT}`);
  console.log(`🔗 Supabase URL: ${SUPABASE_URL}`);
  console.log(`🛡️  Privacy protection: ENABLED`);
  console.log(`🔀 Service routing: ACTIVE`);
  console.log(`📊 Available services: ${Object.keys(SERVICE_ROUTES).length}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 Services: http://localhost:${PORT}/services`);
});

module.exports = app;
