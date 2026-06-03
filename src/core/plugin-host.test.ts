import { describe, it, expect, beforeEach } from 'vitest';
import { PluginHost } from './plugin-host.js';
import { EventBus } from './event-bus.js';
import type { Plugin, PluginHostAPI } from './types.js';

function createMockPlugin(id: string, type: 'agent' | 'adapter' | 'integration' = 'agent'): Plugin {
  return {
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      type,
      capabilities: ['test'],
      dependencies: [],
    },
    initialize: async (_host: PluginHostAPI) => {},
    activate: async () => {},
    deactivate: async () => {},
    unload: async () => {},
  };
}

describe('PluginHost', () => {
  let host: PluginHost;

  beforeEach(() => {
    const bus = new EventBus();
    host = new PluginHost(bus);
  });

  it('registers and initializes a plugin', async () => {
    const plugin = createMockPlugin('test-plugin');
    await host.register(plugin);

    const found = host.query('test');
    expect(found).toHaveLength(1);
    expect(found[0].manifest.id).toBe('test-plugin');
  });

  it('queries plugins by capability', async () => {
    const plugin = createMockPlugin('test-plugin');
    await host.register(plugin);

    const results = host.query('test');
    expect(results).toHaveLength(1);
  });

  it('queries plugins by type', async () => {
    const agent = createMockPlugin('agent-1', 'agent');
    const adapter = createMockPlugin('adapter-1', 'adapter');
    await host.register(agent);
    await host.register(adapter);

    const agents = host.queryByType('agent');
    expect(agents).toHaveLength(1);
    expect(agents[0].manifest.id).toBe('agent-1');
  });

  it('getAllPlugins returns all registered plugins', async () => {
    await host.register(createMockPlugin('p1'));
    await host.register(createMockPlugin('p2'));

    const all = host.getAllPlugins();
    expect(all).toHaveLength(2);
  });

  it('throws on duplicate plugin id', async () => {
    await host.register(createMockPlugin('dup'));
    await expect(host.register(createMockPlugin('dup'))).rejects.toThrow();
  });

  describe('CommandRegistry injection', () => {
    it('getCommandRegistry returns undefined before setCommandRegistry', () => {
      expect(host.getCommandRegistry()).toBeUndefined();
    });

    it('setCommandRegistry stores the registry and getCommandRegistry returns it', () => {
      const fakeRegistry = { register: () => {} };
      host.setCommandRegistry(fakeRegistry as any);
      expect(host.getCommandRegistry()).toBe(fakeRegistry);
    });

    it('setCommandRegistry can be replaced', () => {
      const r1 = { register: () => {} };
      const r2 = { register: () => {} };
      host.setCommandRegistry(r1 as any);
      host.setCommandRegistry(r2 as any);
      expect(host.getCommandRegistry()).toBe(r2);
    });
  });
});
