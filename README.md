# Onasis Agent Haven

Agent Haven is the control-plane workspace for the Onasis L0 AI platform. It
holds the reviewed agent identity material, TypeScript contracts, documentation
UI, and the `onasis-ai-router` inference service.

The architecture deliberately separates **what an interaction is allowed to
be** from **how inference is fulfilled**:

```text
application -> Auth Gateway UAI -> Agent Heaven profile -> AI router -> internal inference chain
```

- **Agent Haven** owns profile templates, identity material, safety policies,
  tool/memory capability declarations, and their versioned contracts.
- **Auth Gateway UAI** resolves the caller and organization before a router
  request can reach memory or inference.
- **AI router** owns request execution: scoped memory, tool enforcement,
  vendor fallthrough, response sanitization, and operational telemetry.
- **Applications** own their UI and safe presentation of outcomes. They do not
  choose upstream models/vendors or provide arbitrary system instructions.

## Workspace layout

| Path | Purpose |
|---|---|
| `apps/onasis-agent-haven` | Vite/React interface for browsing and managing agent documentation and source mappings. |
| `packages/agent-contracts` | Dependency-free TypeScript contract for agent mappings and the L0 API/profile boundary. |
| `packages/agent-model-files` | Canonical Agent Heaven prompt source, derived role files, and freshness checker. |
| `services/onasis-ai-router` | Authenticated L0 inference service with native and OpenAI-compatible APIs. |
| `docs/L0-AGENT-HEAVEN-CONVERGENCE-PLAN.md` | Approved convergence design and remaining delivery gates. |
| `infra/` | Deployment templates. The router’s systemd template is primary; the PM2 file is for local/migration use. |

## Current platform state

The L0 contract foundation is implemented in this repository:

- Public L0 model identity is `lzero`; `Vortex-L0` is a compatibility alias.
- The router exposes native `/api/v1/ai-chat` and OpenAI-compatible `/v1`
  surfaces.
- Agent contracts define profile manifests, UAI scope, memory partitioning,
  and outcome types.
- Agent Heaven source files are generated from
  `packages/agent-model-files/SOURCE-OF-TRUTH.md` and checked in CI.

Profile activation is **not yet live**. `X-Onasis-Profile` and
`X-Onasis-Application` are planned intent metadata, but the router must not
activate them until UAI returns verified application/profile entitlements.
Accepting them earlier would let a caller select its own authorization scope.

## Local development

Prerequisites: Node.js 22+ for the router, Bun for the workspace scripts, and
Python 3 for prompt synchronization checks.

```bash
cd /opt/lanonasis/shared_services/onasis-agent-haven
bun install

# Agent Haven documentation UI
bun run dev

# Router, bound to 127.0.0.1:8000 by default
bun run router:start
```

The React app’s own scripts also work from `apps/onasis-agent-haven`:

```bash
bun run dev
bun run build
bun run lint
```

Do not start the local router against production credentials or copy `.env`
files into source control.

## Checks

Run the generated-prompt freshness check whenever changing Agent Heaven model
files or the source of truth:

```bash
bun run check:agent-model-files
```

The check verifies both the canonical package copy and the documentation copy.
To regenerate derived files after editing the source of truth:

```bash
python3 packages/agent-model-files/sync-source-of-truth.py
python3 packages/agent-model-files/sync-source-of-truth.py \
  --output-dir apps/onasis-agent-haven/docs/agent_model_files
```

Router tests run from the service directory:

```bash
cd services/onasis-ai-router
npm test
```

Some router HTTP tests create loopback listeners. Sandboxed environments that
prohibit local listeners skip those tests; normal local development and CI run
them.

## Documentation

- [L0 Agent Heaven and Router Convergence Plan](docs/L0-AGENT-HEAVEN-CONVERGENCE-PLAN.md)
- [Router L0 Platform Contract](services/onasis-ai-router/docs/L0-PLATFORM-CONTRACT.md)
- [Router Integration Guide](services/onasis-ai-router/docs/INTEGRATION-GUIDE.md)
- [Router architecture](services/onasis-ai-router/docs/ARCHITECTURE.md)

The integration guide is the application-facing API reference. It is not a
license to add application-specific routes, models, vendors, or prompt logic to
the router.
