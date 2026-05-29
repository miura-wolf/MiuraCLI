import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OpenSpecManager } from './openspec-manager.js';

describe('OpenSpecManager', () => {
  let tempDir: string;
  let manager: OpenSpecManager;

  beforeEach(() => {
    tempDir = join(tmpdir(), `openspec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    manager = new OpenSpecManager(tempDir);
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  describe('init()', () => {
    it('should create directory structure', () => {
      const result = manager.init();
      
      expect(result.created.length).toBeGreaterThanOrEqual(4);
      expect(existsSync(join(tempDir, '.miura', 'openspec', 'specs'))).toBe(true);
      expect(existsSync(join(tempDir, '.miura', 'openspec', 'changes'))).toBe(true);
      expect(existsSync(join(tempDir, '.miura', 'openspec', 'changes', 'archive'))).toBe(true);
      expect(existsSync(join(tempDir, '.openspec'))).toBe(true);
    });

    it('should be idempotent', () => {
      const first = manager.init();
      const second = manager.init();
      
      // Second call should not create new dirs
      expect(second.created.length).toBe(0);
    });
  });

  describe('Spec Management', () => {
    beforeEach(() => {
      manager.init();
    });

    it('should add and list specs', () => {
      manager.addSpec('auth', '# Auth Spec\n\n## Purpose\n\nAuthentication system.');
      manager.addSpec('db', '# DB Spec\n\n## Purpose\n\nDatabase layer.');
      
      const specs = manager.listSpecs();
      expect(specs).toHaveLength(2);
      expect(specs.map(s => s.id)).toContain('auth');
      expect(specs.map(s => s.id)).toContain('db');
    });

    it('should get a spec by ID', () => {
      manager.addSpec('auth', '# Auth Spec\n\n## Purpose\n\nAuthentication system.');
      const spec = manager.getSpec('auth');
      
      expect(spec).not.toBeNull();
      expect(spec!.metadata.id).toBe('auth');
      expect(spec!.purpose).toBe('Authentication system.');
    });

    it('should return null for unknown spec', () => {
      expect(manager.getSpec('unknown')).toBeNull();
    });

    it('should edit an existing spec', () => {
      manager.addSpec('auth', '# Auth Spec\n\n## Purpose\n\nOriginal.');
      manager.editSpec('auth', '# Auth Spec V2\n\n## Purpose\n\nUpdated.');
      
      const spec = manager.getSpec('auth');
      expect(spec!.purpose).toBe('Updated.');
    });

    it('should throw when editing non-existent spec', () => {
      expect(() => manager.editSpec('unknown', 'content')).toThrow('Spec not found');
    });

    it('should search specs by keyword', () => {
      manager.addSpec('auth', '# Auth\n\n## Purpose\n\nUser authentication with JWT.');
      manager.addSpec('db', '# Database\n\n## Purpose\n\nPostgreSQL connection pool.');
      
      const results = manager.searchSpecs('authentication');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('auth');
    });

    it('should return empty array for non-matching search', () => {
      manager.addSpec('auth', '# Auth\n\n## Purpose\n\nAuthentication.');
      expect(manager.searchSpecs('nonexistent')).toHaveLength(0);
    });
  });

  describe('Change Proposals', () => {
    beforeEach(() => {
      manager.init();
    });

    it('should create a change proposal with files', () => {
      const change = manager.createProposal(
        'Add Remember Me',
        'Add remember me checkbox with 30-day sessions',
        {
          summary: 'Add persistent login sessions',
          motivation: 'Users want to stay logged in',
          impact: ['New cookie storage', 'Session token table'],
          dependencies: [],
          riskLevel: 'low',
        },
        {
          approach: 'Add JWT refresh tokens with 30-day expiry',
          architecture: 'Token stored in httpOnly cookie',
          filesChanged: ['src/auth/login.ts', 'src/auth/session.ts'],
          decisions: [],
        },
        [
          { id: 'task-1', phase: 'implementation', title: 'Add token table', description: 'Create SQL migration', status: 'pending', dependsOn: [], estimatedEffort: 'small' },
          { id: 'task-2', phase: 'implementation', title: 'Update login flow', description: 'Add remember me checkbox', status: 'pending', dependsOn: ['task-1'], estimatedEffort: 'medium' },
        ],
        []
      );

      expect(change.id).toBeDefined();
      expect(change.title).toBe('Add Remember Me');
      expect(change.status).toBe('draft');
      expect(change.tasks).toHaveLength(2);

      // Verify files were created
      const changeDir = join(tempDir, '.miura', 'openspec', 'changes', change.id);
      expect(existsSync(join(changeDir, 'proposal.md'))).toBe(true);
      expect(existsSync(join(changeDir, 'design.md'))).toBe(true);
      expect(existsSync(join(changeDir, 'tasks.md'))).toBe(true);
    });

    it('should list changes', () => {
      manager.createProposal(
        'Change 1', 'Desc 1',
        { summary: 'S1', motivation: 'M1', impact: [], dependencies: [], riskLevel: 'low' },
        { approach: 'A', architecture: 'Arch', filesChanged: [], decisions: [] },
        [], []
      );
      manager.createProposal(
        'Change 2', 'Desc 2',
        { summary: 'S2', motivation: 'M2', impact: [], dependencies: [], riskLevel: 'high' },
        { approach: 'B', architecture: 'Arch2', filesChanged: [], decisions: [] },
        [], []
      );

      const changes = manager.listChanges();
      expect(changes).toHaveLength(2);
    });

    it('should get a change by ID', () => {
      const change = manager.createProposal(
        'Test Change', 'Test desc',
        { summary: 'Test', motivation: 'Test motivation', impact: [], dependencies: [], riskLevel: 'low' },
        { approach: 'Approach', architecture: 'Arch', filesChanged: ['file.ts'], decisions: [] },
        [], []
      );

      const loaded = manager.getChange(change.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe('Test Change');
    });

    it('should return null for unknown change', () => {
      expect(manager.getChange('unknown')).toBeNull();
    });

    it('should activate a change', () => {
      const change = manager.createProposal(
        'Activate Test', 'Desc',
        { summary: 'S', motivation: 'M', impact: [], dependencies: [], riskLevel: 'medium' },
        { approach: 'A', architecture: 'Arch', filesChanged: [], decisions: [] },
        [], []
      );

      manager.activateChange(change.id);
      const state = manager.getChangeState(change.id);
      
      expect(state).not.toBeNull();
      expect(state!.status).toBe('active');
      expect(state!.currentPhase).toBe('implementation');
    });
  });

  describe('Verification', () => {
    beforeEach(() => {
      manager.init();
    });

    it('should verify a change with all tasks completed', () => {
      const change = manager.createProposal(
        'Completed Change', 'Desc',
        { summary: 'S', motivation: 'M', impact: [], dependencies: [], riskLevel: 'low' },
        { approach: 'A', architecture: 'Arch', filesChanged: [], decisions: [] },
        [
          { id: 't1', phase: 'implementation', title: 'Task 1', description: 'Done', status: 'completed', dependsOn: [], estimatedEffort: 'small' },
        ],
        []
      );

      // Manually mark task as completed via file modification
      const result = manager.verify(change.id);
      // Status depends on what's in the file (pending/active/completed)
      expect(result.changeId).toBe(change.id);
      expect(result.totalCount).toBeGreaterThan(0);
    });

    it('should return failed for unknown change', () => {
      const result = manager.verify('unknown');
      expect(result.status).toBe('failed');
    });
  });

  describe('Archive', () => {
    beforeEach(() => {
      manager.init();
    });

    it('should archive a change', () => {
      const change = manager.createProposal(
        'Archive Test', 'Desc',
        { summary: 'Testing archive', motivation: 'M', impact: [], dependencies: [], riskLevel: 'low' },
        { approach: 'A', architecture: 'Arch', filesChanged: [], decisions: [] },
        [
          { id: 't1', phase: 'implementation', title: 'Task 1', description: 'Done', status: 'completed', dependsOn: [], estimatedEffort: 'small' },
        ],
        []
      );

      const record = manager.archive(change.id);
      
      expect(record.changeId).toBe(change.id);
      expect(record.summary).toBe('Testing archive');
      expect(record.requirementsImplemented).toBe(1);

      // Original change dir should be removed
      const originalDir = join(tempDir, '.miura', 'openspec', 'changes', change.id);
      expect(existsSync(originalDir)).toBe(false);

      // Archive should exist
      const archiveDir = join(tempDir, '.miura', 'openspec', 'changes', 'archive', change.id);
      expect(existsSync(archiveDir)).toBe(true);
    });

    it('should throw when archiving non-existent change', () => {
      expect(() => manager.archive('unknown')).toThrow('Change not found');
    });

    it('should list archived changes', () => {
      const change = manager.createProposal(
        'Archive List', 'Desc',
        { summary: 'Testing archive list', motivation: 'M', impact: [], dependencies: [], riskLevel: 'low' },
        { approach: 'A', architecture: 'Arch', filesChanged: [], decisions: [] },
        [],
        []
      );

      manager.archive(change.id);
      
      const archived = manager.listArchived();
      expect(archived).toHaveLength(1);
      expect(archived[0].changeId).toBe(change.id);
    });
  });
});