import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { removeProject, getProject } from "../lib/projects.js";

export async function removeCommand(name: string): Promise<void> {
  const project = await getProject(name);

  if (!project) {
    console.log(chalk.red(`Project "${name}" not found`));
    process.exit(1);
  }

  const shouldRemove = await confirm({
    message: `Remove "${name}" from registry? (This won't delete the project files)`,
    default: false,
  });

  if (!shouldRemove) {
    console.log(chalk.dim("Cancelled."));
    return;
  }

  const removed = await removeProject(name);

  if (removed) {
    console.log(chalk.green(`✓ Removed "${name}" from registry`));
    console.log(chalk.dim(`  Note: orb.lock file and project files were not deleted`));
  }
}
