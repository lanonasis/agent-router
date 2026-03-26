/**
 * PM2 ecosystem config for onasis-ai-router.
 * NOTE: Production runtime is managed by systemd (infra/systemd/onasis-ai-router.service).
 * This config is for local/dev use or when migrating away from systemd.
 */
module.exports = {
  apps: [
    {
      name: 'onasis-ai-router',
      script: './services/onasis-ai-router/server.js',
      cwd: '/opt/lanonasis/shared_services/onasis-agent-haven',
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
