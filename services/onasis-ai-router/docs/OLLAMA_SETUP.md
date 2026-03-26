# Ollama Model Setup for LanOnasis AI Router

## Recommended Models for Subagent Support

### 1. Primary Coding Model (Best Quality)
```bash
ollama pull deepseek-coder:6.7b
```
- **Size**: ~4GB
- **Use**: Main coding tasks, repo analysis, debugging
- **Strengths**: Excellent code understanding, multi-language support
- **Speed**: Medium (good balance)

### 2. Fast Coding Assistant (Quick Tasks)
```bash
ollama pull qwen2.5-coder:7b
```
- **Size**: ~4.7GB
- **Use**: Quick code completions, simple refactors
- **Strengths**: Fast response, good for interactive work
- **Speed**: Very fast

### 3. General Purpose + Reasoning
```bash
ollama pull llama3.1:8b
```
- **Size**: ~4.7GB
- **Use**: Non-code tasks, planning, general queries
- **Strengths**: Good reasoning, conversational
- **Speed**: Fast

### 4. Tool Summarization (Lightweight)
```bash
ollama pull qwen2:1.5b
```
- **Size**: ~934MB
- **Use**: Summarizing tool results (already configured)
- **Strengths**: Very fast, low memory
- **Speed**: Extremely fast

## Optional Advanced Models

### For Complex Code Analysis
```bash
ollama pull deepseek-coder:33b  # ~19GB
# or
ollama pull codellama:34b        # ~19GB
```
Use for: Complex refactoring, architecture design, large codebase analysis

### For Best Reasoning
```bash
ollama pull mixtral:8x7b         # ~26GB
```
Use for: Planning, decision-making, multi-step workflows

## Configuration

### Environment Variables (.env)
```bash
# Primary chat model for coding tasks
OLLAMA_MODEL=deepseek-coder:6.7b

# Lightweight model for tool result summarization
OLLAMA_TOOL_MODEL=qwen2:1.5b

# Ollama connection
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_PATH=/api/chat

# Enable tool summarization for large results
TOOL_RESULT_SUMMARIZE=true
TOOL_RESULT_MAX_CHARS=6000

# Memory prefetch settings
MEMORY_PREFETCH_ENABLED=true
MEMORY_PREFETCH_TOPK=8
MEMORY_PREFETCH_MAX_CHARS=4000
```

### Quick Start
```bash
# Pull recommended models
ollama pull deepseek-coder:6.7b
ollama pull qwen2.5-coder:7b
ollama pull llama3.1:8b
ollama pull qwen2:1.5b

# Start Ollama service
ollama serve

# Verify models
ollama list

# Test model
ollama run deepseek-coder:6.7b "Write a hello world in TypeScript"
```

## Model Selection Strategy

### Use deepseek-coder:6.7b when:
- Analyzing code structure
- Writing new functions/classes
- Debugging complex issues
- Repository realignment tasks
- Understanding existing codebases

### Use qwen2.5-coder:7b when:
- Quick code completions
- Simple refactors
- Interactive development
- Fast iteration needed

### Use llama3.1:8b when:
- Planning architecture
- Non-code questions
- General conversation
- Decision-making

### Use qwen2:1.5b when:
- Summarizing tool results (automatic)
- Quick responses needed
- Low memory environment

## Performance Tips

1. **Keep active model loaded**: First request is slower (model loading)
2. **Preload models**: Run `ollama run <model>` then Ctrl+D to preload
3. **Memory management**: Ollama keeps 1-2 models in VRAM/RAM
4. **Model switching**: Automatic but has ~2-5s delay

## Testing the Router

```bash
# Health check
curl http://localhost:3001/ai-health

# Test chat with coding task
curl -X POST http://localhost:3001/api/v1/ai-chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "messages": [
      {"role": "user", "content": "Analyze the AIServiceRouter class and suggest improvements"}
    ]
  }'
```

## Troubleshooting

### Model not found
```bash
ollama pull <model-name>
```

### Slow responses
- Switch to smaller model (qwen2.5-coder:7b)
- Reduce MEMORY_PREFETCH_TOPK
- Disable TOOL_RESULT_SUMMARIZE

### Out of memory
- Use smaller models
- Close other applications
- Restart ollama: `ollama serve`

## System Requirements

### Minimum (for 7b models)
- 8GB RAM
- 10GB disk space

### Recommended (for 6.7b-8b models)
- 16GB RAM
- 20GB disk space
- GPU optional (CPU inference works)

### Optimal (for 33b+ models)
- 32GB+ RAM
- 50GB+ disk space
- GPU with 24GB+ VRAM
