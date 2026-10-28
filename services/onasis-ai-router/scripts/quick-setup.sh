#!/bin/bash

# Quick 2-Model Setup with Onasis Branding
# For 8GB RAM systems - simple and branded

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                           ║${NC}"
echo -e "${BLUE}║      🚀 Onasis AI Service Router         ║${NC}"
echo -e "${BLUE}║   Change the world one simple solution   ║${NC}"
echo -e "${BLUE}║              at a time                    ║${NC}"
echo -e "${BLUE}║                                           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Check Ollama
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama not installed"
    echo ""
    echo "Install with:"
    echo "  curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
fi

echo -e "${GREEN}✅ Ollama installed${NC}"

# Start Ollama if needed
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "🔄 Starting Ollama service..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
fi

echo -e "${GREEN}✅ Ollama service running${NC}"
echo ""

echo "📦 Installing 2 models (will take 2-3 minutes)..."
echo ""

# Model 1: Coding
echo "1️⃣  qwen2.5-coder:3b (for coding tasks)"
if ollama list | grep -q "qwen2.5-coder:3b"; then
    echo "   Already installed ✅"
else
    echo "   Downloading... (~2GB)"
    ollama pull qwen2.5-coder:3b
    echo -e "${GREEN}   Installed ✅${NC}"
fi
echo ""

# Model 2: General + Tool Summarization
echo "2️⃣  qwen2:1.5b (for general tasks)"
if ollama list | grep -q "qwen2:1.5b"; then
    echo "   Already installed ✅"
else
    echo "   Downloading... (~1GB)"
    ollama pull qwen2:1.5b
    echo -e "${GREEN}   Installed ✅${NC}"
fi
echo ""

# Preload main model
echo "⚡ Preloading qwen2.5-coder:3b..."
echo "exit" | ollama run qwen2.5-coder:3b > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Ready to use${NC}"
echo ""

# Setup config
echo "📝 Creating branded configuration..."
if [ ! -f ".env" ]; then
    cp .env.branded .env
    echo -e "${GREEN}✅ Created .env${NC}"
    echo -e "${YELLOW}⚠️  Don't forget to add your API key in .env!${NC}"
else
    echo "   .env already exists (keeping it)"
fi
echo ""

# Create package.json if needed
if [ ! -f "package.json" ]; then
    cat > package.json << 'EOF'
{
  "name": "onasis-ai-router",
  "version": "1.0.0",
  "description": "Onasis AI Service Router with Ollama",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "node-fetch": "^2.7.0"
  }
}
EOF
    echo "📦 Installing dependencies (bun)..."
    bun install > /dev/null 2>&1 || true
fi

# Summary
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                           ║${NC}"
echo -e "${GREEN}║        ✅  Setup Complete!                ║${NC}"
echo -e "${GREEN}║                                           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "📊 Installed Models:"
ollama list
echo ""
echo "🎯 Next Steps:"
echo ""
echo "  1. Edit your API key:"
echo "     ${YELLOW}nano .env${NC}"
echo "     Change: MEMORY_API_KEY=your_actual_key"
echo ""
echo "  2. Start the server:"
echo "     ${YELLOW}node server.js${NC}"
echo ""
echo "  3. Test it:"
echo "     ${YELLOW}curl http://localhost:3001/health${NC}"
echo ""
echo "📚 Documentation:"
echo "   - Quick Start: QUICK_START.md"
echo "   - Full Guide: OLLAMA_SETUP_LIGHTWEIGHT.md"
echo ""
echo -e "${BLUE}💡 Tip: The AI responds with Onasis branding!${NC}"
echo "   Our mission: \"Change the world one simple solution at a time\""
echo ""
