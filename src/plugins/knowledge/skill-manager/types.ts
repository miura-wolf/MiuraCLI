/**
 * SkillManager — shared types.
 */

export type SkillPack = 'core' | 'testing' | 'security' | 'a11y' | 'custom';

export interface Skill {
  id: string;
  name: string;
  pack: SkillPack;
  description: string;
  content: string;
  triggers: string[];
  filePath: string;
}

export interface MatchResult {
  skill: Skill;
  score: number;
  matchedTriggers: string[];
}

/** Built-in skill definitions (installed by /skills init). */
export interface BuiltInSkill {
  id: string;
  pack: SkillPack;
  fileName: string;
  content: string;
}