#!/usr/bin/env node

/**
 * Onasis-CORE AI Service Router (Ollama-first)
 * Single-loop orchestration with memory prefetch + tool calls
 * Keeps vendor auth, usage logging, and privacy-safe logs
 */

const winston = require('winston');
const crypto = require('crypto');
const {
  resolveVendorChainForUseCase,
  sanitizeVendorResponse,
  resolveUseCaseFromRequest,
} = require('../vendors');

// Node 18+ has native fetch globally available; no node-fetch needed.

class AIServiceRouter {
  constructor(config) {
    this.ollamaBaseUrl = config.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.ollamaChatPath = config.ollamaChatPath || process.env.OLLAMA_CHAT_PATH || '/api/chat';
    this.ollamaModel = config.ollamaModel || process.env.OLLAMA_MODEL || 'qwen2:1.5b';
    this.ollamaToolModel = config.ollamaToolModel || process.env.OLLAMA_TOOL_MODEL || '';
    this.apiBaseUrl = config.apiBaseUrl || process.env.API_BASE_URL || 'https://api.lanonasis.com';
    this.authGatewayUrl = config.authGatewayUrl || process.env.AUTH_GATEWAY_URL || 'http://localhost:4000';
    this.onasisSupabaseUrl = config.onasisSupabaseUrl;
    this.onasisServiceKey = config.onasisServiceKey;

    this.memoryPrefetchTopK = parseInt(process.env.MEMORY_PREFETCH_TOPK || '8', 10);
    this.routerTimeoutMs = parseInt(process.env.ROUTER_TIMEOUT_MS || '15000', 10);
    this.prefetchEnabled = (process.env.MEMORY_PREFETCH_ENABLED || 'true') === 'true';
    this.maxPrefetchChars = parseInt(process.env.MEMORY_PREFETCH_MAX_CHARS || '4000', 10);
    this.maxToolResultChars = parseInt(process.env.TOOL_RESULT_MAX_CHARS || '6000', 10);
    this.toolSummarizeEnabled = (process.env.TOOL_RESULT_SUMMARIZE || 'false') === 'true';
    this.returnActionsEnvelope = (process.env.RETURN_ACTIONS_ENVELOPE || 'false') === 'true';
    this.softToolParseEnabled = (process.env.SOFT_TOOL_PARSE || 'true') === 'true';
    this.responseCleanupEnabled = (process.env.RESPONSE_CLEANUP_ENABLED || 'true') === 'true';

    this.memorySearchPath = process.env.MEMORY_SEARCH_PATH || '/api/v1/memories/search';
    this.memoryGetPath = process.env.MEMORY_GET_PATH || '/api/v1/memories';
    this.memoryWritePath = process.env.MEMORY_WRITE_PATH || '/api/v1/memories';
    this.memoryBatchGetPath = process.env.MEMORY_BATCH_GET_PATH || '';

    this.prefetchCache = new Map();
    // Tracks in-flight prefetch requests to prevent duplicate concurrent fetches
    this._prefetchInflight = new Map();
    // Per-vendor circuit breaker state { failCount, lastFailedAt }
    this._vendorBreaker = new Map();

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'ai-service-router' },
      transports: [
        new winston.transports.File({ filename: require('path').join(__dirname, '../logs/ai-router.log') }),
        new winston.transports.Console()
      ]
    });
  }

  // Service mapping: Ollama-first
  getServiceMapping() {
    return {
      'ai-chat': { type: 'ollama', description: 'Ollama AI chat with memory tools' },
      'chat': { type: 'ollama', description: 'Ollama AI chat with memory tools' },
      'ollama': { type: 'ollama', description: 'Direct Ollama chat' }
    };
  }

  // Route request to appropriate service
  async routeToAIService(req, res) {
    const startTime = Date.now();
    const { service } = req.params;
    const serviceMapping = this.getServiceMapping();
    const serviceConfig = serviceMapping[service];

    if (!serviceConfig) {
      return res.status(404).json({
        error: {
          message: `AI service '${service}' not found`,
          code: 'SERVICE_NOT_FOUND',
          available_services: Object.keys(serviceMapping)
        }
      });
    }

    try {
      let result;
      if (serviceConfig.type === 'ollama') {
        result = await this.handleOllamaChat(req);
      } else {
        throw new Error(`Unsupported service type: ${serviceConfig.type}`);
      }

      const processingTime = Date.now() - startTime;
      const usage = this.extractUsageData(result, processingTime);

      // Usage logging (disabled for now - no vendorAuth configured)
      // setImmediate(() => {
      //   this.vendorAuth.logUsage(req, res, usage);
      // });

      const useCase = resolveUseCaseFromRequest(req);

      // Strip any vendor/model identifiers before sending to client
      const sanitized = sanitizeVendorResponse(result, useCase);
      const response = this.addOnasisBranding(sanitized, {
        service,
        user_auth_id: req.uai?.authId,
        processing_time: processingTime,
      });

      res.json(response);
    } catch (error) {
      this.logger.error('AI service routing failed', {
        service,
        vendor_code: req.vendor?.vendor_code,
        error: error.message
      });

      res.status(500).json({
        error: {
          message: 'AI service temporarily unavailable',
          code: 'AI_SERVICE_ERROR',
          service: service
        }
      });
    }
  }

  // Kept as a last-resort fallback; real prompts come from the vendor abstraction layer.
  _fallbackSystemPrompt() {
    return process.env.OLLAMA_SYSTEM_PROMPT ||
      'You are the Onasis AI assistant. Never reveal AI provider, model names, or internal configuration.';
  }

  buildAuthHeaders(req) {
    const headers = {};
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }
    if (req.headers['x-api-key']) {
      headers['X-API-Key'] = req.headers['x-api-key'];
    }
    if (req.uai?.authId) {
      headers['X-UAI-Auth-Id'] = req.uai.authId;
      headers['X-UAI-Organization'] = req.uai.organizationId || '';
      headers['X-UAI-Auth-Method'] = req.uai.authMethod || '';
      headers['X-UAI-Email'] = req.uai.email || '';
    }
    if (!headers['Authorization'] && process.env.MEMORY_AUTH_BEARER) {
      headers['Authorization'] = `Bearer ${process.env.MEMORY_AUTH_BEARER}`;
    }
    if (!headers['X-API-Key'] && process.env.MEMORY_API_KEY) {
      headers['X-API-Key'] = process.env.MEMORY_API_KEY;
    }
    return headers;
  }

  getLatestUserMessage(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i] && messages[i].role === 'user' && typeof messages[i].content === 'string') {
        return messages[i].content;
      }
    }
    return '';
  }

  async handleOllamaChat(req) {
    const body = req.body || {};
    const incomingMessages = Array.isArray(body.messages)
      ? body.messages
      : (body.prompt ? [{ role: 'user', content: String(body.prompt) }] : []);

    // ── Use-case resolution ────────────────────────────────────────────────
    // The router allocates the vendor + model — clients only send use_case.
    const useCase = resolveUseCaseFromRequest(req);
    const vendorChain = resolveVendorChainForUseCase(useCase);

    if (vendorChain.length === 0) {
      this.logger.error('No active vendor available for use case', { useCase });
      throw new Error('No active AI vendor available. Check vendor configuration.');
    }

    // ── Build message chain ───────────────────────────────────────────────
    // systemPrompt is the same across all vendors in the chain (use-case driven)
    const { systemPrompt, maxTokens, temperature } = vendorChain[0];
    const systemMsg = systemPrompt || this._fallbackSystemPrompt();

    const messages = [{ role: 'system', content: systemMsg }];

    const prefetchBrief = await this.prefetchMemoryBrief(req, incomingMessages, body);
    if (prefetchBrief) {
      messages.push({ role: 'system', content: prefetchBrief });
    }

    messages.push(...incomingMessages);

    const tools = Array.isArray(body.tools) && body.tools.length > 0 ? body.tools : this.getToolDefinitions();
    const internalRequest = { messages, systemPrompt: null, temperature, maxTokens, tools };

    // ── Vendor selection with fallback chain ──────────────────────────────
    // Try each vendor in priority order. Circuit breaker skips recently-failed
    // vendors to avoid slow timeouts on every request during an outage.
    let selectedVendor = null;
    let adapterResponse;
    let lastError;

    for (const vendor of vendorChain) {
      if (this._isCircuitOpen(vendor._vendorId)) {
        this.logger.warn('Vendor circuit open — skipping', { vendorId: vendor._vendorId });
        continue;
      }

      try {
        adapterResponse = await vendor._adapter.chat(internalRequest, vendor._model);
        this._circuitSuccess(vendor._vendorId);
        selectedVendor = vendor;
        break;
      } catch (err) {
        this._circuitFailure(vendor._vendorId);
        this.logger.warn('Vendor failed, trying next fallback', {
          vendorId: vendor._vendorId,
          error:    err.message,
        });
        lastError = err;
      }
    }

    if (!adapterResponse || !selectedVendor) {
      this.logger.error('All vendors in chain failed', { useCase, chainLength: vendorChain.length });
      throw lastError || new Error('All AI vendors exhausted — no response available');
    }

    const { _adapter, _model } = selectedVendor;

    // ── First inference result ────────────────────────────────────────────
    const extracted = this.extractAssistantMessage(adapterResponse);
    let toolCalls = this.extractToolCalls(adapterResponse);

    if (toolCalls.length === 0 && this.softToolParseEnabled) {
      toolCalls = this.extractSoftToolCalls(extracted.content || '');
    }

    if (toolCalls.length === 0) {
      const responseText = this.cleanAssistantText(extracted.content || '');
      const response = this.wrapResponse(responseText, extracted);
      response.usage = adapterResponse.usage;
      return response;
    }

    // ── Tool execution + follow-up pass ───────────────────────────────────
    // Continue with the same vendor that succeeded on the first pass.
    const toolResults = await this.executeToolCalls(toolCalls, req);
    const toolMessages = toolResults.map((toolResult) => ({
      role: 'tool',
      tool_name: toolResult.name,
      content: toolResult.payload,
    }));

    const followupMessages = messages.concat([extracted.raw]).concat(toolMessages);
    const followupRequest = { messages: followupMessages, systemPrompt: null, temperature, maxTokens, tools };
    const followup = await _adapter.chat(followupRequest, _model);

    const finalMessage = this.extractAssistantMessage(followup);
    const finalText = this.cleanAssistantText(finalMessage.content || '');

    const response = this.wrapResponse(finalText, finalMessage);
    response.usage = followup.usage;
    return response;
  }

  // ── Circuit Breaker ───────────────────────────────────────────────────────

  _isCircuitOpen(vendorId) {
    const state = this._vendorBreaker.get(vendorId);
    if (!state) return false;
    const COOLDOWN_MS  = parseInt(process.env.VENDOR_CIRCUIT_COOLDOWN_MS  || '30000', 10);
    const FAIL_THRESHOLD = parseInt(process.env.VENDOR_CIRCUIT_THRESHOLD || '3', 10);
    return state.failCount >= FAIL_THRESHOLD &&
           (Date.now() - state.lastFailedAt) < COOLDOWN_MS;
  }

  _circuitFailure(vendorId) {
    const state = this._vendorBreaker.get(vendorId) || { failCount: 0, lastFailedAt: 0 };
    state.failCount  += 1;
    state.lastFailedAt = Date.now();
    this._vendorBreaker.set(vendorId, state);
  }

  _circuitSuccess(vendorId) {
    // Decay failure count on success instead of immediate reset
    // This prevents flaky vendors (90% failure rate) from staying in rotation
    const state = this._vendorBreaker.get(vendorId);
    if (state) {
      state.failCount = Math.max(0, state.failCount - 2); // Decay by 2 on success
      if (state.failCount === 0) {
        this._vendorBreaker.delete(vendorId);
      } else {
        this._vendorBreaker.set(vendorId, state);
      }
    }
  }

  getToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'memory.search',
          description: 'Search memories using semantic vector search',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              topK: { type: 'integer', minimum: 1, maximum: 50 },
              memory_type: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'memory.get',
          description: 'Fetch one or more memories by id',
          parameters: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'string' } }
            },
            required: ['ids']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'memory.write',
          description: 'Create a memory entry',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              memory_type: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              metadata: { type: 'object' }
            },
            required: ['content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code.read',
          description: 'Read a file from the codebase',
          parameters: {
            type: 'object',
            properties: {
              file_path: { type: 'string', description: 'Path to file (relative or absolute)' }
            },
            required: ['file_path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code.write',
          description: 'Write or modify a file in the codebase',
          parameters: {
            type: 'object',
            properties: {
              file_path: { type: 'string', description: 'Path to file' },
              content: { type: 'string', description: 'File content to write' },
              mode: { type: 'string', enum: ['write', 'append'], description: 'Write mode: write (overwrite) or append' }
            },
            required: ['file_path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code.run_command',
          description: 'Execute a shell command (use with caution)',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command to run' },
              cwd: { type: 'string', description: 'Working directory (optional)' }
            },
            required: ['command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code.scan_dependencies',
          description: 'Scan project dependencies for issues and vulnerabilities',
          parameters: {
            type: 'object',
            properties: {
              directory: { type: 'string', description: 'Project directory to scan' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'code.find_related',
          description: 'Find files related to a feature or keyword',
          parameters: {
            type: 'object',
            properties: {
              feature: { type: 'string', description: 'Feature name or keyword to search for' },
              file_types: { type: 'array', items: { type: 'string' }, description: 'File extensions to search (e.g., ["js", "ts"])' }
            },
            required: ['feature']
          }
        }
      }
    ];
  }

  async prefetchMemoryBrief(req, messages, body) {
    if (!this.prefetchEnabled) return '';

    const latestUserMessage = this.getLatestUserMessage(messages);
    if (!latestUserMessage) return '';

    const cacheKey = latestUserMessage.slice(0, 200);

    // Check warm cache first
    const cached = this.prefetchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Deduplicate concurrent requests for the same cache key (race condition fix)
    if (this._prefetchInflight.has(cacheKey)) {
      return this._prefetchInflight.get(cacheKey);
    }

    const fetchPromise = this._executePrefetchFetch(req, body, cacheKey, latestUserMessage)
      .finally(() => this._prefetchInflight.delete(cacheKey));

    this._prefetchInflight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  async _executePrefetchFetch(req, body, cacheKey, latestUserMessage) {
    const searchBody = {
      query: latestUserMessage,
      limit: this.memoryPrefetchTopK,
      memory_type: body.memory_type || body.type || undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.routerTimeoutMs);

      let response;
      try {
        response = await fetch(`${this.apiBaseUrl}${this.memorySearchPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.buildAuthHeaders(req)
          },
          body: JSON.stringify(searchBody),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) return '';

      const data = await response.json();
      const brief = this.buildWorkingMemoryBrief(data);

      if (brief) {
        this.prefetchCache.set(cacheKey, {
          value: brief,
          expiresAt: Date.now() + 2 * 60 * 1000
        });
      }

      return brief;
    } catch (error) {
      this.logger.warn('Memory prefetch failed', { error: error.message });
      return '';
    }
  }

  buildWorkingMemoryBrief(searchResponse) {
    const results = searchResponse?.data || [];
    if (!Array.isArray(results) || results.length === 0) return '';

    const lines = ['Working memory brief (prefetch):'];
    results.forEach((entry, index) => {
      const title = entry.title || 'Untitled';
      const content = typeof entry.content === 'string' ? entry.content : '';
      const snippet = content.length > 220 ? `${content.slice(0, 220)}…` : content;
      const tags = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
      const updated = entry.updated_at || entry.created_at || '';
      const id = entry.id || '';
      const line = `#${index + 1} [${id}] ${title} | ${tags} | ${updated} | ${snippet}`.trim();
      lines.push(line);
    });

    let brief = lines.join('\n');
    if (brief.length > this.maxPrefetchChars) {
      brief = `${brief.slice(0, this.maxPrefetchChars)}…`;
    }
    return brief;
  }

  extractAssistantMessage(ollamaResponse) {
    if (ollamaResponse?.message) {
      return {
        content: ollamaResponse.message.content || '',
        raw: ollamaResponse.message
      };
    }
    if (Array.isArray(ollamaResponse?.choices) && ollamaResponse.choices[0]?.message) {
      return {
        content: ollamaResponse.choices[0].message.content || '',
        raw: ollamaResponse.choices[0].message
      };
    }
    return { content: '', raw: { role: 'assistant', content: '' } };
  }

  extractToolCalls(ollamaResponse) {
    const direct =
      ollamaResponse?.message?.tool_calls ||
      ollamaResponse?.tool_calls ||
      ollamaResponse?.choices?.[0]?.message?.tool_calls ||
      [];

    if (!Array.isArray(direct)) return [];
    return direct.map((call) => ({
      id: call.id || call.tool_call_id || '',
      name: call.function?.name || call.name || '',
      arguments: call.function?.arguments || call.arguments || {}
    })).filter((call) => call.name);
  }

  extractSoftToolCalls(text) {
    if (!text || typeof text !== 'string') return [];
    const jsonMatch = text.match(/```json([\s\S]*?)```/i) || text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return parsed.tool_calls.map((call) => ({
          id: call.id || '',
          name: call.name || call.function?.name,
          arguments: call.arguments || call.function?.arguments || {}
        })).filter((call) => call.name);
      }
      if (parsed.tool && parsed.arguments) {
        return [{ id: '', name: parsed.tool, arguments: parsed.arguments }];
      }
      // Handle {name: "tool.name", arguments: {...}} format
      if (parsed.name && parsed.arguments) {
        return [{ id: '', name: parsed.name, arguments: parsed.arguments }];
      }
    } catch (_) {
      return [];
    }

    return [];
  }

  async executeToolCalls(toolCalls, req) {
    const results = [];
    for (const call of toolCalls) {
      const result = await this.executeToolCallWithRetry(call, req);
      results.push(result);
    }
    return results;
  }

  async executeToolCallWithRetry(call, req) {
    const attempt = async () => this.executeToolCall(call, req);
    try {
      return await attempt();
    } catch (error) {
      this.logger.warn('Tool call failed, retrying once', {
        tool: call.name,
        error: error.message
      });
      try {
        return await attempt();
      } catch (finalError) {
        return {
          name: call.name,
          payload: JSON.stringify({ error: 'Tool call failed', message: finalError.message })
        };
      }
    }
  }

  async executeToolCall(call, req) {
    const toolName = call.name;
    const args = this.safeParseArgs(call.arguments);

    if (toolName === 'memory.search') {
      const payload = await this.toolMemorySearch(args, req);
      return { name: toolName, payload };
    }
    if (toolName === 'memory.get') {
      const payload = await this.toolMemoryGet(args, req);
      return { name: toolName, payload };
    }
    if (toolName === 'memory.write') {
      const payload = await this.toolMemoryWrite(args, req);
      return { name: toolName, payload };
    }
    if (toolName === 'code.read') {
      const payload = await this.toolCodeRead(args);
      return { name: toolName, payload };
    }
    if (toolName === 'code.write') {
      const payload = await this.toolCodeWrite(args);
      return { name: toolName, payload };
    }
    if (toolName === 'code.run_command') {
      const payload = await this.toolCodeRunCommand(args);
      return { name: toolName, payload };
    }
    if (toolName === 'code.scan_dependencies') {
      const payload = await this.toolCodeScanDependencies(args);
      return { name: toolName, payload };
    }
    if (toolName === 'code.find_related') {
      const payload = await this.toolCodeFindRelated(args);
      return { name: toolName, payload };
    }

    return {
      name: toolName,
      payload: JSON.stringify({ error: 'Unsupported tool' })
    };
  }

  safeParseArgs(args) {
    if (!args) return {};
    if (typeof args === 'object') return args;
    try {
      return JSON.parse(args);
    } catch (_) {
      return {};
    }
  }

  async toolMemorySearch(args, req) {
    const requestBody = {
      query: args.query || '',
      limit: args.topK || this.memoryPrefetchTopK,
      memory_type: args.memory_type || undefined,
      tags: Array.isArray(args.tags) ? args.tags : undefined
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.routerTimeoutMs);
      let response;
      try {
        response = await fetch(`${this.apiBaseUrl}${this.memorySearchPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.buildAuthHeaders(req) },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const result = await response.json();
      return this.formatToolPayload(result);
    } catch (error) {
      this.logger.warn('memory.search tool failed', { error: error.message });
      return JSON.stringify({ error: 'Memory search failed', message: error.message });
    }
  }

  async toolMemoryGet(args, req) {
    const ids = Array.isArray(args.ids) ? args.ids : [];
    if (ids.length === 0) {
      return JSON.stringify({ error: 'No ids provided' });
    }

    const authHeaders = { 'Content-Type': 'application/json', ...this.buildAuthHeaders(req) };

    try {
      // Optional batch endpoint
      if (this.memoryBatchGetPath) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.routerTimeoutMs);
        let response;
        try {
          response = await fetch(`${this.apiBaseUrl}${this.memoryBatchGetPath}`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ ids }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        const result = await response.json();
        return this.formatToolPayload(result);
      }

      const results = await Promise.all(ids.map(async (id) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.routerTimeoutMs);
        let data;
        try {
          const response = await fetch(`${this.apiBaseUrl}${this.memoryGetPath}/${encodeURIComponent(id)}`, {
            method: 'GET',
            headers: authHeaders,
            signal: controller.signal
          });
          data = await response.json();
        } finally {
          clearTimeout(timer);
        }
        return data.data || data;
      }));

      return this.formatToolPayload({ data: results });
    } catch (error) {
      this.logger.warn('memory.get tool failed', { error: error.message });
      return JSON.stringify({ error: 'Memory get failed', message: error.message });
    }
  }

  async toolMemoryWrite(args, req) {
    const payload = {
      title: args.title,
      content: args.content,
      memory_type: args.memory_type,
      tags: args.tags,
      metadata: args.metadata
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.routerTimeoutMs);
      let response;
      try {
        response = await fetch(`${this.apiBaseUrl}${this.memoryWritePath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.buildAuthHeaders(req) },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const result = await response.json();
      return this.formatToolPayload(result);
    } catch (error) {
      this.logger.warn('memory.write tool failed', { error: error.message });
      return JSON.stringify({ error: 'Memory write failed', message: error.message });
    }
  }

  // Resolve and validate a file path stays within the allowed base directory.
  // Returns the resolved absolute path, or null if access is denied.
  _resolveRestrictedPath(filePath) {
    const path = require('path');
    const BASE_DIR = path.resolve(process.env.CODE_BASE_DIR || process.cwd());
    if (!filePath || typeof filePath !== 'string') return null;

    const resolved = path.resolve(BASE_DIR, filePath);

    // Ensure resolved path is within BASE_DIR (prevents ../../../etc/passwd attacks)
    const isInside = resolved === BASE_DIR || resolved.startsWith(BASE_DIR + path.sep);
    if (!isInside) {
      this.logger.warn('Path traversal attempt blocked', { filePath, resolved, BASE_DIR });
      return null;
    }
    return resolved;
  }

  // Code action tools
  async toolCodeRead(args) {
    const fs = require('fs').promises;

    try {
      const resolvedPath = this._resolveRestrictedPath(args.file_path);
      if (!resolvedPath) {
        return JSON.stringify({ error: 'Access denied: invalid or restricted file path' });
      }

      const content = await fs.readFile(resolvedPath, 'utf8');
      return JSON.stringify({
        success: true,
        file_path: resolvedPath,
        content: content,
        size: content.length
      });
    } catch (error) {
      return JSON.stringify({ error: 'File read failed', message: error.message });
    }
  }

  async toolCodeWrite(args) {
    const fs = require('fs').promises;

    try {
      const content = args.content;
      const mode = args.mode || 'write';

      if (content === undefined) {
        return JSON.stringify({ error: 'Missing content' });
      }

      const resolvedPath = this._resolveRestrictedPath(args.file_path);
      if (!resolvedPath) {
        return JSON.stringify({ error: 'Access denied: invalid or restricted file path' });
      }

      // Audit logging for file writes (security trail)
      const auditEntry = {
        timestamp: new Date().toISOString(),
        operation: 'code.write',
        mode: mode,
        file_path: resolvedPath,
        content_hash: require('crypto').createHash('sha256').update(content).digest('hex'),
        bytes: content.length
      };
      this.logger.info('Code write audit log', auditEntry);

      if (mode === 'append') {
        await fs.appendFile(resolvedPath, content, 'utf8');
      } else {
        await fs.writeFile(resolvedPath, content, 'utf8');
      }

      return JSON.stringify({
        success: true,
        file_path: resolvedPath,
        mode: mode,
        bytes_written: content.length,
        audit_logged: true
      });
    } catch (error) {
      return JSON.stringify({ error: 'File write failed', message: error.message });
    }
  }

  async toolCodeRunCommand(args) {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const path = require('path');
    const execFileAsync = promisify(execFile);

    // Allowlist of permitted executables (basename only — no absolute paths allowed)
    const ALLOWED_EXECUTABLES = new Set([
      'node', 'npm', 'npx', 'yarn', 'pnpm',
      'git',
      'ls', 'cat', 'echo', 'pwd', 'mkdir', 'cp', 'mv', 'diff', 'wc',
      'grep', 'rg', 'find', 'awk', 'sed',
      'curl', 'wget',
      'python', 'python3', 'pip', 'pip3',
      'tsc', 'jest', 'mocha', 'vitest',
      'docker', 'docker-compose',
      'make'
    ]);

    try {
      const command = args.command;
      if (!command || typeof command !== 'string') {
        return JSON.stringify({ error: 'No command provided' });
      }

      // Parse the command string into executable + arguments
      // Simple whitespace split — sufficient since execFile bypasses the shell entirely
      const parts = command.trim().split(/\s+/);
      const executable = parts[0];
      const execArgs = parts.slice(1);

      // Validate executable is on the allowlist (check basename to reject /bin/sh tricks)
      const execBasename = path.basename(executable);
      if (!ALLOWED_EXECUTABLES.has(execBasename)) {
        this.logger.warn('Command rejected by allowlist', { executable, execBasename });
        return JSON.stringify({ error: 'Command not permitted', executable: execBasename });
      }

      // Validate cwd stays within the allowed base directory
      const resolvedCwd = this._resolveRestrictedPath(args.cwd || '.');
      if (!resolvedCwd) {
        return JSON.stringify({ error: 'Access denied: invalid working directory' });
      }

      this.logger.info('Executing command via tool', { executable: execBasename, execArgs, cwd: resolvedCwd });

      // execFile does NOT invoke a shell, preventing shell metacharacter injection
      const { stdout, stderr } = await execFileAsync(execBasename, execArgs, {
        cwd: resolvedCwd,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });

      return JSON.stringify({
        success: true,
        command: command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        cwd: resolvedCwd
      });
    } catch (error) {
      return JSON.stringify({
        error: 'Command execution failed',
        message: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      });
    }
  }

  async toolCodeScanDependencies(args) {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Validate directory stays within the allowed base directory
      const resolvedDir = this._resolveRestrictedPath(args.directory || '.');
      if (!resolvedDir) {
        return JSON.stringify({ error: 'Access denied: invalid or restricted directory' });
      }

      const packageJsonPath = path.join(resolvedDir, 'package.json');
      const requirementsPath = path.join(resolvedDir, 'requirements.txt');

      const result = { scans: [] };

      // Try npm audit for Node.js projects (uses execFile — no shell injection)
      try {
        await fs.access(packageJsonPath);
        const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
          cwd: resolvedDir,
          timeout: 30000
        });
        result.scans.push({ type: 'npm', directory: resolvedDir, output: stdout });
      } catch (_npmError) {
        // npm audit not available or no vulnerabilities (non-zero exit)
      }

      // Try pip-audit for Python projects
      try {
        await fs.access(requirementsPath);
        const { stdout } = await execFileAsync('pip-audit', ['--format', 'json'], {
          cwd: resolvedDir,
          timeout: 30000
        });
        result.scans.push({ type: 'python', directory: resolvedDir, output: stdout });
      } catch (_pipError) {
        // pip-audit not available or failed
      }

      if (result.scans.length === 0) {
        return JSON.stringify({ error: 'No package.json or requirements.txt found', directory: resolvedDir });
      }

      return JSON.stringify({ success: true, ...result });
    } catch (error) {
      return JSON.stringify({ error: 'Dependency scan failed', message: error.message });
    }
  }

  async toolCodeFindRelated(args) {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    try {
      const feature = args.feature;
      const fileTypes = Array.isArray(args.file_types) ? args.file_types : [];

      if (!feature || typeof feature !== 'string') {
        return JSON.stringify({ error: 'No feature keyword provided' });
      }

      // Reject patterns containing shell metacharacters to prevent injection
      // even though execFile bypasses the shell — belt-and-suspenders
      if (/[;&|`$<>\\]/.test(feature)) {
        return JSON.stringify({ error: 'Invalid characters in search term' });
      }

      // Validate file type extensions (alphanumeric only)
      const safeTypes = fileTypes.filter(t => /^[a-zA-Z0-9]+$/.test(t));

      // Build rg args array — execFile passes these directly without a shell
      const rgArgs = ['-l', feature];
      for (const t of safeTypes) {
        rgArgs.push('-t', t);
      }

      try {
        const { stdout } = await execFileAsync('rg', rgArgs, {
          timeout: 15000,
          maxBuffer: 1024 * 1024
        });
        const files = stdout.trim().split('\n').filter(f => f);
        return JSON.stringify({ success: true, feature, files, count: files.length });
      } catch (_rgError) {
        // rg not available or no matches — fallback to grep (args passed as array, no shell)
        const { stdout } = await execFileAsync('grep', ['-r', '-l', feature, '.'], {
          timeout: 15000,
          maxBuffer: 1024 * 1024
        });
        const files = stdout.trim().split('\n').filter(f => f);
        return JSON.stringify({ success: true, feature, files, count: files.length });
      }
    } catch (error) {
      return JSON.stringify({ error: 'Find related failed', message: error.message });
    }
  }

  formatToolPayload(result) {
    let payload = JSON.stringify(result);

    if (payload.length <= this.maxToolResultChars) {
      return payload;
    }

    if (this.toolSummarizeEnabled) {
      return this.summarizeToolPayload(payload);
    }

    return `${payload.slice(0, this.maxToolResultChars)}…`;
  }

  async summarizeToolPayload(payload) {
    // Strip potential secrets before sending to summarization LLM
    const sanitized = payload
      .replace(/(api[_-]?key|secret|password|token|bearer)["']?\s*[:=]\s*["']?[a-zA-Z0-9_\-\.]+/gi, '$1=[REDACTED]')
      .replace(/(Authorization|X-API-Key)["']?\s*:\s*["']?[a-zA-Z0-9_\-\.]+/gi, '$1=[REDACTED]')
      .replace(/(aws[_-]?access|aws[_-]?secret)["']?\s*[:=]\s*["']?[a-zA-Z0-9\/+=]+/gi, '$1=[REDACTED]');

    // Internal operation — use the Ollama adapter directly (not user-facing use-case)
    const ollamaAdapter = require('../vendors/ollama/adapter');
    const summaryModel  = this.ollamaToolModel || this.ollamaModel;
    const internalRequest = {
      messages: [
        { role: 'system', content: 'Summarize tool results for LLM consumption. Preserve IDs, key fields, and decisions. Keep under 400 words. REDACT any credentials, keys, or secrets you see.' },
        { role: 'user', content: sanitized }
      ],
      systemPrompt: null,
      temperature: 0.3,
      maxTokens: 500,
    };

    try {
      const response  = await ollamaAdapter.chat(internalRequest, summaryModel);
      const extracted = this.extractAssistantMessage(response);
      return JSON.stringify({ summary: extracted.content || '' });
    } catch (error) {
      return `${payload.slice(0, this.maxToolResultChars)}…`;
    }
  }

  wrapResponse(text, rawMessage) {
    const actions = this.classifyResponseActions(text);
    if (!this.returnActionsEnvelope && actions.length === 0) {
      return {
        response: text
      };
    }

    return {
      response: text,
      actions
    };
  }

  classifyResponseActions(text) {
    if (!text || typeof text !== 'string') return [];
    const actions = [];

    const openMemoryMatch = text.match(/open_memory\s*[:(]\s*([a-z0-9-]{6,})/i);
    if (openMemoryMatch) {
      actions.push({ type: 'open_memory', memory_id: openMemoryMatch[1] });
    }

    if (text.match(/save to memory/i)) {
      actions.push({ type: 'suggest_entry', text: text.slice(0, 500) });
    }

    return actions;
  }

  cleanAssistantText(text) {
    if (!this.responseCleanupEnabled || !text) return text;
    const trimmed = text.trim();

    // Preserve valid JSON responses
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch (_) {
        // fall through to cleanup
      }
    }

    let cleaned = text;

    // Remove code fences but keep content
    cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, '$1');
    // Remove inline code backticks
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    // Strip markdown headings
    cleaned = cleaned.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    // Strip blockquote markers
    cleaned = cleaned.replace(/^\s{0,3}>\s?/gm, '');
    // Strip bold markers
    cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, '$2');

    cleaned = cleaned.trim();
    // Strip leading/trailing quotes
    cleaned = cleaned.replace(/^["“”]+|["“”]+$/g, '');

    return cleaned.trim();
  }


  // Resolve auth via auth-gateway UAI endpoint
  authenticateRequest = async (req, res, next) => {
    try {
      const headers = {
        ...(req.headers['authorization'] && { 'Authorization': req.headers['authorization'] }),
        ...(req.headers['x-api-key'] && { 'X-API-Key': req.headers['x-api-key'] }),
        ...(req.headers['cookie'] && { 'Cookie': req.headers['cookie'] }),
        'User-Agent': 'Onasis-CORE/1.0'
      };

      const authController = new AbortController();
      const authTimer = setTimeout(() => authController.abort(), this.routerTimeoutMs);
      let response;
      try {
        response = await fetch(`${this.authGatewayUrl}/v1/auth/resolve`, {
          method: 'GET',
          headers,
          signal: authController.signal
        });
      } finally {
        clearTimeout(authTimer);
      }

      if (!response.ok) {
        return res.status(401).json({
          error: {
            message: 'Authentication required',
            code: 'AUTH_REQUIRED',
            type: 'authentication_error'
          }
        });
      }

      const data = await response.json();
      req.uai = {
        authId: data.authId || response.headers.get('x-uai-auth-id'),
        organizationId: data.organizationId || response.headers.get('x-uai-organization'),
        authMethod: data.authMethod || response.headers.get('x-uai-auth-method'),
        email: data.email || response.headers.get('x-uai-email'),
        fromCache: data.fromCache || response.headers.get('x-uai-from-cache') === 'true'
      };

      return next();
    } catch (error) {
      this.logger.error('Auth gateway resolution failed', { error: error.message });
      return res.status(503).json({
        error: {
          message: 'Authentication service unavailable',
          code: 'AUTH_SERVICE_UNAVAILABLE',
          type: 'authentication_error'
        }
      });
    }
  };

  // Usage tracking middleware (lightweight)
  trackUsage = (req, res, next) => {
    const requestId = crypto.randomBytes(12).toString('hex');
    req.requestId = requestId;
    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      this.logger.info('AI request completed', {
        request_id: requestId,
        status: res.statusCode,
        duration_ms: durationMs,
        service: req.params?.service,
        auth_id: req.uai?.authId
      });
    });

    next();
  };

  extractOllamaUsage(response) {
    if (!response) return {};
    const promptTokens = response.prompt_eval_count || response.prompt_eval_tokens || 0;
    const completionTokens = response.eval_count || response.eval_tokens || 0;
    const totalTokens = response.total_tokens || (promptTokens + completionTokens) || 0;

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      total_duration_ms: response.total_duration ? Math.round(response.total_duration / 1e6) : undefined
    };
  }

  // Extract usage data for billing
  extractUsageData(result, processingTime) {
    const usage = result?.usage || result?.onasis_metadata?.usage || {};
    const tokens = usage.total_tokens || usage.prompt_tokens || 0;
    return {
      processing_time: processingTime,
      tokens: tokens,
      compute_units: Math.ceil(processingTime / 1000 * 0.1),
      response_size: JSON.stringify(result).length
    };
  }

  // Add Onasis branding to response
  addOnasisBranding(result, metadata) {
    const response = {
      ...result,
      onasis_metadata: {
        service: metadata.service,
        user_auth_id: metadata.user_auth_id,
        processing_time: metadata.processing_time,
        powered_by: 'Onasis-CORE Partnership Platform',
        partner_api_version: '2.0.0',
        timestamp: new Date().toISOString()
      }
    };

    return response;
  }

  // Health check for AI services — delegates to the vendor registry so all
  // active vendors are checked without any direct vendor calls here.
  async checkAIServicesHealth() {
    const { VENDOR_REGISTRY } = require('../vendors');
    const health = {};

    await Promise.all(
      Object.entries(VENDOR_REGISTRY)
        .filter(([, cfg]) => cfg.status === 'active')
        .map(async ([vendorId, cfg]) => {
          const startTime = Date.now();
          try {
            const ok = await cfg.adapter.healthCheck();
            health[vendorId] = {
              status: ok ? 'healthy' : 'unhealthy',
              response_time: Date.now() - startTime
            };
          } catch (error) {
            this.logger.warn('Vendor health check failed', { vendorId, error: error.message });
            health[vendorId] = { status: 'error', response_time: null };
          }
        })
    );

    return health;
  }

  // Express routes for AI service integration
  getRoutes() {
    const express = require('express');
    const router = express.Router();

    // Specific routes first (before wildcard routes)
    router.post('/api/v1/ai-chat',
      this.authenticateRequest,
      this.trackUsage,
      (req, res) => {
        req.params.service = 'ai-chat';
        return this.routeToAIService(req, res);
      }
    );

    // Supabase-style alias (mirror /functions/v1/ai-chat)
    router.post('/functions/v1/ai-chat',
      this.authenticateRequest,
      this.trackUsage,
      (req, res) => {
        req.params.service = 'ai-chat';
        return this.routeToAIService(req, res);
      }
    );

    // AI service routing (wildcard - must be last)
    router.use('/api/:service',
      this.authenticateRequest,
      this.trackUsage,
      (req, res) => this.routeToAIService(req, res)
    );

    // Service discovery
    router.get('/ai-services',
      this.authenticateRequest,
      (req, res) => {
        const services = this.getServiceMapping();
        res.json({
          available_services: services,
          auth_id: req.uai?.authId,
          ai_provider: 'Ollama',
          total_services: Object.keys(services).length
        });
      }
    );

    // AI services health check
    router.get('/ai-health', async (req, res) => {
      const health = await this.checkAIServicesHealth();
      res.json({
        ai_services_health: health,
        overall_status: Object.values(health).every(s => s.status === 'healthy') ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString()
      });
    });

    return router;
  }
}

module.exports = AIServiceRouter;
