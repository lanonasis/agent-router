# Router Directory Structure

All Ollama AI service router files are organized in this single directory.

## 📁 Directory: `/opt/lanonasis/lan-onasis-monorepo/scripts/router/`

```
router/
├── 🚀 GETTING STARTED
│   ├── README.md                        # Main documentation (start here!)
│   ├── QUICK_START.md                   # 5-minute setup guide
│   └── quick-setup.sh                   # One-command setup script
│
├── 📚 SETUP GUIDES
│   ├── OLLAMA_SETUP_LIGHTWEIGHT.md      # For 8GB RAM systems (recommended)
│   ├── OLLAMA_SETUP.md                  # For 16GB+ RAM systems
│   ├── setup-ollama-lite.sh             # Auto-detects RAM, installs right models
│   └── setup-ollama.sh                  # Full setup with options
│
├── ⚙️ CONFIGURATION
│   ├── .env.template                    # Basic config template
│   ├── .env.branded                     # Onasis-branded config (use this!)
│   └── .env                             # Your config (create from .env.branded)
│
├── 🎯 CORE SERVICE
│   ├── server.js                        # Express server (run this!)
│   ├── ai-service-router.js             # Main router logic (Ollama + memory)
│   └── package.json                     # Dependencies
│
├── 📖 OTHER FILES (pre-existing, not needed for Ollama setup)
│   ├── claude-mcp-wrapper.js            # Claude MCP integration
│   ├── cli-integration.js               # CLI tools
│   ├── external-mcp-client.js           # External MCP client
│   ├── multi-platform-router.js         # Multi-platform routing
│   ├── stdio-mcp-server.js              # STDIO MCP server
│   ├── unified-router.js                # Unified router (older)
│   ├── unified-router.cjs               # CommonJS version
│   ├── vendor-auth-middleware.js        # Vendor auth
│   └── router_codemap.md                # Code map
│
└── 📋 THIS FILE
    └── DIRECTORY_STRUCTURE.md           # You are here!
```

## 🎯 Which Files Do You Need?

### For Quick Setup (2 models, branded):
```bash
1. quick-setup.sh          # Run this first
2. .env.branded            # Template for config
3. server.js               # Start server with this
4. QUICK_START.md          # Read this for instructions
```

### For Understanding:
```bash
README.md                         # Overview and features
OLLAMA_SETUP_LIGHTWEIGHT.md       # Detailed guide for 8GB RAM
```

### Core Service Files (don't modify):
```bash
ai-service-router.js              # Main router logic
server.js                         # Express wrapper
```

## 🚦 Quick Start Flow

```
1. ./quick-setup.sh
   ↓ Downloads 2 models (~3GB)
   ↓ Creates .env from .env.branded

2. Edit .env
   ↓ Add your API key

3. node server.js
   ↓ Starts on port 3001

4. Test:
   curl http://localhost:3001/health
```

## 📝 Configuration Files

### `.env.branded` (Template - Recommended)
- Includes Onasis branding
- System prompt with mission statement
- Optimized for 8GB RAM
- Use this as your starting point

### `.env.template` (Basic Template)
- Minimal configuration
- No branding
- Generic setup

### `.env` (Your Config - You Create This)
```bash
# Create from branded template:
cp .env.branded .env

# Then edit your API key:
nano .env
```

## 🗂️ Documentation Guide

| File | When to Read | Purpose |
|------|-------------|---------|
| **README.md** | First | Overview, features, quick start |
| **QUICK_START.md** | Setup time | 2-model installation guide |
| **OLLAMA_SETUP_LIGHTWEIGHT.md** | Detailed setup | Full guide for 8GB RAM |
| **OLLAMA_SETUP.md** | If you have 16GB+ RAM | Advanced setup options |
| **DIRECTORY_STRUCTURE.md** | When confused | This file - directory map |

## 🎨 Customization Files

Edit these to customize:

1. **`.env`** - All configuration
   - Models to use
   - API endpoints
   - Branding text
   - Memory settings

2. **`server.js`** - Server behavior
   - Port settings
   - Middleware
   - Error handling
   - Logging

3. **`ai-service-router.js`** - Router logic
   - Tool definitions
   - Response formatting
   - Authentication
   - Memory prefetch

## 🚫 Files to Ignore (Pre-existing)

These are from previous router implementations and not needed for Ollama setup:
- `claude-mcp-wrapper.js`
- `cli-integration.js`
- `external-mcp-client.js`
- `multi-platform-router.js`
- `stdio-mcp-server.js`
- `unified-router.js` / `unified-router.cjs`
- `vendor-auth-middleware.js`
- `router_codemap.md`

You can delete these if you want to clean up, or leave them for reference.

## 📦 What Gets Created

When you run `quick-setup.sh`:

```
Created Files:
- .env                    # Your configuration
- package.json            # If not exists
- node_modules/           # Dependencies
- logs/                   # Log files (when server runs)
```

Downloaded to Ollama:
```
~/.ollama/models/
- qwen2.5-coder:3b        # ~2GB
- qwen2:1.5b              # ~1GB
```

## 🧹 Cleanup (If Needed)

To start fresh:
```bash
# Remove config
rm .env

# Remove dependencies
rm -rf node_modules package-lock.json

# Remove logs
rm -rf logs/

# Keep these - they're your code!
# - server.js
# - ai-service-router.js
# - *.md files
# - setup scripts
```

## ❓ Common Questions

### Q: Which setup script should I use?
**A:** Use `quick-setup.sh` - it's the simplest for 8GB RAM.

### Q: Where are the models stored?
**A:** In `~/.ollama/models/` (not in this directory)

### Q: Can I delete the old router files?
**A:** Yes, but keep them for now in case you need reference.

### Q: Which config should I use?
**A:** Copy `.env.branded` to `.env` - it has Onasis branding.

### Q: Do I need all the documentation files?
**A:** No, but they're helpful. Minimum: README.md + QUICK_START.md

## 🎯 Recommended Setup Order

```bash
1. Read: README.md                (overview)
2. Read: QUICK_START.md           (instructions)
3. Run:  ./quick-setup.sh         (install)
4. Edit: .env                     (configure)
5. Run:  node server.js           (start)
6. Test: curl localhost:3001/health
```

## 📞 Support Files

All documentation is in this directory:
- **README.md** - Main docs
- **QUICK_START.md** - Quick guide
- **OLLAMA_SETUP_LIGHTWEIGHT.md** - Detailed guide
- **DIRECTORY_STRUCTURE.md** - This file

No need to look anywhere else - everything is here!

---

**Everything in one directory. Simple. Organized. Ready to use.**

*"Change the world one simple solution at a time"* ✨
