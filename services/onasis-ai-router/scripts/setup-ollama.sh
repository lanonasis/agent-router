#!/bin/bash

# Setup script for Ollama with LanOnasis AI Router
# Downloads recommended models and configures the service

set -e

echo "🚀 Setting up Ollama for LanOnasis AI Router"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama is not installed."
    echo "Please install from: https://ollama.ai"
    echo ""
    echo "Install commands:"
    echo "  macOS/Linux: curl -fsSL https://ollama.ai/install.sh | sh"
    echo "  Or download from: https://ollama.ai/download"
    exit 1
fi

echo -e "${GREEN}✅ Ollama is installed${NC}"
echo ""

# Check if Ollama service is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Ollama service is not running${NC}"
    echo "Starting Ollama service..."

    # Try to start Ollama in background
    if command -v ollama &> /dev/null; then
        ollama serve &
        sleep 3

        if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
            echo "❌ Failed to start Ollama service"
            echo "Please start it manually: ollama serve"
            exit 1
        fi
    fi
fi

echo -e "${GREEN}✅ Ollama service is running${NC}"
echo ""

# Function to pull model if not already downloaded
pull_model() {
    local model=$1
    local description=$2

    echo "📦 Checking model: $model ($description)"

    if ollama list | grep -q "^${model}"; then
        echo -e "${GREEN}   ✅ Already downloaded${NC}"
    else
        echo "   Downloading... (this may take a few minutes)"
        if ollama pull "$model"; then
            echo -e "${GREEN}   ✅ Downloaded successfully${NC}"
        else
            echo -e "${YELLOW}   ⚠️  Failed to download${NC}"
            return 1
        fi
    fi
    echo ""
}

# Core models (essential)
echo "=== Core Models (Essential) ==="
echo ""
pull_model "deepseek-coder:6.7b" "Primary coding model - 4GB"
pull_model "qwen2:1.5b" "Tool summarization - 934MB"
echo ""

# Read user preference for additional models
echo "=== Additional Models (Recommended) ==="
echo ""
read -p "Download qwen2.5-coder:7b for fast coding? (Y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    pull_model "qwen2.5-coder:7b" "Fast coding assistant - 4.7GB"
fi

read -p "Download llama3.1:8b for general tasks? (Y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    pull_model "llama3.1:8b" "General purpose + reasoning - 4.7GB"
fi

# Advanced models (optional)
echo ""
echo "=== Advanced Models (Optional) ==="
echo ""
read -p "Download deepseek-coder:33b for complex analysis? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  This is a large model (19GB) and requires significant RAM${NC}"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pull_model "deepseek-coder:33b" "Advanced coding - 19GB"
    fi
fi

# Preload the primary model
echo "=== Preloading Primary Model ==="
echo ""
echo "Preloading deepseek-coder:6.7b into memory..."
echo "exit" | ollama run deepseek-coder:6.7b > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Model preloaded${NC}"
echo ""

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env configuration..."
    cp .env.template .env
    echo -e "${GREEN}✅ Created .env from template${NC}"
    echo -e "${YELLOW}⚠️  Please edit .env to add your API keys${NC}"
else
    echo -e "${GREEN}✅ .env already exists${NC}"
fi
echo ""

# Display summary
echo "=== Setup Complete ==="
echo ""
echo "📊 Installed Models:"
ollama list
echo ""
echo "🎯 Next Steps:"
echo "1. Edit .env to configure your API keys"
echo "2. Start the router: node ai-service-router.js"
echo "3. Test with: curl http://localhost:3001/ai-health"
echo ""
echo "📚 For more info, see: OLLAMA_SETUP.md"
echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
