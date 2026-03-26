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
const TRUST_PROXY = process.env.TRUST_PROXY;

if (TRUST_PROXY !== undefined) {
  app.set('trust proxy', TRUST_PROXY === 'true' ? true : TRUST_PROXY);
}

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
const INTELLIGENCE_SUPABASE_URL = process.env.INTELLIGENCE_SUPABASE_URL || '';
const INTELLIGENCE_SUPABASE_ANON_KEY = process.env.INTELLIGENCE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.error('Missing required Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

if (!SUPABASE_ANON_KEY) {
  logger.error('Missing required Supabase configuration. Please set SUPABASE_ANON_KEY.');
  process.exit(1);
}

if (INTELLIGENCE_SUPABASE_URL && !INTELLIGENCE_SUPABASE_ANON_KEY) {
  logger.warn('INTELLIGENCE_SUPABASE_URL set without INTELLIGENCE_SUPABASE_ANON_KEY. Falling back to SUPABASE_ANON_KEY.');
}

if (!INTELLIGENCE_SUPABASE_URL) {
  logger.warn('INTELLIGENCE_SUPABASE_URL not set. Intelligence routes will use SUPABASE_URL.');
}

const SUPABASE_BASES = {
  core: {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY
  },
  intelligence: {
    url: INTELLIGENCE_SUPABASE_URL || SUPABASE_URL,
    anonKey: INTELLIGENCE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY
  }
};

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

const parseCsv = (value) => (value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const allowedOrigins = [
  ...parseCsv(process.env.ALLOWED_ORIGINS),
  ...parseCsv(process.env.CORS_ORIGIN)
];
const allowedOriginSuffixes = parseCsv(process.env.ALLOWED_ORIGIN_SUFFIXES || 'lanonasis.com');
const allowLocalhost = (process.env.CORS_ALLOW_LOCALHOST || 'true') === 'true';

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if (allowLocalhost && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
      return true;
    }
    if (allowedOrigins.includes(origin)) {
      return true;
    }
    return allowedOriginSuffixes.some((suffix) => (
      hostname === suffix || hostname.endsWith(`.${suffix}`)
    ));
  } catch (error) {
    return false;
  }
};

app.use(cors({
  origin: function (origin, callback) {
    const hashedOrigin = origin
      ? crypto.createHash('sha256').update(origin).digest('hex').substring(0, 12)
      : 'direct';
    logger.info(`Request from hashed origin: ${hashedOrigin}`);
    callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service', 'X-Vendor', 'X-API-Key']
}));

app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => {
    if (buf && buf.length) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting with privacy protection
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message, code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sessionId = req.headers['x-session-id'] || '';
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader;
    const apiKey = req.headers['x-api-key'] || '';
    const ip = typeof rateLimit.ipKeyGenerator === 'function'
      ? rateLimit.ipKeyGenerator(req)
      : (req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim());
    const keySeed = sessionId || token || apiKey || ip || 'anonymous';
    return crypto.createHash('sha256').update(keySeed).digest('hex').substring(0, 32);
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

const API_V1_ROUTES = [
  // Memory REST API (OpenAPI + redirects)
  {
    name: 'memories-list',
    method: 'get',
    paths: ['/api/v1/memories', '/api/v1/memory/list', '/api/v1/memories/list'],
    supabasePath: '/functions/v1/memory-list',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memories-create',
    method: 'post',
    paths: ['/api/v1/memories', '/api/v1/memory'],
    supabasePath: '/functions/v1/memory-create',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memories-search',
    method: 'post',
    paths: ['/api/v1/memories/search', '/api/v1/memory/search'],
    supabasePath: '/functions/v1/memory-search',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memories-stats',
    method: 'get',
    paths: ['/api/v1/memories/stats', '/api/v1/memory/stats'],
    supabasePath: '/functions/v1/memory-stats',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memories-bulk-delete',
    method: 'post',
    paths: ['/api/v1/memories/bulk-delete', '/api/v1/memory/bulk/delete'],
    supabasePath: '/functions/v1/memory-bulk-delete',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memory-get',
    method: 'get',
    paths: ['/api/v1/memories/:id', '/api/v1/memory/:id'],
    supabasePath: '/functions/v1/memory-get',
    appendParam: 'id',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memory-update',
    method: 'put',
    paths: ['/api/v1/memories/:id', '/api/v1/memory/update'],
    supabasePath: '/functions/v1/memory-update',
    injectBody: { id: 'id' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memory-update-legacy',
    method: 'post',
    paths: ['/api/v1/memory/update'],
    supabasePath: '/functions/v1/memory-update',
    injectBody: { id: 'id' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memory-delete',
    method: 'delete',
    paths: ['/api/v1/memories/:id', '/api/v1/memory/delete'],
    supabasePath: '/functions/v1/memory-delete',
    appendParam: 'id',
    injectBody: { id: 'id' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memory-delete-legacy',
    method: 'post',
    paths: ['/api/v1/memory/delete'],
    supabasePath: '/functions/v1/memory-delete',
    injectBody: { id: 'id' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'memory-health',
    method: 'get',
    paths: ['/api/v1/memory/health', '/api/v1/health'],
    supabasePath: '/functions/v1/system-health',
    rateLimit: generalRateLimit,
    base: 'core'
  },

  // API Key Management (OpenAPI + redirects)
  {
    name: 'api-key-list',
    method: 'get',
    paths: ['/api/v1/auth/api-keys', '/api/v1/keys', '/api/v1/keys/list'],
    supabasePath: '/functions/v1/api-key-list',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'api-key-create',
    method: 'post',
    paths: ['/api/v1/auth/api-keys', '/api/v1/keys', '/api/v1/keys/create'],
    supabasePath: '/functions/v1/api-key-create',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'api-key-rotate',
    method: 'post',
    paths: ['/api/v1/auth/api-keys/:keyId/rotate', '/api/v1/keys/rotate'],
    supabasePath: '/functions/v1/api-key-rotate',
    injectBody: { key_id: 'keyId' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'api-key-revoke',
    method: 'post',
    paths: ['/api/v1/auth/api-keys/:keyId/revoke', '/api/v1/keys/revoke'],
    supabasePath: '/functions/v1/api-key-revoke',
    injectBody: { key_id: 'keyId' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'api-key-delete',
    method: 'delete',
    paths: ['/api/v1/auth/api-keys/:keyId', '/api/v1/keys/delete'],
    supabasePath: '/functions/v1/api-key-delete',
    injectBody: { key_id: 'keyId' },
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'api-key-delete-legacy',
    method: 'post',
    paths: ['/api/v1/keys/delete'],
    supabasePath: '/functions/v1/api-key-delete',
    injectBody: { key_id: 'keyId' },
    rateLimit: generalRateLimit,
    base: 'core'
  },

  // Auth + System
  {
    name: 'auth-status',
    method: 'get',
    paths: ['/api/v1/auth/status'],
    supabasePath: '/functions/v1/auth-status',
    rateLimit: generalRateLimit,
    base: 'core'
  },

  // Organization & Projects
  {
    name: 'organization-info',
    method: 'get',
    paths: ['/api/v1/organization', '/api/v1/org', '/api/v1/org/info', '/api/v1/organizations/:orgId'],
    supabasePath: '/functions/v1/organization-info',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'project-list',
    method: 'get',
    paths: ['/api/v1/projects', '/api/v1/projects/list'],
    supabasePath: '/functions/v1/project-list',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'project-create',
    method: 'post',
    paths: ['/api/v1/projects', '/api/v1/projects/create'],
    supabasePath: '/functions/v1/project-create',
    rateLimit: generalRateLimit,
    base: 'core'
  },

  // Configuration
  {
    name: 'config-get',
    method: 'get',
    paths: ['/api/v1/config', '/api/v1/config/get'],
    supabasePath: '/functions/v1/config-get',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'config-set',
    method: 'put',
    paths: ['/api/v1/config'],
    supabasePath: '/functions/v1/config-set',
    rateLimit: generalRateLimit,
    base: 'core'
  },
  {
    name: 'config-set-legacy',
    method: 'post',
    paths: ['/api/v1/config/set'],
    supabasePath: '/functions/v1/config-set',
    rateLimit: generalRateLimit,
    base: 'core'
  },

  // Documentation search (OpenAPI)
  {
    name: 'docs-search',
    method: 'post',
    paths: ['/api/v1/docs/search'],
    supabasePath: '/functions/v1/docs-search',
    rateLimit: generalRateLimit,
    base: 'core'
  },

  // Intelligence (separate Supabase project)
  {
    name: 'intelligence-health-check',
    method: 'post',
    paths: ['/api/v1/intelligence/health-check', '/api/v1/intelligence/health'],
    supabasePath: '/functions/v1/intelligence-health-check',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-suggest-tags',
    method: 'post',
    paths: ['/api/v1/intelligence/suggest-tags'],
    supabasePath: '/functions/v1/intelligence-suggest-tags',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-find-related',
    method: 'post',
    paths: ['/api/v1/intelligence/find-related'],
    supabasePath: '/functions/v1/intelligence-find-related',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-detect-duplicates',
    method: 'post',
    paths: ['/api/v1/intelligence/detect-duplicates'],
    supabasePath: '/functions/v1/intelligence-detect-duplicates',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-extract-insights',
    method: 'post',
    paths: ['/api/v1/intelligence/extract-insights'],
    supabasePath: '/functions/v1/intelligence-extract-insights',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-analyze-patterns',
    method: 'post',
    paths: ['/api/v1/intelligence/analyze-patterns'],
    supabasePath: '/functions/v1/intelligence-analyze-patterns',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-behavior-record',
    method: 'post',
    paths: ['/api/v1/intelligence/behavior-record'],
    supabasePath: '/functions/v1/intelligence-behavior-record',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-behavior-recall',
    method: 'post',
    paths: ['/api/v1/intelligence/behavior-recall'],
    supabasePath: '/functions/v1/intelligence-behavior-recall',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  },
  {
    name: 'intelligence-behavior-suggest',
    method: 'post',
    paths: ['/api/v1/intelligence/behavior-suggest'],
    supabasePath: '/functions/v1/intelligence-behavior-suggest',
    rateLimit: generalRateLimit,
    base: 'intelligence'
  }
];

// Utility functions
const sanitizeRequestBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  
  const sanitized = JSON.parse(JSON.stringify(body));
  const piiStripMode = (process.env.PII_STRIP_MODE || 'fields').toLowerCase();
  
  // Remove PII fields
  const piiFields = [
    'user_id', 'email', 'ip_address', 'session_id', 'phone', 'address',
    'name', 'firstname', 'lastname', 'ssn', 'credit_card', 'passport',
    'token', 'access_token', 'refresh_token', 'api_key', 'apikey',
    'secret', 'password', 'authorization', 'cookie'
  ];

  const sensitiveKeyPatterns = [
    /token/i, /secret/i, /password/i, /api[_-]?key/i, /authorization/i,
    /session/i, /cookie/i, /email/i, /phone/i, /ssn/i, /passport/i, /credit/i
  ];

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const jwtRegex = /[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g;
  const tokenRegex = /\b[A-Za-z0-9-_]{24,}\b/g;

  const redactString = (value) => {
    if (typeof value !== 'string') return value;
    let redacted = value;
    redacted = redacted.replace(emailRegex, '[REDACTED_EMAIL]');
    redacted = redacted.replace(ipRegex, '[REDACTED_IP]');
    redacted = redacted.replace(jwtRegex, '[REDACTED_JWT]');
    redacted = redacted.replace(tokenRegex, '[REDACTED_TOKEN]');
    return redacted;
  };
  
  const removePII = (obj) => {
    if (typeof obj === 'object' && obj !== null) {
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        const keyIsSensitive = piiFields.includes(key) || sensitiveKeyPatterns.some((pattern) => pattern.test(key));
        if (keyIsSensitive) {
          obj[key] = '[REDACTED]';
          continue;
        }
        if (typeof value === 'string') {
          if (piiStripMode === 'all') {
            obj[key] = redactString(value);
          }
        } else if (typeof value === 'object') {
          removePII(value);
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
  const sensitiveResponseKeys = [
    'access_token', 'refresh_token', 'token', 'api_key', 'apikey',
    'secret', 'authorization', 'password'
  ];

  const removeSensitive = (obj) => {
    if (typeof obj !== 'object' || obj === null) return;
    for (const key of Object.keys(obj)) {
      if (sensitiveResponseKeys.includes(key)) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        removeSensitive(obj[key]);
      }
    }
  };
  removeSensitive(sanitized);
  
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

const getQueryString = (req) => {
  const originalUrl = req.originalUrl || '';
  const queryIndex = originalUrl.indexOf('?');
  if (queryIndex === -1) return '';
  return originalUrl.slice(queryIndex + 1);
};

const buildSupabaseUrl = (baseUrl, supabasePath, req) => {
  const queryString = getQueryString(req);
  if (!queryString) {
    return `${baseUrl}${supabasePath}`;
  }
  return `${baseUrl}${supabasePath}?${queryString}`;
};

const applyBodyInjection = (req, injectBody) => {
  if (!injectBody) return;
  const body = (req.body && typeof req.body === 'object') ? { ...req.body } : {};
  Object.entries(injectBody).forEach(([bodyKey, paramKey]) => {
    if (req.params && req.params[paramKey] && body[bodyKey] === undefined) {
      body[bodyKey] = req.params[paramKey];
    }
  });
  req.body = body;
};

const resolveSupabasePath = (route, req) => {
  if (!route.appendParam) return route.supabasePath;
  const paramValue = req.params ? req.params[route.appendParam] : null;
  if (!paramValue) return route.supabasePath;
  return route.supabasePath.endsWith('/')
    ? `${route.supabasePath}${paramValue}`
    : `${route.supabasePath}/${paramValue}`;
};

// Route to Supabase edge function
const routeToSupabase = async (req, serviceName, supabasePath, options = {}) => {
  const baseUrl = options.baseUrl || SUPABASE_URL;
  const anonKey = options.anonKey || SUPABASE_ANON_KEY;
  const timeout = options.timeout || 60000;
  const url = buildSupabaseUrl(baseUrl, supabasePath, req);
  const sanitizedBody = sanitizeRequestBody(req.body);
  const requestStartTime = Date.now();
  
  // Prepare headers for Supabase
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${anonKey}`,
    'apikey': anonKey,
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
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? JSON.stringify(sanitizedBody) : undefined,
      timeout
    });
    
    const responseTime = Date.now() - requestStartTime;
    
    if (!response.ok) {
      let errorText = await response.text();
      if (typeof errorText === 'string') {
        errorText = errorText
          .replace(/[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, '[REDACTED_JWT]')
          .replace(/\b[A-Za-z0-9-_]{24,}\b/g, '[REDACTED_TOKEN]')
          .slice(0, 400);
      }
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

const registerApiV1Routes = () => {
  API_V1_ROUTES.forEach((route) => {
    const method = route.method.toLowerCase();
    const rateLimiter = route.rateLimit || generalRateLimit;

    const handler = async (req, res) => {
      try {
        applyBodyInjection(req, route.injectBody);
        const supabasePath = resolveSupabasePath(route, req);
        const baseConfig = SUPABASE_BASES[route.base] || SUPABASE_BASES.core;

        const result = await routeToSupabase(req, route.name, supabasePath, {
          baseUrl: baseConfig.url,
          anonKey: baseConfig.anonKey,
          timeout: route.timeout
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({
          error: {
            message: 'Service temporarily unavailable',
            type: 'service_error',
            code: 'ROUTING_FAILURE'
          },
          service: route.name,
          request_id: req.anonymousId
        });
      }
    };

    route.paths.forEach((path) => {
      if (typeof app[method] !== 'function') {
        logger.warn(`Unsupported method '${route.method}' for route ${route.name}`);
        return;
      }
      app[method](path, rateLimiter, handler);
    });
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Onasis-CORE Unified Router',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    supabase_url: SUPABASE_URL,
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

// API v1 REST routes (OpenAPI + redirects)
registerApiV1Routes();

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

// Webhook endpoint for external integrations
const normalizeServiceEnvKey = (serviceName) => (
  String(serviceName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
);

const getWebhookSecret = (serviceName) => {
  const specificKey = process.env[`WEBHOOK_SIGNING_SECRET_${normalizeServiceEnvKey(serviceName)}`];
  return specificKey || process.env.WEBHOOK_SIGNING_SECRET || '';
};

const timingSafeEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const validateWebhookSignature = (req, secret) => {
  if (!secret) return false;
  const signatureHeader = req.headers['x-onasis-signature'] || req.headers['x-signature'] || '';
  if (!signatureHeader) return false;
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/, '');
  return timingSafeEqual(expected, provided);
};

const requireWebhookSignature = (process.env.REQUIRE_WEBHOOK_SIGNATURE || 'false') === 'true';

app.post('/webhook/:service', generalRateLimit, async (req, res) => {
  const serviceName = req.params.service;
  const secret = getWebhookSecret(serviceName);
  const signatureRequired = requireWebhookSignature || Boolean(secret);

  if (signatureRequired) {
    if (!secret) {
      return res.status(503).json({ success: false, error: 'Webhook signing secret not configured' });
    }
    if (!validateWebhookSignature(req, secret)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
    }
  }
  
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
      res.status(500).json({ success: false, error: error.message });
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
      '/api/v1/memories',
      '/api/v1/auth/api-keys',
      '/api/v1/intelligence/*',
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
