import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export interface MiuraRuntimeConfig {
  stateDbPath: string;
  apiKeysPath: string;
  webFetchAllowlist: string[];
  commandPolicy: Record<string, string[][]>;
}

const DEFAULT_COMMAND_POLICY: Record<string, string[][]> = {
  git: [['status'], ['diff'], ['log'], ['show'], ['branch'], ['rev-parse']],
  npm: [['test'], ['run', 'test'], ['run', 'build']],
  node: [['--version']],
  tsc: [[]],
  vitest: [[]],
  ls: [[]],
  cat: [[]],
  echo: [[]],
  pwd: [[]],
  find: [[]],
};

export function getRuntimeConfig(): MiuraRuntimeConfig {
  return {
    stateDbPath: resolve(process.env.MIURA_STATE_DB_PATH ?? '.miura/state.db'),
    apiKeysPath: resolve(process.env.API_KEYS_PATH ?? '.miura/api-keys.env'),
    webFetchAllowlist: parseCsv(process.env.MIURA_WEB_ALLOWLIST),
    commandPolicy: DEFAULT_COMMAND_POLICY,
  };
}

export function isCommandAllowed(
  policy: Record<string, string[][]>,
  command: string,
  args: string[],
): boolean {
  const rules = policy[command];
  if (!rules) return false;
  return rules.some((prefix) => {
    if (prefix.length > args.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== args[i]) return false;
    }
    return true;
  });
}

// === Persistent config file (.miura/config.json) ===

const CONFIG_PATH = resolve('.miura', 'config.json');

export function loadConfigFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfigFile(config: Record<string, unknown>): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function getConfigValue(key: string): unknown {
  const config = loadConfigFile();
  const keys = key.split('.');
  let value: unknown = config;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[k];
  }
  return value;
}

export function setConfigValue(key: string, value: unknown): void {
  const config = loadConfigFile();
  const keys = key.split('.');
  let target = config as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    if (target[keys[i]] === undefined || typeof target[keys[i]] !== 'object') {
      target[keys[i]] = {};
    }
    target = target[keys[i]] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]] = value;
  saveConfigFile(config);
}
