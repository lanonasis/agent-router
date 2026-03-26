#!/usr/bin/env node

/**
 * Onasis-CORE Vendor Authentication Middleware
 * Supabase-powered vendor management with unique identifiers and API keys
 */

// Node 18+ provides fetch globally — no node-fetch import needed.
const crypto = require('crypto');
const winston = require('winston');

class VendorAuthManager {
  constructor(supabaseUrl, supabaseServiceKey) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseServiceKey = supabaseServiceKey;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'vendor-auth' },
      transports: [
        new winston.transports.File({ filename: 'logs/vendor-auth.log' }),
        new winston.transports.Console()
      ]
    });
  }

  // Middleware for vendor authentication
  authenticateVendor = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return this.sendAuthError(res, 'Missing or invalid authorization header', 'AUTH_HEADER_MISSING');
      }

      const apiKey = authHeader.replace('Bearer ', '');
      const [keyId, keySecret] = this.parseApiKey(apiKey);

      if (!keyId || !keySecret) {
        return this.sendAuthError(res, 'Invalid API key format', 'INVALID_KEY_FORMAT');
      }

      // Validate with Supabase
      const vendorInfo = await this.validateApiKey(keyId, keySecret);
      
      if (!vendorInfo.is_valid) {
        return this.sendAuthError(res, 'Invalid API key', 'INVALID_CREDENTIALS');
      }

      // Check platform access
      const platform = req.get('host') || req.headers['x-platform'];
      if (!this.checkPlatformAccess(vendorInfo, platform)) {
        return this.sendAuthError(res, `Access denied for platform: ${platform}`, 'PLATFORM_ACCESS_DENIED');
      }

      // Check service permissions
      const service = req.params.service || req.path.split('/')[2];
      if (!this.checkServicePermission(vendorInfo, service)) {
        return this.sendAuthError(res, `Service access denied: ${service}`, 'SERVICE_ACCESS_DENIED');
      }

      // Rate limiting check
      const rateLimitCheck = await this.checkRateLimit(vendorInfo.vendor_org_id, vendorInfo.rate_limit);
      if (!rateLimitCheck.allowed) {
        return this.sendAuthError(res, 'Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
      }

      // Attach vendor info to request
      req.vendor = {
        org_id: vendorInfo.vendor_org_id,
        vendor_code: vendorInfo.vendor_code,
        rate_limit: vendorInfo.rate_limit,
        allowed_platforms: vendorInfo.allowed_platforms,
        allowed_services: vendorInfo.allowed_services,
        api_key_id: vendorInfo.api_key_id
      };

      // Set vendor context for RLS
      await this.setVendorContext(vendorInfo.vendor_org_id);

      this.logger.info('Vendor authenticated successfully', {
        vendor_code: vendorInfo.vendor_code,
        platform: platform,
        service: service,
        ip: req.ip
      });

      next();

    } catch (error) {
      this.logger.error('Vendor authentication error', { error: error.message });
      return this.sendAuthError(res, 'Authentication service error', 'AUTH_SERVICE_ERROR');
    }
  };

  // Parse API key into ID and secret
  parseApiKey(apiKey) {
    // Expected format: pk_live_vendorcode_keyid.sk_live_secret
    const parts = apiKey.split('.');
    if (parts.length !== 2) {
      return { keyId: null, keySecret: null };
    }

    return {
      keyId: parts[0],
      keySecret: parts[1]
    };
  }

  // Validate API key with Supabase
  async validateApiKey(keyId, keySecret) {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/validate_vendor_api_key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'apikey': this.supabaseServiceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_key_id: keyId,
          p_key_secret: keySecret
        })
      });

      if (!response.ok) {
        throw new Error(`Supabase validation failed: ${response.status}`);
      }

      const result = await response.json();
      return result[0] || { is_valid: false };

    } catch (error) {
      this.logger.error('API key validation failed', { error: error.message, keyId });
      return { is_valid: false };
    }
  }

  // Check platform access permissions
  checkPlatformAccess(vendorInfo, platform) {
    if (!vendorInfo.allowed_platforms || vendorInfo.allowed_platforms.length === 0) {
      return true; // No restrictions
    }

    return vendorInfo.allowed_platforms.includes(platform);
  }

  // Check service permissions
  checkServicePermission(vendorInfo, service) {
    if (!vendorInfo.allowed_services || Object.keys(vendorInfo.allowed_services).length === 0) {
      return true; // No restrictions
    }

    return vendorInfo.allowed_services[service] === true;
  }

  // Rate limiting check
  // ⚠️ SECURITY NOTE: In-memory rate limiting resets on process restart and doesn't sync across instances.
  // For production/clustered deployments, set RATE_LIMIT_STORE=supabase to use database-backed limiting.
  async checkRateLimit(vendorOrgId, rateLimit) {
    try {
      const currentMinute = Math.floor(Date.now() / 60000);
      
      // Production mode: Use Supabase for distributed rate limiting
      if (process.env.RATE_LIMIT_STORE === 'supabase' && this.supabaseUrl) {
        try {
          const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/increment_rate_limit`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.supabaseServiceKey}`,
              'apikey': this.supabaseServiceKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              p_vendor_org_id: vendorOrgId,
              p_minute: currentMinute,
              p_limit: rateLimit
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            const count = result[0]?.count || 0;
            return {
              allowed: count <= rateLimit,
              remaining: Math.max(0, rateLimit - count),
              reset: (currentMinute + 1) * 60000
            };
          }
        } catch (dbError) {
          this.logger.warn('Supabase rate limit failed, falling back to in-memory', { error: dbError.message });
        }
      }
      
      // Fallback: Simple in-memory rate limiting (NOT cluster-safe)
      if (!this.rateLimitCache) {
        this.rateLimitCache = new Map();
      }

      const vendorLimits = this.rateLimitCache.get(vendorOrgId) || { minute: currentMinute, count: 0 };
      
      if (vendorLimits.minute !== currentMinute) {
        vendorLimits.minute = currentMinute;
        vendorLimits.count = 0;
      }

      vendorLimits.count++;
      this.rateLimitCache.set(vendorOrgId, vendorLimits);

      return {
        allowed: vendorLimits.count <= rateLimit,
        remaining: Math.max(0, rateLimit - vendorLimits.count),
        reset: (currentMinute + 1) * 60000
      };

    } catch (error) {
      this.logger.error('Rate limit check failed', { error: error.message, vendorOrgId });
      return { allowed: true, remaining: 100, reset: Date.now() + 60000 };
    }
  }

  // Set vendor context for RLS
  async setVendorContext(vendorOrgId) {
    try {
      await fetch(`${this.supabaseUrl}/rest/v1/rpc/set_config`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'apikey': this.supabaseServiceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          setting_name: 'app.vendor_org_id',
          setting_value: vendorOrgId
        })
      });
    } catch (error) {
      this.logger.warn('Failed to set vendor context', { error: error.message, vendorOrgId });
    }
  }

  // Log usage for billing
  async logUsage(req, res, usage) {
    try {
      const usageData = {
        vendor_org_id: req.vendor.org_id,
        api_key_id: req.vendor.api_key_id,
        request_id: req.anonymousId || crypto.randomBytes(16).toString('hex'),
        platform: req.get('host') || req.headers['x-platform'],
        service: req.params.service || req.path.split('/')[2],
        processing_time_ms: usage.processing_time || 0,
        tokens_consumed: usage.tokens || 0,
        status_code: res.statusCode,
        success: res.statusCode < 400
      };

      await fetch(`${this.supabaseUrl}/rest/v1/rpc/log_vendor_usage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'apikey': this.supabaseServiceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_vendor_org_id: usageData.vendor_org_id,
          p_api_key_id: usageData.api_key_id,
          p_request_id: usageData.request_id,
          p_platform: usageData.platform,
          p_service: usageData.service,
          p_processing_time_ms: usageData.processing_time_ms,
          p_tokens_consumed: usageData.tokens_consumed,
          p_status_code: usageData.status_code,
          p_success: usageData.success
        })
      });

      this.logger.info('Usage logged', {
        vendor_code: req.vendor.vendor_code,
        service: usageData.service,
        tokens: usageData.tokens_consumed
      });

    } catch (error) {
      this.logger.error('Failed to log usage', { error: error.message });
    }
  }

  // Create usage tracking middleware
  trackUsage = (req, res, next) => {
    const startTime = Date.now();
    req.usageTracking = { startTime };

    // Override res.send to capture usage data
    const originalSend = res.send;
    res.send = (data) => {
      const processingTime = Date.now() - startTime;
      const responseData = typeof data === 'string' ? data : JSON.stringify(data);
      
      // Extract token usage from response if available
      let tokensUsed = 0;
      try {
        const parsed = typeof data === 'object' ? data : JSON.parse(responseData);
        tokensUsed = parsed.usage?.total_tokens || parsed.onasis_metadata?.usage?.total_tokens || 0;
      } catch (e) {
        // Ignore parsing errors
      }

      // Log usage asynchronously
      setImmediate(() => {
        this.logUsage(req, res, {
          processing_time: processingTime,
          tokens: tokensUsed,
          response_size: Buffer.byteLength(responseData)
        });
      });

      return originalSend.call(res, data);
    };

    next();
  };

  // Generate new API key for vendor
  async generateApiKey(vendorOrgId, keyName = 'Default API Key', keyType = 'live', environment = 'production') {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/generate_vendor_api_key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'apikey': this.supabaseServiceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_vendor_org_id: vendorOrgId,
          p_key_name: keyName,
          p_key_type: keyType,
          p_environment: environment
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to generate API key: ${response.status}`);
      }

      const result = await response.json();
      const keyData = result[0];

      // Return complete API key in expected format
      return {
        api_key: `${keyData.key_id}.${keyData.key_secret}`,
        key_id: keyData.key_id,
        key_name: keyName,
        key_type: keyType,
        environment: environment,
        record_id: keyData.api_key_record_id
      };

    } catch (error) {
      this.logger.error('API key generation failed', { error: error.message, vendorOrgId });
      throw error;
    }
  }

  // Get vendor usage summary
  async getUsageSummary(vendorOrgId, startDate, endDate) {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/get_vendor_usage_summary`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'apikey': this.supabaseServiceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_vendor_org_id: vendorOrgId,
          p_start_date: startDate,
          p_end_date: endDate
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to get usage summary: ${response.status}`);
      }

      const result = await response.json();
      return result[0] || {};

    } catch (error) {
      this.logger.error('Usage summary fetch failed', { error: error.message, vendorOrgId });
      throw error;
    }
  }

  // Send authentication error response
  sendAuthError(res, message, code) {
    return res.status(401).json({
      error: {
        message,
        code,
        type: 'authentication_error'
      },
      timestamp: new Date().toISOString()
    });
  }

  // Vendor management endpoints
  getVendorManagementRoutes() {
    const express = require('express');
    const router = express.Router();

    // Create new vendor organization
    router.post('/vendors', async (req, res) => {
      try {
        const {
          organization_name,
          organization_type,
          contact_email,
          contact_name,
          platform_access,
          billing_tier
        } = req.body;

        // Generate unique vendor code
        const vendorCode = this.generateVendorCode(organization_name);

        const response = await fetch(`${this.supabaseUrl}/rest/v1/vendor_organizations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.supabaseServiceKey}`,
            'apikey': this.supabaseServiceKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            vendor_code: vendorCode,
            organization_name,
            organization_type,
            contact_email,
            contact_name,
            platform_access: platform_access || [],
            billing_tier: billing_tier || 'starter'
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to create vendor: ${response.status}`);
        }

        const vendor = await response.json();
        
        // Generate initial API key
        const apiKey = await this.generateApiKey(vendor.id, 'Initial API Key');

        res.json({
          success: true,
          vendor: vendor,
          api_key: apiKey
        });

      } catch (error) {
        this.logger.error('Vendor creation failed', { error: error.message });
        res.status(500).json({ error: 'Failed to create vendor organization' });
      }
    });

    // Generate new API key for vendor
    router.post('/vendors/:vendorId/api-keys', async (req, res) => {
      try {
        const { vendorId } = req.params;
        const { key_name, key_type, environment } = req.body;

        const apiKey = await this.generateApiKey(
          vendorId,
          key_name || 'API Key',
          key_type || 'live',
          environment || 'production'
        );

        res.json({
          success: true,
          api_key: apiKey
        });

      } catch (error) {
        this.logger.error('API key generation failed', { error: error.message });
        res.status(500).json({ error: 'Failed to generate API key' });
      }
    });

    // Get vendor usage summary
    router.get('/vendors/:vendorId/usage', async (req, res) => {
      try {
        const { vendorId } = req.params;
        const { start_date, end_date } = req.query;

        const usage = await this.getUsageSummary(
          vendorId,
          start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end_date || new Date().toISOString()
        );

        res.json({
          success: true,
          usage: usage
        });

      } catch (error) {
        this.logger.error('Usage summary failed', { error: error.message });
        res.status(500).json({ error: 'Failed to get usage summary' });
      }
    });

    return router;
  }

  // Generate unique vendor code
  generateVendorCode(organizationName) {
    const prefix = organizationName
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .substring(0, 4);
    
    const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    return `${prefix}_${suffix}`;
  }
}

module.exports = VendorAuthManager;