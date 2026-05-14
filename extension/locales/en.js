// English translations for MiuraSwarm extension
module.exports = {
  extension: {
    name: 'MiuraSwarm',
    description: 'Multi-agent pipeline orchestration with tool-calling support',
  },
  pipeline: {
    started: 'Starting MiuraSwarm pipeline...',
    complete: 'MiuraSwarm Pipeline Complete',
    failed: 'MiuraSwarm pipeline failed',
    stages: {
      planner: 'Planner',
      worker: 'Worker',
      reviewer: 'Reviewer',
      researcher: 'Researcher',
      scout: 'Scout',
      oracle: 'Oracle',
      delegate: 'Delegate',
      'context-builder': 'Context Builder',
    },
  },
  tools: {
    miura_pipeline: {
      name: 'MiuraSwarm Pipeline',
      description: 'Execute a full MiuraSwarm pipeline: Planner → Worker → Reviewer',
    },
    miura_scout: {
      name: 'MiuraSwarm Scout',
      description: 'Quick codebase reconnaissance',
    },
    miura_research: {
      name: 'MiuraSwarm Research',
      description: 'Research a topic using web search and technical analysis',
    },
  },
  errors: {
    generic: 'An error occurred',
    timeout: 'Operation timed out',
    cancelled: 'Operation was cancelled',
  },
};
