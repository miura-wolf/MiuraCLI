/**
 * BrainManager + BrainStore tests.
 * Uses a temp SQLite file for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainStore } from './brain-store.js';
import type { BrainEntryType } from './brain-types.js';

const TEST_DB = '/tmp/brain-test.db';

describe('BrainStore', () => {
  let store: BrainStore;

  beforeEach(async () => {
    store = new BrainStore(TEST_DB);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    try { require('fs').unlinkSync(TEST_DB); } catch { /* ignore */ }
  });

  // === insert ===

  it('inserts an entry and returns it with id and createdAt', () => {
    const entry = store.insert({
      project: 'test-project',
      type: 'decision',
      topicKey: 'use-typescript',
      title: 'Use TypeScript',
      content: 'TypeScript provides compile-time safety.',
      sessionId: 'sess-001',
      metadata: {},
    });

    expect(entry.id).toMatch(/^brain_/);
    expect(entry.project).toBe('test-project');
    expect(entry.type).toBe('decision');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('generates unique IDs', () => {
    const e1 = store.insert({ project: 'p', type: 'decision', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    const e2 = store.insert({ project: 'p', type: 'decision', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    expect(e1.id).not.toBe(e2.id);
  });

  it('accepts all entry types', () => {
    const types: BrainEntryType[] = ['decision', 'architecture', 'bugfix', 'pattern', 'discovery', 'config', 'learning'];
    for (const type of types) {
      const e = store.insert({ project: 'p', type, topicKey: `k-${type}`, title: 'T', content: 'C', sessionId: undefined, metadata: {} });
      expect(e.type).toBe(type);
    }
  });

  it('stores and retrieves metadata as JSON', () => {
    const meta = { bug_title: 'auth bug', severity: 'high' };
    const e = store.insert({ project: 'p', type: 'bugfix', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: meta });
    const retrieved = store.getRecent('p', 1)[0];
    expect(retrieved.metadata).toEqual(meta);
  });

  // === search ===

  it('returns empty array when no entries match', () => {
    const results = store.search('nonexistent-query-xyz', { project: 'p' });
    expect(results).toEqual([]);
  });

  it('searches by keyword in content', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'auth', title: 'Auth decision', content: 'Use JWT for stateless auth', sessionId: undefined, metadata: {} });
    store.insert({ project: 'p', type: 'decision', topicKey: 'db', title: 'DB decision', content: 'Use SQLite with FTS5', sessionId: undefined, metadata: {} });

    const results = store.search('JWT', { project: 'p', limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('JWT');
  });

  it('searches by title keyword', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'auth', title: 'JWT Auth Choice', content: 'Detailed explanation', sessionId: undefined, metadata: {} });

    const results = store.search('JWT Auth', { project: 'p' });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit option', () => {
    for (let i = 0; i < 10; i++) {
      store.insert({ project: 'p', type: 'decision', topicKey: `k${i}`, title: `T${i}`, content: `content ${i}`, sessionId: undefined, metadata: {} });
    }
    const results = store.search('content', { project: 'p', limit: 3 });
    expect(results.length).toBe(3);
  });

  it('filters by type when specified', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    store.insert({ project: 'p', type: 'bugfix', topicKey: 'k2', title: 'T2', content: 'C2', sessionId: undefined, metadata: {} });

    const results = store.search('C', { project: 'p', type: 'bugfix' });
    expect(results.every(r => r.type === 'bugfix')).toBe(true);
  });

  it('returns entries for matching project only', () => {
    store.insert({ project: 'project-a', type: 'decision', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    store.insert({ project: 'project-b', type: 'decision', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: {} });

    const results = store.search('C', { project: 'project-a' });
    expect(results.every(r => r.project === 'project-a')).toBe(true);
  });

  // === getByTopic ===

  it('retrieves entries by topic key', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'auth-strategy', title: 'T1', content: 'C1', sessionId: 's1', metadata: {} });
    store.insert({ project: 'p', type: 'decision', topicKey: 'auth-strategy', title: 'T2', content: 'C2', sessionId: 's2', metadata: {} });
    store.insert({ project: 'p', type: 'decision', topicKey: 'other-topic', title: 'T3', content: 'C3', sessionId: undefined, metadata: {} });

    const results = store.getByTopic('auth-strategy', 'p');
    expect(results.length).toBe(2);
    expect(results.every(r => r.topicKey === 'auth-strategy')).toBe(true);
  });

  it('returns entries ordered by createdAt desc', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'k', title: 'First', content: 'C', sessionId: undefined, metadata: {} });
    // Tiny delay to ensure distinct timestamps
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }
    store.insert({ project: 'p', type: 'decision', topicKey: 'k', title: 'Second', content: 'C', sessionId: undefined, metadata: {} });

    const results = store.getByTopic('k', 'p');
    expect(results[0].title).toBe('Second');
    expect(results[1].title).toBe('First');
  });

  // === getBySession ===

  it('retrieves entries by session ID', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'k1', title: 'T1', content: 'C1', sessionId: 'sess-abc', metadata: {} });
    store.insert({ project: 'p', type: 'decision', topicKey: 'k2', title: 'T2', content: 'C2', sessionId: 'sess-abc', metadata: {} });
    store.insert({ project: 'p', type: 'decision', topicKey: 'k3', title: 'T3', content: 'C3', sessionId: 'sess-xyz', metadata: {} });

    const results = store.getBySession('sess-abc', 'p');
    expect(results.length).toBe(2);
    expect(results.every(r => r.sessionId === 'sess-abc')).toBe(true);
  });

  // === getRecent ===

  it('returns recent entries in desc order', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ project: 'p', type: 'discovery', topicKey: `k${i}`, title: `T${i}`, content: `C${i}`, sessionId: undefined, metadata: {} });
    }
    const recent = store.getRecent('p', 3);
    expect(recent.length).toBe(3);
    expect(recent[0].title).toBe('T4');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ project: 'p', type: 'discovery', topicKey: `k${i}`, title: `T${i}`, content: `C${i}`, sessionId: undefined, metadata: {} });
    }
    expect(store.getRecent('p', 2).length).toBe(2);
  });

  // === count ===

  it('counts all entries for a project', () => {
    for (let i = 0; i < 5; i++) {
      store.insert({ project: 'p', type: 'discovery', topicKey: `k${i}`, title: `T${i}`, content: `C${i}`, sessionId: undefined, metadata: {} });
    }
    expect(store.count({ project: 'p' })).toBe(5);
  });

  it('counts entries filtered by type', () => {
    store.insert({ project: 'p', type: 'decision', topicKey: 'k1', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    store.insert({ project: 'p', type: 'decision', topicKey: 'k2', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    store.insert({ project: 'p', type: 'bugfix', topicKey: 'k3', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    expect(store.count({ project: 'p', type: 'decision' })).toBe(2);
    expect(store.count({ project: 'p', type: 'bugfix' })).toBe(1);
  });

  it('returns 0 for empty project', () => {
    expect(store.count({ project: 'nonexistent-project' })).toBe(0);
  });

  // === delete ===

  it('deletes an entry by ID', () => {
    const e = store.insert({ project: 'p', type: 'decision', topicKey: 'k', title: 'T', content: 'C', sessionId: undefined, metadata: {} });
    store.delete(e.id);
    const recent = store.getRecent('p', 10);
    expect(recent.some(r => r.id === e.id)).toBe(false);
  });
});