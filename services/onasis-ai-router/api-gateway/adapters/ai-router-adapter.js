// api-gateway/adapters/ai-router-adapter.js
// Proxy middleware to forward AI requests to ai-router

const { createProxyMiddleware } = require('http-proxy-middleware');
const AI_ROUTER_URL = process.env.AI_ROUTER_URL || 'http://localhost:8000';

module.exports = createProxyMiddleware({
  target: AI_ROUTER_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/ai': '/api/v1/ai-chat'  // Rewrite /ai → ai-router endpoint
  },
  onProxyReq: (proxyReq, req, res) => {
    // Forward auth headers
    if (req.headers.authorization) {
      proxyReq.setHeader('Authorization', req.headers.authorization);
    }
    // Add branding
    proxyReq.setHeader('X-Platform', req.get('host'));
  },
  onProxyRes: (proxyRes, req, res) => {
    // Add gateway metadata
    proxyRes.headers['X-Gateway'] = 'Onasis-API-Gateway';
  },
  onError: (err, req, res) => {
    res.status(503).json({ error: 'AI service unavailable' });
  }
});

// In your api-gateway/server.js, mount it:
// app.use('/ai', require('./adapters/ai-router-adapter'));
