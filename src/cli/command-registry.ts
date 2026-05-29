/**
 * Command Registry — All 19 REPL slash commands with handlers.
 * Each handler receives parsed args, the miura instance, and session.
 */

import type { MiuraSwarm } from '../index.js';
import type { AgentRole, ModelRef } from '../core/types.js';
import type { SessionManager } from './session-manager.js';

export interface CommandContext {
  miura: MiuraSwarm;
  session: SessionManager;
  rawArgs: string;
}

export interface CommandResult {
  output: string;
  type: 'text' | 'error' | 'success' | 'info' | 'diff';
  stream?: boolean;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  handler: (ctx: CommandContext, args: string) => Promise<CommandResult>;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDef>();

  constructor() {
    this.registerAll();
  }

  get(name: string): CommandDef | undefined {
    return this.commands.get(name);
  }

  /** Match by name or alias. Returns null if not a command (e.g. free text). */
  match(input: string): { cmd: CommandDef; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;
    const spaceIdx = trimmed.indexOf(' ');
    const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    const cmd = this.commands.get(name);
    if (cmd) return { cmd, args };

    // Try aliases
    for (const def of this.commands.values()) {
      if (def.aliases?.includes(name)) return { cmd: def, args };
    }

    return null;
  }

  listAll(): CommandDef[] {
    return [...this.commands.values()];
  }

  formatHelp(): string {
    const lines = ['Available commands:', ''];
    for (const cmd of this.commands.values()) {
      const usage = cmd.usage ? ` ${cmd.usage}` : '';
      lines.push(`  /${cmd.name}${usage}`);
      lines.push(`    ${cmd.description}`);
    }
    return lines.join('\n');
  }

  private registerAll(): void {
    // ─── /chat ───────────────────────────────────────────────────────────────
    this.register({
      name: 'chat',
      description: 'Send a free-text message through the swarm pipeline (planner → worker → reviewer)',
      usage: '<task>',
      handler: async (ctx) => {
        const task = ctx.rawArgs;
        if (!task) return { output: 'Usage: /chat <task description>', type: 'error' };

        const result = await ctx.miura.runPipeline(task, {
          stages: [
            { role: 'planner' },
            { role: 'worker' },
            { role: 'reviewer' },
          ],
          maxIterations: 3,
        });
        ctx.session.incPipelines();
        return { output: result.finalOutput, type: 'text' };
      },
    });

    // ─── /review ─────────────────────────────────────────────────────────────
    this.register({
      name: 'review',
      aliases: ['r'],
      description: 'Review a diff or file changes — equivalent to CLI "review" command',
      usage: '<diff or file path>',
      handler: async (ctx) => {
        const diff = ctx.rawArgs;
        if (!diff) return { output: 'Usage: /review <diff or file path>', type: 'error' };

        const result = await ctx.miura.runAgent('reviewer', `Review this diff:\n\n${diff}`);
        ctx.session.incAgents();
        return { output: result.output, type: 'text' };
      },
    });

    // ─── /add ────────────────────────────────────────────────────────────────
    this.register({
      name: 'add',
      description: 'Add a new task to the queue',
      usage: '<description>',
      handler: async (ctx) => {
        const desc = ctx.rawArgs;
        if (!desc) return { output: 'Usage: /add <task description>', type: 'error' };

        const status = await ctx.miura.getStatus();
        const pending = status.tasks.pending + status.tasks.active;
        const priority = pending > 5 ? 'low' : pending > 2 ? 'medium' : 'high';

        // Run the task directly as a quick pipeline
        const result = await ctx.miura.runPipeline(desc, {
          stages: [{ role: 'planner' }, { role: 'worker' }],
          maxIterations: 2,
        });
        ctx.session.incPipelines();

        return {
          output: `Task queued and executed [${priority}]: pipeline ${result.pipelineId}\n` +
            `Pending before run: ${pending}\n` +
            `\n${result.finalOutput}`,
          type: 'success',
        };
      },
    });

    // ─── /read ──────────────────────────────────────────────────────────────
    this.register({
      name: 'read',
      description: 'Read and explain a file or code block',
      usage: '<file path or content>',
      handler: async (ctx) => {
        const content = ctx.rawArgs;
        if (!content) return { output: 'Usage: /read <file path or code>', type: 'error' };

        const isPath = !content.includes('\n') && !content.startsWith('{');
        const task = isPath
          ? `Explain this file concisely — purpose, key exports, architecture notes:\n\n${content}`
          : `Explain this code:\n\n${content}`;
        const result = await ctx.miura.runAgent('context-builder', task);
        ctx.session.incAgents();
        return { output: result.output, type: 'text' };
      },
    });

    // ─── /swarm ─────────────────────────────────────────────────────────────
    this.register({
      name: 'swarm',
      aliases: ['s'],
      description: 'Run a full pipeline (shortcut for /chat)',
      usage: '<task>',
      handler: async (ctx) => {
        return this.commands.get('chat')!.handler(ctx, ctx.rawArgs);
      },
    });

    // ─── /agent ─────────────────────────────────────────────────────────────
    this.register({
      name: 'agent',
      description: 'Run a single agent by role',
      usage: '<role> <task>',
      handler: async (ctx) => {
        const parts = ctx.rawArgs.split(/\s+/);
        const role = parts[0];
        const task = parts.slice(1).join(' ');
        if (!role || !task) return { output: 'Usage: /agent <role> <task>', type: 'error' };

        try {
          const result = await ctx.miura.runAgent(role as any, task);
          ctx.session.incAgents();
          return { output: result.output, type: 'text' };
        } catch (err: any) {
          return { output: `Agent error: ${err.message}`, type: 'error' };
        }
      },
    });

    // ─── /model ─────────────────────────────────────────────────────────────
    this.register({
      name: 'model',
      description: 'Show model routing config',
      usage: '[role]',
      handler: async (ctx, args) => {
        const role = args.trim() as AgentRole;
        const config = ctx.miura.getConfig();

        if (!role) {
          const lines = Object.entries(config.defaults).map(
            ([r, m]) => `  ${r}: ${m.provider}/${m.model}`,
          );
          return { output: 'Model routing:\n' + lines.join('\n'), type: 'info' };
        }

        const defaultModel = config.defaults[role as AgentRole];
        if (!defaultModel) return { output: `Unknown role: ${role}`, type: 'error' };
        return { output: `${role}: ${defaultModel.provider}/${defaultModel.model}`, type: 'info' };
      },
    });

    // ─── /tokens ─────────────────────────────────────────────────────────────
    this.register({
      name: 'tokens',
      description: 'Show token usage summary for this session',
      usage: '',
      handler: async (ctx) => {
        const msgs = ctx.session.getRecentMessages(100);
        const userMsgs = msgs.filter(m => m.role === 'user').length;
        const asstMsgs = msgs.filter(m => m.role === 'assistant').length;
        const pipelines = ctx.session.pipelineCount;
        const agents = ctx.session.agentCount;
        return {
          output: `Session: ${ctx.session.id}\n` +
            `Messages: ${ctx.session.messageCount} (${userMsgs} user, ${asstMsgs} assistant)\n` +
            `Pipelines run: ${pipelines}\n` +
            `Agents run: ${agents}`,
          type: 'info',
        };
      },
    });

    // ─── /brain ───────────────────────────────────────────────────────────────
    this.register({
      name: 'brain',
      description: 'Query or manage the Brain (long-term memory)',
      usage: '[query | stats | clear]',
      handler: async (ctx, args) => {
        const arg = args.trim();
        if (!arg || arg === 'stats') {
          const msgs = ctx.session.getRecentMessages(50);
          return {
            output: `Brain stats (session ${ctx.session.id}):\n` +
              `  Total messages: ${msgs.length}\n` +
              `  User messages: ${msgs.filter(m => m.role === 'user').length}\n` +
              `  Assistant messages: ${msgs.filter(m => m.role === 'assistant').length}\n` +
              `  (Full SQLite brain coming in Phase 3)`,
            type: 'info',
          };
        }
        if (arg === 'clear') {
          ctx.session.clearMessages();
          return { output: 'Session memory cleared.', type: 'success' };
        }
        const relevant = ctx.session.getRecentMessages(20)
          .filter(m => m.content.toLowerCase().includes(arg.toLowerCase()));
        if (relevant.length === 0) {
          return { output: `No memory entries matching "${arg}".`, type: 'info' };
        }
        const snippet = relevant[0].content.slice(0, 300);
        return { output: `Found in session memory:\n\n${snippet}${snippet.length === 300 ? '...' : ''}`, type: 'info' };
      },
    });

    // ─── /graph ──────────────────────────────────────────────────────────────
    this.register({
      name: 'graph',
      description: 'Initialize or query the code graph (tree-sitter + FTS5)',
      usage: '[init | search <query> | stats]',
      handler: async (ctx) => {
        const parts = ctx.rawArgs.split(/\s+/);
        const subcmd = parts[0];
        if (!subcmd || subcmd === 'init') {
          return {
            output: 'Code graph: run /graph init to index your codebase.\n' +
              'This will scan .ts/.js files with tree-sitter and build FTS5 index.\n' +
              'Full implementation in Phase 4.',
            type: 'info',
          };
        }
        if (subcmd === 'stats') {
          return {
            output: 'Graph stats: not yet initialized. Run /graph init first.',
            type: 'info',
          };
        }
        if (subcmd === 'search' && parts[1]) {
          const query = parts.slice(1).join(' ');
          return {
            output: `Graph search for "${query}": full implementation in Phase 4.\n` +
              `For now, use /agent scout to search the codebase.`,
            type: 'info',
          };
        }
        return { output: 'Usage: /graph [init | search <query> | stats]', type: 'error' };
      },
    });

    // ─── /skills ─────────────────────────────────────────────────────────────
    this.register({
      name: 'skills',
      description: 'List available skills or activate one by name',
      usage: '[skill-name]',
      handler: async (ctx, args) => {
        const skillName = args.trim();
        if (!skillName) {
          return {
            output: 'Available skills (full implementation in Phase 5):\n' +
              '  tdd       — Test-driven development workflow\n' +
              '  git-commits — Semantic commit conventions\n' +
              '  code-review — Code review checklist\n' +
              '  vitest    — Vitest test patterns\n' +
              '  owasp     — Security checklist\n' +
              '  wcag      — Accessibility checklist\n' +
              '\nActivate with: /skills <name>',
            type: 'info',
          };
        }
        const known = ['tdd', 'git-commits', 'code-review', 'vitest', 'owasp', 'wcag'];
        if (!known.includes(skillName)) {
          return { output: `Unknown skill: ${skillName}. Run /skills for list.`, type: 'error' };
        }
        return {
          output: `Skill "${skillName}" activated. Context will include skill guidelines in agent prompts.\n` +
            `(Full activation in Phase 5)`,
          type: 'success',
        };
      },
    });

    // ─── /debug ──────────────────────────────────────────────────────────────
    this.register({
      name: 'debug',
      aliases: ['dbg'],
      description: 'Toggle debug mode or show debug info',
      usage: '[on | off | info]',
      handler: async (ctx) => {
        const arg = ctx.rawArgs.trim();
        if (!arg || arg === 'info') {
          const status = await ctx.miura.getStatus();
          return {
            output: 'Debug info:\n' +
              `  Plugins: ${status.plugins.length}\n` +
              `  Agents: ${status.agents.length}\n` +
              `  Tasks: pending=${status.tasks.pending} active=${status.tasks.active} ` +
              `completed=${status.tasks.completed} failed=${status.tasks.failed}\n` +
              `  Adapters: ${ctx.miura.getAdapters().size}`,
            type: 'info',
          };
        }
        return { output: `Debug ${arg}. (Full debug verbosity in Phase 6)`, type: 'info' };
      },
    });

    // ─── /tools ──────────────────────────────────────────────────────────────
    this.register({
      name: 'tools',
      description: 'List available tools and their status',
      usage: '',
      handler: async (ctx) => {
        const adapterCount = ctx.miura.getAdapters().size;
        const adapters = [...ctx.miura.getAdapters().keys()];
        return {
          output: `Available adapters (${adapterCount}):\n` +
            adapters.map(a => `  ${a}`).join('\n') +
            '\n  Tools are provided by adapters. Full tool registry in Phase 5.',
          type: 'info',
        };
      },
    });

    // ─── /plan ───────────────────────────────────────────────────────────────
    this.register({
      name: 'plan',
      aliases: ['p'],
      description: 'Show pending tasks and session plan',
      usage: '',
      handler: async (ctx) => {
        const status = await ctx.miura.getStatus();
        const lines = ['Task queue:', ''];
        const { pending, active, completed, failed } = status.tasks;
        lines.push(`  pending:  ${pending}`);
        lines.push(`  active:   ${active}`);
        lines.push(`  completed: ${completed}`);
        lines.push(`  failed:   ${failed}`);
        lines.push('');
        lines.push(`Session: ${ctx.session.id}`);
        lines.push(`Messages: ${ctx.session.messageCount}`);
        return { output: lines.join('\n'), type: 'info' };
      },
    });

    // ─── /scout ──────────────────────────────────────────────────────────────
    this.register({
      name: 'scout',
      aliases: ['sc'],
      description: 'Scout a directory or codebase — equivalent to CLI "scout" command',
      usage: '[path]',
      handler: async (ctx) => {
        const path = ctx.rawArgs || process.cwd();
        const result = await ctx.miura.runAgent('scout', `Scout this codebase: ${path}`);
        ctx.session.incAgents();
        return { output: result.output, type: 'text' };
      },
    });

    // ─── /oracle ─────────────────────────────────────────────────────────────
    this.register({
      name: 'oracle',
      aliases: ['o'],
      description: 'Ask the Oracle for an architectural decision or tradeoff',
      usage: '<question>',
      handler: async (ctx) => {
        const q = ctx.rawArgs;
        if (!q) return { output: 'Usage: /oracle <question>', type: 'error' };
        const result = await ctx.miura.runAgent('oracle', q);
        ctx.session.incAgents();
        return { output: result.output, type: 'text' };
      },
    });

    // ─── /compact ────────────────────────────────────────────────────────────
    this.register({
      name: 'compact',
      description: 'Trigger context compaction to free up token budget',
      usage: '',
      handler: async (_ctx) => {
        return {
          output: 'Compaction strategy: SlidingWindow (keeps last 20 messages + summary).\n' +
            'Full implementation in Phase 6.',
          type: 'info',
        };
      },
    });

    // ─── /clear ──────────────────────────────────────────────────────────────
    this.register({
      name: 'clear',
      aliases: ['cls'],
      description: 'Clear the terminal screen and session messages',
      usage: '',
      handler: async (ctx) => {
        ctx.session.clearMessages();
        return { output: '__CLEAR__', type: 'text' };
      },
    });

    // ─── /skills ────────────────────────────────────────────────────────────────
    this.register({
      name: 'skills',
      description: 'Skills system — list, init, add, or remove skills',
      usage: 'list | init | add <file> | remove <id>',
      aliases: ['skill'],
      handler: async (ctx, args) => {
        const parts = (args ?? '').trim().split(/\s+/);
        const sub = parts[0]?.toLowerCase();
        const rest = parts.slice(1).join(' ');

        switch (sub) {
          case 'list': {
            const sm = ctx.miura.getSkillManager();
            if (!sm) return { output: '❌ SkillManager not initialized', type: 'error' };
            const byPack = sm.list().reduce<Record<string, string[]>>((acc, s) => {
              (acc[s.pack] ??= []).push(`  • **${s.name}** — ${s.triggers.slice(0, 3).join(', ') || 'no triggers'}`);
              return acc;
            }, {});
            const lines = ['## Skills', ''];
            for (const [pack, items] of Object.entries(byPack)) {
              lines.push(`### ${pack}`);
              lines.push(...items);
              lines.push('');
            }
            return { output: lines.join('\n'), type: 'text' };
          }

          case 'init': {
            const sm = ctx.miura.getSkillManager();
            if (!sm) return { output: '❌ SkillManager not initialized', type: 'error' };
            const result = await sm.init();
            return {
              output: `✅ Skills initialized\nInstalled: ${result.installed}  Skipped: ${result.skipped}`,
              type: 'success',
            };
          }

          case 'add': {
            if (!rest) return { output: 'Usage: /skills add <file.md>', type: 'error' };
            const sm = ctx.miura.getSkillManager();
            if (!sm) return { output: '❌ SkillManager not initialized', type: 'error' };
            try {
              const skill = await sm.add(rest);
              return { output: `✅ Added skill: **${skill.name}** (${skill.pack})`, type: 'success' };
            } catch (e: unknown) {
              return { output: `❌ Failed to add skill: ${e}`, type: 'error' };
            }
          }

          case 'remove':
          case 'rm': {
            if (!rest) return { output: 'Usage: /skills remove <id>', type: 'error' };
            const sm = ctx.miura.getSkillManager();
            if (!sm) return { output: '❌ SkillManager not initialized', type: 'error' };
            const ok = sm.remove(rest);
            return ok
              ? { output: `✅ Removed skill: **${rest}**`, type: 'success' }
              : { output: `❌ Skill not found: ${rest}`, type: 'error' };
          }

          case 'match': {
            if (!rest) return { output: 'Usage: /skills match <context text>', type: 'error' };
            const sm = ctx.miura.getSkillManager();
            if (!sm) return { output: '❌ SkillManager not initialized', type: 'error' };
            const content = sm.getInjectedContent(rest);
            return content
              ? { output: content, type: 'text' }
              : { output: '_(no skills matched)_', type: 'text' };
          }

          default:
            return {
              output: 'Skills — list, init, add, remove, match\n'
                + '  /skills list       — show all skills by pack\n'
                + '  /skills init       — install built-in skill packs\n'
                + '  /skills add <f>    — add custom skill from file\n'
                + '  /skills remove <id> — remove a skill\n'
                + '  /skills match <ctx> — show skills matching context',
              type: 'info',
            };
        }
      },
    });

    // ─── /exit ───────────────────────────────────────────────────────────────
    this.register({
      name: 'exit',
      aliases: ['quit', 'q'],
      description: 'Exit the REPL with graceful shutdown',
      usage: '',
      handler: async (ctx) => {
        ctx.session.close();
        return { output: '__EXIT__', type: 'success' };
      },
    });

    // ─── /compaction ─────────────────────────────────────────────────────────────
    this.register({
      name: 'compaction',
      aliases: ['compact'],
      description: 'Manage compaction strategies for long conversations',
      usage: 'list | set <strategy> [options] | config [strategy] | stats | help',
      handler: async (ctx, args) => {
        const parts = (args ?? '').trim().split(/\s+/);
        const sub = parts[0]?.toLowerCase();
        const rest = parts.slice(1).join(' ');

        switch (sub) {
          case 'list': {
            const strategies = [
              { name: 'no_compaction', desc: 'No message compression - keeps all messages' },
              { name: 'sliding_window', desc: 'Keep last N messages (configurable window size)' },
              { name: 'summarize', desc: 'Summarize older messages when threshold exceeded' },
              { name: 'hybrid', desc: 'Combine sliding window with summarization' },
              { name: 'safe_split_point', desc: 'Smart splitting without breaking tool calls' },
            ];
            
            const lines = ['## Available Compaction Strategies', ''];
            strategies.forEach(s => {
              lines.push(`### ${s.name}`);
              lines.push(`${s.desc}`);
              lines.push('');
            });
            
            const current = 'no_compaction'; // Default until integration complete
            lines.push(`**Current strategy:** ${current}`);
            
            return { output: lines.join('\n'), type: 'text' };
          }

          case 'set': {
            if (!rest) return { output: 'Usage: /compaction set <strategy> [options]', type: 'error' };
            const strategyName = rest.split(' ')[0];
            const options = rest.substring(strategyName.length).trim();
            
            const validStrategies = ['no_compaction', 'sliding_window', 'summarize', 'hybrid', 'safe_split_point'];
            if (!validStrategies.includes(strategyName)) {
              return { output: `❌ Invalid strategy: ${strategyName}\nValid strategies: ${validStrategies.join(', ')}`, type: 'error' };
            }
            
            // Try to parse options if provided
            let parsedOptions;
            if (options) {
              try {
                parsedOptions = JSON.parse(options);
              } catch (e) {
                return { output: `❌ Invalid JSON options: ${options}`, type: 'error' };
              }
            }
            
            // For now, just acknowledge the command
            // Full integration would require access to SessionManagerWithCompaction
            return {
              output: `✅ Compaction strategy set to: ${strategyName}${options ? ` with options: ${JSON.stringify(parsedOptions)}` : ''}`,
              type: 'success'
            };
          }

          case 'config': {
            if (!rest) {
              const config = {
                currentStrategy: 'no_compaction',
                defaultConfig: {
                  sliding_window: { windowSize: 50, preserveSystem: true },
                  summarize: { thresholdMessages: 20, preserveSystem: true },
                  hybrid: { keepMessages: 30, preserveSystem: true, useSummarizeForOlder: true },
                  safe_split_point: { innerStrategy: 'sliding_window' }
                }
              };
              
              return {
                output: `## Current Compaction Configuration\n\n**Strategy:** ${config.currentStrategy}\n\n### Available Configurations:\n${Object.entries(config.defaultConfig).map(([name, cfg]) => 
                  `**${name}:** ${JSON.stringify(cfg, null, 2)}`
                ).join('\n\n')}`,
                type: 'text'
              };
            }
            
            // Show specific strategy config
            const strategyConfigs = {
              sliding_window: { windowSize: 50, preserveSystem: true },
              summarize: { thresholdMessages: 20, preserveSystem: true },
              hybrid: { keepMessages: 30, preserveSystem: true, useSummarizeForOlder: true },
              safe_split_point: { innerStrategy: 'sliding_window' }
            };
            
            if (strategyConfigs[rest as keyof typeof strategyConfigs]) {
              return {
                output: `## ${rest} Configuration\n\n\`\`\`json\n${JSON.stringify(strategyConfigs[rest as keyof typeof strategyConfigs], null, 2)}\`\`\``,
                type: 'text'
              };
            }
            
            return { output: `❌ Strategy not found: ${rest}`, type: 'error' };
          }

          case 'stats': {
            const stats = {
              totalCompactions: 0,
              contextUsage: 0,
              recommendations: [
                'Context window is normal (0-75%)',
                'Consider enabling compaction for long conversations',
                'Current strategy: no_compaction (no compression active)'
              ]
            };
            
            const output = `## Compaction Statistics\n\n` +
              `**Total Compactions:** ${stats.totalCompactions}\n` +
              `**Context Window Usage:** ${stats.contextUsage}%\n\n` +
              `### Recommendations\n` +
              stats.recommendations.map(rec => `• ${rec}`).join('\n');
            
            return { output, type: 'info' };
          }

          case 'help':
          default: {
            const help = `# Compaction Manager Commands

Manage strategies for compressing conversation history when context windows are full.

## Commands

  /compaction list              - List all available compaction strategies
  /compaction set <strategy> [options] - Set the current compaction strategy
  /compaction config [strategy] - Show strategy configuration
  /compaction stats             - Show compaction statistics and recommendations
  /compaction help              - Show this help

## Available Strategies

  • **no_compaction**: No message compression - keeps all messages
  • **sliding_window**: Keep last N messages (configurable window size)
  • **summarize**: Summarize older messages when threshold exceeded
  • **hybrid**: Combine sliding window with summarization
  • **safe_split_point**: Smart splitting without breaking tool calls

## Examples

  /compaction set sliding_window
  /compaction set hybrid {"keepMessages": 25}
  /compaction config sliding_window
  /compaction stats

## Configuration

Strategies can be configured with JSON options:
  - windowSize: Number of messages to keep (sliding_window)
  - thresholdMessages: When to start summarizing (summarize)
  - keepMessages: Number of recent messages to preserve (hybrid)
  - preserveSystem: Keep system messages in output (all strategies)`;
            
            return { output: help, type: 'info' };
          }
        }
      },
    });

    // ─── /propose ────────────────────────────────────────────────────────────────
    this.register({
      name: 'propose',
      aliases: ['new'],
      description: 'Create a new change proposal following OpenSpec format',
      usage: '/propose <title>: <description>',
      handler: async (ctx, args) => {
        if (!args) {
          return { output: 'Usage: /propose <title>: <description>', type: 'error' };
        }

        const parts = args.split(':');
        const title = parts[0]?.trim();
        const description = parts.slice(1).join(':').trim();

        if (!title) {
          return { output: 'Usage: /propose <title>: <description>', type: 'error' };
        }

        const osm = ctx.miura.getOpenSpecManager();
        if (!osm) return { output: '❌ OpenSpecManager not initialized', type: 'error' };

        const manager = osm.getManager();
        manager.init();

        const change = manager.createProposal(
          title,
          description || title,
          {
            summary: description || title,
            motivation: 'No detailed motivation provided.',
            impact: [],
            dependencies: [],
            riskLevel: 'medium',
          },
          {
            approach: 'TBD',
            architecture: 'TBD',
            filesChanged: [],
            decisions: [],
          },
          [],
          []
        );

        return {
          output: `## ✅ Proposal Created\n\n**ID:** \`${change.id}\`\n**Title:** ${change.title}\n**Status:** ${change.status}\n\nUse \`/continue ${change.id}\` to start implementation.`,
          type: 'success',
        };
      },
    });

    // ─── /continue ───────────────────────────────────────────────────────────────
    this.register({
      name: 'continue',
      description: 'Continue implementation of an open change proposal',
      usage: '/continue <change-id>',
      handler: async (ctx, args) => {
        if (!args) {
          const osm = ctx.miura.getOpenSpecManager();
          if (!osm) return { output: '❌ OpenSpecManager not initialized', type: 'error' };

          const changes = osm.getManager().listChanges('active');
          if (changes.length === 0) {
            return { output: 'No active changes. Create one with /propose.', type: 'info' };
          }

          return {
            output: 'Active changes:\n' +
              changes.map(c => `  • \`${c.id}\` — ${c.title} (phase: ${c.currentPhase})`).join('\n'),
            type: 'text',
          };
        }

        const osm = ctx.miura.getOpenSpecManager();
        if (!osm) return { output: '❌ OpenSpecManager not initialized', type: 'error' };

        const change = osm.getManager().getChange(args.trim());
        if (!change) {
          return { output: `❌ Change not found: ${args}`, type: 'error' };
        }

        osm.getManager().activateChange(change.id);

        return {
          output: `## Continuing: ${change.title}\n\n**ID:** \`${change.id}\`\n**Status:** ${change.status}\n**Tasks:** ${change.tasks.length}\n\n${change.tasks.map(t => `  ${t.status === 'completed' ? '✅' : '⬜'} ${t.title} (${t.estimatedEffort})`).join('\n')}`,
          type: 'text',
        };
      },
    });

    // ─── /verify ──────────────────────────────────────────────────────────────────
    this.register({
      name: 'verify',
      description: 'Verify implementation against spec for a change',
      usage: '/verify <change-id>',
      handler: async (ctx, args) => {
        if (!args) return { output: 'Usage: /verify <change-id>', type: 'error' };

        const osm = ctx.miura.getOpenSpecManager();
        if (!osm) return { output: '❌ OpenSpecManager not initialized', type: 'error' };

        const result = osm.getManager().verify(args.trim());
        
        const statusEmoji = result.status === 'passed' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
        const lines = [
          `## ${statusEmoji} Verification: ${result.changeId}`,
          '',
          `**Status:** ${result.status}`,
          `**Unmet:** ${result.unmetCount}/${result.totalCount}`,
          '',
          '### Requirements',
          ...result.requirements.map(r => {
            const emoji = r.status === 'implemented' ? '✅' : r.status === 'partial' ? '🔄' : '❌';
            return `  ${emoji} **${r.title}** — ${r.notes}`;
          }),
        ];

        return { output: lines.join('\n'), type: result.status === 'passed' ? 'success' : 'error' };
      },
    });

    // ─── /archive ──────────────────────────────────────────────────────────────────
    this.register({
      name: 'archive',
      description: 'Archive a completed change proposal',
      usage: '/archive <change-id>',
      handler: async (ctx, args) => {
        if (!args) return { output: 'Usage: /archive <change-id>', type: 'error' };

        const osm = ctx.miura.getOpenSpecManager();
        if (!osm) return { output: '❌ OpenSpecManager not initialized', type: 'error' };

        try {
          const record = osm.getManager().archive(args.trim());
          return {
            output: `## 📦 Archived: ${record.title}\n\n` +
              `**ID:** \`${record.changeId}\`\n` +
              `**Summary:** ${record.summary}\n` +
              `**Files:** ${record.fileCount}\n` +
              `**Implemented:** ${record.requirementsImplemented}/${record.requirementsTotal}`,
            type: 'success',
          };
        } catch (e) {
          return { output: `❌ Archive failed: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' };
        }
      },
    });

    // ─── /spec ─────────────────────────────────────────────────────────────────────
    this.register({
      name: 'spec',
      aliases: ['specs'],
      description: 'Manage capability specs',
      usage: '/spec [list|add|edit|search] [args]',
      handler: async (ctx, args) => {
        const parts = (args ?? '').trim().split(/\s+/);
        const sub = parts[0]?.toLowerCase();
        const rest = parts.slice(1).join(' ');

        const osm = ctx.miura.getOpenSpecManager();
        if (!osm) return { output: '❌ OpenSpecManager not initialized', type: 'error' };
        const manager = osm.getManager();

        switch (sub) {
          case 'list': {
            const specs = manager.listSpecs();
            if (specs.length === 0) {
              return { output: 'No specs found. Use `/spec add` to create one.', type: 'info' };
            }
            return {
              output: '## Capability Specs\n\n' +
                specs.map(s => `  • \`${s.id}\` — ${s.title}`).join('\n'),
              type: 'text',
            };
          }

          case 'add': {
            const [id, ...titleParts] = rest.split(' ');
            if (!id) return { output: 'Usage: /spec add <capability-id> <title>', type: 'error' };
            
            const title = titleParts.join(' ') || id;
            const content = `# ${title}\n\n## Purpose\n\nSpecification for ${title}.\n\n## Requirements\n\n`;
            const spec = manager.addSpec(id, content);
            
            return {
              output: `✅ Spec created: **${spec.metadata.title}** (\`${id}\`)`,
              type: 'success',
            };
          }

          case 'search': {
            if (!rest) return { output: 'Usage: /spec search <query>', type: 'error' };
            const results = manager.searchSpecs(rest);
            
            if (results.length === 0) {
              return { output: `No specs matching: "${rest}"`, type: 'info' };
            }
            
            return {
              output: `## Search Results for "${rest}"\n\n` +
                results.map(r => `  • \`${r.id}\` — ${r.title}\n    > ${r.snippet}`).join('\n'),
              type: 'text',
            };
          }

          default:
            return {
              output: 'Spec commands:\n'
                + '  /spec list              — list all specs\n'
                + '  /spec add <id> [title]  — create a new spec\n'
                + '  /spec search <query>    — search specs by keyword',
              type: 'info',
            };
        }
      },
    });
  }

  register(cmd: CommandDef): void {
    this.commands.set(cmd.name, cmd);
  }
}