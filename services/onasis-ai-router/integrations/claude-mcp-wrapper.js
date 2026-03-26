#!/usr/bin/env node

/**
 * Claude MCP Wrapper for Onasis-CORE
 * This provides a stdio interface for Claude to connect to our WebSocket MCP server
 */

import WebSocket from 'ws';
import { createInterface } from 'readline';

const MCP_URL = 'ws://localhost:9083/mcp';
let ws = null;
let connected = false;
let messageQueue = [];

// Create readline interface for stdio
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Handle process signals
process.on('SIGINT', () => {
  if (ws) ws.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (ws) ws.close();
  process.exit(0);
});

// Connect to WebSocket MCP server
function connectToMCP() {
  ws = new WebSocket(MCP_URL);
  
  ws.on('open', () => {
    connected = true;
    // Process any queued messages
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      ws.send(message);
    }
  });
  
  ws.on('message', (data) => {
    // Forward WebSocket messages to stdout for Claude
    process.stdout.write(data.toString() + '\n');
  });
  
  ws.on('close', () => {
    connected = false;
    process.exit(1);
  });
  
  ws.on('error', (error) => {
    connected = false;
    process.exit(1);
  });
}

// Handle stdin from Claude
rl.on('line', (line) => {
  if (connected && ws && ws.readyState === WebSocket.OPEN) {
    // Forward Claude messages to WebSocket
    ws.send(line);
  } else {
    // Queue messages until connected
    messageQueue.push(line);
  }
});

// Start connection
connectToMCP();