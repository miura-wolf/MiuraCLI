/**
 * MCP Bridge — Translates MCP tool calls to MiuraSwarm ToolHandler format
 */

import { MCPConnectionManager, MCPToolCall, MCPToolResult, MCPToolDefinition, MCPServerConfig } from './mcp-protocol.js';
import { ToolHandler } from '../../../core/types.js';

export interface MCPToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<MCPToolResult>;
}

export class MCPBridge {
  private connectionManager: MCPConnectionManager;
  private registeredHandlers = new Map<string, ToolHandler>();

  constructor(connectionManager: MCPConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Register all tools from a connected MCP server as ToolHandlers
   */
  async registerServerTools(serverName: string): Promise<ToolHandler[]> {
    const client = this.connectionManager.getClient(serverName);
    if (!client) {
      throw new Error(`Server not connected: ${serverName}`);
    }

    const mcpTools = await client.listTools();
    const handlers: ToolHandler[] = [];

    for (const mcpTool of mcpTools) {
      const handler = this.createHandler(serverName, mcpTool);
      this.registeredHandlers.set(handler.name, handler as unknown as ToolHandler);
      handlers.push(handler as unknown as ToolHandler);
    }

    return handlers;
  }

  /**
   * Create a ToolHandler from an MCP tool definition
   */
  private createHandler(serverName: string, mcpTool: MCPToolDefinition): MCPToolHandler & ToolHandler {
    const name = `mcp_${serverName}_${mcpTool.name}`;
    
    return {
      name,
      description: `[MCP:${serverName}] ${mcpTool.description}`,
      parameters: mcpTool.inputSchema as Record<string, unknown>,
      definition: {
        name,
        description: `[MCP:${serverName}] ${mcpTool.description}`,
        parameters: mcpTool.inputSchema as Record<string, unknown>,
      },
      execute: async (args: Record<string, unknown>) => {
        const client = this.connectionManager.getClient(serverName);
        if (!client) {
          return {
            name,
            output: `Error: MCP server disconnected: ${serverName}`,
            durationMs: 0,
          };
        }

        try {
          const result = await client.callTool(mcpTool.name, args);

          return {
            name,
            output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            durationMs: 0,
          };
        } catch (err) {
          return {
            name,
            output: `Error: ${err instanceof Error ? err.message : 'MCP tool call failed'}`,
            durationMs: 0,
          };
        }
      },
    };
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): ToolHandler[] {
    return Array.from(this.registeredHandlers.values());
  }

  /**
   * Get handler by name
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.registeredHandlers.get(name);
  }

  /**
   * Remove all handlers for a server
   */
  unregisterServer(serverName: string): void {
    const prefix = `mcp_${serverName}_`;
    for (const [name] of this.registeredHandlers) {
      if (name.startsWith(prefix)) {
        this.registeredHandlers.delete(name);
      }
    }
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.registeredHandlers.clear();
  }
}