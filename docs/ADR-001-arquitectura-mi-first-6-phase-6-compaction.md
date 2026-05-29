# ADR-001: MiuraSwarm Architecture - Phase 6: Compaction Strategies

## Status: In Progress

**Date**: 2025-06-23  
**Phase**: 6 of 7  
**Focus**: Session compaction strategies for long-running conversations

---

## 1. Contexto y Motivación

### 1.1 El Problema del Context Window

MiuraSwarm soporta sesiones de conversación largas con múltiples turnos, pero los modelos LLM tienen límites de contexto:

- **Context Window típico**: 128K - 200K tokens (4K-8K mensajes)
- **Problema acumulativo**: Cada conversación agrega tokens
- **Solución**: Compactar mensajes cuando se excede el límite

### 1.2 Requisitos de Compaction

```typescript
interface CompactionRequirements {
  // Mantener coherencia semántica
  preserveSemanticCoherence: boolean;
  
  // Preservar contexto importante
  preserveCriticalContext: boolean;
  
  // Soportar diferentes estrategias
  supportMultipleStrategies: boolean;
  
  // Transición transparente
  transparentTransition: boolean;
  
  // Estadísticas y observabilidad
  provideMetrics: boolean;
}
```

---

## 2. Diseño de Compaction Strategies

### 2.1 Arquitectura Base

```typescript
// Interface base para todas las estrategias
interface CompactionStrategy {
  compact(
    messages: LLMMessage[], 
    contextWindow: number, 
    options?: CompactionOptions
  ): CompactionResult;
}

// Resultado de compaction
interface CompactionResult {
  compactedMessages: LLMMessage[];
  removedMessages: LLMMessage[];
  stats: {
    originalCount: number;
    compactedCount: number;
    removedCount: number;
    compressionRatio: number;
    strategyUsed: string;
  };
}
```

### 2.2 Estrategias Implementadas

#### 2.2.1 NoCompaction (Default)

```typescript
class NoCompaction implements CompactionStrategy {
  compact(messages: LLMMessage[], contextWindow: number): CompactionResult {
    return {
      compactedMessages: messages,
      removedMessages: [],
      stats: {
        originalCount: messages.length,
        compactedCount: messages.length,
        removedCount: 0,
        compressionRatio: 1,
        strategyUsed: 'no_compaction'
      }
    };
  }
}
```

#### 2.2.2 SlidingWindow

```typescript
class SlidingWindow implements CompactionStrategy {
  constructor(
    private windowSize: number = 50,
    private preserveSystem: boolean = true
  ) {}

  compact(messages: LLMMessage[], contextWindow: number): CompactionResult {
    const filtered = this.filterMessages(messages);
    
    if (filtered.length <= this.windowSize) {
      return this.createResult(filtered, [], 'sliding_window');
    }

    // Mantener últimos N mensajes
    const preserved = filtered.slice(-this.windowSize);
    const removed = filtered.slice(0, filtered.length - this.windowSize);
    
    return this.createResult(preserved, removed, 'sliding_window');
  }

  private filterMessages(messages: LLMMessage[]): LLMMessage[] {
    if (!this.preserveSystem) return messages;
    
    return messages.filter(msg => 
      msg.role !== 'system' || 
      msg.content?.includes('system_prompt')
    );
  }
}
```

#### 2.2.3 Summarize

```typescript
class Summarize implements CompactionStrategy {
  constructor(
    private thresholdMessages: number = 20,
    private summaryModel?: ModelRef,
    private preserveSystem: boolean = true
  ) {}

  async compact(
    messages: LLMMessage[], 
    contextWindow: number
  ): Promise<CompactionResult> {
    const filtered = this.filterMessages(messages);
    
    if (filtered.length <= this.thresholdMessages) {
      return this.createResult(filtered, [], 'summarize');
    }

    const messagesToSummarize = filtered.slice(0, filtered.length - 5);
    const preserved = filtered.slice(-5);
    
    const summary = await this.generateSummary(messagesToSummarize);
    const summarizedMessage: LLMMessage = {
      role: 'assistant',
      content: `SUMMARY OF PREVIOUS CONVERSATION:\n${summary}\n\nCurrent context continues from here.`,
      timestamp: new Date().toISOString()
    };

    const compacted = [summarizedMessage, ...preserved];
    return this.createResult(compacted, messagesToSummarize, 'summarize');
  }

  private async generateSummary(messages: LLMMessage[]): Promise<string> {
    if (this.summaryModel) {
      // Usar modelo de resumen dedicado
      return await this.callSummaryModel(messages);
    }
    
    // Resumen simple basado en estadísticas
    const turns = Math.floor(messages.length / 2);
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;
    
    return `Conversation with ${turns} turns (${userMessages} user messages, ${assistantMessages} assistant messages) covering various technical topics including code analysis, debugging, and development tasks.`;
  }
}
```

#### 2.2.4 SafeSplitPoint

```typescript
class SafeSplitPoint implements CompactionStrategy {
  constructor(private inner: CompactionStrategy) {}

  compact(messages: LLMMessage[], contextWindow: number): CompactionResult {
    // Encontrar puntos de división seguros (no cortar tool_use + tool_result)
    const safePoints = this.findSafeSplitPoints(messages);
    
    if (safePoints.length === 0) {
      // No hay puntos seguros, usar estrategia interna
      return this.inner.compact(messages, contextWindow);
    }

    // Dividir en punto seguro más reciente
    const splitPoint = safePoints[safePoints.length - 1];
    const firstPart = messages.slice(0, splitPoint);
    const secondPart = messages.slice(splitPoint);
    
    // Compactar la primera parte
    const compactedFirst = this.inner.compact(firstPart, contextWindow);
    
    return {
      compactedMessages: [...compactedFirst.compactedMessages, ...secondPart],
      removedMessages: compactedFirst.removedMessages,
      stats: {
        ...compactedFirst.stats,
        strategyUsed: `safe_split_point_${compactedFirst.strategyUsed}`
      }
    };
  }

  private findSafeSplitPoints(messages: LLMMessage[]): number[] {
    const points: number[] = [];
    
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const current = messages[i];
      
      // No dividir tool_use seguido de tool_result
      if (prev.role === 'tool_use' && current.role === 'tool_result') {
        continue;
      }
      
      // Dividir después de respuestas completas
      if (current.role === 'assistant' && 
          current.content?.includes('```')) {
        points.push(i);
      }
    }
    
    return points;
  }
}
```

#### 2.2.5 Hybrid

```typescript
class Hybrid implements CompactionStrategy {
  constructor(
    private keepMessages: number = 30,
    private preserveSystem: boolean = true,
    private useSummarizeForOlder: boolean = true
  ) {}

  compact(messages: LLMMessage[], contextWindow: number): CompactionResult {
    const filtered = this.filterMessages(messages);
    
    if (filtered.length <= this.keepMessages) {
      return this.createResult(filtered, [], 'hybrid');
    }

    const recent = filtered.slice(-this.keepMessages);
    const older = filtered.slice(0, filtered.length - this.keepMessages);
    
    let compactedOlder: LLMMessage[];
    
    if (this.useSummarizeForOlder && older.length > 10) {
      // Usar resumen para la parte más antigua
      const summaryStrategy = new Summarize(15);
      const olderResult = summaryStrategy.compact(older, contextWindow);
      compactedOlder = olderResult.compactedMessages;
    } else {
      // Usar sliding window simple
      compactedOlder = older.slice(-Math.floor(older.length * 0.3));
    }

    const compacted = [...compactedOlder, ...recent];
    const removed = older.filter(msg => !compactedOlder.includes(msg));
    
    return this.createResult(compacted, removed, 'hybrid');
  }

  private filterMessages(messages: LLMMessage[]): LLMMessage[] {
    if (!this.preserveSystem) return messages;
    
    return messages.filter(msg => 
      msg.role !== 'system' || 
      msg.content?.includes('system_prompt')
    );
  }
}
```

### 2.3 Compaction Manager

```typescript
class CompactionManager {
  private strategies: Map<string, CompactionStrategy> = new Map();
  private currentStrategy: string = 'no_compaction';

  constructor() {
    this.registerStrategies();
  }

  private registerStrategies(): void {
    this.strategies.set('no_compaction', new NoCompaction());
    this.strategies.set('sliding_window', new SlidingWindow(50, true));
    this.strategies.set('summarize', new Summarize(20, undefined, true));
    this.strategies.set('hybrid', new Hybrid(30, true, true));
    this.strategies.set('safe_split_point', new SafeSplitPoint(
      this.strategies.get('sliding_window')!
    ));
  }

  setStrategy(strategyName: string, options?: any): void {
    if (!this.strategies.has(strategyName)) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }
    
    this.currentStrategy = strategyName;
  }

  compact(
    messages: LLMMessage[], 
    contextWindow: number
  ): CompactionResult {
    const strategy = this.strategies.get(this.currentStrategy)!;
    return strategy.compact(messages, contextWindow);
  }

  getAvailableStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  getStrategyConfig(strategyName: string): any {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) return null;
    
    // Devolver configuración de la estrategia
    switch (strategyName) {
      case 'sliding_window':
        return { windowSize: 50, preserveSystem: true };
      case 'summarize':
        return { thresholdMessages: 20, preserveSystem: true };
      case 'hybrid':
        return { keepMessages: 30, preserveSystem: true, useSummarizeForOlder: true };
      default:
        return {};
    }
  }
}
```

---

## 3. Integración con Session Manager

### 3.1 Session Manager Ampliado

```typescript
class SessionManager {
  private messages: LLMMessage[] = [];
  private compactionManager = new CompactionManager();
  private contextWindow: number = 128000; // 128K tokens
  
  constructor(
    private config: SessionConfig,
    private model: ModelRef
  ) {
    this.compactionManager.setStrategy(config.compactionStrategy || 'no_compaction');
    this.contextWindow = config.contextWindow || 128000;
  }

  async addMessage(message: LLMMessage): Promise<void> {
    this.messages.push(message);
    
    // Verificar si necesitamos compactar
    if (this.needsCompaction()) {
      await this.compact();
    }
  }

  private needsCompaction(): boolean {
    const estimatedTokens = this.estimateTokens(this.messages);
    return estimatedTokens > this.contextWindow * 0.9; // 90% del límite
  }

  private async compact(): Promise<void> {
    const before = this.messages.length;
    const result = this.compactionManager.compact(this.messages, this.contextWindow);
    
    this.messages = result.compactedMessages;
    
    // Emitir evento de compaction
    this.emit('session.compacted', {
      before,
      after: this.messages.length,
      removed: result.removedMessages.length,
      strategy: result.stats.strategyUsed
    });

    // Loggear estadísticas
    console.log(`Session compacted: ${before} → ${this.messages.length} messages (${result.stats.compressionRatio} ratio)`);
  }

  private estimateTokens(messages: LLMMessage[]): number {
    // Estimación simple: 4 tokens por palabra
    const totalWords = messages.reduce((sum, msg) => {
      return sum + (msg.content?.split(/\s+/).length || 0);
    }, 0);
    
    return totalWords * 4;
  }
}
```

### 3.2 Configuración de Compaction

```typescript
interface CompactionConfig {
  strategy: 'no_compaction' | 'sliding_window' | 'summarize' | 'hybrid' | 'safe_split_point';
  options?: {
    windowSize?: number;
    preserveSystem?: boolean;
    thresholdMessages?: number;
    keepMessages?: number;
  };
}

interface SessionConfig {
  compaction: CompactionConfig;
  contextWindow: number;
  maxMessages?: number;
}
```

---

## 4. Testing y Validación

### 4.1 Unit Tests para Compaction

```typescript
describe('Compaction Strategies', () => {
  let messages: LLMMessage[];
  
  beforeEach(() => {
    messages = [
      { role: 'system', content: 'system_prompt', timestamp: '1' },
      { role: 'user', content: 'Hello', timestamp: '2' },
      { role: 'assistant', content: 'Hi!', timestamp: '3' },
      { role: 'user', content: 'Explain React', timestamp: '4' },
      { role: 'assistant', content: 'React is...', timestamp: '5' },
      // ... más mensajes
    ];
  });

  test('NoCompaction should not modify messages', () => {
    const strategy = new NoCompaction();
    const result = strategy.compact(messages, 100000);
    
    expect(result.compactedMessages).toHaveLength(messages.length);
    expect(result.removedMessages).toHaveLength(0);
  });

  test('SlidingWindow should preserve last N messages', () => {
    const strategy = new SlidingWindow(3, true);
    const result = strategy.compact(messages, 100000);
    
    expect(result.compactedMessages).toHaveLength(3);
    expect(result.compactedMessages[0].role).toBe('system');
  });

  test('SafeSplitPoint should not split tool_use + tool_result', () => {
    const messagesWithTools = [
      ...messages,
      { role: 'tool_use', content: 'tool call', timestamp: '6' },
      { role: 'tool_result', content: 'tool result', timestamp: '7' },
    ];
    
    const strategy = new SafeSplitPoint(new SlidingWindow(5));
    const result = strategy.compact(messagesWithTools, 100000);
    
    // Verificar que tool_use y tool_result están juntos
    const toolUseIndex = result.compactedMessages.findIndex(m => m.role === 'tool_use');
    const toolResultIndex = result.compactedMessages.findIndex(m => m.role === 'tool_result');
    
    expect(toolResultIndex).toBe(toolUseIndex + 1);
  });
});
```

### 4.2 Integration Tests

```typescript
describe('Session Compaction Integration', () => {
  let sessionManager: SessionManager;
  
  beforeEach(() => {
    const config: SessionConfig = {
      compaction: {
        strategy: 'hybrid',
        options: { keepMessages: 10 }
      },
      contextWindow: 50000
    };
    
    sessionManager = new SessionManager(config, 'gpt-4');
  });

  test('should automatically compact when exceeding context window', async () => {
    // Añadir muchos mensajes para exceder el contexto
    for (let i = 0; i < 100; i++) {
      await sessionManager.addMessage({
        role: 'user',
        content: `Message ${i}`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Verificar que se compactó
    expect(sessionManager.getMessages().length).toBeLessThan(100);
  });
});
```

---

## 5. CLI Commands para Compaction

```typescript
const COMPACTION_COMMANDS: Command[] = [
  {
    name: 'compaction',
    aliases: ['compact'],
    description: 'Gestionar estrategias de compaction',
    usage: '/compaction [list|set|config]',
    execute: async (ctx) => {
      const [subcommand, ...args] = ctx.args;
      
      switch (subcommand) {
        case 'list':
          return listCompactionStrategies();
        case 'set':
          return setCompactionStrategy(args[0], args[1]);
        case 'config':
          return showCompactionConfig(args[0]);
        default:
          return showCompactionHelp();
      }
    }
  }
];

function listCompactionStrategies(): string {
  const strategies = [
    { name: 'no_compaction', description: 'No compactar mensajes' },
    { name: 'sliding_window', description: 'Mantener últimos N mensajes' },
    { name: 'summarize', description: 'Resumir mensajes antiguos' },
    { name: 'hybrid', description: 'Combinar sliding window y summarize' },
    { name: 'safe_split_point', description: 'Dividir en puntos seguros' },
  ];
  
  return 'Available compaction strategies:\n' + 
    strategies.map(s => `  ${s.name}: ${s.description}`).join('\n');
}

function setCompactionStrategy(strategy: string, options?: string): void {
  const manager = getCompactionManager();
  if (!manager.getAvailableStrategies().includes(strategy)) {
    throw new Error(`Unknown strategy: ${strategy}`);
  }
  
  manager.setStrategy(strategy, options ? JSON.parse(options) : undefined);
  console.log(`Compaction strategy set to: ${strategy}`);
}
```

---

## 6. Observabilidad y Métricas

### 6.1 Compaction Metrics

```typescript
interface CompactionMetrics {
  totalCompactions: number;
  messagesBefore: number;
  messagesAfter: number;
  compressionRatio: number;
  avgTimeMs: number;
  strategyUsage: Record<string, number>;
  contextWindowUsage: number;
}

class CompactionMetricsCollector {
  private metrics: CompactionMetrics = {
    totalCompactions: 0,
    messagesBefore: 0,
    messagesAfter: 0,
    compressionRatio: 0,
    avgTimeMs: 0,
    strategyUsage: {},
    contextWindowUsage: 0
  };

  recordCompaction(result: CompactionResult, timeMs: number): void {
    this.metrics.totalCompactions++;
    this.metrics.messagesBefore += result.removedMessages.length + result.compactedMessages.length;
    this.metrics.messagesAfter = result.compactedMessages.length;
    this.metrics.compressionRatio = result.stats.compressionRatio;
    
    // Acumular tiempo
    this.metrics.avgTimeMs = (this.metrics.avgTimeMs * (this.metrics.totalCompactions - 1) + timeMs) / this.metrics.totalCompactions;
    
    // Registrar uso de estrategia
    this.metrics.strategyUsage[result.stats.strategyUsed] = 
      (this.metrics.strategyUsage[result.stats.strategyUsed] || 0) + 1;
  }

  getMetrics(): CompactionMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      totalCompactions: 0,
      messagesBefore: 0,
      messagesAfter: 0,
      compressionRatio: 0,
      avgTimeMs: 0,
      strategyUsage: {},
      contextWindowUsage: 0
    };
  }
}
```

### 6.2 Logging y Monitoring

```typescript
class CompactionLogger {
  private metricsCollector = new CompactionMetricsCollector();

  logCompaction(result: CompactionResult, timeMs: number): void {
    this.metricsCollector.recordCompaction(result, timeMs);
    
    console.log(`[Compaction] ${result.stats.strategyUsed} - ` +
      `${result.stats.originalCount} → ${result.stats.compactedCount} ` +
      `(${result.stats.compressionRatio} ratio, ${timeMs}ms)`);
  }

  logContextWindowUsage(current: number, max: number): void {
    const usage = (current / max) * 100;
    console.log(`[Context] ${current}/${max} tokens (${usage.toFixed(1)}%)`);
    
    if (usage > 90) {
      console.warn(`[Context] Warning: Context window at ${usage.toFixed(1)}%`);
    }
  }

  getReport(): string {
    const metrics = this.metricsCollector.getMetrics();
    
    return `Compaction Report:\n` +
      `  Total compactions: ${metrics.totalCompactions}\n` +
      `  Avg compression ratio: ${metrics.compressionRatio.toFixed(2)}\n` +
      `  Avg time: ${metrics.avgTimeMs.toFixed(0)}ms\n` +
      `  Strategy usage: ${JSON.stringify(metrics.strategyUsage, null, 2)}`;
  }
}
```

---

## 7. Implementación en el Core

### 7.1 Modificaciones a SessionManager

```typescript
// En src/core/session-manager.ts
export class SessionManager {
  private compactionManager: CompactionManager;
  private metricsLogger: CompactionLogger;
  private currentContextTokens: number = 0;
  
  constructor(config: SessionConfig, model: ModelRef) {
    this.compactionManager = new CompactionManager();
    this.metricsLogger = new CompactionLogger();
    
    // Configurar estrategia inicial
    this.compactionManager.setStrategy(
      config.compaction.strategy,
      config.compaction.options
    );
    
    this.contextWindow = config.contextWindow;
  }

  async processMessage(message: LLMMessage): Promise<LLMResult> {
    // Estimar tokens del mensaje
    const messageTokens = this.estimateTokens(message);
    this.currentContextTokens += messageTokens;
    
    // Verificar si necesitamos compactar
    if (this.currentContextTokens > this.contextWindow * 0.9) {
      const startTime = Date.now();
      await this.compact();
      const timeMs = Date.now() - startTime;
      
      // Loggear métricas
      this.metricsLogger.logCompaction(this.getLastCompactionResult()!, timeMs);
    }
    
    // Procesar mensaje normalmente
    return await this.model.send([message]);
  }

  private async compact(): Promise<void> {
    const result = this.compactionManager.compact(this.messages, this.contextWindow);
    this.messages = result.compactedMessages;
    this.lastCompactionResult = result;
    
    // Recalcular tokens
    this.currentContextTokens = this.estimateTokens(this.messages);
  }
}
```

### 7.2 Plugin Integration

```typescript
// En src/plugins/compaction/compaction-manager-plugin.ts
export class CompactionManagerPlugin implements Plugin {
  name = 'compaction-manager';
  type = 'knowledge' as const;
  
  private compactionManager = new CompactionManager();
  private metricsLogger = new CompactionLogger();

  async activate(host: PluginHost): Promise<void> {
    // Registrar comandos CLI
    const commandRegistry = host.getCommandRegistry();
    commandRegistry.register({
      name: 'compaction',
      description: 'Manage compaction strategies',
      execute: this.handleCompactionCommand.bind(this)
    });
  }

  private handleCompactionCommand(ctx: CommandContext): Promise<string> {
    const [action, ...args] = ctx.args;
    
    switch (action) {
      case 'list':
        return this.listStrategies();
      case 'set':
        return this.setStrategy(args[0], args[1]);
      case 'stats':
        return this.getStats();
      default:
        return 'Usage: /compaction [list|set|stats] [args]';
    }
  }

  private listStrategies(): string {
    return 'Available compaction strategies:\n' +
      this.compactionManager.getAvailableStrategies()
        .map(name => `  ${name}: ${this.describeStrategy(name)}`)
        .join('\n');
  }

  private describeStrategy(name: string): string {
    const config = this.compactionManager.getStrategyConfig(name);
    switch (name) {
      case 'no_compaction': return 'No message compression';
      case 'sliding_window': return `Keep last ${config?.windowSize || 50} messages`;
      case 'summarize': return `Summarize older than ${config?.thresholdMessages || 20} messages`;
      case 'hybrid': return `Keep last ${config?.keepMessages || 30} + summarize rest`;
      case 'safe_split_point': return 'Smart splitting without breaking tool calls';
      default: return 'Unknown strategy';
    }
  }
}
```

---

## 8. Próximos Pasos

### 8.1 Inmediatos
- [ ] Implementar las clases base de CompactionStrategy
- [ ] Agregar tests unitarios para cada estrategia
- [ ] Integrar con SessionManager existente
- [ ] Implementar comandos CLI

### 8.2 Mediano Plazo
- [ ] Agregar soporte para modelos de resumen externos
- [ ] Implementar métricas avanzadas y logging
- [ ] Agregar soporte para compaction personalizado
- [ ] Documentar estrategias y configuración

### 8.3 Futuro
- [ ] Soporte para compaction basado en contenido
- [ ] Integración con Brain para contexto relevante
- [ ] Compaction predictivo basado en patrones
- [ ] Soporte para múltiples estrategias simultáneas

---

## 9. Consideraciones de Diseño

### 9.1 Trade-offs

```typescript
// Trade-offs principales:
const tradeoffs = {
  // SlidingWindow vs Summarize
  sliding_window: {
    pros: ['Simple', 'Preserva contexto reciente', 'Rápido'],
    cons: ['Pierde contexto antiguo', 'No escala bien con mucho historial']
  },
  summarize: {
    pros: ['Reduce drásticamente tokens', 'Mantiene semántica general'],
    cons: ['Pierde detalles específicos', 'Costoso computacionalmente']
  },
  hybrid: {
    pros: ['Balance entre contexto y compresión', 'Adaptable'],
    cons: ['Complejo de configurar', 'Puede ser inconsistente']
  }
};
```

### 9.2 Rendimiento

- **SlidingWindow**: O(1) - simplemente corta la lista
- **Summarize**: O(n) - requiere procesamiento del modelo
- **Hybrid**: O(n) - combinación de operaciones

### 9.3 Configuración Recomendada

```typescript
const RECOMMENDED_CONFIGS = {
  development: {
    strategy: 'no_compaction',
    reason: 'Mantener máximo contexto para debugging'
  },
  production: {
    strategy: 'hybrid',
    options: { keepMessages: 30, useSummarizeForOlder: true },
    reason: 'Balance entre contexto y rendimiento'
  },
  long_conversations: {
    strategy: 'summarize',
    options: { thresholdMessages: 15 },
    reason: 'Para sesiones muy largas con mucho historial'
  }
};
```

---

*Fin de la documentación de Phase 6: Compaction Strategies*