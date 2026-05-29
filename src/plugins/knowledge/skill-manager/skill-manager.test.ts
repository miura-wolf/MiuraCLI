/**
 * SkillManager plugin tests.
 * Tests SkillMatcher and SkillManagerPlugin with isolated temp skill dirs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SkillMatcher } from './matcher.js';
import type { Skill, BuiltInSkill } from './types.js';
import { SkillManagerPlugin } from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'core/test',
    name: 'Test Skill',
    pack: 'core',
    description: 'A test skill',
    content: 'This is test skill content about testing.',
    triggers: ['test', 'tdd'],
    filePath: '/tmp/test-skill.md',
    ...overrides,
  };
}

/** Unique dir per test invocation — avoids cross-test pollution */
function uniqueTempDir(): string {
  return `/tmp/miura-skills-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const SHARED_TEMP = '/tmp/miura-skills-shared';

function cleanSharedTemp(): void {
  try { rmSync(SHARED_TEMP, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(SHARED_TEMP, { recursive: true });
}

function createPlugin(dir = SHARED_TEMP): SkillManagerPlugin {
  const plugin = new SkillManagerPlugin();
  plugin.skillsDir = dir;
  return plugin;
}

function writeSkill(dir: string, pack: string, name: string, content: string, triggers = ''): void {
  const packDir = join(dir, pack);
  if (!existsSync(packDir)) mkdirSync(packDir, { recursive: true });
  const fileName = `${name}.md`;
  const frontmatter = [
    '---',
    `name: ${name}`,
    `pack: ${pack}`,
    `description: ${name} skill`,
    `triggers: ${triggers}`,
    '---',
    '',
  ].join('\n');
  writeFileSync(join(packDir, fileName), frontmatter + content, 'utf-8');
}

// ─── SkillMatcher ─────────────────────────────────────────────────────────────

describe('SkillMatcher', () => {
  let matcher: SkillMatcher;

  beforeEach(() => { matcher = new SkillMatcher(); });

  describe('match()', () => {
    it('returns empty for empty context', () => {
      expect(matcher.match([], '')).toHaveLength(0);
      expect(matcher.match([], '  ')).toHaveLength(0);
    });

    it('matches by trigger keyword (case-insensitive)', () => {
      const skills = [makeSkill({ triggers: ['tdd', 'test first'] })];
      const results = matcher.match(skills, 'I want to use TDD for this feature');
      expect(results).toHaveLength(1);
      expect(results[0].matchedTriggers).toContain('tdd');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('matches by skill name', () => {
      const skills = [makeSkill({ name: 'Conventional Commits', triggers: [] })];
      const results = matcher.match(skills, 'What are conventional commits?');
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('scores multiple triggers higher', () => {
      const skill = makeSkill({ triggers: ['test', 'unit', 'spec'] });
      const results = matcher.match([skill], 'write unit tests for this spec');
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    it('filters by minScore threshold', () => {
      const skills = [
        makeSkill({ id: 's1', name: 'TDD', triggers: ['tdd'] }),
        makeSkill({ id: 's2', name: 'Other', triggers: ['foo'] }),
      ];
      const results = matcher.match(skills, 'I want to use TDD', 0.3);
      expect(results).toHaveLength(1);
      expect(results[0].skill.id).toBe('s1');
    });

    it('returns skills sorted by score descending', () => {
      const skills = [
        makeSkill({ id: 'low', name: 'Low', triggers: ['unrelated'] }),
        makeSkill({ id: 'high', name: 'TDD', triggers: ['tdd'] }),
        makeSkill({ id: 'mid', name: 'TDD Style', triggers: ['tdd', 'style'] }),
      ];
      const results = matcher.match(skills, 'I want TDD with style');
      // "low" score < 0.3 (no matched triggers) → filtered out
      expect(results.length).toBe(2);
      expect(results[0].skill.id).toBe('mid');
      expect(results[1].skill.id).toBe('high');
    });

    it('matches testing and security packs by pack-specific keywords', () => {
      const testing = makeSkill({ id: 'test', pack: 'testing', name: 'Vitest', triggers: [] });
      const security = makeSkill({ id: 'sec', pack: 'security', name: 'OWASP', triggers: [] });
      const results = matcher.match(
        [testing, security],
        'how to write test cases with vitest and check for injection vulnerabilities',
      );
      const packs = results.map(r => r.skill.pack);
      expect(packs).toContain('testing');
      expect(packs).toContain('security');
    });

    it('handles skills with no triggers', () => {
      const skills = [makeSkill({ triggers: [] })];
      expect(matcher.match(skills, 'hello world')).toHaveLength(0);
    });
  });

  describe('formatForPrompt()', () => {
    it('returns empty string for empty results', () => {
      expect(matcher.formatForPrompt([])).toBe('');
    });

    it('formats matched skills as markdown', () => {
      const skill = makeSkill({ name: 'TDD', pack: 'core', content: '# Test\n\nContent here.' });
      const result = matcher.formatForPrompt([{ skill, score: 1, matchedTriggers: ['tdd'] }]);
      expect(result).toContain('## Skill: TDD (core)');
      expect(result).toContain('*Triggered by: tdd*');
      expect(result).toContain('# Test');
      expect(result).toContain('Content here.');
    });

    it('includes multiple skills', () => {
      const skills = [
        makeSkill({ id: 's1', name: 'TDD', pack: 'core', triggers: ['tdd'] }),
        makeSkill({ id: 's2', name: 'OWASP', pack: 'security', triggers: ['owasp'] }),
      ];
      const result = matcher.formatForPrompt(skills.map((s, i) => ({
        skill: s, score: i, matchedTriggers: s.triggers,
      })));
      expect(result).toContain('## Skill: TDD');
      expect(result).toContain('## Skill: OWASP');
    });

    it('does not mention triggers if none matched', () => {
      const skill = makeSkill({ triggers: [] });
      const result = matcher.formatForPrompt([{ skill, score: 1, matchedTriggers: [] }]);
      expect(result).not.toContain('*Triggered by:');
    });
  });
});

// ─── SkillManagerPlugin ────────────────────────────────────────────────────────

describe('SkillManagerPlugin', () => {
  beforeEach(() => { cleanSharedTemp(); });
  afterEach(() => { cleanSharedTemp(); });

  // ─── init() ────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('installs built-in skills to the configured skillsDir', async () => {
      const p = createPlugin();
      const result = await p.init();

      expect(result.installed).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(SHARED_TEMP, 'core', 'tdd.md'))).toBe(true);
      expect(existsSync(join(SHARED_TEMP, 'security', 'owasp-top10.md'))).toBe(true);
      expect(existsSync(join(SHARED_TEMP, 'a11y', 'wcag-checklist.md'))).toBe(true);
      expect(existsSync(join(SHARED_TEMP, 'testing', 'vitest.md'))).toBe(true);
    });

    it('skips already-installed skills', async () => {
      const dir = uniqueTempDir();
      mkdirSync(join(dir, 'core'), { recursive: true });
      writeFileSync(join(dir, 'core', 'tdd.md'), 'pre-existing\n', 'utf-8');

      const p = createPlugin(dir);
      const result = await p.init();

      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── list / get ─────────────────────────────────────────────────────────────

  describe('list() / listByPack()', () => {
    it('returns empty when no skills dir exists and not initialized', async () => {
      const dir = uniqueTempDir(); // does NOT exist
      const p = createPlugin(dir);
      expect(p.list()).toHaveLength(0);
    });

    it('lists skills grouped by pack', async () => {
      const dir = uniqueTempDir();
      // writeSkill to 'custom' and 'web' packs — not affected by init() built-ins
      writeSkill(dir, 'custom', 'my-tool', '# My Tool', 'tool, custom');
      writeSkill(dir, 'web', 'my-react', '# React', 'react, hooks');

      const p = createPlugin(dir);
      await p.init();

      const custom = p.listByPack('custom');
      expect(custom).toHaveLength(1);
      expect(custom[0].name).toBe('my-tool');

      const web = p.listByPack('web');
      expect(web).toHaveLength(1);
      expect(web[0].name).toBe('my-react');
    });
  });

  // ─── get / remove ───────────────────────────────────────────────────────────

  describe('get() / remove()', () => {
    it('returns a skill by id', async () => {
      writeSkill(SHARED_TEMP, 'core', 'test', '# Test', 'test');

      const p = createPlugin();
      await p.init();

      const skill = p.get('core/test');
      expect(skill?.name).toBe('test');
    });

    it('returns undefined for unknown id', async () => {
      const p = createPlugin();
      await p.init();
      expect(p.get('nonexistent')).toBeUndefined();
    });

    it('removes a skill by id from memory', async () => {
      writeSkill(SHARED_TEMP, 'core', 'remove-me', '# Remove', 'test');

      const p = createPlugin();
      await p.init();

      const before = p.list().length;
      expect(p.remove('core/remove-me')).toBe(true);
      const after = p.list().length;
      expect(after).toBe(before - 1);
    });

    it('remove returns false for unknown id', () => {
      const p = createPlugin();
      expect(p.remove('foo/bar')).toBe(false);
    });
  });

  // ─── matchSkills / getInjectedContent ─────────────────────────────────────

  describe('matchSkills() / getInjectedContent()', () => {
    it('matches skills by context triggers', async () => {
      writeSkill(SHARED_TEMP, 'core', 'tdd', '# TDD', 'tdd, red, green');
      writeSkill(SHARED_TEMP, 'testing', 'vitest', '# Vitest', 'vitest, test, mock');

      const p = createPlugin();
      await p.init();

      const results = p.matchSkills('I want to use TDD with RED first tests');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].skill.name).toBe('tdd');
      expect(results[0].matchedTriggers).toContain('tdd');
    });

    it('returns empty array for no matches', async () => {
      writeSkill(SHARED_TEMP, 'core', 'tdd', '# TDD', 'tdd');

      const p = createPlugin();
      await p.init();
      expect(p.matchSkills('what is the weather like today')).toHaveLength(0);
    });

    it('getInjectedContent returns formatted prompt content', async () => {
      writeSkill(SHARED_TEMP, 'core', 'git', '# Git Commits\n\nContent.', 'git, commit');

      const p = createPlugin();
      await p.init();

      const content = p.getInjectedContent('how to do git commits properly');
      expect(content).toContain('## Skill:');
      expect(content).toContain('git');
      expect(content).toContain('Content.');
    });

    it('getInjectedContent returns empty for no matches', async () => {
      writeSkill(SHARED_TEMP, 'core', 'x', '# X', 'z');

      const p = createPlugin();
      await p.init();
      expect(p.getInjectedContent('what is the weather forecast')).toBe('');
    });
  });

  // ─── add() ───────────────────────────────────────────────────────────────────

  describe('add()', () => {
    it('adds a custom skill from file path', async () => {
      const dir = uniqueTempDir();
      mkdirSync(join(dir, 'custom'), { recursive: true });
      const customPath = join(dir, 'custom', 'my-custom.md');
      const content = [
        '---',
        'name: My Custom',
        'pack: custom',
        'triggers: custom, foo',
        '---',
        '# Custom Skill',
        'My custom content here.',
      ].join('\n');
      writeFileSync(customPath, content, 'utf-8');

      const p = createPlugin();
      await p.init();

      const skill = await p.add(customPath);
      expect(skill.name).toBe('My Custom');
      expect(skill.pack).toBe('custom');
      expect(skill.triggers).toContain('custom');
      expect(p.get('custom/my-custom')?.name).toBe('My Custom');
    });
  });

  // ─── manifest ─────────────────────────────────────────────────────────────────

  describe('manifest', () => {
    it('has correct plugin manifest', () => {
      const p = new SkillManagerPlugin();
      expect(p.manifest.id).toBe('skill-manager');
      expect(p.manifest.type).toBe('knowledge');
      expect(p.manifest.capabilities).toContain('skill-list');
      expect(p.manifest.capabilities).toContain('skill-match');
    });
  });
});

// ─── BUILTIN_SKILLS ────────────────────────────────────────────────────────────

describe('BUILTIN_SKILLS', () => {
  it('has at least 6 built-in skills', async () => {
    const { BUILTIN_SKILLS } = await import('./index.js');
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(6);
  });

  it('all built-in skills have non-empty content', async () => {
    const { BUILTIN_SKILLS } = await import('./index.js');
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.content.trim().length).toBeGreaterThan(10);
      expect(skill.id).toBeTruthy();
      expect(skill.pack).toBeTruthy();
    }
  });

  it('built-in skill packs cover core, testing, security, a11y', async () => {
    const { BUILTIN_SKILLS } = await import('./index.js');
    const packs = new Set(BUILTIN_SKILLS.map(s => s.pack));
    expect(packs.has('core')).toBe(true);
    expect(packs.has('testing')).toBe(true);
    expect(packs.has('security')).toBe(true);
    expect(packs.has('a11y')).toBe(true);
  });
});