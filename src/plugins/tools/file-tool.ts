import type { Plugin, PluginHostAPI } from '../../core/types.js';
import { ToolHandler, ToolResult } from '../../core/types.js';
import { promises as fs } from 'fs';
import { isAbsolute, resolve } from 'path';
import { spawn as spawnChild } from 'child_process';
import { isIP } from 'node:net';
import { getRuntimeConfig, isCommandAllowed } from '../../config.js';

// Safety: restrict to current working directory and below
function safeJoin(base: string, target: string): string {
  if (isAbsolute(target)) {
    throw new Error('Absolute paths not allowed');
  }
  const baseResolved = resolve(base);
  const full = resolve(baseResolved, target);
  const basePrefix = baseResolved.endsWith('\\') || baseResolved.endsWith('/')
    ? baseResolved
    : `${baseResolved}\\`;
  if (full !== baseResolved && !full.startsWith(basePrefix)) {
    throw new Error('Path traversal not allowed');
  }
  return full;
}

const runtimeConfig = getRuntimeConfig();

function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }

  if (ipVersion === 6) {
    if (host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.startsWith('fe80:')) return true;
    return false;
  }

  return false;
}

function isAllowedWebHost(hostname: string): boolean {
  const allowlist = runtimeConfig.webFetchAllowlist;
  if (allowlist.length === 0) return true;
  const host = hostname.toLowerCase();
  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** read_file tool */
export const readFileTool: ToolHandler = {
  definition: {
    name: 'read_file',
    description: 'Read a text file from disk.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        offset: { type: 'number', default: 0 },
        limit: { type: 'number' },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, offset = 0, limit } = args as { file_path: string; offset?: number; limit?: number };
    const cwd = process.cwd();
    const abs = safeJoin(cwd, file_path);
    const data = await fs.readFile(abs, 'utf-8');
    const lines = data.split(/\r?\n/);
    const slice = lines.slice(offset as number, (offset as number) + (limit ?? lines.length));
    return { name: 'read_file', output: slice.join('\n'), durationMs: 0 };
  },
};

/** write_file tool */
export const writeFileTool: ToolHandler = {
  definition: {
    name: 'write_file',
    description: 'Write content to a file, creating it if needed.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['file_path', 'content'],
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, content } = args as { file_path: string; content: string };
    const cwd = process.cwd();
    const abs = safeJoin(cwd, file_path);
    await fs.writeFile(abs, content, 'utf-8');
    return { name: 'write_file', output: `✅ Wrote ${content.length} bytes to ${file_path}`, durationMs: 0 };
  },
};

/** grep tool – simplified synchronous version */
export const grepTool: ToolHandler = {
  definition: {
    name: 'grep',
    description: 'Search file contents using a regular expression.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', default: '.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { pattern, path = '.' } = args as { pattern: string; path?: string };
    const cwd = process.cwd();
    const absPath = safeJoin(cwd, path);
    const data = await fs.readFile(absPath, 'utf-8');
    const lines = data.split(/\r?\n/);
    const matches = lines.filter(line => line.match(new RegExp(pattern)));
    return { name: 'grep', output: matches.join('\n'), durationMs: 0 };
  },
};

/** glob tool */
export const globTool: ToolHandler = {
  definition: {
    name: 'glob',
    description: 'Find files matching a glob pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', default: '.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { pattern, path = '.' } = args as { pattern: string; path?: string };
    const cwd = process.cwd();
    safeJoin(cwd, path);
    // Use native fs.glob if available (Node 20+), otherwise fallback
    const files = await (fs as any).glob?.(`${pattern}`) ?? [];
    return { name: 'glob', output: files.join('\n'), durationMs: 0 };
  },
};

/** run_shell_command tool (with allowlist for safety) */
export const shellTool: ToolHandler = {
  definition: {
    name: 'run_shell_command',
    description: 'Run a shell command (allowlisted for safety).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { command, args: cmdArgs = [] } = args as { command: string; args?: string[] };

    if (!isCommandAllowed(runtimeConfig.commandPolicy, command, Array.isArray(cmdArgs) ? cmdArgs : [])) {
      return { 
        name: 'run_shell_command', 
        output: `❌ Command not allowed by policy: ${command} ${(cmdArgs ?? []).join(' ')}`.trim(),
        error: 'not allowed', 
        durationMs: 0 
      };
    }

    const proc = spawnChild(command, Array.isArray(cmdArgs) ? cmdArgs : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    return { name: 'run_shell_command', output: output.trim(), durationMs: 0 };
  },
};

/** web_fetch tool */
export const webFetchTool: ToolHandler = {
  definition: {
    name: 'web_fetch',
    description: 'Fetch content from a URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'POST'] },
        body: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { url, method = 'GET', body, headers } = args as { 
      url: string; 
      method?: 'GET' | 'POST'; 
      body?: string; 
      headers?: Record<string, string> 
    };

    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http/https URLs are allowed');
    }
    if (isBlockedHost(parsed.hostname)) {
      throw new Error('Blocked host for security reasons');
    }
    if (!isAllowedWebHost(parsed.hostname)) {
      throw new Error(`Host not allowed by MIURA_WEB_ALLOWLIST: ${parsed.hostname}`);
    }
    
    const response = await fetch(url, {
      method,
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    return { name: 'web_fetch', output: text, durationMs: 0 };
  },
};

// Export the plugin
export const fileToolPlugin: Plugin = {
  manifest: {
    id: 'file-tool',
    name: 'File System Tool Plugin',
    version: '0.1.0',
    type: 'tool',
    capabilities: ['read_file', 'write_file', 'grep', 'glob', 'run_shell_command', 'web_fetch'],
  },
  async initialize(host: PluginHostAPI): Promise<void> {
    const registry = host.getToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);
    registry.register(grepTool);
    registry.register(globTool);
    registry.register(shellTool);
    registry.register(webFetchTool);
  },
};

export default fileToolPlugin;
