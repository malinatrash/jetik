import type { GitRunner } from '../runner';

export class BranchService {
  constructor(private readonly git: GitRunner) {}

  async checkout(revision: string): Promise<void> {
    await this.git.write(['checkout', revision]);
  }

  async checkoutDetached(revision: string): Promise<void> {
    await this.git.write(['checkout', '--detach', revision]);
  }

  /** Creates a local tracking branch for a remote branch and switches to it. */
  async checkoutTracking(localName: string, remoteBranch: string): Promise<void> {
    await this.git.write(['checkout', '-b', localName, '--track', remoteBranch]);
  }

  async create(name: string, startPoint: string, checkout: boolean): Promise<void> {
    const args = checkout ? ['checkout', '-b', name] : ['branch', name];
    await this.git.write([...args, '--no-track', startPoint]);
  }

  async rename(oldName: string, newName: string): Promise<void> {
    await this.git.write(['branch', '-m', oldName, newName]);
  }

  async delete(name: string, force = false): Promise<void> {
    await this.git.write(['branch', force ? '-D' : '-d', name]);
  }

  async deleteRemote(remote: string, branch: string): Promise<void> {
    await this.git.write(['push', remote, '--delete', branch]);
  }

  async merge(revision: string): Promise<void> {
    await this.git.write(['merge', revision]);
  }

  /** Rebases the current branch onto `upstream`. */
  async rebase(upstream: string): Promise<void> {
    await this.git.write(['rebase', '--autostash', upstream]);
  }

  async createTag(name: string, revision: string): Promise<void> {
    await this.git.write(['tag', name, revision]);
  }

  async deleteTag(name: string): Promise<void> {
    await this.git.write(['tag', '-d', name]);
  }
}
