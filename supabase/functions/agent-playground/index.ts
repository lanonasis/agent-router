// Agent Playground — operators send a test prompt for a persona, a model and
// a tool set; Lovable AI answers and every tool call is streamed back.
//
// GET  → the model list (not sensitive, no credential needed).
// POST → NDJSON event stream. Requires an Onasis credential (the same API key
//        or session token the dashboard uses for the router), verified against
//        the auth gateway, so Lovable AI credits are never spent anonymously.

import {
  PLAYGROUND_MODELS,
  runPlayground,
  type Approval,
  type Effort,
  type PlaygroundInput,
  type PlaygroundTool,
} from "./core.ts";
import { getLovableAiGatewayRunId, withLovableAiGatewayRunIdHeader } from "../_shared/run-id.ts";

const AUTH_GATEWAY_URL = (Deno.env.get("ONASIS_AUTH_GATEWAY_URL") ?? "https://auth.lanonasis.com").replace(/\/+$/, "");
const AUTH_TIMEOUT_MS = 15000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-operator-token, x-lovable-aig-run-id",
  "Access-Control-Expose-Headers": "X-Lovable-AIG-Run-ID",
};

const LIMITS = { instructions: 60000, messages: 40, messageChars: 12000, tools: 24, schemaChars: 8000 };
const APPROVALS: Approval[] = ["auto", "notify", "approve", "critical"];
const EFFORTS: Effort[] = ["low", "medium", "high"];
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class InputError extends Error {}

function parseInput(body: unknown): PlaygroundInput {
  if (!body || typeof body !== "object") throw new InputError("Body must be a JSON object.");
  const b = body as Record<string, unknown>;

  const model = PLAYGROUND_MODELS.find((m) => m.id === b.model);
  if (!model) throw new InputError("Unknown model.");

  const instructions = typeof b.instructions === "string" ? b.instructions.trim() : "";
  if (!instructions) throw new InputError("A persona prompt is required.");
  if (instructions.length > LIMITS.instructions) throw new InputError("Persona prompt is too long.");

  if (!Array.isArray(b.messages) || b.messages.length === 0) throw new InputError("Send at least one message.");
  if (b.messages.length > LIMITS.messages) throw new InputError(`Keep the conversation under ${LIMITS.messages} messages — clear it and start again.`);
  const messages = b.messages.map((m) => {
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") throw new InputError("Invalid message.");
    if (content.length > LIMITS.messageChars) throw new InputError("A message is too long.");
    return { role, content } as const;
  });
  if (messages[messages.length - 1].role !== "user") throw new InputError("The last message must be from the operator.");

  const rawTools = Array.isArray(b.tools) ? b.tools : [];
  if (rawTools.length > LIMITS.tools) throw new InputError("Too many tools selected.");
  const tools: PlaygroundTool[] = rawTools.map((t) => {
    const r = t as Record<string, unknown>;
    if (typeof r.name !== "string" || !TOOL_NAME.test(r.name)) throw new InputError("Invalid tool name.");
    const approval = APPROVALS.includes(r.approval as Approval) ? (r.approval as Approval) : "approve";
    const parameters = r.parameters && typeof r.parameters === "object" ? (r.parameters as Record<string, unknown>) : {};
    if (JSON.stringify(parameters).length > LIMITS.schemaChars) throw new InputError(`Schema for ${r.name} is too large.`);
    return { name: r.name, description: String(r.description ?? "").slice(0, 600), approval, parameters };
  });

  return {
    model: model.id,
    instructions,
    messages,
    tools,
    simulateTools: b.simulateTools !== false,
    reasoningEffort: EFFORTS.includes(b.reasoningEffort as Effort) ? (b.reasoningEffort as Effort) : "low",
  };
}

/** Same check the router uses: the auth gateway judges the credential. Fails closed. */
async function verifyOperator(req: Request): Promise<Response | null> {
  const apiKey = req.headers.get("x-api-key")?.trim();
  const token = req.headers.get("x-operator-token")?.trim();
  if (!apiKey && !token) {
    return json(401, { error: { code: "NO_CREDENTIAL", message: "Add an Onasis API key in Settings (or sign in) to use the playground." } });
  }
  let res: Response;
  try {
    res = await fetch(`${AUTH_GATEWAY_URL}/v1/auth/resolve`, {
      headers: {
        ...(apiKey ? { "X-API-Key": apiKey } : { Authorization: `Bearer ${token}` }),
        "User-Agent": "Onasis-Agent-Haven-Playground/1.0",
      },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return json(503, { error: { code: "AUTH_UNAVAILABLE", message: "The Onasis auth gateway could not be reached to check your credential. Try again shortly." } });
  }
  if (res.status >= 500) {
    return json(503, { error: { code: "AUTH_UNAVAILABLE", message: "The Onasis auth gateway failed to check your credential. Try again shortly." } });
  }
  if (!res.ok) {
    return json(401, { error: { code: "AUTH_REJECTED", message: "The Onasis auth gateway rejected this credential." } });
  }

  // Optional allow-list: PLAYGROUND_ORG_IDS="org-a,org-b" limits spend to operator orgs.
  const allowed = (Deno.env.get("PLAYGROUND_ORG_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length) {
    let org: string | null = res.headers.get("x-uai-organization");
    try {
      const data = await res.json();
      org = data?.organizationId ?? org;
    } catch { /* header fallback */ }
    if (!org || !allowed.includes(org)) {
      return json(403, { error: { code: "ORG_NOT_ALLOWED", message: "Your organisation isn't allowed to use the playground." } });
    }
  } else {
    await res.body?.cancel();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return json(200, { models: PLAYGROUND_MODELS });
  }
  if (req.method !== "POST") return json(405, { error: { code: "METHOD", message: "Use POST." } });

  const denied = await verifyOperator(req);
  if (denied) return denied;

  let input: PlaygroundInput;
  try {
    input = parseInput(await req.json());
  } catch (error) {
    const message = error instanceof InputError ? error.message : "Body must be valid JSON.";
    return json(400, { error: { code: "BAD_REQUEST", message } });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json(500, { error: { code: "NOT_CONFIGURED", message: "Lovable AI is not configured for this project." } });

  const { stream, gateway } = runPlayground(input, {
    apiKey,
    signal: req.signal,
    runId: getLovableAiGatewayRunId(req),
  });

  return withLovableAiGatewayRunIdHeader(
    new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } }),
    gateway,
    corsHeaders,
    { waitForUpstreamHeaders: false },
  );
});
