import { useSyncExternalStore } from "react";
import { AUTH_TOKEN_KEY } from "@/contexts/AuthContext";

/**
 * Operator-configured connection to the AI router, kept in this browser only.
 * Build-time `VITE_ROUTER_URL` is the default until an operator overrides it.
 */
const URL_KEY = "onasis.router.url";
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
  try {
    stored = localStorage.getItem(URL_KEY) ?? "";
    apiKey = localStorage.getItem(API_KEY_KEY) ?? "";
  } catch {
    /* storage unavailable */
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
      if (next.apiKey.trim()) localStorage.setItem(API_KEY_KEY, next.apiKey.trim());
      else localStorage.removeItem(API_KEY_KEY);
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
    if (e.key === URL_KEY || e.key === API_KEY_KEY) {
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
