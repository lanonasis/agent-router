/**
 * Client for the agent-playground backend function (Lovable AI).
 *
 * The operator credential is the same one the dashboard uses for the router
 * (Settings API key, else the signed-in session token). The function checks
 * it with the Onasis auth gateway before spending any AI credits.
 */
import { routerAuthHeaders, type RouterSettings } from '@/lib/routerSettings';
import type { ApprovalLevel } from '@/data/toolRegistry';

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const FN_URL = BASE ? `${BASE.replace(/\/+$/, '')}/functions/v1/agent-playground` : null;

export interface PlaygroundModel {
  id: string;
  label: string;
  api: 'responses' | 'chat';
  note?: string;
  default?: boolean;
}

export interface PlaygroundRequest {
  model: string;
  instructions: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools: { name: string; description: string; approval: ApprovalLevel; parameters: Record<string, unknown> }[];
  simulateTools: boolean;
  reasoningEffort: 'low' | 'medium' | 'high';
}

export type PlaygroundEvent =
  | { type: 'start'; model: string }
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown; approval: ApprovalLevel | null }
  | { type: 'tool-result'; id: string; name: string; output: unknown }
  | { type: 'step'; finishReason: string | null }
  | {
      type: 'finish';
      finishReason: string | null;
      steps: number;
      usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null } | null;
    }
  | { type: 'error'; status: number | null; message: string };

export class PlaygroundError extends Error {
  constructor(public status: number | null, message: string, public code?: string) {
    super(message);
  }
}

function headers(settings: RouterSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PUBLISHABLE_KEY) h.apikey = PUBLISHABLE_KEY;
  const cred = routerAuthHeaders(settings);
  if (cred['X-API-Key']) h['x-api-key'] = cred['X-API-Key'];
  else if (cred.Authorization) h['x-operator-token'] = cred.Authorization.replace(/^Bearer\s+/i, '');
  return h;
}

export async function fetchPlaygroundModels(): Promise<PlaygroundModel[]> {
  if (!FN_URL) throw new PlaygroundError(null, 'The playground backend is not configured.');
  const res = await fetch(FN_URL, { headers: PUBLISHABLE_KEY ? { apikey: PUBLISHABLE_KEY } : {} });
  if (!res.ok) throw new PlaygroundError(res.status, `Model list unavailable (HTTP ${res.status}).`);
  const data = await res.json();
  return Array.isArray(data?.models) ? data.models : [];
}

/** Streams events until the turn ends. Resolves on finish/error; rejects only on transport or HTTP errors. */
export async function streamPlayground(
  settings: RouterSettings,
  body: PlaygroundRequest,
  onEvent: (e: PlaygroundEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!FN_URL) throw new PlaygroundError(null, 'The playground backend is not configured.');
  let res: Response;
  try {
    res = await fetch(FN_URL, { method: 'POST', headers: headers(settings), body: JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new PlaygroundError(null, 'The playground backend could not be reached.');
  }
  if (!res.ok || !res.body) {
    let message = `Request failed (HTTP ${res.status}).`;
    let code: string | undefined;
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
      code = data?.error?.code;
    } catch {
      /* keep the generic message */
    }
    throw new PlaygroundError(res.status, message, code);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as PlaygroundEvent);
      } catch {
        /* skip a malformed line */
      }
    }
  }
}
