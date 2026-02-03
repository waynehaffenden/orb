import chalk from "chalk";
import { getAllProjects } from "../lib/projects.js";

export async function listCommand(): Promise<void> {
  const projects = await getAllProjects();

  if (projects.length === 0) {
    console.log(chalk.yellow("No projects registered yet."));
    console.log(chalk.dim("Use 'orb init <name>' or 'orb add <path>' to add projects."));
    return;
  }

  // Sort by template, then by name within each template
  projects.sort((a, b) => a.template.localeCompare(b.template) || a.name.localeCompare(b.name));

  // Calculate column widths
  const nameWidth = Math.max(4, ...projects.map(p => p.name.length));
  const templateWidth = Math.max(8, ...projects.map(p => p.template.length));
  const pathWidth = Math.max(4, ...projects.map(p => p.path.length));

  // Header
  const header = [
    "NAME".padEnd(nameWidth),
    "TEMPLATE".padEnd(templateWidth),
    "PATH".padEnd(pathWidth),
  ].join("   ");

  console.log(chalk.bold(header));

  // Rows
  for (const project of projects) {
    const row = [
      project.name.padEnd(nameWidth),
      project.template.padEnd(templateWidth),
      project.path.padEnd(pathWidth),
    ].join("   ");

    console.log(row);
  }
}
