# Ollama Lightweight Setup (8GB RAM, 100GB Disk)

## Recommended Models for Your System

With 8GB RAM, stick to models under 7B parameters. Here are the best options:

### Option A: Balanced Setup (Recommended)
Total: ~10GB disk, ~4-6GB RAM when running

```bash
# Primary coding model (best quality that fits)
ollama pull qwen2.5-coder:3b        # ~2GB disk, ~3GB RAM

# Ultra-light for tool summarization
ollama pull qwen2:1.5b              # ~934MB disk, ~1.5GB RAM

# General purpose chat
ollama pull llama3.2:3b             # ~2GB disk, ~3GB RAM
```

### Option B: Minimal Setup (Lightest)
Total: ~4GB disk, ~2-3GB RAM when running

```bash
# All-in-one lightweight model
ollama pull qwen2.5-coder:1.5b      # ~1GB disk, ~1.5GB RAM

# Backup/fallback
ollama pull qwen2:1.5b              # ~934MB disk, ~1.5GB RAM
```

### Option C: Code-Focused Setup
Total: ~8GB disk, ~5GB RAM when running

```bash
# Coding specialist (slightly larger, better quality)
ollama pull deepseek-coder:1.3b     # ~780MB disk, ~1.5GB RAM

# Or slightly better:
ollama pull qwen2.5-coder:3b        # ~2GB disk, ~3GB RAM

# Lightweight fallback
ollama pull qwen2:1.5b              # ~934MB disk, ~1.5GB RAM
```

## ❌ Don't Pull These (Too Large)

- deepseek-coder:6.7b (~4GB) - Will struggle on 8GB RAM
- deepseek-coder:33b (~19GB) - Won't run
- codellama:13b+ - Too large
- mixtral:8x7b (~26GB) - Way too large
- llama3.1:8b (~4.7GB) - May work but will be slow

## Quick Start (Recommended for You)

```bash
# 1. Pull lightweight models
ollama pull qwen2.5-coder:3b
ollama pull qwen2:1.5b

# 2. Create .env
cp .env.template .env

# 3. Edit .env - set these:
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_TOOL_MODEL=qwen2:1.5b

# 4. Run setup script (will skip large models)
./setup-ollama.sh

# 5. Start the server
node server.js
```

## Configuration for 8GB RAM

Edit `.env`:

```bash
# Use lightweight models
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_TOOL_MODEL=qwen2:1.5b

# Reduce memory usage
MEMORY_PREFETCH_TOPK=5              # Instead of 8
MEMORY_PREFETCH_MAX_CHARS=2000      # Instead of 4000
TOOL_RESULT_MAX_CHARS=3000          # Instead of 6000

# Enable summarization (reduces memory)
TOOL_RESULT_SUMMARIZE=true

# Reduce timeouts
ROUTER_TIMEOUT_MS=10000             # Instead of 15000
```

## Performance Tips for Low RAM

### 1. Keep Only One Model Active
Ollama keeps models in memory. Switch models sparingly.

### 2. Reduce Context Size
Smaller models handle shorter contexts better.

### 3. Use Tool Summarization
```bash
TOOL_RESULT_SUMMARIZE=true
```
This keeps responses smaller and faster.

### 4. Disable Memory Prefetch for Speed
If responses are slow:
```bash
MEMORY_PREFETCH_ENABLED=false
```

### 5. Monitor Memory
```bash
# Check memory usage
free -h

# Check which models are loaded
ollama ps
```

## Model Comparison (What Fits on 8GB RAM)

| Model               | Disk | RAM  | Speed      | Code Quality | Recommended |
| ------------------- | ---- | ---- | ---------- | ------------ | ----------- |
| qwen2.5-coder:1.5b  | 1GB  | 1.5GB| ⚡⚡⚡        | ⭐⭐          | ✅ Yes      |
| qwen2.5-coder:3b    | 2GB  | 3GB  | ⚡⚡         | ⭐⭐⭐        | ✅ Yes      |
| deepseek-coder:1.3b | 780MB| 1.5GB| ⚡⚡⚡        | ⭐⭐          | ✅ Yes      |
| llama3.2:3b         | 2GB  | 3GB  | ⚡⚡         | ⭐⭐⭐        | ✅ Yes      |
| qwen2:1.5b          | 934MB| 1.5GB| ⚡⚡⚡        | ⭐⭐          | ✅ Yes      |
| deepseek-coder:6.7b | 4GB  | 5GB  | ⚡          | ⭐⭐⭐⭐      | ⚠️  Tight   |
| codellama:7b        | 4GB  | 5GB  | ⚡          | ⭐⭐⭐        | ⚠️  Tight   |
| llama3.1:8b         | 5GB  | 6GB  | ⚡          | ⭐⭐⭐⭐      | ❌ No       |

## Testing Your Setup

```bash
# 1. Check Ollama is running
curl http://localhost:11434/api/tags

# 2. Test model directly
ollama run qwen2.5-coder:3b "Write a TypeScript hello world"

# 3. Start the router
node server.js

# 4. Test the router
curl http://localhost:3001/health

# 5. Test AI endpoint
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"messages": [{"role": "user", "content": "Hi"}]}'
```

## What to Expect

### With qwen2.5-coder:3b
- ✅ Good code generation
- ✅ Fast responses (2-5 seconds)
- ✅ Handles TypeScript, JavaScript, Python well
- ⚠️  Limited context window (~4K tokens)
- ⚠️  May struggle with very complex code

### With qwen2.5-coder:1.5b
- ✅ Very fast responses (1-3 seconds)
- ✅ Good for simple code tasks
- ⚠️  Less accurate for complex logic
- ⚠️  Shorter responses

## Upgrading Later

If you get more RAM (16GB+), you can upgrade to:
- deepseek-coder:6.7b (best balance)
- codellama:13b (larger, better quality)
- qwen2.5-coder:7b (fast and capable)

## Disk Space Management

Current models take ~3-10GB. You have 100GB, which is plenty.

To remove old models:
```bash
# List models
ollama list

# Remove model
ollama rm <model-name>
```

## Summary

**For your 8GB RAM system:**
1. ✅ Use qwen2.5-coder:3b as primary (best balance)
2. ✅ Use qwen2:1.5b for tool summarization
3. ✅ Keep memory settings reduced
4. ❌ Don't try to run 6.7b+ models
5. ✅ You have plenty of disk space (100GB)

This setup will work smoothly on your system and handle most coding tasks well!
