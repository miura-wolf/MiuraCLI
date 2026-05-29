/**
 * OpenSpec types for Spec-Driven Development
 */

export interface SpecMetadata {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  version: string;
}

export interface SpecRequirement {
  id: string;
  title: string;
  description: string;
  priority: 'must' | 'should' | 'may';
  scenarios: SpecScenario[];
}

export interface SpecScenario {
  id: string;
  given: string;
  when: string;
  then: string;
}

export interface SpecDocument {
  metadata: SpecMetadata;
  purpose: string;
  requirements: SpecRequirement[];
}

export interface ChangeProposal {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  
  // Proposal document
  proposal: {
    summary: string;
    motivation: string;
    impact: string[];
    dependencies: string[];
    riskLevel: 'low' | 'medium' | 'high';
  };
  
  // Technical design
  design: {
    approach: string;
    architecture: string;
    filesChanged: string[];
    sequenceDiagram?: string;
    decisions: Array<{
      title: string;
      context: string;
      decision: string;
      consequences: string;
    }>;
  };
  
  // Task breakdown
  tasks: TaskItem[];
  
  // Spec changes
  specDeltas: SpecDelta[];
}

export interface TaskItem {
  id: string;
  phase: 'infrastructure' | 'implementation' | 'testing' | 'documentation';
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  dependsOn: string[];
  estimatedEffort: 'small' | 'medium' | 'large';
}

export interface SpecDelta {
  capabilityId: string;
  type: 'add' | 'modify' | 'remove';
  content: string;
  reason: string;
}

export interface ChangeState {
  id: string;
  title: string;
  status: ChangeProposal['status'];
  currentPhase: 'proposal' | 'design' | 'tasks' | 'implementation' | 'verification' | 'archive';
  createdAt: string;
  updatedAt: string;
  projectPath: string;
}

export interface VerificationResult {
  changeId: string;
  timestamp: string;
  status: 'passed' | 'failed' | 'partial';
  requirements: Array<{
    id: string;
    title: string;
    status: 'implemented' | 'missing' | 'partial';
    notes: string;
  }>;
  unmetCount: number;
  totalCount: number;
}

export interface ArchiveRecord {
  changeId: string;
  title: string;
  archivedAt: string;
  summary: string;
  fileCount: number;
  totalChanges: number;
  requirementsImplemented: number;
  requirementsTotal: number;
}