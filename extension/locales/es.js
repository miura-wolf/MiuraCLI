// Traducciones en español para la extensión MiuraSwarm
module.exports = {
  extension: {
    name: 'MiuraSwarm',
    description: 'Orquestación de pipelines multi-agente con soporte de tool-calling',
  },
  pipeline: {
    started: 'Iniciando pipeline de MiuraSwarm...',
    complete: 'Pipeline de MiuraSwarm completado',
    failed: 'El pipeline de MiuraSwarm falló',
    stages: {
      planner: 'Planificador',
      worker: 'Trabajador',
      reviewer: 'Revisor',
      researcher: 'Investigador',
      scout: 'Explorador',
      oracle: 'Oráculo',
      delegate: 'Delegado',
      'context-builder': 'Constructor de Contexto',
    },
  },
  tools: {
    miura_pipeline: {
      name: 'Pipeline de MiuraSwarm',
      description: 'Ejecutar un pipeline completo de MiuraSwarm: Planificador → Trabajador → Revisor',
    },
    miura_scout: {
      name: 'Explorador de MiuraSwarm',
      description: 'Reconocimiento rápido del código',
    },
    miura_research: {
      name: 'Investigación de MiuraSwarm',
      description: 'Investigar un tema usando búsqueda web y análisis técnico',
    },
  },
  errors: {
    generic: 'Ocurrió un error',
    timeout: 'La operación agotó el tiempo de espera',
    cancelled: 'La operación fue cancelada',
  },
};
