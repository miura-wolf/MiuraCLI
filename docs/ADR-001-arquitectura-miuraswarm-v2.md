# MiuraSwarm v2 — Arquitectura de Coding Agent Harness

## ADR-001: Diseño Arquitectónico Completo

> **Estado**: Borrador  
> **Fecha**: 2026-05-28  
> **Decisor**: Carja / MiuraSwarm  
> **Contexto**: Transformar MiuraSwarm en un coding agent harness potente con inferencia local (llama.cpp/Vulkan), REPL interactivo, memoria entre sesiones, y plugins extensibles.

---

## 1. Principios Fundamentales

### 1.1 Filosofía de Diseño

```
"El modelo escribe código. El harness decide qué ve, qué recuerda y qué puede tocar."
```

- **Vos sos Tony Stark** (el arquitecto, tomás las decisiones)
- **MiuraSwarm es J.A.R.V.I.S.** (tu asistente que orquesta todo)
- **Los plugins son tu equipo** (especialistas en diferentes áreas)

### 1.2 Principios rectores

1. **Local-first**: Inferencia local con llama.cpp como prioridad. Cloud es fallback.
2. **Arquitectura hexagonal pura**: Core sin dependencias de infraestructura. Todos los adaptadores externos (LLM, filesystem, tools, memory) son plugins.
3. **Separación de concerns estricta**: La capa de presentación (REPL/TUI) nunca toca el core.
4. **Go-transition-ready**: Cada decisión arquitectónica se evalúa con la pregunta: "¿cuánto cuesta migrar esto a Go?"
5. **Extensibilidad via plugins**: Tres puntos de extensión claros — Provider (LLM), Tool, Memory.
6. **Estado en disco, no en chat**: Toda la memoria persiste entre sesiones y sobrevive a resets de contexto.
7. **Progressive disclosure**: El agente descubre reglas bajo demanda, no carga todo de entrada.

### 1.3 Stack Objetivo

| Capa | Tecnología | Por qué |
|------|------------|---------|
| Runtime | **Bun** | Startup ~5ms, TypeScript nativo, binario compilable |
| Lenguaje | **TypeScript** | Todo el codebase actual + ecosistema npm |
| Core | **TypeScript puro** | Sin dependencias externas al core |
| ORM/DB | **better-sqlite3** | Ya existe, WAL mode, FTS5 |
| CLI/TUI | **blessed** o **ink** | TUI rica desde terminal |
| Parsing | **tree-sitter** | Code graph, análisis semántico |
| LLM Local | **llama.cpp (Vulkan)** | API OpenAI-compatible via llama-server |
| LLM Cloud | **11 adapters existentes** | OpenAI-compatible API |
| IPC (futuro) | **stdio / JSON-RPC** | Interfaz para migrate a Go CLI |

---

## 2. Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                               │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      MiuraCLI (Bun)                          │  │
│  │  REPL interactivo + /commands + streaming output + TUI        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                    JSON-RPC / stdio (interface)                      │
│                              │                                       │
│         ┌────────────────────┼────────────────────┐                  │
│         │                    │                    │                  │
│  ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐          │
│  │  MiuraSwarm │      │  Future:    │      │  Future:    │          │
│  │  Core (TS)  │◄────►│  Go CLI     │      │  Web UI     │          │
│  │             │      │  (binary)   │      │  (browser)   │          │
│  └──────┬──────┘      └─────────────┘      └─────────────┘          │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────┐    │
│  │                      CORE LAYER (TypeScript)                  │    │
│  │                                                               │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │    │
│  │  │EventBus  │  │AgentBus  │  │Pipeline  │  │TaskSched │    │    │
│  │  │Wildcards │  │Lifecycle │  │DAG+Retry │  │PriorityQ │    │    │
│  │  │Replay    │  │Heartbeat │  │StuckDet. │  │Backoff   │    │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │    │
│  │                                                               │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │    │
│  │  │ModelRout.│  │StuckDet. │  │PluginHost│  │ToolReg. │    │    │
│  │  │Fallback  │  │4 patterns│  │Lifecycle │  │Security  │    │    │
│  │  │Escalate  │  │Recovery  │  │Discovery │  │Allowlist │    │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │    │
│  │                                                               │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │              STATE LAYER (better-sqlite3)             │   │    │
│  │  │  tasks | agents | pipelines | events | brain | graph  │   │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────┘    │
│                              │                                       │
│         ┌────────────────────┼────────────────────┐                  │
│         │                    │                    │                  │
│  ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐          │
│  │LLM PROVIDERS│      │   TOOLS     │      │  MEMORY     │          │
│  │             │      │             │      │             │          │
│  │ llm-server  │      │ file-tools  │      │ Brain       │          │
│  │ (Vulkan)    │      │ git-tools   │      │ CodeGraph   │          │
│  │             │      │ grep/glob  │      │ Skills      │          │
│  │ OpenAI-comp.│      │ shell-cmd   │      │ MCP-client  │          │
│  │ adapters    │      │ web-fetch   │      │ Engram-read.│          │
│  │ (11 exist.) │      │ mcp-tools   │      │             │          │
│  └─────────────┘      └─────────────┘      └─────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Capa de Presentación (MiuraCLI)

Responsabilidades:
- REPL interactivo con input history (arrow up/down)
- Slash commands (`/chat`, `/review`, `/add`, `/read`, `/swarm`, `/agent`, `/model`, `/tokens`, `/debug`, `/tools`, `/brain`, `/graph`, `/skills`, `/exit`)
- Streaming output de tokens en tiempo real
- Diff approval para writes (confirmar antes de escribir archivos)
- Styled output con colores (blessed/ink)

**Transición a Go**: Esta capa es 100% reemplazable. El protocolo de comunicación con el core es JSON-RPC sobre stdio. Si mañana migramos a Go, el CLI en Go envía los mismos comandos y recibe las mismas respuestas.

### 2.2 Capa Core (MiuraSwarm)

Lo que ya existe y se mantiene. Solo se extiende, no se reescribe.

**Extensiones necesarias**:
- `StreamingToolExecutor` — ejecuta tools en paralelo y streaming de resultados
- `SessionManager` — mantiene el estado de la sesión REPL (chat history, context window)
- `CompactionStrategy` — compacta mensajes largos (SlidingWindow, Summarize, Hybrid)
- `LlamaServerManager` — administra el lifecycle de llama-server como child process

### 2.3 Capa de Estado (SQLite)

Tablas existentes + nuevas:

```sql
-- Existing
CREATE TABLE tasks (...);
CREATE TABLE agent_sessions (...);
CREATE TABLE pipeline_progress (...);
CREATE TABLE model_routing (...);
CREATE TABLE context_cache (...);
CREATE TABLE event_log (...);

-- NEW: Brain (project memory)
CREATE TABLE brain_entries (
  id INTEGER PRIMARY KEY,
  project_path TEXT NOT NULL,
  category TEXT NOT NULL, -- 'decision' | 'bugfix' | 'workaround' | 'integration' | 'release' | 'testing'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE INDEX idx_brain_project ON brain_entries(project_path, category);

-- NEW: Session (REPL chat history)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  context_window INTEGER DEFAULT 50,
  compaction_strategy TEXT DEFAULT 'sliding_window'
);
CREATE TABLE session_messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL, -- 'system' | 'user' | 'assistant' | 'tool'
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_session_messages ON session_messages(session_id, created_at);

-- NEW: Code Graph (tree-sitter index)
CREATE TABLE graph_nodes (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT NOT NULL, -- 'function' | 'class' | 'interface' | 'variable' | 'import'
  node_data TEXT NOT NULL, -- JSON blob with line, column, signature, etc.
  file_hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX idx_graph_file ON graph_nodes(file_path);
CREATE INDEX idx_graph_symbol ON graph_nodes(symbol_name);
CREATE VIRTUAL TABLE graph_fts USING fts5(symbol_name, content=graph_nodes, content_rowid=id);

CREATE TABLE graph_edges (
  id INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES graph_nodes(id),
  target_id INTEGER REFERENCES graph_nodes(id),
  edge_type TEXT NOT NULL, -- 'calls' | 'imports' | 'extends' | 'implements' | 'references'
  provenance TEXT DEFAULT 'static' -- 'static' | 'heuristic'
);

-- NEW: Skills (markdown skill definitions)
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pack TEXT NOT NULL, -- 'core' | 'mobile' | 'web' | 'testing' | 'security' | 'a11y' | 'custom'
  content TEXT NOT NULL,
  triggers TEXT NOT NULL, -- JSON array of trigger phrases
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_skills_triggers ON skills(pack, triggers);
```

---

## 3. Sistema de Inferencia Local (llama.cpp + Vulkan)

### 3.1 Arquitectura

```
┌──────────────────────────────────────────────────┐
│           LlamaServerManager (plugin)            │
│                                                  │
│  Responsabilidades:                              │
│  - Detectar GPU Vulkan disponible                │
│  - Descargar/instalar modelo si no existe        │
│  - Iniciar llama-server como child process       │
│  - Health check periódico                        │
│  - Auto-restart en caso de crash                │
│  - Graceful shutdown                            │
│  - Multi-model support (por proyecto)           │
└────────────────────────┬─────────────────────────┘
                         │
              http://127.0.0.1:{port}/v1/chat/completions
                         │
                         ▼
┌──────────────────────────────────────────────────┐
│          LlamaAdapter (LLMAdapter plugin)        │
│          — implements LLMAdapter interface —     │
│                                                  │
│  + supports(modelRef): boolean                  │
│  + prompt(model, messages, options): LLMResult │
│  + stream(model, messages, options): AsyncIter │
└──────────────────────────────────────────────────┘
```

### 3.2 LlamaServerManager

```typescript
interface LlamaServerConfig {
  modelPath: string;         // D:\IA\GGUF\modelos\qwen2.5-coder-7b-q4_k_m.gguf
  modelId: string;           // qwen2.5-coder-7b-instruct-q4_k_m
  contextSize: number;       // 8192 (13B) o 32768 (7B Q4_K_M)
  gpuLayers: number;         // 99 = todos en GPU
  threads: number;           // 0 = auto
  port: number;             // 8080 default
  nParallel: number;        // 1 para CLI interactivo
  flashAttention: boolean;  // true si el modelo lo soporta
}

class LlamaServerManager {
  private process: Bun.Subprocess | null = null;
  private config: LlamaServerConfig;
  private healthCheckInterval: number | null = null;

  async start(): Promise<void>;
  async stop(): Promise<void>;
  isRunning(): boolean;
  getHealth(): Promise<ServerHealth>;
  getBaseUrl(): string;

  // Auto-detect GPU
  detectGpuLayers(): Promise<number>;
}

interface ServerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeMs: number;
  memoryUsageMb: number;
  gpuMemoryUsedMb: number;
  lastTokenTime: number;
}
```

### 3.3 Modelos Recomendados para Intel Core Ultra (13GB shared)

| Modelo | Tamaño | Quant | Velocidad estimada | Uso óptimo |
|--------|--------|-------|-------------------|-----------|
| **Qwen2.5-Coder-7B** | 4.4GB | Q4_K_M | 15-25 tok/s | Coding agent principal |
| **Qwen2.5-14B** | 8.5GB | Q4_K_M | 8-15 tok/s | Análisis complejo |
| **DeepSeek-Coder-6.7B** | 3.9GB | Q5_K_M | 18-28 tok/s | Alternativa coding |
| **Mistral-Nemo-12B** | 7.1GB | Q4_K_M | 10-18 tok/s |通用 |
| **Phi-3.5-mini-128k** | 2.3GB | Q4_K_M | 20-35 tok/s | Tareas rápidas |
| **Llama-3.2-3B** | 1.8GB | Q4_K_M | 25-40 tok/s | Scout, context-builder |

> **Storage real**: `D:\IA\GGUF\gguf` (no `modelos/`)
> **Puerto real de llama-server**: `8050` (no `8080`)

### 3.4 Fallback Strategy (Local → Cloud)

```
┌─────────────────────────────────────────────────────┐
│              ModelRouter.resolve(role)              │
│                                                     │
│  1. Si LlamaServer disponible y modelo existe       │
│     → usar LlamaAdapter (local)                     │
│                                                     │
│  2. Si no → fallback chain por role                │
│     ├─ planner    → nvidia-nim > openrouter > groq │
│     ├─ worker     → llama.cpp local > openrouter > groq │
│     ├─ reviewer   → llama.cpp local > openrouter   │
│     ├─ researcher → nvidia-nim > openrouter        │
│     ├─ scout      → llama.cpp (Phi-3.5) > groq     │
│     └─ ...        → ...                            │
│                                                     │
│  3. Si todos fallan → throw con diagnóstico        │
└─────────────────────────────────────────────────────┘
```

---

## 4. Sistema de /Commands (REPL)

### 4.1 Command Registry

```typescript
interface Command {
  name: string;           // 'chat', 'review', 'add'
  aliases?: string[];     // ['c', 'ch']
  description: string;
  usage: string;          // '/chat <task> or just type'
  execute(ctx: CommandContext): Promise<CommandResult>;
}

class CommandRegistry {
  register(cmd: Command): void;
  get(name: string): Command | undefined;
  list(): Command[];
  getCompletions(partial: string): string[];
}

// Built-in commands
const COMMANDS: Command[] = [
  { name: 'chat',     aliases: ['c'],  description: 'Start a conversation',     usage: '/chat' },
  { name: 'review',   aliases: ['r'],  description: 'Review code or diff',     usage: '/review <diff|file>' },
  { name: 'add',      aliases: ['a'],  description: 'Add feature with workflow', usage: '/add <feature-name>' },
  { name: 'read',     aliases: ['rd'], description: 'Read a file or agent.md', usage: '/read <filename>' },
  { name: 'swarm',    aliases: ['sw'], description: 'Run multi-agent pipeline', usage: '/swarm <task>' },
  { name: 'agent',    aliases: ['ag'], description: 'Run single agent',         usage: '/agent <role> <task>' },
  { name: 'model',    aliases: ['m'],  description: 'Show or switch model',   usage: '/model [model-id]' },
  { name: 'tokens',   aliases: ['t'],  description: 'Show token usage',       usage: '/tokens' },
  { name: 'brain',    aliases: ['b'],  description: 'Project memory',        usage: '/brain [init|scan|context]' },
  { name: 'graph',    aliases: ['g'],  description: 'Code graph',             usage: '/graph [init|context|search]' },
  { name: 'skills',   aliases: ['sk'], description: 'Manage skills',         usage: '/skills [list|add|init]' },
  { name: 'debug',    aliases: ['d'],  description: 'Toggle debug mode',      usage: '/debug' },
  { name: 'tools',   aliases: [],     description: 'List available tools',   usage: '/tools' },
  { name: 'plan',    aliases: ['p'],  description: 'Create implementation plan', usage: '/plan <task>' },
  { name: 'scout',   aliases: ['sc'], description: 'Explore codebase',        usage: '/scout [path]' },
  { name: 'oracle',   aliases: ['o'],  description: 'Decision engine',         usage: '/oracle <question>' },
  { name: 'compact',  aliases: [],     description: 'Force context compaction', usage: '/compact [strategy]' },
  { name: 'clear',   aliases: [],     description: 'Clear screen',            usage: '/clear' },
  { name: 'exit',    aliases: ['quit'], description: 'Exit REPL',              usage: '/exit' },
  { name: 'help',    aliases: ['h'],  description: 'Show this help',          usage: '/help [command]' },
];
```

### 4.2 REPL Interaction Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    MiuraCLI REPL                           │
│                                                             │
│  > /chat Implement the user auth feature                  │
│  │                                                        │
│  ├─ Resolving model: qwen2.5-coder-7b-instruct-q4_k_m    │
│  ├─ System prompt loaded (planner + skills + brain)      │
│  └─ Streaming...                                          │
│                                                             │
│  Creating implementation plan...                            │
│  ████████████████████████████████░░░░░░ 80%               │
│                                                             │
│  ## Plan: User Authentication                              │
│  1. Database schema for users + sessions                   │
│  2. Auth service with JWT                                 │
│  3. Login/logout endpoints                                 │
│  4. Protected routes middleware                            │
│  5. Tests                                                  │
│                                                             │
│  ? Want me to proceed with implementation? (y/n/diff)    │
│                                                             │
│  y → /add workflow starts (REPL loop)                      │
│  n → abort                                                 │
│  diff → show planned files before writing                  │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Diff Approval System

Para operaciones de escritura (write_file, edit), antes de ejecutar:

1. El tool reporta los cambios planeados
2. El REPL muestra un diff
3. El usuario confirma con `y`, `n`, o `e` (edit)
4. Solo después de aprobación se ejecuta la escritura

---

## 5. Sistema de Memoria Entre Sesiones (Brain)

### 5.1 Concepto

Inspirado en MobiAI Brain — memoria **viva** por proyecto que se actualiza automáticamente mientras trabajás.

**Diferencia con CLAUDE.md**:
- **CLAUDE.md** = reglas fijas, estables, se actualizan raramente
- **Brain** = decisiones que cambian, bugfixes temporales, workarounds, integraciones específicas

### 5.2 Categorías

```typescript
type BrainCategory =
  | 'decision'    // "Usamos Zustand no Redux, porque..."
  | 'bugfix'      // "Fix para Firebase en iOS: esperar 2s antes de clear"
  | 'workaround'  // "Bug en CocoaPods 1.15: usar --repo-update"
  | 'integration' // "Firebase Auth requiere GoogleService-Info.plist en ./ios"
  | 'release'     // "Release 2.1.0 - cambios de migración"
  | 'testing';    // "DataStore tests requieren --fake-timers primero"
```

### 5.3 BrainManager Plugin

```typescript
interface BrainEntry {
  id: string;
  projectPath: string;
  category: BrainCategory;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

class BrainManager {
  // Init brain for a project
  async init(projectPath: string): Promise<void>;

  // Scan project and auto-populate
  async scan(projectPath: string): Promise<BrainEntry[]>;

  // Add manual entry
  async add(entry: Omit<BrainEntry, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<BrainEntry>;

  // Auto-capture from agent conversation
  async captureDecision(decision: string, reason: string): Promise<void>;
  async captureBugfix(bug: string, fix: string): Promise<void>;
  async captureWorkaround(issue: string, workaround: string): Promise<void>;

  // Query for context
  async getContext(projectPath: string, categories?: BrainCategory[]): Promise<BrainEntry[]>;
  async search(projectPath: string, query: string): Promise<BrainEntry[]>;

  // Format for LLM context
  formatForContext(entries: BrainEntry[]): string;

  // MCP tool interface
  getTools(): ToolHandler[];
}
```

### 5.4 Auto-capture Triggers

El Brain se actualiza **automáticamente** cuando:
- El agente hace un commit con mensaje tipo `fix: workaround for X`
- El reviewer sugiere un workaround específico
- El agente detecta un bug known issue y aplica un fix
- El oracle toma una decisión técnica explícita

El agente detecta patrones en el output y предложит guardar en Brain.

---

## 6. Code Graph (Tree-sitter + SQLite FTS5)

### 6.1 Concepto

Inspirado en CodeGraph — index pre-computado del código para que el agente no tenga que hacer grep/glob/read ciegos.

**Benchmark**: 35% menos tokens, 70% menos tool calls, ~22% del costo original.

### 6.2 GraphIndexer Plugin

```typescript
interface GraphNode {
  id: number;
  filePath: string;
  symbolName: string;
  symbolType: 'function' | 'class' | 'interface' | 'variable' | 'import' | 'type';
  signature?: string;    // "func(arg1: type) -> ret"
  line: number;
  column: number;
  endLine?: number;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  source: number; // node id
  target: number; // node id
  type: 'calls' | 'imports' | 'extends' | 'implements' | 'references' | 'returns';
  provenance: 'static' | 'heuristic';
}

class GraphIndexer {
  // Initialize index for project
  async init(projectPath: string, options?: IndexOptions): Promise<void>;

  // Full re-index
  async indexAll(): Promise<IndexStats>;

  // Incremental update (file watcher)
  async indexFile(filePath: string): Promise<void>;
  async removeFile(filePath: string): Promise<void>;

  // Queries
  async findSymbol(name: string, fileScope?: string): Promise<GraphNode[]>;
  async traceCallGraph(symbolName: string, direction: 'up' | 'down' | 'both'): Promise<GraphEdge[]>;
  async searchSymbols(query: string): Promise<GraphNode[]>; // FTS5
  async getFileSymbols(filePath: string): Promise<GraphNode[]>;
  async getProjectStructure(depth?: number): Promise<ProjectStructure>;

  // MCP tool interface
  getTools(): ToolHandler[];
}

interface IndexOptions {
  languages: string[];      // ['typescript', 'javascript', 'go']
  excludePatterns: string[]; // ['node_modules', 'dist', '*.test.ts']
  includeHeuristics: boolean; // cross-language bridging
}

interface IndexStats {
  filesIndexed: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
}
```

### 6.3 MCP Tools Expuestas

```json
[
  {
    "name": "graph_context",
    "description": "Get architectural context about a symbol (file, function, class)",
    "parameters": {
      "type": "object",
      "properties": {
        "symbol": { "type": "string" },
        "file": { "type": "string" }
      }
    }
  },
  {
    "name": "graph_trace",
    "description": "Trace call graph (who calls this, what does this call)",
    "parameters": {
      "type": "object",
      "properties": {
        "symbol": { "type": "string" },
        "direction": { "type": "string", "enum": ["up", "down", "both"] }
      }
    }
  },
  {
    "name": "graph_search",
    "description": "Full-text search across all symbols",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string" }
      }
    }
  }
]
```

### 6.4 File Watcher Integration

- Usa `fs.watch` o `chokidar` para detectar cambios
- Debounce de 2s antes de re-indexar
- Si el archivo cambió durante el debounce, se累计a el cambio
- Banner de "stale index" si pasaron >10s sin sync

---

## 7. Sistema de Skills

### 7.1 Concepto

Inspirado en MobiAI Skills — archivos markdown que le dicen al agente cómo trabajar en contextos específicos.

### 7.2 Skill Structure

```
.miura/
  skills/
    core/
      tdd.md           # Workflow TDD: RED → GREEN → Security → A11Y
      git-commits.md   # Conventional commits (never mention AI)
      code-review.md   # Review checklist
    mobile/
      android.md       # Android-specific patterns
      ios.md           # iOS-specific patterns
      flutter.md       # Flutter-specific patterns
    web/
      react-hooks.md   # React patterns
      nextjs.md        # Next.js conventions
    testing/
      vitest.md        # Vitest patterns
      playwright.md    # E2E testing
    security/
      owasp-top10.md   # Security checklist
      secrets.md       # Never expose API keys
    a11y/
      wcag-checklist.md # Accessibility requirements
```

### 7.3 SkillFormat

```markdown
# TDD Workflow

## Cuando usar
Cuando se te pide implementar una nueva funcionalidad.

## Pasos

1. **RED Phase**: Escribir tests que fallen primero
   - Crear test para US-XXX basado en criterios de aceptación
   - Commit: `test: add [feature] tests (RED)`

2. **GREEN Phase**: Implementar mínimo código para que pasen los tests
   - No optimizaciones prematuras
   - Commit: `feat: implement [feature] (GREEN)`

3. **Security Check**: Auditar código antes de merge
   - OWASP Top 10 checklist
   - npm audit
   - No secrets hardcoded

4. **A11Y Check**: Verificar accesibilidad
   - WCAG 2.1 AA
   - Keyboard navigation
   - ARIA labels

## Reglas
- NUNCA escribir código sin tests fallando primero
- NUNCA mencionar "Claude" o "AI" en commits
- SIEMPRE aplicar linter y formatter
```

### 7.4 SkillManager

```typescript
interface Skill {
  id: string;
  name: string;
  pack: 'core' | 'mobile' | 'web' | 'testing' | 'security' | 'a11y' | 'custom';
  content: string;
  triggers: string[]; // ["TDD", "test first", "RED phase"]
  filePath: string;
}

class SkillManager {
  async init(pack?: string[]): Promise<void>;
  async list(): Promise<Skill[]>;
  async get(id: string): Promise<Skill | undefined>;
  async add(filePath: string): Promise<Skill>;
  async remove(id: string): Promise<void>;

  // Get skills relevant to current context
  matchSkills(context: string): Skill[];

  // Format for system prompt injection
  formatForPrompt(skills: Skill[]): string;

  getTools(): ToolHandler[];
}
```

---

## 8. Compaction Strategy (Context Window Management)

### 8.1 Estrategias

```typescript
interface CompactionStrategy {
  name: string;
  compact(messages: LLMMessage[], contextWindow: number): LLMMessage[];
}

// 1. NoCompaction (default actual)
class NoCompaction implements CompactionStrategy { ... }

// 2. SlidingWindow - keep last N messages
class SlidingWindow implements CompactionStrategy {
  constructor(private keepMessages: number = 50);
}

// 3. Summarize - ask model to summarize old turns
class Summarize implements CompactionStrategy {
  constructor(
    private thresholdMessages: number = 20,
    private summaryModel?: ModelRef
  );
}

// 4. SafeSplitPoint - never split tool_use + tool_result
class SafeSplitPoint implements CompactionStrategy {
  constructor(private inner: CompactionStrategy);
}

// 5. Hybrid - SlidingWindow + Preserve system + last N tools
class Hybrid implements CompactionStrategy {
  constructor(
    private keepMessages: number = 30,
    private preserveSystem: boolean = true
  );
}
```

### 8.2 Aplicación

```typescript
class SessionManager {
  async compact(): Promise<void> {
    const strategy = this.getStrategy();
    const compacted = strategy.compact(this.messages, this.contextWindow);
    if (compacted.length !== this.messages.length) {
      this.messages = compacted;
      this.emit('session.compacted', { before, after });
    }
  }

  private getStrategy(): CompactionStrategy {
    switch (this.config.compactionStrategy) {
      case 'sliding_window': return new SlidingWindow(30);
      case 'summarize': return new Summarize(20, this.summaryModel);
      case 'hybrid': return new Hybrid(30);
      default: return new NoCompaction();
    }
  }
}
```

---

## 9. Streaming Output

### 9.1 Token Streaming

El adapter de llama.cpp soporta SSE streaming. El REPL renderiza tokens en tiempo real:

```typescript
async function streamResponse(
  adapter: LLMAdapter,
  model: ModelRef,
  messages: LLMMessage[],
  options: LLMOptions
): Promise<void> {
  const stream = adapter.stream(model, messages, options);

  process.stdout.write('\n');
  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n\n');
}
```

### 9.2 Progress Indicators

Para operaciones largas (index, scan, pipeline):

```typescript
class ProgressIndicator {
  private spinner: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
  private current = 0;

  start(label: string): void;
  update(progress: number, total: number): void;
  stop(): void;
  pulse(message: string): void;
}

// Output examples:
// Indexing project... ⠙ 45%
// Running pipeline... ████████████░░░░░░░░ 60%
// Scanning... [muted pulse]
```

---

## 10. Plugin System — Extension Points

### 10.1 Los Tres Extension Points (BYO Harness Pattern)

```typescript
// EXTENSION POINT 1: LLM Provider
interface Provider {
  name: string;
  supports(model: ModelRef): boolean;
  send(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResult>;
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string>;
}

// EXTENSION POINT 2: Tool
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// EXTENSION POINT 3: Memory/Compaction
interface Memory {
  save(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown | null>;
  search(query: string): Promise<SearchResult[]>;
}
interface CompactionStrategy {
  compact(messages: LLMMessage[], contextWindow: number): LLMMessage[];
}
```

### 10.2 Plugin Registry (ya existe, extender)

```typescript
// New plugin types
type PluginType =
  | 'adapter'      // LLM providers (existente)
  | 'agent'        // Agent roles (existente)
  | 'memory'       // Storage backends (existente)
  | 'integration'  // External integrations (existente)
  | 'knowledge'    // Code graph, skills, brain (NUEVO)
  | 'ui'           // TUI components (NUEVO)
  | 'tool'         // Tool handlers (existente)
  | 'provider'     // LLM providers (NUEVO - alias de adapter para claridad)
  | 'compaction';  // Compaction strategies (NUEVO)
```

---

## 11. Integración con Gentle-AI y OpenSpec

> **Nota importante**: El proyecto ya tiene integración parcial con Gentle-AI vía Qwen Code. Los skills SDD (`/sdd-init`, `/sdd-propose`, `/sdd-spec`, `/sdd-design`, `/sdd-tasks`, `/sdd-apply`, `/sdd-verify`, `/sdd-archive`) están disponibles en `~/.claude/skills/` y el skill-registry ya está configurado en `.atl/skill-registry.md`. MiuraSwarm complementa a Gentle-AI proporcionando la **capa de inferencia local** que Gentle-AI necesita.

### 11.1 Arquitectura de Integración

```
┌─────────────────────────────────────────────────────────────────────┐
│                    gentle-ai (Go CLI)                               │
│  /sdd-init, /sdd-propose, /sdd-* commands                           │
│  Engram memory, skill registry, AI provider switcher                │
│  Per-phase model assignment                                         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ ¿Dónde está el LLM?
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              MiuraSwarm Core (TypeScript + Bun)                    │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────────────────────┐      │
│  │ LlamaServerManager│    │ 11 cloud adapters (fallback)      │      │
│  │ llama-server.exe  │    │ nvidia-nim, openrouter, groq...  │      │
│  │ Port: 8050        │    │                                  │      │
│  │ Vulkan GPU layers │    │ Per-phase model routing          │      │
│  └──────────────────┘    └──────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────────────────────┐      │
│  │ BrainManager     │    │  GraphIndexer + SkillManager     │      │
│  │ Project memory   │    │  Code graph + skills             │      │
│  └──────────────────┘    └──────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.2 Gentle-AI — Patrones a Adoptar

Gentle-AI (Go, 93.1%) es la fuente de referencia para varios patrones que debemos implementar:

**Delegation Triggers** (薄 orchestrator):
```
| Trigger                              | Expected Behavior              |
|--------------------------------------|--------------------------------|
| read_file 4+ archivos para entender  | Delegar exploración            |
| Tocar 2+ archivos no triviales       | Un writer, review antes de fin |
| Commit/push/PR después de cambios    | Fresh review a menos que sea trivial |
| cwd equivocado, git accident         | Parar y hacer audit fresco     |
| Sesión larga con complejidad creciente | Pausar y delegar/re-planificar |
| Revisión adversaria de diffs         | Usar contexto fresco           |
```

**Per-Phase Model Assignment** (de Gentle-AI):
```bash
# Así Gentle-AI rutea diferentes modelos por fase SDD:
gentle-ai sync --profile cheap:openrouter/qwen/qwen3-30b-a3b:free
gentle-ai sync --profile-phase cheap:sdd-design:anthropic/claude-sonnet-4-20250514
```

**Implementar en MiuraSwarm**:
```typescript
interface PhaseModelConfig {
  'sdd-propose': ModelRef;   // Modelo para propuestas
  'sdd-spec': ModelRef;      // Modelo para especificaciones
  'sdd-design': ModelRef;    // Modelo para diseño técnico
  'sdd-tasks': ModelRef;     // Modelo para descomposición
  'sdd-apply': ModelRef;     // Modelo para implementación (local si disponible)
  'sdd-verify': ModelRef;    // Modelo para verificación
  'sdd-archive': ModelRef;   // Modelo para archival
}
```

**Backup System** (Gentle-AI):
- tar.gz compression con deduplicación
- Auto-prune (mantiene los 5 más recientes)
- Pin protection para backups importantes
- Esto complementa el state store de MiuraSwarm

### 11.3 OpenSpec — Spec-Driven Development

OpenSpec es la capa de especificación. MiuraSwarm usa el mismo formato que OpenSpec para mantener compatibilidad y poder interoperar con cualquier agente que soporte OpenSpec (40+ incluyendo Qwen Code).

**Estructura de specs (`.miura/` o `.openspec/`)**:

```
.miura/
  openspec/                    # Compatibilidad con OpenSpec
    specs/
      auth-session/
        spec.md
      user-auth/
        spec.md
    changes/
      add-remember-me/
        proposal.md
        design.md
        tasks.md
        specs/
          auth-session/
            spec.md
```

**Formatos OpenSpec**:

```markdown
# auth-session Specification

## Purpose
Manage user session lifecycle including creation, validation, and expiration.

## Requirements

### Requirement: Session expiration
The system SHALL expire sessions after a configured duration.

#### Scenario: Default session timeout
- GIVEN a user has authenticated
- WHEN 24 hours pass without activity
- THEN invalidate the session token
```

**Integración con SDD de Gentle-AI**:

| SDD Phase | OpenSpec Artifact | MiuraSwarm Plugin |
|-----------|-------------------|-------------------|
| `sdd-propose` | `proposal.md` | ProposalGenerator |
| `sdd-spec` | `specs/**/*.md` | SpecManager |
| `sdd-design` | `design.md` | DesignWriter |
| `sdd-tasks` | `tasks.md` | TaskBreakdown |
| `sdd-apply` | — | Ejecuta con pipeline |
| `sdd-verify` | — | Ejecuta tests + review |
| `sdd-archive` | `openspec/changes/archive/` | Archiver |

### 11.4 Comandos OpenSpec en MiuraSwarm CLI

```typescript
// Integración con comandos estilo OpenSpec
const OPENSPECCOMMANDS: Command[] = [
  {
    name: 'propose',
    aliases: ['new'],
    description: 'Crear change proposal via OpenSpec',
    usage: '/propose <descripción del cambio>',
    execute: async (ctx) => {
      // 1. Buscar specs existentes relacionadas
      // 2. Leer specs relevantes
      // 3. Crear change proposal folder
      // 4. Generar proposal.md + design.md + tasks.md + spec deltas
    }
  },
  {
    name: 'continue',
    aliases: ['cont'],
    description: 'Continuar implementación de change abierto',
    usage: '/continue [change-id]',
  },
  {
    name: 'verify',
    description: 'Verificar implementación contra specs',
    usage: '/verify [change-id]',
  },
  {
    name: 'archive',
    description: 'Archivar change completado',
    usage: '/archive [change-id]',
  },
  {
    name: 'spec',
    aliases: ['specs'],
    description: 'Gestionar specs de capabilities',
    usage: '/spec [list|add|edit|search] [args]',
  },
];
```

### 11.5 Dual Memory: Engram + Brain

```
┌──────────────────────────────────────────────────────┐
│                  Persistencia de Memoria             │
│                                                      │
│  Gentle-AI Engram ──► Decisiones CROSS-PROJECT      │
│  (~/.engram/)       Decisiones que aplican a todos  │
│                                                      │
│  MiuraSwarm Brain  ──► Conocimiento por PROYECTO    │
│  (.miura/brain/)    Decisiones específicas del repo │
│                                                      │
│  OpenSpec specs     ──► Requirements + Spec Deltas   │
│  (.miura/openspec/) Cambio en specs para humanos    │
│                                                      │
│  → Engram busca contexto global + cross-project     │
│  → Brain busca contexto local + decisiones técnicas │
│  → OpenSpec busca requerimientos + cambios          │
└──────────────────────────────────────────────────────┘
```

---

## 12. Go Transition Strategy

### 12.1 Objetivo

Mantener la posibilidad de migrar el CLI a Go sin reescribir el core.

### 12.2 Interfaz de Comunicación

```
┌─────────────────┐    JSON-RPC over stdio    ┌─────────────────┐
│   miura-go CLI  │◄──────────────────────────►│ MiuraSwarm Core │
│   (futuro)      │                           │   (TypeScript)   │
│                 │                           │                 │
│ - REPL/TUI      │    { "jsonrpc": "2.0",    │ - Agents        │
│ - /commands     │      "method": "run",     │ - Pipeline      │
│ - llama-server  │      "params": {...},     │ - ModelRouter   │
│   lifecycle     │      "id": 1 }            │ - Plugins       │
│ - File watch    │                           │                 │
└─────────────────┘                           └─────────────────┘
```

### 12.3 JSON-RPC Commands

```typescript
interface MiuraRPC {
  // Session
  'session.start': (config: SessionConfig) => Session;
  'session.end': (sessionId: string) => void;

  // Chat
  'chat.send': (sessionId: string, message: string) => StreamResponse;
  'chat.compact': (sessionId: string) => void;

  // Pipeline
  'pipeline.run': (input: string, definition: PipelineDefinition) => PipelineResult;
  'pipeline.resume': (pipelineId: string) => PipelineResult;

  // Brain
  'brain.init': (projectPath: string) => void;
  'brain.scan': (projectPath: string) => BrainEntry[];
  'brain.add': (entry: BrainEntry) => BrainEntry;
  'brain.get': (projectPath: string, categories?: string[]) => BrainEntry[];

  // Graph
  'graph.init': (projectPath: string) => IndexStats;
  'graph.search': (query: string) => GraphNode[];
  'graph.trace': (symbol: string, direction: string) => GraphEdge[];

  // Tools
  'tools.list': () => ToolDefinition[];
  'tools.execute': (name: string, args: Record<string, unknown>) => ToolResult;

  // Llama
  'llama.start': (config: LlamaServerConfig) => void;
  'llama.stop': () => void;
  'llama.health': () => ServerHealth;
  'llama.download': (modelUrl: string) => void;
}
```

### 12.4 Evaluación de Costo de Transición

| Componente | Costo de migración a Go | Notas |
|------------|------------------------|-------|
| REPL + /commands | **Bajo** | Reescribir en Go con Bubble Tea |
| llama-server lifecycle | **Medio** | Go tiene mejor child process mgmt |
| MiuraSwarm Core | **Alto** | No migrar — dejar en TS |
| Plugins (adapters, tools) | **Medio** | Interfaces son las mismas |
| State (SQLite) | **Bajo** | better-sqlite3 → go-sqlite3 |
| Brain + Graph | **Bajo** | Reescribir indexer en Go con tree-sitter |
| JSON-RPC bridge | **Medio** | Definir schema, implementar en ambos |

**Decisión**: El CLI migra a Go cuando y si sea necesario. El core queda en TypeScript indefinidamente.

---

## 13. Plan de Implementación (Fases)

### Fase 0: Fundaciones (1-2 días)
- [ ] Migrar runtime a Bun (reemplazar Node.js)
- [ ] Compilar a binario standalone (`bun build --compile`)
- [ ] Verificar que todos los 33+ tests pasen
- [ ] Documentar ADR-001 (este documento)

### Fase 1: REPL Interactivo (2-3 días)
- [ ] Reemplazar commander CLI por REPL con blessed
- [ ] Implementar CommandRegistry con /commands
- [ ] Input history (arrow up/down, readline)
- [ ] Streaming output de tokens
- [ ] Styled output con colores
- [ ] Diff approval para writes

### Fase 2: Llama.cpp Local (2-3 días)
- [ ] LlamaServerManager plugin
- [ ] Auto-detección de GPU Vulkan
- [ ] LlamaAdapter (implementa LLMAdapter)
- [ ] Health check y auto-restart
- [ ] Modelo default: Qwen2.5-Coder-7B Q4_K_M
- [ ] Fallback strategy local → cloud

### Fase 3: Sistema de Memoria (2 días)
- [ ] BrainManager plugin (SQLite tables)
- [ ] BrainManager.init() y scan()
- [ ] Auto-capture triggers
- [ ] Brain MCP tools

### Fase 4: Code Graph (3-4 días)
- [ ] GraphIndexer plugin (tree-sitter)
- [ ] Multi-language support (TS, JS, Go, Python)
- [ ] SQLite FTS5 integration
- [ ] File watcher con debounce
- [ ] Graph MCP tools

### Fase 5: Skills System (1-2 días)
- [ ] SkillManager plugin
- [ ] Skill files for core workflows
- [ ] Auto-injection en system prompt
- [ ] Skill matching por contexto

### Fase 6: Compaction + Context (1-2 días)
- [ ] CompactionStrategy interface
- [ ] Hybrid + SlidingWindow + Summarize implementations
- [ ] SessionManager con auto-compaction
- [ ] Token counter y budget enforcement

### Fase 7: Polish + MCP (2-3 días)
- [ ] MCP client para herramientas externas
- [ ] MCP server para que otros agentes usen MiuraSwarm
- [ ] Progress indicators mejorados
- [ ] Error handling robusto
- [ ] Tests de integración

### Fase 8: Go CLI (opcional, futuro)
- [ ] Diseñar JSON-RPC interface
- [ ] Implementar Go CLI con Bubble Tea
- [ ] Migrar llama-server lifecycle a Go
- [ ] Bridge JSON-RPC ↔ MiuraSwarm Core

---

## 14. Archivo de Configuración

```yaml
# .miura/config.yaml
version: 2

# Inference priority: local | cloud | hybrid
inference:
  priority: local  # local first, fallback to cloud
  local:
    provider: llama-server
    models:
      default: qwen2.5-coder-7b-q4_k_m
      planner: qwen2.5-coder-7b-q4_k_m
      worker: qwen2.5-coder-7b-q4_k_m
      reviewer: phi-3.5-mini-128k-q4_k_m
      scout: phi-3.5-mini-128k-q4_k_m
    llamaServer:
      port: 8050
      gpuLayers: 99
      contextSize: 8192
      nParallel: 1
      modelsDir: D:\IA\GGUF\gguf
  cloud:
    # API keys managed via .miura/api-keys.env
    fallbackOrder:
      - nvidia-nim
      - openrouter
      - groq

# Context management
context:
  compaction: hybrid  # sliding_window | summarize | hybrid
  keepMessages: 30
  tokenBudget: 128000

# Project memory
brain:
  enabled: true
  autoCapture: true
  autoCaptureTriggers:
    - 'workaround'
    - 'fix for'
    - 'temporary'
    - 'known issue'

# Code graph
graph:
  enabled: true
  languages:
    - typescript
    - javascript
    - go
    - python
  exclude:
    - node_modules
    - dist
    - .git
    - "*.test.ts"
    - "*.spec.ts"

# Skills
skills:
  packs:
    - core
    - testing
    - security
    - a11y

# Plugins
plugins:
  enabled: []
  disabled: []

# CLI behavior
cli:
  diffApproval: true
  streaming: true
  styledOutput: true
  debug: false
```

---

## 15. Glosario

| Término | Definición |
|---------|-----------|
| **Harness** | El marco que controla qué ve el agente, qué puede hacer, y qué recuerda |
| **ReAct Loop** | Reason → Act → Observe → repeat (loop de razonamiento y acción) |
| **Provider** | Implementación de backend LLM (llama.cpp, OpenAI, Anthropic, etc.) |
| **Brain** | Memoria viva del proyecto (decisiones, bugfixes, workarounds) |
| **Graph** | Índice semántico del código (símbolos, call graph, FTS5) |
| **Skills** | Archivos markdown con conocimiento procedimental por contexto |
| **Compaction** | Estrategia para reducir mensajes en contexto cuando se agotan tokens |
| **Scope Rule** | Regla de arquitectura: 2+ features = global, 1 feature = local |
| **Stuck Detection** | Detección de loops infinitos o patrones de atasco |
| **Pipeline** | DAG de stages con agents, retry, y stuck recovery |

---

## 16. Referencias

- [BYO Coding Agent](https://github.com/betta-tech/byo-coding-agent) — Provider/Tool/Compaction interfaces
- [Gentle-AI](https://github.com/Gentleman-Programming/gentle-ai) — Go ecosystem configurator, Engram memory, SDD orchestrator, per-phase model routing
- [OpenSpec](https://openspec.dev) — Spec-driven development framework, proposal/design/tasks artifacts
- [CodeGraph](https://github.com/colbymchenry/codegraph) — Tree-sitter + FTS5 graph indexing
- [MobiAI](https://github.com/ArisGuimera/MobiAI-Core) — Skills, Brain, Graph concepts
- [Gentleman Programming (libro)](docs/gentleman-programming-book-es.pdf) — Scope Rule, 7 agentes especializados, TDD workflow, Tony Stark workflow
- [llama.cpp](https://github.com/ggerganov/llama.cpp) — Vulkan inference, llama-server
- [MiuraSwarm actual](src/) — 46 archivos TypeScript, 33+ tests

---

### P2 | ¿Backup system de Gentle-AI? | Integrar en MiuraSwarm / Solo para proyectos críticos | Complemento al state store |
| P3 | ¿Formato de specs: `.miura/` o `.openspec/`? | Dual support / Solo `.miura/` | OpenSpec compat lo sugiere |

---

## 18. Plan de Implementación (8 Fases)

### Convenciones del plan

- Cada fase tiene **entregables verificables** (`bun test` + comandos manuales)
- El orden está optimizado para **validar cada fase antes de agregar la siguiente**
- Las fases 3, 4, 5 pueden hacerse en paralelo después de completar Fase 2
- **~20 días de implementación** distribuidos en 8 fases

---

### Fase 0 — Fundaciones (Día 1)

**Objetivo**: Asegurar que el codebase actual corre en Bun y compila a binario.

**Archivos a modificar**:
- `package.json` — scripts para `bun test`, `bun run dev`, `bun build --compile`
- `vitest.config.ts` — asegurar compatibilidad con Bun

**Verificación**:
```bash
bun test                    # 38+ tests pasan
bun build src/cli/index.ts --compile --outfile dist/miura.exe
./dist/miura.exe status    # responde correctamente
```

**Entregables**:
- [ ] `bun test` pasa (38+ tests)
- [ ] `dist/miura.exe` funcional
- [ ] Scripts de package.json actualizados para Bun

---

### Fase 1 — LlamaServerManager + LlamaAdapter (Días 2-4) ← **PRIORIDAD**

**Objetivo**: Que MiuraSwarm pueda llamar modelos locales via llama-server en puerto 8050, con fallback a cloud.

**Archivos a crear**:
```
src/plugins/providers/llama-server/
  index.ts          # LlamaServerManager plugin
  health.ts         # health check implementation
  process.ts        # child process management
```

```
src/plugins/adapters/llama-server/
  index.ts          # LlamaAdapter (implementa LLMAdapter)
```

**Archivos a modificar**:
- `src/core/types.ts` — agregar `provider: 'llama-server'` a ModelRef
- `src/core/model-router.ts` — priorizar local, fallback chain
- `src/index.ts` — registrar LlamaAdapter en PluginHost
- `src/plugins/memory/sqlite-state/migrations.ts` — agregar tabla si es necesario

**API de LlamaServerManager**:
```typescript
const manager = new LlamaServerManager({
  serverPath: 'D:\\IA\\GGUF\\llama-vulkan\\llama-server.exe',
  modelPath: 'D:\\IA\\GGUF\\gguf\\qwen2.5-coder-7b-q4_k_m.gguf',
  port: 8050,
  gpuLayers: 99,
  contextSize: 8192,
});
await manager.start();      // inicia o conecta a server existente
await manager.healthCheck(); // { status, uptimeMs, memoryUsageMb, gpuMemoryUsedMb, lastTokenTime }
await manager.stop();        // graceful shutdown
```

**API de LlamaAdapter**:
```typescript
// Implementa LLMAdapter interface
// HTTP POST http://127.0.0.1:8050/v1/chat/completions
// Soporta streaming (SSE)
// No requiere API key
```

**Verificación**:
```bash
# Test de adapter (con llama-server corriendo)
curl http://127.0.0.1:8050/v1/models

# Health check
./dist/miura.exe model   # muestra modelo local configurado

# Test de fallback (simular que local no responde)
# → debe fallback a nvidia-nim automáticamente
```

**Entregables**:
- [ ] `LlamaServerManager` plugin con auto-start, health check, auto-restart
- [ ] `LlamaAdapter` registrado como adapter en PluginHost
- [ ] `ModelRouter` resuelve a local primero, cloud como fallback
- [ ] Health check accesible via `/model`
- [ ] `bun test` pasa

**Depende de**: Fase 0 ✅

---

### Fase 2 — REPL Interactivo con /Commands (Días 5-7)

**Objetivo**: Reemplazar commander CLI one-shot por REPL interactivo con streaming de tokens.

**Archivos a crear**:
```
src/cli/
  command-registry.ts   # Command interface + 19 commands
  repl.ts                # blessed/ink TUI
  session-manager.ts     # chat history + persistence
```

**Comandos a implementar** (19):
```
/chat    /review  /add    /read   /swarm  /agent   /model
/tokens  /brain   /graph  /skills /debug  /tools  /plan
/scout   /oracle  /compact /clear  /exit   /help
```

**Flujo del REPL**:
```
> /chat implement user auth
  → CommandRegistry.match("/chat")
  → ChatCommand.execute(ctx)
    → SessionManager.append(user, message)
    → MiuraSwarm.runAgent('worker', msg)
      → ModelRouter.resolve() → LlamaAdapter (local)
        → streaming response rendered en tiempo real

> explain the EventBus
  → No es slash command
  → SeTreata como /chat con history
  → Streaming output
```

**Verificación**:
```bash
echo "/help\n/exit" | ./dist/miura.exe   # REPL arranca y sale limpio
echo "/model\n/exit" | ./dist/miura.exe  # muestra info de modelo local
echo "hello" | ./dist/miura.exe          # streaming output
```

**Entregables**:
- [ ] `CommandRegistry` con 19 comandos
- [ ] REPL con input history (arrow up/down, .miura/history)
- [ ] Streaming output en tiempo real
- [ ] Styled output con colores (info, warn, error, success)
- [ ] Diff approval para writes (REPL pausa y pide y/n/e)
- [ ] Session persistence entre ejecuciones
- [ ] `bun test` pasa

**Depende de**: Fase 1 ✅

---

### Fase 3 — Sistema Brain (Días 8-9)

**Objetivo**: Persistir decisiones técnicas, bugfixes, y workarounds por proyecto. Memoria que sobrevive resets de contexto.

**Archivos a crear**:
```
src/plugins/memory/brain/
  index.ts              # BrainManager plugin
  scanner.ts            # auto-detect decisions from commits
  capture.ts            # auto-capture triggers
```

**Tablas SQLite** (en migrations.ts):
```sql
CREATE TABLE brain_entries (
  id INTEGER PRIMARY KEY,
  project_path TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'decision' | 'bugfix' | 'workaround' | 'integration' | 'release' | 'testing'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER DEFAULT 1
);
CREATE INDEX idx_brain_project ON brain_entries(project_path, category);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  context_window INTEGER DEFAULT 50,
  compaction_strategy TEXT DEFAULT 'hybrid'
);
CREATE TABLE session_messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);
```

**Comandos**:
```
/brain init    → inicializa brain en el proyecto actual
/brain scan    → escanea y detecta decisiones automáticamente
/brain context → muestra contexto actual para injectar en system prompt
```

**Auto-capture triggers** (en Pipeline/AgentBus):
- Commit message contiene: `fix:`, `workaround`, `temp:`, `known issue`
- Oracle agent produce decisión explícita
- Stuck detector dispara → ofrecer captura de workaround

**Verificación**:
```bash
./dist/miura.exe brain init
./dist/miura.exe brain scan
ls .miura/brain/   # debe tener estructura
# Ejecutar una tarea, verificar que brain captura decisiones relevantes
```

**Entregables**:
- [ ] Tablas SQLite (brain_entries, sessions, session_messages)
- [ ] `BrainManager` plugin con init, scan, capture, getContext
- [ ] Auto-capture en Pipeline (commits, oracle, stuck)
- [ ] Comandos `/brain init/scan/context`
- [ ] `formatForContext()` para injectar en system prompt
- [ ] `bun test` pasa

**Depende de**: Fase 2 ✅

---

### Fase 4 — Code Graph con Tree-sitter (Días 10-13)

**Objetivo**: Índice semántico del código (símbolos, call graph, FTS5) para reducir 85% de tokens en consultas de código.

**Archivos a crear**:
```
src/plugins/knowledge/graph-indexer/
  index.ts              # GraphIndexer plugin
  parser.ts              # tree-sitter wrappers
  indexer.ts             # indexing logic
  fts5.ts               # SQLite FTS5 queries
  watcher.ts            # file watcher con debounce
```

**Tablas SQLite**:
```sql
CREATE TABLE graph_nodes (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT NOT NULL,  -- 'function' | 'class' | 'interface' | 'variable' | 'import'
  node_data TEXT NOT NULL,    -- JSON: line, column, endLine, signature, etc.
  file_hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX idx_graph_file ON graph_nodes(file_path);
CREATE INDEX idx_graph_symbol ON graph_nodes(symbol_name);

CREATE VIRTUAL TABLE graph_fts USING fts5(symbol_name, content=graph_nodes, content_rowid=id);

CREATE TABLE graph_edges (
  id INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES graph_nodes(id),
  target_id INTEGER REFERENCES graph_nodes(id),
  edge_type TEXT NOT NULL,  -- 'calls' | 'imports' | 'extends' | 'implements' | 'references'
  provenance TEXT DEFAULT 'static'  -- 'static' | 'heuristic'
);
```

**MCP tools** (registradas en ToolRegistry):
```typescript
graph_context(symbol: string, file?: string)
// → "Returns architectural context about a symbol (file, function, class)"
// → Usa: graph_nodes + graph_edges

graph_trace(symbol: string, direction: 'up' | 'down' | 'both')
// → "Trace call graph (who calls this, what does this call)"
// → Usa: graph_edges

graph_search(query: string)
// → "Full-text search across all symbols"
// → Usa: graph_fts FTS5
```

**Comandos**:
```
/graph init    → indexa todo el proyecto (tree-sitter)
/graph search  → busca símbolo por nombre
/graph trace   → traza call graph de un símbolo
```

**File watcher**:
```typescript
// fs.watch con debounce de 2s
// Si archivo cambió durante debounce →累计ar cambios
// Si index está stale (>10s sin sync) → mostrar banner
```

**Verificación**:
```bash
./dist/miura.exe graph init
# en proyecto MiuraSwarm: debe indexar ~50 archivos en <5s

./dist/miura.exe graph search "EventBus"
# → devuelve símbolos con ubicación

./dist/miura.exe graph trace "emit" --direction down
# → muestra quién llama a "emit"

# Verificar que tools graph_* están registradas
./dist/miura.exe tools | grep graph
```

**Entregables**:
- [ ] `GraphIndexer` plugin
- [ ] Tree-sitter para TypeScript, JavaScript, Go, Python
- [ ] SQLite FTS5 integration
- [ ] MCP tools `graph_context`, `graph_trace`, `graph_search`
- [ ] Comandos `/graph init/search/trace`
- [ ] File watcher con debounce 2s
- [ ] Stale banner cuando index está desactualizado
- [ ] `bun test` pasa

**Depende de**: Fase 3 ✅

---

### Fase 5 — Skills System (Días 14-15)

**Objetivo**: Archivos markdown con workflow procedimental por contexto. Progressive disclosure.

**Archivos a crear**:
```
src/plugins/knowledge/skill-manager/
  index.ts              # SkillManager plugin
  matcher.ts            # context-based skill matching
```

**Archivos de skills** (en `.miura/skills/`):
```
core/
  tdd.md           # RED → GREEN → Security → A11Y workflow
  git-commits.md   # Conventional commits, nunca mencionar AI
  code-review.md   # Review checklist
testing/
  vitest.md        # Patrones Vitest
security/
  owasp-top10.md   # OWASP Top 10 checklist
a11y/
  wcag-checklist.md # WCAG 2.1 AA compliance
```

**Formato de skill**:
```markdown
# TDD Workflow

## Cuando usar
Cuando se pide implementar una nueva funcionalidad.

## Pasos
1. **RED Phase**: Escribir tests que fallen primero
2. **GREEN Phase**: Implementar mínimo código
3. **Security Check**: Auditar antes de merge
4. **A11Y Check**: Verificar accesibilidad

## Reglas
- NUNCA escribir código sin tests fallando primero
- NUNCA mencionar "AI" en commits
- SIEMPRE aplicar linter y formatter
```

**Comandos**:
```
/skills list    → muestra skills disponibles por pack
/skills init    → instala skill packs (core, testing, security, a11y, ...)
/skills add     → agrega skill custom desde archivo
```

**Auto-injection en system prompt**:
```typescript
// SessionManager.injectSkills(ctx) llama:
// const skills = skillManager.matchSkills(currentContext);
// systemPrompt += skills.map(s => s.content).join('\n\n');
```

**Verificación**:
```bash
./dist/miura.exe skills init
# → instala core, testing, security, a11y
./dist/miura.exe skills list
# → muestra 5+ skills
cat .miura/skills/core/tdd.md
# → tiene contenido
```

**Entregables**:
- [ ] `SkillManager` plugin
- [ ] 5+ skill files en `.miura/skills/`
- [ ] Context-based matching (triggers por keywords)
- [ ] Auto-injection en system prompt
- [ ] Comandos `/skills list/init/add`
- [ ] `bun test` pasa

**Depende de**: Fase 4 ✅

---

### Fase 6 — Compaction + Context Management (Días 16-17)

**Objetivo**: Manejar context window de forma inteligente sin perder información crítica. **Puede hacerse en paralelo con Fases 3, 4, 5.**

**Archivos a crear**:
```
src/core/
  compaction.ts          # CompactionStrategy interface + implementations
  token-counter.ts      # counting tokens por mensaje
```

**Estrategias**:
```typescript
NoCompaction      // nunca compacta (actual default)
SlidingWindow(n)  // mantener últimos n mensajes
Summarize(n)       // resumir últimos n mensajes en 1
Hybrid(n, ps)      // últimos n + preserve system ← DEFAULT
SafeSplitPoint(inner)  // wrapper: nunca separar tool_use de tool_result
```

**Configuración**:
```yaml
context:
  compaction: hybrid     # default
  keepMessages: 30        # para hybrid/sliding
  tokenBudget: 128000     # hard limit
  toolOutputLimits:      # decisión P1
    read_file: 200       # líneas
    grep: 50              # resultados
    glob: 100             # archivos
```

**SafeSplitPoint** (crítico):
```typescript
// Asegura que nunca se compacta dejando un tool_use sin tool_result
// Busca el último SafeSplitPoint en la historia
// Si lo encuentra, compacta desde ahí para arriba
interface SafeSplitPoint {
  lastToolResultIndex: number;
  tokenCount: number;
}
```

**Verificación**:
```bash
# Crear sesión larga (>30 mensajes)
# → debe compactar automáticamente
# → debe mostrar: "Context compacted: 28 messages → summary (saved 6,200 tokens)"

# Verificar que safe split point funciona
# → mensaje con tool_use + tool_result nunca se corta
./dist/miura.exe chat "use a tool" && ./dist/miura.exe chat "..." (30+ veces)
```

**Entregables**:
- [ ] `CompactionStrategy` interface con 5 implementaciones
- [ ] `Hybrid` como default (30 msgs + preserve system)
- [ ] `SafeSplitPoint` wrapper
- [ ] Token budget enforcement
- [ ] Tool output limits (decision P1 configurable)
- [ ] Evento `session.compacted` cuando compacta
- [ ] `bun test` pasa

**Depende de**: Fase 2 ✅ (puede並行 con 3, 4, 5)

---

### Fase 7 — OpenSpec Integration + MCP Client (Días 18-20)

**Objetivo**: Spec-driven development con formato OpenSpec + consumir herramientas externas via MCP.

**Archivos a crear**:
```
src/plugins/knowledge/openspec/
  index.ts              # OpenSpecManager plugin
  proposal.ts           # ProposalGenerator
  spec.ts               # SpecManager (CRUD)
  design.ts             # DesignWriter
  tasks.ts              # TaskBreakdown
  archiver.ts           # Archiver

src/plugins/integrations/mcp-client/
  index.ts              # MCPClient plugin
  protocol.ts           # MCP protocol implementation
  bridge.ts             # MCP tool calls → MiuraSwarm ToolCall
```

**Estructura de archivos** (dual support para compatibilidad):
```
.miura/
  openspec/
    specs/
      {capability}/
        spec.md
    changes/
      {change-id}/
        proposal.md
        design.md
        tasks.md
        specs/        # spec deltas (diff format)

.openspec/  ← symlink o alias a .miura/openspec
```

**Comandos OpenSpec**:
```
/propose <descripción>  → genera change proposal (proposal.md + design.md + tasks.md + spec deltas)
/continue [id]           → continúa implementación de change abierto
/verify [id]            → valida implementación contra specs
/archive [id]            → archiva change completado a openspec/changes/archive/
/spec list|add|edit      → gestiona capabilities specs
```

**Spec format** (OpenSpec-compatible):
```markdown
# auth-session Specification

## Purpose
Manage user session lifecycle including creation, validation, and expiration.

## Requirements

### Requirement: Session expiration
The system SHALL expire sessions after a configured duration.

#### Scenario: Default session timeout
- GIVEN a user has authenticated
- WHEN 24 hours pass without activity
- THEN invalidate the session token
```

**MCP Client**:
```typescript
// Conecta a MCP servers externos via stdio
// Traduce MCP tool calls → MiuraSwarm ToolCall
// Expone herramientas externas como ToolHandler
// Ejemplo: conectar a filesystem MCP, git MCP, etc.
```

**Per-phase model routing**:
```typescript
const PHASE_MODELS = {
  'sdd-propose':  { provider: 'llama-server', model: 'qwen2.5-coder-7b-q4_k_m' },
  'sdd-spec':     { provider: 'llama-server', model: 'qwen2.5-coder-7b-q4_k_m' },
  'sdd-design':   { provider: 'llama-server', model: 'qwen2.5-coder-7b-q4_k_m' },
  'sdd-apply':    { provider: 'llama-server', model: 'qwen2.5-coder-7b-q4_k_m' },
  'sdd-verify':   { provider: 'llama-server', model: 'qwen2.5-coder-7b-q4_k_m' },
  'scout':        { provider: 'llama-server', model: 'phi-3.5-mini-128k-q4_k_m' },  // chico
  'review':       { provider: 'llama-server', model: 'phi-3.5-mini-128k-q4_k_m' },  // chico
};
```

**Verificación**:
```bash
# Inicializar OpenSpec en proyecto
./dist/miura.exe openspec init

# Crear propuesta
./dist/miura.exe propose "Add remember me checkbox with 30-day sessions"
ls .miura/openspec/changes/add-remember-me/

# Continuar propuesta
./dist/miura.exe continue add-remember-me

# Archive
./dist/miura.exe archive add-remember-me
ls .miura/openspec/changes/archive/
```

**Entregables**:
- [ ] `OpenSpecManager` plugin (Proposal, Spec, Design, Tasks, Archive)
- [ ] Comandos `/propose`, `/continue`, `/verify`, `/archive`, `/spec`
- [ ] Dual `.miura/openspec/` + `.openspec/` support
- [ ] `MCPClient` plugin para consumir herramientas externas
- [ ] Per-phase model routing
- [ ] `bun test` pasa

**Depende de**: Fases 1, 2, 3, 5 ✅

---

### Fase 8 — Go CLI Bridge (Opcional, Futuro)

**Objetivo**: Preparar interfaz JSON-RPC para migrar REPL a Go cuando sea necesario.

**Archivos a crear**:
```
src/cli/
  rpc-bridge.ts         # JSON-RPC sobre stdio
```

**Contrato JSON-RPC**:
```typescript
// stdin: { "jsonrpc": "2.0", "method": "chat.send", "params": {...}, "id": 1 }
// stdout: { "jsonrpc": "2.0", "result": {...}, "id": 1 }

// Methods:
// session.start, session.end
// chat.send, chat.compact
// pipeline.run, pipeline.resume
// brain.init, brain.scan, brain.add, brain.get
// graph.init, graph.search, graph.trace
// tools.list, tools.execute
// llama.start, llama.stop, llama.health, llama.download
```

**Documentar en**:
- `docs/GO-MIGRATION.md` — contrato completo con ejemplos

**Entregables** (opcional):
- [ ] `rpc-bridge.ts` funcional
- [ ] `docs/GO-MIGRATION.md`
- [ ] Bridge test que CLI Go externo puede invocar

**Depende de**: Fases 1-7 ✅

---

### Verificación Final

```bash
# Compilación
bun run build

# Tests
bun test                    # todos pasan

# Binario
./dist/miura.exe status     # responde

# REPL completo
echo "/help\n/model\n/exit" | ./dist/miura.exe

# Local inference
./dist/miura.exe chat "hello"  # streaming output

# Local inference
./dist/miura.exe chat "hello"

# Tests de integración
bun test src/integration/
```

---

### Dependencias Entre Fases

```
Fase 0 ──► Fase 1 ──► Fase 2 ─────────────────────────────────────────► Fase 6
(Bun)      (Llama)     (REPL)                                           (Compaction)
                      │                                                  │
                      ├──► Fase 3 ──► Fase 4 ──► Fase 5                 │
                      │   (Brain)    (Graph)    (Skills)                 │
                      │        │          │          │                    │
                      │        └──────────┴──────────┘                    │
                      │                         │                          │
                      └─────────────────────────┴──────────► Fase 7 ◄─────┘
                      │                         (OpenSpec + MCP)          │
                      └────────────────────────────────────► Fase 8 (opcional)
                                                                   (Go bridge)
```

| # | Pregunta | Decisión | Justificación |
|---|----------|---------|---------------|
| 1 | Streaming en REPL | **ON por defecto, toggle con `/debug`** | Feedback inmediato con modelos locales (15-25 tok/s). Sin streaming parece colgado. Con blessed se renderiza bien. |
| 2 | Diff approval | **Obligatorio para writes/edits, con escape hatch via config** | Modelos Q4_K_M pueden inventar cambios. Escape hatch: `/config set diffApproval false` para usuarios avanzados. |
| 3 | CodeGraph indexing | **Manual con `/graph init`** | Auto-indexing consume minutos + compite por recursos con inferencia. Usuario corre `/graph init` cuando necesita, o automatiza en hook post-checkout. |
| 4 | Brain auto-capture | **Híbrido inteligente** | Auto-capture en commits (workaround, fix), decisiones explícitas oracle. Ofrecer captura en stuck detection. Nunca auto-capture todo. Via `brain_capture_decision()` tool. |
| 5 | MCP client o server | **Client primero** | Consumir herramientas externas (filesystem, git, web) es necesidad inmediata. Server viene después — requiere MiuraSwarm accesible como daemon. |

### 17.1 Modelo de Costo de Tokens

```
Contexto de proyecto típico por turno:

  System prompt (MiuraSwarm + skills + brain): ~4,000 tokens  (24%)
  Chat history (30 mensajes turno completo):  ~8,000 tokens  (48%)
  Tool outputs (read_file, grep results):       ~3,000 tokens  (18%)
  CodeGraph responses:                          ~1,500 tokens  ( 9%)
  Otros:                                           ~200 tokens  ( 1%)
  ───────────────────────────────────────────────────────────────
  Total por turno típico:                       ~16,500 tokens

Con ventana 32K (Qwen2.5-Coder-7B Q4_K_M):
  → ~15,500 tokens de espacio de trabajo
  → ~8-10 turnos antes de compactar
```

**Optimizaciones de eficiencia:**

| Estrategia | Ahorro estimado | Prioridad |
|------------|----------------|-----------|
| **Compaction Hybrid** (30 msgs + preserve system) | +50% espacio de trabajo | ALTA |
| **CodeGraph** (graph_search vs grep+read) | 85% menos tokens en consultas de código | ALTA |
| **Progressive skills** (skill bajo demanda) | -7,200 tokens de entrada | MEDIA |
| **Model selection** (Phi-3.5 para scout/reviewer) | -60% tokens en tareas triviales | ALTA |
| **Tool output limits** (read_file → 200 líneas) | -40% tokens en tool calls | MEDIA |

**Costo real estimado:**

| Escenario | Tokens/día | Costo cloud | Costo local |
|-----------|-----------|-------------|-------------|
| Sin optimizar | 3.3M | ~$3.30/día | $0 + $1.62/mes eléctrico |
| Con CodeGraph + Compact | 1.8M | ~$1.80/día | $0 + $1.62/mes eléctrico |
| **Optimizado (local)** | **~1.2M** | **$0** | **$0 + $1.62/mes eléctrico** |

**60x más barato que cloud** computando costo eléctrico vs. API.

### 17.2 Decisiones Pendientes (requieren validación durante implementación)

| # | Pregunta | Opciones | Notas |
|---|----------|---------|-------|
| P1 | ¿Tool output limits por defecto? | 200 líneas / 500 líneas / ilimitado | Afecta tanto tokens como velocidad |
| P2 | ¿Backup system de Gentle-AI? | Integrar en MiuraSwarm / Solo para proyectos críticos | Complemento al state store |
| P3 | ¿Formato de specs: `.miura/` o `.openspec/`? | Dual support / Solo `.miura/` | OpenSpec compat lo sugiere |