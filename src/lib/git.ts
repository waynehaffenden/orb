import { $ } from "bun";

let gitAvailable: boolean | null = null;

export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  try {
    await $`git --version`.quiet();
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

async function runGit<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!(await isGitAvailable())) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function initGit(dir: string): Promise<boolean> {
  return runGit(async () => {
    await $`git init`.cwd(dir).quiet();
    return true;
  }, false);
}

export async function getRemoteUrl(dir: string): Promise<string | undefined> {
  return runGit(async () => {
    const result = await $`git remote get-url origin`.cwd(dir).quiet();
    return result.stdout.toString().trim() || undefined;
  }, undefined);
}

export async function addRemote(dir: string, url: string): Promise<boolean> {
  return runGit(async () => {
    await $`git remote add origin ${url}`.cwd(dir).quiet();
    return true;
  }, false);
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  return runGit(async () => {
    const result = await $`git status --porcelain`.cwd(dir).quiet();
    return result.stdout.toString().trim().length > 0;
  }, false);
}

export async function isGitRepo(dir: string): Promise<boolean> {
  return runGit(async () => {
    await $`git rev-parse --git-dir`.cwd(dir).quiet();
    return true;
  }, false);
}
