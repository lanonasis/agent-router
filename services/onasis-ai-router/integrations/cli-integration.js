#!/usr/bin/env node

/**
 * CLI Integration for Enhanced Onasis-Core MCP Server
 * Extends @lanonasis/cli with WebSocket MCP capabilities
 */

require('dotenv').config();
// import { spawn } from 'child_process'; // Unused - removed to fix lint
const WebSocket = require('ws');

class OnasisCoreMCPClient {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || process.env.MCP_WEBSOCKET_URL || 'ws://localhost:3002/mcp/ws';
    this.apiKey = options.apiKey || process.env.LANONASIS_API_KEY;
    this.mode = options.mode || 'local'; // local, websocket, hybrid
    this.logger = console;
    
    this.ws = null;
    this.connected = false;
    this.messageId = 0;
    this.pendingRequests = new Map();
  }
  
  async start(mode = this.mode) {
    this.mode = mode;
    
    switch (mode) {
      case 'local':
        return this.startLocalServer();
        
      case 'websocket':
        return this.connectToWebSocketServer();
        
      case 'hybrid':
        return this.startHybridMode();
        
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }
  }
  
  async startLocalServer() {
    this.logger.log('🔧 Starting local MCP server (existing behavior)...');
    
    // This would integrate with existing @lanonasis/cli local server
    // For now, simulate local server startup
    return new Promise((resolve) => {
      setTimeout(() => {
        this.logger.log('✅ Local MCP server started on stdio');
        resolve({
          mode: 'local',
          transport: 'stdio',
          capabilities: ['memory_management', 'basic_tools']
        });
      }, 1000);
    });
  }
  
  async connectToWebSocketServer() {
    this.logger.log('🚀 Connecting to enhanced Onasis-Core MCP WebSocket server...');
    
    if (!this.apiKey) {
      throw new Error('API key required for WebSocket mode. Set LANONASIS_API_KEY environment variable.');
    }
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl, {
          headers: {
            'X-API-Key': this.apiKey,
            'User-Agent': 'Onasis-CLI-Enhanced/1.0.0'
          }
        });
        
        this.ws.on('open', () => {
          this.connected = true;
          this.logger.log('✅ Connected to enhanced MCP WebSocket server');
          
          // Initialize MCP protocol
          this.sendMessage({
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {
                roots: {
                  listChanged: true
                }
              },
              clientInfo: {
                name: 'Onasis-CLI-Enhanced',
                version: '1.0.0'
              }
            }
          }).then((response) => {
            this.logger.log('🎯 MCP protocol initialized');
            resolve({
              mode: 'websocket',
              transport: 'websocket',
              serverInfo: response.result.serverInfo,
              capabilities: response.result.capabilities
            });
          }).catch(reject);
        });
        
        this.ws.on('message', (data) => {
          this.handleMessage(JSON.parse(data.toString()));
        });
        
        this.ws.on('error', (error) => {
          this.logger.error('WebSocket error:', error);
          reject(error);
        });
        
        this.ws.on('close', () => {
          this.connected = false;
          this.logger.log('🔌 Disconnected from MCP WebSocket server');
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  async startHybridMode() {
    this.logger.log('🔄 Starting hybrid mode...');
    
    // Use WebSocket for production, local for development
    const mode = process.env.NODE_ENV === 'production' ? 'websocket' : 'local';
    this.logger.log(`📊 Hybrid mode selected: ${mode} (NODE_ENV: ${process.env.NODE_ENV || 'development'})`);
    
    return this.start(mode);
  }
  
  async sendMessage(message) {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected to WebSocket server');
    }
    
    const id = ++this.messageId;
    message.id = id;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      this.ws.send(JSON.stringify(message));
      
      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
      
      // Store timeout reference for cleanup
      this.pendingRequests.get(id).timeout = timeout;
    });
  }
  
  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      if (message.type === 'error') {
        reject(new Error(message.error.message));
      } else {
        resolve(message);
      }
    } else if (message.type === 'connection_ack') {
      this.logger.log(`🎉 Connection acknowledged: ${message.session_id}`);
    } else {
      this.logger.log('📨 Received message:', message);
    }
  }
  
  async listTools() {
    if (this.mode === 'local') {
      // Return local tools
      return {
        tools: [
          {
            name: 'create_memory',
            description: 'Create a new memory entry (local)',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'search_memories', 
            description: 'Search memories (local)',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      };
    }
    
    const response = await this.sendMessage({
      method: 'tools/list',
      params: {}
    });
    
    return response.result;
  }
  
  async callTool(name, args) {
    if (this.mode === 'local') {
      // Simulate local tool execution
      this.logger.log(`🔧 Executing local tool: ${name}`);
      return {
        content: [
          {
            type: 'text',
            text: `Local tool ${name} executed with args: ${JSON.stringify(args, null, 2)}`
          }
        ]
      };
    }
    
    const response = await this.sendMessage({
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });
    
    return response.result;
  }
  
  async createMemory(title, content, type = 'knowledge', tags = []) {
    return this.callTool('create_memory', {
      title,
      content,
      type,
      tags
    });
  }
  
  async searchMemories(query, options = {}) {
    return this.callTool('search_memories', {
      query,
      ...options
    });
  }
  
  async orchestrateWorkflow(description, options = {}) {
    if (this.mode === 'local') {
      throw new Error('Workflow orchestration requires WebSocket mode (enhanced server)');
    }
    
    return this.callTool('orchestrate_workflow', {
      workflow_description: description,
      ...options
    });
  }
  
  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.connected = false;
    }
  }
  
  getStats() {
    return {
      mode: this.mode,
      connected: this.connected,
      pending_requests: this.pendingRequests.size,
      server_url: this.serverUrl
    };
  }
}

// CLI Commands
class OnasisCoreMCPCLI {
  constructor() {
    this.client = null;
  }
  
  async run(args) {
    const command = args[2];
    const subcommand = args[3];
    
    try {
      switch (command) {
        case 'mcp':
          await this.handleMCPCommand(subcommand, args.slice(4));
          break;
          
        default:
          this.showHelp();
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  }
  
  async handleMCPCommand(subcommand, args) {
    switch (subcommand) {
      case 'start':
        await this.startMCPServer(args);
        break;
        
      case 'test':
        await this.testConnection(args);
        break;
        
      case 'tools':
        await this.listTools(args);
        break;
        
      case 'call':
        await this.callTool(args);
        break;
        
      case 'workflow':
        await this.orchestrateWorkflow(args);
        break;
        
      default:
        this.showMCPHelp();
    }
  }
  
  async startMCPServer(args) {
    const mode = this.parseFlag(args, '--mode') || 'local';
    const port = this.parseFlag(args, '--port') || process.env.MCP_WEBSOCKET_PORT || '3002';
    
    console.log(`🚀 Starting Onasis-Core MCP server in ${mode} mode...`);
    
    this.client = new OnasisCoreMCPClient({
      mode,
      serverUrl: `ws://localhost:${port}/mcp/ws`
    });
    
    const info = await this.client.start();
    
    console.log('✅ MCP Server started successfully!');
    console.log('📊 Server Info:', JSON.stringify(info, null, 2));
    
    // Keep the process running for WebSocket mode
    if (mode === 'websocket') {
      console.log('🔄 WebSocket mode - keeping connection alive...');
      console.log('Press Ctrl+C to disconnect');
      
      process.on('SIGINT', async () => {
        console.log('\n🔌 Disconnecting...');
        await this.client.disconnect();
        process.exit(0);
      });
      
      // Keep alive
      setInterval(() => {
        const stats = this.client.getStats();
        if (stats.connected) {
          console.log(`💓 Connected - Mode: ${stats.mode}, Pending: ${stats.pending_requests}`);
        }
      }, 30000);
    }
  }
  
  async testConnection(args) {
    const mode = this.parseFlag(args, '--mode') || 'websocket';
    
    console.log(`🧪 Testing MCP connection in ${mode} mode...`);
    
    this.client = new OnasisCoreMCPClient({ mode });
    
    try {
      const info = await this.client.start();
      console.log('✅ Connection test successful!');
      console.log('📊 Connection Info:', JSON.stringify(info, null, 2));
      
      // Test basic functionality
      const tools = await this.client.listTools();
      console.log(`🔧 Available tools: ${tools.tools.length}`);
      
      await this.client.disconnect();
      
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      process.exit(1);
    }
  }
  
  async listTools(args) {
    const mode = this.parseFlag(args, '--mode') || 'websocket';
    
    this.client = new OnasisCoreMCPClient({ mode });
    await this.client.start();
    
    const tools = await this.client.listTools();
    
    console.log('🔧 Available MCP Tools:');
    tools.tools.forEach(tool => {
      console.log(`  • ${tool.name}: ${tool.description}`);
    });
    
    await this.client.disconnect();
  }
  
  async callTool(args) {
    const toolName = args[0];
    const argsJson = args[1];
    
    if (!toolName) {
      console.error('❌ Tool name required');
      return;
    }
    
    let toolArgs = {};
    if (argsJson) {
      try {
        toolArgs = JSON.parse(argsJson);
      } catch (error) {
        console.error('❌ Invalid JSON arguments:', error.message);
        return;
      }
    }
    
    this.client = new OnasisCoreMCPClient({ mode: 'websocket' });
    await this.client.start();
    
    console.log(`🔧 Calling tool: ${toolName}`);
    const result = await this.client.callTool(toolName, toolArgs);
    
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
    await this.client.disconnect();
  }
  
  async orchestrateWorkflow(args) {
    const description = args.join(' ');
    
    if (!description) {
      console.error('❌ Workflow description required');
      return;
    }
    
    this.client = new OnasisCoreMCPClient({ mode: 'websocket' });
    await this.client.start();
    
    console.log(`🎯 Orchestrating workflow: ${description}`);
    const result = await this.client.orchestrateWorkflow(description);
    
    console.log('📊 Workflow Result:', JSON.stringify(result, null, 2));
    
    await this.client.disconnect();
  }
  
  parseFlag(args, flag) {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
  }
  
  showHelp() {
    console.log(`
🚀 Onasis-Core Enhanced MCP CLI

USAGE:
  node cli-integration.js mcp <command> [options]

COMMANDS:
   start [--mode local|websocket|hybrid] [--port 3002]
    Start MCP server in specified mode
    Default WebSocket target can be set with MCP_WEBSOCKET_URL or MCP_WEBSOCKET_PORT
    
  test [--mode websocket]
    Test connection to MCP server
    
  tools [--mode websocket]
    List available MCP tools
    
  call <tool_name> [args_json]
    Call a specific MCP tool
    
  workflow <description>
    Orchestrate a complex workflow (WebSocket mode only)

EXAMPLES:
  node cli-integration.js mcp start --mode websocket
  node cli-integration.js mcp test
  node cli-integration.js mcp tools
  node cli-integration.js mcp call create_memory '{"title":"Test","content":"Hello","type":"knowledge"}'
  node cli-integration.js mcp workflow "Analyze sales data and create report"
`);
  }
  
  showMCPHelp() {
    console.log(`
🔧 MCP Commands:
  start    - Start MCP server
  test     - Test connection
  tools    - List available tools
  call     - Call a tool
  workflow - Orchestrate workflow
`);
  }
}

// CLI execution
if (require.main === module) {
  const cli = new OnasisCoreMCPCLI();
  cli.run(process.argv);
}

module.exports = { OnasisCoreMCPClient, OnasisCoreMCPCLI };
