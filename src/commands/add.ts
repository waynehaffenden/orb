import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { confirm, input } from "@inquirer/prompts";
import { addProject, writeLockFile, readLockFile, rehashSyncedFiles } from "../lib/projects.js";
import { getRemoteUrl, isGitRepo } from "../lib/git.js";
import { selectTemplate, askPrompt } from "../lib/prompts.js";
import {
  getTemplatePrompts,
  getTemplateCommands,
  executeTemplateCommands,
} from "../lib/templates.js";
import type { TemplateContext } from "../types.js";

interface AddOptions {
  runCommands?: boolean;
}

export async function addCommand(inputPath?: string, options: AddOptions = {}): Promise<void> {
  const projectPath = path.resolve(inputPath || process.cwd());

  if (!existsSync(projectPath)) {
    console.log(chalk.red(`Path does not exist: ${projectPath}`));
    process.exit(1);
  }

  const defaultName = path.basename(projectPath);
  const existingLock = await readLockFile(projectPath);

  let name: string;
  let template: string;
  let created: string;

  if (existingLock) {
    console.log(chalk.dim("Found existing orb.lock file"));
    name = await input({
      message: "Project name:",
      default: defaultName,
    });
    template = existingLock.template;
    created = existingLock.created;
  } else {
    name = await input({
      message: "Project name:",
      default: defaultName,
    });

    template = await selectTemplate();
    created = new Date().toISOString();

    const prompts = await getTemplatePrompts(template);
    const context: TemplateContext = {
      projectName: name,
      template,
      year: new Date().getFullYear(),
    };

    for (const prompt of prompts) {
      context[prompt.name] = await askPrompt(prompt);
    }

    const createLockFile = await confirm({
      message: "Create orb.lock file in project?",
      default: true,
    });

    if (createLockFile) {
      await writeLockFile(projectPath, {
        template,
        created,
        context,
      });
      console.log(`${chalk.green("✓")} Created orb.lock file`);
    }
  }

  let remote: string | undefined;
  if (await isGitRepo(projectPath)) {
    remote = await getRemoteUrl(projectPath);
  }

  try {
    await addProject({
      name,
      path: projectPath,
      remote,
      template,
      created,
    });

    console.log(chalk.green(`\n${chalk.bold("✓")} Added "${name}"`));
    console.log(chalk.dim(`  Path: ${projectPath}`));
    if (remote) {
      console.log(chalk.dim(`  Remote: ${remote}`));
    }

    // Run template commands if defined (init-applicable only)
    const commands = (await getTemplateCommands(template)).filter(c => (c.on ?? "both") !== "sync");
    if (commands.length > 0) {
      const result = await executeTemplateCommands(commands, projectPath, {
        skipConfirmation: options.runCommands,
      });

      // Re-hash synced files after commands run, since commands (e.g. package
      // managers) may modify managed files like package.json or composer.json
      if (result.results.length > 0) {
        await rehashSyncedFiles(projectPath);
      }
    }
  } catch (error) {
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}
