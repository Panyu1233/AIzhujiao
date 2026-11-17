/**
 * Node 24 内置 SQLite 的最小类型声明。
 * 项目仍使用 @types/node 20，未包含 node:sqlite；运行时由 Node 24 提供。
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; open?: boolean });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
