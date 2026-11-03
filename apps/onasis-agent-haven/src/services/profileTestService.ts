/**
 * Calls the router chat endpoint for the profile test console and the
 * "Refine with AI" helper, and loads the live catalog for the builder.
 *
 *   POST {routerUrl}/api/v1/ai-chat   { use_case, messages: [{role:'user', content}] }
 *
 * The answer is `data.response`. Callers must never send a `system` message
 * (the router answers 400), so only a single user message is built here.
 * The credential comes from routerAuthHeaders() and is never logged, stored in
 * a run record, or returned from this module.
 */
import { useEffect, useState } from "react";
import { routerAuthHeaders, type RouterSettings } from "@/lib/routerSettings";
import { fetchRouterCatalog, RouterCatalogError, type RouterCatalog } from "@/services/routerCatalog";

export type RunErrorKind = "no-credential" | "unauthorized" | "bad-request" | "unavailable" | "http" | "network" | "bad-response";

export interface ChatRunResult {
  ok: boolean;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  answer: string;
  /** Human-readable explanation when !ok. */
  error: string | null;
  errorKind: RunErrorKind | null;
  /** Measured in the browser, request start to body parsed. */
  clientMs: number;
  /** `onasis_metadata.processing_time` as the router reported it. */
  serverTime: string | null;
  /** `onasis_metadata.use_case` the router actually served. */
  servedUseCase: string | null;
}

export interface ChatRun extends ChatRunResult {
  id: string;
  at: number;
  requestedUseCase: string;
  prompt: string;
  profileHeaderSent: string | null;
}

export interface ChatRequest {
  useCase: string;
  prompt: string;
  /** When set, sent as `X-Onasis-Profile`. The router only honours it with an entitlement. */
  profileId?: string | null;
}

function errorMessageFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const e = d.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as Record<string, unknown>).message === "string") return (e as Record<string, string>).message;
  if (typeof d.message === "string") return d.message;
  return null;
}

export async function sendRouterChat(settings: RouterSettings, req: ChatRequest, signal?: AbortSignal): Promise<ChatRunResult> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...routerAuthHeaders(settings),
  };
  if (req.profileId) headers["X-Onasis-Profile"] = req.profileId;

  const started = performance.now();
  const base = { answer: "", serverTime: null, servedUseCase: null } as const;
  let res: Response;
  try {
    res = await fetch(`${settings.url}/api/v1/ai-chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ use_case: req.useCase, messages: [{ role: "user", content: req.prompt }] }),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return {
      ...base,
      ok: false,
      status: null,
      errorKind: "network",
      error: `Could not reach the router at ${settings.url}. Check that it is running and that its CORS settings allow this origin.`,
      clientMs: Math.round(performance.now() - started),
    };
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  const clientMs = Math.round(performance.now() - started);
  const meta = (data && typeof data === "object" ? (data as Record<string, unknown>).onasis_metadata : null) as Record<string, unknown> | null;
  const serverTime = meta && meta.processing_time !== undefined && meta.processing_time !== null ? String(meta.processing_time) : null;
  const servedUseCase = meta && typeof meta.use_case === "string" ? meta.use_case : null;
  const common = { status: res.status, clientMs, serverTime, servedUseCase };

  if (res.ok) {
    const response = data && typeof data === "object" ? (data as Record<string, unknown>).response : undefined;
    if (typeof response === "string") return { ...common, ok: true, answer: response, error: null, errorKind: null };
    return { ...common, ok: false, answer: "", errorKind: "bad-response", error: "The router answered 200 but the body had no `response` text." };
  }

  const serverMsg = errorMessageFrom(data);
  if (res.status === 401 || res.status === 403) {
    return {
      ...common,
      ok: false,
      answer: "",
      errorKind: "unauthorized",
      error: `The router rejected the credential (HTTP ${res.status}). Add an API key in Settings.${serverMsg ? ` Router said: ${serverMsg}` : ""}`,
    };
  }
  if (res.status === 400) {
    return { ...common, ok: false, answer: "", errorKind: "bad-request", error: `The router refused the request (HTTP 400): ${serverMsg ?? "no message returned"}` };
  }
  if (res.status === 503) {
    return { ...common, ok: false, answer: "", errorKind: "unavailable", error: `All vendors for this lane are unavailable right now (HTTP 503).${serverMsg ? ` Router said: ${serverMsg}` : ""}` };
  }
  return { ...common, ok: false, answer: "", errorKind: "http", error: `Router answered HTTP ${res.status}.${serverMsg ? ` ${serverMsg}` : ""}` };
}

// ── catalog hook ─────────────────────────────────────────────────────────────

export type CatalogState =
  | { status: "loading"; catalog: null; note: null }
  | { status: "ready"; catalog: RouterCatalog; note: null }
  | { status: "fallback"; catalog: null; note: string };

/** Loads the live catalog; on 404/unreachable falls back so callers use the static use-case list. */
export function useRouterCatalog(settings: RouterSettings): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: "loading", catalog: null, note: null });
  const url = settings.url;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", catalog: null, note: null });
    fetchRouterCatalog({ ...settings, url })
      .then((catalog) => {
        if (!cancelled) setState({ status: "ready", catalog, note: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const note =
          err instanceof RouterCatalogError && err.kind === "not-deployed"
            ? "This router does not serve /api/v1/catalog yet; using the built-in use-case list."
            : "Could not load the live catalog; using the built-in use-case list.";
        setState({ status: "fallback", catalog: null, note });
      });
    return () => {
      cancelled = true;
    };
    // settings carries the credential; only the URL decides which catalog to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return state;
}
