#!/usr/bin/env node
/**
 * MiuraSwarm CLI — Autonomous AI Agent Orchestrator
 *
 * CLI-first, plugin-based, event-driven.
 * Usage: miura <command> [options]
 */

import { loadEnv } from '../env.js';
import { Command } from 'commander';
import { MiuraSwarm } from '../index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
const version: string = pkg.version;

const program = new Command();

program
  .name('miura')
  .description('MiuraSwarm — Autonomous AI agent orchestrator')
  .version(version);

// === init ===
program
  .command('init')
  .description('Initialize MiuraSwarm in the current project')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (_opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    console.log('MiuraSwarm initialized.');
    await miura.shutdown();
  });

// === run ===
program
  .command('run <task>')
  .description('Run a full pipeline for a task (plan → worker → reviewer)')
  .option('-m, --model <model>', 'Override default model')
  .option('-p, --priority <priority>', 'Task priority: high, medium, low', 'medium')
  .option('--no-review', 'Skip review stage')
  .option('--max-iterations <n>', 'Max pipeline iterations', '3')
  .action(async (task, opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();

    const stages = opts.noReview
      ? [{ role: 'planner' as const }, { role: 'worker' as const }]
      : [{ role: 'planner' as const }, { role: 'worker' as const }, { role: 'reviewer' as const }];

    const result = await miura.runPipeline(task, {
      stages,
      maxIterations: parseInt(opts.maxIterations, 10),
    });

    console.log('\n' + result.finalOutput);
    await miura.shutdown();
  });

// === plan ===
program
  .command('plan <task>')
  .description('Create an implementation plan without executing')
  .option('-m, --model <model>', 'Override default model')
  .action(async (task, _opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runAgent('planner', task);
    console.log(result.output);
    await miura.shutdown();
  });

// === research ===
program
  .command('research <topic>')
  .description('Research a topic using web search and documentation')
  .action(async (topic, _opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runAgent('researcher', topic);
    console.log(result.output);
    await miura.shutdown();
  });

// === scout ===
program
  .command('scout [path]')
  .description('Quick reconnaissance of a codebase or directory')
  .option('-d, --depth <n>', 'Directory scan depth', '3')
  .action(async (path, _opts) => {
    const target = path || process.cwd();
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runAgent('scout', `Scout this codebase: ${target}`);
    console.log(result.output);
    await miura.shutdown();
  });

// === review ===
program
  .command('review <diff>')
  .description('Review a diff or code change')
  .action(async (diff, _opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runAgent('reviewer', `Review this diff:\n\n${diff}`);
    console.log(result.output);
    await miura.shutdown();
  });

// === pipeline ===
program
  .command('pipeline <task>')
  .description('Run a custom pipeline with specified stages')
  .option('-s, --stages <stages>', 'Comma-separated stage roles', 'planner,worker,reviewer')
  .option('--max-iterations <n>', 'Max iterations', '3')
  .action(async (task, opts) => {
    const stages = opts.stages.split(',').map((s: string) => ({ role: s.trim() }));
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runPipeline(task, {
      stages,
      maxIterations: parseInt(opts.maxIterations, 10),
    });
    console.log('\n' + result.finalOutput);
    await miura.shutdown();
  });

// === agent ===
program
  .command('agent <role> <task>')
  .description('Run a single agent with a specific role')
  .option('-m, --model <model>', 'Override default model for this role')
  .action(async (role, task, _opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runAgent(role as any, task);
    console.log(result.output);
    await miura.shutdown();
  });

// === oracle ===
program
  .command('oracle <question>')
  .description('Ask the Oracle for a decision on a tradeoff or approach')
  .action(async (question, _opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    const result = await miura.runAgent('oracle', question);
    console.log(result.output);
    await miura.shutdown();
  });

// === status ===
program
  .command('status')
  .description('Show current MiuraSwarm status — agents, tasks, plugins')
  .action(async (_opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();
    const status = miura.getStatus();
    console.log(JSON.stringify(status, null, 2));
    await miura.shutdown();
  });

// === config ===
program
  .command('config')
  .description('Show or modify MiuraSwarm configuration')
  .option('--get <key>', 'Get a config value')
  .option('--set <key=value>', 'Set a config value')
  .option('--list', 'List all configuration')
  .action(async (opts) => {
    const miura = new MiuraSwarm();
    await miura.initialize();

    if (opts.list || (!opts.get && !opts.set)) {
      const config = miura.getConfig();
      console.log(JSON.stringify(config, null, 2));
    } else if (opts.get) {
      const config = miura.getConfig();
      const keys = opts.get.split('.');
      let value: any = config;
      for (const key of keys) {
        value = value?.[key];
      }
      console.log(value ?? 'not found');
    }

    await miura.shutdown();
  });

program.parse();
