import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { readdir, mkdir, writeFile } from "fs/promises";
import { input, confirm } from "@inquirer/prompts";
import {
  loadSources,
  addSource,
  removeSource,
  getSourcePath,
  cloneSource,
  updateSource,
  detectSourceType,
  extractSourceName,
  validateSourcePath,
  readManifest,
  validateManifest,
  getManifestHash,
  updateSourceHash,
} from "../lib/sources.js";
import type { TemplateSource } from "../types.js";

export async function templateCommand(
  subcommand?: string,
  arg?: string
): Promise<void> {
  switch (subcommand) {
    case "list":
    case "ls":
      await templateList();
      break;
    case "add":
      await templateAdd(arg);
      break;
    case "update":
      await templateUpdate(arg);
      break;
    case "remove":
    case "rm":
      await templateRemove(arg);
      break;
    case "init":
      await templateInit(arg);
      break;
    default:
      showTemplateHelp();
  }
}

function showTemplateHelp(): void {
  console.log(chalk.bold("\nTemplate source commands:\n"));
  console.log("  orb template list            List template sources and types");
  console.log("  orb template add <url|path>  Add a git repo or local path as source");
  console.log("  orb template update [name]   Update template sources (git: pull, local: validate)");
  console.log("  orb template remove <name>   Remove a template source");
  console.log("  orb template init [path]     Create a new template source");
  console.log();
}

async function templateList(): Promise<void> {
  const sources = await loadSources();

  if (sources.length === 0) {
    console.log(chalk.yellow("No template sources configured."));
    console.log(chalk.dim("Run 'orb template add <url|path>' to add a source."));
    return;
  }

  // Build rows with all data first
  const rows: { name: string; author: string; location: string; templates: string }[] = [];

  for (const source of sources) {
    const sourcePath = getSourcePath(source);
    const valid = validateSourcePath(sourcePath);
    const manifest = valid ? await readManifest(sourcePath) : null;
    const templates = valid ? await getTemplatesFromPath(sourcePath) : [];

    rows.push({
      name: source.name,
      author: manifest?.author || "",
      location: source.type === "git"
        ? (source.url || "") + (source.branch ? ` (${source.branch})` : "")
        : source.path || "",
      templates: templates.join(", "),
    });
  }

  // Calculate column widths
  const nameWidth = Math.max(4, ...rows.map(r => r.name.length));
  const authorWidth = Math.max(6, ...rows.map(r => r.author.length));
  const locationWidth = Math.max(8, ...rows.map(r => r.location.length));
  const templatesWidth = Math.max(9, ...rows.map(r => r.templates.length));

  // Header
  const header = [
    "NAME".padEnd(nameWidth),
    "AUTHOR".padEnd(authorWidth),
    "LOCATION".padEnd(locationWidth),
    "TEMPLATES".padEnd(templatesWidth),
  ].join("   ");

  console.log(chalk.bold(header));

  // Rows
  for (const row of rows) {
    const line = [
      row.name.padEnd(nameWidth),
      row.author.padEnd(authorWidth),
      row.location.padEnd(locationWidth),
      row.templates.padEnd(templatesWidth),
    ].join("   ");

    console.log(line);
  }
}

async function getTemplatesFromPath(sourcePath: string): Promise<string[]> {
  if (!existsSync(sourcePath)) return [];

  const manifest = await readManifest(sourcePath);
  if (manifest?.templates) {
    return Object.keys(manifest.templates);
  }

  try {
    const entries = await readdir(sourcePath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith("."))
      .map(e => e.name);
  } catch {
    return [];
  }
}

async function templateAdd(urlOrPath?: string): Promise<void> {
  const input_value =
    urlOrPath ||
    (await input({
      message: "Git URL or local path:",
    }));

  if (!input_value) {
    console.log(chalk.red("URL or path is required."));
    return;
  }

  const sourceType = detectSourceType(input_value);
  const name = extractSourceName(input_value);

  const source: TemplateSource = {
    name,
    type: sourceType,
  };

  if (sourceType === "git") {
    source.url = input_value;
  } else {
    source.path = path.resolve(input_value);

    if (!existsSync(source.path)) {
      console.log(chalk.red(`Path not found: ${source.path}`));
      return;
    }
  }

  try {
    if (sourceType === "git") {
      console.log(chalk.dim("Cloning repository..."));
      await cloneSource(source);
    }

    // Store initial manifest hash
    const sourcePath = getSourcePath(source);
    const hash = await getManifestHash(sourcePath);
    if (hash) {
      source.manifestHash = hash;
    }

    await addSource(source);
    console.log(chalk.green("✓") + ` Added source '${name}'`);

    const templates = await getTemplatesFromPath(sourcePath);
    if (templates.length > 0) {
      console.log(chalk.dim(`  Templates available: ${templates.join(", ")}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`Failed to add source: ${message}`));
  }
}

async function templateUpdate(name?: string): Promise<void> {
  const sources = await loadSources();

  if (sources.length === 0) {
    console.log(chalk.yellow("No template sources configured."));
    return;
  }

  const sourcesToUpdate = name
    ? sources.filter(s => s.name === name)
    : sources;

  if (name && sourcesToUpdate.length === 0) {
    console.log(chalk.red(`Source '${name}' not found.`));
    return;
  }

  for (const source of sourcesToUpdate) {
    try {
      const sourcePath = getSourcePath(source);
      console.log(chalk.dim(`Updating ${source.name}...`));

      if (source.type === "git") {
        const updated = await updateSource(source);

        if (updated) {
          console.log(chalk.green("✓") + ` Updated '${source.name}'`);
        } else {
          console.log(chalk.dim(`  '${source.name}' already up to date`));
        }
      } else {
        if (!validateSourcePath(sourcePath)) {
          console.log(chalk.red("✗") + ` '${source.name}' path not found`);
          continue;
        }
      }

      // Validate manifest for both types
      const validation = await validateManifest(sourcePath);
      if (!validation.valid) {
        console.log(chalk.yellow("⚠") + ` '${source.name}': ${validation.error}`);
        continue;
      }

      // Check for manifest changes using hash
      const currentHash = await getManifestHash(sourcePath);
      const previousHash = source.manifestHash;

      if (currentHash !== previousHash) {
        await updateSourceHash(source.name, currentHash);
        // For git sources that already reported "Updated", don't double report
        if (source.type === "local") {
          console.log(chalk.green("✓") + ` Updated '${source.name}'`);
        }
      } else if (source.type === "local") {
        console.log(chalk.dim(`  '${source.name}' already up to date`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`Failed to update '${source.name}': ${message}`));
    }
  }
}

async function templateRemove(name?: string): Promise<void> {
  if (!name) {
    console.log(chalk.red("Source name is required."));
    console.log(chalk.dim("Usage: orb template remove <name>"));
    return;
  }

  const removed = await removeSource(name);

  if (removed) {
    console.log(chalk.green("✓") + ` Removed source '${name}'`);
  } else {
    console.log(chalk.red(`Source '${name}' not found.`));
  }
}

async function templateInit(targetPath?: string): Promise<void> {
  console.log(chalk.bold("\nCreate a new template source\n"));

  const name = await input({
    message: "Template source name:",
    default: targetPath ? path.basename(targetPath) : "templates",
  });

  const author = await input({
    message: "Author:",
    default: "",
  });

  const description = await input({
    message: "Description:",
    default: "",
  });

  const firstTemplate = await input({
    message: "First template name:",
    default: "base",
  });

  const destDir = targetPath ? path.resolve(targetPath) : path.resolve(name);

  if (existsSync(destDir)) {
    console.log(chalk.red(`\nError: Directory already exists: ${destDir}`));
    return;
  }

  // Create directory structure
  await mkdir(destDir, { recursive: true });
  await mkdir(path.join(destDir, firstTemplate), { recursive: true });

  // Create orb.json manifest
  const manifest = {
    $schema: "https://raw.githubusercontent.com/waynehaffenden/orb/main/schemas/orb.json",
    name,
    version: "0.1.0",
    ...(author && { author }),
    ...(description && { description }),
    templates: {
      [firstTemplate]: {
        description: `${firstTemplate} template`,
      },
    },
  };

  await writeFile(
    path.join(destDir, "orb.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  // Create .gitkeep in first template
  await writeFile(path.join(destDir, firstTemplate, ".gitkeep"), "");

  console.log(chalk.green("\n✓") + ` Created template source at ${destDir}`);
  console.log(chalk.dim(`\n  ${destDir}/`));
  console.log(chalk.dim(`  ├── orb.json`));
  console.log(chalk.dim(`  └── ${firstTemplate}/`));
  console.log(chalk.dim(`      └── .gitkeep`));

  const shouldAdd = await confirm({
    message: "Add this as a local template source?",
    default: true,
  });

  if (shouldAdd) {
    const source: TemplateSource = {
      name,
      type: "local",
      path: destDir,
    };

    try {
      await addSource(source);
      console.log(chalk.green("✓") + ` Added as local source '${name}'`);
    } catch (error) {
      console.log(chalk.yellow(`Could not add source: ${(error as Error).message}`));
    }
  }

  console.log(chalk.dim(`\nNext steps:`));
  console.log(chalk.dim(`  1. Add template files to ${destDir}/${firstTemplate}/`));
  console.log(chalk.dim(`  2. Use {{variableName}} for Handlebars templating`));
  console.log(chalk.dim(`  3. Add prompts to orb.json to collect variables`));
  console.log(chalk.dim(`  4. Run 'orb init' to create a project from your template`));
}
