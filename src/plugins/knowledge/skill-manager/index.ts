/**
 * SkillManager — Plugin interface for skills system.
 *
 * Loads skill markdown files from ~/.miura/skills/ and matches
 * them to the current conversation context for progressive disclosure
 * in system prompts.
 *
 * CLI commands: /skills list | init | add | remove
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Plugin, PluginHostAPI, PluginManifest, ToolHandler } from '../../../core/types.js';
import { SkillMatcher } from './matcher.js';
import type { Skill, SkillPack, MatchResult, BuiltInSkill } from './types.js';

// ─── Built-in skills (embedded, installed by /skills init) ─────────────────

export const BUILTIN_SKILLS: BuiltInSkill[] = [
  {
    id: 'core/tdd',
    pack: 'core',
    fileName: 'tdd.md',
    content: `# TDD Workflow

## Cuándo usar
Cuando se pide implementar una nueva funcionalidad o feature.

## Pasos

1. **RED Phase**: Escribir tests que fallen primero
   - Crear test para US-XXX basado en criterios de aceptación
   - Verificar que el test falla (rojo) antes de escribir código
   - Commit: \`test: add [feature] tests (RED)\`

2. **GREEN Phase**: Implementar mínimo código para que pasen los tests
   - Escribir solo el código necesario para que pasen los tests
   - No optimizaciones prematuras
   - Commit: \`feat: implement [feature] (GREEN)\`

3. **REFACTOR Phase**: Mejorar el código
   - Eliminar duplicación, mejorar nombres, simplificar lógica
   - Todos los tests siguen pasando
   - Commit: \`refactor: improve [area] (REFACTOR)\`

4. **Security Check**: Auditar código antes de merge
   - OWASP Top 10 checklist
   - No secrets hardcoded en código
   - Validar inputs en bordes

5. **A11Y Check**: Verificar accesibilidad
   - WCAG 2.1 AA compliance
   - Keyboard navigation
   - ARIA labels donde corresponda

## Reglas
- NUNCA escribir código sin tests fallando primero
- NUNCA mencionar "AI" o "Claude" en commits
- SIEMPRE aplicar linter y formatter antes de commit
`,
  },
  {
    id: 'core/git-commits',
    pack: 'core',
    fileName: 'git-commits.md',
    content: `# Conventional Commits

## Formato
\`\`\`
<type>(<scope>): <description>

[optional body]

[optional footer]
\`\`\`

## Tipos permitidos
| Tipo | Uso |
|------|-----|
| feat | Nueva funcionalidad |
| fix | Corrección de bug |
| test | Agregar o corregir tests |
| refactor | Refactoring sin cambio de comportamiento |
| perf | Mejora de performance |
| docs | Solo documentación |
| style | Formato, linter, sin cambio de lógica |
| build | Cambios en build system |
| ci | Cambios en CI/CD |
| chore | Tareas de mantenimiento |

## Reglas
- El subject usa **imperativo presente**: "add" no "added"
- No terminar el subject con punto
-Máx 72 caracteres en subject
- Body separado por línea vacía
- Referenciar issues: \`Refs #123\` o \`Closes #123\`
- **NUNCA** mencionar "AI", "Claude", "bot", "generated" en mensajes

## Ejemplos
\`\`\`
feat(auth): add JWT refresh token rotation

fix(api): handle null response from upstream service

docs(readme): update installation instructions
\`\`\`
`,
  },
  {
    id: 'core/code-review',
    pack: 'core',
    fileName: 'code-review.md',
    content: `# Code Review Checklist

## Antes de pedir review
- [ ] Tests escritos y pasando
- [ ] Linter y formatter aplicados
- [ ] No console.log o debugger statements
- [ ] Errores tipados (no \`any\`)
- [ ] Documentación actualizada si aplica

## Como reviewer, verificar

### Corrección
- [ ] El código hace lo que el PR dice que hace
- [ ] Edge cases manejados (null, vacío, límites)
- [ ] No regressions en funcionalidades existentes

### Diseño
- [ ] Responsibilities claras — no god classes
- [ ] Dependencies bien desacopladas
- [ ] Nombres descriptivos y consistentes
- [ ] Abstracciones apropiadas

### Seguridad
- [ ] Inputs validados antes de usar
- [ ] No secrets hardcoded
- [ ] Permisos mínimos necesarios
- [ ] SQL injection, XSS checked

### Performance
- [ ] No N+1 queries
- [ ] Lazy loading donde corresponde
- [ ] Índices usados correctamente

## Feedback guidelines
- Crítico con el código, amable con la persona
- Preferir preguntas: "¿qué pasa si el input es null?" en vez de "esto está mal"
- Sugerir soluciones, no solo señalar problemas
- Aprobar con comentarios menores sin bloquear merge
`,
  },
  {
    id: 'testing/vitest',
    pack: 'testing',
    fileName: 'vitest.md',
    content: `# Vitest Testing Patterns

## Setup
\`\`\`typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
\`\`\`

## Estructura de test
\`\`\`typescript
describe('ComponentName', () => {
  let sut: SystemUnderTest;

  beforeEach(() => {
    sut = new SystemUnderTest();
  });

  it('does X when Y', () => {
    const result = sut.method('input');
    expect(result).toBe('expected');
  });

  it('throws when input is invalid', () => {
    expect(() => sut.method(null)).toThrow('Expected error');
  });
});
\`\`\`

## Matchers comunes
\`\`\`typescript
expect(value).toBe(expected)       // === comparison
expect(value).toEqual(obj)         // deep equality
expect(value).toBeTruthy()         // !!value
expect(value).toBeNull()           // === null
expect(fn).toThrow()               // throws
expect(fn).toThrow(/pattern/)     // throws matching regex
expect(arr).toHaveLength(3)        // array length
expect(obj).toHaveProperty('key')  // has property
expect(mock).toHaveBeenCalled()   // spy called
expect(mock).toHaveBeenCalledWith(arg1, arg2)
\`\`\`

## Mocking
\`\`\`typescript
// Module mock
vi.mock('./db.js', () => ({
  query: vi.fn().mockResolvedValue([{ id: 1 }])
}));

// Spy
const spy = vi.spyOn(Math, 'random');

// Restore
afterEach(() => { vi.restoreAllMocks(); });
\`\`\`

## Reglas
- Tests independientes — no rely on execution order
- Nombre descriptivo: \`it('returns null when user not found')\`
- Un concepto por test
- Evitar setup compartido que crea order dependencies
`,
  },
  {
    id: 'security/owasp-top10',
    pack: 'security',
    fileName: 'owasp-top10.md',
    content: `# OWASP Top 10 Checklist

## A01 — Broken Access Control
- [ ] Verify user identity for every protected endpoint
- [ ] Deny by default — explicit allow rules only
- [ ] Log access control failures
- [ ] Rate limit API to minimize automated attacks

## A02 — Cryptographic Failures
- [ ] No sensitive data in URLs (tokens, passwords)
- [ ] Verify encryption at rest for PII
- [ ] Use strong, up-to-date algorithms (AES-256, RSA-4096+)
- [ ] No custom crypto

## A03 — Injection
- [ ] Parameterized queries for all DB access (no string concat)
- [ ] Input validation on server side (never trust client)
- [ ] Escape output in HTML/JS contexts
- [ ] Use ORM's sanitized methods

## A04 — Insecure Design
- [ ] Threat modeling for new features
- [ ] Failed authentication = generic error message
- [ ] Rate limiting on sensitive endpoints
- [ ] Security design review in sprint

## A05 — Security Misconfiguration
- [ ] Dev/staging != production config (secrets, debug, CORS)
- [ ] No default credentials
- [ ] Security headers set (CSP, HSTS, X-Frame-Options)
- [ ] Dependencies audited (npm audit, dependabot)

## A06 — Vulnerable Components
- [ ] \`npm audit\` passing before deploy
- [ ] Keep dependencies up to date
- [ ] No unused dependencies
- [ ] Prefer components with security track record

## A07 — Auth & Identity Failures
- [ ] Strong password policy enforced
- [ ] MFA available for privileged accounts
- [ ] Session tokens rotated on re-auth
- [ ] No sensitive data in JWT payload

## A08 — Data Integrity Failures
- [ ] Verify integrity of uploaded files
- [ ] Signed server-side state for critical operations
- [ ] No execute permissions on uploads

## A09 — Logging & Monitoring
- [ ] Failed auth attempts logged
- [ ] Errors don't expose stack traces to client
- [ ] Alerts on suspicious patterns

## A10 — SSRF
- [ ] Validate and sanitize URL inputs
- [ ] Deny by default in allowlists (not blocklists)
- [ ] No user-controlled URL resolution
`,
  },
  {
    id: 'a11y/wcag-checklist',
    pack: 'a11y',
    fileName: 'wcag-checklist.md',
    content: `# WCAG 2.1 AA Compliance Checklist

## Perceptible

### Text Alternatives (1.1)
- [ ] All images have \`alt\` text (or \`alt=""\` if decorative)
- [ ] Complex images have long description nearby
- [ ] Charts have data table alternative

### Time-based Media (1.2)
- [ ] Captions for video with audio
- [ ] Transcript available for audio-only content

### Adaptable (1.3)
- [ ] Page has logical reading order (DOM = visual)
- [ ] Headings used correctly (no skip levels)
- [ ] \`<label for>\` associations for all form inputs
- [ ] Form inputs have visible labels
- [ ] Error messages identify the field with the error

### Distinguishable (1.4)
- [ ] Color contrast ratio ≥ 4.5:1 (text), ≥ 3:1 (large text, UI)
- [ ] Text resizable to 200% without loss of content
- [ ] No information conveyed by color alone
- [ ] No auto-playing audio
- [ ] Focus visible on all interactive elements

## Operable

### Keyboard Accessible (2.1)
- [ ] All functionality available via keyboard
- [ ] No keyboard traps
- [ ] Skip-to-content link as first focusable element
- [ ] Logical tab order (DOM order = visual order)

### Enough Time (2.2)
- [ ] Moving content can be paused
- [ ] No time limits (or extendable)
- [ ] Re-auth doesn't lose data

### Seizures (2.3)
- [ ] No flashing content (≥3 flashes/second)

### Navigable (2.4)
- [ ] Page has descriptive \`<title>\`
- [ ] Headings describe section content
- [ ] Focus order is logical
- [ ] Link purpose is identifiable (not "click here")

### Input Modalities (2.5)
- [ ] Touch targets ≥ 44x44px
- [ ] No relying solely on pointer gestures

## Understandable

### Readable (3.1)
- [ ] Page language declared (\`lang="es"\`)
- [ ] Abbreviations spelled out on first use

### Predictable (3.2)
- [ ] Same navigation in same location
- [ ] No context changes without user action

### Input Assistance (3.3)
- [ ] Error messages suggest fixes
- [ ] Legal/financial data reversible or verified
- [ ] Labels and instructions for complex forms

## Robust

### Compatible (4.1)
- [ ] Valid HTML (no unclosed tags)
- [ ] ARIA used correctly (or not used at all)
- [ ] Status messages announced via ARIA live regions
`,
  },
];

// ─── Manifest ────────────────────────────────────────────────────────────────

export const MANIFEST: PluginManifest = {
  id: 'skill-manager',
  name: 'Skills System',
  version: '0.1.0',
  type: 'knowledge' as const,
  capabilities: ['skill-list', 'skill-match', 'skill-inject', 'skill-manage'],
  dependencies: [],
};

// ─── Plugin ─────────────────────────────────────────────────────────────────

export class SkillManagerPlugin implements Plugin {
  manifest = MANIFEST;

  private host: PluginHostAPI | null = null;
  private skills: Skill[] = [];
  private matcher = new SkillMatcher();
  skillsDir: string = join(homedir(), '.miura', 'skills');

  constructor() {}

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;

    const registry = host.getToolRegistry();
    registry.register(this.makeSkillListTool());
    registry.register(this.makeSkillMatchTool());
  }

  async activate(): Promise<void> {
    await this.loadSkills();
  }

  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {
    this.skills = [];
    this.host = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Get all loaded skills. */
  list(): Skill[] {
    return [...this.skills];
  }

  /** Get skills by pack. */
  listByPack(pack: string): Skill[] {
    return this.skills.filter(s => s.pack === pack);
  }

  /** Get a skill by ID. */
  get(id: string): Skill | undefined {
    return this.skills.find(s => s.id === id);
  }

  /**
   * Match skills against a context string (e.g. user message).
   * Returns sorted by relevance score descending.
   */
  matchSkills(context: string, minScore = 0.3): MatchResult[] {
    return this.matcher.match(this.skills, context, minScore);
  }

  /**
   * Get formatted skill content for system prompt injection.
   */
  getInjectedContent(context: string): string {
    const matches = this.matchSkills(context);
    return this.matcher.formatForPrompt(matches);
  }

  /**
   * Install built-in skills to ~/.miura/skills/
   */
  async init(): Promise<{ installed: number; skipped: number }> {
    let installed = 0;
    let skipped = 0;

    for (const builtIn of BUILTIN_SKILLS) {
      const dir = join(this.skillsDir, builtIn.pack);
      const filePath = join(dir, builtIn.fileName);

      if (!existsSync(dir)) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(dir, { recursive: true });
      }

      if (!existsSync(filePath)) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(filePath, builtIn.content, 'utf-8');
        installed++;
      } else {
        skipped++;
      }
    }

    await this.loadSkills();
    return { installed, skipped };
  }

  /**
   * Add a custom skill from a file path.
   */
  async add(filePath: string): Promise<Skill> {
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(filePath, 'utf-8');
    const skill = this.parseSkillFile(filePath, content);
    this.skills.push(skill);
    return skill;
  }

  /**
   * Remove a skill by ID.
   */
  remove(id: string): boolean {
    const idx = this.skills.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.skills.splice(idx, 1);
    return true;
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async loadSkills(): Promise<void> {
    const { readFileSync, existsSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const loaded: Skill[] = [];

    if (!existsSync(this.skillsDir)) {
      this.skills = [];
      return;
    }

    this.skills = []; // reset before rebuilding
    const packs = readdirSync(this.skillsDir);
    for (const pack of packs) {
      const packDir = join(this.skillsDir, pack);
      if (!statSync(packDir).isDirectory()) continue;
      if (!['core', 'testing', 'security', 'a11y', 'custom', 'mobile', 'web'].includes(pack)) continue;

      const files = readdirSync(packDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const filePath = join(packDir, file);
          const content = readFileSync(filePath, 'utf-8');
          const skill = this.parseSkillFile(filePath, content);
          skill.pack = pack as Skill['pack'];
          loaded.push(skill);
        } catch { /* skip unreadable files */ }
      }
    }

    this.skills = loaded;
  }

  private parseSkillFile(filePath: string, content: string): Skill {
    const name = this.extractFrontmatter(content, 'name')
      ?? basename(filePath, '.md');
    const pack = this.extractFrontmatter(content, 'pack') as SkillPack ?? 'custom';
    const triggersRaw = this.extractFrontmatter(content, 'triggers') ?? '';
    const triggers = triggersRaw
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
    const description = this.extractFrontmatter(content, 'description') ?? '';
    const id = `${pack}/${name.replace(/\s+/g, '-').toLowerCase()}`;

    return { id, name, pack, description, content, triggers, filePath };
  }

  private extractFrontmatter(content: string, key: string): string | null {
    const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'im');
    const match = content.match(pattern);
    return match ? match[1].trim() : null;
  }

  // ─── Tool handlers ──────────────────────────────────────────────────────────

  private makeSkillListTool(): ToolHandler {
    return {
      definition: {
        name: 'skill_list',
        description: 'List all available skills grouped by pack',
        parameters: {
          type: 'object',
          properties: {
            pack: { type: 'string', description: 'Filter by pack (core|testing|security|a11y|custom)' },
          },
        },
      },
      execute: async (args) => {
        const packs = this.listByPack(args.pack as string ?? 'core');
        const all = args.pack ? this.listByPack(args.pack as string) : this.list();
        const byPack = all.reduce<Record<string, Skill[]>>((acc, s) => {
          (acc[s.pack] ??= []).push(s);
          return acc;
        }, {});

        const lines = ['## Available Skills', ''];
        for (const [p, skills] of Object.entries(byPack)) {
          lines.push(`### ${p}`);
          for (const s of skills) {
            lines.push(`- **${s.name}** — ${s.description || '(no description)'}`);
            if (s.triggers.length) {
              lines.push(`  _triggers: ${s.triggers.join(', ')}_`);
            }
          }
          lines.push('');
        }

        return { name: 'skill_list', output: lines.join('\n'), durationMs: 0 };
      },
    };
  }

  private makeSkillMatchTool(): ToolHandler {
    return {
      definition: {
        name: 'skill_match',
        description: 'Match skills to the current context and return relevant ones for injection',
        parameters: {
          type: 'object',
          properties: {
            context: { type: 'string', description: 'Conversation context to match against' },
            minScore: { type: 'number', description: 'Minimum match score (default 0.3)' },
          },
          required: ['context'],
        },
      },
      execute: async (args) => {
        const matches = this.matchSkills(
          args.context as string,
          args.minScore as number ?? 0.3,
        );
        return {
          name: 'skill_match',
          output: matches.length
            ? this.matcher.formatForPrompt(matches)
            : 'No skills matched the context.',
          durationMs: 0,
        };
      },
    };
  }
}