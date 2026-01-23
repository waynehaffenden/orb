import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { input, confirm } from "@inquirer/prompts";
import { addProject, writeLockFile, hashContent } from "../lib/projects.js";
import {
  copyAllTemplates,
  getCurrentSourceName,
  getCurrentSourceVersion,
  getMergedTemplateFiles,
  getTemplateContent,
  getTemplatePrompts,
  getTemplateCommands,
  executeTemplateCommands,
  templateExists,
} from "../lib/templates.js";
import { initGit, addRemote, isGitAvailable } from "../lib/git.js";
import { selectTemplate, askPrompt } from "../lib/prompts.js";
import type { TemplateContext } from "../types.js";

interface InitOptions {
  runCommands?: boolean;
}

export async function initCommand(
  projectNameArg?: string,
  templateArg?: string,
  options: InitOptions = {}
): Promise<void> {
  const projectName =
    projectNameArg ||
    (await input({
      message: "Project name:",
    }));

  if (!projectName) {
    console.log(chalk.red("Project name is required"));
    process.exit(1);
  }

  console.log(chalk.bold(`\nCreating project: ${projectName}\n`));

  let template: string;
  if (templateArg) {
    if (!(await templateExists(templateArg))) {
      console.log(chalk.red(`Template "${templateArg}" not found`));
      process.exit(1);
    }
    template = templateArg;
  } else {
    template = await selectTemplate();
  }

  const projectPath = path.join(process.cwd(), projectName);

  if (existsSync(projectPath)) {
    console.log(chalk.red(`\nError: Directory already exists: ${projectPath}`));
    process.exit(1);
  }

  const prompts = await getTemplatePrompts(template);
  const context: TemplateContext = {
    projectName,
    template,
    year: new Date().getFullYear(),
  };

  for (const prompt of prompts) {
    context[prompt.name] = await askPrompt(prompt);
  }

  const gitAvailable = await isGitAvailable();
  let initGitRepo = false;

  if (gitAvailable) {
    initGitRepo = await confirm({
      message: "Initialize git repository?",
      default: true,
    });
  } else {
    console.log(chalk.yellow("Warning: git not available, skipping git initialization"));
  }

  console.log(chalk.dim("\nCreating project...\n"));

  await mkdir(projectPath, { recursive: true });
  console.log(`${chalk.green("✓")} Created directory ${projectPath}`);

  const copiedFiles = await copyAllTemplates(projectPath, template, context);
  if (copiedFiles.length > 0) {
    console.log(`${chalk.green("✓")} Copied template files (${copiedFiles.join(", ")})`);
  }

  const created = new Date().toISOString();
  const source = await getCurrentSourceName();
  const version = await getCurrentSourceVersion();
  const synced: Record<string, string> = {};
  const mergedFiles = await getMergedTemplateFiles(template);

  for (const [targetFile] of mergedFiles) {
    try {
      const content = await getTemplateContent(targetFile, template);
      synced[targetFile] = hashContent(content);
    } catch {
      // Template not found, skip
    }
  }

  await writeLockFile(projectPath, {
    template,
    source: source ?? undefined,
    version: version ?? undefined,
    created,
    context,
    synced,
  });
  console.log(`${chalk.green("✓")} Created orb.lock file`);

  let remote: string | undefined;
  if (initGitRepo) {
    const gitInitialized = await initGit(projectPath);
    if (gitInitialized) {
      console.log(`${chalk.green("✓")} Initialized git repository`);

      if (context.githubOrg) {
        remote = `git@github.com:${context.githubOrg}/${projectName}.git`;
        const remoteAdded = await addRemote(projectPath, remote);
        if (remoteAdded) {
          console.log(`${chalk.green("✓")} Added remote origin`);
        } else {
          console.log(`${chalk.yellow("⚠")} Could not add remote origin`);
          remote = undefined;
        }
      }
    } else {
      console.log(`${chalk.yellow("⚠")} Could not initialize git repository`);
    }
  }

  await addProject({
    name: projectName,
    path: projectPath,
    remote,
    template,
    created,
  });
  console.log(`${chalk.green("✓")} Added to project registry`);

  // Run template commands if defined
  const commands = await getTemplateCommands(template);
  if (commands.length > 0) {
    await executeTemplateCommands(commands, projectPath, {
      skipConfirmation: options.runCommands,
    });
  }

  console.log(chalk.bold.green(`\nDone! `), chalk.dim(`cd ${projectPath} to get started.`));
}
