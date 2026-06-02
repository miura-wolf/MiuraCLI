# Roadmap: MiuraSwarm → "Mi propio Claude Code"

> **Estado**: Propuesta para revisión
> **Fecha**: 2026-06-01
> **Objetivo**: Convertir MiuraSwarm de orquestador multi-agente en un **coding agent harness interactivo estilo Claude Code**, local-first (llama.cpp) con fallback cloud.
> **Norte**: La experiencia interactiva (REPL + loop ReAct con tools fiables + streaming + edición/aprobación + contexto del proyecto) importa más que el swarm/pipeline.

---

## 1. Estado actual (lo que YA funciona)

Auditado el 2026-06-01: **334 tests pasan, typecheck limpio**. La estructura está ~70% lista.

- ✅ Arquitectura de plugins (adapters, agents, tools, knowledge, memory, integrations)
- ✅ 13 adapters LLM incl. `llama-server` local + `ollama`
- ✅ REPL con `CommandRegistry` (~19 /commands)
- ✅ Loop ReAct (`index.ts::runAgent`, máx 25 iteraciones, budget de tokens)
- ✅ Tools: `read_file`, `write_file`, `grep`, `glob`, `run_shell_command`, `web_fetch`
- ✅ Brain (memoria por proyecto), GraphIndexer (tree-sitter), Skills, OpenSpec, MCP-client
- ✅ Estrategias de compaction, estado en SQLite
- ✅ **Reparado esta sesión**: wasm de tree-sitter en binario Bun; extracción de texto robusta en adapter NIM

---

## 2. Las 5 grietas que lo separan de Claude Code

Verificadas en código (no son hipótesis):

| # | Grieta | Síntoma para el usuario | Ubicación |
|---|--------|-------------------------|-----------|
| 1 | **El loop aplana las tool calls a texto** — no usa protocolo OpenAI (`assistant.tool_calls` + `tool.tool_call_id`). El adapter manda solo `{role, content}`. | El agente "se olvida" qué herramienta llamó; multi-paso poco fiable. | `index.ts:393, 426-434`; `nvidia-nim/index.ts` `messages.map` |
| 2 | **No hay `edit_file` quirúrgico** (old→new). Solo `write_file` (reescribe entero). | Modelos chicos corrompen archivos al reescribir. | `file-tool.ts` |
| 3 | **diff-approval y streaming existen pero NO están en el loop** — solo como toggles `/commands`. | Writes sin confirmación; sin streaming en vivo. | `index.ts:410`; `core/diff-approval.ts`, `core/streaming-service.ts` |
| 4 | **System prompt estático** — sin cwd, git, árbol, CLAUDE.md, brain, skills. | El agente está "ciego" al proyecto. | `chat/index.ts:60`; `index.ts:364` |
| 5 | **Modelo default del chat = nemotron reasoning 49B** | Lento/verboso para chat interactivo. | `model-router.ts` |

**Orden de ataque**: arriba → abajo. La #1 desbloquea todo lo demás.

---

## 3. Roadmap por fases

### Fase A — Núcleo del agente (la base) ⭐ PRIORIDAD

**Objetivo**: que el uso de herramientas multi-paso sea fiable y seguro. Sin esto, lo demás no luce.

**A.1 — Protocolo de tool-calling real (grieta #1)**
- `types.ts`: extender `ToolCall` con `id: string`; extender `LLMMessage` con `toolCalls?` (en assistant) y `toolCallId?` (en tool).
- Adapters OpenAI-compatibles (`nvidia-nim`, `groq`, `openrouter`, `ollama`, `llama-server`...): en `messages.map`, emitir `tool_calls` en mensajes assistant y `tool_call_id` en mensajes tool. Parsear `id` de la respuesta.
- `index.ts::runAgent`: en vez de `chat.push({role:"assistant", content: output})`, empujar el turno assistant **con sus `tool_calls`**, y cada resultado como `{role:"tool", toolCallId, content}`.
- **Verificación**: test que simule 2 tool calls encadenadas y verifique que el 2º prompt contiene `tool_calls`+`tool_call_id` bien formados. Manual: `"lee package.json y decime las deps"` → 1 read + respuesta coherente.
- **Riesgo**: medio (toca todos los adapters). Mitigación: helper compartido `toOpenAIMessages()`.

**A.2 — Tool `edit_file` quirúrgico (grieta #2)**
- Nuevo tool en `file-tool.ts`: `edit_file(file_path, old_string, new_string, replace_all?)`. Match exacto; error si `old_string` no es único (salvo `replace_all`). Devuelve diff.
- Registrar en `tool-registry`; añadir al system prompt del chat agent.
- **Verificación**: test de edición puntual + caso de no-unicidad que falla limpio. Manual: pedir cambiar una función sin reescribir el archivo.
- **Riesgo**: bajo.

**A.3 — Gate de aprobación en el loop (grieta #3, parte 1)**
- `index.ts::runAgent`: antes de ejecutar tools mutantes (`write_file`, `edit_file`, `run_shell_command`), pasar por `getDiffApprovalService()`. Respetar modos `prompt | auto-approve | reject`.
- Inyectar un callback de aprobación desde el REPL (para `y/n/e`).
- **Verificación**: test con mode `reject` (no escribe) y `auto-approve` (escribe). Manual: `write_file` pausa y pide confirmación.
- **Riesgo**: medio (acopla loop ↔ REPL; usar callback inyectado, no import directo).

**Entregable Fase A**: agente que usa tools en cadena de forma fiable, edita con precisión y pide permiso antes de tocar disco. `bun test` verde.

---

### Fase B — Sentidos del agente

**Objetivo**: que el agente "vea" el proyecto, como Claude Code.

**B.1 — Inyección de contexto dinámico (grieta #4)**
- Nuevo `ContextBuilder` (o en `runAgent`): construir el system prompt = base estática + bloque de entorno (cwd, OS, fecha, branch + `git status` corto) + árbol de archivos (top N, respetando `.gitignore`) + `CLAUDE.md`/`.miura/*.md` si existen + `brain.getContext()` + skills que matcheen el input.
- **Verificación**: `/debug` muestra el system prompt armado; test de que incluye cwd y git branch. Manual: `"¿en qué carpeta estoy y qué cambié?"` responde sin tools.
- **Riesgo**: bajo-medio (cuidar tamaño → respetar token budget / límites).

**B.2 — Modelo default sensato (grieta #5)**
- `model-router.ts`: default de `chat`/`worker` → coder (`qwen2.5-coder-7b` local primero, cloud fallback) en vez de nemotron reasoning.
- **Verificación**: `/model` muestra el coder como default de chat. Manual: respuestas más rápidas/directas.
- **Riesgo**: bajo (config).

---

### Fase C — Experiencia (streaming)

**Objetivo**: que "se sienta" como Claude Code.

**C.1 — Streaming de tokens + tool calls en vivo (grieta #3, parte 2)**
- Conectar `streaming-service` al loop: en la iteración final (sin tool calls) usar `adapter.stream()` y renderizar tokens en vivo.
- Mostrar líneas tipo `⏺ glob("**/*.ts")` / `⎿ 42 archivos` mientras se ejecutan (ya hay evento `agent.toolCalled`).
- **Verificación**: manual (visual). Test: el servicio recibe chunks.
- **Riesgo**: medio (stream + tool-calling conviven; muchos modelos no streamean tool_calls — usar stream solo en turno final de texto).

---

### Fase D — Robustez y extras (incremental)

- **D.1** Límites de output por tool (`read_file` 200 líneas, `grep` 50, etc.) — ADR §18.1. Evita reventar el context.
- **D.2** Reintento/reparación de `arguments` de tool malformados (modelos chicos).
- **D.3** `/resume` y persistencia de sesión completa (mensajes con tool_calls).
- **D.4** Sub-agentes desde el chat (delegar exploración a `scout`/`context-builder`).
- **D.5** Truncado/sanitizado de salidas de `run_shell_command`.

---

## 4. Tabla de paridad con Claude Code

| Capacidad Claude Code | MiuraSwarm hoy | Fase |
|-----------------------|----------------|------|
| Tool use multi-paso fiable | ⚠️ aplanado a texto | A.1 |
| Edit quirúrgico de archivos | ❌ solo write completo | A.2 |
| Aprobación antes de escribir/ejecutar | ⚠️ existe, sin conectar | A.3 |
| Contexto del proyecto (cwd/git/tree/CLAUDE.md) | ❌ prompt estático | B.1 |
| Modelo apto para coding | ⚠️ reasoning 49B | B.2 |
| Streaming en vivo | ⚠️ existe, sin conectar | C.1 |
| Memoria persistente | ✅ Brain | — |
| Índice de código | ✅ GraphIndexer | — |
| Skills/progressive disclosure | ✅ SkillManager | — |
| MCP (consumir tools externas) | ✅ MCPClient | — |
| Inferencia local | ✅ llama-server | — |

---

## 5. Decisiones abiertas (para vos)

1. **Adapters a migrar al protocolo de tools en Fase A.1**: ¿todos a la vez, o empezamos por los 2-3 que usás (nvidia-nim, groq, llama-server) y el resto después?
2. **Modelo default de chat (B.2)**: ¿`qwen2.5-coder-7b` local primero, o un coder cloud (groq) por velocidad mientras no tengas el llama-server siempre arriba?
3. **Aprobación (A.3)**: ¿default `prompt` (pregunta siempre) o `auto-approve` con `/diff` para revisar? Claude Code pregunta por defecto.
4. **Alcance**: ¿hacemos Fase A completa primero (recomendado) o querés ver A.1 funcionando antes de seguir?

---

## 6. Recomendación

Empezar por **Fase A completa** (A.1 → A.2 → A.3). Es ~el 60% del "feeling" de Claude Code y desbloquea B y C. Cada sub-fase es verificable con tests + una prueba manual. Una vez aprobado este roadmap, armo el plan de implementación detallado de A.1.
