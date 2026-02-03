import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { getAllProjects, readLockFile, hashContent } from "../lib/projects.js";
import { getMergedTemplateFiles, getTemplatePath, renderTemplate, getCurrentSourceVersion } from "../lib/templates.js";

export async function statusCommand(): Promise<void> {
  const projects = await getAllProjects();

  if (projects.length === 0) {
    console.log(chalk.yellow("No projects registered."));
    return;
  }

  const currentVersion = await getCurrentSourceVersion();
  console.log(chalk.bold("\nSync status:\n"));

  for (const project of projects) {
    const lockFile = await readLockFile(project.path);
    const projectVersion = lockFile?.version;

    let versionInfo = "";
    if (currentVersion && projectVersion) {
      if (currentVersion !== projectVersion) {
        versionInfo = chalk.yellow(` v${projectVersion} → v${currentVersion}`);
      } else {
        versionInfo = chalk.dim(` v${projectVersion}`);
      }
    } else if (currentVersion) {
      versionInfo = chalk.yellow(` unknown → v${currentVersion}`);
    } else if (projectVersion) {
      versionInfo = chalk.dim(` v${projectVersion}`);
    }

    console.log(chalk.bold(`${project.name}`) + chalk.dim(` (${project.template})`) + versionInfo);

    if (!existsSync(project.path)) {
      console.log(chalk.red("  ✗ Project directory not found"));
      continue;
    }

    const syncedHashes = lockFile?.synced || {};
    const lockfileContext = lockFile?.context || {};
    const mergedFiles = await getMergedTemplateFiles(project.template, lockfileContext);

    let upToDate = 0;
    let templateChanged = 0;
    let locallyModified = 0;
    let missing = 0;

    for (const [targetFile, source] of mergedFiles) {
      const projectFilePath = path.join(project.path, targetFile);

      let templateContent: string;
      try {
        const tmplPath = await getTemplatePath(targetFile, project.template, lockfileContext);
        if (!tmplPath) continue;
        templateContent = await renderTemplate(tmplPath, lockfileContext);
      } catch {
        continue;
      }

      const templateHash = hashContent(templateContent);
      const lastSyncedHash = syncedHashes[targetFile];

      const sourceLabel = source !== "common" ? chalk.dim(` [${source}]`) : "";

      if (!existsSync(projectFilePath)) {
        missing++;
        console.log(chalk.yellow(`  ? ${targetFile}${sourceLabel} (missing)`));
        continue;
      }

      const projectContent = await readFile(projectFilePath, "utf-8");
      const projectHash = hashContent(projectContent);

      if (templateHash === projectHash) {
        upToDate++;
      } else if (lastSyncedHash && projectHash === lastSyncedHash) {
        templateChanged++;
        console.log(chalk.cyan(`  ↑ ${targetFile}${sourceLabel} (template updated)`));
      } else if (lastSyncedHash && templateHash === lastSyncedHash) {
        locallyModified++;
        console.log(chalk.yellow(`  ⚠ ${targetFile}${sourceLabel} (locally modified)`));
      } else {
        locallyModified++;
        console.log(chalk.yellow(`  ⚠ ${targetFile}${sourceLabel} (out of sync)`));
      }
    }

    if (templateChanged === 0 && locallyModified === 0 && missing === 0) {
      console.log(chalk.green("  ✓ All files up to date"));
    } else {
      const parts = [];
      if (upToDate > 0) parts.push(`${upToDate} synced`);
      if (templateChanged > 0) parts.push(`${templateChanged} need update`);
      if (locallyModified > 0) parts.push(`${locallyModified} modified`);
      if (missing > 0) parts.push(`${missing} missing`);
      console.log(chalk.dim(`  ${parts.join(", ")}`));
    }
    console.log();
  }
}
