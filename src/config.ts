import { resolve } from 'node:path';

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
