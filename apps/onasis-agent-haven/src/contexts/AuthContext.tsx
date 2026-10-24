import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

/**
 * Storage key for the JWT access token returned by POST /v1/auth/login.
 * The gateway also sets an httpOnly `lanonasis_session` cookie, which is used
 * for SSO/OAuth returns; the token is what lets us call Bearer-protected
 * endpoints (session lookup, logout) from a static bundle.
 */
export const AUTH_TOKEN_KEY = "lanonasis_access_token";

/**
 * Project scope presented to the auth gateway. This is the same default the
 * gateway's own /web/login page uses (see auth-gateway web.routes.ts).
 *
 * Override with VITE_PROJECT_SCOPE for per-deployment scoping.
 */
const PROJECT_SCOPE = import.meta.env.VITE_PROJECT_SCOPE || "app_agent_haven";

/**
 * Gateway origin for browser navigations (hosted login/signup and cookie
 * logout). Override with VITE_AUTH_GATEWAY_URL.
 */
export const AUTH_GATEWAY_ORIGIN = (
  (import.meta.env.VITE_AUTH_GATEWAY_URL as string | undefined) ||
  "https://auth.lanonasis.com"
).replace(/\/+$/, "");

/**
 * Base URL for auth-gateway API calls.
 *
 * Always call the gateway directly — the Vite dev proxy targets
 * localhost:4000 which is not the auth-gateway in any deployment.
 *
 * Override with VITE_AUTH_GATEWAY_URL for dev / local testing.
 * Production bundles call https://auth.lanonasis.com by default.
 * The gateway must list this app's origin in CORS_ORIGIN.
 */
const AUTH_API_BASE =
  import.meta.env.VITE_AUTH_GATEWAY_URL ||
  "https://auth.lanonasis.com";

export interface AuthUser {
  id?: string;
  email: string;
  role?: string;
}

interface AuthContextValue {
  isLoggedIn: boolean;
  isInitializing: boolean;
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  loading: boolean;
  clearError: () => void;
  signupUrl: string;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Normalise the shape returned by /v1/auth/login and /v1/auth/session. */
function normalizeUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email : "";
  if (!email) return null;

  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.sub === "string"
      ? record.sub
      : undefined;

  return {
    id,
    email,
    role: typeof record.role === "string" ? record.role : undefined,
  };
}

/**
 * Display-only fallback for the top bar. The gateway remains the authority on
 * whether a token is valid; this just avoids a blank identity when the session
 * endpoint is temporarily unreachable. The payload is NOT trusted for
 * authorisation decisions.
 */
function userFromToken(token: string): AuthUser {
  try {
    const segment = token.split(".")[1];
    if (!segment) return { email: "authenticated" };

    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;

    return {
      id: typeof payload.sub === "string" ? payload.sub : undefined,
      email:
        typeof payload.email === "string" ? payload.email : "authenticated",
      role: typeof payload.role === "string" ? payload.role : undefined,
    };
  } catch {
    return { email: "authenticated" };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const signupUrl = `${AUTH_GATEWAY_ORIGIN}/web/login?return_to=${encodeURIComponent(
    `${window.location.origin}/agents`
  )}`;

  // Restore a session on mount. Two sources:
  //   1. the access token in localStorage (password login in this app)
  //   2. the httpOnly session cookie (returns from the gateway's hosted
  //      login/signup or an OAuth flow)
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const stored = localStorage.getItem(AUTH_TOKEN_KEY);

      if (stored) {
        try {
          const res = await fetch(`${AUTH_API_BASE}/v1/auth/session`, {
            headers: { Authorization: `Bearer ${stored}` },
            credentials: "include",
          });

          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            setToken(stored);
            setUser(normalizeUser(data.user) ?? userFromToken(stored));
            return;
          }

          if (res.status === 401 || res.status === 403) {
            // Token was revoked or expired — drop it and try the cookie below.
            localStorage.removeItem(AUTH_TOKEN_KEY);
          } else {
            // Gateway is reachable but erroring; don't log the user out.
            if (cancelled) return;
            setToken(stored);
            setUser(userFromToken(stored));
            return;
          }
        } catch {
          // Network failure — same reasoning as a 5xx.
          if (cancelled) return;
          setToken(stored);
          setUser(userFromToken(stored));
          return;
        }
      }

      try {
        const res = await fetch(`${AUTH_API_BASE}/v1/auth/session/check`, {
          credentials: "include",
        });

        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.authenticated && data.user) {
            setUser(normalizeUser(data.user));
            return;
          }
        }
      } catch {
        // No cookie session (or gateway unreachable).
      }

      if (!cancelled) {
        setToken(null);
        setUser(null);
      }
    };

    hydrate().finally(() => {
      if (!cancelled) setIsInitializing(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${AUTH_API_BASE}/v1/auth/login`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            project_scope: PROJECT_SCOPE,
            platform: "web",
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : `Authentication failed (${res.status})`
          );
        }

        const accessToken =
          typeof data?.access_token === "string" ? data.access_token : undefined;
        if (!accessToken) {
          throw new Error("Auth gateway returned no access token");
        }

        localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
        setToken(accessToken);
        setUser(normalizeUser(data.user) ?? userFromToken(accessToken));
        navigate("/agents", { replace: true });
      } catch (err) {
        // fetch() rejects with a TypeError ("Failed to fetch") when the
        // request never gets a readable response — most often because the
        // gateway's CORS allow-list does not include this origin.
        const message =
          err instanceof TypeError
            ? `Cannot reach ${AUTH_API_BASE} from ${window.location.origin}. The auth gateway must list this origin in CORS_ORIGIN.`
            : err instanceof Error
            ? err.message
            : "Authentication failed";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    const current = token ?? localStorage.getItem(AUTH_TOKEN_KEY);

    localStorage.removeItem(AUTH_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError(null);

    if (current) {
      try {
        await fetch(`${AUTH_API_BASE}/v1/auth/logout`, {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${current}` },
        });
      } catch {
        // Best effort: the local session is already cleared.
      }
    } else {
      // Cookie-only session (hosted login / SSO). /web/logout clears the
      // gateway cookies; the response is opaque, so this must be no-cors.
      try {
        await fetch(`${AUTH_GATEWAY_ORIGIN}/web/logout`, {
          mode: "no-cors",
          credentials: "include",
        });
      } catch {
        // Best effort.
      }
    }

    navigate("/login", { replace: true });
  }, [navigate, token]);

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn: !!user,
        isInitializing,
        user,
        token,
        login,
        logout,
        error,
        loading,
        clearError,
        signupUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
