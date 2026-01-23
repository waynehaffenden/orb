import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { select, confirm } from "@inquirer/prompts";
import { $ } from "bun";
import {
  getAllProjects,
  getProject,
  readLockFile,
  updateLockFileSynced,
  removeLockFileSynced,
  updateLockFileContext,
  updateLockFileVersion,
  hashContent,
} from "../lib/projects.js";
import {
  getMergedTemplateFiles,
  getTemplatePath,
  getTemplatePrompts,
  getCurrentSourceVersion,
  copyTemplateFile,
  getTemplateCommands,
  executeTemplateCommands,
} from "../lib/templates.js";
import { isGitAvailable } from "../lib/git.js";
import { askPrompt } from "../lib/prompts.js";
import type { Project, SyncResult, TemplateContext, TemplatePrompt } from "../types.js";

interface SyncOptions {
  all?: boolean;
  project?: string;
  commit?: boolean;
  branch?: string;
  dryRun?: boolean;
  message?: string;
  runCommands?: boolean;
}

async function findNewPrompts(
  project: Project
): Promise<TemplatePrompt[]> {
  const lockFile = await readLockFile(project.path);
  const answeredPrompts = lockFile?.context ? Object.keys(lockFile.context) : [];
  const templatePrompts = await getTemplatePrompts(project.template);

  return templatePrompts.filter(p => !answeredPrompts.includes(p.name));
}

async function askNewPrompts(
  project: Project,
  dryRun?: boolean
): Promise<TemplateContext> {
  const newPrompts = await findNewPrompts(project);
  const newContext: TemplateContext = {};

  if (newPrompts.length === 0) return newContext;

  console.log(chalk.cyan(`\n  New prompts added to template:`));

  if (dryRun) {
    for (const prompt of newPrompts) {
      console.log(chalk.dim(`    - ${prompt.name}: ${prompt.message}`));
    }
    console.log(chalk.yellow(`  [DRY RUN] Would ask these prompts`));
    return newContext;
  }

  for (const prompt of newPrompts) {
    newContext[prompt.name] = await askPrompt(prompt);
  }

  await updateLockFileContext(project.path, newContext);
  console.log(`  ${chalk.green("✓")} Updated orb.lock with new context`);

  return newContext;
}

export async function syncCommand(
  file: string | undefined,
  options: SyncOptions
): Promise<void> {
  if (!file && !options.all) {
    console.log(chalk.red("Please specify a file or use --all"));
    console.log(chalk.dim("  orb sync LICENSE"));
    console.log(chalk.dim("  orb sync --all"));
    console.log(chalk.dim("  orb sync LICENSE --commit"));
    console.log(chalk.dim("  orb sync LICENSE --commit --message 'update license'"));
    console.log(chalk.dim("  orb sync LICENSE --branch update-license"));
    console.log(chalk.dim("  orb sync LICENSE --dry-run"));
    process.exit(1);
  }

  const gitAvailable = await isGitAvailable();
  if ((options.commit || options.branch) && !gitAvailable) {
    console.log(chalk.yellow("Warning: git not available, --commit/--branch will be ignored"));
    options.commit = false;
    options.branch = undefined;
  }

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

  const mode = options.dryRun ? "DRY RUN - " : "";
  const action = options.commit ? " (commit & push)" : options.branch ? ` (branch: ${options.branch})` : "";

  const results: SyncResult[] = [];
  const deletedFiles: string[] = [];

  for (const project of projects) {
    const lockFile = await readLockFile(project.path);
    const context = lockFile?.context ?? {};

    console.log(
      chalk.bold(`\n${mode}Syncing to ${project.name} (${project.template})${action}...`)
    );

    // Ask new prompts first so we have full context for getMergedTemplateFiles
    const newContext = await askNewPrompts(project, options.dryRun);
    // Ensure built-in variables are always available (fallback for older lock files)
    const fullContext: TemplateContext = {
      projectName: project.name,
      template: project.template,
      year: new Date().getFullYear(),
      ...context,
      ...newContext,
    };

    const mergedFiles = await getMergedTemplateFiles(project.template, fullContext);

    let filesToSync: string[];
    if (options.all) {
      filesToSync = Array.from(mergedFiles.keys());
    } else if (file) {
      filesToSync = [file];
    } else {
      filesToSync = [];
    }

    const projectResults = await syncProjectFiles(
      filesToSync,
      mergedFiles,
      project,
      fullContext,
      options
    );
    results.push(...projectResults);

    const hasUpdates = projectResults.some(r => r.status === "updated");
    if (hasUpdates && !options.dryRun) {
      const currentVersion = await getCurrentSourceVersion();
      if (currentVersion) {
        await updateLockFileVersion(project.path, currentVersion);
      }
    }

    if (options.all) {
      const orphanedFiles = await findOrphanedFiles(project, mergedFiles);

      if (orphanedFiles.length > 0) {
        console.log(chalk.yellow(`\n  Files removed from template:`));
        for (const filename of orphanedFiles) {
          console.log(chalk.dim(`    - ${filename}`));
        }

        if (!options.dryRun) {
          const shouldDelete = await confirm({
            message: `Delete these files from ${project.name}?`,
            default: false,
          });

          if (shouldDelete) {
            const deleted = await deleteOrphanedFiles(project, orphanedFiles);
            deletedFiles.push(...deleted);
            for (const file of deleted) {
              console.log(`  ${chalk.red("✗")} ${file} deleted`);
            }

            if ((options.commit || options.branch) && deleted.length > 0) {
              try {
                await $`git add ${[...deleted, "orb.lock"]}`.cwd(project.path).quiet();
                await $`git commit -m ${`chore: remove ${deleted.join(", ")} (removed from orb)`}`.cwd(project.path).quiet();
                await $`git push`.cwd(project.path).quiet();
                console.log(`  ${chalk.green("✓")} committed deletions`);
              } catch (error) {
                console.log(`  ${chalk.red("✗")} git error: ${(error as Error).message}`);
              }
            }
          }
        } else {
          console.log(chalk.yellow(`  [DRY RUN] Would prompt to delete these files`));
        }
      }
    }

    // Run template commands if files were updated
    if (hasUpdates && !options.dryRun) {
      const commands = await getTemplateCommands(project.template);
      if (commands.length > 0) {
        await executeTemplateCommands(commands, project.path, {
          skipConfirmation: options.runCommands,
        });
      }
    }
  }

  const updated = results.filter(r => r.status === "updated").length;
  const upToDate = results.filter(r => r.status === "up-to-date").length;
  const skipped = results.filter(r => r.status === "skipped").length;
  const errors = results.filter(r => r.status === "error").length;
  const deleted = deletedFiles.length;

  const parts = [`${updated} updated`, `${upToDate} up-to-date`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  if (errors > 0) parts.push(`${errors} errors`);

  console.log(chalk.dim(`\n${mode}${parts.join(", ")}.`));
}

async function syncProjectFiles(
  files: string[],
  mergedFiles: Map<string, string>,
  project: Project,
  context: TemplateContext,
  options: SyncOptions
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const updatedFiles: string[] = [];

  if (!existsSync(project.path)) {
    console.log(`  ${chalk.red("✗")} project directory not found`);
    return [{ project: project.name, status: "error", message: "directory not found" }];
  }

  if (options.branch && !options.dryRun) {
    try {
      await $`git checkout -b ${options.branch}`.cwd(project.path).quiet();
    } catch {
      try {
        await $`git checkout ${options.branch}`.cwd(project.path).quiet();
      } catch {
        console.log(`  ${chalk.red("✗")} failed to create/checkout branch`);
        return [{ project: project.name, status: "error", message: "branch error" }];
      }
    }
  }

  for (const filename of files) {
    const source = mergedFiles.get(filename);
    const result = await syncFileToProject(filename, source, project, context, options.dryRun);
    results.push(result);

    if (result.status === "updated") {
      updatedFiles.push(filename);
    }

    const icon = {
      updated: chalk.green("✓"),
      "up-to-date": chalk.dim("⊜"),
      conflict: chalk.yellow("⚠"),
      skipped: chalk.dim("⊖"),
      error: chalk.red("✗"),
    }[result.status];

    const message = result.message ? ` (${result.message})` : "";
    const sourceLabel = source && source !== "common" ? chalk.dim(` [${source}]`) : "";
    const dryRunPrefix = options.dryRun ? chalk.yellow("[DRY RUN] ") : "";
    console.log(`${dryRunPrefix}  ${icon} ${filename}${sourceLabel} ${result.status}${message}`);
  }

  if ((options.commit || options.branch) && updatedFiles.length > 0 && !options.dryRun) {
    try {
      const commitMsg = options.message || `chore: sync ${updatedFiles.join(", ")} from orb`;

      await $`git add ${[...updatedFiles, "orb.lock"]}`.cwd(project.path).quiet();
      await $`git commit -m ${commitMsg}`.cwd(project.path).quiet();
      console.log(`  ${chalk.green("✓")} committed`);

      if (options.branch) {
        await $`git push -u origin ${options.branch}`.cwd(project.path).quiet();
        console.log(`  ${chalk.green("✓")} pushed branch ${options.branch}`);
        try {
          await $`git checkout main`.cwd(project.path).quiet();
        } catch {
          await $`git checkout master`.cwd(project.path).quiet();
        }
      } else {
        await $`git push`.cwd(project.path).quiet();
        console.log(`  ${chalk.green("✓")} pushed`);
      }
    } catch (error) {
      console.log(`  ${chalk.red("✗")} git error: ${(error as Error).message}`);
      results.push({ project: project.name, status: "error", message: "git push failed" });
    }
  } else if ((options.commit || options.branch) && updatedFiles.length > 0 && options.dryRun) {
    console.log(`${chalk.yellow("[DRY RUN]")}   would commit and push ${updatedFiles.join(", ")}`);
  }

  return results;
}

async function syncFileToProject(
  filename: string,
  source: string | undefined,
  project: Project,
  context: TemplateContext,
  dryRun?: boolean
): Promise<SyncResult> {
  const templatePath = await getTemplatePath(filename, project.template, context);
  const projectFilePath = path.join(project.path, filename);

  if (!templatePath) {
    return {
      project: project.name,
      status: "error",
      message: "template not found",
    };
  }

  const templateContent = await readFile(templatePath, "utf-8");
  const templateHash = hashContent(templateContent);

  const lockFile = await readLockFile(project.path);
  const lastSyncedHash = lockFile?.synced?.[filename];

  if (existsSync(projectFilePath)) {
    const projectContent = await readFile(projectFilePath, "utf-8");
    const projectHash = hashContent(projectContent);

    if (templateHash === projectHash) {
      if (!dryRun && lastSyncedHash !== templateHash) {
        await updateLockFileSynced(project.path, filename, templateHash);
      }
      return { project: project.name, status: "up-to-date" };
    }

    if (lastSyncedHash && projectHash === lastSyncedHash) {
      if (!dryRun) {
        await copyTemplateFile(templatePath, projectFilePath, context);
        await updateLockFileSynced(project.path, filename, templateHash);
      }
      return { project: project.name, status: "updated", message: "template updated" };
    }

    if (!dryRun) {
      const action = await select({
        message: `${project.name}/${filename} was modified locally. What do you want to do?`,
        choices: [
          { name: "Skip (keep local changes)", value: "skip" },
          { name: "Replace (overwrite with template)", value: "replace" },
        ],
      });

      if (action === "skip") {
        return { project: project.name, status: "skipped", message: "local changes kept" };
      }

      await copyTemplateFile(templatePath, projectFilePath, context);
      await updateLockFileSynced(project.path, filename, templateHash);
      return { project: project.name, status: "updated", message: "local changes overwritten" };
    } else {
      return { project: project.name, status: "conflict", message: "local changes detected" };
    }
  }

  if (!dryRun) {
    await copyTemplateFile(templatePath, projectFilePath, context);
    await updateLockFileSynced(project.path, filename, templateHash);
  }

  return { project: project.name, status: "updated", message: "created" };
}

async function findOrphanedFiles(
  project: Project,
  currentTemplateFiles: Map<string, string>
): Promise<string[]> {
  const orphaned: string[] = [];
  const lockFile = await readLockFile(project.path);
  if (!lockFile?.synced) return orphaned;

  for (const syncedFile of Object.keys(lockFile.synced)) {
    if (!currentTemplateFiles.has(syncedFile)) {
      const filePath = path.join(project.path, syncedFile);
      if (existsSync(filePath)) {
        orphaned.push(syncedFile);
      }
    }
  }

  return orphaned;
}

async function deleteOrphanedFiles(
  project: Project,
  filenames: string[]
): Promise<string[]> {
  const deleted: string[] = [];

  for (const filename of filenames) {
    const filePath = path.join(project.path, filename);
    if (existsSync(filePath)) {
      await unlink(filePath);
      await removeLockFileSynced(project.path, filename);
      deleted.push(filename);
    }
  }

  return deleted;
}
