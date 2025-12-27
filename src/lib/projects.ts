import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { OrbLock, Project, ProjectsRegistry, TemplateContext } from "../types.js";

const ORB_LOCK_FILENAME = "orb.lock";

const CONFIG_DIR = path.join(homedir(), ".config", "orb");
const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");

async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
}

export async function loadProjects(): Promise<ProjectsRegistry> {
  if (!existsSync(PROJECTS_FILE)) {
    return { projects: [] };
  }
  const content = await readFile(PROJECTS_FILE, "utf-8");
  return JSON.parse(content) as ProjectsRegistry;
}

export async function saveProjects(registry: ProjectsRegistry): Promise<void> {
  await ensureConfigDir();
  await writeFile(PROJECTS_FILE, JSON.stringify(registry, null, 2) + "\n");
}

export async function addProject(project: Project): Promise<void> {
  const registry = await loadProjects();

  const existing = registry.projects.find(p => p.name === project.name);
  if (existing) {
    throw new Error(`Project "${project.name}" already exists`);
  }

  registry.projects.push(project);
  await saveProjects(registry);
}

export async function removeProject(name: string): Promise<boolean> {
  const registry = await loadProjects();
  const index = registry.projects.findIndex(p => p.name === name);

  if (index === -1) {
    return false;
  }

  registry.projects.splice(index, 1);
  await saveProjects(registry);
  return true;
}

export async function getProject(name: string): Promise<Project | undefined> {
  const registry = await loadProjects();
  return registry.projects.find(p => p.name === name);
}

export async function getAllProjects(): Promise<Project[]> {
  const registry = await loadProjects();
  return registry.projects;
}

export function getOrbRoot(): string {
  return CONFIG_DIR;
}

export async function writeLockFile(projectPath: string, data: OrbLock): Promise<void> {
  const filePath = path.join(projectPath, ORB_LOCK_FILENAME);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function readLockFile(projectPath: string): Promise<OrbLock | null> {
  const filePath = path.join(projectPath, ORB_LOCK_FILENAME);
  if (!existsSync(filePath)) {
    return null;
  }
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content) as OrbLock;
}

export async function updateLockFileSynced(
  projectPath: string,
  filename: string,
  hash: string
): Promise<void> {
  const lockFile = await readLockFile(projectPath);
  if (!lockFile) return;

  lockFile.synced = lockFile.synced || {};
  lockFile.synced[filename] = hash;
  await writeLockFile(projectPath, lockFile);
}

export function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex").slice(0, 12);
}

export async function removeLockFileSynced(
  projectPath: string,
  filename: string
): Promise<void> {
  const lockFile = await readLockFile(projectPath);
  if (!lockFile?.synced) return;

  delete lockFile.synced[filename];
  await writeLockFile(projectPath, lockFile);
}

export async function updateLockFileContext(
  projectPath: string,
  newContext: TemplateContext
): Promise<void> {
  const lockFile = await readLockFile(projectPath);
  if (!lockFile) return;

  lockFile.context = { ...lockFile.context, ...newContext };
  await writeLockFile(projectPath, lockFile);
}

export async function updateLockFileVersion(
  projectPath: string,
  version: string
): Promise<void> {
  const lockFile = await readLockFile(projectPath);
  if (!lockFile) return;

  lockFile.version = version;
  await writeLockFile(projectPath, lockFile);
}
