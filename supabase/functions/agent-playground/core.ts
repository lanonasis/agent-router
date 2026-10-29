// Agent Playground core: one streamed Lovable AI call for a persona, a model
// and a tool set, emitted as NDJSON events the dashboard renders live.
//
// Kept separate from index.ts (HTTP, CORS, operator auth) so the model call
// can be exercised on its own.

import { createOpenAI } from "npm:@ai-sdk/openai@4";
import {
  APICallError,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type ToolSet,
} from "npm:ai@7";
import { createLovableAiGatewayProvider } from "../_shared/gateway-helpers.ts";
import { createLovableAiGatewayRunIdFetch } from "../_shared/run-id.ts";

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

/** Models the playground may call. `api` decides the gateway endpoint. */
export const PLAYGROUND_MODELS = [
  { id: "openai/gpt-6-astra", label: "GPT-6 Astra", api: "responses", note: "most capable", default: true },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", api: "responses", note: "near-Astra, faster" },
  { id: "openai/gpt-6-sol", label: "GPT-6 Sol", api: "responses", note: "mid-tier" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", api: "responses", note: "low cost" },
  { id: "google/gemini-4-argon", label: "Gemini 4 Argon", api: "chat", note: "frontier Gemini" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", api: "chat", note: "fast" },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", api: "chat", note: "cheapest" },
] as const;

export type PlaygroundModelId = (typeof PLAYGROUND_MODELS)[number]["id"];
export type Approval = "auto" | "notify" | "approve" | "critical";
export type Effort = "low" | "medium" | "high";

export interface PlaygroundTool {
  name: string;
  description: string;
  approval: Approval;
  parameters: Record<string, unknown>;
}

export interface PlaygroundInput {
  model: PlaygroundModelId;
  instructions: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools: PlaygroundTool[];
  simulateTools: boolean;
  reasoningEffort: Effort;
}

export type PlaygroundEvent =
  | { type: "start"; model: string }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; input: unknown; approval: Approval | null }
  | { type: "tool-result"; id: string; name: string; output: unknown }
  | { type: "step"; finishReason: string | null }
  | { type: "finish"; finishReason: string | null; usage: Usage | null; steps: number }
  | { type: "error"; status: number | null; message: string };

interface Usage { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null }

// ── Tool schemas ─────────────────────────────────────────────────────────
// tools.md schemas use optional fields and defaults. Responses runs tools in
// strict mode, so every property becomes required, optional ones nullable,
// defaults are dropped and objects are closed.

type Json = Record<string, unknown>;

function nullable(s: Json): Json {
  const t = s.type;
  const out: Json = { ...s };
  if (typeof t === "string") out.type = [t, "null"];
  else if (Array.isArray(t)) out.type = t.includes("null") ? t : [...t, "null"];
  else return { anyOf: [s, { type: "null" }] };
  if (Array.isArray(s.enum) && !s.enum.includes(null)) out.enum = [...s.enum, null];
  return out;
}

export function toStrictSchema(schema: unknown): Json {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {}, required: [], additionalProperties: false };
  const { default: _drop, ...rest } = schema as Json;
  if (rest.type === "object" || rest.properties) {
    const props = (rest.properties as Record<string, unknown>) ?? {};
    const required = new Set(Array.isArray(rest.required) ? (rest.required as string[]) : []);
    const properties: Json = {};
    for (const [key, value] of Object.entries(props)) {
      const strict = toStrictSchema(value);
      properties[key] = required.has(key) ? strict : nullable(strict);
    }
    return { ...rest, type: "object", properties, required: Object.keys(props), additionalProperties: false };
  }
  if (rest.type === "array" && rest.items) return { ...rest, items: toStrictSchema(rest.items) };
  return rest;
}

// Simulated results honour tools.md approval levels: auto/notify "run",
// approve/critical stop at the approval gate — so the operator can see
// whether the persona respects the contract.
export function simulatedResult(t: PlaygroundTool) {
  if (t.approval === "approve" || t.approval === "critical") {
    return {
      status: "approval_required",
      approval: t.approval,
      note: `Playground: ${t.name} needs ${t.approval === "critical" ? "explicit typed confirmation" : "operator approval"} before it can run. It was not executed. Present your plan and wait.`,
    };
  }
  return {
    status: "simulated",
    approval: t.approval,
    note: `Playground: ${t.name} was not executed and returned no real data. Do not invent its output — say what you would do with the result.`,
  };
}

function buildTools(tools: PlaygroundTool[], simulate: boolean): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    const description = `${t.description} [approval: ${t.approval}]`;
    const inputSchema = jsonSchema(toStrictSchema(t.parameters));
    set[t.name] = simulate
      ? tool({ description, inputSchema, execute: async () => simulatedResult(t) })
      : tool({ description, inputSchema });
  }
  return set;
}

// ── Errors ───────────────────────────────────────────────────────────────

export function describeError(error: unknown): { status: number | null; message: string } {
  if (error && typeof error === "object" && (error as { name?: string }).name === "AbortError") {
    return { status: 499, message: "Stopped." };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? null;
    let upstream: string | null = null;
    try {
      const body = JSON.parse(error.responseBody ?? "");
      upstream = body?.error?.message ?? body?.message ?? null;
    } catch { /* not JSON */ }
    if (status === 402) return { status, message: upstream ?? "Lovable AI credits are used up. Add credits in Settings → Plans & credits." };
    if (status === 429) return { status, message: upstream ?? "Lovable AI is rate limiting requests. Wait a moment and send again." };
    return { status, message: upstream ?? error.message };
  }
  return { status: null, message: error instanceof Error ? error.message : String(error) };
}

// ── The call ─────────────────────────────────────────────────────────────

export function runPlayground(
  input: PlaygroundInput,
  opts: { apiKey: string; signal?: AbortSignal; runId?: string },
) {
  const meta = PLAYGROUND_MODELS.find((m) => m.id === input.model)!;
  const approvals = new Map(input.tools.map((t) => [t.name, t.approval]));
  const messages: ModelMessage[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  const tools = input.tools.length ? buildTools(input.tools, input.simulateTools) : undefined;
  const stopWhen = stepCountIs(input.simulateTools ? 5 : 1);

  let gateway: { getRunId: () => string | undefined; waitForRunId: () => Promise<string | undefined> };
  let result;

  if (meta.api === "responses") {
    const runIdFetch = createLovableAiGatewayRunIdFetch(opts.runId);
    gateway = runIdFetch;
    const provider = createOpenAI({
      baseURL: GATEWAY_URL,
      apiKey: opts.apiKey,
      headers: { "Lovable-API-Key": opts.apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch,
    });
    result = streamText({
      model: provider.responses(input.model),
      instructions: input.instructions,
      messages,
      tools,
      stopWhen,
      abortSignal: opts.signal,
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: input.reasoningEffort,
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
  } else {
    const provider = createLovableAiGatewayProvider(opts.apiKey, opts.runId, { baseURL: GATEWAY_URL });
    gateway = provider;
    result = streamText({
      model: provider(input.model),
      instructions: input.instructions,
      messages,
      tools,
      stopWhen,
      abortSignal: opts.signal,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: PlaygroundEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      let steps = 0;
      let failed = false;
      send({ type: "start", model: input.model });
      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "reasoning-delta":
              if (part.text) send({ type: "reasoning", text: part.text });
              break;
            case "text-delta":
              if (part.text) send({ type: "text", text: part.text });
              break;
            case "tool-call":
              send({ type: "tool-call", id: part.toolCallId, name: part.toolName, input: part.input, approval: approvals.get(part.toolName) ?? null });
              break;
            case "tool-result":
              send({ type: "tool-result", id: part.toolCallId, name: part.toolName, output: part.output });
              break;
            case "tool-error":
              send({ type: "tool-result", id: part.toolCallId, name: part.toolName, output: { status: "error", error: String(part.error) } });
              break;
            case "finish-step":
              steps += 1;
              send({ type: "step", finishReason: part.finishReason ?? null });
              break;
            case "finish": {
              const u = part.totalUsage;
              send({
                type: "finish",
                finishReason: part.finishReason ?? null,
                steps,
                usage: u
                  ? {
                      inputTokens: u.inputTokens ?? null,
                      outputTokens: u.outputTokens ?? null,
                      reasoningTokens: u.outputTokenDetails?.reasoningTokens ?? (u as { reasoningTokens?: number }).reasoningTokens ?? null,
                    }
                  : null,
              });
              break;
            }
            case "error":
              failed = true;
              send({ type: "error", ...describeError(part.error) });
              break;
            case "abort":
              failed = true;
              send({ type: "error", status: 499, message: "Stopped." });
              break;
          }
        }
      } catch (error) {
        if (!failed) send({ type: "error", ...describeError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return { stream, gateway: gateway! };
}
