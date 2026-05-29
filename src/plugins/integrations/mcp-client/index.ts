/**
 * MCP Client Plugin — Consume external MCP tools from MiuraSwarm
 * 
 * Allows connecting to MCP servers (filesystem, git, web, etc.)
 * and exposing their tools via MiuraSwarm's ToolRegistry.
 */

import { Plugin } from '../../../core/plugin-host.js';
import type { PluginHostAPI } from '../../../core/types.js';
import { MCPConnectionManager, MCPServerConfig } from './mcp-protocol.js';
import { MCPBridge } from './bridge.js';

export class MCPClientPlugin implements Plugin {
  name = 'mcp-client';
  type = 'integration' as const;
  manifest = {
    id: 'mcp-client',
    name: 'MCPClient',
    version: '1.0.0',
    type: 'integration' as const,
    capabilities: ['mcp', 'tools', 'external-integrations'],
  };

  private connectionManager: MCPConnectionManager;
  private bridge: MCPBridge;
  private servers = new Map<string, MCPServerConfig>();

  constructor() {
    this.connectionManager = new MCPConnectionManager();
    this.bridge = new MCPBridge(this.connectionManager);
  }

  getConnectionManager(): MCPConnectionManager { return this.connectionManager; }
  getBridge(): MCPBridge { return this.bridge; }

  async initialize(host: PluginHostAPI): Promise<void> {
    this.connectionManager.init();

    const toolRegistry = host.getToolRegistry();
    const commandRegistry = host.getCommandRegistry?.() as any;

    // Register MCP management tools
    toolRegistry.register({
      definition: {
        name: 'mcp_connect',
        description: 'Connect to an MCP server',
        parameters: {
          serverName: { type: 'string', description: 'Unique name for this server' },
          command: { type: 'string', description: 'Command to start the MCP server' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
          env: { type: 'object', description: 'Optional environment variables' },
        },
      },
      execute: this.handleConnect.bind(this),
    });

    toolRegistry.register({
      definition: {
        name: 'mcp_disconnect',
        description: 'Disconnect from an MCP server',
        parameters: {
          serverName: { type: 'string', description: 'Server name to disconnect' },
        },
      },
      execute: this.handleDisconnect.bind(this),
    });

    toolRegistry.register({
      definition: {
        name: 'mcp_list_servers',
        description: 'List all connected MCP servers and their tools',
        parameters: {},
      },
      execute: async () => this.handleListServers(),
    });

    toolRegistry.register({
      definition: {
        name: 'mcp_disconnect_all',
        description: 'Disconnect from all MCP servers',
        parameters: {},
      },
      execute: this.handleDisconnectAll.bind(this),
    });

    console.log('[MCPClient] Plugin activated');
  }

  async deactivate(): Promise<void> {
    await this.connectionManager.disconnectAll();
    this.bridge.clear();
    console.log('[MCPClient] Plugin deactivated');
  }

  /**
   * Connect to an MCP server
   */
  private async handleConnect(args: Record<string, unknown>): Promise<{ name: string; output: string; durationMs: number }> {
    const serverName = args.serverName as string;
    const command = args.command as string;
    const cmdArgs = (args.args as string[]) || [];
    const env = args.env as Record<string, string> | undefined;

    if (!serverName || !command) {
      return { name: 'mcp_connect', output: JSON.stringify({ success: false, error: 'serverName and command are required' }), durationMs: 0 };
    }

    const config: MCPServerConfig = { command, args: cmdArgs, env };
    this.servers.set(serverName, config);

    const state = await this.connectionManager.connect(serverName, config);

    if (state.status === 'connected') {
      // Register tools from this server
      try {
        const handlers = await this.bridge.registerServerTools(serverName);
        return {
          name: 'mcp_connect',
          output: JSON.stringify({
            success: true,
            serverName,
            toolsCount: handlers.length,
            tools: state.tools.map(t => ({ name: t.name, description: t.description })),
            message: `Connected to ${serverName} with ${handlers.length} tools`,
          }),
          durationMs: 0,
        };
      } catch (err) {
        return {
          name: 'mcp_connect',
          output: JSON.stringify({
            success: true,
            serverName,
            toolsCount: 0,
            message: `Connected to ${serverName} but failed to enumerate tools`,
            error: err instanceof Error ? err.message : undefined,
          }),
          durationMs: 0,
        };
      }
    }

    return {
      name: 'mcp_connect',
      output: JSON.stringify({
        success: false,
        serverName,
        error: state.error || 'Connection failed',
      }),
      durationMs: 0,
    };
  }

  /**
   * Disconnect from an MCP server
   */
  private async handleDisconnect(args: Record<string, unknown>): Promise<{ name: string; output: string; durationMs: number }> {
    const serverName = args.serverName as string;
    if (!serverName) {
      return { name: 'mcp_disconnect', output: JSON.stringify({ success: false, error: 'serverName is required' }), durationMs: 0 };
    }

    await this.connectionManager.disconnect(serverName);
    this.bridge.unregisterServer(serverName);
    this.servers.delete(serverName);

    return { name: 'mcp_disconnect', output: JSON.stringify({ success: true, message: `Disconnected from ${serverName}` }), durationMs: 0 };
  }

  /**
   * List all connected servers
   */
  private handleListServers(): { name: string; output: string; durationMs: number } {
    const connections = this.connectionManager.listConnections();

    return {
      name: 'mcp_list_servers',
      output: JSON.stringify({
        servers: connections.map(c => ({
          name: c.serverName,
          status: c.status,
          error: c.error,
          connectedAt: c.connectedAt,
        })),
        totalHandlers: this.bridge.getHandlers().length,
      }),
      durationMs: 0,
    };
  }

  /**
   * Disconnect from all servers
   */
  private async handleDisconnectAll(): Promise<{ name: string; output: string; durationMs: number }> {
    const count = this.connectionManager.listConnections().length;
    await this.connectionManager.disconnectAll();
    this.bridge.clear();
    this.servers.clear();

    return { name: 'mcp_disconnect_all', output: JSON.stringify({ success: true, message: `Disconnected from ${count} servers` }), durationMs: 0 };
  }
}