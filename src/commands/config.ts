import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { readFile, copyFile } from "fs/promises";
import { select, confirm, input } from "@inquirer/prompts";
import {
  getAllProjects,
  getProject,
  readLockFile,
  updateLockFileContext,
  updateLockFileSynced,
  hashContent,
} from "../lib/projects.js";
import {
  getTemplatePrompts,
  getTemplatePath,
  getVariantFilesForPrompt,
} from "../lib/templates.js";
import type { Project, TemplatePrompt, TemplateContext } from "../types.js";

interface ConfigOptions {
  project?: string;
  list?: boolean;
}

async function askPrompt(prompt: TemplatePrompt, currentValue?: string | number | boolean): Promise<string | boolean> {
  const defaultValue = currentValue !== undefined ? currentValue : prompt.default;

  switch (prompt.type) {
    case "confirm":
      return confirm({
        message: prompt.message,
        default: (defaultValue as boolean) ?? false,
      });
    case "select":
      return select({
        message: prompt.message,
        choices: (prompt.choices ?? []).map(c => ({ name: c, value: c })),
        default: defaultValue as string,
      });
    default:
      return input({
        message: prompt.message,
        default: (defaultValue as string) ?? "",
      });
  }
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  let projects: Project[];

  if (options.project) {
    const project = await getProject(options.project);
    if (!project) {
      console.log(chalk.red(`Project "${options.project}" not found`));
      process.exit(1);
    }
    projects = [project];
  } else {
    projects = await getAllProjects();
  }

  if (projects.length === 0) {
    console.log(chalk.yellow("No projects registered."));
    return;
  }

  if (options.list) {
    await listConfig(projects);
  } else {
    for (const project of projects) {
      await configureProject(project);
    }
  }
}

async function listConfig(projects: Project[]): Promise<void> {
  for (const project of projects) {
    const lockFile = await readLockFile(project.path);
    const prompts = await getTemplatePrompts(project.template);

    console.log(chalk.bold(`\n${project.name}`) + chalk.dim(` (${project.template})`));

    if (!lockFile) {
      console.log(chalk.yellow("  No orb.lock found"));
      continue;
    }

    if (prompts.length === 0) {
      console.log(chalk.dim("  No prompts defined"));
      continue;
    }

    const context = lockFile.context ?? {};
    for (const prompt of prompts) {
      const value = context[prompt.name];
      const displayValue = value !== undefined ? String(value) : chalk.dim("(not set)");
      console.log(`  ${chalk.cyan(prompt.name)}: ${displayValue}`);
    }
  }
  console.log();
}

async function configureProject(project: Project): Promise<void> {
  const lockFile = await readLockFile(project.path);
  if (!lockFile) {
    console.log(chalk.yellow(`No orb.lock found for ${project.name}`));
    return;
  }

  const prompts = await getTemplatePrompts(project.template);
  if (prompts.length === 0) {
    console.log(chalk.yellow(`No prompts defined for template ${project.template}`));
    return;
  }

  console.log(chalk.bold(`\nConfiguring ${project.name} (${project.template})...\n`));

  const currentContext = lockFile.context ?? {};

  // Show current values and let user select which prompts to change
  console.log(chalk.dim("Current configuration:"));
  for (const prompt of prompts) {
    const value = currentContext[prompt.name];
    const displayValue = value !== undefined ? String(value) : chalk.dim("(not set)");
    console.log(`  ${prompt.name}: ${displayValue}`);
  }
  console.log();

  const promptChoices = prompts.map(p => ({
    name: `${p.name}: ${currentContext[p.name] ?? "(not set)"} - ${p.message}`,
    value: p.name,
  }));

  const selectedPrompts = await select({
    message: "Which setting do you want to change?",
    choices: [
      ...promptChoices,
      { name: "All settings", value: "__all__" },
      { name: "Cancel", value: "__cancel__" },
    ],
  });

  if (selectedPrompts === "__cancel__") {
    console.log(chalk.dim("Cancelled."));
    return;
  }

  const promptsToAsk = selectedPrompts === "__all__"
    ? prompts
    : prompts.filter(p => p.name === selectedPrompts);

  const newContext: TemplateContext = {};
  const changedPrompts: string[] = [];

  for (const prompt of promptsToAsk) {
    const oldValue = currentContext[prompt.name];
    const newValue = await askPrompt(prompt, oldValue);
    newContext[prompt.name] = newValue;

    if (oldValue !== newValue) {
      changedPrompts.push(prompt.name);
    }
  }

  if (changedPrompts.length === 0) {
    console.log(chalk.dim("\nNo changes made."));
    return;
  }

  // Update lock file with new context
  await updateLockFileContext(project.path, newContext);
  console.log(`${chalk.green("✓")} Updated orb.lock with new configuration`);

  // Find affected files and sync them
  const fullContext = { ...currentContext, ...newContext };
  const affectedFiles = new Set<string>();

  for (const promptName of changedPrompts) {
    const files = await getVariantFilesForPrompt(project.template, promptName, fullContext);
    for (const file of files) {
      affectedFiles.add(file);
    }
  }

  if (affectedFiles.size === 0) {
    console.log(chalk.dim("No files affected by this change."));
    return;
  }

  console.log(chalk.cyan(`\nFiles affected by this change:`));
  for (const file of affectedFiles) {
    console.log(chalk.dim(`  - ${file}`));
  }

  const shouldSync = await confirm({
    message: "Sync these files now?",
    default: true,
  });

  if (!shouldSync) {
    console.log(chalk.dim("Run 'orb sync --all' later to apply changes."));
    return;
  }

  // Sync affected files
  for (const filename of affectedFiles) {
    const templatePath = await getTemplatePath(filename, project.template, fullContext);
    const projectFilePath = path.join(project.path, filename);

    if (!templatePath) {
      console.log(`  ${chalk.red("✗")} ${filename} - template not found`);
      continue;
    }

    const templateContent = await readFile(templatePath, "utf-8");
    const templateHash = hashContent(templateContent);

    if (existsSync(projectFilePath)) {
      const projectContent = await readFile(projectFilePath, "utf-8");
      const projectHash = hashContent(projectContent);

      if (templateHash === projectHash) {
        console.log(`  ${chalk.dim("⊜")} ${filename} up-to-date`);
        continue;
      }

      // Check if file was modified locally
      const lastSyncedHash = lockFile.synced?.[filename];
      if (lastSyncedHash && projectHash !== lastSyncedHash) {
        const action = await select({
          message: `${filename} was modified locally. What do you want to do?`,
          choices: [
            { name: "Skip (keep local changes)", value: "skip" },
            { name: "Replace (overwrite with template)", value: "replace" },
          ],
        });

        if (action === "skip") {
          console.log(`  ${chalk.dim("⊖")} ${filename} skipped`);
          continue;
        }
      }
    }

    await copyFile(templatePath, projectFilePath);
    await updateLockFileSynced(project.path, filename, templateHash);
    console.log(`  ${chalk.green("✓")} ${filename} updated`);
  }

  console.log(chalk.bold.green("\nDone!"));
}
