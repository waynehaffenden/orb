import chalk from "chalk";
import path from "path";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { addProject, readLockFile, getAllProjects } from "../lib/projects.js";
import { getRemoteUrl, isGitRepo } from "../lib/git.js";

const SKIP_DIRS = new Set(["node_modules", ".git"]);

async function* walkDirectories(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    yield fullPath;
    yield* walkDirectories(fullPath);
  }
}

export async function scanCommand(scanPath?: string): Promise<void> {
  const searchPath = path.resolve(scanPath || process.cwd());

  if (!existsSync(searchPath)) {
    console.log(chalk.red(`Path does not exist: ${searchPath}`));
    process.exit(1);
  }

  console.log(chalk.bold(`\nScanning for orb.lock projects in ${searchPath}...\n`));

  const existingProjects = await getAllProjects();
  const existingPaths = new Set(existingProjects.map(p => p.path));

  let found = 0;
  let added = 0;
  let skipped = 0;

  for await (const projectPath of walkDirectories(searchPath)) {
    const lockFile = await readLockFile(projectPath);

    if (!lockFile) continue;

    found++;
    const name = path.relative(searchPath, projectPath);

    if (existingPaths.has(projectPath)) {
      console.log(chalk.dim(`  ⊜ ${name} (already registered)`));
      skipped++;
      continue;
    }

    let remote: string | undefined;
    if (await isGitRepo(projectPath)) {
      remote = await getRemoteUrl(projectPath);
    }

    try {
      await addProject({
        name: path.basename(projectPath),
        path: projectPath,
        remote,
        template: lockFile.template,
        created: lockFile.created,
      });
      console.log(chalk.green(`  ✓ ${name}`));
      added++;
    } catch (error) {
      console.log(chalk.red(`  ✗ ${name}: ${(error as Error).message}`));
    }
  }

  console.log(
    chalk.dim(`\nFound ${found} projects, added ${added}, skipped ${skipped} (already registered).`)
  );
}
