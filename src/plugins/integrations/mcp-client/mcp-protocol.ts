/**
 * MCP (Model Context Protocol) implementation
 * 
 * Implements the JSON-RPC 2.0 based protocol for communicating
 * with MCP servers via stdio transport.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

export interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPConnectionState {
  serverName: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  tools: MCPToolDefinition[];
  resources: MCPResourceDefinition[];
  error?: string;
  connectedAt?: number;
}

export interface MCPToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export type MCPToolResult = string | Record<string, unknown>;

// =============================================================================
// MCP Protocol Client (over stdio)
// =============================================================================

export class MCPStdioClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = '';
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Connect to an MCP server via stdio
   */
  async connect(config: MCPServerConfig, timeoutMs = 5000): Promise<void> {
    if (this.process) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        this.process = spawn(config.command, config.args, {
          env: { ...process.env, ...config.env } as Record<string, string>,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle stdout
        this.process.stdout?.on('data', (data: Buffer) => {
          this.buffer += data.toString();
          this.processBuffer();
        });

        // Handle stderr (MCP servers log here)
        this.process.stderr?.on('data', (data: Buffer) => {
          this.emit('stderr', data.toString());
        });

        // Handle process exit
        this.process.on('exit', (code) => {
          this._connected = false;
          this.emit('disconnected', { code });
          
          // Reject all pending requests
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`MCP server disconnected (code: ${code})`));
          }
          this.pendingRequests.clear();
        });

        this.process.on('error', (err) => {
          clearTimeout(timer);
          this._connected = false;
          this.emit('error', err);
          reject(err);
        });

        // Send initialize request
        this.send('initialize', {
          protocolVersion: '0.1.0',
          capabilities: {},
          clientInfo: { name: 'miuraswarm-mcp-client', version: '0.1.0' },
        }).then((result) => {
          clearTimeout(timer);
          this._connected = true;
          this.emit('connected', result);
          resolve();
        }).catch(reject);

      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.process) return;

    // Send shutdown
    try {
      await this.send('shutdown', {});
    } catch {
      // Ignore shutdown errors
    }

    this.process.kill();
    this.process = null;
    this._connected = false;
    this.buffer = '';
    this.emit('disconnected', { code: 0 });
  }

  /**
   * List available tools from the MCP server
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    const result = await this.send('tools/list', {});
    // Handle both { tools: [...] } and [...] formats
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object' && 'tools' in (result as Record<string, unknown>)) {
      return (result as Record<string, unknown>).tools as MCPToolDefinition[];
    }
    return [];
  }

  /**
   * List available resources from the MCP server
   */
  async listResources(): Promise<MCPResourceDefinition[]> {
    const result = await this.send('resources/list', {});
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object' && 'resources' in (result as Record<string, unknown>)) {
      return (result as Record<string, unknown>).resources as MCPResourceDefinition[];
    }
    return [];
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const result = await this.send('tools/call', {
      name: toolName,
      arguments: args,
    });
    
    // MCP tools return content arrays
    if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>)) {
      const content = (result as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        return content.map((c: Record<string, unknown>) => c.text || '').join('\n');
      }
    }
    
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  /**
   * Send a JSON-RPC request
   */
  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    
    const request: MCPRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('MCP server not connected'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000); // 30s timeout

      this.pendingRequests.set(id, { resolve, reject, timer });
      
      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);
    });
  }

  /**
   * Process buffered stdout data (JSON-RPC responses)
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const response = JSON.parse(trimmed) as MCPResponse;
        this.handleResponse(response);
      } catch {
        // Not JSON — might be server logging to stdout
        this.emit('message', trimmed);
      }
    }
  }

  /**
   * Handle a JSON-RPC response
   */
  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      // Unsolicited notification
      this.emit('notification', response);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }
}

// =============================================================================
// MCP Connection Manager
// =============================================================================

export class MCPConnectionManager extends EventEmitter {
  private connections = new Map<string, MCPStdioClient>();
  private _initialized = false;

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize connection manager
   */
  init(): void {
    this._initialized = true;
  }

  /**
   * Connect to a server
   */
  async connect(serverName: string, config: MCPServerConfig): Promise<MCPConnectionState> {
    if (this.connections.has(serverName)) {
      await this.disconnect(serverName);
    }

    const client = new MCPStdioClient();
    
    client.on('connected', () => {
      this.emit('server.connected', { serverName });
    });

    client.on('disconnected', (data) => {
      this.emit('server.disconnected', { serverName, ...data });
    });

    client.on('error', (err) => {
      this.emit('server.error', { serverName, error: err.message });
    });

    try {
      await client.connect(config);
      this.connections.set(serverName, client);

      // Fetch tools
      const tools = await client.listTools();
      
      return {
        serverName,
        status: 'connected',
        tools,
        resources: [],
        connectedAt: Date.now(),
      };
    } catch (err) {
      return {
        serverName,
        status: 'error',
        tools: [],
        resources: [],
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnect(serverName: string): Promise<void> {
    const client = this.connections.get(serverName);
    if (client) {
      await client.disconnect();
      this.connections.delete(serverName);
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    await Promise.all(names.map(name => this.disconnect(name)));
  }

  /**
   * Get a client by server name
   */
  getClient(serverName: string): MCPStdioClient | undefined {
    return this.connections.get(serverName);
  }

  /**
   * List all connected servers
   */
  listConnections(): MCPConnectionState[] {
    const states: MCPConnectionState[] = [];
    
    for (const [name, client] of this.connections) {
      states.push({
        serverName: name,
        status: client.connected ? 'connected' : 'disconnected',
        tools: [],
        resources: [],
      });
    }
    
    return states;
  }

  /**
   * Get all tools from all connected servers
   */
  async getAllTools(): Promise<Array<{ serverName: string; tool: MCPToolDefinition }>> {
    const allTools: Array<{ serverName: string; tool: MCPToolDefinition }> = [];
    
    for (const [name, client] of this.connections) {
      try {
        const tools = await client.listTools();
        for (const tool of tools) {
          allTools.push({ serverName: name, tool });
        }
      } catch {
        // Skip servers that fail
      }
    }
    
    return allTools;
  }
}