import { spawn } from 'node:child_process';

export interface GitRunOptions {
  env?: Record<string, string>;
  stdin?: string;
  /** Exit codes (besides 0) that should not throw. */
  allowExitCodes?: number[];
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(GitError.summarize(result) || `git ${args[0]} failed with exit code ${result.exitCode}`);
    this.name = 'GitError';
  }

  get output(): string {
    return `${this.result.stderr}\n${this.result.stdout}`;
  }

  private static summarize(result: GitResult): string {
    const lines = (result.stderr.trim() || result.stdout.trim())
      .split('\n')
      .map((line) => line.replace(/^(error|fatal|hint):\s*/, '').trim())
      .filter(Boolean);
    return lines.slice(0, 4).join('\n');
  }
}

export interface GitLogger {
  command(cwd: string, args: readonly string[]): void;
  result(result: GitResult, durationMs: number): void;
}

/** Spawns git non-interactively: no terminal prompts, no editors, stable English output. */
export class GitExecutor {
  constructor(
    readonly cwd: string,
    private readonly gitPath: () => string = () => 'git',
    private readonly logger?: GitLogger,
  ) {}

  run(args: readonly string[], options: GitRunOptions = {}): Promise<GitResult> {
    const started = Date.now();
    this.logger?.command(this.cwd, args);
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath(), args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          // Queries (status) must not rewrite the index: watchers would see it as a change.
          GIT_OPTIONAL_LOCKS: '0',
          GIT_EDITOR: 'true',
          GIT_MERGE_AUTOEDIT: 'no',
          LC_ALL: 'C',
          LANGUAGE: 'C',
          ...options.env,
        },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        const result: GitResult = {
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          exitCode: code ?? -1,
        };
        this.logger?.result(result, Date.now() - started);
        if (result.exitCode === 0 || options.allowExitCodes?.includes(result.exitCode)) {
          resolve(result);
        } else {
          reject(new GitError(args, result));
        }
      });
      child.stdin.end(options.stdin ?? '');
    });
  }
}
