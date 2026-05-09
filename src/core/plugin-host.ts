import type {
  Plugin,
  PluginHostAPI,
  PluginManifest,
  PluginStatus,
  PluginType,
  IStateStore,
} from './types.js';
import { EventBus } from './event-bus.js';

interface RegisteredPlugin {
  plugin: Plugin;
  status: PluginStatus;
  error?: Error;
}

export class PluginHost implements PluginHostAPI {
  private plugins = new Map<string, RegisteredPlugin>();
  private eventBus: EventBus;
  private stateStore: IStateStore | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  setStateStore(store: IStateStore): void {
    this.stateStore = store;
  }

  async register(plugin: Plugin): Promise<void> {
    const manifest = plugin.manifest;

    // Validate manifest
    this.validateManifest(manifest);

    // Check for duplicate
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin already registered: ${manifest.id}`);
    }

    // Check dependencies
    if (manifest.dependencies) {
      for (const depId of manifest.dependencies) {
        if (!this.plugins.has(depId)) {
          throw new Error(
            `Plugin "${manifest.id}" depends on "${depId}" which is not registered`,
          );
        }
      }
    }

    // Register
    this.plugins.set(manifest.id, { plugin, status: 'loaded' });

    try {
      // Initialize
      if (plugin.initialize) {
        await plugin.initialize(this);
      }
      this.updateStatus(manifest.id, 'initialized');

      // Activate
      if (plugin.activate) {
        await plugin.activate();
      }
      this.updateStatus(manifest.id, 'active');

      this.eventBus.emit('plugin.loaded', {
        pluginId: manifest.id,
        type: manifest.type,
      });
    } catch (error) {
      this.updateStatus(manifest.id, 'error', error instanceof Error ? error : new Error(String(error)));
      this.eventBus.emit('plugin.failed', {
        pluginId: manifest.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async unregister(pluginId: string): Promise<void> {
    const registered = this.plugins.get(pluginId);
    if (!registered) return;

    const plugin = registered.plugin;

    try {
      if (plugin.deactivate) {
        await plugin.deactivate();
      }
      if (plugin.unload) {
        await plugin.unload();
      }
    } finally {
      this.plugins.delete(pluginId);
    }
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id)?.plugin;
  }

  getPluginStatus(id: string): PluginStatus | null {
    return this.plugins.get(id)?.status ?? null;
  }

  query(capability: string): Plugin[] {
    const results: Plugin[] = [];
    for (const { plugin, status } of this.plugins.values()) {
      if (status === 'active' && plugin.manifest.capabilities.includes(capability)) {
        results.push(plugin);
      }
    }
    return results;
  }

  queryByType(type: PluginType): Plugin[] {
    const results: Plugin[] = [];
    for (const { plugin, status } of this.plugins.values()) {
      if (status === 'active' && plugin.manifest.type === type) {
        results.push(plugin);
      }
    }
    return results;
  }

  getAllPlugins(): Array<{ manifest: PluginManifest; status: PluginStatus }> {
    return Array.from(this.plugins.values()).map(({ plugin, status }) => ({
      manifest: plugin.manifest,
      status,
    }));
  }

  // PluginHostAPI implementation
  on(event: string, handler: (...args: unknown[]) => void): void {
    this.eventBus.on(event as never, handler as never);
  }

  emit(event: string, ...args: unknown[]): void {
    this.eventBus.emit(event as never, args[0] as never);
  }

  getStateStore(): IStateStore {
    if (!this.stateStore) {
      throw new Error('StateStore not configured. Call setStateStore() first.');
    }
    return this.stateStore;
  }

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || !manifest.name || !manifest.version || !manifest.type) {
      throw new Error(
        `Invalid plugin manifest: id, name, version, and type are required. Got: ${JSON.stringify(manifest)}`,
      );
    }
  }

  private updateStatus(id: string, status: PluginStatus, error?: Error): void {
    const registered = this.plugins.get(id);
    if (registered) {
      registered.status = status;
      if (error) registered.error = error;
    }
  }
}
