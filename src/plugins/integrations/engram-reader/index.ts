import type { Plugin, PluginHostAPI } from '../../../core/types.js';

/**
 * Engram Reader — READ-ONLY bridge to existing Engram MCP.
 *
 * MiuraSwarm reads project context from Engram but NEVER writes.
 * All writes go to MiuraSwarm's own SQLite state store.
 */
export class EngramReaderPlugin implements Plugin {
  manifest = {
    id: 'integration-engram-reader',
    name: 'Engram Reader',
    version: '0.1.0',
    type: 'integration' as const,
    capabilities: ['engram-read', 'memory-search'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private mcpClient: EngramMCPClient | null = null;

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
    this.mcpClient = new EngramMCPClient();
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {
    this.mcpClient = null;
  }

  /**
   * Search Engram for relevant project context.
   * Returns observations that match the query — READ-ONLY.
   */
  async searchContext(query: string, project?: string): Promise<EngramObservation[]> {
    if (!this.mcpClient) return [];
    return this.mcpClient.search(query, project);
  }

  /**
   * Get a specific observation by ID — READ-ONLY.
   */
  async getObservation(id: number): Promise<EngramObservation | null> {
    if (!this.mcpClient) return null;
    return this.mcpClient.getById(id);
  }

  /**
   * Get recent session context — READ-ONLY.
   */
  async getRecentContext(project?: string, limit?: number): Promise<EngramObservation[]> {
    if (!this.mcpClient) return [];
    return this.mcpClient.context(project, limit);
  }
}

export interface EngramObservation {
  id: number;
  title: string;
  type: string;
  content: string;
  project?: string;
  scope?: string;
  createdAt: string;
}

/**
 * Client that calls Engram MCP tools via the plugin host's event system.
 * In production, this would connect to the Engram MCP server directly.
 * For now, it uses the host's event bus to communicate.
 */
class EngramMCPClient {
  async search(query: string, project?: string): Promise<EngramObservation[]> {
    // This is a stub — in production, this calls the Engram MCP server
    // via stdio/SSE transport. For now, return empty results.
    // The actual integration happens when MiuraSwarm is run as a
    // sub-process of the host that has Engram MCP configured.
    return [];
  }

  async getById(id: number): Promise<EngramObservation | null> {
    return null;
  }

  async context(project?: string, limit?: number): Promise<EngramObservation[]> {
    return [];
  }
}
