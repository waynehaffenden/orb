export interface OrbLock {
  template: string;
  source?: string;
  version?: string;
  created: string;
  context?: TemplateContext;
  synced?: Record<string, string>;
}

export interface Project {
  name: string;
  path: string;
  remote?: string;
  template: string;
  created: string;
}

export interface ProjectsRegistry {
  projects: Project[];
}

export type TemplateContext = Record<string, string | number | boolean>;

export interface SyncResult {
  project: string;
  status: "updated" | "up-to-date" | "conflict" | "skipped" | "error";
  message?: string;
}

export interface TemplateSource {
  name: string;
  type: "git" | "local";
  url?: string;
  path?: string;
  branch?: string;
  manifestHash?: string;
}

export interface TemplatePrompt {
  name: string;
  message: string;
  type?: "input" | "select" | "confirm";
  default?: string | boolean;
  choices?: string[];
}

export interface ConditionalFileMapping {
  source: string;
  mapping: Record<string, string | null>;
}

export interface TemplateCommand {
  name: string;
  run: string;
  description?: string;
}

export interface TemplateDefinition {
  extends?: string;
  description?: string;
  prompts?: TemplatePrompt[];
  conditionalFiles?: Record<string, ConditionalFileMapping>;
  commands?: TemplateCommand[];
}

export interface TemplateManifest {
  name: string;
  version?: string;
  author?: string;
  description?: string;
  templates?: Record<string, TemplateDefinition>;
}
