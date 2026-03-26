#!/bin/bash

# Lightweight Ollama Setup for 8GB RAM Systems
# Installs models that fit comfortably in limited memory

set -e

echo "🚀 Setting up Ollama (Lightweight) for LanOnasis AI Router"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Detect system RAM
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))

echo "💻 System Info:"
echo "   RAM: ${TOTAL_RAM_GB}GB"
echo ""

if [ $TOTAL_RAM_GB -lt 8 ]; then
    echo -e "${RED}⚠️  Warning: Less than 8GB RAM detected${NC}"
    echo "   Recommend using minimal setup (1.5b models only)"
    SETUP_TYPE="minimal"
elif [ $TOTAL_RAM_GB -lt 16 ]; then
    echo -e "${YELLOW}ℹ️  8-15GB RAM detected - using lightweight setup${NC}"
    echo "   Recommended models: 1.5b-3b size"
    SETUP_TYPE="lightweight"
else
    echo -e "${GREEN}✅ 16GB+ RAM detected - full setup available${NC}"
    SETUP_TYPE="full"
fi
echo ""

# Check Ollama
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama not installed"
    echo "Install: curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
fi

if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Starting Ollama service..."
    ollama serve &
    sleep 3
fi

echo -e "${GREEN}✅ Ollama service running${NC}"
echo ""

# Pull function
pull_model() {
    local model=$1
    local desc=$2
    local size=$3

    echo "📦 $model ($desc - $size)"

    if ollama list | grep -q "^${model}"; then
        echo -e "${GREEN}   ✅ Already installed${NC}"
    else
        echo "   Downloading..."
        if ollama pull "$model"; then
            echo -e "${GREEN}   ✅ Downloaded${NC}"
        else
            echo -e "${YELLOW}   ⚠️  Failed${NC}"
            return 1
        fi
    fi
    echo ""
}

# Install based on RAM
case $SETUP_TYPE in
    minimal)
        echo "=== Minimal Setup (< 8GB RAM) ==="
        echo ""
        pull_model "qwen2.5-coder:1.5b" "Ultra-light coder" "~1GB"
        pull_model "qwen2:1.5b" "Tool summarization" "~934MB"
        RECOMMENDED_MODEL="qwen2.5-coder:1.5b"
        ;;

    lightweight)
        echo "=== Lightweight Setup (8-15GB RAM) ==="
        echo ""
        pull_model "qwen2.5-coder:3b" "Balanced coder" "~2GB"
        pull_model "qwen2:1.5b" "Tool summarization" "~934MB"

        read -p "Install llama3.2:3b for general chat? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            pull_model "llama3.2:3b" "General purpose" "~2GB"
        fi

        RECOMMENDED_MODEL="qwen2.5-coder:3b"
        ;;

    full)
        echo "=== Full Setup (16GB+ RAM) ==="
        echo ""
        pull_model "deepseek-coder:6.7b" "Primary coder" "~4GB"
        pull_model "qwen2:1.5b" "Tool summarization" "~934MB"

        read -p "Install qwen2.5-coder:7b for fast coding? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            pull_model "qwen2.5-coder:7b" "Fast coder" "~4.7GB"
        fi

        read -p "Install llama3.1:8b for reasoning? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            pull_model "llama3.1:8b" "Reasoning" "~4.7GB"
        fi

        RECOMMENDED_MODEL="deepseek-coder:6.7b"
        ;;
esac

# Preload primary model
echo "=== Preloading Model ==="
echo ""
echo "Preloading $RECOMMENDED_MODEL..."
echo "exit" | ollama run "$RECOMMENDED_MODEL" > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Model preloaded${NC}"
echo ""

# Create optimized .env
echo "📝 Creating optimized .env..."
cat > .env << EOF
# Ollama Configuration (Optimized for ${TOTAL_RAM_GB}GB RAM)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_PATH=/api/chat
OLLAMA_MODEL=$RECOMMENDED_MODEL
OLLAMA_TOOL_MODEL=qwen2:1.5b

# System Prompt
OLLAMA_SYSTEM_PROMPT=You are L0, an AI coding assistant with semantic memory. Use memory.search to recall context. Analyze thoroughly before suggesting changes.

# API Endpoints
API_BASE_URL=https://api.lanonasis.com
AUTH_GATEWAY_URL=http://localhost:4000

# Memory Configuration (Optimized)
MEMORY_PREFETCH_ENABLED=true
EOF

# Add RAM-specific settings
if [ $TOTAL_RAM_GB -lt 12 ]; then
    cat >> .env << EOF
MEMORY_PREFETCH_TOPK=5
MEMORY_PREFETCH_MAX_CHARS=2000
TOOL_RESULT_MAX_CHARS=3000
EOF
else
    cat >> .env << EOF
MEMORY_PREFETCH_TOPK=8
MEMORY_PREFETCH_MAX_CHARS=4000
TOOL_RESULT_MAX_CHARS=6000
EOF
fi

cat >> .env << EOF
MEMORY_SEARCH_PATH=/api/v1/memories/search
MEMORY_GET_PATH=/api/v1/memories
MEMORY_WRITE_PATH=/api/v1/memories

# Authentication
MEMORY_API_KEY=your_api_key_here

# Tool Configuration
TOOL_RESULT_SUMMARIZE=true
SOFT_TOOL_PARSE=true
RESPONSE_CLEANUP_ENABLED=true
RETURN_ACTIONS_ENVELOPE=false

# Router Settings
ROUTER_TIMEOUT_MS=10000
PORT=3001

# Logging
LOG_LEVEL=info
EOF

echo -e "${GREEN}✅ Created optimized .env${NC}"
echo ""

# Summary
echo "=== Setup Complete ==="
echo ""
echo "📊 Installed Models:"
ollama list
echo ""
echo "⚙️  Configuration:"
echo "   Primary Model: $RECOMMENDED_MODEL"
echo "   Tool Model: qwen2:1.5b"
echo "   RAM: ${TOTAL_RAM_GB}GB"
echo ""
echo "🎯 Next Steps:"
echo "1. Edit .env to add your API keys"
echo "2. Start server: node server.js"
echo "3. Test: curl http://localhost:3001/health"
echo ""
echo "📚 Documentation:"
echo "   See OLLAMA_SETUP_LIGHTWEIGHT.md for details"
echo ""
echo -e "${GREEN}✅ Ready to use!${NC}"
