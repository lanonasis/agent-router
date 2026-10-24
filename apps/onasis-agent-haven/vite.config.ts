import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // Proxy auth endpoints to the auth-gateway service.
      // Default targets production; override with AUTH_GATEWAY_URL env var.
      "/v1/auth": {
        target: process.env.AUTH_GATEWAY_URL || "https://auth.lanonasis.com",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@agent-model-files": path.resolve(__dirname, "../../packages/agent-model-files"),
      "@agent-contracts": path.resolve(__dirname, "../../packages/agent-contracts/src"),
    },
  },
}));