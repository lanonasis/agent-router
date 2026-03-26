'use strict';

/**
 * Anthropic Vendor Adapter — INTERNAL ONLY
 *
 * Translates Onasis-internal inference requests into Anthropic Messages API
 * and normalises responses into the vendor-agnostic internal shape.
 *
 * NOTE:
 *  - We intentionally do not forward tool definitions on this adapter yet.
 *    This keeps fallback behaviour deterministic across providers.
 */

const BASE_URL          = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
const CHAT_PATH         = process.env.ANTHROPIC_CHAT_PATH || '/messages';
const TIMEOUT_MS        = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '30000', 10);
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const API_KEY           = process.env.ANTHROPIC_API_KEY || '';

function toAnthropicRequest(internalRequest, model) {
  const { messages = [], systemPrompt, temperature, maxTokens } = internalRequest;

  const systemParts = [];
  if (systemPrompt) systemParts.push(systemPrompt);

  const anthropicMessages = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (role === 'system') {
      if (content) systemParts.push(content);
      continue;
    }

    if (role === 'user' || role === 'assistant') {
      anthropicMessages.push({ role, content });
      continue;
    }

    if (role === 'tool') {
      const toolName = msg.tool_name || 'tool';
      anthropicMessages.push({
        role: 'user',
        content: `[Tool Result: ${toolName}]\n${content}`,
      });
    }
  }

  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: 'user', content: '' });
  }

  return {
    model,
    max_tokens: maxTokens ?? 500,
    temperature: temperature ?? 0.7,
    system: systemParts.join('\n\n').trim() || undefined,
    messages: anthropicMessages,
  };
}

function normalizeMessage(raw) {
  const text = Array.isArray(raw?.content)
    ? raw.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
    : '';

  return {
    message: { role: 'assistant', content: text },
    done:        true,
    done_reason: raw?.stop_reason || 'stop',
    tool_calls:  [],
    usage: {
      prompt_tokens:     raw?.usage?.input_tokens || 0,
      completion_tokens: raw?.usage?.output_tokens || 0,
      total_tokens:      (raw?.usage?.input_tokens || 0) + (raw?.usage?.output_tokens || 0),
    },
  };
}

async function chat(internalRequest, model) {
  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured — Anthropic vendor unavailable');
  }

  const payload = toAnthropicRequest(internalRequest, model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw;
  try {
    const response = await fetch(`${BASE_URL}${CHAT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const _detail = await response.text().catch(() => '');
      throw new Error(`Anthropic adapter: upstream returned ${response.status}`);
    }

    raw = await response.json();
  } finally {
    clearTimeout(timer);
  }

  return normalizeMessage(raw);
}

async function healthCheck() {
  if (!API_KEY) return false;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };
