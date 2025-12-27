#!/usr/bin/env bun

import { Command } from "commander";
import pkg from "../package.json";
import { initCommand } from "../src/commands/init.js";
import { addCommand } from "../src/commands/add.js";
import { syncCommand } from "../src/commands/sync.js";
import { statusCommand } from "../src/commands/status.js";
import { listCommand } from "../src/commands/list.js";
import { scanCommand } from "../src/commands/scan.js";
import { removeCommand } from "../src/commands/remove.js";
import { templateCommand } from "../src/commands/template.js";
import { configCommand } from "../src/commands/config.js";

const program = new Command();

program
  .name("orb")
  .description("Project template & sync CLI")
  .version(pkg.version, "-v, --version");

program
  .command("init [project-name] [template]")
  .description("Create a new project from templates")
  .action(initCommand);

program
  .command("add [path]")
  .description("Add an existing project to the registry")
  .action(addCommand);

program
  .command("sync [file]")
  .description("Sync files to all registered projects")
  .option("-a, --all", "Sync all common files")
  .option("-p, --project <name>", "Sync to specific project only")
  .option("-c, --commit", "Commit and push changes to each project")
  .option("-m, --message <msg>", "Custom commit message")
  .option("-b, --branch <name>", "Create a branch for the changes")
  .option("-d, --dry-run", "Show what would happen without making changes")
  .action(syncCommand);

program
  .command("status")
  .description("Check which projects are out of sync")
  .action(statusCommand);

program
  .command("list")
  .alias("ls")
  .description("List all registered projects")
  .action(listCommand);

program
  .command("scan [path]")
  .description("Scan directory for orb.lock projects and add to registry")
  .action(scanCommand);

program
  .command("remove <name>")
  .alias("rm")
  .description("Remove a project from the registry")
  .action(removeCommand);

program
  .command("template [subcommand] [arg]")
  .description("Manage template sources (list, add, pull, remove)")
  .action(templateCommand);

program
  .command("config")
  .description("View or change project configuration")
  .option("-l, --list", "List current configuration values")
  .option("-p, --project <name>", "Target specific project only")
  .action(configCommand);

program.parse();
