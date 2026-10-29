# AGENTS.md

- The dev-only auth bypass in `apps/onasis-agent-haven/src/contexts/AuthContext.tsx` must stay gated on `import.meta.env.DEV` (and its sessionStorage flag ignored otherwise) — production builds must always require a real auth-gateway session.
