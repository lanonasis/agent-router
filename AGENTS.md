# AGENTS.md

- The dev-only auth bypass in `apps/onasis-agent-haven/src/contexts/AuthContext.tsx` must stay gated on `import.meta.env.DEV` (and its sessionStorage flag ignored otherwise) — production builds must always require a real auth-gateway session.
- Lovable builds from the monorepo root: root `package.json` must keep `build`/`build:dev` delegating to `apps/onasis-agent-haven`, root `tsconfig.json` extends the app's `tsconfig.app.json`, and the app's Vite `outDir` is the root `dist` — hosting runs `tsc` and reads output there.
- The router's operator activity trail (`services/onasis-ai-router/core/activity-log.js`) is fed only by the existing ops events, stays in memory and metadata-only (no prompts, answers or credentials), and is tenant-scoped unless the caller's org is in `ROUTER_OPS_ORG_IDS` — so the dashboard can show request flow without exposing tenant data.
- The dashboard reads the router address and optional API key from `apps/onasis-agent-haven/src/lib/routerSettings.ts` (browser override over `VITE_ROUTER_URL`); every router call must go through it so Settings, topology and activity never disagree.
