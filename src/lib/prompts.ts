import chalk from "chalk";
import { input, select, confirm } from "@inquirer/prompts";
import { getAvailableTemplates, templateExists } from "./templates.js";
import type { TemplatePrompt } from "../types.js";

export async function askPrompt(prompt: TemplatePrompt): Promise<string | boolean> {
  switch (prompt.type) {
    case "confirm":
      return confirm({
        message: prompt.message,
        default: (prompt.default as boolean) ?? false,
      });
    case "select":
      return select({
        message: prompt.message,
        choices: (prompt.choices ?? []).map(c => ({ name: c, value: c })),
      });
    default:
      return input({
        message: prompt.message,
        default: (prompt.default as string) ?? "",
      });
  }
}

export async function selectTemplate(): Promise<string> {
  const availableTemplates = await getAvailableTemplates();

  // Auto-select if only one template available
  if (availableTemplates.length === 1) {
    return availableTemplates[0]!;
  }

  if (availableTemplates.length > 1) {
    return select({
      message: "Template:",
      choices: availableTemplates.map(t => ({ name: t, value: t })),
    });
  }

  const template = await input({
    message: "Template:",
  });

  if (!template) {
    console.log(chalk.red("Template is required"));
    process.exit(1);
  }

  if (!(await templateExists(template))) {
    console.log(chalk.red(`Template "${template}" not found`));
    process.exit(1);
  }

  return template;
}
