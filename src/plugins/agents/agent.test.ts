import { describe, it, expect } from 'vitest';
import { PlannerAgent } from './planner/index.js';
import { WorkerAgent } from './worker/index.js';
import { ResearcherAgent } from './researcher/index.js';
import { ReviewerAgent } from './reviewer/index.js';
import { ScoutAgent } from './scout/index.js';
import { ContextBuilderAgent } from './context-builder/index.js';
import { OracleAgent } from './oracle/index.js';
import { DelegateAgent } from './delegate/index.js';
import type { Plugin } from '../../core/types.js';

const agents = [
  { name: 'planner', instance: new PlannerAgent() },
  { name: 'worker', instance: new WorkerAgent() },
  { name: 'researcher', instance: new ResearcherAgent() },
  { name: 'reviewer', instance: new ReviewerAgent() },
  { name: 'scout', instance: new ScoutAgent() },
  { name: 'context-builder', instance: new ContextBuilderAgent() },
  { name: 'oracle', instance: new OracleAgent() },
  { name: 'delegate', instance: new DelegateAgent() },
];

describe('Agent plugin contracts', () => {
  for (const { name, instance } of agents) {
    describe(`${name} agent`, () => {
      it('implements Plugin interface', () => {
        expect(instance.manifest).toBeDefined();
        expect(instance.manifest.type).toBe('agent');
        expect(instance.manifest.id).toBeDefined();
        expect(instance.manifest.capabilities).toBeInstanceOf(Array);
      });

      it('has valid AgentConfig', () => {
        const config = instance.getConfig();
        expect(config.id).toBe(instance.manifest.id);
        expect(config.role).toBe(name);
        expect(config.defaultModel).toBeDefined();
        expect(config.defaultModel.provider).toBeDefined();
        expect(config.defaultModel.model).toBeDefined();
        expect(config.maxTokens).toBeGreaterThan(0);
        expect(config.timeoutMs).toBeGreaterThan(0);
        expect(config.capabilities).toBeInstanceOf(Array);
        expect(config.capabilities.length).toBeGreaterThan(0);
      });

      it('has a non-empty system prompt', () => {
        const prompt = instance.getSystemPrompt();
        expect(prompt).toBeDefined();
        expect(prompt.length).toBeGreaterThan(50);
        expect(prompt).toContain('MiuraSwarm');
      });

      it('has required lifecycle methods', () => {
        expect(typeof instance.initialize).toBe('function');
        expect(typeof instance.activate).toBe('function');
        expect(typeof instance.deactivate).toBe('function');
        expect(typeof instance.unload).toBe('function');
      });

      it('lifecycle methods return promises', async () => {
        const noop = {} as any;
        await expect(instance.initialize(noop)).resolves.toBeUndefined();
        await expect(instance.activate()).resolves.toBeUndefined();
        await expect(instance.deactivate()).resolves.toBeUndefined();
        await expect(instance.unload()).resolves.toBeUndefined();
      });

      it('manifest capabilities match config capabilities', () => {
        const config = instance.getConfig();
        expect(instance.manifest.capabilities.sort()).toEqual(config.capabilities.sort());
      });
    });
  }
});

describe('Agent role uniqueness', () => {
  it('all agents have unique roles', () => {
    const roles = agents.map(a => a.instance.getConfig().role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('all agents have unique IDs', () => {
    const ids = agents.map(a => a.instance.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
