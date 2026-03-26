#!/usr/bin/env node

/**
 * Onasis-CORE Multi-Platform Router
 * Unified authentication, billing, and API services across all platforms
 * saas.seftec.tech | seftechub.com | vortexcore.app | lanonasis.com | maas.onasis.io
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
// Node 18+ provides fetch globally — no node-fetch import needed.
const winston = require('winston');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.ROUTER_PORT || 3000;

// Platform configurations
const PLATFORMS = {
  'saas.seftec.tech': {
    name: 'Seftec SaaS',
    brand: 'Seftec',
    color: '#2563eb',
    services: ['ai-chat', 'data-analytics', 'automation', 'integrations'],
    billing_model: 'subscription_tiers',
    target: 'enterprise'
  },
  'seftechub.com': {
    name: 'SeftecHub',
    brand: 'SeftecHub', 
    color: '#059669',
    services: ['api-gateway', 'developer-tools', 'documentation', 'sdk'],
    billing_model: 'usage_based',
    target: 'developers'
  },
  'vortexcore.app': {
    name: 'VortexCore',
    brand: 'VortexCore',
    color: '#dc2626',
    services: ['ai-models', 'embeddings', 'vector-search', 'ml-ops'],
    billing_model: 'token_consumption',
    target: 'ai_teams'
  },
  'lanonasis.com': {
    name: 'LanOnasis',
    brand: 'LanOnasis',
    color: '#7c3aed',
    services: ['translation', 'language-models', 'privacy-chat', 'encryption'],
    billing_model: 'freemium_premium',
    target: 'privacy_users'
  },
  'maas.onasis.io': {
    name: 'MaaS',
    brand: 'Models as a Service',
    color: '#ea580c',
    services: ['model-hosting', 'inference-api', 'fine-tuning', 'deployment'],
    billing_model: 'compute_hours',
    target: 'ai_researchers'
  }
};

// SD-Ghost Protocol AI Service Integration
const SD_GHOST_VPS_URL = process.env.SD_GHOST_VPS_URL;
const SD_GHOST_SUPABASE_URL = process.env.SD_GHOST_SUPABASE_URL;

// Onasis-CORE Partnership Management (separate Supabase project)
const ONASIS_SUPABASE_URL = process.env.ONASIS_SUPABASE_URL;
const ONASIS_SUPABASE_SERVICE_KEY = process.env.ONASIS_SUPABASE_SERVICE_KEY;
const ONASIS_SUPABASE_ANON_KEY = process.env.ONASIS_SUPABASE_ANON_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

// Primary Supabase project (platform services)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Derived Supabase endpoints (configurable via env if needed)
const SUPABASE_AUTH_BASE = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : null;
const SUPABASE_REST_BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : null;
const ONASIS_AUTH_BASE = ONASIS_SUPABASE_URL ? `${ONASIS_SUPABASE_URL}/auth/v1` : null;
const ONASIS_REST_BASE = ONASIS_SUPABASE_URL ? `${ONASIS_SUPABASE_URL}/rest/v1` : null;

const PROFILE_TABLE = process.env.SUPABASE_PROFILE_TABLE || 'profiles';
const ONASIS_PROFILE_TABLE = process.env.ONASIS_PROFILE_TABLE || 'profiles';
const USAGE_TABLE = process.env.SUPABASE_USAGE_TABLE || 'usage_logs';
const ONASIS_USAGE_TABLE = process.env.ONASIS_USAGE_TABLE || 'platform_usage';

// Enhanced logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'onasis-multi-platform' },
  transports: [
    new winston.transports.File({ filename: 'logs/platform-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/platform-combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Validate required environment variables
if (!SD_GHOST_VPS_URL || !SD_GHOST_SUPABASE_URL ||
    !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY ||
    !ONASIS_SUPABASE_URL || !ONASIS_SUPABASE_SERVICE_KEY || !ONASIS_SUPABASE_ANON_KEY ||
    !JWT_SECRET) {
  logger.error('Missing required environment variables. Please check your .env file.');
  logger.error('Required: SD_GHOST_VPS_URL, SD_GHOST_SUPABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, ONASIS_SUPABASE_URL, ONASIS_SUPABASE_SERVICE_KEY, ONASIS_SUPABASE_ANON_KEY, JWT_SECRET');
  process.exit(1);
}

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

const DEV_ALLOWED_ORIGINS = (process.env.DEV_ALLOWED_ORIGINS ||
  'http://localhost:3000,http://localhost:8000,http://localhost:3002,http://localhost:5173,http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow all configured platforms plus development
    const allowedOrigins = [
      ...Object.keys(PLATFORMS).map(domain => `https://${domain}`),
      ...DEV_ALLOWED_ORIGINS
    ];
    
    if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed.replace('https://', '').replace('http://', '')))) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // Allow for now, but log
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform', 'X-Service', 'X-API-Key', 'X-User-ID']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Platform detection middleware
const platformDetection = (req, res, next) => {
  const host = req.get('host') || req.headers['x-platform'];
  const platform = PLATFORMS[host] || PLATFORMS['saas.seftec.tech']; // Default fallback
  
  req.platform = {
    domain: host,
    ...platform
  };
  
  // Add platform-specific branding headers
  res.setHeader('X-Platform', platform.name);
  res.setHeader('X-Brand', platform.brand);
  res.setHeader('X-Powered-By', `${platform.brand} via Onasis-CORE`);
  
  next();
};

app.use(platformDetection);

// Rate limiting with platform-specific limits
const createPlatformRateLimit = (windowMs, defaultMax) => rateLimit({
  windowMs,
  max: (req) => {
    // Higher limits for enterprise platforms
    const multiplier = req.platform?.target === 'enterprise' ? 2 : 1;
    return defaultMax * multiplier;
  },
  message: (req) => ({
    error: `Rate limit exceeded for ${req.platform?.name}`,
    code: 'PLATFORM_RATE_LIMIT_EXCEEDED',
    platform: req.platform?.brand
  }),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const platform = req.platform?.domain || 'unknown';
    const userId = req.user?.id || 'anonymous';
    return crypto.createHash('sha256').update(`${platform}:${userId}`).digest('hex').substring(0, 16);
  }
});

const apiRateLimit = createPlatformRateLimit(60 * 1000, 1000);
const authRateLimit = createPlatformRateLimit(60 * 1000, 100);
const billingRateLimit = createPlatformRateLimit(60 * 1000, 200);

// Authentication middleware
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          platform: req.platform?.brand
        }
      });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch user from Onasis-CORE Supabase project
    const userResponse = await fetch(
      `${ONASIS_REST_BASE}/${ONASIS_PROFILE_TABLE}?select=*&id=eq.${decoded.sub}`,
      {
        headers: {
          'Authorization': `Bearer ${ONASIS_SUPABASE_SERVICE_KEY}`,
          'apikey': ONASIS_SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!userResponse.ok) {
      throw new Error('User not found');
    }
    
    const userData = await userResponse.json();
    req.user = userData[0] || { id: decoded.sub };
    
    next();
  } catch (error) {
    logger.error('Authentication failed', { error: error.message });
    res.status(401).json({
      error: {
        message: 'Invalid authentication token',
        code: 'AUTH_INVALID',
        platform: req.platform?.brand
      }
    });
  }
};

// Usage tracking for billing
const trackUsage = async (req, res, next) => {
  req.usageStart = Date.now();
  req.usageData = {
    platform: req.platform?.domain,
    service: req.params.service || 'unknown',
    user_id: req.user?.id || 'anonymous',
    timestamp: new Date().toISOString()
  };
  
  // Continue to next middleware
  next();
  
  // Track usage after response (non-blocking)
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - req.usageStart;
    const usage = {
      ...req.usageData,
      response_time: responseTime,
      status_code: res.statusCode,
      data_size: Buffer.byteLength(data || ''),
      success: res.statusCode < 400
    };
    
    // Log usage asynchronously
    setImmediate(() => logUsage(usage));
    
    return originalSend.call(this, data);
  };
};

const logUsage = async (usage) => {
  try {
    // Store usage in Onasis-CORE Supabase for vendor billing
    await fetch(`${ONASIS_REST_BASE}/${ONASIS_USAGE_TABLE}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONASIS_SUPABASE_SERVICE_KEY}`,
        'apikey': ONASIS_SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(usage)
    });
  } catch (error) {
    logger.error('Failed to log usage', { error: error.message, usage });
  }
};

// Health check with platform info
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    platform: req.platform,
    service: 'Onasis-CORE Multi-Platform Router',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    available_platforms: Object.keys(PLATFORMS),
    timestamp: new Date().toISOString()
  });
});

// Platform discovery
app.get('/platforms', (req, res) => {
  const platformList = Object.entries(PLATFORMS).map(([domain, config]) => ({
    domain,
    name: config.name,
    brand: config.brand,
    services: config.services,
    billing_model: config.billing_model,
    target_audience: config.target,
    api_base: `https://${domain}/api`
  }));
  
  res.json({
    platforms: platformList,
    current_platform: req.platform,
    total_platforms: platformList.length
  });
});

// Authentication routes
app.post('/auth/register', authRateLimit, async (req, res) => {
  try {
    const { email, password, name, platform_preference } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: {
          message: 'Email and password required',
          code: 'MISSING_CREDENTIALS',
          platform: req.platform?.brand
        }
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user in Onasis-CORE Supabase Auth
    const authResponse = await fetch(`${ONASIS_AUTH_BASE}/signup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONASIS_SUPABASE_ANON_KEY}`,
        'apikey': ONASIS_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        data: {
          name,
          platform_preference: platform_preference || req.platform?.domain,
          registration_platform: req.platform?.domain
        }
      })
    });
    
    const authData = await authResponse.json();
    
    if (!authResponse.ok) {
      throw new Error(authData.error_description || 'Registration failed');
    }
    
    // Create user profile
    await fetch(`${SUPABASE_REST_BASE}/${PROFILE_TABLE}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: authData.user.id,
        email: authData.user.email,
        name,
        platform_preference: platform_preference || req.platform?.domain,
        registration_platform: req.platform?.domain,
        created_at: new Date().toISOString()
      })
    });
    
    res.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name
      },
      platform: req.platform?.brand,
      access_token: authData.access_token,
      refresh_token: authData.refresh_token
    });
    
  } catch (error) {
    logger.error('Registration failed', { error: error.message, platform: req.platform?.domain });
    res.status(400).json({
      error: {
        message: error.message,
        code: 'REGISTRATION_FAILED',
        platform: req.platform?.brand
      }
    });
  }
});

app.post('/auth/login', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: {
          message: 'Email and password required',
          code: 'MISSING_CREDENTIALS',
          platform: req.platform?.brand
        }
      });
    }
    
    // Authenticate with Supabase
    const authResponse = await fetch(`${SUPABASE_AUTH_BASE}/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const authData = await authResponse.json();
    
    if (!authResponse.ok) {
      throw new Error('Invalid credentials');
    }
    
    // Get user profile
    const profileResponse = await fetch(
      `${SUPABASE_REST_BASE}/${PROFILE_TABLE}?select=*&user_id=eq.${authData.user.id}`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY
        }
      }
    );
    
    const profile = await profileResponse.json();
    
    res.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        ...profile[0]
      },
      platform: req.platform?.brand,
      access_token: authData.access_token,
      refresh_token: authData.refresh_token
    });
    
  } catch (error) {
    logger.error('Login failed', { error: error.message, platform: req.platform?.domain });
    res.status(401).json({
      error: {
        message: 'Authentication failed',
        code: 'LOGIN_FAILED',
        platform: req.platform?.brand
      }
    });
  }
});

// Billing routes
app.get('/billing/usage', billingRateLimit, authenticateUser, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = `select=*&user_id=eq.${req.user.id}`;
    if (start_date) query += `&timestamp=gte.${start_date}`;
    if (end_date) query += `&timestamp=lte.${end_date}`;
    
    const usageResponse = await fetch(`${SUPABASE_REST_BASE}/${USAGE_TABLE}?${query}`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY
      }
    });
    
    const usage = await usageResponse.json();
    
    // Calculate costs based on platform billing model
    const platformBilling = req.platform?.billing_model;
    const totalCost = calculateUsageCost(usage, platformBilling);
    
    res.json({
      usage_records: usage,
      summary: {
        total_requests: usage.length,
        total_cost: totalCost,
        currency: 'USD',
        billing_model: platformBilling,
        platform: req.platform?.brand
      }
    });
    
  } catch (error) {
    logger.error('Billing usage fetch failed', { error: error.message });
    res.status(500).json({
      error: {
        message: 'Failed to fetch usage data',
        code: 'BILLING_ERROR',
        platform: req.platform?.brand
      }
    });
  }
});

// API service routing
app.use('/api/:service', apiRateLimit, trackUsage, async (req, res) => {
  try {
    const { service } = req.params;
    const platform = req.platform;
    
    // Check if service is available for this platform
    if (!platform.services.includes(service)) {
      return res.status(404).json({
        error: {
          message: `Service '${service}' not available on ${platform.brand}`,
          code: 'SERVICE_NOT_AVAILABLE',
          platform: platform.brand,
          available_services: platform.services
        }
      });
    }
    
    // Map service to Supabase function
    const serviceMapping = {
      'ai-chat': '/functions/v1/ai-chat',
      'text-to-speech': '/functions/v1/elevenlabs-tts',
      'speech-to-text': '/functions/v1/elevenlabs-stt',
      'transcribe': '/functions/v1/whisper-transcribe',
      'extract-tags': '/functions/v1/extract-tags',
      'generate-summary': '/functions/v1/generate-summary',
      'generate-embedding': '/functions/v1/generate-embedding',
      'mcp-handler': '/functions/v1/mcp-handler',
      'data-analytics': '/functions/v1/ai-chat',
      'automation': '/functions/v1/mcp-handler',
      'integrations': '/functions/v1/mcp-handler',
      'api-gateway': '/functions/v1/ai-chat',
      'developer-tools': '/functions/v1/mcp-handler',
      'embeddings': '/functions/v1/generate-embedding',
      'vector-search': '/functions/v1/generate-embedding',
      'translation': '/functions/v1/ai-chat',
      'privacy-chat': '/functions/v1/ai-chat',
      'model-hosting': '/functions/v1/ai-chat',
      'inference-api': '/functions/v1/ai-chat'
    };
    
    const supabasePath = serviceMapping[service];
    if (!supabasePath) {
      return res.status(404).json({
        error: {
          message: `Service '${service}' not implemented`,
          code: 'SERVICE_NOT_IMPLEMENTED',
          platform: platform.brand
        }
      });
    }
    
    // Route to Supabase with platform branding
    const result = await routeToSupabaseWithBranding(req, service, supabasePath, platform);
    res.json(result);
    
  } catch (error) {
    logger.error('API routing failed', { 
      error: error.message, 
      service: req.params.service,
      platform: req.platform?.domain 
    });
    
    res.status(500).json({
      error: {
        message: 'Service temporarily unavailable',
        code: 'SERVICE_ERROR',
        platform: req.platform?.brand
      }
    });
  }
});

// Route to Supabase with platform-specific branding
const routeToSupabaseWithBranding = async (req, serviceName, supabasePath, platform) => {
  const url = `${SUPABASE_URL}${supabasePath}`;
  const requestStartTime = Date.now();
  
  // Add platform context to request body
  const enhancedBody = {
    ...req.body,
    platform_context: {
      brand: platform.brand,
      domain: platform.domain,
      billing_model: platform.billing_model,
      target_audience: platform.target
    }
  };
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'apikey': SUPABASE_ANON_KEY,
    'User-Agent': `${platform.brand}/1.0`,
    'X-Platform': platform.brand
  };
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  
  let response;
  try {
    response = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? JSON.stringify(enhancedBody) : undefined,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase function error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  const responseTime = Date.now() - requestStartTime;
  
  // Add platform branding to response
  return {
    ...data,
    platform_metadata: {
      brand: platform.brand,
      service: serviceName,
      response_time: responseTime,
      billing_model: platform.billing_model,
      powered_by: `${platform.brand} via Onasis-CORE`
    }
  };
};

// Calculate usage cost based on billing model
const calculateUsageCost = (usage, billingModel) => {
  // Simplified cost calculation - replace with your actual pricing logic
  const baseCost = usage.length * 0.001; // $0.001 per request
  
  switch (billingModel) {
    case 'subscription_tiers':
      return 0; // Covered by subscription
    case 'usage_based':
      return baseCost;
    case 'token_consumption':
      return baseCost * 10; // Higher cost for AI tokens
    case 'freemium_premium':
      return baseCost * 0.5; // Reduced cost
    case 'compute_hours':
      return baseCost * 5; // Compute-based pricing
    default:
      return baseCost;
  }
};

// Error handling
app.use((error, req, res, next) => {
  logger.error('Multi-platform router error', {
    error: error.message,
    platform: req.platform?.domain,
    stack: error.stack
  });
  
  res.status(500).json({
    error: {
      message: 'Internal platform error',
      code: 'PLATFORM_ERROR',
      platform: req.platform?.brand
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      code: 'ENDPOINT_NOT_FOUND',
      platform: req.platform?.brand
    },
    available_endpoints: [
      '/health',
      '/platforms',
      '/auth/register',
      '/auth/login',
      '/billing/usage',
      '/api/{service}'
    ]
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Onasis-CORE Multi-Platform Router started', {
    port: PORT,
    platforms: Object.keys(PLATFORMS),
    supabase_url: SUPABASE_URL
  });
  
  console.log(`🌍 Onasis-CORE Multi-Platform Router running on port ${PORT}`);
  console.log(`🚀 Supporting ${Object.keys(PLATFORMS).length} platforms:`);
  Object.entries(PLATFORMS).forEach(([domain, config]) => {
    console.log(`   • ${config.brand} (${domain})`);
  });
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 Platforms: http://localhost:${PORT}/platforms`);
});

module.exports = app;
