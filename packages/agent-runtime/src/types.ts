/**
 * Type definitions for the LangAdapter package.
 *
 * These types mirror AI SDK v6's LanguageModelV2 interface so that
 * TypeScript users can integrate the adapter without manual type casts.
 *
 * @module @lanonasis/agent-runtime/types
 */

// ─── LanguageModelV2 base interface ────────────────────────────────────────────

/**
 * Specification version for the LanguageModelV2 interface.
 * @see https://sdk.vercel.ai/docs/fundamentals/custom-models
 */
export type LanguageModelV2SpecificationVersion = 'v2';

/**
 * Core language model interface for AI SDK v6.
 * Implementors must provide doGenerate() and doStream().
 */
export interface LanguageModelV2 {
  /** Specification version (always 'v2' for this adapter) */
  readonly specificationVersion: LanguageModelV2SpecificationVersion;
  /** Provider identifier (e.g., 'onasis') */
  readonly provider: string;
  /** Model identifier (e.g., 'lzero') */
  readonly modelId: string;
  /** URL patterns supported by this model */
  readonly supportedUrls: Record<string, RegExp[]>;

  /** Generate a single (non-streaming) response */
  doGenerate(
    options: LanguageModelV2CallOptions
  ): Promise<LanguageModelV2GenerateResult>;

  /** Generate a streaming response */
  doStream(
    options: LanguageModelV2CallOptions
  ): Promise<LanguageModelV2StreamResult>;
}

// ─── Call options ──────────────────────────────────────────────────────────────

/**
 * Options passed to doGenerate() and doStream().
 */
export interface LanguageModelV2CallOptions {
  /**
   * The prompt to send to the model, organized by role.
   * Each entry maps a role to an array of content parts.
   */
  prompt: LanguageModelV2Prompt;

  /** Maximum number of tokens to generate */
  maxTokens?: number;

  /** Temperature for sampling (0-2) */
  temperature?: number;

  /** Random seed for reproducible generation */
  seed?: number;

  /** Stop sequences that will end generation */
  stopSequences?: string[];

  /** Tools available to the model (function calling) */
  tools?: LanguageModelV2FunctionTool[];

  /** Tool choice mode: 'auto', 'any', 'none', or specific tool */
  toolChoice?: LanguageModelV2ToolChoice;

  /** JSON schema for structured output mode */
  output?: {
    type: 'json';
    schema?: object;
  };
}

/**
 * A prompt is an array of part groups, each with a role and content parts.
 */
export type LanguageModelV2Prompt = Array<{
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: LanguageModelV2Content[];
}>;

/**
 * Individual tools the model may call.
 */
export type LanguageModelV2FunctionTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    inputSchema: object; // JSON Schema
  };
};

/**
 * Tool choice controls which tools the model may use.
 */
export type LanguageModelV2ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; toolName: string };

// ─── Content parts ─────────────────────────────────────────────────────────────

/**
 * Union of all content part types that can appear in a prompt or response.
 */
export type LanguageModelV2Content =
  | LanguageModelV2TextPart
  | LanguageModelV2ToolCallPart
  | LanguageModelV2ToolResultPart
  | LanguageModelV2ReasoningPart
  | LanguageModelV2ImagePart
  | LanguageModelV2AudioPart
  | LanguageModelV2FilePart;

/** Text content part */
export interface LanguageModelV2TextPart {
  type: 'text';
  text: string;
}

/** Tool call part (model requests a tool) */
export interface LanguageModelV2ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Raw string representation of the args (for parsing) */
  rawArgs?: string;
}

/** Tool result part (user provides tool output) */
export interface LanguageModelV2ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  /** Text content of the tool result */
  content: LanguageModelV2Content[];
  /** Optional structured data from the tool */
  data?: unknown;
}

/** Reasoning content part (model's chain of thought) */
export interface LanguageModelV2ReasoningPart {
  type: 'reasoning';
  text: string;
  /** Optional signature for verification */
  signature?: string;
}

/** Image content part */
export interface LanguageModelV2ImagePart {
  type: 'image';
  image: string | Uint8Array;
  /** MIME type of the image data */
  mimeType?: string;
}

/** Audio content part */
export interface LanguageModelV2AudioPart {
  type: 'audio';
  audio: string | Uint8Array;
  /** MIME type of the audio data */
  mimeType?: string;
}

/** File content part */
export interface LanguageModelV2FilePart {
  type: 'file';
  data: string | Uint8Array;
  /** MIME type of the file data */
  mimeType?: string;
}

// ─── Generation result ─────────────────────────────────────────────────────────

/**
 * Result from a doGenerate() call.
 */
export interface LanguageModelV2GenerateResult {
  /** Generated content parts (text, tool-calls, etc.) */
  content: LanguageModelV2Content[];

  /** Why generation stopped */
  finishReason: LanguageModelV2FinishReason;

  /** Token usage statistics */
  usage: LanguageModelV2Usage;

  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;

  /** Request details that were sent */
  request?: {
    body?: unknown;
  };

  /** Response metadata */
  response?: LanguageModelV2ResponseMetadata;

  /** Warnings from the call (non-fatal) */
  warnings: LanguageModelV2CallWarning[];
}

/**
 * Reason why generation finished.
 */
export type LanguageModelV2FinishReason =
  | 'stop'           // Natural stop point
  | 'length'         // Max tokens reached
  | 'content-filter' // Content was filtered
  | 'tool-calls'     // Model requested tool calls
  | 'error'          // Error occurred
  | 'other'          // Other reason
  | 'unknown';       // Unknown

/**
 * Token usage statistics from generation.
 */
export interface LanguageModelV2Usage {
  /** Input tokens consumed (prompt) */
  inputTokens?: number;
  /** Output tokens generated */
  outputTokens?: number;
  /** Total tokens (input + output) */
  totalTokens?: number;
  /** Reasoning tokens (if the model used chain-of-thought) */
  reasoningTokens?: number;
  /** Cached input tokens (discounted/reused from cache) */
  cachedInputTokens?: number;
}

/**
 * Response metadata from the provider.
 */
export interface LanguageModelV2ResponseMetadata {
  /** Unique response identifier */
  id?: string;
  /** Model that generated the response */
  model?: string;
  /** Response timestamp */
  timestamp?: number;
  /** HTTP response headers */
  headers?: Record<string, string>;
}

/**
 * A non-fatal warning from the call.
 */
export interface LanguageModelV2CallWarning {
  /** Warning code */
  code: string;
  /** Warning message */
  message: string;
}

// ─── Streaming ─────────────────────────────────────────────────────────────────

/**
 * Result from a doStream() call.
 */
export interface LanguageModelV2StreamResult {
  /** Readable stream of response parts */
  stream: ReadableStream<LanguageModelV2StreamPart>;
  /** Request details */
  request?: { body?: unknown };
  /** Response metadata */
  response?: { headers?: Record<string, string> };
}

/**
 * A single part emitted by the streaming response.
 */
export type LanguageModelV2StreamPart =
  // Metadata
  | { type: 'stream-start'; timestamp: number }
  | { type: 'response-metadata'; id?: string; model?: string; timestamp: number }
  | { type: 'finish'; finishReason: LanguageModelV2FinishReason; usage: LanguageModelV2Usage; providerMetadata?: Record<string, unknown>; timestamp: number }
  | { type: 'error'; error: unknown; timestamp: number }
  // Text streaming
  | { type: 'text-start'; timestamp: number }
  | { type: 'text-delta'; textDelta: string; timestamp: number }
  | { type: 'text-end'; timestamp: number }
  // Reasoning streaming
  | { type: 'reasoning-start'; timestamp: number }
  | { type: 'reasoning-delta'; reasoningDelta: string; timestamp: number }
  | { type: 'reasoning-end'; timestamp: number }
  // Tool streaming
  | { type: 'tool-input-start'; toolCallId: string; toolName: string; timestamp: number }
  | { type: 'tool-input-delta'; toolCallId: string; toolName: string; argsTextDelta: string; timestamp: number }
  | { type: 'tool-input-end'; toolCallId: string; toolName: string; args: Record<string, unknown>; timestamp: number };

// ─── Adapter factory ───────────────────────────────────────────────────────────

/**
 * Options for creating a new LangAdapter instance.
 */
export interface LangAdapterOptions {
  /** Model ID exposed to SDK callers (default: 'lzero') */
  modelId?: string;
  /** Provider name for SDK metadata (default: 'onasis') */
  provider?: string;
  /** Router use-case lane (default: 'dashboard-assistant') */
  useCase?: string;
  /** Override max tokens (falls through to lane default) */
  maxTokens?: number;
  /** Override temperature */
  temperature?: number;
  /** Memory service base URL */
  apiBaseUrl?: string;
  /** Auth gateway URL */
  authGatewayUrl?: string;
  /** Path to prompt model files */
  promptsRoot?: string;
}

/**
 * Factory function to create a LangAdapter instance.
 */
export type LangAdapterFactory = (options?: LangAdapterOptions) => LangAdapter;

/**
 * A LangAdapter instance that implements LanguageModelV2 and wraps
 * the Onasis AI router's vendor chain.
 */
export interface LangAdapter extends LanguageModelV2 {
  /** Resolve the vendor chain for the configured use-case */
  _resolveVendorChain(): Array<{ _vendorId: string; _model: string; _adapter: object }>;
  /** Check if at least one active vendor is available */
  hasAvailableVendors(): boolean;
}
