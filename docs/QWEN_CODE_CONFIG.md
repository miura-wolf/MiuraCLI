# 🤖 Qwen Code + MiuraSwarm: Configuración de Integración

> **Para**: Qwen Code (asistente de IA)
> **Propósito**: Documentar cómo Qwen Code debe integrarse con MiuraSwarm
> **Audiencia**: Desarrolladores que reinstalan/configuran el entorno

---

## 🎯 Objetivo de la Integración

Qwen Code debe poder:

1. **Ejecutar comandos** en el contexto de MiuraSwarm
2. **Usar herramientas** (glob, grep, read_file, write_file, run_shell_command)
3. **Ejecutar pipelines** de agentes multi-hilo
4. **Rotar API keys** automáticamente ante fallos (429/404)
5. **Fallback entre modelos** si uno falla

---

## 📁 Archivos Críticos

### 1. `C:\Users\<TU_USUARIO>\.qwen\settings.json`

Configuración principal de Qwen Code:

```json
{
  "$version": 4,
  "env": {
    "LLAMA_CPP_API_KEY": "llama.cpp",
    "OPENROUTER_API_KEY": "sk-or-v1-..."
  },
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "engram": {
      "command": "engram",
      "args": ["mcp", "--tools=agent"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  },
  "model": {
    "name": "qwen/qwen3.5-397b-a17b"
  },
  "modelProviders": {
    "openai": [
      {
        "id": "qwen/qwen3.5-397b-a17b",
        "name": "Qwen3.5 397B (Primary)",
        "baseUrl": "https://integrate.api.nvidia.com/v1",
        "envKey": "OPENAI_API_KEY_1"
      },
      {
        "id": "qwen/qwen3.5-397b-a17b-fallback",
        "name": "Qwen3.5 397B (Fallback 1)",
        "baseUrl": "https://integrate.api.nvidia.com/v1",
        "envKey": "OPENAI_API_KEY_2"
      }
      // ... más modelos de fallback
    ]
  },
  "tools": {
    "approvalMode": "yolo"
  }
}
```

### 2. `D:\IA\API_KEYS_FREE_TIERS_IA.txt`

Archivo plano con API keys (formato KEY=VALUE):

```txt
# NVIDIA (múltiples keys para fallback)
OPENAI_API_KEY=nvapi-key1
OPENAI_API_KEY=nvapi-key2
OPENAI_API_KEY=nvapi-key3
OPENAI_API_KEY=nvapi-key4
OPENAI_API_KEY=nvapi-key5
OPENAI_API_KEY=nvapi-key6
OPENAI_API_KEY=nvapi-key7

# Groq
GROQ_API_KEY=gsk_key1
GROQ_API_KEY=gsk_key2

# Gemini (múltiples)
GEMINI_API_KEY=AIzaSy...
GEMINI_API_KEY=AIzaSy...

# Mistral
MISTRAL_API_KEY=key1
MISTRAL_API_KEY=key2
```

### 3. `C:\Users\<TU_USUARIO>\miuraswarm\src\core\api-key-rotator.ts`

Clase que gestiona la rotación automática:

```typescript
export class ApiKeyRotator {
  // Carga keys del archivo
  loadFromEnvFile(content: string): void
  
  // Obtiene key saludable para un proveedor
  getKey(provider: string): ApiKeyEntry | null
  
  // Reporta éxito (mantiene la key)
  reportSuccess(key: string): void
  
  // Reporta fallo (rota a siguiente)
  reportFailure(key: string, statusCode?: number): void
  
  // Estadísticas de salud
  getStats(): Record<string, { total, healthy, totalFailures }>
}
```

### 4. `C:\Users\<TU_USUARIO>\miuraswarm\src\core\model-router.ts`

Enruta solicitudes al modelo disponible más adecuado:

```typescript
export class ModelRouter {
  // Resuelve mejor modelo para un rol
  resolve(role: AgentRole, requiredCapability?: string): ModelRef
  
  // Reporta fallo (para fallback)
  reportFailure(role: AgentRole, model: ModelRef): void
  
  // Obtiene cadena de fallback
  getFallbackChain(role: AgentRole): ModelRef[]
}
```

---

## 🔄 Flujo de Integración

### Paso 1: Cargar API Keys

```typescript
import { initializeGlobalRotator } from './api-key-rotator.js';
import { readFileSync } from 'fs';

const content = readFileSync('D:/IA/API_KEYS_FREE_TIERS_IA.txt', 'utf-8');
const rotator = initializeGlobalRotator(content);
```

### Paso 2: Configurar ModelRouter

```typescript
import { ModelRouter } from './model-router.js';

const router = new ModelRouter({
  defaults: {
    planner: { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-flash' },
    worker: { provider: 'nvidia-nim', model: 'qwen/qwen3-coder-480b' },
    reviewer: { provider: 'nvidia-nim', model: 'z-ai/glm-5.1' },
  },
  fallbacks: {
    planner: [
      { provider: 'nvidia-nim', model: 'z-ai/glm-5.1' },
      { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
    ],
  },
});
```

### Paso 3: Ejecutar Pipeline

```typescript
import { Pipeline } from './pipeline.js';
import { AgentBus } from './agent-bus.js';
import { EventBus } from './event-bus.js';

const eventBus = new EventBus();
const agentBus = new AgentBus(eventBus);
const pipeline = new Pipeline(eventBus);

const result = await pipeline.run({
  input: 'Analiza este código',
  definition: {
    stages: [
      { role: 'scout' },
      { role: 'planner' },
      { role: 'worker' },
      { role: 'reviewer' },
    ],
    maxIterations: 3,
  },
  agentBus,
  modelRouter: router,
  executeAgent: async (role, model, input) => {
    // Ejecutar agente con tool-calling
  },
});
```

---

## 🛠️ Herramientas Disponibles

Qwen Code puede usar estas herramientas a través de MiuraSwarm:

### 1. `glob`

```typescript
{
  name: 'glob',
  description: 'Find files matching a glob pattern',
  parameters: {
    pattern: '**/*.ts',
    path: '.',
  },
}
```

### 2. `grep`

```typescript
{
  name: 'grep',
  description: 'Search file contents using regex',
  parameters: {
    pattern: 'function\\s+\\w+',
    path: './src',
  },
}
```

### 3. `read_file`

```typescript
{
  name: 'read_file',
  description: 'Read file contents',
  parameters: {
    file_path: 'src/core/pipeline.ts',
    offset: 0,
    limit: 100,
  },
}
```

### 4. `write_file`

```typescript
{
  name: 'write_file',
  description: 'Write content to file',
  parameters: {
    file_path: 'src/core/pipeline.ts',
    content: 'export class Pipeline {...}',
  },
}
```

### 5. `run_shell_command`

```typescript
{
  name: 'run_shell_command',
  description: 'Execute shell command (allowlisted)',
  parameters: {
    command: 'npm test',
    args: [],
  },
}
```

---

## 🔧 Comandos Esenciales

### Inicializar MiuraSwarm

```bash
cd C:/Users/<TU_USUARIO>/miuraswarm
npm run init
```

### Ejecutar Tests

```bash
npm test
```

### Build

```bash
npm run build
```

### Herramientas CLI

```bash
# Buscar archivos
npm run tool:glob "**/*.ts"

# Buscar contenido
npm run tool:grep "function" src/

# Pipeline test
npm run pipeline:test
```

---

## 🚨 Solución de Problemas Comunes

### Problema: Qwen Code no reconoce MiuraSwarm

**Síntoma**: Los comandos no se ejecutan en el contexto correcto

**Solución**:
```bash
# 1. Asegurar que estás en la carpeta correcta
cd C:/Users/<TU_USUARIO>/miuraswarm

# 2. Verificar que Qwen Code ve el workspace
# En VS Code: File > Add Folder to Workspace

# 3. Reiniciar Qwen Code
# Command Palette > Qwen Code: Restart
```

### Problema: API Keys no cargan

**Síntoma**: Errores 401/403 en las peticiones

**Solución**:
```bash
# 1. Verificar archivo
Test-Path D:/IA/API_KEYS_FREE_TIERS_IA.txt

# 2. Verificar formato (debe ser KEY=VALUE)
Get-Content D:/IA/API_KEYS_FREE_TIERS_IA.txt | Select-Object -First 5

# 3. Re-ejecutar setup
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# 4. Reiniciar terminal/VS Code
```

### Problema: Rate Limit (429)

**Síntoma**: Error "Too Many Requests"

**Solución**:
```typescript
// El rotador maneja esto automáticamente
// Verificar estado:
import { getGlobalRotator } from './api-key-rotator';

const rotator = getGlobalRotator();
console.log(rotator.getStats());
// Debe mostrar keys saludables

// Si todas fallan, agregar más keys al archivo
```

### Problema: Modelo no disponible (404)

**Síntoma**: Error "Model not found"

**Solución**:
```typescript
// El ModelRouter hace fallback automáticamente
// Verificar cadena de fallback:
const router = new ModelRouter();
console.log(router.getFallbackChain('planner'));
```

---

## 📊 Monitoreo y Debug

### Logs de Event Bus

```typescript
import { EventBus } from './event-bus';

const eventBus = new EventBus();

eventBus.on('pipeline.started', (data) => {
  console.log('Pipeline iniciado:', data);
});

eventBus.on('pipeline.stage', (data) => {
  console.log(`Stage ${data.stage}: ${data.status}`);
});

eventBus.on('pipeline.completed', (data) => {
  console.log('Pipeline completado:', data);
});
```

### Estadísticas de API Keys

```typescript
import { getGlobalRotator } from './api-key-rotator';

const rotator = getGlobalRotator();
const stats = rotator.getStats();

console.table(stats);
/*
Provider  | Total | Healthy | Failures
----------|-------|---------|----------
nvidia    | 7     | 6       | 1
groq      | 2     | 2       | 0
gemini    | 10    | 9       | 1
*/
```

---

## 📝 Checklist de Verificación Rápida

Antes de empezar a trabajar:

```bash
# 1. ¿Estás en la carpeta correcta?
pwd  # Debe ser: C:/Users/<TU_USUARIO>/miuraswarm

# 2. ¿Las dependencias están instaladas?
npm ls --depth=0

# 3. ¿Los tests pasan?
npm test  # Debe mostrar: 38 passed

# 4. ¿El build funciona?
npm run build  # Sin errores

# 5. ¿API keys cargadas?
Test-Path D:/IA/API_KEYS_FREE_TIERS_IA.txt

# 6. ¿Environment configurado?
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
```

---

## 🎓 Buenas Prácticas

### Para Qwen Code:

1. **Siempre trabajar dentro de MiuraSwarm** cuando se usen sus herramientas
2. **Verificar logs** del event-bus para debugging
3. **Usar fallback chain** antes de reportar error de modelo
4. **Rotar keys** automáticamente en fallos
5. **Mantener contexto** entre sesiones (usar engram)

### Para el Usuario:

1. **Mantener actualizado** el archivo de API keys
2. **No compartirlas** en el repositorio (gitignore)
3. **Verificar logs** antes de reportar bugs
4. **Seguir el ROADMAP.md** para prioridades

---

**Documento creado**: 2025-05-14  
**Versión**: 1.0  
**Mantiene**: MiuraSwarm Team + Qwen Code
