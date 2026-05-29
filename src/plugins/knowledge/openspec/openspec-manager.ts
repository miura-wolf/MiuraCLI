/**
 * OpenSpecManager — Spec-Driven Development for MiuraSwarm
 * 
 * Manages .miura/openspec/ directory structure:
 * .miura/openspec/
 *   specs/{capability}/spec.md
 *   changes/{change-id}/
 *     proposal.md
 *     design.md  
 *     tasks.md
 *     specs/{capability}/spec.md
 *   archive/{change-id}/
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import {
  SpecDocument, SpecRequirement, SpecScenario,
  ChangeProposal, TaskItem, SpecDelta,
  ChangeState, VerificationResult, ArchiveRecord
} from './types.js';

export class OpenSpecManager {
  private projectRoot: string;
  private openspecDir: string;
  private changesDir: string;
  private specsDir: string;
  private archiveDir: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.openspecDir = join(this.projectRoot, '.miura', 'openspec');
    this.specsDir = join(this.openspecDir, 'specs');
    this.changesDir = join(this.openspecDir, 'changes');
    this.archiveDir = join(this.changesDir, 'archive');
  }

  /**
   * Initialize the OpenSpec directory structure
   */
  init(): { created: string[] } {
    const dirs = [
      this.openspecDir,
      this.specsDir,
      this.changesDir,
      this.archiveDir,
    ];

    const created: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }

    // Also create .openspec symlink (directory copy on Windows)
    const altDir = join(this.projectRoot, '.openspec');
    if (!existsSync(altDir)) {
      mkdirSync(altDir, { recursive: true });
      created.push(altDir);
    }

    return { created };
  }

  getOpenspecDir(): string { return this.openspecDir; }
  getSpecsDir(): string { return this.specsDir; }
  getChangesDir(): string { return this.changesDir; }
  getArchiveDir(): string { return this.archiveDir; }

  // ===========================================================================
  // Spec Management
  // ===========================================================================

  /**
   * List all capability specs
   */
  listSpecs(): { id: string; title: string }[] {
    if (!existsSync(this.specsDir)) return [];
    
    const specs: { id: string; title: string }[] = [];
    const entries = readdirSync(this.specsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const specFile = join(this.specsDir, entry.name, 'spec.md');
        if (existsSync(specFile)) {
          const content = readFileSync(specFile, 'utf-8');
          const title = this.extractTitle(content) || entry.name;
          specs.push({ id: entry.name, title });
        }
      }
    }
    
    return specs;
  }

  /**
   * Get a spec document by capability ID
   */
  getSpec(capabilityId: string): SpecDocument | null {
    const specFile = join(this.specsDir, capabilityId, 'spec.md');
    if (!existsSync(specFile)) return null;
    
    return this.parseSpecDocument(readFileSync(specFile, 'utf-8'), capabilityId);
  }

  /**
   * Add a new spec
   */
  addSpec(capabilityId: string, content: string): SpecDocument {
    const specDir = join(this.specsDir, capabilityId);
    mkdirSync(specDir, { recursive: true });
    
    const specFile = join(specDir, 'spec.md');
    writeFileSync(specFile, content, 'utf-8');
    
    return this.parseSpecDocument(content, capabilityId);
  }

  /**
   * Edit an existing spec
   */
  editSpec(capabilityId: string, content: string): SpecDocument {
    const specFile = join(this.specsDir, capabilityId, 'spec.md');
    if (!existsSync(specFile)) {
      throw new Error(`Spec not found: ${capabilityId}`);
    }
    
    writeFileSync(specFile, content, 'utf-8');
    return this.parseSpecDocument(content, capabilityId);
  }

  /**
   * Search specs by keyword
   */
  searchSpecs(query: string): { id: string; title: string; snippet: string }[] {
    const specs = this.listSpecs();
    const results: { id: string; title: string; snippet: string }[] = [];
    const lowerQuery = query.toLowerCase();
    
    for (const spec of specs) {
      const doc = this.getSpec(spec.id);
      if (!doc) continue;
      
      const fullText = this.specToText(doc);
      if (fullText.toLowerCase().includes(lowerQuery)) {
        // Find the first occurrence for snippet
        const idx = fullText.toLowerCase().indexOf(lowerQuery);
        const start = Math.max(0, idx - 40);
        const end = Math.min(fullText.length, idx + query.length + 40);
        const snippet = (start > 0 ? '...' : '') + 
          fullText.slice(start, end) + 
          (end < fullText.length ? '...' : '');
        
        results.push({ id: spec.id, title: spec.title, snippet });
      }
    }
    
    return results;
  }

  // ===========================================================================
  // Change Proposal Management
  // ===========================================================================

  /**
   * Create a new change proposal
   */
  createProposal(
    title: string,
    description: string,
    proposal: ChangeProposal['proposal'],
    design: ChangeProposal['design'],
    tasks: TaskItem[],
    specDeltas: SpecDelta[]
  ): ChangeProposal {
    const id = this.generateChangeId(title);
    const changeDir = join(this.changesDir, id);
    mkdirSync(changeDir, { recursive: true });
    
    // Create specs delta dir
    const specsDeltaDir = join(changeDir, 'specs');
    mkdirSync(specsDeltaDir, { recursive: true });
    
    const change: ChangeProposal = {
      id,
      title,
      description,
      createdAt: new Date().toISOString(),
      status: 'draft',
      proposal,
      design,
      tasks,
      specDeltas,
    };

    // Write proposal.md
    writeFileSync(join(changeDir, 'proposal.md'), this.renderProposal(change), 'utf-8');
    
    // Write design.md
    writeFileSync(join(changeDir, 'design.md'), this.renderDesign(change), 'utf-8');
    
    // Write tasks.md
    writeFileSync(join(changeDir, 'tasks.md'), this.renderTasks(change), 'utf-8');
    
    // Write spec deltas
    for (const delta of specDeltas) {
      const deltaDir = join(specsDeltaDir, delta.capabilityId);
      mkdirSync(deltaDir, { recursive: true });
      writeFileSync(join(deltaDir, 'spec.md'), delta.content, 'utf-8');
    }

    return change;
  }

  /**
   * List all changes
   */
  listChanges(status?: ChangeProposal['status']): ChangeState[] {
    if (!existsSync(this.changesDir)) return [];
    
    const changes: ChangeState[] = [];
    const entries = readdirSync(this.changesDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name === 'archive') continue;
      if (!entry.isDirectory()) continue;
      
      const proposalFile = join(this.changesDir, entry.name, 'proposal.md');
      if (!existsSync(proposalFile)) continue;
      
      const content = readFileSync(proposalFile, 'utf-8');
      const changeState = this.parseChangeState(entry.name, content);
      
      if (!status || changeState.status === status) {
        changes.push(changeState);
      }
    }
    
    return changes;
  }

  /**
   * Get a change by ID
   */
  getChange(changeId: string): ChangeProposal | null {
    const changeDir = join(this.changesDir, changeId);
    if (!existsSync(changeDir)) return null;
    
    const proposalFile = join(changeDir, 'proposal.md');
    const designFile = join(changeDir, 'design.md');
    const tasksFile = join(changeDir, 'tasks.md');
    
    if (!existsSync(proposalFile)) return null;
    
    const proposalContent = readFileSync(proposalFile, 'utf-8');
    const designContent = existsSync(designFile) ? readFileSync(designFile, 'utf-8') : '';
    const tasksContent = existsSync(tasksFile) ? readFileSync(tasksFile, 'utf-8') : '';
    
    return this.parseChangeProposal(changeId, proposalContent, designContent, tasksContent);
  }

  /**
   * Activate a change (move from draft to active)
   */
  activateChange(changeId: string): void {
    const changeDir = join(this.changesDir, changeId);
    const stateFile = join(changeDir, 'state.json');
    
    const state: ChangeState = {
      id: changeId,
      title: changeId.replace(/-/g, ' '),
      status: 'active',
      currentPhase: 'implementation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectPath: this.projectRoot,
    };
    
    writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Get current implementation phase for a change
   */
  getChangeState(changeId: string): ChangeState | null {
    const stateFile = join(this.changesDir, changeId, 'state.json');
    if (!existsSync(stateFile)) return null;
    
    try {
      return JSON.parse(readFileSync(stateFile, 'utf-8')) as ChangeState;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Verification
  // ===========================================================================

  /**
   * Verify implementation against specs
   */
  verify(changeId: string): VerificationResult {
    const change = this.getChange(changeId);
    if (!change) {
      return {
        changeId,
        timestamp: new Date().toISOString(),
        status: 'failed',
        requirements: [],
        unmetCount: 0,
        totalCount: 0,
      };
    }

    const requirements: VerificationResult['requirements'] = [];
    let implemented = 0;
    let missing = 0;

    for (const task of change.tasks) {
      const reqStatus = task.status === 'completed' ? 'implemented' as const : 'missing' as const;
      
      if (reqStatus === 'implemented') implemented++;
      else missing++;
      
      requirements.push({
        id: task.id,
        title: task.title,
        status: reqStatus,
        notes: task.status === 'completed' ? 'Task completed' : 'Task not yet implemented',
      });
    }

    return {
      changeId,
      timestamp: new Date().toISOString(),
      status: missing === 0 ? 'passed' : implemented > 0 ? 'partial' : 'failed',
      requirements,
      unmetCount: missing,
      totalCount: requirements.length,
    };
  }

  // ===========================================================================
  // Archive
  // ===========================================================================

  /**
   * Archive a completed change
   */
  archive(changeId: string): ArchiveRecord {
    const change = this.getChange(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }

    const changeDir = join(this.changesDir, changeId);
    const archiveDir = join(this.archiveDir, changeId);
    
    // Move to archive
    mkdirSync(archiveDir, { recursive: true });
    
    // Copy all files from change dir to archive
    const files = this.copyDirectory(changeDir, archiveDir);
    
    // Create archive record
    const record: ArchiveRecord = {
      changeId,
      title: change.title,
      archivedAt: new Date().toISOString(),
      summary: change.proposal.summary,
      fileCount: files.length,
      totalChanges: change.specDeltas.length,
      requirementsImplemented: change.tasks.filter(t => t.status === 'completed').length,
      requirementsTotal: change.tasks.length,
    };

    writeFileSync(join(archiveDir, 'archive.json'), JSON.stringify(record, null, 2), 'utf-8');
    
    // Remove original change dir
    rmSync(changeDir, { recursive: true, force: true });

    return record;
  }

  /**
   * List archived changes
   */
  listArchived(): ArchiveRecord[] {
    if (!existsSync(this.archiveDir)) return [];
    
    const records: ArchiveRecord[] = [];
    const entries = readdirSync(this.archiveDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const archiveFile = join(this.archiveDir, entry.name, 'archive.json');
      if (existsSync(archiveFile)) {
        try {
          records.push(JSON.parse(readFileSync(archiveFile, 'utf-8')));
        } catch {
          // Skip corrupt records
        }
      }
    }
    
    return records;
  }

  // ===========================================================================
  // Render helpers
  // ===========================================================================

  private renderProposal(change: ChangeProposal): string {
    return `# ${change.title}

**Status**: ${change.status}
**Created**: ${change.createdAt}
**ID**: ${change.id}

## Summary

${change.proposal.summary}

## Motivation

${change.proposal.motivation}

## Impact

${change.proposal.impact.map(i => `- ${i}`).join('\n')}

## Dependencies

${change.proposal.dependencies.map(d => `- ${d}`).join('\n') || 'None'}

## Risk Level

${change.proposal.riskLevel.toUpperCase()}

## Spec Changes

${change.specDeltas.map(d => `- **${d.type}**: ${d.capabilityId} — ${d.reason}`).join('\n')}
`;
  }

  private renderDesign(change: ChangeProposal): string {
    return `# Design: ${change.title}

## Approach

${change.design.approach}

## Architecture

${change.design.architecture}

## Files Changed

${change.design.filesChanged.map(f => `- ${f}`).join('\n')}

## Architecture Decisions

${change.design.decisions.map(d => `
### ${d.title}

**Context**: ${d.context}

**Decision**: ${d.decision}

**Consequences**: ${d.consequences}
`).join('\n')}

${change.design.sequenceDiagram ? `## Sequence Diagram\n\n\`\`\`\n${change.design.sequenceDiagram}\n\`\`\`` : ''}
`;
  }

  private renderTasks(change: ChangeProposal): string {
    const byPhase = new Map<string, TaskItem[]>();
    for (const task of change.tasks) {
      const phase = task.phase;
      if (!byPhase.has(phase)) byPhase.set(phase, []);
      byPhase.get(phase)!.push(task);
    }

    let output = `# Tasks: ${change.title}\n\n`;
    
    for (const [phase, tasks] of byPhase) {
      output += `## ${phase.charAt(0).toUpperCase() + phase.slice(1)}\n\n`;
      for (const task of tasks) {
        const statusEmoji = task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '🔄' : '⬜';
        output += `${statusEmoji} **${task.title}** (${task.estimatedEffort})\n`;
        output += `  ${task.description}\n`;
        if (task.dependsOn.length > 0) {
          output += `  Depends on: ${task.dependsOn.join(', ')}\n`;
        }
        output += '\n';
      }
    }
    
    return output;
  }

  // ===========================================================================
  // Parsers
  // ===========================================================================

  private parseSpecDocument(content: string, id: string): SpecDocument {
    const title = this.extractTitle(content) || id;
    const description = this.extractSection(content, 'Purpose') || '';
    const requirements = this.parseRequirements(content);

    return {
      metadata: {
        id,
        title,
        description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        version: '1.0',
      },
      purpose: description,
      requirements,
    };
  }

  private parseRequirements(content: string): SpecRequirement[] {
    const requirements: SpecRequirement[] = [];
    const reqRegex = /### Requirement:\s*(.+?)(?=###|\n$)/gs;
    const scenarioRegex = /#### Scenario:\s*(.+?)(?=\n- GIVEN|\n####|\n$)/gs;
    
    let match: RegExpExecArray | null;
    while ((match = reqRegex.exec(content)) !== null) {
      const title = match[1].trim();
      const body = match[0];
      
      // Extract GIVEN/WHEN/THEN scenarios
      const scenarios: SpecScenario[] = [];
      const scenarioMatch = body.match(/#### Scenario:\s*(.+?)\n- GIVEN\s+(.+?)\n- WHEN\s+(.+?)\n- THEN\s+(.+?)(?=\n####|\n##|$)/gs);
      
      if (scenarioMatch) {
        for (const s of scenarioMatch) {
          const nameMatch = s.match(/#### Scenario:\s*(.+?)\n/);
          const givenMatch = s.match(/- GIVEN\s+(.+?)\n/);
          const whenMatch = s.match(/- WHEN\s+(.+?)\n/);
          const thenMatch = s.match(/- THEN\s+(.+?)$/m);
          
          if (nameMatch && givenMatch && whenMatch && thenMatch) {
            scenarios.push({
              id: `scenario-${scenarios.length + 1}`,
              given: givenMatch[1].trim(),
              when: whenMatch[1].trim(),
              then: thenMatch[1].trim(),
            });
          }
        }
      }
      
      requirements.push({
        id: `req-${requirements.length + 1}`,
        title,
        description: body,
        priority: body.includes('SHALL') ? 'must' : body.includes('SHOULD') ? 'should' : 'may',
        scenarios,
      });
    }
    
    return requirements;
  }

  private parseChangeProposal(
    id: string,
    proposalContent: string,
    designContent: string,
    tasksContent: string
  ): ChangeProposal {
    const title = this.extractTitle(proposalContent) || id;
    const description = this.extractSection(proposalContent, 'Summary') || '';
    const motivation = this.extractSection(proposalContent, 'Motivation') || '';
    const impact = this.parseListSection(proposalContent, 'Impact');
    const dependencies = this.parseListSection(proposalContent, 'Dependencies');
    const riskMatch = proposalContent.match(/## Risk Level\n\n(.+)/);
    const riskLevel = (riskMatch?.[1]?.trim()?.toLowerCase() || 'medium') as 'low' | 'medium' | 'high';

    return {
      id,
      title,
      description,
      createdAt: new Date().toISOString(),
      status: 'draft',
      proposal: { summary: description, motivation, impact, dependencies, riskLevel },
      design: {
        approach: this.extractSection(designContent, 'Approach') || '',
        architecture: this.extractSection(designContent, 'Architecture') || '',
        filesChanged: this.parseListSection(designContent, 'Files Changed'),
        decisions: this.parseDecisions(designContent),
      },
      tasks: this.parseTasks(tasksContent),
      specDeltas: [],
    };
  }

  private parseChangeState(id: string, proposalContent: string): ChangeState {
    const title = this.extractTitle(proposalContent) || id;
    const statusMatch = proposalContent.match(/\*\*Status\*\*:\s*(.+)/);
    const createdMatch = proposalContent.match(/\*\*Created\*\*:\s*(.+)/);
    
    return {
      id,
      title,
      status: (statusMatch?.[1]?.trim() as ChangeProposal['status']) ?? 'draft',
      currentPhase: 'proposal',
      createdAt: createdMatch?.[1]?.trim() ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectPath: this.projectRoot,
    };
  }

  private parseTasks(content: string): TaskItem[] {
    const tasks: TaskItem[] = [];
    const taskRegex = /(⬜|🔄|✅)\s+\*\*(.+?)\*\*\s+\((.+?)\)\n\s+(.+?)(?:\n|$)/g;
    
    let match: RegExpExecArray | null;
    while ((match = taskRegex.exec(content)) !== null) {
      const emoji = match[1];
      const title = match[2];
      const effort = match[3] as TaskItem['estimatedEffort'];
      const description = match[4];
      
      tasks.push({
        id: `task-${tasks.length + 1}`,
        phase: 'implementation',
        title,
        description,
        status: emoji === '✅' ? 'completed' : emoji === '🔄' ? 'in_progress' : 'pending',
        dependsOn: [],
        estimatedEffort: effort,
      });
    }
    
    return tasks;
  }

  private parseDecisions(content: string): ChangeProposal['design']['decisions'] {
    const decisions: ChangeProposal['design']['decisions'] = [];
    const decisionRegex = /### (.+?)\n\n\*\*Context\*\*:\s*(.+?)\n\n\*\*Decision\*\*:\s*(.+?)\n\n\*\*Consequences\*\*:\s*(.+?)(?=\n###|\n$)/gs;
    
    let match: RegExpExecArray | null;
    while ((match = decisionRegex.exec(content)) !== null) {
      decisions.push({
        title: match[1].trim(),
        context: match[2].trim(),
        decision: match[3].trim(),
        consequences: match[4].trim(),
      });
    }
    
    return decisions;
  }

  // ===========================================================================
  // Utility methods
  // ===========================================================================

  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : null;
  }

  private extractSection(content: string, sectionName: string): string | null {
    const regex = new RegExp(`## ${sectionName}\\n\\n([\\s\\S]*?)(?=\\n##|$)`);
    const match = regex.exec(content);
    return match ? match[1].trim() : null;
  }

  private parseListSection(content: string, sectionName: string): string[] {
    const text = this.extractSection(content, sectionName);
    if (!text) return [];
    
    const items: string[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        items.push(trimmed.slice(2));
      }
    }
    return items;
  }

  private specToText(doc: SpecDocument): string {
    return [
      doc.purpose,
      ...doc.requirements.flatMap(r => [r.title, r.description, ...r.scenarios.flatMap(s => [s.given, s.when, s.then])])
    ].join(' ');
  }

  private generateChangeId(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    
    const suffix = Date.now().toString(36).slice(-4);
    return `${slug}-${suffix}`;
  }

  private copyDirectory(src: string, dest: string): string[] {
    const files: string[] = [];
    
    const copyRecursive = (dir: string, target: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = join(dir, entry.name);
        const destPath = join(target, entry.name);
        
        if (entry.isDirectory()) {
          mkdirSync(destPath, { recursive: true });
          copyRecursive(srcPath, destPath);
        } else {
          writeFileSync(destPath, readFileSync(srcPath));
          files.push(destPath);
        }
      }
    };
    
    copyRecursive(src, dest);
    return files;
  }
}