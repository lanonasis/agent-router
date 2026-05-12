# Onasis AI Service Router

**"Change the world one simple solution at a time"**

AI-powered coding assistant with semantic memory, powered by Ollama and branded with Onasis personality.

## 🚀 Quick Start (5 minutes)

Perfect for 8GB RAM systems. Just 2 models, fully branded.

```bash
cd /opt/lanonasis/lan-onasis-monorepo/scripts/router

# 1. Run quick setup (downloads 2 models, ~3GB)
./quick-setup.sh

# 2. Add your API key
nano .env
# Change: MEMORY_API_KEY=lano_your_actual_key

# 3. Start the server
node server.js

# 4. Test it
curl http://localhost:3001/health
```

## 📦 What Gets Installed

### 2 Lightweight Models

1. **qwen2.5-coder:3b** (~2GB) - Primary coding model
   - Code generation and analysis
   - Repository realignment
   - Debugging and refactoring

2. **qwen2:1.5b** (~1GB) - General purpose + tool summarization
   - Quick responses
   - Tool result summarization
   - General queries

**Total**: ~3GB disk, ~4GB RAM when running

## 🎨 Onasis Branding

The router includes branded system prompts:

> "You are L0, Onasis's AI coding assistant. Our mission: 'Change the world one simple solution at a time.' You help users build better code with intelligence, memory, and clarity."

Responses will reflect this personality and mission.

## 🔧 Configuration

Edit `.env` to customize:

```bash
# Models
OLLAMA_MODEL=qwen2.5-coder:3b        # Primary coding
OLLAMA_TOOL_MODEL=qwen2:1.5b         # Summarization

# Your API key
MEMORY_API_KEY=lano_your_key_here

# Branding (customize persona)
OLLAMA_SYSTEM_PROMPT=You are L0...
```

## 🌐 API Endpoints

Once running on port 3001:

### Health Check
```bash
curl http://localhost:3001/health
```

### Chat (with memory)
```bash
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "Analyze this repo structure"}
    ]
  }'
```

### Supabase-style endpoint
```bash
curl -X POST http://localhost:3001/functions/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"prompt": "Help me with this code"}'
```

### Service Discovery
```bash
curl http://localhost:3001/ai-services
```

## 🧠 Features

### Semantic Memory Integration
- Automatic memory prefetch based on user queries
- Tool calls: `memory.search`, `memory.get`, `memory.write`
- Context-aware responses using past conversations

### Memory Tools Available
```javascript
// Search memories
memory.search({ query: "authentication", topK: 5 })

// Get specific memories
memory.get({ ids: ["mem-id-1", "mem-id-2"] })

// Create new memory
memory.write({
  title: "Auth Implementation",
  content: "OAuth2 setup with PKCE...",
  memory_type: "knowledge",
  tags: ["auth", "security"]
})
```

### Automatic Tool Result Summarization
Large tool responses are automatically summarized using `qwen2:1.5b` to keep context manageable.

## 📚 Documentation

- **QUICK_START.md** - 2-model setup guide
- **OLLAMA_SETUP_LIGHTWEIGHT.md** - Full lightweight guide
- **OLLAMA_SETUP.md** - Advanced options (16GB+ RAM)

## 🔄 Model Usage

### When each model is used:

| Scenario | Model Used | Why |
|----------|-----------|-----|
| User asks coding question | qwen2.5-coder:3b | Better code understanding |
| Tool returns large data | qwen2:1.5b | Fast summarization |
| Memory prefetch | (none - direct API) | Efficient |
| General chat | qwen2.5-coder:3b | Primary model |

## 🛠️ Troubleshooting

### Model not found
```bash
ollama pull qwen2.5-coder:3b
ollama pull qwen2:1.5b
```

### Slow responses
```bash
# In .env, reduce memory usage:
MEMORY_PREFETCH_ENABLED=false
TOOL_RESULT_SUMMARIZE=false
```

### Check what's loaded
```bash
ollama ps
```

### Restart Ollama
```bash
# Kill and restart
pkill ollama
ollama serve
```

## 🎯 Use Cases

### Repository Realignment
```bash
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "Analyze this repo structure and suggest improvements: [structure details]"}
    ]
  }'
```

### Code Review
```bash
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "Review this function: [code here]"}
    ]
  }'
```

### Memory-Powered Queries
```bash
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "What did we decide about the auth implementation?"}
    ]
  }'
```
The AI will search memory first before responding!

## 🚦 Production Tips

### Run as a service
```bash
# Using PM2
npm install -g pm2
pm2 start server.js --name onasis-ai-router
pm2 save
```

### Monitor logs
```bash
pm2 logs onasis-ai-router
```

### Auto-restart on reboot
```bash
pm2 startup
```

## 🔐 Security

- API key authentication required
- Integration with auth-gateway service
- Usage logging and tracking
- Privacy-safe response handling

## 📊 Performance

On 8GB RAM system:
- Response time: 2-5 seconds (coding)
- Response time: 1-3 seconds (general)
- Memory usage: ~4GB
- Concurrent users: 5-10

## 🎨 Customization

### Change the persona
Edit `.env`:
```bash
OLLAMA_SYSTEM_PROMPT=You are L0, Onasis's friendly coding buddy...
```

### Add more branding
```bash
BRAND_NAME=Onasis
BRAND_TAGLINE=Your custom tagline
BRAND_AI_NAME=L0
```

## 🆘 Support

- Issues: Check OLLAMA_SETUP_LIGHTWEIGHT.md
- Questions: See QUICK_START.md
- Advanced: See OLLAMA_SETUP.md

---

**Built with ❤️ by Onasis**

*"Change the world one simple solution at a time"*
