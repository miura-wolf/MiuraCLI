// Type declarations for bun:sqlite native module
// Bun ships these types natively when using Bun runtime

declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options?: { readonly: boolean; create: boolean });

    query<T = Record<string, unknown>>(sql: string): Statement<T>;
    exec(sql: string): void;
    close(): void;

    readonly readable: boolean;
    readonly writable: boolean;
  }

  export interface Statement<T = Record<string, unknown>> {
    get(params?: Record<string, unknown>): T | undefined;
    getOne(params?: Record<string, unknown>): T | undefined | null;
    all(params?: Record<string, unknown>): T[];
    run(params?: Record<string, unknown>): QueryResult;
  }

  export interface QueryResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }
}