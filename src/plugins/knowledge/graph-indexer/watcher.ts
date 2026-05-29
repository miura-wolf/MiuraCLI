/**
 * GraphWatcher — file system watcher with debounce.
 *
 * Uses chokidar to watch source files and incrementally re-index
 * on change. Debounces 2s to avoid thrashing during bulk saves.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import type { GraphIndexer } from './indexer.js';

export interface WatchOptions {
  debounceMs?: number;
  ignored?: string[];
}

// Standalone debounce (no external deps)
function debounce<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  delayMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;

  return (...args: Args) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending) { fn(...pending); pending = null; }
    }, delayMs);
  };
}

export class GraphWatcher {
  private watcher: FSWatcher | null = null;
  private indexer: GraphIndexer;
  private projectPath: string;
  private onStale: (() => void) | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS: number;
  private handleChange: (path: string) => void;
  private handleRemove: (path: string) => void;

  constructor(indexer: GraphIndexer, projectPath: string, options: WatchOptions = {}) {
    this.indexer = indexer;
    this.projectPath = projectPath;
    this.DEBOUNCE_MS = options.debounceMs ?? 2000;

    // Bind debounced handlers AFTER DEBOUNCE_MS is initialized
    this.handleChange = debounce(this.onFileChange.bind(this), this.DEBOUNCE_MS);
    this.handleRemove = debounce(this.onFileRemove.bind(this), this.DEBOUNCE_MS);
  }

  setStaleCallback(cb: () => void): void {
    this.onStale = cb;
  }

  async start(patterns: string[], ignored?: string[]): Promise<void> {
    if (this.watcher) return;

    this.watcher = chokidar.watch(patterns, {
      cwd: this.projectPath,
      persistent: true,
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/coverage/**',
        ...(ignored ?? []),
      ],
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 100 },
    });

    this.watcher
      .on('change', p => this.handleChange(p))
      .on('add',    p => this.handleChange(p))
      .on('unlink', p => this.handleRemove(p));

    this.watcher.on('all', () => this.markStale());
  }

  private async onFileChange(relativePath: string): Promise<void> {
    const absPath = `${this.projectPath}/${relativePath}`.replace(/\\/g, '/');
    try {
      await this.indexer.indexFile(absPath);
    } catch (e: unknown) {
      console.warn(`[GraphWatcher] index error: ${e}`);
    }
  }

  private async onFileRemove(relativePath: string): Promise<void> {
    const absPath = `${this.projectPath}/${relativePath}`.replace(/\\/g, '/');
    await this.indexer.removeFile(absPath);
  }

  private markStale(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.onStale?.();
    this.staleTimer = setTimeout(() => { this.staleTimer = null; }, 10_000);
  }

  async stop(): Promise<void> {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
  }
}