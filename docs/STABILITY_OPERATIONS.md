# MiuraSwarm Stability Operations

## Goals Implemented

1. Portable configuration (no hardcoded `D:/...` requirement)
2. Strict tool execution policy for `run_shell_command`
3. Optional domain allowlist for `web_fetch`
4. Structured operational logging + per-pipeline metrics
5. Pipeline checkpoint persistence + resume support
6. Reliable startup cleanup of stale interrupted pipelines

## Configuration

Use these environment variables:

- `MIURA_STATE_DB_PATH`  
  SQLite state file path. Default: `.miura/state.db`

- `API_KEYS_PATH`  
  API key rotator env file path. Default: `.miura/api-keys.env`

- `MIURA_WEB_ALLOWLIST`  
  Comma-separated host allowlist for `web_fetch`, e.g.:
  `MIURA_WEB_ALLOWLIST=docs.python.org,api.github.com`

## Tool Security

`run_shell_command` now validates command + subcommand prefixes against policy in:

- [`src/config.ts`](/C:/Users/carja/miuraswarm/src/config.ts)

`web_fetch` now:

- Allows only `http` / `https`
- Blocks localhost/private networks
- Optionally restricts to `MIURA_WEB_ALLOWLIST` domains

## Observability

Structured logs are emitted as JSON events through:

- [`src/core/observability.ts`](/C:/Users/carja/miuraswarm/src/core/observability.ts)

Key events:

- `agent.spawned`
- `agent.completed`
- `agent.failed`
- `pipeline.checkpoint`
- `pipeline.completed`
- `pipeline.recovered_as_interrupted`

Metrics tracked:

- `success`
- `iterations`
- `stageCount`
- `retries`
- `escalations`
- `latencyMs`

## Resume and Cleanup

Pipeline checkpoints are persisted in `pipeline_progress` with:

- `input`
- `definition`
- `stages`
- `history`
- `status`
- `updated_at`

Resume flow:

1. Call `resumePipeline(pipelineId)` in `MiuraSwarm`
2. Progress is loaded from state store
3. Execution resumes from last checkpointed iteration/stage history

Startup cleanup:

- On `initialize()`, stale `running`/`interrupted` pipelines are marked `interrupted`

## Validation

Validated after implementation with:

- `npm run lint` -> 0 warnings, 0 errors
- `npm run build` -> success
- `npm test` -> all tests passing
