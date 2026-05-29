/**
 * SkillMatcher — context-based skill matching.
 *
 * Scores skills based on:
 * 1. Exact trigger word matches (case-insensitive)
 * 2. Partial keyword matches in content
 * 3. Skill description relevance
 *
 * Returns skills sorted by score descending.
 */

import type { Skill, MatchResult } from './types.js';

export class SkillMatcher {
  /**
   * Find skills relevant to a given context string (e.g. user message).
   * Uses simple keyword intersection + weighted scoring.
   */
  match(skills: Skill[], context: string, minScore = 0.3): MatchResult[] {
    if (!context.trim()) return [];
    const ctx = context.toLowerCase();

    const results: MatchResult[] = [];

    for (const skill of skills) {
      const matchedTriggers = skill.triggers.filter(trigger =>
        ctx.includes(trigger.toLowerCase()),
      );

      let score = 0;

      // Weighted trigger matches (highest value)
      score += matchedTriggers.length * 0.5;

      // Exact skill name match
      if (ctx.includes(skill.name.toLowerCase())) {
        score += 0.3;
      }

      // Pack relevance (strong bias toward context-relevant packs)
      const packKeywords: Record<string, string[]> = {
        testing:   ['test', 'spec', 'expect', 'assert', 'vitest', 'jest', 'mocha', 'tap'],
        security:  ['security', 'auth', 'sql', 'inject', 'injection', 'xss', 'csrf', 'owasp', 'secret', 'api key', 'password', 'vulnerability', 'vulnerabilities'],
        a11y:     ['accessibility', 'wcag', 'aria', 'keyboard', 'screen reader', 'contrast', 'a11y'],
        core:     ['tdd', 'refactor', 'git', 'commit', 'review', 'pr', 'pull request'],
      };
      const keywords = packKeywords[skill.pack] ?? [];
      const matchedKeywords = keywords.filter(k => ctx.includes(k));
      score += matchedKeywords.length * 0.25;

      // Partial content keyword match (search full content for context words)
      const contentHead = skill.content.toLowerCase();
      const ctxWords = ctx.split(/\W+/).filter(w => w.length > 3);
      const contentHits = ctxWords.filter(w => contentHead.includes(w)).length;
      score += Math.min(contentHits * 0.05, 0.3);

      // Bonus: if multiple triggers matched
      if (matchedTriggers.length >= 2) score += 0.2;

      if (score >= minScore) {
        results.push({ skill, score, matchedTriggers });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Extract skill content for system prompt injection.
   * Returns formatted markdown block.
   */
  formatForPrompt(matches: MatchResult[]): string {
    if (!matches.length) return '';
    const lines = [
      '<!-- Injected skills (progressive disclosure) -->',
      '',
    ];
    for (const { skill, matchedTriggers } of matches) {
      lines.push(`## Skill: ${skill.name} (${skill.pack})`);
      if (matchedTriggers.length) {
        lines.push(`*Triggered by: ${matchedTriggers.join(', ')}*`);
      }
      lines.push('');
      lines.push(skill.content);
      lines.push('');
    }
    return lines.join('\n');
  }
}