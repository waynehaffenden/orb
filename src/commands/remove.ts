import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { confirm } from "@inquirer/prompts";
import { removeProject, getProject, getProjectByPath } from "../lib/projects.js";

export async function removeCommand(nameOrPath?: string): Promise<void> {
  let project;

  if (nameOrPath) {
    const resolved = path.resolve(nameOrPath);
    if (existsSync(resolved)) {
      project = await getProjectByPath(resolved);
    }
    if (!project) {
      project = await getProject(nameOrPath);
    }
  } else {
    project = await getProjectByPath(path.resolve(process.cwd()));
  }

  if (!project) {
    const label = nameOrPath ?? process.cwd();
    console.log(chalk.red(`Project "${label}" not found`));
    process.exit(1);
  }

  const shouldRemove = await confirm({
    message: `Remove "${project.name}" from registry? (This won't delete the project files)`,
    default: false,
  });

  if (!shouldRemove) {
    console.log(chalk.dim("Cancelled."));
    return;
  }

  const removed = await removeProject(project.name);

  if (removed) {
    console.log(chalk.green(`✓ Removed "${project.name}" from registry`));
    console.log(chalk.dim(`  Note: orb.lock file and project files were not deleted`));
  }
}
