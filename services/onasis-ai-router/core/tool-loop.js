'use strict';

/**
 * Tool definition, authorisation, and execution for the AI router.
 *
 * Extracted verbatim from core/ai-service-router.js (2026-08-27). Every method
 * body and comment is unchanged — in particular the filesystem and command
 * safety constraints in the toolCode* family, which are load-bearing.
 *
 * Kept as a single class rather than split into core/tools/*.js: the block is
 * densely self-referential (this.safeParseArgs, this.toolMemoryGet, ...), so a
 * split would require rewriting every cross-reference. That is not a pure move
 * and does not belong in a phase whose contract is "no behaviour change". The
 * split is safe to do later, on top of the tests this refactor adds.
 *
 * `buildAuthHeaders` and `extractAssistantMessage` are injected because the
 * router still owns them.
 *
 * The follow-up-pass id-zipping logic (commit 5eed764) deliberately stays in
 * the router — it moves with chain-executor.
 */

const path = require('path');
const fs = require('fs');
const { fetchWithRetry } = require('../vendors/_shared/http-client');

class ToolLoop {
  // Moved here with its only consumer during the 2026-08-27 extraction. It
  // previously lived as a static on AIServiceRouter, which is out of scope in
  // this file — referencing it here threw "AIServiceRouter is not defined" at
  // runtime on every tool-bearing request.
  static READ_ONLY_MEMORY_TOOL_NAMES = new Set(['memory.search', 'memory.get']);

  constructor({
    apiBaseUrl, memorySearchPath, memoryGetPath, memoryWritePath, memoryBatchGetPath,
    memoryPrefetchTopK, routerTimeoutMs, maxToolResultChars, toolSummarizeEnabled,
    ollamaModel, ollamaToolModel, ollamaBaseUrl, ollamaChatPath,
    buildAuthHeaders, extractAssistantMessage, logger,
  }) {
    this.apiBaseUrl = apiBaseUrl;
    this.memorySearchPath = memorySearchPath;
    this.memoryGetPath = memoryGetPath;
    this.memoryWritePath = memoryWritePath;
    this.memoryBatchGetPath = memoryBatchGetPath;
    this.memoryPrefetchTopK = memoryPrefetchTopK;
    this.routerTimeoutMs = routerTimeoutMs;
    this.maxToolResultChars = maxToolResultChars;
    this.toolSummarizeEnabled = toolSummarizeEnabled;
    this.ollamaModel = ollamaModel;
    this.ollamaToolModel = ollamaToolModel;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.ollamaChatPath = ollamaChatPath;
    this.buildAuthHeaders = buildAuthHeaders;
    this.extractAssistantMessage = extractAssistantMessage;
    this.logger = logger;
  }

  _memoryWriteAllowedUseCases() {
    const raw = process.env.MEMORY_WRITE_USE_CASES;
    if (raw === undefined) {
      // repl-nlp only: the REPL is an explicitly agentic surface where the user
      // is issuing commands and an autonomous write is the expected behaviour.
      // memory-analysis is NOT included — it backs the IDE concierge chat box
      // and the Slack/Discord concierge, which are question-answering surfaces.
      return new Set(['repl-nlp']);
    }
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  }

  getToolDefinitionsForUseCase(useCase) {
    const all = this.getToolDefinitions();
    if (this._memoryWriteAllowedUseCases().has(useCase)) return all;
    return all.filter((t) => ToolLoop.READ_ONLY_MEMORY_TOOL_NAMES.has(t?.function?.name));
  }

  /**
   * Narrow an offered tool set to a profile manifest's `allowedTools`.
   *
   * The manifest is a CEILING, never a floor: it can remove a tool the lane
   * offered, but naming a tool here does not conjure it into a lane that never
   * had it. That direction matters — the opposite would let a profile grant
   * itself capability its use case was never approved for.
   *
   * `allowed` of null/undefined means no profile is active, and the set passes
   * through unchanged. An empty ARRAY is not the same thing: it is a profile
   * that permits no tools, and it offers none.
   */
  static constrainToAllowed(requested, allowed) {
    if (!Array.isArray(requested)) return [];
    if (allowed === null || allowed === undefined) return requested;
    const permitted = new Set(Array.isArray(allowed) ? allowed : []);
    return requested.filter((t) => permitted.has(t?.function?.name || t?.name));
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
      }
    ];
  }

  // code.* tools — NOT offered by default (see getToolDefinitions() above).
  // Only reachable when a caller explicitly requests them via `tools` in the
  // request body, and even then executeToolCall() requires the caller's
  // auth_id to be on CODE_TOOLS_TRUSTED_AUTH_IDS before actually running one.
  getCodeToolDefinitions() {
    return [
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

  // auth_ids permitted to invoke code.* tools (comma-separated env var).
  // Unset/empty means nobody is trusted — code tools fail closed, not open.
  _codeToolsTrustedAuthIds() {
    const raw = process.env.CODE_TOOLS_TRUSTED_AUTH_IDS || '';
    return new Set(raw.split(',').map((id) => id.trim()).filter(Boolean));
  }

  // A tool call must both be on the CODE_TOOL_NAMES list AND have been part
  // of the `tools` actually offered on this request AND come from a trusted
  // auth_id. This closes two gaps beyond "not in the default definitions":
  // (1) an already-offered code.* tool (a caller can still request one via
  // body.tools) can only run for allowlisted identities, and (2) a model
  // that hallucinates or is prompt-injected into calling a tool name that
  // was never offered in this request gets rejected regardless of name.
  _authorizeCodeTool(toolName, req, offeredTools) {
    const wasOffered = Array.isArray(offeredTools) &&
      offeredTools.some((t) => t?.function?.name === toolName);
    if (!wasOffered) {
      return { ok: false, reason: 'Tool was not offered for this request' };
    }

    const authId = req?.uai?.authId;
    const trusted = this._codeToolsTrustedAuthIds();
    if (!authId || !trusted.has(authId)) {
      this.logger.warn('code.* tool call rejected — auth_id not trusted', { toolName, authId: authId || null });
      return { ok: false, reason: 'Not authorized to use code tools' };
    }

    return { ok: true };
  }

  // memory.write is mutating, and until this check it dispatched whenever a
  // model named it: withholding the definition was the only control, which a
  // model that emits an unoffered call (or a caller-supplied `tools` array)
  // walked straight past. Execution now requires both that the tool was
  // offered on this request and that the use case is one writes are allowed
  // on (MEMORY_WRITE_USE_CASES, default repl-nlp).
  _authorizeMemoryWrite(offeredTools, useCase) {
    const wasOffered = Array.isArray(offeredTools) &&
      offeredTools.some((t) => t?.function?.name === 'memory.write');
    if (!wasOffered) {
      return { ok: false, reason: 'Tool was not offered for this request' };
    }
    if (!this._memoryWriteAllowedUseCases().has(useCase)) {
      this.logger.warn('memory.write rejected — use case does not permit writes', { useCase: useCase || null });
      return { ok: false, reason: `memory.write is not permitted on the ${useCase || 'unknown'} use case` };
    }
    return { ok: true };
  }

  async executeToolCalls(toolCalls, req, offeredTools, useCase, { concurrency = 3 } = {}) {
    const results = new Array(toolCalls.length);
    let nextIndex = 0;
    const active = new Set();

    const runOne = async (index) => {
      try {
        results[index] = await this.executeToolCallWithRetry(
          toolCalls[index], req, offeredTools, useCase,
        );
      } finally {
        active.delete(index);
      }
    };

    while (nextIndex < toolCalls.length) {
      // Submit up to `concurrency` in parallel
      while (nextIndex < toolCalls.length && active.size < concurrency) {
        active.add(nextIndex);
        runOne(nextIndex);
        nextIndex++;
      }
      // Wait for at least one to finish before submitting more
      if (active.size > 0) {
        await Promise.race([...active].map((idx) =>
          new Promise((resolve) => {
            const check = () => {
              if (!active.has(idx)) resolve();
              else setTimeout(check, 10);
            };
            check();
          }),
        ));
      }
    }

    return results;
  }

  async executeToolCallWithRetry(call, req, offeredTools, useCase) {
    const attempt = async () => this.executeToolCall(call, req, offeredTools, useCase);
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

  async executeToolCall(call, req, offeredTools, useCase) {
    const toolName = call.name;

    // Nothing runs unless it was offered on THIS request. memory.write and
    // code.* had this gate; memory.search / memory.get did not, so a
    // hallucinated or injected call to them ran even where no tools were
    // offered at all (the anonymous surface offers none). The router filters
    // before calling here too; this is the second line.
    const wasOffered = Array.isArray(offeredTools) &&
      offeredTools.some((t) => (t?.function?.name || t?.name) === toolName);
    if (!wasOffered) {
      return { name: toolName, payload: JSON.stringify({ error: 'Tool was not offered for this request' }) };
    }

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
      const auth = this._authorizeMemoryWrite(offeredTools, useCase);
      if (!auth.ok) {
        return { name: toolName, payload: JSON.stringify({ error: auth.reason }) };
      }
      const payload = await this.toolMemoryWrite(args, req);
      return { name: toolName, payload };
    }

    const CODE_TOOL_NAMES = new Set([
      'code.read', 'code.write', 'code.run_command',
      'code.scan_dependencies', 'code.find_related',
    ]);
    if (CODE_TOOL_NAMES.has(toolName)) {
      const auth = this._authorizeCodeTool(toolName, req, offeredTools);
      if (!auth.ok) {
        return { name: toolName, payload: JSON.stringify({ error: auth.reason }) };
      }
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
    let parsed = args;
    if (typeof parsed !== 'object') {
      try {
        parsed = JSON.parse(parsed);
      } catch (_) {
        return {};
      }
    }
    return this.unwrapSchemaEchoArgs(parsed);
  }

  // Small quantized/instruction-weak models (confirmed reproducibly on
  // qwen2.5-coder-ops:latest via Ollama) sometimes echo the tool's JSON
  // Schema shape back instead of substituting the real value — e.g. a
  // `query: {type: "string"}` schema property comes back as
  // `query: {type: "string", value: "the actual text"}` instead of
  // `query: "the actual text"`. The tag/fence wrapping the model was told
  // to use is unaffected (this is purely a per-argument-value corruption),
  // and it's specific to the exact {type, value} shape a schema echo
  // produces — real tool arguments essentially never coincidentally match
  // that exact two-key shape, so unwrapping it here is safe.
  unwrapSchemaEchoArgs(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (
        value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === 2 &&
        'type' in value && 'value' in value && typeof value.type === 'string'
      ) {
        result[key] = value.value;
      } else {
        result[key] = value;
      }
    }
    return result;
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
      if (!response.ok) {
        let errorInfo;
        try { errorInfo = await response.json(); } catch { errorInfo = {}; }
        // 5xx is a transport/retryable failure — throw so the retry wrapper fires.
        // 4xx is a client error (bad request, forbidden, etc.) — not retryable.
        if (response.status >= 500) {
          throw Object.assign(new Error(`Memory service error ${response.status}`), {
            statusCode: response.status,
            responseBody: errorInfo.error || errorInfo.message || `HTTP ${response.status}`,
          });
        }
        return this.formatToolPayload({
          error: `Memory service returned ${response.status}`,
          category: 'client_error',
          message: errorInfo.error || errorInfo.message || `HTTP ${response.status}`,
          status: response.status
        });
      }
      const result = await response.json();
      return this.formatToolPayload(result);
    } catch (error) {
      // Re-throw HTTP-level failures (with statusCode) so the retry wrapper catches them.
      // Only non-HTTP errors (network, timeout) are treated as final here.
      if (error.statusCode) {
        throw error;
      }
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
        if (!response.ok) {
          let errorInfo;
          try { errorInfo = await response.json(); } catch { errorInfo = {}; }
          // 5xx is retryable — throw. 4xx is client error — return.
          if (response.status >= 500) {
            throw Object.assign(new Error(`Memory batch error ${response.status}`), {
              statusCode: response.status,
              responseBody: errorInfo.error || errorInfo.message || `HTTP ${response.status}`,
            });
          }
          return this.formatToolPayload({
            error: `Memory service returned ${response.status}`,
            category: 'client_error',
            message: errorInfo.error || errorInfo.message || `HTTP ${response.status}`,
            status: response.status
          });
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
          if (!response.ok) {
            let errorInfo;
            try { errorInfo = await response.json(); } catch { errorInfo = {}; }
            throw new Error(`Memory get failed for ${id}: ${errorInfo.error || errorInfo.message || response.status}`);
          }
          data = await response.json();
        } finally {
          clearTimeout(timer);
        }
        return data.data || data;
      }));

      return this.formatToolPayload({ data: results });
    } catch (error) {
      // Re-throw HTTP-level failures so the retry wrapper catches them.
      if (error.statusCode) throw error;
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
      if (!response.ok) {
        let errorInfo;
        try { errorInfo = await response.json(); } catch { errorInfo = {}; }
        // 5xx is a transport/retryable failure — throw so the retry wrapper fires.
        // 4xx is a client error (bad request, forbidden, etc.) — not retryable.
        if (response.status >= 500) {
          throw Object.assign(new Error(`Memory service error ${response.status}`), {
            statusCode: response.status,
            responseBody: errorInfo.error || errorInfo.message || `HTTP ${response.status}`,
          });
        }
        return this.formatToolPayload({
          error: `Memory service returned ${response.status}`,
          category: 'client_error',
          message: errorInfo.error || errorInfo.message || `HTTP ${response.status}`,
          status: response.status
        });
      }
      const result = await response.json();
      return this.formatToolPayload(result);
    } catch (error) {
      // Re-throw HTTP-level failures so the retry wrapper catches them.
      if (error.statusCode) throw error;
      this.logger.warn('memory.write tool failed', { error: error.message });
      return JSON.stringify({ error: 'Memory write failed', message: error.message });
    }
  }

  // Filenames that must never be readable/writable through code.* tools even
  // inside an authorized CODE_BASE_DIR — a sandbox root can legitimately be a
  // whole service repo (e.g. mcp-core) that keeps its dotenvx-encrypted
  // .env.production alongside source. Tool output can end up forwarded to a
  // cloud vendor, so ciphertext blobs and key material shouldn't pass through
  // even though they aren't plaintext secrets.
  static CODE_TOOL_SECRET_FILENAME_PATTERN = /^(\.env(\..*)?|.*\.(key|pem|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.netrc)$/i;

  _isSecretFilename(filePath) {
    const path = require('path');
    return ToolLoop.CODE_TOOL_SECRET_FILENAME_PATTERN.test(path.basename(String(filePath)));
  }

  // Resolve and validate a file path stays within the allowed base directory.
  // Returns the resolved absolute path, or null if access is denied.
  _resolveRestrictedPath(filePath) {
    const path = require('path');
    // Fail closed: without an explicit sandbox dir, code.* tools must not
    // silently fall back to this process's own cwd (the router's source
    // tree, running as root) — that's a filesystem-access footgun, not a
    // sane default.
    if (!process.env.CODE_BASE_DIR) {
      this.logger.warn('code.* filesystem tool blocked — CODE_BASE_DIR not configured');
      return null;
    }
    const BASE_DIR = path.resolve(process.env.CODE_BASE_DIR);
    if (!filePath || typeof filePath !== 'string') return null;

    const resolved = path.resolve(BASE_DIR, filePath);

    // Ensure resolved path is within BASE_DIR (prevents ../../../etc/passwd attacks)
    const isInside = resolved === BASE_DIR || resolved.startsWith(BASE_DIR + path.sep);
    if (!isInside) {
      this.logger.warn('Path traversal attempt blocked', { filePath, resolved, BASE_DIR });
      return null;
    }
    if (this._isSecretFilename(resolved)) {
      this.logger.warn('code.* tool blocked — secret-shaped filename', { filePath, resolved });
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

      // _resolveRestrictedPath only ever validates cwd — the allowlisted
      // executables above (cat, grep, find, sed, ...) take arbitrary file
      // paths as ARGUMENTS, which is a separate, unvalidated route to any
      // secret-shaped file. Block it here regardless of path form
      // (relative/absolute/traversal) since this is a basename check, not a
      // resolved-path containment check.
      const forbiddenArg = execArgs.find((arg) => this._isSecretFilename(arg));
      if (forbiddenArg) {
        this.logger.warn('Command rejected — secret-shaped filename in arguments', { executable: execBasename, forbiddenArg });
        return JSON.stringify({ error: 'Command not permitted: argument references a restricted file' });
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

      // Confine the search to the sandbox, like every other code.* tool.
      // Previously neither a path nor a cwd was passed, so rg/grep inherited
      // the router process's working directory — its own source tree, holding
      // .env, .env.production and .env.keys (the dotenvx PRIVATE key), well
      // outside CODE_BASE_DIR. Reported on PR #1 by Copilot, 2026-09-03.
      const searchDir = this._resolveRestrictedPath(args.directory || '.');
      if (!searchDir) {
        return JSON.stringify({ error: 'Search directory is outside the permitted code sandbox' });
      }

      // -F: match the keyword literally. rg treats the pattern as a regex by
      // default and the metacharacter filter above rejects ;&|`$<>\ but not
      // ^ . * [ ] ( ) + ? — which made this a working oracle over file
      // contents. The argument is documented as a feature keyword, so literal
      // matching is also the intended semantics.
      const rgArgs = ['-l', '-F', feature];
      for (const t of safeTypes) {
        rgArgs.push('-t', t);
      }
      rgArgs.push('.');

      // Results are filenames, so a secret-shaped name is itself disclosure —
      // the same reason _resolveRestrictedPath refuses to open them.
      const withoutSecrets = (stdout) => stdout
        .trim().split('\n')
        .filter(f => f && !this._isSecretFilename(f));

      try {
        const { stdout } = await execFileAsync('rg', rgArgs, {
          cwd: searchDir,
          timeout: 15000,
          maxBuffer: 1024 * 1024
        });
        const files = withoutSecrets(stdout);
        return JSON.stringify({ success: true, feature, files, count: files.length });
      } catch (_rgError) {
        // rg not available or no matches — fallback to grep (args passed as array, no shell)
        const { stdout } = await execFileAsync('grep', ['-r', '-l', '-F', feature, '.'], {
          cwd: searchDir,
          timeout: 15000,
          maxBuffer: 1024 * 1024
        });
        const files = withoutSecrets(stdout);
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
}

module.exports = { ToolLoop };
