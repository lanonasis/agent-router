import { routerAuthHeaders, hasRouterCredential, type RouterSettings } from "@/lib/routerSettings";

export type CheckState = "pass" | "warn" | "fail" | "skip";

export interface DiagnosticCheck {
  id: "url" | "network" | "cors" | "health" | "auth" | "activity";
  label: string;
  state: CheckState;
  detail: string;
  /** What the operator should do, when something is wrong. */
  fix?: string;
  latencyMs?: number;
}

const TIMEOUT_MS = 6000;

async function timedFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

/**
 * Walks the same path the dashboard uses, one layer at a time, so a failure
 * says WHICH layer broke: address → network → browser (CORS) → health → auth → activity feed.
 */
export async function runRouterDiagnostics(settings: RouterSettings): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  const origin = window.location.origin;

  // 1. Address
  let parsed: URL | null = null;
  try {
    parsed = new URL(settings.url);
  } catch {
    /* handled below */
  }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    checks.push({ id: "url", label: "Router address", state: "fail", detail: `"${settings.url}" is not a valid http(s) address.`, fix: "Use a full address such as https://ai.vortexcore.app" });
    return checks;
  }
  const mixed = window.location.protocol === "https:" && parsed.protocol === "http:" && !isLocalHost(parsed.hostname);
  if (mixed) {
    checks.push({ id: "url", label: "Router address", state: "fail", detail: "This page is served over https but the router address is http — browsers block that.", fix: "Use the router's https address." });
    return checks;
  }
  const localFromRemote = isLocalHost(parsed.hostname) && !isLocalHost(window.location.hostname);
  checks.push({
    id: "url",
    label: "Router address",
    state: localFromRemote ? "warn" : "pass",
    detail: localFromRemote
      ? `${parsed.host} points at the viewer's own machine, not your server.`
      : parsed.origin,
    fix: localFromRemote ? "Set the public router address (for example https://ai.vortexcore.app)." : undefined,
  });

  const base = parsed.origin + parsed.pathname.replace(/\/+$/, "");

  // 2 + 3. Network reachability and browser access (CORS)
  let healthRes: Response | null = null;
  let healthMs: number | undefined;
  try {
    const { res, ms } = await timedFetch(`${base}/health`, { headers: { Accept: "application/json" } });
    healthRes = res;
    healthMs = ms;
    checks.push({ id: "network", label: "Network reachability", state: "pass", detail: `Answered in ${ms} ms`, latencyMs: ms });
    checks.push({ id: "cors", label: "Browser access (CORS)", state: "pass", detail: `${origin} is allowed.` });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    // A no-cors probe can't read the body, but it does tell "server answered" from "nothing there".
    let answeredOpaque = false;
    if (!aborted) {
      try {
        await timedFetch(`${base}/health`, { mode: "no-cors" });
        answeredOpaque = true;
      } catch {
        answeredOpaque = false;
      }
    }
    if (answeredOpaque) {
      checks.push({ id: "network", label: "Network reachability", state: "pass", detail: "The server answered." });
      checks.push({
        id: "cors",
        label: "Browser access (CORS)",
        state: "fail",
        detail: `The router answered but did not allow this page's address (${origin}).`,
        fix: `Add ${origin} to CORS_ALLOWED_ORIGINS on the router, then restart it.`,
      });
    } else {
      checks.push({
        id: "network",
        label: "Network reachability",
        state: "fail",
        detail: aborted ? `No answer within ${TIMEOUT_MS / 1000}s.` : "Nothing answered at this address (DNS, TLS or the service is down).",
        fix: "Check the address, the nginx site and that onasis-ai-router.service is running.",
      });
      checks.push({ id: "cors", label: "Browser access (CORS)", state: "skip", detail: "Needs the network check to pass first." });
    }
    for (const [id, label] of [["health", "Router health"], ["auth", "Signed-in access"], ["activity", "Activity feed"]] as const) {
      checks.push({ id, label, state: "skip", detail: "Needs browser access first." });
    }
    return checks;
  }

  // 4. Health payload
  try {
    const data = await healthRes.json();
    const vendors = data?.vendors_healthy ?? "?";
    const state: CheckState = data?.status === "healthy" ? "pass" : data?.status === "degraded" ? "warn" : "fail";
    checks.push({
      id: "health",
      label: "Router health",
      state,
      detail: `${data?.status ?? `HTTP ${healthRes.status}`} · vendors ${vendors}`,
      latencyMs: healthMs,
      fix: state === "fail" ? "No vendor can answer — check vendor credits/keys on the router." : undefined,
    });
  } catch {
    checks.push({ id: "health", label: "Router health", state: "fail", detail: `HTTP ${healthRes.status} with an unreadable body — this may not be the router.` });
  }

  // 5. Authenticated access
  const cred = hasRouterCredential(settings);
  if (!cred) {
    checks.push({ id: "auth", label: "Signed-in access", state: "skip", detail: "No API key set and no signed-in session token.", fix: "Add a router API key below to read the activity feed." });
    checks.push({ id: "activity", label: "Activity feed", state: "skip", detail: "Needs a credential." });
    return checks;
  }
  try {
    const { res, ms } = await timedFetch(`${base}/ai-health`, { headers: { Accept: "application/json", ...routerAuthHeaders(settings) } });
    if (res.ok) {
      checks.push({ id: "auth", label: "Signed-in access", state: "pass", detail: `Accepted (${cred === "api-key" ? "API key" : "session token"}) in ${ms} ms` });
    } else if (res.status === 401 || res.status === 403) {
      checks.push({ id: "auth", label: "Signed-in access", state: "fail", detail: `Credential rejected (HTTP ${res.status}).`, fix: "Check the API key, or sign in again." });
      checks.push({ id: "activity", label: "Activity feed", state: "skip", detail: "Needs an accepted credential." });
      return checks;
    } else {
      checks.push({ id: "auth", label: "Signed-in access", state: "warn", detail: `HTTP ${res.status} — the auth service may be slow or down.` });
    }
  } catch {
    checks.push({ id: "auth", label: "Signed-in access", state: "fail", detail: "Blocked by the browser — the router must allow the X-API-Key / Authorization headers from this address." });
    checks.push({ id: "activity", label: "Activity feed", state: "skip", detail: "Needs signed-in access." });
    return checks;
  }

  // 6. Activity endpoint
  try {
    const { res } = await timedFetch(`${base}/api/v1/ops/activity?limit=1`, { headers: { Accept: "application/json", ...routerAuthHeaders(settings) } });
    if (res.ok) {
      const data = await res.json();
      checks.push({ id: "activity", label: "Activity feed", state: "pass", detail: `Available · scope: ${data?.scope ?? "organization"} · ${data?.stats?.buffered ?? 0} requests buffered` });
    } else if (res.status === 404) {
      checks.push({ id: "activity", label: "Activity feed", state: "warn", detail: "The router doesn't have the activity feed yet.", fix: "Deploy the latest router code and restart onasis-ai-router.service." });
    } else {
      checks.push({ id: "activity", label: "Activity feed", state: "warn", detail: `HTTP ${res.status}` });
    }
  } catch {
    checks.push({ id: "activity", label: "Activity feed", state: "fail", detail: "Request blocked or failed." });
  }

  return checks;
}
