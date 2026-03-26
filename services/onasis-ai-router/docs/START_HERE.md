# 🚀 START HERE - Onasis AI Router Setup

**Everything you need is in this one directory!**

Location: `/opt/lanonasis/lan-onasis-monorepo/scripts/router/`

---

## ⚡ 3-Step Quick Start

```bash
# Step 1: Run setup (5 minutes)
./quick-setup.sh

# Step 2: Add your API key
nano .env
# Change: MEMORY_API_KEY=lano_your_actual_key

# Step 3: Start server
node server.js
```

**That's it!** 🎉

---

## 📁 What's in This Directory

### 🎯 **Essential Files** (You Need These)

| File | Purpose | Do This |
|------|---------|---------|
| `quick-setup.sh` | Downloads 2 AI models (~3GB) | Run first: `./quick-setup.sh` |
| `.env.branded` | Config template with Onasis branding | Copy to `.env` then edit |
| `server.js` | The actual server | Run: `node server.js` |
| `README.md` | Full documentation | Read for details |
| `QUICK_START.md` | 5-minute guide | Read for setup help |

### 📚 **Documentation** (Reference)

| File | What It Explains |
|------|------------------|
| `OLLAMA_SETUP_LIGHTWEIGHT.md` | Setup for 8GB RAM (your system) |
| `OLLAMA_SETUP.md` | Setup for 16GB+ RAM systems |
| `DIRECTORY_STRUCTURE.md` | What each file does |
| `START_HERE.md` | This file! |

### ⚙️ **Core Code** (Already Working)

| File | What It Does |
|------|-------------|
| `ai-service-router.js` | Router logic (don't modify) |
| `server.js` | Express server (can customize) |
| `.env` | Your config (you create this) |

### 🗄️ **Old Files** (Can Ignore)

These are from previous implementations:
- `claude-mcp-wrapper.js`
- `cli-integration.js`
- `external-mcp-client.js`
- `multi-platform-router.js`
- `unified-router.js`
- Others...

*You can delete these or keep them for reference.*

---

## 🎯 What You'll Get

### 2 AI Models Installed

1. **qwen2.5-coder:3b** (~2GB)
   - For coding tasks
   - Code analysis
   - Repository work

2. **qwen2:1.5b** (~1GB)
   - For quick responses
   - Tool summarization
   - General chat

### Total Resources Used
- 💾 ~3GB disk (out of your 100GB)
- 🧠 ~4GB RAM (out of your 8GB)
- 🚀 2-5 second response time

---

## 🎨 Onasis Branding Included

Your AI responds with:

> *"You are L0, Onasis's AI coding assistant. Our mission: 'Change the world one simple solution at a time.' I help you build better code with intelligence, memory, and clarity."*

Customize this in `.env` if you want!

---

## 🧪 Testing After Setup

```bash
# 1. Check server is running
curl http://localhost:3001/health

# 2. Test AI endpoint
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello L0! Analyze this code: function test() { return 1; }"}
    ]
  }'

# 3. Check what models are loaded
ollama ps
```

---

## 🎓 Learning Path

### Beginner
1. ✅ Read: `START_HERE.md` (this file)
2. ✅ Run: `./quick-setup.sh`
3. ✅ Edit: `.env`
4. ✅ Start: `node server.js`
5. ✅ Test: `curl localhost:3001/health`

### Intermediate
1. Read: `QUICK_START.md` for customization
2. Try: Different system prompts in `.env`
3. Explore: Memory tools integration
4. Review: `README.md` for all features

### Advanced
1. Read: `OLLAMA_SETUP_LIGHTWEIGHT.md` for optimization
2. Modify: `server.js` for custom endpoints
3. Extend: `ai-service-router.js` for new tools
4. Deploy: Use PM2 for production

---

## 🆘 Troubleshooting

### Setup script fails
```bash
# Make sure Ollama is installed:
curl -fsSL https://ollama.ai/install.sh | sh
```

### Models not downloading
```bash
# Manual download:
ollama pull qwen2.5-coder:3b
ollama pull qwen2:1.5b
```

### Server won't start
```bash
# Check if Ollama is running:
curl http://localhost:11434/api/tags

# Start Ollama:
ollama serve
```

### Slow responses
```bash
# In .env, reduce memory usage:
MEMORY_PREFETCH_ENABLED=false
TOOL_RESULT_SUMMARIZE=false
```

---

## 📊 Directory Size

```bash
# Check directory size
du -sh /opt/lanonasis/lan-onasis-monorepo/scripts/router/

# Models are stored separately at:
du -sh ~/.ollama/models/
```

---

## 🎯 Next Steps After Setup

### For Development
```bash
# Run with auto-reload
npm install -g nodemon
nodemon server.js
```

### For Production
```bash
# Run as service with PM2
npm install -g pm2
pm2 start server.js --name onasis-ai
pm2 save
pm2 startup
```

### For Testing
```bash
# Run the test suite
npm test
```

---

## 💡 Tips

### 1. Keep models loaded
First request loads the model (slower). Subsequent requests are fast.

### 2. Use memory tools
The AI can search and recall previous conversations automatically.

### 3. Customize the persona
Edit `OLLAMA_SYSTEM_PROMPT` in `.env` to change how the AI responds.

### 4. Monitor usage
Check logs in `logs/ai-router.log` for request tracking.

### 5. Scale up later
If you get more RAM, just download larger models and update `.env`.

---

## ✅ Checklist

Before asking for help, verify:

- [ ] Ollama installed: `ollama --version`
- [ ] Ollama running: `curl localhost:11434/api/tags`
- [ ] Models downloaded: `ollama list`
- [ ] Config created: `ls .env`
- [ ] API key added: `grep MEMORY_API_KEY .env`
- [ ] Dependencies installed: `ls node_modules`
- [ ] Server starts: `node server.js`
- [ ] Health check passes: `curl localhost:3001/health`

---

## 📞 Documentation Map

**Quick reference:**
- **Setup** → `quick-setup.sh` then `QUICK_START.md`
- **Features** → `README.md`
- **Config** → `.env.branded` template
- **8GB RAM** → `OLLAMA_SETUP_LIGHTWEIGHT.md`
- **16GB+ RAM** → `OLLAMA_SETUP.md`
- **Lost?** → `DIRECTORY_STRUCTURE.md`
- **Confused?** → This file (`START_HERE.md`)

---

## 🎉 Success Looks Like

When everything works:

```bash
$ node server.js

🚀 Onasis AI Service Router
📡 Server running on port 3001
🤖 AI Model: qwen2.5-coder:3b
🔗 Ollama: http://localhost:11434

📚 Endpoints:
   GET  http://localhost:3001/
   GET  http://localhost:3001/health
   GET  http://localhost:3001/ai-health
   GET  http://localhost:3001/ai-services
   POST http://localhost:3001/api/v1/ai-chat
   POST http://localhost:3001/functions/v1/ai-chat

✨ Ready to serve AI requests
```

---

## 🚀 Ready to Start?

```bash
cd /opt/lanonasis/lan-onasis-monorepo/scripts/router
./quick-setup.sh
```

**That's all you need!** Everything else is in this directory.

---

**Built with ❤️ by Onasis**

*"Change the world one simple solution at a time"* ✨

**Questions?** Read `README.md` or `QUICK_START.md` in this directory.
