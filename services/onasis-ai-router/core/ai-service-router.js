#!/usr/bin/env node

/**
 * Onasis-CORE AI Service Router (Ollama-first)
 * Single-loop orchestration with memory prefetch + tool calls
 * Keeps vendor auth, usage logging, and privacy-safe logs
 */

const winston = require('winston');
const crypto = require('crypto');
const { PromptComposer } = require('./prompt-composer');
const {
  resolveVendorChainForUseCase,
  sanitizeVendorResponse,
  resolveUseCaseFromRequest,
} = require('../vendors');
const { fetchWithRetry } = require('../vendors/_shared/http-client');
const { extractInTextToolCalls, offeredToolNames } = require('../vendors/_shared/tool-markup');
const { getAuthCache } = require('./auth-cache');
const { VendorScoreboard, SAME_REQUEST_FAILURE_WEIGHT } = require('./vendor-scoreboard');
const { VendorHealthMonitor } = require('./vendor-health');
const { MemoryPrefetch } = require('./memory-prefetch');
const { summariseHealth } = require('./health-status');
const openaiCompat = require('./openai-compat');
const { assertCallerRoles, assertUserContent, MessagePolicyError } = require('./message-policy');
const { ProfileResolver, ProfileError } = require('./profile-resolver');
const {
  sanitizeMemoryAnalysis,
  verifyInternalSecret,
  INTERNAL_SECRET_HEADER,
} = require('./memory-analysis');
const {
  createAuthMiddleware,
  createUsageTracker,
  DEFAULT_AUTH_TIMEOUT_MS,
  DEFAULT_AUTH_BUDGET_MS,
} = require('./middleware');
const { ToolLoop } = require('./tool-loop');
const {
  isToolPassthroughUseCase,
  assertToolPassthroughAllowed,
  assertPassthroughTools,
  toOpenAIToolCalls,
  normaliseToolTranscript,
} = require('./tool-passthrough');
const { sanitizePublicAsk } = require('./public-ask');
const { ChainExecutor, VendorsExhaustedError } = require('./chain-executor');
const { createOpsEventClient } = require('./ops-event-client');
const sessionMemoryProxy = require('./session-memory-proxy');

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
    // routerTimeoutMs now governs only tool-call fetches (memory.search/get/write) —
    // auth-gateway and memory-prefetch got their own tighter budgets below, since
    // both sit on the hot path of every request and 15s was a shared, oversized
    // default for a same-host call (auth) and an optional enrichment call (prefetch).
    this.routerTimeoutMs = parseInt(process.env.ROUTER_TIMEOUT_MS || '15000', 10);
    // Per-attempt and whole-resolve budgets for the auth-gateway call. The
    // defaults (12s / 20s) are derived from measured cold-lookup times; the
    // reasoning lives next to them in core/middleware.js. The old 3000ms
    // default sat below every cold lookup, so every cache miss became a 503.
    this.authTimeoutMs = parseInt(process.env.AUTH_GATEWAY_TIMEOUT_MS || String(DEFAULT_AUTH_TIMEOUT_MS), 10);
    this.authBudgetMs = parseInt(process.env.AUTH_GATEWAY_BUDGET_MS || String(DEFAULT_AUTH_BUDGET_MS), 10);
    this.memoryPrefetchTimeoutMs = parseInt(process.env.MEMORY_PREFETCH_TIMEOUT_MS || '3000', 10);
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

    this._scoreboard = new VendorScoreboard();

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
    this._emitOpsEvent = createOpsEventClient({ logger: this.logger });

    this.authenticateRequest = createAuthMiddleware({
      authGatewayUrl: this.authGatewayUrl,
      authTimeoutMs:  this.authTimeoutMs,
      authBudgetMs:   this.authBudgetMs,
      logger:         this.logger,
    });
    this.trackUsage = createUsageTracker({ logger: this.logger });

    // Constructed AFTER this.logger exists. It previously ran before the logger
    // was assigned, so MemoryPrefetch held an undefined logger — and since its
    // error path calls logger.warn, every prefetch failure threw
    // "Cannot read properties of undefined (reading 'warn')" and turned a
    // degraded-memory request into a 500, defeating the swallow-to-'' guarantee
    // the class exists to provide.
    this._prefetch = new MemoryPrefetch({
      apiBaseUrl:       this.apiBaseUrl,
      memorySearchPath: this.memorySearchPath,
      topK:             this.memoryPrefetchTopK,
      timeoutMs:        this.memoryPrefetchTimeoutMs,
      enabled:          this.prefetchEnabled,
      maxChars:         this.maxPrefetchChars,
      buildAuthHeaders: (req) => this.buildAuthHeaders(req),
      logger:           this.logger,
    });

    // Constructed after this.logger, like MemoryPrefetch above — building it
    // earlier is the wiring defect that made every prefetch failure a 500 (#12).
    this._profiles = new ProfileResolver({ logger: this.logger });

    this._toolLoop = new ToolLoop({
      apiBaseUrl:         this.apiBaseUrl,
      memorySearchPath:   this.memorySearchPath,
      memoryGetPath:      this.memoryGetPath,
      memoryWritePath:    this.memoryWritePath,
      memoryBatchGetPath: this.memoryBatchGetPath,
      memoryPrefetchTopK: this.memoryPrefetchTopK,
      routerTimeoutMs:    this.routerTimeoutMs,
      maxToolResultChars: this.maxToolResultChars,
      toolSummarizeEnabled: this.toolSummarizeEnabled,
      ollamaModel:        this.ollamaModel,
      ollamaToolModel:    this.ollamaToolModel,
      ollamaBaseUrl:      this.ollamaBaseUrl,
      ollamaChatPath:     this.ollamaChatPath,
      buildAuthHeaders:        (req) => this.buildAuthHeaders(req),
      extractAssistantMessage: (r) => this.extractAssistantMessage(r),
      logger:             this.logger,
    });

    this._chain = new ChainExecutor({ scoreboard: this._scoreboard, logger: this.logger });
    // Probes real completions rather than reachability, and lets observed
    // request outcomes override an optimistic probe. See core/vendor-health.js.
    this._health = new VendorHealthMonitor({
      registry: require('../vendors').VENDOR_REGISTRY,
      scoreboard: this._scoreboard,
      logger: this.logger,
    });

    this.promptComposer = new PromptComposer({
      promptsRoot: config.promptsRoot,
      promptMode: config.promptMode,
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
      void this._emitOpsEvent({
        kind: 'request_outcome',
        requestId: req.requestId,
        organizationId: req.uai?.organizationId,
        vendor: req._selectedVendor?._vendorId || serviceConfig.type,
        model: req._selectedVendor?._model || this.ollamaModel,
        tokens: usage.tokens,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        durationMs: processingTime,
        statusCode: 200,
        success: true,
        endpoint: req.originalUrl || req.path,
        occurredAt: new Date().toISOString(),
      });

      // Strip any vendor/model identifiers before sending to client
      const sanitized = sanitizeVendorResponse(result, useCase);
      const response = this.addOnasisBranding(sanitized, {
        service,
        user_auth_id: req.uai?.authId,
        processing_time: processingTime,
        // The lane the router ACTUALLY served — a profile can bind one that
        // differs from the body's `use_case`, and the caller needs the served
        // one, not the requested one.
        use_case: req._resolvedUseCase || useCase,
        // Surfaced so a client can tell a finished answer from one the vendor
        // stopped mid-sentence. Only present when true — an absent flag reads
        // as "complete", which is the common case.
        ...(result?.truncated ? { truncated: true } : {}),
      });
      delete response.truncated;

      res.json(response);
    } catch (error) {
      void this._emitOpsEvent({
        kind: 'request_outcome',
        requestId: req.requestId,
        organizationId: req.uai?.organizationId,
        vendor: req._selectedVendor?._vendorId || serviceConfig.type,
        model: req._selectedVendor?._model || this.ollamaModel,
        durationMs: Date.now() - startTime,
        statusCode: error.status || 500,
        success: false,
        endpoint: req.originalUrl || req.path,
        error: String(error.message || 'request failed').slice(0, 512),
        occurredAt: new Date().toISOString(),
      });
      // A rejected request is the caller's error, not an outage. Without this
      // branch the catch-all below reports "AI service temporarily unavailable"
      // with a 500, which invites the caller to retry a request that can never
      // succeed — and hides a policy violation inside the vendor error rate.
      if (error instanceof MessagePolicyError || error instanceof ProfileError) {
        this.logger.warn('Rejected request by policy', {
          service, name: error.name, code: error.code, param: error.param,
        });
        return res.status(error.status).json({
          error: {
            message: error.message,
            code: error.code,
            ...(error.param ? { param: error.param } : {}),
          }
        });
      }

      // No vendor could serve this. That is an outage, not a broken request, and
      // the difference is the whole of what a client can do about it: 500 reads
      // as "stop, this will never work", 503 as "the service is down, come
      // back". Previously both collapsed into 500.
      if (error instanceof VendorsExhaustedError) {
        this.logger.error('No vendor could serve the request', {
          service,
          useCase: error.useCase,
          attempted: error.attempted,
          // The underlying vendor error is logged and NOT returned: those
          // messages name vendors and their billing URLs.
          cause: error.cause?.message,
        });
        const retryAfterSeconds = parseInt(process.env.OUTAGE_RETRY_AFTER_SECONDS || '30', 10);
        res.set('Retry-After', String(retryAfterSeconds));
        return res.status(503).json({
          error: {
            message: 'No AI capacity is currently available. Please retry shortly.',
            code: error.code,
            service,
            retry_after_seconds: retryAfterSeconds,
          }
        });
      }

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

  getPromptDiagnostics() {
    return this.promptComposer.getConfigSnapshot();
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

  async handleOllamaChat(req) {
    // Everything downstream measures against this: the caller's proxy gives up
    // at a fixed wall-clock, so the interesting number is always what is LEFT.
    // The clock starts when authentication began (stamped by the auth
    // middleware), not here: a cold auth-gateway lookup can take 10s+, and a
    // deadline that ignored it let a slow auth plus a full vendor chain run
    // past the caller's proxy. Unauthenticated surfaces start it here.
    const requestStartedAt = Number.isFinite(req.requestStartedAt) ? req.requestStartedAt : Date.now();
    const body = req.body || {};
    const incomingMessages = Array.isArray(body.messages)
      ? body.messages
      : (body.prompt ? [{ role: 'user', content: String(body.prompt) }] : []);

    // Agent Heaven owns system instruction. Enforced before any work is done so
    // a rejected request costs nothing — and before the prefetch below, which
    // would otherwise attach memory to a request that is about to be refused.
    assertCallerRoles(incomingMessages, { logger: this.logger });
    // Same reasoning: an empty request is refused here, not by six vendors in
    // turn, each of which would be marked down for it.
    assertUserContent(incomingMessages);

    // Profile intent is resolved against UAI entitlement, never trusted from
    // the header. Returns null when no profile was named, which is the
    // use-case path every current caller takes.
    const profile = this._profiles.resolve(req);

    // ── Use-case resolution ────────────────────────────────────────────────
    // The router allocates the vendor + model — clients only send use_case.
    // An entitled profile binds the lane instead. Live since auth-gateway
    // began publishing entitlements (2026-09-09); a caller still needs the
    // matching `profile:` permission on its credential, so in practice most
    // requests continue to resolve by use case.
    const useCase = profile?.boundUseCase || resolveUseCaseFromRequest(req);
    // Remember the lane actually served, for the response metadata. A profile
    // can bind a lane that differs from the body's `use_case`, and the caller
    // needs the served one.
    req._resolvedUseCase = useCase;

    // ── Caller-executed tool lane ─────────────────────────────────────────
    // Refused before any vendor work: an unentitled request must cost nothing,
    // and a request with no tools has nothing for this lane to do. The gate is
    // fail-closed on the credential's resolved auth id (never a header) — see
    // core/tool-passthrough.js for why this lane is allowlisted at all.
    const toolPassthrough = isToolPassthroughUseCase(useCase);
    if (toolPassthrough) {
      assertToolPassthroughAllowed(req, { logger: this.logger });
      assertPassthroughTools(body);
    }

    // The chain executor resolves and walks the chain itself; this resolution
    // supplies only the use-case-level prompt/token config, which is identical
    // across every vendor in the chain.
    const vendorChain = resolveVendorChainForUseCase(useCase);

    if (vendorChain.length === 0) {
      this.logger.error('No active vendor available for use case', { useCase });
      throw new Error('No active AI vendor available. Check vendor configuration.');
    }

    // ── Build message chain ───────────────────────────────────────────────
    // systemPrompt is the same across all vendors in the chain (use-case driven)
    const { systemPrompt, maxTokens, temperature } = vendorChain[0];
    const promptBundle = this.promptComposer.compose({
      useCase,
      runtimePrompt: systemPrompt || this._fallbackSystemPrompt(),
    });

    const messages = [];

    // The anonymous surface never enriches from memory. Without a credential
    // the prefetch would query with no auth headers, and a result returned to
    // an unidentified caller is attributable to nobody — exactly the case the
    // prefetch cache refuses to store. Skipping is cheaper and unambiguous.
    //
    // The pass-through lane skips it too: its transcript is the caller's own
    // conversation plus tool results, and this lane is several requests per
    // user turn — paying for (and re-sending) a memory brief on every round
    // buys context the caller's tools already provide.
    const prefetchBrief = (req._publicSurface || toolPassthrough)
      ? ''
      : await this._prefetch.brief(req, incomingMessages, body);
    if (prefetchBrief) {
      messages.push({ role: 'system', content: prefetchBrief });
    }

    messages.push(...(toolPassthrough ? normaliseToolTranscript(incomingMessages) : incomingMessages));

    const callerSuppliedTools = Array.isArray(body.tools) && body.tools.length > 0;
    const requestedTools = callerSuppliedTools
      ? body.tools
      : this._toolLoop.getToolDefinitionsForUseCase(useCase);

    // An active profile's manifest is the ceiling on what may be offered. This
    // is the only place `allowedTools` is enforced; before it, the field was
    // read solely by the manifest schema validator, so a profile permitting
    // two tools could still have any tool offered under it — including one the
    // caller named itself, since caller `tools` REPLACE the lane default
    // rather than intersecting with it.
    // `tools: []` in a body cannot express "no tools": callerSuppliedTools
    // requires length > 0, so an empty array falls through to the lane default,
    // which is memory.search + memory.get. The anonymous surface therefore
    // carries a server-set marker on the request object rather than a body
    // field — a body field would be spoofable in the other direction.
    const tools = req._publicSurface
      ? []
      : ToolLoop.constrainToAllowed(requestedTools, profile?.allowedTools ?? null);

    const droppedTools = requestedTools.length - tools.length;
    if (droppedTools > 0) {
      this.logger.info('Tools withheld by profile manifest', {
        request_id: req.requestId || null,
        profile_id: profile?.profileId || null,
        dropped_count: droppedTools,
        dropped_names: requestedTools
          .filter((t) => !tools.includes(t))
          .map((t) => t?.function?.name || t?.name || '(unnamed)'),
      });
    }

    // What the model is actually handed, per request. A prompt that advertises
    // a tool the request never offers produces an agent that asks the human to
    // run the command by hand — the failure is invisible unless this is logged.
    // Caller-supplied `tools` REPLACE the defaults rather than extending them,
    // so `source` is the difference between "the router chose this" and "the
    // caller did". Names only: no arguments, no results, no vendor identity.
    this.logger.info('Tools offered to model', {
      request_id: req.requestId || null,
      use_case: useCase,
      source: callerSuppliedTools ? 'caller' : 'router_default',
      tool_count: Array.isArray(tools) ? tools.length : 0,
      tool_names: Array.isArray(tools)
        ? tools.map((t) => t?.function?.name || t?.name || '(unnamed)')
        : [],
    });

    const { adapterResponse, selectedVendor } = await this._chain.run({
      useCase, messages, promptBundle, temperature, maxTokens, tools,
      // Every vendor attempt in this request shares one wall-clock deadline.
      // Vendor timeouts are per-CALL, so without this a chain of individually
      // reasonable waits still overran the caller.
      deadlineAt: this._deadlineAt(requestStartedAt),
      requestId: req.requestId,
      emitEvent: this._emitOpsEvent,
    });

    const { _adapter, _model } = selectedVendor;
    req._selectedVendor = selectedVendor;

    // ── First inference result ────────────────────────────────────────────
    const extracted = this.extractAssistantMessage(adapterResponse);
    let toolCalls = this._toolLoop.extractToolCalls(adapterResponse);

    // In-text tool-call markup (<tool_call>…, <minimax:tool_call><invoke…>,
    // template control tokens). Removed from the text whether or not a call is
    // recovered from it — raw markup must never reach a client. Runs before
    // the soft JSON parser so that parser sees prose, not a wrapped call.
    // Observed live 2026-09-26 on repl-nlp; see vendors/_shared/tool-markup.js.
    const markup = extractInTextToolCalls(extracted.content || '');
    if (markup.found) {
      extracted.content = markup.text;
      extracted.raw = { ...extracted.raw, content: markup.text };
    }

    let softParsed = false;
    if (toolCalls.length === 0 && this.softToolParseEnabled) {
      // A truncated call is never executed: half its arguments are missing.
      toolCalls = markup.calls.filter((c) => c.complete);
      if (toolCalls.length === 0) {
        toolCalls = this._toolLoop.extractSoftToolCalls(extracted.content || '');
        softParsed = toolCalls.length > 0;
      }
    }

    // Only tools OFFERED on this request may run, however the call arrived
    // (native, in-text markup, or bare JSON). memory.search / memory.get had
    // no offered-tools gate of their own, and a vendor that hallucinates a tool
    // (`bash`, observed live) must get nothing executed. Names are logged —
    // tool names are not vendor identity — and the calls are simply dropped.
    const offered = offeredToolNames(tools);
    const unoffered = [
      ...toolCalls.filter((c) => !offered.has(c.name)),
      ...markup.calls.filter((c) => !offered.has(c.name) && !toolCalls.includes(c)),
    ];
    if (unoffered.length > 0) {
      this.logger.warn('Dropped tool call(s) for tools not offered on this request', {
        request_id: req.requestId || null,
        use_case: useCase,
        dropped_names: [...new Set(unoffered.map((c) => c.name))],
      });
    }
    toolCalls = toolCalls.filter((c) => offered.has(c.name));
    if (softParsed && toolCalls.length === 0) {
      // Every bare-JSON call was dropped; the JSON itself must not be sent on
      // as prose either.
      extracted.content = this._stripSoftCallJson(extracted.content || '');
    }
    if (markup.found && toolCalls.length === 0) {
      this.logger.warn('Stripped in-text tool-call markup from a first-pass answer', {
        request_id: req.requestId || null,
        use_case: useCase,
        recovered_calls: markup.calls.length,
      });
    }

    if (toolCalls.length === 0) {
      let responseText = this.cleanAssistantText(extracted.content || '');

      // Nothing but markup: the vendor answered with a call and no prose.
      // An empty 200 reads as success to a client, so say it plainly instead.
      if (markup.found && !String(responseText).trim()) {
        responseText = this._fallbackAfterToolCall([]);
      }

      // Nothing extracted a tool call, but the text may still BE one. Both
      // extractors require valid JSON, and a model that runs out of tokens
      // mid-emission produces an unparseable blob that satisfies neither —
      // so it fell through here and was returned to the user verbatim.
      // Observed live 2026-09-04 on dashboard-assistant, which answered a
      // memory question with the raw schema of the tool it meant to call.
      if (this._looksLikeToolCallBlob(responseText)) {
        this.logger.warn('First pass returned an unparseable tool-call blob — refusing to send it as prose', {
          vendorId: selectedVendor._vendorId,
        });
        const text = this._fallbackAfterToolCall([]);
        const response = this.wrapResponse(text, { role: 'assistant', content: text });
        response.usage = adapterResponse.usage;
        return response;
      }

      const response = this.wrapResponse(responseText, extracted);
      response.usage = adapterResponse.usage;
      return this._noteTruncation(response, adapterResponse, { useCase, maxTokens });
    }

    // ── Caller-executed tools: return the calls, do not run them ───────────
    // This is the whole point of the `tool-proxy` lane. The caller sent its own
    // schemas — control-room queries, proposal writes, anything this router has
    // no credentials or network reach for — and will execute them itself.
    // Running them here would answer every caller-defined name with
    // `{"error":"Unsupported tool"}` and then let the synthesis pass describe
    // results that never existed.
    //
    // The offered-tools filter above has already dropped anything the model
    // invented, so every call returned here was authorised on this request.
    if (toolPassthrough) {
      const response = this.wrapResponse(
        this.cleanAssistantText(extracted.content || ''),
        extracted
      );
      response.tool_calls = toOpenAIToolCalls(toolCalls);
      response.usage = adapterResponse.usage;

      this.logger.info('Returning caller-executed tool calls', {
        request_id: req.requestId || null,
        use_case: useCase,
        tool_count: response.tool_calls.length,
        tool_names: response.tool_calls.map((call) => call.function.name),
        // No arguments, no results, no vendor identity — names are enough to
        // answer "did the model ask for the tool we expected?".
      });

      return this._noteTruncation(response, adapterResponse, { useCase, maxTokens });
    }

    // ── Tool execution + follow-up pass ───────────────────────────────────
    // Continue with the same vendor that succeeded on the first pass.
    const toolResults = await this._toolLoop.executeToolCalls(toolCalls, req, tools, useCase, { concurrency: 3 });
    // Tool calls run concurrently (bounded at `concurrency`), so we need to
    // preserve the original order when zipping tool_call_ids to results.
    // Soft-parsed calls (extractSoftToolCalls) carry id:'' since the model
    // never used native function-calling — synthesize one rather than send an
    // empty id, which every OpenAI-compatible vendor observed so far rejects
    // outright rather than tolerating.
    const toolMessages = toolResults.map((toolResult, i) => ({
      role: 'tool',
      tool_call_id: toolCalls[i]?.id || `call_${i}`,
      tool_name: toolResult.name,
      content: toolResult.payload,
    }));

    // extractAssistantMessage() only preserves {role, content} — the vendor's
    // OWN tool_calls[] array (with the exact ids it issued) is dropped. That
    // meant the tool_call_id fix above still 400'd on MiniMax: the assistant
    // turn being replayed never DECLARED the id the following tool-result
    // message references, so "tool id(...) not found" was correct — nothing
    // upstream ever told MiniMax that id existed. adapterResponse.tool_calls
    // (top-level, preserved verbatim by every adapter's normalize function)
    // is the vendor's original array in its native {id, type, function}
    // shape — attach it so the replayed turn matches what the vendor itself
    // sent. Soft-parsed calls have no native tool_calls (adapterResponse.tool_calls
    // is empty), so this is a no-op there — unchanged from before.
    const assistantTurn = Array.isArray(adapterResponse.tool_calls) && adapterResponse.tool_calls.length > 0
      ? { ...extracted.raw, tool_calls: adapterResponse.tool_calls }
      : extracted.raw;
    const followupMessages = messages.concat([assistantTurn]).concat(toolMessages);

    // The follow-up pass is synthesis, not decision-making. The tools have
    // already run and this router executes exactly one tool round, so a tool
    // call emitted here can never be honoured — it is suppressed below and the
    // caller gets a fallback instead of an answer.
    //
    // Re-offering `tools` on this pass is what invites that. Observed live
    // 2026-09-04 on ask-ai: memory.search returned two truncated records and
    // the model replied with a memory.get call to read one of them in full.
    // That is sensible behaviour and exactly what the tool array advertised as
    // available — but it is unanswerable here, so a 41s request degraded to raw
    // records. Withholding the array removes the invitation at its source
    // rather than discarding the reply after the fact.
    //
    // The array's SIZE was never the issue (560 chars on every use case,
    // measured 2026-09-04) — this is about what it authorises, not what it costs.
    // Lever kept because a future bounded multi-round loop would want it back.
    const followupRequest = this._buildFollowupRequest({
      messages: followupMessages,
      systemPrompt: promptBundle.systemPromptForVendor(selectedVendor._vendorId),
      temperature,
      maxTokens,
      tools,
      // Half of what is left, so a failed attempt still leaves room for the
      // retry below. Without this the pass took the vendor's own full timeout
      // and a first pass + 30s synthesis + retry overran the caller's 60s proxy
      // — measured live 2026-09-04, two 504s in six requests where every
      // individual stage had in fact returned something usable.
      timeoutOverrideMs: Math.round(this._remainingBudgetMs(requestStartedAt) / 2),
    });

    // The synthesis pass is deliberately run OUTSIDE ChainExecutor on the first
    // attempt: continuity matters, and the vendor that chose the tool is the one
    // best placed to read its result. But that also meant this call reported
    // nothing to the scoreboard, so a vendor whose first pass is fast and whose
    // synthesis pass always hangs looked healthy forever — its circuit could
    // never open on the failure that was actually happening. Both outcomes are
    // now recorded.
    let followup;
    let synthesisVendorId = selectedVendor._vendorId;
    const followupStartedAt = Date.now();
    try {
      followup = await _adapter.chat(followupRequest, _model);
      this._scoreboard.recordSuccess(selectedVendor._vendorId, Date.now() - followupStartedAt);
    } catch (err) {
      // Weighted so this request cannot leave the vendor looking healthier than
      // it started: its first pass already decayed the failure count, and a plain
      // +1 would net negative for a vendor failing every synthesis pass.
      this._scoreboard.recordFailure(selectedVendor._vendorId, err, Date.now() - followupStartedAt,
        { weight: SAME_REQUEST_FAILURE_WEIGHT });

      // The tool already ran and (for reads) already has a result; a vendor
      // failing to SUMMARISE that result is not the same failure class as no
      // vendor answering at all, and doesn't warrant a hard 500. Observed
      // live 2026-08-20: this exact path 500'd every memory-analysis request
      // that triggered memory.search, because this call was unguarded and its
      // error propagated straight to routeToAIService's catch.
      //
      // Summarising tool results is vendor-independent work — the results are
      // already in hand and any vendor can read them — so falling straight to
      // raw records gave up a real answer that another vendor could still
      // produce. Try the rest of the chain before degrading. Measured live
      // 2026-09-04: openclaw's upstream provider was returning 401 and its auth
      // rotation stalled until our own timeout fired, failing every synthesis
      // pass while its first pass kept succeeding.
      this.logger.warn('Follow-up pass failed after a successful tool call — trying the rest of the chain', {
        vendorId: selectedVendor._vendorId,
        error: err.message,
        elapsedMs: Date.now() - followupStartedAt,
      });

      const retry = await this._retrySynthesisOnChain({
        useCase, followupMessages, promptBundle, temperature, maxTokens,
        exclude: [selectedVendor._vendorId],
        deadlineAt: this._deadlineAt(requestStartedAt),
      });
      followup = retry && retry.adapterResponse;
      if (retry) synthesisVendorId = retry.vendorId;

      if (!followup) {
        const summaryText = this._fallbackAfterToolCall(toolResults);
        const response = this.wrapResponse(summaryText, { role: 'assistant', content: summaryText });
        response.usage = adapterResponse.usage;
        return response;
      }
    }

    let synthesis = this._inspectSynthesisReply(followup);

    // Guard against a tool-call blob reaching the user as prose.
    //
    // Observed live 2026-08-19: a model re-emitted the SAME tool call on this
    // follow-up pass ({"name":"memory.write","arguments":{...}}) instead of
    // answering from the tool results. Nothing downstream re-checked it —
    // cleanAssistantText() deliberately preserves valid JSON — so the raw blob
    // was returned to the caller as the assistant's reply. Weak models loop
    // like this routinely, so treat it as expected, not exceptional.
    //
    // We do NOT execute the repeated call (that risks an unbounded
    // call→result→call loop and, for memory.write, duplicate writes). The tool
    // already ran on the first pass; this response is simply unusable.
    if (synthesis.reEmitted) {
      // Before giving up on a summary, ask once more on a transcript with the
      // tool round written out as plain text. Observed live 2026-10-07 on
      // memory-analysis: both Slack requests of the day got two more
      // memory.search calls back from the synthesis pass, with no tools offered
      // and the directive in the system prompt. A replayed tool_calls turn
      // followed by tool-role messages reads as a tool conversation in progress,
      // and the model continued it. Restated as text there is nothing to
      // continue. The same vendor is allowed: the reply was shaped by the
      // transcript, not by who read it.
      this.logger.warn('Follow-up pass re-emitted a tool call instead of prose — retrying on a flattened transcript', {
        vendorId: synthesisVendorId,
        tools: synthesis.toolNames,
      });
      const retry = await this._retrySynthesisOnChain({
        useCase, promptBundle, temperature, maxTokens,
        followupMessages: this._flattenToolRound(messages, toolResults),
        exclude: [],
        deadlineAt: this._deadlineAt(requestStartedAt),
      });
      const second = retry ? this._inspectSynthesisReply(retry.adapterResponse) : null;
      if (second && !second.reEmitted && String(second.text).trim()) {
        followup = retry.adapterResponse;
        synthesisVendorId = retry.vendorId;
        synthesis = second;
      } else {
        this.logger.warn('Follow-up pass re-emitted a tool call instead of prose — suppressing raw blob', {
          vendorId: synthesisVendorId,
          tools: synthesis.toolNames,
        });
        synthesis = { ...synthesis, text: this._fallbackAfterToolCall(toolResults) };
      }
    }

    const response = this.wrapResponse(synthesis.text, synthesis.message);
    response.usage = followup.usage;
    return this._noteTruncation(response, followup, { useCase, maxTokens });
  }

  /**
   * Read a synthesis reply and say whether it is an answer or another tool call.
   *
   * Same markup rule as the first pass: strip it, and a call recovered from it
   * counts as a re-emitted tool call (never executed). Four shapes are caught —
   * a bare-JSON call, an unparseable call blob, in-text markup, and a native
   * tool_calls array.
   */
  _inspectSynthesisReply(followup) {
    const message = this.extractAssistantMessage(followup);
    const markup = extractInTextToolCalls(message.content || '');
    const text = this.cleanAssistantText(markup.text || '');

    const softCalls = this.softToolParseEnabled ? this._toolLoop.extractSoftToolCalls(text) : [];
    const nativeCalls = this._toolLoop.extractToolCalls(followup);
    const markupEmptied = markup.found && !String(text).trim();
    const reEmitted = softCalls.length > 0 || this._looksLikeToolCallBlob(text)
      || markup.calls.length > 0 || markupEmptied || nativeCalls.length > 0;

    const calls = softCalls.length > 0 ? softCalls : markup.calls.length > 0 ? markup.calls : nativeCalls;
    return { message, text, reEmitted, toolNames: calls.map((c) => c.name).filter(Boolean) };
  }

  /**
   * Rewrite a tool round as ordinary conversation.
   *
   * Drops the assistant's tool_calls turn and the tool-role messages, and gives
   * the results to the model as text inside the user's own turn. Folded into
   * the last user message rather than appended as a second one, because not
   * every vendor accepts two user turns in a row.
   */
  _flattenToolRound(messages, toolResults) {
    const results = (toolResults || [])
      .filter((r) => r && r.name)
      .map((r) => `${r.name}:\n${typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload ?? null)}`)
      .join('\n\n');
    const note = 'These tool results have already been retrieved for the request above:\n\n'
      + `${results}\n\n`
      + 'Answer the request now in plain prose, using only these results. If they do not '
      + 'contain the answer, say what is missing. Do not request or write a tool call.';

    const flattened = (messages || []).map((m) => ({ ...m }));
    const last = flattened[flattened.length - 1];
    if (last && last.role === 'user' && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${note}`;
    } else {
      flattened.push({ role: 'user', content: note });
    }
    return flattened;
  }

  /**
   * Does this text look like a tool call rather than an answer?
   *
   * extractSoftToolCalls() only recognises a blob it can JSON.parse. A model
   * that hits its token ceiling mid-emission produces the same thing
   * UNPARSEABLE, which therefore satisfied no guard and reached the user
   * verbatim — observed live 2026-09-04 on dashboard-assistant:
   *
   *   {"name": "memory.search", "arguments": {"memory_type":{"type":"string"}, …
   *
   * Deliberately shape-based rather than parse-based: catching what cannot be
   * parsed is the entire point. Requiring the text to BEGIN as a JSON object
   * keeps ordinary prose that merely mentions a tool name unaffected, and
   * cleanAssistantText()'s decision to preserve valid JSON intact.
   */
  /**
   * Remove the JSON object extractSoftToolCalls() matched, using the same
   * match rule, so a dropped (never-offered) bare-JSON call does not leak
   * through as prose. Returns the text unchanged when nothing matches.
   */
  _stripSoftCallJson(text) {
    if (typeof text !== 'string' || !text) return text;
    const fenced = text.match(/```json([\s\S]*?)```/i);
    const match = fenced || text.match(/\{[\s\S]*\}/);
    if (!match) return text;
    return (text.slice(0, match.index) + text.slice(match.index + match[0].length))
      .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
      .trim();
  }

  _looksLikeToolCallBlob(text) {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim().replace(/^```(?:json)?/i, '').trim();
    if (!trimmed.startsWith('{')) return false;
    // Only the opening of the object matters; a long payload cannot push the
    // giveaway keys out of range, and bounding it keeps this cheap.
    const head = trimmed.slice(0, 400);
    if (/"tool_calls"\s*:/.test(head)) return true;
    return /"(?:name|tool)"\s*:/.test(head) && /"(?:arguments|parameters)"\s*:/.test(head);
  }

  /**
   * Re-run the synthesis pass on a vendor other than the one that just failed it.
   *
   * Returns `{ adapterResponse, vendorId }`, or null when nothing else can be
   * tried — the caller then falls back to rendering the tool results directly.
   * Null rather than a throw because "no other vendor could summarise this" is
   * an expected outcome with a defined answer, not an error: the results are
   * still in hand and the user still gets them.
   */
  async _retrySynthesisOnChain({ useCase, followupMessages, promptBundle, temperature, maxTokens, exclude, deadlineAt }) {
    try {
      // Wrap rather than replace the bundle so each retry vendor still gets the
      // prompt composed for IT — systemPromptForVendor() varies per vendor, and
      // reusing the failed vendor's string would hand ollama a prompt shaped for
      // someone else.
      const synthesisBundle = {
        systemPromptForVendor: (vendorId) => this._synthesisSystemPrompt(
          promptBundle.systemPromptForVendor(vendorId),
        ),
      };
      const { adapterResponse, selectedVendor } = await this._chain.run({
        useCase,
        messages: followupMessages,
        promptBundle: synthesisBundle,
        temperature,
        maxTokens,
        // No tools, for the same reason the first synthesis attempt has none.
        tools: undefined,
        exclude,
        deadlineAt,
      });
      this.logger.info('Synthesis pass recovered on a fallback vendor', {
        vendorId: selectedVendor._vendorId,
      });
      return { adapterResponse, vendorId: selectedVendor._vendorId };
    } catch (err) {
      this.logger.warn('No vendor could summarise the tool results — returning them directly', {
        error: err.message,
        exclude,
      });
      return null;
    }
  }

  /**
   * Shape the synthesis request that follows a tool round.
   *
   * Split out from handleOllamaChat so the decision it encodes — that this pass
   * is synthesis and must not be handed the means to start another tool round —
   * is testable without a live vendor.
   *
   * `tools` is accepted and deliberately dropped unless the lever is set, rather
   * than simply not being passed in: the caller has the array, and a reader
   * comparing this against the first pass should be able to see the omission is
   * a choice.
   */
  _buildFollowupRequest({ messages, systemPrompt, temperature, maxTokens, tools, timeoutOverrideMs }) {
    const offerTools = String(process.env.FOLLOWUP_OFFER_TOOLS || '').toLowerCase() === 'true';
    return {
      messages,
      systemPrompt: this._synthesisSystemPrompt(systemPrompt),
      temperature,
      maxTokens,
      ...(Number.isFinite(timeoutOverrideMs) ? { timeoutOverrideMs } : {}),
      ...(offerTools ? { tools } : {}),
    };
  }

  /**
   * Milliseconds still available before the caller stops waiting.
   *
   * The router's own vendor timeouts are per-CALL; nothing was measuring the
   * request as a whole, so a sequence of individually-reasonable waits could
   * still overrun the caller. Floored rather than allowed to go negative or
   * tiny: handing an adapter a 20ms budget guarantees a failure, and by then
   * a short real attempt is strictly better than none.
   */
  /**
   * The wall-clock instant this request must be finished by.
   *
   * Derived from the same budget as _remainingBudgetMs() so the per-call
   * deadline and the synthesis split cannot disagree about how long is left.
   */
  _deadlineAt(startedAt) {
    return startedAt + parseInt(process.env.REQUEST_BUDGET_MS || '55000', 10);
  }

  _remainingBudgetMs(startedAt) {
    const budgetMs = parseInt(process.env.REQUEST_BUDGET_MS || '55000', 10);
    const floorMs  = parseInt(process.env.SYNTHESIS_MIN_TIMEOUT_MS || '8000', 10);
    return Math.max(floorMs, budgetMs - (Date.now() - startedAt));
  }

  /**
   * Note a completion the vendor cut at the token ceiling.
   *
   * `assertUsableCompletion` already rejects `done_reason: 'length'` when the
   * content is EMPTY. A truncated but non-empty answer passed through silently,
   * so a half-sentence reached the caller looking exactly like a finished one —
   * measured 2026-09-04, every `ask-ai` reply to "How do I rotate my API key?"
   * ended mid-word because the lane's ceiling was 350 and MiniMax needed 411.
   *
   * Not treated as a failure: the partial answer is usually still useful, and
   * discarding it would trade a truncated reply for no reply. It is flagged so a
   * client can say so, and logged with the ceiling so the cause is actionable
   * rather than a mystery.
   */
  _noteTruncation(response, adapterResponse, { useCase, maxTokens }) {
    if (adapterResponse?.done_reason !== 'length') return response;
    this.logger.warn('Vendor stopped at the token ceiling — answer is truncated', {
      useCase,
      maxTokens,
      completionTokens: adapterResponse?.usage?.completion_tokens,
    });
    response.truncated = true;
    return response;
  }

  /**
   * System prompt for the synthesis pass.
   *
   * Withholding `tools` stops the vendor being *offered* another call; this
   * tells it what to do instead. Both are needed: a model that emits a tool
   * call as bare JSON prose (which extractSoftToolCalls exists to catch) will
   * do so whether or not an array was supplied, so the instruction covers the
   * case the omission cannot.
   *
   * Returns the directive alone when the composed prompt is null — that is the
   * legitimate ollama/embedded case, where the model carries its own prompt and
   * systemPromptForVendor() deliberately returns nothing.
   */
  _synthesisSystemPrompt(basePrompt) {
    const directive = 'The tools requested in the previous turn have already run, and their '
      + 'results appear in this conversation. Answer the user directly from those results. '
      + 'Do not request another tool call — no further tool will run for this reply.';
    return basePrompt ? `${basePrompt}\n\n${directive}` : directive;
  }

  /**
   * Recover whole JSON objects from a truncated payload.
   *
   * Scans for balanced top-level `{...}` objects, ignoring braces inside
   * strings so an embedded `"}"` cannot end an object early, and drops the
   * final partial one. Cheap and dependency-free — this runs on an error path
   * where the request has already spent ~40s.
   */
  _salvageTruncatedRecords(payload) {
    // Collect every balanced {...} span, ignoring braces inside strings so an
    // embedded "}" cannot close an object early. Inner objects close before
    // their parents, so spans are then reduced to the outermost ones — that
    // keeps a record whole instead of returning its nested metadata object.
    const spans = [];
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < payload.length; i++) {
      const ch = payload[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') { inString = true; continue; }
      if (ch === '{') { stack.push(i); continue; }
      if (ch === '}' && stack.length > 0) {
        spans.push([stack.pop(), i + 1]);
      }
    }

    // Outermost-only: drop any span fully contained in another.
    const maximal = spans.filter(([a, b]) =>
      !spans.some(([c, d]) => (c < a && b <= d) || (c <= a && b < d)));
    maximal.sort((x, y) => x[0] - y[0]);

    const RECORD_KEYS = ['id', 'title', 'content', 'text', 'name', 'summary'];
    const out = [];
    for (const [a, b] of maximal) {
      try {
        const record = JSON.parse(payload.slice(a, b));
        if (record && typeof record === 'object' && !Array.isArray(record)
            && RECORD_KEYS.some((k) => k in record)) {
          out.push(record);
        }
      } catch { /* not standalone JSON; ignore */ }
    }
    return out;
  }

  /**
   * Render tool results for the user when the follow-up pass could not.
   *
   * Both follow-up guards below are correct to distrust the vendor's second
   * pass — one failed outright, the other re-emitted a tool call instead of
   * prose. What they got wrong was throwing away the tool RESULT along with
   * the bad completion, and answering with:
   *
   *   "Done — I ran memory.search. Ask me to summarise the result if you
   *    need more detail."
   *
   * Reported from Slack 2026-09-03 and reproduced on both the ask-ai and
   * dashboard-assistant lanes. Two problems with that reply:
   *
   * 1. The user asked to search their memory. The search SUCCEEDED and the
   *    records were in hand — they were simply discarded, so the product's
   *    core function looked broken.
   * 2. It offers a follow-up this architecture cannot honour. Each request is
   *    independent (no continuity by design), so "ask me to summarise" starts
   *    a fresh request that just re-runs the search. The offer can never be
   *    taken up.
   *
   * So render the records directly. This is deliberately plain formatting, not
   * another model call: the model just failed twice, and a third attempt would
   * add latency to a request that has already spent ~40s.
   *
   * Returns null when nothing renderable was found, so the caller can fall
   * back to the honest "couldn't complete" wording rather than an empty list.
   */
  _renderToolResultsForUser(toolResults) {
    const RECORD_LIMIT = 8;
    const FIELD_CHARS = 240;

    const pickArray = (parsed) => {
      if (Array.isArray(parsed)) return parsed;
      for (const key of ['data', 'results', 'memories', 'items', 'matches']) {
        if (Array.isArray(parsed?.[key])) return parsed[key];
        if (Array.isArray(parsed?.[key]?.data)) return parsed[key].data;
      }
      return null;
    };

    const firstString = (record, keys) => {
      for (const k of keys) {
        const v = record?.[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return null;
    };

    const sections = [];
    for (const result of toolResults || []) {
      if (!result || typeof result.payload !== 'string') continue;

      let parsed;
      try {
        parsed = JSON.parse(result.payload);
      } catch {
        // formatToolPayload() truncates oversized payloads with a trailing
        // ellipsis, which makes them invalid JSON. For memory.search this is
        // the COMMON case, not an edge case: TOOL_RESULT_MAX_CHARS defaults to
        // 6000 and memory records are prose. Verified live 2026-09-03 — the
        // ask-ai lane hit exactly this and dumped raw JSON at the user.
        //
        // So salvage the records that did survive rather than printing the
        // blob. Anything unsalvageable falls through to the raw text.
        const salvaged = this._salvageTruncatedRecords(result.payload);
        if (salvaged.length > 0) {
          parsed = { data: salvaged, _truncated: true };
        } else {
          const raw = result.payload.trim();
          if (raw) sections.push(`${result.name}:\n${raw.slice(0, FIELD_CHARS * 4)}`);
          continue;
        }
      }

      if (parsed?.error) {
        sections.push(`${result.name}: ${String(parsed.error)}`);
        continue;
      }

      const records = pickArray(parsed);
      if (!records) {
        const text = firstString(parsed, ['content', 'summary', 'text', 'message']);
        if (text) sections.push(`${result.name}: ${text.slice(0, FIELD_CHARS)}`);
        continue;
      }

      if (records.length === 0) {
        sections.push(`${result.name}: no matches.`);
        continue;
      }

      const shown = records.slice(0, RECORD_LIMIT).map((record, i) => {
        if (typeof record === 'string') return `${i + 1}. ${record.slice(0, FIELD_CHARS)}`;
        const title = firstString(record, ['title', 'name', 'summary', 'key']) || 'Untitled';
        const body = firstString(record, ['content', 'text', 'summary', 'description', 'value']);
        return body
          ? `${i + 1}. ${title} — ${body.replace(/\s+/g, ' ').slice(0, FIELD_CHARS)}`
          : `${i + 1}. ${title}`;
      });

      const more = records.length > shown.length
        ? `\n(+${records.length - shown.length} more)`
        : '';
      sections.push(`${result.name} returned ${records.length} result`
        + `${records.length === 1 ? '' : 's'}:\n${shown.join('\n')}${more}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : null;
  }

  /**
   * The reply used when a follow-up pass cannot be trusted. Prefers real
   * results over an apology, and never promises a follow-up turn that cannot
   * happen.
   */
  _fallbackAfterToolCall(toolResults) {
    const rendered = this._renderToolResultsForUser(toolResults);
    if (rendered) {
      return `I could not compose a summary for this one, so here are the raw `
        + `results:\n\n${rendered}`;
    }
    const executed = (toolResults || []).map((r) => r && r.name).filter(Boolean);
    return executed.length > 0
      ? `I ran ${executed.join(', ')} but could not read anything usable back from it. `
        + 'Please try rephrasing the request.'
      : 'I was unable to complete that request. Please try rephrasing it.';
  }

  // Read-only memory tools. Safe to offer on any request: they cannot mutate
  // a user's memory bank, so a hallucinated or prompt-injected call is a wasted
  // round trip rather than unwanted persisted data.

  // Default tool set for a given use case.
  //
  // memory.write is MUTATING and is deliberately withheld from interactive
  // conversational surfaces (the IDE-extension concierge chat box, the
  // Slack/Discord concierge, plain ask-ai). On those surfaces a model that
  // free-associates a "save this" tool call writes to the user's real memory
  // bank with no confirmation — the user asked a question and silently got a
  // new memory. Unlike code.*, memory.* calls are dispatched directly with no
  // offered-tools/trusted-identity gate, so withholding the definition is the
  // control. Saving from those surfaces should be an explicit user action
  // (a button / "save this to memory" command), not a model side effect.
  //
  // Callers that genuinely need write access can still opt in per-request by
  // sending their own `tools` array (handleOllamaChat honours body.tools).
  // Override the default set per use case with MEMORY_WRITE_USE_CASES.
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
    const promptTokens = usage.prompt_tokens || usage.prompt_eval_count || 0;
    const completionTokens = usage.completion_tokens || usage.eval_count || 0;
    const tokens = usage.total_tokens || promptTokens + completionTokens || 0;
    return {
      processing_time: processingTime,
      tokens: tokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
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
        // WHICH lane served this request, as the router resolved it. A caller
        // that asked for a specific lane needs to be able to tell whether it
        // got it: an unrecognised `use_case` falls back to the default lane
        // (resolveUseCaseFromRequest), so a router that is too old to know a
        // lane answers 200 with a different lane's behaviour and no error.
        // That silent substitution is how a tool lane that was never served
        // still looked like a working assistant (observed 2026-10-27).
        ...(metadata.use_case ? { use_case: metadata.use_case } : {}),
        timestamp: new Date().toISOString()
      }
    };

    return response;
  }

  // Health check for AI services — delegates to the vendor registry so all
  // active vendors are checked without any direct vendor calls here.
  /**
   * Per-vendor health.
   *
   * Delegates to VendorHealthMonitor, which probes a real completion instead of
   * calling each adapter's healthCheck(). Those probes asked whether the vendor
   * was REACHABLE, which stayed true through a total outage — /health reported
   * 5/5 healthy on 2026-09-04 while no vendor could answer a request. The
   * adapters keep their healthCheck() exports for callers that want a cheap
   * liveness signal; this path deliberately does not use them.
   */
  async checkAIServicesHealth() {
    return this._health.snapshot();
  }

  /** Warm the health cache so the first probe after boot is not a cold start. */
  async warmHealthCache() {
    try {
      await this._health.refresh();
    } catch (error) {
      this.logger.warn('Health cache warm-up failed', { error: error.message });
    }
  }

  // Express routes for AI service integration
  getRoutes() {
    const express = require('express');
    const router = express.Router();

    // ── Unauthenticated landing-page surface ────────────────────────────
    // The only route here that reaches a paid vendor without a credential, so
    // it is deliberately the narrowest: one question string in, one answer out.
    // The lane, the tools and the history are all decided server-side. See
    // core/public-ask.js for why the caller's `messages` array is discarded
    // rather than merged.
    //
    // Its own rate limit, far tighter than the global one: the global budget is
    // per-IP across an authenticated estate, and spending it on anonymous
    // traffic would let a landing page visitor exhaust the allowance of every
    // real caller behind the same proxy address.
    const publicAskBuckets = new Map();
    const PUBLIC_ASK_WINDOW_MS = parseInt(process.env.PUBLIC_ASK_WINDOW_MS || '60000', 10);
    const PUBLIC_ASK_MAX = parseInt(process.env.PUBLIC_ASK_MAX || '10', 10);
    // Default open: this endpoint is for public marketing pages, carries no
    // credential and sets no cookie, so an origin allowlist protects nobody
    // here. Set PUBLIC_ASK_ALLOWED_ORIGINS to a comma-separated list to narrow.
    const PUBLIC_ASK_ORIGINS = (process.env.PUBLIC_ASK_ALLOWED_ORIGINS || '*')
      .split(',').map((o) => o.trim()).filter(Boolean);

    const publicAskCors = (req, res) => {
      const origin = req.headers.origin;
      const allowed = PUBLIC_ASK_ORIGINS.includes('*')
        ? '*'
        : (origin && PUBLIC_ASK_ORIGINS.includes(origin) ? origin : null);
      if (allowed) {
        res.set('Access-Control-Allow-Origin', allowed);
        if (allowed !== '*') res.set('Vary', 'Origin');
      }
      // Deliberately no Allow-Credentials: this surface must never be reached
      // with a browser-held cookie or Authorization header.
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return Boolean(allowed);
    };

    router.options('/api/v1/public/ask', (req, res) => {
      publicAskCors(req, res);
      res.status(204).end();
    });

    // trackUsage assigns req.requestId. Without it every ops event from this
    // route went out with no request id, which the receiver refuses.
    router.post('/api/v1/public/ask', this.trackUsage, (req, res) => {
      if (!publicAskCors(req, res)) {
        return res.status(403).json({ error: { message: 'Origin not permitted.', code: 'origin_not_allowed' } });
      }

      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
      const now = Date.now();
      const bucket = publicAskBuckets.get(ip);
      if (!bucket || now - bucket.windowStart >= PUBLIC_ASK_WINDOW_MS) {
        publicAskBuckets.set(ip, { count: 1, windowStart: now });
      } else if (++bucket.count > PUBLIC_ASK_MAX) {
        const retryAfter = Math.ceil((bucket.windowStart + PUBLIC_ASK_WINDOW_MS - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: { message: 'Too many questions from this address. Try again shortly.',
                   code: 'RATE_LIMIT_EXCEEDED', retry_after_seconds: retryAfter },
        });
      }

      const sanitized = sanitizePublicAsk(req.body);
      if (!sanitized.ok) {
        return res.status(400).json({ error: { message: sanitized.message, code: sanitized.code } });
      }

      // Set on the request object, never read from the body — a body flag would
      // let an authenticated caller downgrade itself onto this path, or an
      // anonymous one claim it was something else.
      req._publicSurface = true;
      req.body = sanitized.body;
      req.params.service = 'ai-chat';
      return this.routeToAIService(req, res);
    });

    // Internal surface for the memory intelligence edge functions. A shared
    // secret gates it instead of a credential, and it runs as _publicSurface so
    // nothing is attributed to an identity. See core/memory-analysis.js.
    router.post('/api/v1/internal/memory-analysis', this.trackUsage, (req, res) => {
      const auth = verifyInternalSecret(
        req.headers[INTERNAL_SECRET_HEADER],
        process.env.MEMORY_ANALYSIS_INTERNAL_SECRET,
      );
      if (auth === 'not_configured') {
        return res.status(503).json({
          error: { message: 'This surface is not configured.', code: 'not_configured' },
        });
      }
      if (auth !== 'ok') {
        return res.status(401).json({
          error: { message: 'Authentication required.', code: 'AUTH_REQUIRED' },
        });
      }

      const sanitized = sanitizeMemoryAnalysis(req.body);
      if (!sanitized.ok) {
        return res.status(400).json({ error: { message: sanitized.message, code: sanitized.code } });
      }

      // Server-set, as on public/ask: disables memory prefetch and tools.
      req._publicSurface = true;
      req.body = sanitized.body;
      req.params.service = 'ai-chat';
      return this.routeToAIService(req, res);
    });

    // Specific routes first (before wildcard routes)
    router.post('/api/v1/ai-chat',
      this.authenticateRequest,
      this.trackUsage,
      (req, res) => {
        req.params.service = 'ai-chat';
        return this.routeToAIService(req, res);
      }
    );

    // ── OpenAI-compatible facade (/v1) ──────────────────────────────────
    // A narrow second surface so harnesses that can only speak OpenAI (Pi, IDE
    // extensions, SDK clients) can reach the router without a bespoke adapter.
    // It only translates: request in, existing handler, response out. All
    // routing, fallback and vendor policy stays on the native path. Existing
    // callers keep using /api/v1/ai-chat unchanged.
    //
    // normalizeCredential runs BEFORE authenticateRequest because OpenAI SDKs
    // send the key as `Authorization: Bearer`, which the auth gateway rejects
    // for lano_ keys today (verified: 401 in 113ms vs 200 for X-API-Key).
    const compatCredential = (req, res, next) => {
      const outcome = openaiCompat.normalizeCredential(req);
      if (outcome === 'unsupported-credential') {
        return res.status(401).json(openaiCompat.openAIError(
          'This credential is scoped to the memory API and cannot authenticate here. '
          + 'Use an Onasis API key (lano_) or an OAuth access token.',
          { type: 'invalid_request_error', code: 'invalid_api_key' },
        ));
      }
      return next();
    };

    router.get('/v1/models',
      compatCredential,
      this.authenticateRequest,
      (req, res) => res.json(openaiCompat.modelList())
    );

    router.get('/v1/models/:model',
      compatCredential,
      this.authenticateRequest,
      (req, res) => {
        if (!openaiCompat.isKnownModel(req.params.model)) {
          return res.status(404).json(openaiCompat.openAIError(
            `The model '${req.params.model}' does not exist.`,
            { code: 'model_not_found', param: 'model' },
          ));
        }
        return res.json(openaiCompat.modelObject());
      }
    );

    router.post('/v1/chat/completions',
      compatCredential,
      this.authenticateRequest,
      this.trackUsage,
      (req, res) => {
        const converted = openaiCompat.toInternalRequest(req.body);
        if (converted.error) return res.status(converted.status).json(converted.error);

        // ── Streaming path ───────────────────────────────────────────────
        if (req.body?.stream === true) {
          return this.routeToAIServiceStream(req, res);
        }

        const requestedModel = (req.body && req.body.model) || openaiCompat.MODEL_ID;
        req.body = converted.body;
        req.params.service = 'ai-chat';
        // The lane is fixed for this surface unless the caller names one via
        // X-Use-Case, which resolveUseCaseFromRequest already validates.
        if (!req.headers['x-use-case']) req.body.use_case = openaiCompat.DEFAULT_USE_CASE;

        // Reshape on the way out. routeToAIService owns the response, so the
        // conversion is applied by wrapping res.json once rather than by
        // duplicating the routing logic here.
        const sendNative = res.json.bind(res);
        let converted_once = false;
        res.json = (payload) => {
          if (converted_once) return sendNative(payload);
          converted_once = true;
          if (res.statusCode >= 400) {
            const message = payload?.message || payload?.error?.message || 'Request failed.';
            return sendNative(openaiCompat.openAIError(message, {
              type: res.statusCode >= 500 ? 'server_error' : 'invalid_request_error',
              code: payload?.code || payload?.error?.code || null,
            }));
          }
          return sendNative(openaiCompat.toChatCompletion(payload, {
            id: `chatcmpl-${crypto.randomBytes(12).toString('hex')}`,
            created: Math.floor(Date.now() / 1000),
            model: openaiCompat.isKnownModel(requestedModel) && requestedModel
              ? openaiCompat.MODEL_ID : openaiCompat.MODEL_ID,
          }));
        };

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

    // Session memory proxy for @lanonasis/repl-cli's orchestrator — see
    // core/session-memory-proxy.js for why this lives here rather than
    // shipping the raw Redis Agent Memory credential in a published package.
    router.post('/api/v1/session-memory/events',
      this.authenticateRequest,
      async (req, res) => {
        if (!sessionMemoryProxy.isConfigured()) {
          return res.status(501).json({
            error: { message: 'Session memory not configured', code: 'SESSION_MEMORY_UNAVAILABLE' }
          });
        }
        const { sessionId, role, text } = req.body || {};
        if (!sessionId || !role || !text) {
          return res.status(400).json({
            error: { message: 'sessionId, role, and text are required', code: 'INVALID_REQUEST' }
          });
        }
        if (role !== 'USER' && role !== 'ASSISTANT') {
          return res.status(400).json({
            error: { message: 'role must be USER or ASSISTANT', code: 'INVALID_REQUEST' }
          });
        }
        try {
          await sessionMemoryProxy.addEvent(sessionId, req.uai.authId, role, text);
          res.status(201).json({ ok: true });
        } catch (error) {
          this.logger.warn('Session memory write failed', { error: error.message });
          res.status(502).json({
            error: { message: 'Session memory unavailable', code: 'SESSION_MEMORY_ERROR' }
          });
        }
      }
    );

    router.get('/api/v1/session-memory/:sessionId',
      this.authenticateRequest,
      async (req, res) => {
        if (!sessionMemoryProxy.isConfigured()) {
          return res.status(501).json({
            error: { message: 'Session memory not configured', code: 'SESSION_MEMORY_UNAVAILABLE' }
          });
        }
        try {
          const session = await sessionMemoryProxy.getSession(req.params.sessionId);
          // Defense in depth: sessionId is an unguessable client-generated
          // UUID and every event is written with actorId = req.uai.authId,
          // but verify on read too so one caller can never read another's
          // session by any means.
          const foreignEvent = session.events.find((e) => e.actorId && e.actorId !== req.uai.authId);
          if (foreignEvent) {
            return res.status(403).json({
              error: { message: 'Session does not belong to this caller', code: 'FORBIDDEN' }
            });
          }
          res.json(session);
        } catch (error) {
          this.logger.warn('Session memory read failed', { error: error.message });
          res.status(502).json({
            error: { message: 'Session memory unavailable', code: 'SESSION_MEMORY_ERROR' }
          });
        }
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

    // AI services health check — gated like every other service endpoint;
    // monitoring probes use the open /health route (same underlying check,
    // rate-limit exempt), so this stays unauthenticated for no benefit.
    router.get('/ai-health',
      this.authenticateRequest,
      async (req, res) => {
      const health = await this.checkAIServicesHealth();
      // Same three-state semantics as /health so the two endpoints cannot
      // disagree about whether the router is actually serving.
      const summary = summariseHealth(health);
      res.json({
        ai_services_health: health,
        overall_status: summary.status,
        vendors_healthy: `${summary.healthy}/${summary.total}`,
        timestamp: new Date().toISOString()
      });
    });

    // ── Streaming endpoint ─────────────────────────────────────────────
    // POST /api/v1/ai-chat with stream: true in the request body.
    // Returns an SSE stream (text/event-stream) compatible with the
    // OpenAI chat.completions streaming spec.
    router.post('/api/v1/ai-chat/stream',
      this.authenticateRequest,
      this.trackUsage,
      (req, res) => {
        // Check for streaming flag
        if (req.body?.stream === true || req.query?.stream === 'true') {
          return this.routeToAIServiceStream(req, res);
        }
        // Fall through to the normal (buffered) handler below
        req.params.service = 'ai-chat';
        return this.routeToAIService(req, res);
      }
    );

    return router;
  }

  // ── Streaming route ─────────────────────────────────────────────────────

  /**
   * Stream a chat request and emit SSE chunks directly to the response.
   *
   * This is the streaming counterpart to `routeToAIService()`. Instead of
   * buffering the complete response, it walks the vendor chain via the
   * chain executor's `stream()` generator, and writes each chunk as an SSE
   * event to the client.
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  async routeToAIServiceStream(req, res) {
    const startTime = Date.now();
    const requestId = req.requestId || `req-${crypto.randomBytes(8).toString('hex')}`;

    try {
      // ── Build request (same shape as handleOllamaChat) ─────────────────
      const requestStartedAt = Number.isFinite(req.requestStartedAt) ? req.requestStartedAt : Date.now();
      const body = req.body || {};
      const incomingMessages = Array.isArray(body.messages)
        ? body.messages
        : (body.prompt ? [{ role: 'user', content: String(body.prompt) }] : []);

      // Policy checks
      assertCallerRoles(incomingMessages, { logger: this.logger });
      assertUserContent(incomingMessages);

      const profile = this._profiles.resolve(req);
      const resolvedUseCase = profile?.boundUseCase || resolveUseCaseFromRequest(req);

      // The pass-through lane is buffered by contract: SSE has no chunk shape
      // for "the model chose a tool, the caller has to run it and send the
      // result back". Refuse before a vendor is touched rather than streaming
      // a first pass whose calls the caller cannot answer mid-stream.
      if (isToolPassthroughUseCase(resolvedUseCase)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          event: 'error',
          data: JSON.stringify({
            error: {
              message: `The '${resolvedUseCase}' use case does not support streaming — send the request without stream: true.`,
              code: 'tool_passthrough_not_streamable',
            },
          }),
        }));
        return;
      }

      const vendorChain = resolveVendorChainForUseCase(resolvedUseCase);

      if (vendorChain.length === 0) {
        this.logger.error('No active vendor available for use case', { useCase: resolvedUseCase });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          event: 'error',
          data: JSON.stringify({ error: { message: 'No active AI vendor available.', code: 'NO_VENDORS' } }),
        }));
        return;
      }

      const { systemPrompt, maxTokens, temperature } = vendorChain[0];
      const promptBundle = this.promptComposer.compose({
        useCase: resolvedUseCase,
        runtimePrompt: systemPrompt || this._fallbackSystemPrompt(),
      });

      const messages = [];
      const prefetchBrief = req._publicSurface
        ? ''
        : await this._prefetch.brief(req, incomingMessages, body);
      if (prefetchBrief) {
        messages.push({ role: 'system', content: prefetchBrief });
      }
      messages.push(...incomingMessages);

      const requestedTools = Array.isArray(body.tools) && body.tools.length > 0
        ? body.tools
        : this._toolLoop.getToolDefinitionsForUseCase(resolvedUseCase);
      const tools = req._publicSurface
        ? []
        : ToolLoop.constrainToAllowed(requestedTools, profile?.allowedTools ?? null);

      // ── Set SSE headers ────────────────────────────────────────────────
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // nginx: don't buffer SSE
      });

      // Streaming text sanitizer with carry-over buffer.
      // A blocklisted word can straddle a chunk boundary, so we hold back
      // the last `BUFFER_LEN` characters of each chunk and prepend them to
      // the next one before sanitising.
      const sanitizePersonaLeaks = require('./message-policy').sanitizePersonaLeaks;
      const BUFFER_LEN = 32; // enough for the longest persona leak phrase
      let carryBuffer = '';

      // AbortController wired to client disconnect — forwarded to vendors
      // so they can abort HTTP calls when the client closes the connection.
      const abort = new AbortController();
      res.on('close', () => { abort.abort(); });

      // Periodic keepalive comment so nginx's proxy_read_timeout doesn't
      // close the idle connection before the first token arrives.
      let keepaliveTimer = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch { clearInterval(keepaliveTimer); }
      }, 15000);

      // Clear keepalive on every exit path to prevent timer leaks.
      const clearKeepalive = () => {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      };

      // Flush the carry-over buffer: the last N characters held back on each
      // chunk must be sent at stream end or they are silently lost forever.
      const flushCarryBuffer = () => {
        if (carryBuffer) {
          const remaining = carryBuffer;
          carryBuffer = '';
          res.write(`data: ${JSON.stringify({
            id: eventId, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
          })}\n\n`);
        }
      };

      const eventId = `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
      const created = Math.floor(Date.now() / 1000);
      const model = openaiCompat.MODEL_ID;

      // ── Stream through the chain executor ──────────────────────────────
      let usage = {};

      try {
        for await (const chunk of this._chain.stream({
          useCase: resolvedUseCase,
          messages,
          promptBundle,
          temperature,
          maxTokens,
          tools,
          deadlineAt: this._deadlineAt(requestStartedAt),
          requestId,
          emitEvent: this._emitOpsEvent,
          // AbortController signal — forwarded to vendor adapters so they can
          // abort their HTTP calls when the client disconnects.
          abortSignal: abort.signal,
        })) {
          // ── Buffer response fallback ─────────────────────────────────
          if (chunk._buffered) {
            const native = chunk.response;
            const responseText = typeof native?.response === 'string' ? native.response : '';
            usage = native?.usage || {};
            if (responseText) {
              // Sanitize buffered response text as well.
              const safe = sanitizePersonaLeaks
                ? sanitizePersonaLeaks(responseText)
                : responseText;
              res.write(`data: ${JSON.stringify({
                id: eventId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: { content: safe }, finish_reason: null }],
              })}\n\n`);
            }
            flushCarryBuffer();
            clearKeepalive();
            this._writeFinish(res, { eventId, created, model, usage });
            return;
          }

          // ── Error marker ─────────────────────────────────────────────
          if (chunk._fallback) {
            res.write(`event: error
data: ${JSON.stringify({ error: { message: chunk.error, code: 'STREAMING_FALLBACK' } })}\n\n`);
            continue;
          }

          // ── Content chunk ────────────────────────────────────────────
          // Fix #2: Sanitize content through the persona leak blocklist with
          // a carry-over buffer so a blocklisted word that straddles two
          // SSE chunks is still caught.
          if (chunk.content && typeof chunk.content === 'string') {
            let text = carryBuffer + chunk.content;
            const sanitized = sanitizePersonaLeaks(text);
            const sendText = sanitized.slice(0, sanitized.length - BUFFER_LEN);
            carryBuffer = sanitized.slice(sanitized.length - BUFFER_LEN);
            if (sendText) {
              res.write(`data: ${JSON.stringify({
                id: eventId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: { content: sendText }, finish_reason: null }],
              })}\n\n`);
            }
          }

          // ── Tool call chunk ──────────────────────────────────────────
          if (chunk.tool_calls && Array.isArray(chunk.tool_calls) && chunk.tool_calls.length > 0) {
            for (const tc of chunk.tool_calls) {
              // ── Top-level name shape ──
              if (typeof tc === 'object' && tc.name !== undefined) {
                // Guarded: streamed tool-call arguments may be partial JSON
                // fragments; parsing each delta as a complete object would
                // throw. Use the whole string when it is valid JSON,
                // otherwise fall back to the raw (potentially truncated) value.
                let fn;
                try {
                  fn = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
                } catch {
                  fn = tc.arguments ?? {};
                }
                res.write(`data: ${JSON.stringify({
                  id: eventId, object: 'chat.completion.chunk', created, model,
                  choices: [{ index: 0, delta: {
                    tool_calls: [{ index: 0, id: tc.id || '', type: 'function', function: { name: tc.name, arguments: JSON.stringify(fn || {}) }}],
                  }, finish_reason: null }],
                })}\n\n`);
              } else if (typeof tc === 'object' && tc.index !== undefined) {
                // Delta tool call (OpenAI-compatible with index)
                res.write(`data: ${JSON.stringify({
                  id: eventId, object: 'chat.completion.chunk', created, model,
                  choices: [{ index: 0, delta: { tool_calls: [tc] }, finish_reason: null }],
                })}\n\n`);
              } else if (typeof tc === 'object' && tc.function?.name !== undefined) {
                // Full tool call object from vendor adapters (OpenAI/Anthropic
                // chatStream yield { id, type, function: { name, arguments } }).
                // Guarded JSON.parse — streamed arguments may be partial.
                let fn;
                const rawArgs = tc.function?.arguments ?? '';
                try {
                  fn = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
                } catch {
                  fn = rawArgs;
                }
                res.write(`data: ${JSON.stringify({
                  id: eventId, object: 'chat.completion.chunk', created, model,
                  choices: [{ index: 0, delta: {
                    tool_calls: [{ index: 0, id: tc.id || '', type: 'function', function: { name: tc.function.name, arguments: JSON.stringify(fn || {}) }}],
                  }, finish_reason: null }],
                })}\n\n`);
              }
            }
          }

          // ── Usage chunk ──────────────────────────────────────────────
          if (chunk.usage) {
            usage = { ...usage, ...chunk.usage };
            res.write(`data: ${JSON.stringify({
              id: eventId, object: 'chat.completion.chunk', created, model,
              usage: {
                prompt_tokens: chunk.usage.prompt_tokens || 0,
                completion_tokens: chunk.usage.completion_tokens || 0,
                total_tokens: chunk.usage.total_tokens || 0,
              },
            })}\n\n`);
          }

          // ── Finish marker ────────────────────────────────────────────
          if (chunk.finish_reason) {
            if (chunk.truncated) {
              res.write(`data: ${JSON.stringify({
                id: eventId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: { content: '\n\n[Response truncated due to budget exhaustion]' }, finish_reason: null }],
              })}\n\n`);
            }
            flushCarryBuffer();
            clearKeepalive();
            this._writeFinish(res, { eventId, created, model, usage });
            return;
          }
        }

        // Stream completed without a finish_reason — send synthetic finish
        flushCarryBuffer();
        clearKeepalive();
        this._writeFinish(res, { eventId, created, model, usage });

      } catch (err) {
        // Fix #11: Set 500 before streaming the error frame.
        try { res.writeHead(500, { 'Content-Type': 'text/event-stream' }); } catch { /* headers already sent */ }
        clearKeepalive();
        flushCarryBuffer();
        res.write(`event: error\ndata: ${JSON.stringify({ error: { message: err.message, code: 'STREAM_ERROR' } })}\n\n`);
        res.write('data: [DONE]\n\n');

        this._emitOpsEvent({
          kind: 'request_outcome',
          requestId,
          vendor: 'streaming',
          model: this.ollamaModel,
          durationMs: Date.now() - startTime,
          statusCode: 500,
          success: false,
          endpoint: req.originalUrl || req.path,
          error: String(err.message || 'streaming failed').slice(0, 512),
          occurredAt: new Date().toISOString(),
        });
      }

    } catch (error) {
      this.logger.error('Streaming request failed', { error: error.message });
      clearKeepalive();
      flushCarryBuffer();
      res.write(`event: error\ndata: ${JSON.stringify({ error: { message: error.message, code: 'STREAM_REQUEST_ERROR' } })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
  }

  /** Helper: write finish chunk + usage + [DONE] to SSE response. */
  _writeFinish(res, { eventId, created, model, usage }) {
    res.write(`data: ${JSON.stringify({
      id: eventId, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: eventId, object: 'chat.completion.chunk', created, model,
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    })}\n\n`);
    res.write('data: [DONE]\n\n');
  }
}

module.exports = AIServiceRouter;
