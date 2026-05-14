# 🚀 Inicio Rápido - MiuraSwarm + Qwen Code

> **Para**: Nuevas instalaciones o recuperación de desastres  
> **Tiempo**: 10 minutos  
> **Nivel**: Todos

---

## TL;DR - Pasos Rápidos

```bash
# 1. Clonar
git clone https://github.com/<TU_USUARIO>/miuraswarm.git
cd miuraswarm

# 2. Instalar dependencias
npm install

# 3. Cargar API keys (PowerShell como admin)
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# 4. Verificar
npm test
npm run build

# 5. ¡Listo!
```

---

## Requisitos Previos

### 1. Node.js 20+

```bash
# Verificar versión
node --version  # Debe ser v20 o superior

# Si no lo tienes: https://nodejs.org/
```

### 2. Git

```bash
# Verificar instalación
git --version

# Si no: https://git-scm.com/
```

### 3. Archivo de API Keys

Debe existir: `D:/IA/API_KEYS_FREE_TIERS_IA.txt`

Contenido mínimo:
```txt
OPENAI_API_KEY=nvapi-tu_key
GROQ_API_KEY=gsk_tu_key
```

---

## Instalación Paso a Paso

### Paso 1: Clonar Repositorio

```bash
# En tu carpeta de proyectos
cd C:\Users\<TU_USUARIO>\proyectos
git clone https://github.com/<TU_USUARIO>/miuraswarm.git
cd miuraswarm
```

### Paso 2: Instalar Dependencias

```bash
npm install
```

### Paso 3: Configurar Environment

```bash
# PowerShell como Administrador
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# Verificar variables
env:OPENAI_API_KEY_1  # Debe mostrar tu key
env:GROQ_API_KEY      # Debe mostrar tu key
```

### Paso 4: Verificar Instalación

```bash
# Build
npm run build

# Tests
npm test  # Debe mostrar: 38 passed

# Pipeline test
npm run pipeline:test
```

---

## Configurar Qwen Code

### 1. Instalar Extensión

En VS Code:
1. Ir a Extensiones (Ctrl+Shift+X)
2. Buscar "Qwen Code"
3. Instalar

### 2. Configurar MCP Servers

El archivo `C:\Users\<TU_USUARIO>\.qwen\settings.json` debe tener:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "engram": {
      "command": "engram",
      "args": ["mcp", "--tools=agent"]
    }
  }
}
```

### 3. Configurar Model Providers

Agregar al `settings.json`:

```json
{
  "modelProviders": {
    "openai": [
      {
        "id": "qwen/qwen3.5-397b-a17b",
        "baseUrl": "https://integrate.api.nvidia.com/v1",
        "envKey": "OPENAI_API_KEY_1"
      },
      {
        "id": "qwen/qwen3.5-397b-a17b-fallback",
        "baseUrl": "https://integrate.api.nvidia.com/v1",
        "envKey": "OPENAI_API_KEY_2"
      }
    ]
  }
}
```

---

## Primer Uso

### 1. Iniciar MiuraSwarm

```typescript
// En tu código
import { initializeMiuraSwarm } from './src/init.js';

initializeMiuraSwarm('D:/IA/API_KEYS_FREE_TIERS_IA.txt');
```

### 2. Ejecutar Pipeline

```typescript
import { Pipeline } from './src/core/pipeline.js';
import { AgentBus } from './src/core/agent-bus.js';
import { EventBus } from './src/core/event-bus.js';
import { ModelRouter } from './src/core/model-router.js';

const eventBus = new EventBus();
const agentBus = new AgentBus(eventBus);
const modelRouter = new ModelRouter();
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
  modelRouter,
  executeAgent: async (role, model, input) => {
    // Tu lógica de ejecución
    return {
      agentId: 'agent-1',
      output: 'Resultado del análisis',
      exitCode: 0,
      durationMs: 1000,
      tokenUsage: { prompt: 100, completion: 50 },
      model,
    };
  },
});

console.log('Pipeline completado:', result);
```

### 3. Usar Herramientas

```typescript
// Glob
const files = await toolExecutor.execute([
  { name: 'glob', arguments: { pattern: '**/*.ts' } }
]);

// Grep
const matches = await toolExecutor.execute([
  { name: 'grep', arguments: { pattern: 'function', path: './src' } }
]);

// Read file
const content = await toolExecutor.execute([
  { name: 'read_file', arguments: { file_path: 'src/core/pipeline.ts' } }
]);

// Write file
await toolExecutor.execute([
  { 
    name: 'write_file', 
    arguments: { 
      file_path: 'src/test.ts',
      content: 'console.log("Hello!");'
    } 
  }
]);
```

---

## Verificación Rápida

```bash
# Check rápido
npm test              # 38 tests passing
npm run build         # Sin errores
env:OPENAI_API_KEY_1  # Muestra tu key

# Test de herramientas
npm run tool:glob "**/*.ts"
npm run tool:grep "export" src/

# Test de pipeline
npm run pipeline:test
```

---

## Problemas Comunes

### Error: "API key not configured"

```bash
# Re-ejecutar setup
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# Reiniciar terminal/VS Code
```

### Error: "Module not found"

```bash
# Reinstalar dependencias
rm -rf node_modules
npm install
```

### Error: "429 Too Many Requests"

- El rotador cambia automáticamente a otra key
- Si persiste, agrega más keys al archivo `API_KEYS_FREE_TIERS_IA.txt`

---

## Siguientes Pasos

1. **Leer ROADMAP.md** - Hoja de ruta del proyecto
2. **Leer REINTEGRACION.md** - Guía completa de reinstalación
3. **Leer QWEN_CODE_CONFIG.md** - Configuración técnica de Qwen Code
4. **Explorar src/core/** - Código fuente principal

---

## Recursos

- **Documentación completa**: `/docs/`
- **ROADMAP**: `/ROADMAP.md`
- **Tests**: `/test-integration/`
- **Ejemplos**: `/examples/`

---

**¿Listo?** ¡Empieza a codear! 🚀
