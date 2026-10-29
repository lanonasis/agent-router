# Roadmap

- [x] Router activity trail (in-memory) + `GET /api/v1/ops/activity` endpoint
- [x] Dashboard Activity page (origin → router → vendor → failover → result)
- [x] Settings page: router URL, optional API key, health + browser connectivity tests
- [x] Heartbeat/topology uses the configured router URL
- [x] 27 local test failures — two tool-loop tests delete `globalThis.fetch` under `bun test` (shared process)
- [x] Persist router activity on the server (survives restarts) with configurable retention; show retention in the dashboard
- [x] Playground: test prompts per persona + model + tool set via Lovable AI, showing tool calls
- [ ] Deploy the new router code to the remote server and restart `onasis-ai-router.service` (needs server access)
