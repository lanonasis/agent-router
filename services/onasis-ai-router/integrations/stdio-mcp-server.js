#!/usr/bin/env node

/**
 * Stdio MCP Server for Onasis-CORE
 * Provides a proper MCP stdio interface that connects to our WebSocket backend
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

// MCP Protocol Compliance: Redirect all console output to stderr
const originalConsoleError = console.error;
console.log = (...args) => originalConsoleError('[MCP-LOG]', ...args);
console.error = (...args) => originalConsoleError('[MCP-ERROR]', ...args);
console.warn = (...args) => originalConsoleError('[MCP-WARN]', ...args);
console.info = (...args) => originalConsoleError('[MCP-INFO]', ...args);

// Disable colors for MCP protocol compliance
process.env.FORCE_COLOR = '0';
process.env.DEBUG = '';

class OnasisCoreStdioMCPServer {
  constructor() {
    this.wsUrl = process.env.MCP_WEBSOCKET_URL || 'wss://mcp.lanonasis.com/mcp';
    this.ws = null;
    this.connected = false;
    this.messageId = 1;
    
    this.server = new Server(
      {
        name: 'onasis-core-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.connectToBackend();
  }

  async connectToBackend() {
    try {
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.on('open', () => {
        this.connected = true;
        console.error('Connected to Onasis-CORE WebSocket backend');
      });
      
      this.ws.on('close', () => {
        this.connected = false;
        console.error('Disconnected from backend');
      });
      
      this.ws.on('error', (error) => {
        console.error('Backend connection error:', error.message);
      });
    } catch (error) {
      console.error('Failed to connect to backend:', error.message);
    }
  }

  async callBackendTool(name, args) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) {
        reject(new Error('Not connected to backend'));
        return;
      }

      const id = this.messageId++;
      const message = {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name,
          arguments: args
        }
      };

      // Set up response handler
      const timeout = setTimeout(() => {
        reject(new Error('Backend request timeout'));
      }, 10000);

      const messageHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === id) {
            clearTimeout(timeout);
            this.ws.off('message', messageHandler);
            
            if (response.error) {
              reject(new Error(response.error.message || 'Backend error'));
            } else {
              resolve(response.result);
            }
          }
        } catch (error) {
          // Ignore parsing errors for other messages
        }
      };

      this.ws.on('message', messageHandler);
      this.ws.send(JSON.stringify(message));
    });
  }

  setupToolHandlers() {
    // Memory Management Tools
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        const result = await this.callBackendTool(name, args || {});
        return result;
      } catch (error) {
        throw new Error(`Tool ${name} failed: ${error.message}`);
      }
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Memory Management Tools
          {
            name: 'create_memory',
            description: 'Create a new memory entry with vector embedding',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Memory title' },
                content: { type: 'string', description: 'Memory content' },
                memory_type: { type: 'string', enum: ['context', 'project', 'knowledge', 'reference', 'personal', 'workflow'] },
                tags: { type: 'array', items: { type: 'string' } },
                topic_id: { type: 'string', description: 'Topic ID for organization' }
              },
              required: ['title', 'content']
            }
          },
          {
            name: 'search_memories',
            description: 'Search through memories with semantic vector search',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', default: 10 },
                threshold: { type: 'number', default: 0.7 },
                memory_type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }
              },
              required: ['query']
            }
          },
          {
            name: 'get_memory',
            description: 'Get a specific memory by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory ID' }
              },
              required: ['id']
            }
          },
          {
            name: 'update_memory',
            description: 'Update an existing memory',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory ID' },
                title: { type: 'string' },
                content: { type: 'string' },
                memory_type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }
              },
              required: ['id']
            }
          },
          {
            name: 'delete_memory',
            description: 'Delete a memory by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory ID' }
              },
              required: ['id']
            }
          },
          {
            name: 'list_memories',
            description: 'List memories with pagination and filters',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { type: 'number', default: 20 },
                offset: { type: 'number', default: 0 },
                memory_type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          // API Key Management Tools
          {
            name: 'create_api_key',
            description: 'Create a new API key',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'API key name' },
                description: { type: 'string' },
                access_level: { type: 'string', enum: ['public', 'authenticated', 'team', 'admin', 'enterprise'] },
                expires_in_days: { type: 'number', default: 365 },
                project_id: { type: 'string' }
              },
              required: ['name']
            }
          },
          {
            name: 'list_api_keys',
            description: 'List API keys',
            inputSchema: {
              type: 'object',
              properties: {
                active_only: { type: 'boolean', default: true },
                project_id: { type: 'string' }
              }
            }
          },
          {
            name: 'rotate_api_key',
            description: 'Rotate an API key',
            inputSchema: {
              type: 'object',
              properties: {
                key_id: { type: 'string', description: 'API key ID to rotate' }
              },
              required: ['key_id']
            }
          },
          {
            name: 'delete_api_key',
            description: 'Delete an API key',
            inputSchema: {
              type: 'object',
              properties: {
                key_id: { type: 'string', description: 'API key ID to delete' }
              },
              required: ['key_id']
            }
          },
          // System Tools
          {
            name: 'get_health_status',
            description: 'Get system health status',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'get_auth_status',
            description: 'Get authentication status',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'get_organization_info',
            description: 'Get organization information',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'create_project',
            description: 'Create a new project',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Project name' },
                description: { type: 'string' },
                organization_id: { type: 'string' }
              },
              required: ['name']
            }
          },
          {
            name: 'list_projects',
            description: 'List projects',
            inputSchema: {
              type: 'object',
              properties: {
                organization_id: { type: 'string' }
              }
            }
          },
          {
            name: 'get_config',
            description: 'Get configuration settings',
            inputSchema: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Specific config key to retrieve' }
              }
            }
          },
          {
            name: 'set_config',
            description: 'Set configuration setting',
            inputSchema: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Configuration key' },
                value: { type: 'string', description: 'Configuration value' }
              },
              required: ['key', 'value']
            }
          }
        ]
      };
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Onasis-CORE stdio MCP server running');
  }
}

// Handle process signals
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Start the server
const server = new OnasisCoreStdioMCPServer();
server.run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});