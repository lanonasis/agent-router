'use strict';

/**
 * LangAdapter — LanguageModelV2 adapter wrapping the Onasis AI router.
 *
 * This module provides a thin translation layer between AI SDK v6's
 * LanguageModelV2 interface (used by VoltAgent and any SDK v6 harness)
 * and the Onasis AI router's internal chain-executor + vendor adapters.
 *
 * Architecture:
 *   VoltAgent / SDK harness  →  LangAdapter.doGenerate() / doStream()
 *                            →  ChainExecutor.run()  (vendor chain, fallback, circuit-breaker)
 *                            →  vendor adapter.chat()  (per-vendor HTTP call)
 *                            →  response translation back to LanguageModelV2
 *
 * The router's vendor chain handles:
 *   - Vendor selection per use-case (pi → minimax → openclaw → openai → anthropic → lmstudio)
 *   - Scoreboard-driven ordering and circuit-breaker
 *   - Fallback with tightened budgets on failure
 *   - Tool execution (memory.search, memory.get, memory.write, code.*)
 *   - Follow-up synthesis pass
 *   - Response sanitization and persona leak prevention
 *
 * This adapter only translates between the two protocol formats.
 */

const path = require('path');

// ─── Router core imports ─────────────────────────────────────────────────────
// All resolved relative to the monorepo root so the package works regardless of cwd.
// The monorepo root is the parent of 'services/onasis-ai-router/' and 'packages/'.
// We find it by walking up from this file's location.

function resolveRouterModule(relativePath) {
  // Walk up from src/lang-adapter.js to find the monorepo root
  // Path: packages/agent-runtime/src/lang-adapter.js → ../../../../ = monorepo root
  // But we use process.cwd() to be safe when the package is installed elsewhere
  const cwd = process.cwd();

  // Strategy: check if we're inside the monorepo root directly
  const candidates = [
    // Direct parent of packages/ (monorepo root)
    path.join(cwd, 'services', 'onasis-ai-router', relativePath),
    // One level up from cwd (if cwd is packages/agent-runtime)
    path.join(cwd, '..', '..', 'services', 'onasis-ai-router', relativePath),
    // Two levels up (if cwd is packages/agent-runtime/src)
    path.join(cwd, '..', '..', '..', 'services', 'onasis-ai-router', relativePath),
    // Monorepo root relative to __dirname (packages/agent-runtime/src)
    path.join(__dirname, '..', '..', '..', 'services', 'onasis-ai-router', relativePath),
  ];

  for (const candidate of candidates) {
    try {
      require.resolve(candidate);
      return candidate;
    } catch {
      // Not found, try next candidate
    }
  }

  // Fallback: try relative to __dirname with multiple depths
  const fallback = path.join(__dirname, '..', '..', '..', 'services', 'onasis-ai-router', relativePath);
  try {
    require.resolve(fallback);
    return fallback;
  } catch {
    throw new Error(`Cannot resolve router module: ${relativePath}. Tried:\n` + candidates.map(c => `  - ${c}`).join('\n'));
  }
}

const { ChainExecutor } = require(resolveRouterModule('core/chain-executor'));
const { PromptComposer } = require(resolveRouterModule('core/prompt-composer'));
const { ToolLoop } = require(resolveRouterModule('core/tool-loop'));
const { VendorScoreboard } = require(resolveRouterModule('core/vendor-scoreboard'));
const { VENDOR_REGISTRY, resolveVendorChainForUseCase } = require(resolveRouterModule('vendors'));
const { sanitizeVendorResponse } = require(resolveRouterModule('vendors'));

// ─── Logger ──────────────────────────────────────────────────────────────────
// Minimal in-memory logger that matches the winston shape expected by the router.
class SimpleLogger {
  info(msg, meta) { this._log('info', msg, meta); }
  warn(msg, meta) { console.warn('[LangAdapter]', msg, meta || ''); }
  error(msg, meta) { console.error('[LangAdapter]', msg, meta || ''); }
  debug(msg, meta) { /* silent in production */ }
  _log(level, msg, meta) {
    if (meta && typeof meta === 'object') {
      console[level](`[LangAdapter] ${msg} ${JSON.stringify(meta)}`);
    } else {
      console[level](`[LangAdapter] ${msg}`);
    }
  }
}

// ─── PromptBundle shim ───────────────────────────────────────────────────────
// The router's chain executor expects a promptBundle object with
// `systemPromptForVendor(vendorId) → string | null`. We build one from
// the LangAdapter's system instruction (or let the router's own prompt
// composer fill it in when useCase is provided).

function makePromptBundle(promptComposer, useCase, systemInstruction) {
  // If useCase is known, delegate to the composer for full prompt composition.
  if (useCase && promptComposer) {
    const bundle = promptComposer.compose({ useCase, runtimePrompt: systemInstruction || '' });
    return { systemPromptForVendor: (vendorId) => bundle.systemPromptForVendor(vendorId) };
  }
  // Fallback: just wrap the raw instruction.
  return {
    systemPromptForVendor: () => systemInstruction || null,
  };
}

// ─── LangAdapter class ───────────────────────────────────────────────────────

/**
 * LanguageModelV2 adapter that wraps the Onasis AI router's chain executor.
 *
 * @param {object} [options]
 * @param {string} [options.modelId='lzero'] — Model ID exposed to SDK callers
 * @param {string} [options.provider='onasis'] — Provider name for SDK metadata
 * @param {string} [options.useCase='dashboard-assistant'] — Router use-case lane
 * @param {number} [options.maxTokens] — Override max tokens (falls through to lane default)
 * @param {number} [options.temperature] — Override temperature
 * @param {string} [options.apiBaseUrl] — Memory service base URL
 * @param {string} [options.authGatewayUrl] — Auth gateway URL
 * @param {string} [options.promptsRoot] — Path to prompt model files
 */
class LangAdapter {
  static DEFAULT_MODEL_ID = 'lzero';
  static DEFAULT_PROVIDER = 'onasis';

  constructor(options = {}) {
    this.specificationVersion = 'v2';
    this.provider = options.provider || LangAdapter.DEFAULT_PROVIDER;
    this.modelId = options.modelId || LangAdapter.DEFAULT_MODEL_ID;

    this.useCase = options.useCase || 'dashboard-assistant';
    this.maxTokens = options.maxTokens;
    this.temperature = options.temperature;

    this._logger = new SimpleLogger();

    // ── Prompt composition ────────────────────────────────────────────
    this._promptComposer = new PromptComposer({
      promptsRoot: options.promptsRoot,
    });

    // ── Vendor chain executor ─────────────────────────────────────────
    this._scoreboard = new VendorScoreboard();
    this._chain = new ChainExecutor({
      scoreboard: this._scoreboard,
      logger: this._logger,
    });

    // ── Tool loop (for executeToolCalls during synthesis) ─────────────
    this._toolLoop = new ToolLoop({
      apiBaseUrl: options.apiBaseUrl || process.env.API_BASE_URL || 'https://api.lanonasis.com',
      memorySearchPath: process.env.MEMORY_SEARCH_PATH || '/api/v1/memories/search',
      memoryGetPath: process.env.MEMORY_GET_PATH || '/api/v1/memories',
      memoryWritePath: process.env.MEMORY_WRITE_PATH || '/api/v1/memories',
      memoryBatchGetPath: process.env.MEMORY_BATCH_GET_PATH || '',
      memoryPrefetchTopK: parseInt(process.env.MEMORY_PREFETCH_TOPK || '8', 10),
      routerTimeoutMs: parseInt(process.env.ROUTER_TIMEOUT_MS || '15000', 10),
      maxToolResultChars: parseInt(process.env.TOOL_RESULT_MAX_CHARS || '6000', 10),
      toolSummarizeEnabled: (process.env.TOOL_RESULT_SUMMARIZE || 'false') === 'true',
      ollamaModel: process.env.OLLAMA_MODEL || 'qwen2:1.5b',
      ollamaToolModel: process.env.OLLAMA_TOOL_MODEL || '',
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      ollamaChatPath: process.env.OLLAMA_CHAT_PATH || '/api/chat',
      // These are optional for the chain path — the tool loop mainly needs
      // getToolDefinitions() and executeToolCall() for synthesis passes.
      buildAuthHeaders: () => ({}),
      extractAssistantMessage: (r) => ({ content: r?.message?.content || '', raw: r?.message || {} }),
      logger: this._logger,
    });

    // ── Resolve the vendor chain once at construction ─────────────────
    this._vendorChain = this._resolveVendorChain();
  }

  /**
   * Resolve the ordered chain of active vendors for the configured use-case.
   * @returns {Array} Array of vendor objects from resolveVendorChainForUseCase
   */
  _resolveVendorChain() {
    try {
      return resolveVendorChainForUseCase(this.useCase);
    } catch (err) {
      this._logger.warn('Failed to resolve vendor chain for use-case', {
        useCase: this.useCase,
        error: err.message,
      });
      return [];
    }
  }

  /**
   * Check if at least one active vendor is available for the use-case.
   * @returns {boolean}
   */
  hasAvailableVendors() {
    return this._vendorChain.length > 0;
  }

  /**
   * Translate a LanguageModelV2 prompt to the router's internal message format.
   *
   * The router expects:
   *   messages: Array<{ role: string, content: string, tool_call_id?: string, tool_name?: string }>
   *
   * LanguageModelV2 prompts contain parts (text, tool-call, tool-result).
   * We convert:
   *   - system → { role: 'system', content: text }
   *   - user   → { role: 'user', content: text }
   *   - assistant → { role: 'assistant', content: text }
   *   - tool (result) → { role: 'tool', content: result, tool_call_id, tool_name }
   *
   * Tool calls are passed separately via the `tools` option.
   *
   * @param {Array} prompt - LanguageModelV2Prompt (array of part groups by role)
   * @returns {Array} Internal messages array
   */
  _translatePromptToMessages(prompt) {
    const messages = [];

    if (!Array.isArray(prompt)) return messages;

    for (const part of prompt) {
      if (!part || typeof part !== 'object') continue;

      const role = part.role;

      if (role === 'system') {
        const text = this._extractTextParts(part.content || []);
        if (text) {
          messages.push({ role: 'system', content: text });
        }
      } else if (role === 'user') {
        const text = this._extractTextParts(part.content || []);
        if (text) {
          messages.push({ role: 'user', content: text });
        }
      } else if (role === 'assistant') {
        const text = this._extractTextParts(part.content || []);
        if (text || (part.toolCalls && part.toolCalls.length > 0)) {
          const msg = { role: 'assistant', content: text || '' };
          // Preserve tool calls from assistant turns (for multi-turn)
          if (part.toolCalls && part.toolCalls.length > 0) {
            msg.tool_calls = this._translateToolCallsToRouterFormat(part.toolCalls);
          }
          messages.push(msg);
        }
      } else if (role === 'tool') {
        // Tool result: { role: 'tool', toolCallId, toolName, content: [...] }
        const toolCallId = part.toolCallId || '';
        const toolName = part.toolName || '';
        const text = this._extractTextParts(part.content || []);
        messages.push({
          role: 'tool',
          content: text || '',
          tool_call_id: toolCallId,
          tool_name: toolName,
        });
      }
    }

    return messages;
  }

  /**
   * Extract plain text from a LanguageModelV2 content array.
   * Skips reasoning parts — the router doesn't handle reasoning output.
   *
   * @param {Array} contentParts
   * @returns {string}
   */
  _extractTextParts(contentParts) {
    if (!Array.isArray(contentParts)) {
      if (typeof contentParts === 'string') return contentParts;
      return '';
    }
    const texts = [];
    for (const part of contentParts) {
      if (!part) continue;
      if (part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text);
      }
      // Skip reasoning, tool-calls, images — the router handles these separately
    }
    return texts.join('\n').trim();
  }

  /**
   * Translate LanguageModelV2 tool-call objects to the router's format.
   *
   * Router expects: Array<{ id: string, name: string, arguments: object }>
   * @param {Array} toolCalls
   * @returns {Array}
   */
  _translateToolCallsToRouterFormat(toolCalls) {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map((tc) => ({
      id: tc.toolCallId || '',
      name: tc.toolName || '',
      arguments: tc.args || {},
      type: 'function',
    })).filter((tc) => tc.name);
  }

  /**
   * Translate LanguageModelV2 tools to the router's internal tool format.
   *
   * Router expects: Array<{ type: 'function', function: { name, description, parameters } }>
   * LanguageModelV2FunctionTool has: { type: 'function', function: { name, description, inputSchema } }
   *
   * @param {Array} tools
   * @returns {Array}
   */
  _translateTools(tools) {
    if (!Array.isArray(tools)) return [];
    return tools.map((tool) => {
      if (!tool || !tool.function) return null;
      const fn = tool.function;
      const parameters = fn.inputSchema ? this._schemaToParameters(fn.inputSchema) : {};
      return {
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description || '',
          parameters,
        },
      };
    }).filter(Boolean);
  }

  /**
   * Convert an AI SDK JSON Schema (inputSchema) to the router's OpenAI-style
   * parameters object. This is a best-effort conversion that handles the
   * most common schema shapes.
   *
   * @param {object} schema
   * @returns {object}
   */
  _schemaToParameters(schema) {
    if (!schema || typeof schema !== 'object') return {};

    const convert = (s) => {
      if (!s || typeof s !== 'object') return s;

      // Handle $ref references (resolve inline if possible)
      if (s.$ref) {
        return s; // Forward as-is; the router/adapter will handle it
      }

      const result = {};

      if (s.type) result.type = s.type;
      if (s.description) result.description = s.description;
      if (s.enum) result.enum = s.enum;
      if (s.default !== undefined) result.default = s.default;

      if (s.type === 'object' && s.properties) {
        result.properties = {};
        for (const [key, val] of Object.entries(s.properties)) {
          result.properties[key] = convert(val);
        }
        if (s.required && Array.isArray(s.required)) {
          result.required = s.required;
        }
      }

      if (s.type === 'array' && s.items) {
        result.items = convert(s.items);
      }

      return result;
    };

    return convert(schema);
  }

  /**
   * Build the internal request object for ChainExecutor.
   *
   * @param {object} options - LanguageModelV2CallOptions
   * @returns {object} Internal request for chainExecutor.run()
   */
  _buildInternalRequest(options) {
    const messages = this._translatePromptToMessages(options.prompt);
    const tools = this._translateTools(options.tools);

    return {
      messages,
      tools,
      temperature: options.temperature ?? this.temperature,
      maxTokens: options.maxTokens ?? this.maxTokens,
      useCase: this.useCase,
    };
  }

  /**
   * Build the prompt bundle for ChainExecutor.
   *
   * @param {object} internalRequest
   * @returns {object} PromptBundle with systemPromptForVendor()
   */
  _buildPromptBundle(internalRequest) {
    // Check if system messages were translated
    const systemMessages = internalRequest.messages.filter(m => m.role === 'system');
    const systemInstruction = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : '';

    return makePromptBundle(this._promptComposer, this.useCase, systemInstruction);
  }

  /**
   * Extract soft tool calls from text content (fallback when no native tool_calls).
   *
   * @param {string} text
   * @returns {Array}
   */
  _extractSoftToolCalls(text) {
    if (!text || typeof text !== 'string') return [];
    const jsonMatch = text.match(/```json([\s\S]*?)```/i) || text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return parsed.tool_calls.map((call) => ({
          id: call.id || '',
          name: call.name || call.function?.name,
          arguments: call.arguments || call.function?.arguments || {},
          type: 'function',
        })).filter((call) => call.name);
      }
      if (parsed.tool && parsed.arguments) {
        return [{ id: '', name: parsed.tool, arguments: parsed.arguments, type: 'function' }];
      }
      if (parsed.name && parsed.arguments) {
        return [{ id: '', name: parsed.name, arguments: parsed.arguments, type: 'function' }];
      }
    } catch {
      return [];
    }
    return [];
  }

  /**
   * Translate a router adapter response to LanguageModelV2GenerateResult.
   *
   * Router response shape:
   *   { message: { role, content }, done_reason, tool_calls, usage, ... }
   *
   * @param {object} adapterResponse
   * @param {object} [options]
   * @param {Array} [options.tools] - Original tools (for tool-call id matching)
   * @returns {object} LanguageModelV2GenerateResult
   */
  _translateResponseToGenerateResult(adapterResponse, options = {}) {
    const content = typeof adapterResponse?.message?.content === 'string'
      ? adapterResponse.message.content
      : '';

    const rawToolCalls = Array.isArray(adapterResponse?.tool_calls) ? adapterResponse.tool_calls : [];

    // Check for tool calls from native format or soft-parse from text
    let toolCalls = rawToolCalls.length > 0
      ? rawToolCalls
      : this._extractSoftToolCalls(content);

    // Filter unoffered tools (tools the model didn't ask for are hallucinations)
    const offeredNames = new Set(
      (options.tools || []).map(t => t.function.name).filter(Boolean)
    );
    toolCalls = toolCalls.filter((tc) => {
      const name = tc.name || tc.function?.name;
      return offeredNames.has(name) || offeredNames.size === 0;
    });

    // Determine finish reason
    const doneReason = adapterResponse?.done_reason || 'stop';
    let finishReason;
    if (toolCalls.length > 0) {
      finishReason = 'tool-calls';
    } else if (doneReason === 'length' || doneReason === 'max_tokens') {
      finishReason = 'length';
    } else if (doneReason === 'tool_calls' || doneReason === 'tool_use') {
      finishReason = 'tool-calls';
    } else {
      finishReason = 'stop';
    }

    // Build content parts
    const contentParts = [];

    // Add text content (unless it's purely a tool-call turn)
    if (!content || !content.trim()) {
      // Empty content with tool calls — only include tool-call parts
    } else {
      contentParts.push({ type: 'text', text: content });
    }

    // Add tool call parts
    for (const tc of toolCalls) {
      const argsText = typeof tc.arguments === 'string'
        ? tc.arguments
        : JSON.stringify(tc.arguments || {});

      contentParts.push({
        type: 'tool-call',
        toolCallId: tc.id || `call_${Math.random().toString(36).slice(2, 9)}`,
        toolName: tc.name || tc.function?.name || '',
        args: typeof tc.arguments === 'string' ? JSON.parse(argsText) : (tc.arguments || {}),
        rawArgs: argsText,
      });
    }

    // Build usage
    const usage = this._translateUsage(adapterResponse?.usage);

    return {
      content: contentParts,
      finishReason,
      usage,
      request: {
        body: {
          model: this.modelId,
          messages: options._requestMessages,
          tools: options._requestTools,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        },
      },
      response: {
        id: adapterResponse?.id || `onn_${Date.now()}`,
        model: this.modelId,
        headers: {},
        body: adapterResponse,
      },
      warnings: [],
    };
  }

  /**
   * Translate router usage numbers to LanguageModelV2Usage format.
   *
   * @param {object} routerUsage
   * @returns {object}
   */
  _translateUsage(routerUsage) {
    if (!routerUsage || typeof routerUsage !== 'object') {
      return {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      };
    }

    return {
      inputTokens: Number(routerUsage.prompt_tokens) || undefined,
      outputTokens: Number(routerUsage.completion_tokens) || undefined,
      totalTokens: Number(routerUsage.total_tokens)
        || (Number(routerUsage.prompt_tokens) || 0) + (Number(routerUsage.completion_tokens) || 0)
        || undefined,
    };
  }

  /**
   * LanguageModelV2GenerateResult — generate a single non-streaming response.
   *
   * @param {object} options - LanguageModelV2CallOptions
   * @returns {Promise<object>} LanguageModelV2GenerateResult
   */
  async doGenerate(options) {
    const internalRequest = this._buildInternalRequest(options);
    const promptBundle = this._buildPromptBundle(internalRequest);

    // Add error sentinels for active vendors in the chain
    const vendorChain = this._vendorChain.length > 0
      ? this._vendorChain
      : this._resolveVendorChain();

    if (vendorChain.length === 0) {
      throw new Error(
        `No active AI vendor available for use-case '${this.useCase}'. `
        + 'Check vendor configuration and that at least one vendor is active.'
      );
    }

    try {
      const { adapterResponse, selectedVendor } = await this._chain.run({
        useCase: this.useCase,
        messages: internalRequest.messages,
        promptBundle,
        temperature: internalRequest.temperature,
        maxTokens: internalRequest.maxTokens,
        tools: internalRequest.tools,
        deadlineAt: Date.now() + 55000, // 55s total budget (same as router default)
        requestId: `lang_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });

      // Add vendor metadata for observability
      const result = this._translateResponseToGenerateResult(adapterResponse, {
        tools: options.tools,
        _requestMessages: internalRequest.messages,
        _requestTools: internalRequest.tools,
        temperature: internalRequest.temperature,
        maxTokens: internalRequest.maxTokens,
      });

      result.providerMetadata = {
        selectedVendor: selectedVendor?._vendorId,
        selectedModel: selectedVendor?._model,
        vendorChain: vendorChain.map(v => v._vendorId),
      };

      return result;
    } catch (err) {
      // Map vendor errors to LanguageModelV2-compatible errors
      const msg = err.message || 'Request failed';
      if (err.name === 'VendorsExhaustedError' || err.code === 'ALL_VENDORS_UNAVAILABLE') {
        const fallbackErr = new Error(`No AI vendor available: ${msg}`);
        fallbackErr.code = 'VENDOR_UNAVAILABLE';
        throw fallbackErr;
      }
      throw err;
    }
  }

  /**
   * LanguageModelV2StreamResult — stream a response.
   *
   * Streaming is NOT natively supported by the Onasis router. This
   * implementation buffers the full response and emits it as a
   * single chunk per LanguageModelV2StreamPart type, which is
   * functionally equivalent to non-streaming but satisfies the
   * API contract for SDK v6 harnesses that require it.
   *
   * @param {object} options - LanguageModelV2CallOptions
   * @returns {Promise<object>} LanguageModelV2StreamResult
   */
  async doStream(options) {
    // Run the full generation first (non-streaming under the hood)
    const result = await this.doGenerate(options);

    // Build a ReadableStream that emits the response as stream parts
    const parts = this._buildStreamParts(result, options);

    const stream = new ReadableStream({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });

    return {
      stream,
      request: result.request,
      response: result.response,
    };
  }

  /**
   * Build LanguageModelV2StreamPart[] from a generated result.
   *
   * @param {object} generateResult - LanguageModelV2GenerateResult
   * @param {object} options - Original call options
   * @returns {Array<LanguageModelV2StreamPart>}
   */
  _buildStreamParts(generateResult, options) {
    const parts = [];
    const timestamp = Date.now();

    // stream-start
    parts.push({ type: 'stream-start', timestamp });

    // response-metadata
    parts.push({
      type: 'response-metadata',
      id: generateResult.response?.id,
      model: generateResult.response?.model,
      timestamp,
    });

    // Process content parts
    const toolCalls = generateResult.content.filter(c => c.type === 'tool-call');
    const textParts = generateResult.content.filter(c => c.type === 'text');

    // Emit text content as text stream
    for (const cp of textParts) {
      parts.push({ type: 'text-start', timestamp });
      parts.push({ type: 'text-delta', textDelta: cp.text, timestamp });
      parts.push({ type: 'text-end', timestamp });
    }

    // Emit tool calls as tool-call stream
    for (const tc of toolCalls) {
      const args = typeof tc.args === 'object' ? tc.args : {};
      const argsText = JSON.stringify(args);

      parts.push({ type: 'tool-input-start', toolCallId: tc.toolCallId, toolName: tc.toolName, timestamp });
      parts.push({ type: 'tool-input-delta', toolCallId: tc.toolCallId, toolName: tc.toolName, argsTextDelta: argsText, timestamp });
      parts.push({ type: 'tool-input-end', toolCallId: tc.toolCallId, toolName: tc.toolName, args, timestamp });
    }

    // finish
    parts.push({
      type: 'finish',
      finishReason: generateResult.finishReason,
      usage: generateResult.usage,
      providerMetadata: generateResult.providerMetadata,
      timestamp,
    });

    return parts;
  }
}

// ─── Factory function ────────────────────────────────────────────────────────

/**
 * Create a new LangAdapter instance.
 *
 * This is the preferred entry point — it hides the class constructor
 * and allows for future configuration changes without breaking the API.
 *
 * @param {object} [options] - Same as LangAdapter constructor
 * @returns {LangAdapter}
 */
function createLangAdapter(options = {}) {
  return new LangAdapter(options);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  LangAdapter,
  createLangAdapter,
};
