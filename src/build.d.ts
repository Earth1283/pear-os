declare const __PEAR_BUILD__: { sha: string; date: string; dirty: boolean; builtAt: string }

declare module 'node:child_process' {
  export function execSync(cmd: string, opts?: { stdio?: unknown }): { toString(): string }
}
