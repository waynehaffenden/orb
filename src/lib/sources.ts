import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { $ } from "bun";
import type { TemplateSource, TemplateManifest } from "../types.js";
import { getOrbRoot } from "./projects.js";

const SOURCES_FILE = path.join(getOrbRoot(), "sources.json");

function getSourcesDir(): string {
  return path.join(getOrbRoot(), "sources");
}

export async function loadSources(): Promise<TemplateSource[]> {
  if (!existsSync(SOURCES_FILE)) {
    return [];
  }
  const content = await readFile(SOURCES_FILE, "utf-8");
  return JSON.parse(content);
}

export async function saveSources(sources: TemplateSource[]): Promise<void> {
  const dir = path.dirname(SOURCES_FILE);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(SOURCES_FILE, JSON.stringify(sources, null, 2) + "\n");
}

export async function getSource(name: string): Promise<TemplateSource | undefined> {
  const sources = await loadSources();
  return sources.find(s => s.name === name);
}

export async function updateSourceHash(name: string, hash: string | null): Promise<void> {
  const sources = await loadSources();
  const source = sources.find(s => s.name === name);
  if (source) {
    source.manifestHash = hash ?? undefined;
    await saveSources(sources);
  }
}

export async function addSource(source: TemplateSource): Promise<void> {
  const sources = await loadSources();

  const existing = sources.find(s => s.name === source.name);
  if (existing) {
    throw new Error(`Source "${source.name}" already exists`);
  }

  sources.push(source);
  await saveSources(sources);
}

export async function removeSource(name: string): Promise<boolean> {
  const sources = await loadSources();
  const index = sources.findIndex(s => s.name === name);

  if (index === -1) {
    return false;
  }

  const source = sources[index]!;

  if (source.type === "git") {
    const sourceDir = path.join(getSourcesDir(), name);
    if (existsSync(sourceDir)) {
      await rm(sourceDir, { recursive: true });
    }
  }

  sources.splice(index, 1);
  await saveSources(sources);
  return true;
}

export function getSourcePath(source: TemplateSource): string {
  if (source.type === "local") {
    return source.path!;
  }
  return path.join(getSourcesDir(), source.name);
}

function getAuthenticatedUrl(url: string): string {
  // Check for GitHub token in environment
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return url;

  // Only apply to HTTPS GitHub URLs
  if (url.startsWith("https://github.com/")) {
    return url.replace("https://github.com/", `https://${token}@github.com/`);
  }

  return url;
}

function isAuthError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase() || "";
  return (
    message.includes("authentication") ||
    message.includes("permission denied") ||
    message.includes("could not read from remote") ||
    message.includes("repository not found") ||
    message.includes("fatal: could not read username")
  );
}

export async function cloneSource(source: TemplateSource): Promise<void> {
  if (source.type !== "git") {
    throw new Error("Can only clone git sources");
  }

  const sourcesDir = getSourcesDir();
  if (!existsSync(sourcesDir)) {
    await mkdir(sourcesDir, { recursive: true });
  }

  const targetDir = path.join(sourcesDir, source.name);
  const url = getAuthenticatedUrl(source.url!);

  const result = source.branch
    ? await $`git clone --depth 1 --branch ${source.branch} ${url} ${targetDir}`.nothrow().quiet()
    : await $`git clone --depth 1 ${url} ${targetDir}`.nothrow().quiet();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    if (isAuthError({ message: stderr })) {
      const isHttps = source.url!.startsWith("https://");
      const hint = isHttps
        ? "For private repos, set GH_TOKEN or GITHUB_TOKEN environment variable, or use SSH URL (git@github.com:...)"
        : "Ensure your SSH key is added to your GitHub account";
      throw new Error(`Authentication failed. ${hint}`);
    }
    throw new Error(`Git clone failed: ${stderr || "Unknown error"}`);
  }
}

export async function updateSource(source: TemplateSource): Promise<boolean> {
  if (source.type === "local") {
    // Local sources are always "updated" - just validate they exist
    const sourcePath = getSourcePath(source);
    return existsSync(sourcePath);
  }

  const sourceDir = path.join(getSourcesDir(), source.name);
  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  // Update remote URL with token if available (for private repos)
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token && source.url?.startsWith("https://github.com/")) {
    const authenticatedUrl = getAuthenticatedUrl(source.url);
    await $`git -C ${sourceDir} remote set-url origin ${authenticatedUrl}`.nothrow().quiet();
  }

  const result = await $`git -C ${sourceDir} pull`.nothrow().quiet();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    if (isAuthError({ message: stderr })) {
      const isHttps = source.url?.startsWith("https://");
      const hint = isHttps
        ? "For private repos, set GH_TOKEN or GITHUB_TOKEN environment variable, or use SSH URL"
        : "Ensure your SSH key is added to your GitHub account";
      throw new Error(`Authentication failed. ${hint}`);
    }
    throw new Error(`Git pull failed: ${stderr || "Unknown error"}`);
  }

  const output = result.stdout.toString();
  return !output.includes("Already up to date");
}

export function validateSourcePath(sourcePath: string): boolean {
  return existsSync(sourcePath);
}

export function detectSourceType(input: string): "git" | "local" {
  if (
    input.startsWith("https://") ||
    input.startsWith("git@") ||
    input.startsWith("git://") ||
    input.endsWith(".git")
  ) {
    return "git";
  }
  return "local";
}

export function extractSourceName(input: string): string {
  if (detectSourceType(input) === "git") {
    const match = input.match(/\/([^/]+?)(\.git)?$/);
    return match?.[1] ?? "templates";
  }
  return path.basename(input);
}

export async function readManifest(sourcePath: string): Promise<TemplateManifest | null> {
  const manifestPath = path.join(sourcePath, "orb.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = await readFile(manifestPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function getManifestHash(sourcePath: string): Promise<string | null> {
  const manifestPath = path.join(sourcePath, "orb.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = await readFile(manifestPath, "utf-8");
    const hasher = new Bun.CryptoHasher("md5");
    hasher.update(content);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

export interface ManifestValidation {
  valid: boolean;
  manifest: TemplateManifest | null;
  error?: string;
}

export async function validateManifest(sourcePath: string): Promise<ManifestValidation> {
  const manifestPath = path.join(sourcePath, "orb.json");

  if (!existsSync(manifestPath)) {
    return { valid: true, manifest: null }; // No manifest is ok
  }

  try {
    const content = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as TemplateManifest;
    return { valid: true, manifest };
  } catch (error) {
    return {
      valid: false,
      manifest: null,
      error: `Invalid orb.json: ${(error as Error).message}`,
    };
  }
}
