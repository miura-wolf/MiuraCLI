#!/usr/bin/env node
/**
 * MiuraCLI — Autonomous AI Agent Orchestrator
 *
 * CLI-first, plugin-based, event-driven.
 * Usage: miura <command> [options] | miura (no args starts REPL)
 */

import { loadEnv } from '../env.js';
import { Command } from 'commander';
import { MiuraSwarm } from '../index.js';
import { getConfigValue, setConfigValue, loadConfigFile } from '../config.js';
import { runRepl } from './repl.js';

loadEnv();

// Version is hardcoded for compiled binary; falls back to package.json when running via bun
const version = '0.1.0';

const program = new Command();

program
  .name('miura')
  .description('MiuraCLI — Autonomous AI agent orchestrator')
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
    const status = await miura.getStatus();
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
    if (opts.set) {
      const eqIndex = opts.set.indexOf('=');
      if (eqIndex === -1) {
        console.error('Invalid format. Use: config --set key=value');
        process.exit(1);
      }
      const key = opts.set.slice(0, eqIndex).trim();
      let value: unknown = opts.set.slice(eqIndex + 1).trim();
      // Parse JSON values (numbers, booleans, objects, arrays)
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (!isNaN(Number(value)) && value !== '') value = Number(value);
      else {
        try { value = JSON.parse(value as string); } catch { /* keep as string */ }
      }
      setConfigValue(key, value);
      console.log(`Set ${key} = ${JSON.stringify(value)}`);
    } else if (opts.get) {
      const value = getConfigValue(opts.get);
      if (value !== undefined) {
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      } else {
        console.log(`Config key "${opts.get}" not found.`);
      }
    } else {
      const config = loadConfigFile();
      if (Object.keys(config).length === 0) {
        console.log('No config overrides set. Use: config --set key=value');
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
    }
  });

// If no command was provided, launch the interactive REPL instead of showing help
if (!process.argv.slice(2).length) {
  runRepl().catch(console.error);
} else {
  program.parse();
}
