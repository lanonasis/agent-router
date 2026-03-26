#!/usr/bin/env node

/**
 * External MCP Client - Can be used from any external system
 * This demonstrates how external vendors (like Vibe) can connect
 */

import WebSocket from 'ws';

class OnasisMCPClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.messageId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        console.log('✅ Connected to Onasis-CORE MCP Server');
        this.initialize().then(resolve).catch(reject);
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.id && this.callbacks.has(message.id)) {
          const callback = this.callbacks.get(message.id);
          this.callbacks.delete(message.id);
          
          if (message.error) {
            callback.reject(new Error(message.error.message || 'Unknown error'));
          } else {
            callback.resolve(message.result);
          }
        }
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        reject(error);
      });
    });
  }

  async initialize() {
    return this.sendMessage({
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'External MCP Client', version: '1.0.0' }
      }
    });
  }

  async sendMessage(message) {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      message.id = id;
      message.jsonrpc = '2.0';
      
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }

  async callTool(name, args = {}) {
    return this.sendMessage({
      method: 'tools/call',
      params: {
        name: name,
        arguments: args
      }
    });
  }

  async getAvailableTools() {
    return this.sendMessage({
      method: 'tools/list'
    });
  }

  // Memory Management Methods
  async createMemory(title, content, options = {}) {
    return this.callTool('create_memory', {
      title,
      content,
      memory_type: options.memory_type || 'knowledge',
      tags: options.tags || [],
      topic_id: options.topic_id
    });
  }

  async searchMemories(query, options = {}) {
    return this.callTool('search_memories', {
      query,
      limit: options.limit || 10,
      threshold: options.threshold || 0.7,
      memory_type: options.memory_type,
      tags: options.tags
    });
  }

  async getMemory(id) {
    return this.callTool('get_memory', { id });
  }

  async listMemories(options = {}) {
    return this.callTool('list_memories', {
      limit: options.limit || 20,
      offset: options.offset || 0,
      memory_type: options.memory_type,
      tags: options.tags
    });
  }

  async updateMemory(id, updates) {
    return this.callTool('update_memory', { id, ...updates });
  }

  async deleteMemory(id) {
    return this.callTool('delete_memory', { id });
  }

  // API Key Management Methods
  async createApiKey(name, options = {}) {
    return this.callTool('create_api_key', {
      name,
      description: options.description,
      access_level: options.access_level || 'authenticated',
      expires_in_days: options.expires_in_days || 365,
      project_id: options.project_id
    });
  }

  async listApiKeys(options = {}) {
    return this.callTool('list_api_keys', {
      active_only: options.active_only !== false,
      project_id: options.project_id
    });
  }

  // Health & Status Methods
  async getHealthStatus() {
    return this.callTool('get_health_status');
  }

  async getAuthStatus() {
    return this.callTool('get_auth_status');
  }

  async getOrganizationInfo() {
    return this.callTool('get_organization_info');
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Demo usage
async function demo() {
  const client = new OnasisMCPClient('ws://localhost:9083/mcp');
  
  try {
    console.log('🔗 Connecting to Onasis-CORE MCP Server...');
    await client.connect();
    
    console.log('\n📋 Getting available tools...');
    const tools = await client.getAvailableTools();
    console.log(`Found ${tools.tools.length} tools`);
    
    console.log('\n❤️ Checking health status...');
    const health = await client.getHealthStatus();
    console.log('Health:', JSON.stringify(health, null, 2));
    
    console.log('\n🏢 Getting organization info...');
    const org = await client.getOrganizationInfo();
    console.log('Organization:', JSON.stringify(org, null, 2));
    
    console.log('\n💾 Creating test memory...');
    const memory = await client.createMemory(
      'External Client Test',
      'This memory was created by an external MCP client to test connectivity',
      { tags: ['external', 'test', 'client'] }
    );
    console.log('Created memory:', JSON.stringify(memory, null, 2));
    
    console.log('\n🔍 Searching memories...');
    const searchResults = await client.searchMemories('external client test');
    console.log('Search results:', JSON.stringify(searchResults, null, 2));
    
    console.log('\n✅ External MCP client test completed successfully!');
    
  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  } finally {
    client.close();
  }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demo();
}

export default OnasisMCPClient;