import { useCallback, useEffect, useRef, useState } from "react";
import { useRouterSettings } from "@/lib/routerSettings";
import { fetchRouterCatalog, RouterCatalogError, type RouterCatalog } from "@/services/routerCatalog";

export const CATALOG_REFRESH_MS = 30_000;

export interface CatalogError {
  kind: RouterCatalogError["kind"] | "unknown";
  message: string;
}

/** Fetches the router catalog on mount, on settings change, and every 30s. */
export function useRouterCatalog() {
  const settings = useRouterSettings();
  const [catalog, setCatalog] = useState<RouterCatalog | null>(null);
  const [error, setError] = useState<CatalogError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setIsLoading(true);
    try {
      const data = await fetchRouterCatalog(settings);
      if (id !== requestId.current) return; // stale
      setCatalog(data);
      setError(null);
      setLastSyncedAt(Date.now());
    } catch (err) {
      if (id !== requestId.current) return;
      setCatalog(null);
      setError(
        err instanceof RouterCatalogError
          ? { kind: err.kind, message: err.message }
          : { kind: "unknown", message: "Unexpected error reading the router catalog." },
      );
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), CATALOG_REFRESH_MS);
    return () => {
      clearInterval(timer);
      // Intentionally the live counter: bumping it invalidates any in-flight response.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++;
    };
  }, [load]);

  return { catalog, error, isLoading, lastSyncedAt, refresh: load };
}
