import { readFile, readdir, copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import Handlebars from "handlebars";
import type { TemplateContext, TemplateManifest, TemplateDefinition, TemplatePrompt, ConditionalFileMapping, TemplateCommand } from "../types.js";
import { loadSources, getSourcePath, readManifest } from "./sources.js";
import { $ } from "bun";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";

const DEFAULT_IGNORE = [
  ".git",
  ".gitkeep",
  "orb.json",
  ".DS_Store",
  "node_modules",
];

function shouldIgnore(filename: string): boolean {
  return DEFAULT_IGNORE.includes(filename);
}

async function getFirstSource(): Promise<{ name: string; path: string } | null> {
  const sources = await loadSources();
  const firstSource = sources[0];
  if (!firstSource) return null;
  return { name: firstSource.name, path: getSourcePath(firstSource) };
}

async function getTemplatesDir(): Promise<string | null> {
  const source = await getFirstSource();
  return source?.path ?? null;
}

export async function getCurrentSourceName(): Promise<string | null> {
  const source = await getFirstSource();
  return source?.name ?? null;
}

export async function getCurrentSourceVersion(): Promise<string | null> {
  const manifest = await getManifest();
  return manifest?.version ?? null;
}

async function getManifest(): Promise<TemplateManifest | null> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return null;
  return readManifest(templatesDir);
}

export async function getInheritanceChain(templateName: string): Promise<string[]> {
  const manifest = await getManifest();
  const chain: string[] = [];

  if (!manifest?.templates) {
    chain.push(templateName);
    return chain;
  }

  const visited = new Set<string>();
  let current: string | undefined = templateName;

  while (current && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current);
    const def: TemplateDefinition | undefined = manifest.templates[current];
    current = def?.extends;
  }

  return chain;
}

export async function templateExists(templateName: string): Promise<boolean> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return false;

  const manifest = await getManifest();
  if (manifest?.templates) {
    return templateName in manifest.templates;
  }

  const templateDir = path.join(templatesDir, templateName);
  return existsSync(templateDir);
}

export async function getAvailableTemplates(): Promise<string[]> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir || !existsSync(templatesDir)) return [];

  const manifest = await getManifest();
  if (manifest?.templates) {
    return Object.keys(manifest.templates);
  }

  const entries = await readdir(templatesDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith("."))
    .map(e => e.name);
}

async function getTemplateDirectoryFiles(templateName: string): Promise<string[]> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return [];

  const templateDir = path.join(templatesDir, templateName);
  if (!existsSync(templateDir)) return [];

  async function collectFiles(dir: string, prefix: string = ""): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (shouldIgnore(entry.name)) continue;

      if (entry.isDirectory()) {
        const subFiles = await collectFiles(path.join(dir, entry.name), relativePath);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }

  return collectFiles(templateDir);
}

export async function getMergedTemplateFiles(
  templateName: string,
  context?: TemplateContext
): Promise<Map<string, string>> {
  const templatesDir = await getTemplatesDir();
  const merged = new Map<string, string>();
  const chain = await getInheritanceChain(templateName);

  if (!templatesDir) return merged;

  const variantFiles = new Set<string>();

  // Collect all variant files to exclude them
  for (const tmpl of chain) {
    const templateDir = path.join(templatesDir, tmpl);
    const variantMap = await detectVariantFiles(templateDir);
    for (const [, variants] of variantMap) {
      for (const file of variants.values()) {
        variantFiles.add(file);
      }
    }
  }

  for (const tmpl of chain) {
    const files = await getTemplateDirectoryFiles(tmpl);
    for (const file of files) {
      // Skip variant files
      if (variantFiles.has(file)) continue;

      merged.set(file, tmpl);
    }
  }

  // Add conditional files from manifest if context is provided
  if (context) {
    const conditionalFiles = await getConditionalFiles(templateName);
    for (const [targetFile, config] of Object.entries(conditionalFiles)) {
      const promptValue = context[config.source];
      if (promptValue && typeof promptValue === "string" && config.mapping[promptValue]) {
        merged.set(targetFile, chain[chain.length - 1] || templateName);
      }
    }
  }

  return merged;
}

export async function renderTemplate(
  templatePath: string,
  context: TemplateContext
): Promise<string> {
  const content = await readFile(templatePath, "utf-8");
  // Disable HTML escaping - we're generating source files, not HTML
  const template = Handlebars.compile(content, { noEscape: true });
  return template(context);
}

export async function copyTemplateFile(
  src: string,
  dest: string,
  context?: TemplateContext
): Promise<void> {
  const destDir = path.dirname(dest);
  if (!existsSync(destDir)) {
    await mkdir(destDir, { recursive: true });
  }

  if (context) {
    // Render all files through Handlebars when context is provided
    const rendered = await renderTemplate(src, context);
    await Bun.write(dest, rendered);
  } else {
    await copyFile(src, dest);
  }
}

export async function copyAllTemplates(
  destDir: string,
  templateName: string,
  context: TemplateContext
): Promise<string[]> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return [];

  const chain = await getInheritanceChain(templateName);
  const copied = new Set<string>();
  const variantFiles = new Set<string>();

  // First pass: collect all variant files to skip them
  for (const tmpl of chain) {
    const templateDir = path.join(templatesDir, tmpl);
    const variantMap = await detectVariantFiles(templateDir);
    for (const [, variants] of variantMap) {
      for (const file of variants.values()) {
        variantFiles.add(file);
      }
    }
  }

  // Second pass: copy files, resolving conditional files
  for (const tmpl of chain) {
    const files = await getTemplateDirectoryFiles(tmpl);
    for (const file of files) {
      // Skip variant files (they'll be copied via resolveConditionalFile)
      if (variantFiles.has(file)) continue;

      // Check if this file has a conditional variant
      const resolved = await resolveConditionalFile(templateName, file, context);
      if (resolved) {
        // Find the actual source file path
        const variantSrc = await findVariantSourcePath(templatesDir, chain, resolved.sourceFile);
        if (variantSrc) {
          const dest = path.join(destDir, file);
          await copyTemplateFile(variantSrc, dest, context);
          copied.add(file);
          continue;
        }
      }

      const src = path.join(templatesDir, tmpl, file);
      const dest = path.join(destDir, file);
      await copyTemplateFile(src, dest, context);
      copied.add(file);
    }
  }

  // Third pass: handle conditional files that don't have a base file
  const conditionalFiles = await getConditionalFiles(templateName);
  for (const [targetFile, config] of Object.entries(conditionalFiles)) {
    if (copied.has(targetFile)) continue;

    const promptValue = context[config.source];
    if (promptValue && typeof promptValue === "string" && config.mapping[promptValue]) {
      const sourceFile = config.mapping[promptValue];
      const variantSrc = await findVariantSourcePath(templatesDir, chain, sourceFile);
      if (variantSrc) {
        const dest = path.join(destDir, targetFile);
        await copyTemplateFile(variantSrc, dest, context);
        copied.add(targetFile);
      }
    }
  }

  return Array.from(copied);
}

async function findVariantSourcePath(
  templatesDir: string,
  chain: string[],
  filename: string
): Promise<string | null> {
  for (const tmpl of [...chain].reverse()) {
    const filePath = path.join(templatesDir, tmpl, filename);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

export async function getTemplateContent(
  filename: string,
  templateName: string
): Promise<string> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) {
    throw new Error("No template source configured");
  }

  const chain = (await getInheritanceChain(templateName)).reverse();

  for (const tmpl of chain) {
    const tmplPath = path.join(templatesDir, tmpl, filename);
    if (existsSync(tmplPath)) {
      return readFile(tmplPath, "utf-8");
    }
  }

  throw new Error(`Template not found: ${filename}`);
}

export async function getTemplatePath(
  filename: string,
  templateName: string,
  context?: TemplateContext
): Promise<string | null> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return null;

  const chain = await getInheritanceChain(templateName);

  // Check for conditional file resolution first
  if (context) {
    const resolved = await resolveConditionalFile(templateName, filename, context);
    if (resolved) {
      const variantPath = await findVariantSourcePath(templatesDir, chain, resolved.sourceFile);
      if (variantPath) return variantPath;
    }
  }

  const reversedChain = [...chain].reverse();
  for (const tmpl of reversedChain) {
    const tmplPath = path.join(templatesDir, tmpl, filename);
    if (existsSync(tmplPath)) return tmplPath;
  }

  return null;
}

export async function getTemplatePrompts(templateName: string): Promise<TemplatePrompt[]> {
  const manifest = await getManifest();
  if (!manifest?.templates) return [];

  const chain = await getInheritanceChain(templateName);
  const promptsByName = new Map<string, TemplatePrompt>();

  for (const tmpl of chain) {
    const def = manifest.templates[tmpl];
    if (def?.prompts) {
      for (const prompt of def.prompts) {
        promptsByName.set(prompt.name, prompt);
      }
    }
  }

  return Array.from(promptsByName.values());
}

export async function getConditionalFiles(
  templateName: string
): Promise<Record<string, ConditionalFileMapping>> {
  const manifest = await getManifest();
  if (!manifest?.templates) return {};

  const chain = await getInheritanceChain(templateName);
  const conditionalFiles: Record<string, ConditionalFileMapping> = {};

  for (const tmpl of chain) {
    const def = manifest.templates[tmpl];
    if (def?.conditionalFiles) {
      Object.assign(conditionalFiles, def.conditionalFiles);
    }
  }

  return conditionalFiles;
}

function parseVariantFilename(filename: string): { baseName: string; variant: string } | null {
  const match = filename.match(/^(.+)\.([^.]+)$/);
  if (!match) return null;

  const [, baseName, variant] = match;
  if (!baseName || !variant) return null;

  return { baseName, variant };
}

async function detectVariantFiles(
  templateDir: string
): Promise<Map<string, Map<string, string>>> {
  const variantMap = new Map<string, Map<string, string>>();

  if (!existsSync(templateDir)) return variantMap;

  const entries = await readdir(templateDir, { withFileTypes: true });

  for (const entry of entries) {
    // Only process files, not directories
    if (!entry.isFile()) continue;
    if (shouldIgnore(entry.name)) continue;

    const parsed = parseVariantFilename(entry.name);
    if (!parsed) continue;

    const { baseName, variant } = parsed;

    if (!variantMap.has(baseName)) {
      variantMap.set(baseName, new Map());
    }
    variantMap.get(baseName)!.set(variant, entry.name);
  }

  // Only keep entries with multiple variants (actual variant sets)
  // Single files like "newfile.txt" should not be treated as variants
  for (const [baseName, variants] of variantMap) {
    if (variants.size < 2) {
      variantMap.delete(baseName);
    }
  }

  return variantMap;
}

export async function resolveConditionalFile(
  templateName: string,
  targetFile: string,
  context: TemplateContext
): Promise<{ sourceFile: string; promptName: string } | null> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return null;

  const conditionalFiles = await getConditionalFiles(templateName);
  const chain = await getInheritanceChain(templateName);

  if (conditionalFiles[targetFile]) {
    const config = conditionalFiles[targetFile];
    const promptValue = context[config.source];
    if (promptValue && typeof promptValue === "string" && config.mapping[promptValue]) {
      return {
        sourceFile: config.mapping[promptValue],
        promptName: config.source,
      };
    }
  }

  for (const tmpl of chain.reverse()) {
    const templateDir = path.join(templatesDir, tmpl);
    const variantMap = await detectVariantFiles(templateDir);

    if (variantMap.has(targetFile)) {
      const variants = variantMap.get(targetFile)!;

      for (const [promptName, promptValue] of Object.entries(context)) {
        if (typeof promptValue === "string" && variants.has(promptValue)) {
          return {
            sourceFile: variants.get(promptValue)!,
            promptName,
          };
        }
      }
    }
  }

  return null;
}

export async function getVariantFilesForPrompt(
  templateName: string,
  promptName: string,
  context: TemplateContext
): Promise<string[]> {
  const templatesDir = await getTemplatesDir();
  if (!templatesDir) return [];

  const chain = await getInheritanceChain(templateName);
  const conditionalFiles = await getConditionalFiles(templateName);
  const affectedFiles: string[] = [];

  for (const [targetFile, config] of Object.entries(conditionalFiles)) {
    if (config.source === promptName) {
      affectedFiles.push(targetFile);
    }
  }

  const promptValue = context[promptName];
  if (typeof promptValue === "string") {
    for (const tmpl of chain) {
      const templateDir = path.join(templatesDir, tmpl);
      const variantMap = await detectVariantFiles(templateDir);

      for (const [baseName, variants] of variantMap) {
        if (variants.has(promptValue) && !affectedFiles.includes(baseName)) {
          affectedFiles.push(baseName);
        }
      }
    }
  }

  return affectedFiles;
}

export async function getTemplateCommands(templateName: string): Promise<TemplateCommand[]> {
  const manifest = await getManifest();
  if (!manifest?.templates) return [];

  const chain = await getInheritanceChain(templateName);
  const commands: TemplateCommand[] = [];

  for (const tmpl of chain) {
    const def = manifest.templates[tmpl];
    if (def?.commands) {
      commands.push(...def.commands);
    }
  }

  return commands;
}

export interface CommandResult {
  name: string;
  success: boolean;
  error?: string;
}

export async function executeTemplateCommands(
  commands: TemplateCommand[],
  projectPath: string,
  options: { skipConfirmation?: boolean } = {}
): Promise<{ success: boolean; results: CommandResult[] }> {
  if (commands.length === 0) {
    return { success: true, results: [] };
  }

  // Display commands to user
  console.log(chalk.dim("\nThe following commands will be run:"));
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(cmd.name)}: ${cmd.run}`);
    if (cmd.description) {
      console.log(`     ${chalk.dim(cmd.description)}`);
    }
  }
  console.log();

  // Ask for confirmation unless skipped
  if (!options.skipConfirmation) {
    const shouldRun = await confirm({
      message: "Run these commands?",
      default: false,
    });

    if (!shouldRun) {
      console.log(chalk.yellow("Skipped running commands"));
      return { success: true, results: [] };
    }
  }

  console.log(chalk.dim("Running commands...\n"));

  const results: CommandResult[] = [];

  for (const cmd of commands) {
    try {
      await $`bash -c ${cmd.run}`.cwd(projectPath);
      console.log(`${chalk.green("✓")} ${cmd.name}`);
      results.push({ name: cmd.name, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`${chalk.red("✗")} ${cmd.name}: ${errorMessage}`);
      results.push({ name: cmd.name, success: false, error: errorMessage });
    }
  }

  return {
    success: results.every(r => r.success),
    results,
  };
}
