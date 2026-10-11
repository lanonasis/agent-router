/**
 * PM2 ecosystem config for onasis-ai-router.
 * NOTE: Production runtime is managed by systemd (infra/systemd/onasis-ai-router.service).
 * This config is for local/dev use or when migrating away from systemd.
 *
 * `cwd` resolves from this file's own location (infra/pm2/ -> repo root), so the
 * config works from any checkout. It previously hardcoded
 * /opt/lanonasis/shared_services/onasis-agent-haven — the production host's
 * layout, absent on a dev host, and contradicting this file's own "local/dev
 * use" purpose: pm2 would fail to start the app, or start it in the wrong tree.
 * Override with ONASIS_ROUTER_CWD when running from somewhere unusual.
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'onasis-ai-router',
      script: './services/onasis-ai-router/server.js',
      cwd: process.env.ONASIS_ROUTER_CWD || path.resolve(__dirname, '../..'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
      },
      restart_delay: 10000,
      max_memory_restart: '2G',
    },
  ],
};
