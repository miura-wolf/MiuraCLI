import { Plugin } from '../../../core/plugin-host.js';
import type { PluginHostAPI } from '../../../core/types.js';
import { OpenSpecManager } from './openspec-manager.js';
import { ChangeProposal, TaskItem, SpecDelta, VerificationResult, ArchiveRecord } from './types.js';

export class OpenSpecManagerPlugin implements Plugin {
  name = 'openspec-manager';
  type = 'knowledge' as const;
  manifest = {
    id: 'openspec-manager',
    name: 'OpenSpecManager',
    version: '1.0.0',
    type: 'knowledge' as const,
    capabilities: ['openspec', 'specs', 'proposals'],
  };

  private manager: OpenSpecManager;

  constructor(projectRoot?: string) {
    this.manager = new OpenSpecManager(projectRoot);
  }

  getManager(): OpenSpecManager {
    return this.manager;
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    const toolRegistry = host.getToolRegistry();
    const commandRegistry = host.getCommandRegistry?.() as any;

    // Register MCP tools
    toolRegistry.register({
      definition: {
        name: 'openspec_init',
        description: 'Initialize OpenSpec directory structure in the project',
        parameters: {},
      },
      execute: async () => {
        const result = this.manager.init();
        return { name: 'openspec_init', output: JSON.stringify(result), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_list_specs',
        description: 'List all capability specs',
        parameters: {},
      },
      execute: async () => {
        const result = this.manager.listSpecs();
        return { name: 'openspec_list_specs', output: JSON.stringify(result), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_get_spec',
        description: 'Get a spec document by capability ID',
        parameters: {
          capabilityId: { type: 'string', description: 'Capability identifier' },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const capabilityId = args.capabilityId as string;
        if (!capabilityId) return { name: 'openspec_get_spec', output: JSON.stringify({ error: 'capabilityId is required' }), durationMs: 0 };
        const result = this.manager.getSpec(capabilityId);
        return { name: 'openspec_get_spec', output: JSON.stringify(result ?? { error: 'Spec not found' }), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_add_spec',
        description: 'Add a new capability spec',
        parameters: {
          capabilityId: { type: 'string', description: 'Capability identifier' },
          content: { type: 'string', description: 'Spec markdown content' },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const capabilityId = args.capabilityId as string;
        const content = args.content as string;
        if (!capabilityId || !content) return { name: 'openspec_add_spec', output: JSON.stringify({ error: 'capabilityId and content are required' }), durationMs: 0 };
        const result = this.manager.addSpec(capabilityId, content);
        return { name: 'openspec_add_spec', output: JSON.stringify(result), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_search_specs',
        description: 'Search specs by keyword',
        parameters: {
          query: { type: 'string', description: 'Search query' },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        if (!query) return { name: 'openspec_search_specs', output: JSON.stringify({ error: 'query is required' }), durationMs: 0 };
        const result = this.manager.searchSpecs(query);
        return { name: 'openspec_search_specs', output: JSON.stringify(result), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_create_proposal',
        description: 'Create a new change proposal',
        parameters: {
          title: { type: 'string', description: 'Change title' },
          description: { type: 'string', description: 'Change description' },
          summary: { type: 'string', description: 'Proposal summary' },
          motivation: { type: 'string', description: 'Motivation for the change' },
          approach: { type: 'string', description: 'Technical approach' },
          architecture: { type: 'string', description: 'Architecture description' },
          filesChanged: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files that will be changed'
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const title = args.title as string;
        const description = args.description as string;

        if (!title || !description) return { name: 'openspec_create_proposal', output: JSON.stringify({ error: 'title and description are required' }), durationMs: 0 };

        const change = this.manager.createProposal(
          title,
          description,
          {
            summary: (args.summary as string) || description,
            motivation: (args.motivation as string) || '',
            impact: [],
            dependencies: [],
            riskLevel: 'medium',
          },
          {
            approach: (args.approach as string) || '',
            architecture: (args.architecture as string) || '',
            filesChanged: (args.filesChanged as string[]) || [],
            decisions: [],
          },
          [],
          []
        );

        return { name: 'openspec_create_proposal', output: JSON.stringify(change), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_verify',
        description: 'Verify implementation against specs for a change',
        parameters: {
          changeId: { type: 'string', description: 'Change ID to verify' },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const changeId = args.changeId as string;
        if (!changeId) return { name: 'openspec_verify', output: JSON.stringify({ error: 'changeId is required' }), durationMs: 0 };
        const result = this.manager.verify(changeId);
        return { name: 'openspec_verify', output: JSON.stringify(result), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_archive',
        description: 'Archive a completed change',
        parameters: {
          changeId: { type: 'string', description: 'Change ID to archive' },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const changeId = args.changeId as string;
        if (!changeId) return { name: 'openspec_archive', output: JSON.stringify({ error: 'changeId is required' }), durationMs: 0 };

        try {
          const result = this.manager.archive(changeId);
          return { name: 'openspec_archive', output: JSON.stringify(result), durationMs: 0 };
        } catch (e) {
          return { name: 'openspec_archive', output: JSON.stringify({ error: e instanceof Error ? e.message : 'Archive failed' }), durationMs: 0 };
        }
      },
    });

    toolRegistry.register({
      definition: {
        name: 'openspec_list_changes',
        description: 'List all changes',
        parameters: {
          status: {
            type: 'string',
            enum: ['draft', 'active', 'completed', 'archived'],
            description: 'Filter by status (optional)'
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const status = args.status as 'draft' | 'active' | 'completed' | 'archived' | undefined;
        const result = this.manager.listChanges(status);
        return { name: 'openspec_list_changes', output: JSON.stringify(result), durationMs: 0 };
      },
    });

    console.log(`[OpenSpecManager] Plugin activated — ${this.manager.getOpenspecDir()}`);
  }

  async deactivate(): Promise<void> {
    console.log('[OpenSpecManager] Plugin deactivated');
  }
}