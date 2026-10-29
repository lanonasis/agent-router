# AGENTS.md

- The dev-only auth bypass in `apps/onasis-agent-haven/src/contexts/AuthContext.tsx` must stay gated on `import.meta.env.DEV` (and its sessionStorage flag ignored otherwise) — production builds must always require a real auth-gateway session.
- Lovable builds from the monorepo root: root `package.json` must keep `build`/`build:dev` delegating to `apps/onasis-agent-haven`, root `tsconfig.json` extends the app's `tsconfig.app.json`, and the app's Vite `outDir` is the root `dist` — hosting runs `tsc` and reads output there.
