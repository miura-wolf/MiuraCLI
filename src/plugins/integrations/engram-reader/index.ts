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

  /**
   * Late-bind the `/memory` slash command (alias `/mem`) into the
   * CLI's CommandRegistry. Same pattern as CompactionManagerPlugin:
   * the registry doesn't exist during `initialize()` so the command
   * is registered here, called by the REPL after the registry exists.
   *
   * The command is purely read-only — searches the project's Engram
   * context, shows recent observations, or fetches one by id. The
   * current "project" defaults to `miura-swarm` (the canonical
   * Engram scope) and can be overridden per-session by the caller
   * passing `args.project`.
   */
  registerCommands(registry: {
    register: (cmd: {
      name: string;
      aliases?: string[];
      description: string;
      usage: string;
      handler: (ctx: unknown, args: string) => Promise<unknown>;
    }) => void;
  }): void {
    // Per-instance state for the project scope. Kept in the closure
    // so it survives across multiple `/memory` invocations within the
    // same REPL session.
    let currentProject: string | undefined;
    const handle = async (
      _ctx: unknown,
      rawArgs: string,
    ): Promise<{ output: string; type: string }> => {
      // Default project scope. In a real session this would be read
      // from the working directory or a config flag, but for the
      // slash command the user passes it explicitly via `/memory
      // project <name>` or we fall back to a hard-coded default.
      const project = currentProject ?? 'miura-swarm';
      const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] ?? 'help').toLowerCase();
      const rest = parts.slice(1).join(' ');
      try {
        switch (sub) {
          case 'recent': {
            const n = Math.max(1, Math.min(50, Number(rest) || 10));
            const obs = await this.getRecentContext(project, n);
            return {
              output: formatObservations(
                obs,
                `Recent ${obs.length} observation${obs.length === 1 ? '' : 's'} for \`${project}\``,
              ),
              type: 'text',
            };
          }
          case 'search': {
            if (!rest) {
              return {
                output: 'Usage: /memory search <query>',
                type: 'error',
              };
            }
            const obs = await this.searchContext(rest, project);
            return {
              output: formatObservations(
                obs,
                `Search results for "${rest}" in \`${project}\` (${obs.length} hit${obs.length === 1 ? '' : 's'})`,
              ),
              type: 'text',
            };
          }
          case 'get': {
            const id = Number(rest);
            if (!Number.isFinite(id) || id <= 0) {
              return {
                output: `Invalid observation id: "${rest}". Pass a positive number.`,
                type: 'error',
              };
            }
            const obs = await this.getObservation(Math.floor(id));
            if (!obs) {
              return {
                output: `No observation with id ${id}.`,
                type: 'info',
              };
            }
            return {
              output:
                `Observation #${obs.id} — ${obs.title}\n` +
                `  type: ${obs.type}\n` +
                `  created: ${obs.createdAt}\n` +
                (obs.project ? `  project: ${obs.project}\n` : '') +
                `\n${obs.content}`,
              type: 'text',
            };
          }
          case 'project': {
            if (!rest) {
              return {
                output: `Current project scope: \`${project}\`\nSet with: /memory project <name>`,
                type: 'info',
              };
            }
            currentProject = rest;
            return {
              output: `Project scope set to \`${rest}\`.`,
              type: 'success',
            };
          }
          case 'help':
          default:
            return {
              output:
                'Memory commands (read-only Engram bridge):\n' +
                '  /memory recent [N]    — show last N observations for current project (default 10)\n' +
                '  /memory search <q>     — search observations by keyword\n' +
                '  /memory get <id>       — show a specific observation\n' +
                '  /memory project [name] — show or change the current project scope\n' +
                '  /memory help           — this help',
              type: 'info',
            };
        }
      } catch (err: any) {
        return {
          output: `Memory command failed: ${err?.message ?? 'unknown error'}`,
          type: 'error',
        };
      }
    };
    registry.register({
      name: 'memory',
      aliases: ['mem'],
      description:
        'Read-only bridge to Engram — search, recent, get, and project scope',
      usage: '[recent [N] | search <q> | get <id> | project [name] | help]',
      handler: handle,
    });
  }
}

/**
 * Format a list of Engram observations as a multi-line CLI block.
 * Truncates long content at 200 chars per entry so a single `/memory
 * recent 50` doesn't blow up the terminal.
 */
function formatObservations(
  obs: EngramObservation[],
  heading: string,
): string {
  if (obs.length === 0) {
    return `${heading}\n  (none)`;
  }
  const lines = [heading];
  for (const o of obs) {
    const preview = o.content.replace(/\s+/g, ' ').trim().slice(0, 200);
    const ellipsis = o.content.length > 200 ? '…' : '';
    lines.push(`  #${o.id} [${o.type}] ${o.title}`);
    lines.push(`    ${preview}${ellipsis}`);
  }
  return lines.join('\n');
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
  async search(_query: string, _project?: string): Promise<EngramObservation[]> {
    // This is a stub — in production, this calls the Engram MCP server
    // via stdio/SSE transport. For now, return empty results.
    // The actual integration happens when MiuraSwarm is run as a
    // sub-process of the host that has Engram MCP configured.
    return [];
  }

  async getById(_id: number): Promise<EngramObservation | null> {
    return null;
  }

  async context(_project?: string, _limit?: number): Promise<EngramObservation[]> {
    return [];
  }
}
