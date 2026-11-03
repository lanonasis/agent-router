import { useSyncExternalStore } from "react";
import { AUTH_TOKEN_KEY } from "@/contexts/AuthContext";

/**
 * Operator-configured connection to the AI router, kept in this browser only.
 * Build-time `VITE_ROUTER_URL` is the default until an operator overrides it.
 *
 * SECRET HANDLING — the router URL (not a secret) still lives in `localStorage`
 * so a deployment is remembered across restarts. The `lano_` API key does NOT:
 * it is stored in `sessionStorage`, so it dies with the browser session instead
 * of persisting indefinitely in a public origin's `localStorage`, where it would
 * be readable by any script on the origin. This shrinks the credential's
 * exfiltration window but is only a conservative first step — the key is still
 * present in the browser. The COMPLETE fix is a server-side proxy that keeps the
 * credential off the browser entirely, exactly as
 * `supabase/functions/agent-playground` already does (key server-side, caller
 * verified against the auth gateway). That proxy remains a follow-up.
 */
const URL_KEY = "onasis.router.url";
/**
 * sessionStorage home for the `lano_` API key. The same key name is reused for
 * the legacy `localStorage` entry so an upgrade can migrate and delete it.
 */
const API_KEY_KEY = "onasis.router.apiKey";
const CHANGE_EVENT = "onasis:router-settings";

export const BUILD_ROUTER_URL: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ROUTER_URL) || "http://localhost:8000";

export interface RouterSettings {
  url: string;
  /** Optional lano_ API key used for authenticated router endpoints. */
  apiKey: string;
  /** True when the URL comes from this browser rather than the build. */
  isOverride: boolean;
}

export function normaliseRouterUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

let cached: RouterSettings | null = null;

function read(): RouterSettings {
  if (cached) return cached;
  let stored = "";
  let apiKey = "";
  let legacy: string | null = null;
  // Each store is read in its own try so one failing (unavailable/quota) can
  // never block the others or the legacy cleanup below.
  try {
    stored = localStorage.getItem(URL_KEY) ?? "";
  } catch {
    /* storage unavailable */
  }
  try {
    legacy = localStorage.getItem(API_KEY_KEY);
  } catch {
    /* storage unavailable */
  }
  try {
    apiKey = sessionStorage.getItem(API_KEY_KEY) ?? "";
    if (!apiKey && legacy) {
      // One-shot upgrade migration: when no session copy exists yet, pull the
      // legacy localStorage copy into sessionStorage (the persistent copy is
      // deleted unconditionally below).
      apiKey = legacy;
      sessionStorage.setItem(API_KEY_KEY, legacy);
    }
  } catch {
    /* storage unavailable */
  }
  // Always drop the persistent copy when a legacy value was found — even if
  // sessionStorage already held a key or the migration write above threw.
  if (legacy) {
    try {
      localStorage.removeItem(API_KEY_KEY);
    } catch {
      /* storage unavailable */
    }
  }
  cached = {
    url: normaliseRouterUrl(stored || BUILD_ROUTER_URL),
    apiKey,
    isOverride: !!stored,
  };
  return cached;
}

export function getRouterSettings(): RouterSettings {
  return read();
}

export function saveRouterSettings(next: { url?: string; apiKey?: string }) {
  try {
    if (next.url !== undefined) {
      const url = normaliseRouterUrl(next.url);
      if (url && url !== normaliseRouterUrl(BUILD_ROUTER_URL)) localStorage.setItem(URL_KEY, url);
      else localStorage.removeItem(URL_KEY);
    }
    if (next.apiKey !== undefined) {
      // Remove the persistent copy FIRST, in its own try: if sessionStorage
      // throws (unavailable/quota) this step must still run.
      try {
        localStorage.removeItem(API_KEY_KEY);
      } catch {
        /* storage unavailable */
      }
      if (next.apiKey.trim()) sessionStorage.setItem(API_KEY_KEY, next.apiKey.trim());
      else sessionStorage.removeItem(API_KEY_KEY);
    }
  } catch {
    /* storage unavailable */
  }
  cached = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetRouterSettings() {
  saveRouterSettings({ url: "", apiKey: "" });
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    // Only the URL override is shared across tabs. The API key now lives in
    // sessionStorage, which is per-tab, so a credential entered in one tab is
    // deliberately NOT picked up by another — cross-tab credential sharing is
    // the trade-off we accept to keep the key out of persistent localStorage.
    if (e.key === URL_KEY) {
      cached = null;
      cb();
    }
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRouterSettings(): RouterSettings {
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Headers for authenticated router calls: the configured API key wins,
 * otherwise the signed-in session token (read only — sign-in is untouched).
 */
export function routerAuthHeaders(settings: RouterSettings = read()): Record<string, string> {
  if (settings.apiKey) return { "X-API-Key": settings.apiKey };
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    /* storage unavailable */
  }
  return {};
}

export function hasRouterCredential(settings: RouterSettings = read()): "api-key" | "session" | null {
  if (settings.apiKey) return "api-key";
  try {
    if (localStorage.getItem(AUTH_TOKEN_KEY)) return "session";
  } catch {
    /* storage unavailable */
  }
  return null;
}
