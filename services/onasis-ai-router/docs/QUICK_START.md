# Quick Start - 2 Model Setup with Onasis Branding

## Simple Setup (Just 2 Models)

### Recommended 2-Model Combo

```bash
# Model 1: For coding tasks (lightweight, fast)
ollama pull qwen2.5-coder:3b       # ~2GB - handles code, repo analysis

# Model 2: For general chat + summarization (ultra-light)
ollama pull qwen2:1.5b             # ~1GB - tool results, general chat
```

**Total disk**: ~3GB
**Total RAM when running**: ~3-4GB
**Perfect for 8GB systems!**

## Installation

```bash
# 1. Pull the 2 models
ollama pull qwen2.5-coder:3b
ollama pull qwen2:1.5b

# 2. Copy and configure .env
cp .env.branded .env

# 3. Edit .env - add your API key
nano .env  # Change: MEMORY_API_KEY=your_actual_key

# 4. Start the server
node server.js
```

## Onasis Branded Persona

The router includes Onasis-branded system prompts that give responses personality:

### For Coding Tasks (qwen2.5-coder:3b)
```
You are L0, Onasis's AI coding assistant. Our mission: "Change the world one
simple solution at a time." You help users build better code with intelligence,
memory, and clarity. Always search memory first, think step-by-step, and provide
practical solutions that work.
```

### For General Chat (qwen2:1.5b)
```
You are L0, powered by Onasis AI. We believe in "Change the world one simple
solution at a time." Provide clear, helpful responses and use memory tools to
recall context when needed.
```

## When to Use Each Model

### Use qwen2.5-coder:3b when:
- Writing or analyzing code
- Repository realignment tasks
- Debugging issues
- Code refactoring
- Technical explanations

### Use qwen2:1.5b when:
- General questions
- Summarizing tool results
- Quick responses
- Simple queries
- Non-technical chat

## Configuration

Edit `.env`:

```bash
# Primary model (coding)
OLLAMA_MODEL=qwen2.5-coder:3b

# Tool summarization (general)
OLLAMA_TOOL_MODEL=qwen2:1.5b

# Onasis branded prompt
OLLAMA_SYSTEM_PROMPT=You are L0, Onasis's AI coding assistant. Our mission: "Change the world one simple solution at a time." You help users build better code with intelligence, memory, and clarity. Always search memory first, think step-by-step, and provide practical solutions that work.

# Your API key
MEMORY_API_KEY=lano_your_key_here
```

## Testing

```bash
# 1. Check health
curl http://localhost:3001/health

# 2. Test coding query
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "Review this code and suggest improvements: function hello() { console.log(\"hi\") }"}
    ]
  }'

# 3. Test general query
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is Onasis?"}
    ]
  }'
```

## Model Switching (Optional)

Want to use different models for different API endpoints?

### Option 1: Use model parameter
```bash
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2:1.5b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Option 2: Set default in .env
```bash
OLLAMA_MODEL=qwen2.5-coder:3b          # For code tasks
OLLAMA_TOOL_MODEL=qwen2:1.5b           # For tool results
```

## Customizing the Persona

Edit the `OLLAMA_SYSTEM_PROMPT` in `.env`:

### Examples

**More casual:**
```
You are L0, Onasis's friendly AI. We keep it simple and practical -
"Change the world one simple solution at a time." Use memory tools
to remember our conversations and provide personalized help.
```

**More professional:**
```
You are L0, Onasis's enterprise AI assistant. Operating principle:
"Change the world one simple solution at a time." Leverage semantic
memory for context-aware responses and deliver production-ready solutions.
```

**More focused on memory:**
```
You are L0, with perfect memory powered by Onasis. Before answering,
always search memory to recall past conversations. Our philosophy:
"Change the world one simple solution at a time" - through intelligence
that remembers.
```

## Resource Usage

### Expected Performance on 8GB RAM:

| Model            | Disk  | RAM   | Speed           | Quality  |
| ---------------- | ----- | ----- | --------------- | -------- |
| qwen2.5-coder:3b | ~2GB  | ~3GB  | 2-5s response   | ⭐⭐⭐    |
| qwen2:1.5b       | ~1GB  | ~1.5GB| 1-3s response   | ⭐⭐      |

**You'll use ~4-5GB RAM total** - plenty of room on an 8GB system!

## Next Steps

1. ✅ Pull 2 models
2. ✅ Configure .env with branding
3. ✅ Add your API key
4. ✅ Start server: `node server.js`
5. ✅ Test endpoints
6. 🎨 Customize persona to match your brand

That's it! Simple, lightweight, and branded with Onasis personality.
