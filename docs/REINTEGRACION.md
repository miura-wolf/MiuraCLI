# 📘 Guía de Reintegración - MiuraSwarm + Qwen Code

> **Propósito**: Este documento permite reconectar Qwen Code con MiuraSwarm después de formatear, cambiar de laptop, o iniciar desde cero.
> 
> **Tiempo estimado**: 15-30 minutos
> 
> **Nivel**: Intermedio (requiere Node.js, Git, PowerShell)

---

## 📋 Tabla de Contenidos

1. [Pre-requisitos](#pre-requisitos)
2. [Paso 1: Instalar Qwen Code](#paso-1-instalar-qwen-code)
3. [Paso 2: Clonar MiuraSwarm](#paso-2-clonar-miuraswarm)
4. [Paso 3: Configurar API Keys](#paso-3-configurar-api-keys)
5. [Paso 4: Inicializar MiuraSwarm](#paso-4-inicializar-miuraswarm)
6. [Paso 5: Verificar Instalación](#paso-5-verificar-instalación)
7. [Solución de Problemas](#solución-de-problemas)
8. [Checklist de Verificación](#checklist-de-verificación)

---

## Pre-requisitos

### Software Requerido
- [ ] **Node.js 20+** instalado ([Descargar](https://nodejs.org/))
- [ ] **Git** instalado ([Descargar](https://git-scm.com/))
- [ ] **PowerShell 7+** (Windows) o terminal equivalente
- [ ] **API Keys** guardadas en `D:/IA/API_KEYS_FREE_TIERS_IA.txt`

### Conocimientos Previos
- Terminal/PowerShell básico
- Variables de entorno
- npm/node packages

---

## Paso 1: Instalar Qwen Code

### 1.1 Instalar Qwen Code en VS Code

```bash
# Abrir VS Code
# Ir a Extensiones (Ctrl+Shift+X)
# Buscar "Qwen Code" e instalar
```

### 1.2 Configurar Qwen Code

```bash
# Crear carpeta si no existe
mkdir C:\Users\<TU_USUARIO>\.qwen

# El settings.json se crea automáticamente al instalar
# Pero verificamos que exista:
code C:\Users\<TU_USUARIO>\.qwen\settings.json
```

### 1.3 Configurar MCP Servers

Qwen Code usa MCP (Model Context Protocol) para herramientas:

```json
// C:\Users\<TU_USUARIO>\.qwen\settings.json
{
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
  }
}
```

---

## Paso 2: Clonar MiuraSwarm

### 2.1 Clonar Repositorio

```bash
# En tu carpeta de proyectos
cd C:\Users\<TU_USUARIO>\proyectos  # o tu ruta preferida
git clone https://github.com/<TU_USUARIO>/miuraswarm.git
cd miuraswarm
```

### 2.2 Instalar Dependencias

```bash
npm install
```

### 2.3 Verificar Instalación

```bash
npm run build
npm test
```

**Debe mostrar**: `38 tests passing`

---

## Paso 3: Configurar API Keys

### 3.1 Verificar Archivo de Keys

El archivo `D:/IA/API_KEYS_FREE_TIERS_IA.txt` debe existir con este formato:

```txt
# NVIDIA Keys (múltiples para fallback)
OPENAI_API_KEY=nvapi-TU_PRIMERA_KEY
OPENAI_API_KEY=nvapi-TU_SEGUNDA_KEY
OPENAI_API_KEY=nvapi-TU_TERCERA_KEY

# Groq
GROQ_API_KEY=gsk_TU_KEY

# Gemini (múltiples)
GEMINI_API_KEY=AIzaSy...
GEMINI_API_KEY=AIzaSy...

# Mistral
MISTRAL_API_KEY=tu_key
```

### 3.2 Ejecutar Script de Setup

```bash
# Desde PowerShell (como Administrador)
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
```

Este script:
- Lee `D:/IA/API_KEYS_FREE_TIERS_IA.txt`
- Extrae las keys de NVIDIA, Groq, Gemini, Mistral
- Las guarda como variables de entorno de usuario
- Configura el fallback automático

### 3.3 Verificar Variables de Entorno

```bash
# PowerShell
env:OPENAI_API_KEY_1
env:GROQ_API_KEY
env:GEMINI_API_KEY_1

# Deben mostrar tus keys (no vacías)
```

---

## Paso 4: Inicializar MiuraSwarm

### 4.1 Inicializar Rotador de Keys

MiuraSwarm tiene un inicializador que carga las keys automáticamente:

```bash
# En la carpeta de MiuraSwarm
npm run init
```

O programáticamente:

```typescript
// En tu código
import { initializeMiuraSwarm } from './src/init.js';

initializeMiuraSwarm('D:/IA/API_KEYS_FREE_TIERS_IA.txt');
```

### 4.2 Configurar ModelRouter

El `ModelRouter` de MiuraSwarm ya viene configurado con:

- **Defaults**: Modelos por defecto para cada rol (planner, worker, reviewer, etc.)
- **Fallbacks**: Cadena de respaldo si el modelo principal falla
- **Capabilities**: Mapeo de capacidades por modelo

```typescript
import { ModelRouter } from './src/core/model-router.js';

const router = new ModelRouter();
const model = router.resolve('planner'); // Resuelve mejor modelo disponible
```

### 4.3 Verificar Rotación de Keys

```typescript
import { getGlobalRotator } from './src/core/api-key-rotator.js';

const rotator = getGlobalRotator();
const stats = rotator.getStats();

console.log('Keys cargadas:', stats);
// Debe mostrar algo como:
// { nvidia: { total: 7, healthy: 7, totalFailures: 0 } }
```

---

## Paso 5: Verificar Instalación

### 5.1 Test de Humo

```bash
npm test
```

**Debe mostrar**:
```
✓ src/core/event-bus.test.ts (7 tests)
✓ src/core/stuck-detector.test.ts (6 tests)
✓ src/core/model-router.test.ts (8 tests)
✓ src/core/task-scheduler.test.ts (7 tests)
✓ src/core/plugin-host.test.ts (5 tests)
✓ src/pi-integration.test.ts (2 tests)
✓ src/test-integration.test.ts (3 tests)

Test Files 7 passed (7)
Tests 38 passed (38)
```

### 5.2 Test de Herramientas

```bash
# Ejecutar herramienta de ejemplo
npm run tool:glob "**/*.ts"
```

### 5.3 Test de Pipeline

```bash
# Ejecutar pipeline de ejemplo
npm run pipeline:test
```

---

## Solución de Problemas

### Error: "API key not configured"

**Causa**: Las variables de entorno no se cargaron

**Solución**:
```bash
# 1. Verificar que el archivo existe
Test-Path D:/IA/API_KEYS_FREE_TIERS_IA.txt

# 2. Re-ejecutar setup
powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1

# 3. Reiniciar terminal/VS Code
```

### Error: "Module not found"

**Causa**: Dependencies no instaladas

**Solución**:
```bash
npm install
npm run build
```

### Error: "429 Too Many Requests"

**Causa**: Rate limit en una API key específica

**Solución**:
- El rotador debería cambiar automáticamente a otra key
- Si persiste, verificar que hayas cargado múltiples keys en el archivo
- Verificar health con `rotator.getStats()`

### Error: "404 Model not found"

**Causa**: El modelo no está disponible en ese proveedor

**Solución**:
- Revisar `src/core/model-router.ts` - capabilities
- El fallback chain debería manejar esto automáticamente

---

## Checklist de Verificación

### Antes de empezar
- [ ] Node.js 20+ instalado
- [ ] Git instalado
- [ ] PowerShell 7+ disponible
- [ ] Archivo `D:/IA/API_KEYS_FREE_TIERS_IA.txt` existe

### Después de la instalación
- [ ] Qwen Code instalado en VS Code
- [ ] MiuraSwarm clonado y `npm install` completado
- [ ] `npm run build` pasa sin errores
- [ ] `npm test` muestra 38 tests passing
- [ ] Variables de entorno cargadas (verificar con `env:OPENAI_API_KEY_1`)
- [ ] MCP servers configurados en `settings.json`

### Después de configurar API Keys
- [ ] Script `setup-env.ps1` ejecutado correctamente
- [ ] Múltiples keys de NVIDIA cargadas (7+)
- [ ] Keys de Groq, Gemini, Mistral cargadas
- [ ] `rotator.getStats()` muestra keys saludables

### Integración con Qwen Code
- [ ] Qwen Code puede ejecutar comandos en MiuraSwarm
- [ ] Tool calling funciona (glob, grep, read_file, write_file)
- [ ] Pipeline se ejecuta completo
- [ ] Fallback entre models funciona

---

## Apéndice A: Estructura de Archivos

```
miuraswarm/
├── src/
│   ├── core/
│   │   ├── api-key-rotator.ts      # Rotación de API keys
│   │   ├── model-router.ts         # Enrutamiento de modelos
│   │   ├── pipeline.ts             # Pipeline de agentes
│   │   ├── agent-bus.ts            # Gestión de agentes
│   │   ├── event-bus.ts            # Sistema de eventos
│   │   └── ...
│   ├── plugins/
│   │   ├── adapters/               # Adapters por proveedor
│   │   │   ├── nvidia-nim/
│   │   │   ├── groq/
│   │   │   ├── openrouter/
│   │   │   └── ...
│   │   └── tools/
│   ├── init.ts                     # Inicializador
│   └── index.ts                    # Entry point
├── scripts/
│   └── setup-env.ps1               # Setup de environment
├── test-integration/               # Tests de integración
├── package.json
├── tsconfig.json
└── ROADMAP.md                      # Hoja de ruta
```

---

## Apéndice B: Comandos Útiles

```bash
# Desarrollo
npm run dev          # Modo desarrollo
npm run build        # Compilar TypeScript
npm test             # Ejecutar tests

# Utilidades
npm run tool:glob <pattern>    # Buscar archivos
npm run tool:grep <pattern>    # Buscar en archivos
npm run pipeline:test          # Test de pipeline

# Environment
npm run init         # Inicializar MiuraSwarm
powershell scripts/setup-env.ps1  # Cargar API keys
```

---

## Apéndice C: Recursos Adicionales

- **Repositorio**: https://github.com/<tu-usuario>/miuraswarm
- **Documentación Qwen Code**: https://qwen-code.dev/docs
- **MCP Specification**: https://modelcontextprotocol.io/
- **NVIDIA NIM Docs**: https://docs.nvidia.com/nim/

---

## Contacto y Soporte

Si algo falla:
1. Revisa este documento sección por sección
2. Verifica el checklist completo
3. Revisa `src/core/event-bus.ts` logs
4. Consulta `ROADMAP.md` para el estado actual

---

**Última actualización**: 2025-05-14
**Versión del documento**: 1.0
**Mantiene**: MiuraSwarm Team
