# MiuraSwarm — Roadmap al Siguiente Nivel

> Estado actual: **Tool‑calling implementado, ReAct loop COMPLETADO, 33 tests pasando**

---

## ✅ Lo que YA está implementado

### Core Engine
- [x] **EventBus** — sistema de eventos pub/sub
- [x] **PluginHost** — registro y ciclo de vida de plugins (adapter, agent, memory, integration, knowledge, ui, **tool**)
- [x] **AgentBus** — spawn de agentes con heartbeat, timeout, kill
- [x] **TaskScheduler** — cola de tareas con prioridad y pace control
- [x] **Pipeline** — ejecución secuencial de stages
- [x] **ModelRouter** — routing cloud‑first con fallbacks y escalación por fallos
- [x] **StuckDetector** — detección de loops (error, revisión, repetición, monólogo)
- [x] **SqliteStateStore** — persistencia SQLite de tareas, sesiones, eventos

### Tool‑Calling (NUEVO)
- [x] **ToolRegistry** — registro, listado y ejecución de herramientas
- [x] **ToolExecutor** — ejecuta `ToolCall[]` y devuelve `ToolResult[]`
- [x] **Tipos ampliados** — `PluginType: 'tool'`, `LLMMessage.role: 'tool'`, `AgentResult.toolCalls`, `AgentResult.toolResults`, `ToolHandler`, `ToolResult`
- [x] **PluginHost.getToolRegistry()** — acceso al registry desde cualquier plugin
- [x] **Plugin de herramientas** (`file-tool.ts`) — 6 herramientas:
  - `read_file` — leer archivos (con safe‑join, sin path traversal)
  - `write_file` — escribir archivos
  - `grep` — búsqueda con regex
  - `glob` — búsqueda por patrón
  - `run_shell_command` — ejecutar comandos (allowlist: ls, cat, echo, pwd, find, git, npm, npx, pip, python, node, tsc, vitest)
  - `web_fetch` — fetch HTTP
- [x] **ReAct loop** en `MiuraSwarm.runAgent()` — itera: LLM → toolCalls → ejecución → feedback → LLM
  - ✅ Tracking de duración total (acumula `durationMs`)
  - ✅ Tracking de tokens (suma prompt + completion de cada iteración)
  - ✅ Límite de tokens totales (corta si excede budget)
  - ✅ Manejo de errores por tool (el loop continúa)
  - ✅ Escape de iteraciones (corta loop infinito a 25 iteraciones)
  - ✅ Tool call streaming (evento `agent.toolCalled`)

### Adapters (11 providers)
- [x] **NvidiaNimAdapter** — 129+ modelos gratis
- [x] **OpenRouterAdapter** — 29+ modelos free (con tool‑calling)
- [x] **GroqAdapter** — ultra‑rápido
- [x] **GoogleAIAdapter** — Gemini 2.5
- [x] **CerebrasAdapter** — rápido
- [x] **ZyphraAdapter** — ZAYA1-8B
- [x] **CohereAdapter** — v2
- [x] **SambaNovaAdapter**
- [x] **MistralAdapter**
- [x] **ClaudeAdapter** — legacy
- [x] **OllamaAdapter** — local

### Model Routing (cloud‑first)
| Rol | Primario | Fallbacks |
|-----|----------|-----------|
| planner | DeepSeek-V4-Flash | GLM-5.1 → MiniMax-M2.7 → OR/qwen3-coder → Groq |
| worker | Qwen3-Coder-480B | DeepSeek-V4-Pro → Kimi-K2.6 → OR/qwen3-coder → Qwen3.5-397B |
| researcher | DeepSeek-V4-Pro | V4-Flash → GLM-5.1 → OR/nemotron-120b |
| reviewer | GLM-5.1 (754B MoE) | V4-Flash → MiniMax → Groq |
| scout | Groq/Llama-3.3-70b | Groq/Qwen3-32b → Cerebras → Gemma-4 |
| oracle | DeepSeek-V4-Pro | GLM-5.1 → MiniMax → OR/Hermes-405b |
| delegate | Gemma-4-31B (multimodal) | Groq/llama → Zyphra/ZAYA → Cerebras |
| context‑builder | MiniMax-M2.7 | V4-Flash → GLM-5.1 |

### Testing
- [x] 33 tests pasando (5 test files)
- [x] Tests de: EventBus, PluginHost, ModelRouter, StuckDetector, TaskScheduler

---

## 🔴 P0 — CRÍTICO (sin esto no vuela)

### 1. Adaptar TODOS los adapters para tool‑calling
- [ ] **OpenRouterAdapter** — ✅ ya hecho
- [ ] **NvidiaNimAdapter** — pasar `tools` en body, parsear `tool_calls` en respuesta
- [ ] **GroqAdapter** — igual (API compatible con OpenAI)
- [ ] **GoogleAIAdapter** — formato diferente (contents/parts), requiere adaptación
- [ ] **CerebrasAdapter** — OpenAI‑compatible
- [ ] **ZyphraAdapter** — verificar si soporta tools
- [ ] **CohereAdapter** — v2 chat/completions, OpenAI‑compatible
- [ ] **SambaNovaAdapter** — verificar
- [ ] **MistralAdapter** — OpenAI‑compatible
- [ ] **ClaudeAdapter** — requiere Anthropic Messages API (tools nativo)
- [ ] **OllamaAdapter** — pasar `tools` en body

### 2. Completar el ReAct loop ✅ COMPLETADO

- [x] **Seguimiento de duración total** — acumula `durationMs` desde `startTime` hasta el final
- [x] **Seguimiento de tokens** — suma `tokenUsage.prompt` + `tokenUsage.completion` de cada iteración
- [x] **Límite de tokens totales** — `maxTotalTokens = cfg.maxTokens ?? 50000`
- [x] **Manejo de errores por tool** — `registry.execute()` maneja errores internamente, el loop continúa
- [x] **Escape de iteraciones** — `maxIterations = 25`, con check final de `iteration >= maxIterations`
- [x] **Tool call streaming** — evento `agent.toolCalled` emitido por cada tool ejecutado

### 3. Pipeline paralelo
- [ ] **`StageConfig.parallelWith?: string[]`** — stages que pueden correr en paralelo
- [ ] **Pipeline DAG** — construir grafo de dependencias, ejecutar con `Promise.all`
- [ ] **Merge de resultados** — combinar outputs de stages paralelos

### 4. AgentBus concurrente
- [ ] **`spawnBatch(configs)`** — lanzar múltiples agentes en paralelo
- [ ] **Concurrency limiter** — respetar `PaceConfig.maxConcurrent`
- [ ] **Cancel‑on‑failure** — si un agente falla, ¿matar los demás?

---

## 🟡 P1 — AGILIDAD

### 5. TaskScheduler conectado al execution flow
- [ ] **`MiuraSwarm.submitTask(input, type)`** — crear tarea, scheduler la despacha
- [ ] **Scheduler como entry point** — no llamar `runAgent` directamente
- [ ] **Wire `markCompleted` / `markFailed`** — en el execution path

### 6. Mejoras en herramientas
- [ ] **`edit` tool** — editar partes de un archivo (no full rewrite)
- [ ] **`ls` tool** — listar directorios
- [ ] **`move_file` / `copy_file` / `delete_file`** — operaciones de fs
- [ ] **`search_code`** — búsqueda semántica (embedding + vector store)
- [ ] **`ask_user`** — pausar y preguntar al usuario
- [ ] **`run_tests`** — wrapper para `npm test` / `pytest` con parsing de resultados

### 7. Sandboxing real
- [ ] **Path allowlist** — restringir a directorios específicos
- [ ] **Command allowlist configurable** — desde `.miura/config.json`
- [ ] **Dry‑run mode** — mostrar qué se ejecutaría sin hacerlo
- [ ] **Confirmation gate** — para comandos destructivos (rm, delete, etc.)

---

## 🟢 P2 — OBSERVABILIDAD Y UX

### 8. Eventos de tool calls
- [ ] **`tool.called`** — `{ name, args, timestamp }`
- [ ] **`tool.completed`** — `{ name, output, durationMs }`
- [ ] **`tool.failed`** — `{ name, error, durationMs }`
- [ ] **EventMap actualizado** — añadir tipos al `EventMap`

### 9. Streaming al usuario
- [ ] **Streaming de tool calls** — mostrar en vivo qué tool se está ejecutando
- [ ] **Streaming de output del LLM** — mostrar tokens mientras llegan
- [ ] **CLI interactivo** — `miura run` con output en tiempo real

### 10. Token budget / cost tracking
- [ ] **Límite de tokens por tool call** — evitar que tool results exploten el context window
- [ ] **Límite de tool calls por ejecución** — máximo 50 calls
- [ ] **Cost tracking** — estimar costo por modelo (cuando aplique)

---

## 🔵 P3 — AGENTES MÁS INTELIGENTES

### 11. Actualizar prompts de agentes para tool use
- [ ] **Planner** — "usá `glob` y `grep` para explorar el codebase antes de planificar"
- [ ] **Worker** — "usá `read_file` para entender, `edit`/`write_file` para cambiar, `run_shell_command` para testear"
- [ ] **Reviewer** — "usá `run_shell_command` para correr lint/tests, `read_file` para revisar"
- [ ] **Scout** — "usá `grep` y `glob` para búsquedas rápidas"
- [ ] **Oracle** — "usá `web_fetch` para investigar, `grep` para buscar en el codebase"
- [ ] **Delegate** — "analizá qué herramientas necesita cada sub‑tarea"

### 12. AgentResult.artifacts poblado
- [ ] Guardar diffs de archivos modificados
- [ ] Guardar paths de archivos creados
- [ ] Guardar output de tests

### 13. Memoria entre ejecuciones
- [ ] **Engram integration** — guardar decisiones, bugs, patrones
- [ ] **Context compression** — resumir conversaciones largas antes de seguir

---

## ⚪ P4 — INFRAESTRUCTURA

### 14. Tests para tool‑calling
- [ ] **ToolRegistry.test.ts** — register, list, execute, duplicate error
- [ ] **ToolExecutor.test.ts** — execute calls, error handling
- [ ] **ReAct loop test** — mock adapter que devuelve toolCalls
- [ ] **file-tool.test.ts** — read_file, write_file, safe‑join, path traversal rejection

### 15. Build / CI
- [ ] **GitHub Actions** — build + test en cada push
- [ ] **Pre‑commit hooks** — lint + test antes de commitear

### 16. Documentación
- [ ] **README.md** actualizado con tool‑calling
- [ ] **API docs** — JSDoc en todas las funciones públicas
- [ ] **Ejemplos** — cómo crear un tool plugin, cómo correr un pipeline con tools

---

## 📐 Arquitectura actual (para referencia)

```
src/
├── core/
│   ├── types.ts           ← tipos compartidos (ToolHandler, ToolResult, etc.)
│   ├── event-bus.ts       ← pub/sub
│   ├── plugin-host.ts     ← registro de plugins + ToolRegistry
│   ├── agent-bus.ts       ← spawn de agentes
│   ├── pipeline.ts        ← ejecución de stages
│   ├── task-scheduler.ts  ← cola de tareas
│   ├── model-router.ts    ← routing cloud‑first
│   ├── stuck-detector.ts  ← detección de loops
│   ├── tool-registry.ts   ← NUEVO: registro y ejecución de tools
│   └── tool-executor.ts   ← NUEVO: ejecuta ToolCall[]
├── plugins/
│   ├── agents/            ← 8 agentes (planner, worker, etc.)
│   ├── adapters/          ← 11 adapters LLM
│   ├── tools/
│   │   └── file-tool.ts   ← NUEVO: 6 herramientas de filesystem
│   ├── memory/
│   │   └── sqlite-state/  ← persistencia SQLite
│   └── integrations/
│       └── engram-reader/ ← integración con Engram
├── index.ts               ← entry point + ReAct loop
├── env.ts                 ← loader de .env
└── cli/                   ← CLI commands (status, etc.)
```

---

## 🎯 Próximo paso recomendado

**Terminar el ReAct loop** (P0 #2) y **adaptar NvidiaNimAdapter + GroqAdapter** (P0 #1) — son los que más se van a usar. Con eso ya podés hacer una prueba real: mandarle un mensaje a un agente y que lea/escriba archivos.

Después: **Pipeline paralelo** (P0 #3) para que planner + worker + reviewer corran en simultáneo.

---

> Documento generado el 2026-05-13. Última actualización: tool‑calling + ReAct loop implementados.