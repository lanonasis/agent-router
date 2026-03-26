module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: './api-gateway/server.js',  // Adjust path if needed
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        REDIS_URL: 'redis://localhost:6379',
        AI_ROUTER_URL: 'http://localhost:8000'
      }
    },
    {
      name: 'auth-gateway',
      script: './auth-gateway/server.js',  // Adjust path
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        REDIS_URL: 'redis://localhost:6379'
      }
    },
    {
      name: 'ai-router',
      script: './server.js',  // This project's main
      instances: 2,  // Scale AI to 2 instances
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        REDIS_URL: 'redis://localhost:6379',
        AUTH_GATEWAY_URL: 'http://localhost:4000',
        RATE_LIMIT_STORE: 'redis'
      }
    }
  ]
};
