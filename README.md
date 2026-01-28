# orb

A CLI for managing project templates and syncing common files across multiple projects.

## Features

- **Template Sources**: Use git repos or local directories as template sources
- **Inheritance**: Templates can extend other templates (CSS-like cascade)
- **Prompts**: Collect user input when creating projects with input, select, and confirm prompts
- **Conditional Files**: Include different files based on prompt answers (e.g., different LICENSE files)
- **Commands**: Run post-init commands (npm install, build, etc.) with cascading inheritance
- **Sync**: Keep common files (LICENSE, .gitignore, etc.) in sync across all your projects
- **Conflict Detection**: Smart handling of local modifications vs template updates

## Installation

### Homebrew (macOS/Linux)

```bash
brew tap waynehaffenden/tap
brew install orb
```

### Build from Source

Requires [Bun](https://bun.sh) v1.0+

```bash
git clone https://github.com/waynehaffenden/orb.git
cd orb
bun install
bun run build
```

The compiled binary will be at `dist/orb`.

## Quick Start

### 1. Add a template source

```bash
# From a git repo
orb template add https://github.com/your-org/templates.git

# Or from a local directory
orb template add /path/to/templates
```

### 2. Create a new project

```bash
orb init my-project
```

### 3. Add an existing project

```bash
cd existing-project
orb add
```

### 4. Sync templates to all projects

```bash
# Sync all files
orb sync --all

# Sync specific file
orb sync LICENSE

# Dry run (preview changes)
orb sync --all --dry-run

# Sync and commit changes
orb sync --all --commit --message "update templates"
```

## Template Source Structure

```
templates/
├── orb.json              # Manifest (required)
├── base/                 # Base template
│   ├── LICENSE.MIT       # Conditional file variant
│   ├── LICENSE.Apache-2.0
│   ├── .gitignore
│   └── README.md         # Can contain {{variables}}
├── node/                 # Node.js specific (extends base)
│   ├── package.json
│   └── tsconfig.json
└── bun/                  # Bun specific (extends node)
    └── bunfig.toml
```

## orb.json Manifest

The manifest defines template metadata, inheritance, prompts, and conditional files:

```json
{
  "$schema": "https://raw.githubusercontent.com/waynehaffenden/orb/main/schemas/orb.json",
  "name": "My Templates",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Standard project templates",
  "templates": {
    "base": {
      "description": "Base template with common files",
      "prompts": [
        {
          "name": "description",
          "message": "Project description:",
          "type": "input"
        },
        {
          "name": "author",
          "message": "Author name:",
          "type": "input"
        },
        {
          "name": "license",
          "message": "License:",
          "type": "select",
          "choices": ["MIT", "Apache-2.0", "GPL-3.0"],
          "default": "MIT"
        },
        {
          "name": "includeCI",
          "message": "Include CI workflow?",
          "type": "confirm",
          "default": true
        }
      ],
      "conditionalFiles": {
        "LICENSE": {
          "source": "license",
          "mapping": {
            "MIT": "LICENSE.MIT",
            "Apache-2.0": "LICENSE.Apache-2.0",
            "GPL-3.0": "LICENSE.GPL-3.0"
          }
        }
      }
    },
    "node": {
      "extends": "base",
      "description": "Node.js project template"
    },
    "bun": {
      "extends": "node",
      "description": "Bun project template"
    }
  }
}
```

### Prompts

Prompts collect user input when creating a project. Three types are supported:

| Type | Description | Properties |
|------|-------------|------------|
| `input` | Free text input | `default` (string) |
| `select` | Choose from options | `choices` (array), `default` (string) |
| `confirm` | Yes/no question | `default` (boolean) |

Prompt answers are available as variables in Handlebars templates.

### Conditional Files

Conditional files let you include different file variants based on prompt answers. For example, to offer multiple license options:

1. Create file variants with a naming convention: `LICENSE.MIT`, `LICENSE.Apache-2.0`
2. Add a select prompt to ask which license to use
3. Map prompt answers to file variants in `conditionalFiles`

The output file (`LICENSE`) will contain the content from the selected variant.

### Commands

Templates can define commands to run after project creation or sync. Commands cascade through inheritance - parent commands run first, then child template commands:

```json
{
  "templates": {
    "base": {
      "commands": [
        {
          "name": "install",
          "run": "npm install",
          "description": "Install dependencies"
        }
      ]
    },
    "node": {
      "extends": "base",
      "commands": [
        {
          "name": "build",
          "run": "npm run build",
          "description": "Build the project"
        }
      ]
    }
  }
}
```

When creating a project from `node`, both commands run in order: `npm install` then `npm run build`.

By default, orb asks for confirmation before running commands. Use `--run-commands` to skip:

```bash
orb init my-project --run-commands
orb sync --all --run-commands
```

### Project-Level .orbignore

The `.orbignore` file in your **project directory** (not template source) tells orb which files to skip during sync operations. This is useful for files that start from a template but become project-specific over time.

Create `.orbignore` in your project root:

```
# Files to keep local (won't be synced from template)
README.md        # Project-specific documentation
CHANGELOG.md     # Project's own changelog
docs/            # Custom documentation
.env.example     # Project-specific environment variables
config/*.local.* # Local configuration files
```

**Pattern Support:**
- Exact matches: `README.md`
- Wildcards: `*.local`, `test-*`
- Directories: `docs/` (ignores entire directory)
- Glob patterns: `config/*.local.*`

**Use Cases:**
- Files you've customized after project creation
- Project-specific documentation that shouldn't be overwritten
- Configuration files with local modifications
- Any file you want to maintain independently from the template

### Handlebars Templating

All template files are processed through Handlebars, so you can use `{{variables}}` in any file:

```handlebars
# {{projectName}}

{{description}}

## Author

{{author}} - {{year}}
```

Built-in variables:
- `projectName` - Project name
- `template` - Template name
- `year` - Current year

Custom variables from prompts are also available (e.g., `description`, `author`, `license`).

## Commands

| Command | Description |
|---------|-------------|
| `orb init [name] [template]` | Create a new project (use `--run-commands` to auto-run commands) |
| `orb add [path]` | Add an existing project to the registry |
| `orb sync [file]` | Sync templates to projects (use `--run-commands` to auto-run commands) |
| `orb status` | Check sync status |
| `orb list` | List registered projects |
| `orb scan [path]` | Scan for orb.lock projects |
| `orb remove <name>` | Remove project from registry |
| `orb template list` | List template sources |
| `orb template add <url\|path>` | Add a template source |
| `orb template update [name]` | Update template sources |
| `orb template remove <name>` | Remove a template source |
| `orb template init [path]` | Create a new template source |
| `orb config` | View or change project configuration |

### Sync Options

```bash
orb sync [file] [options]

Options:
  -a, --all              Sync all template files
  -p, --project <name>   Sync to specific project only
  -c, --commit           Commit and push changes
  -m, --message <msg>    Custom commit message
  -b, --branch <name>    Create a branch for changes
  -d, --dry-run          Preview without making changes
  --run-commands         Run template commands without confirmation
```

## Project Files

### orb.lock

Created in each project to track sync state:

```json
{
  "template": "node",
  "source": "my-templates",
  "version": "1.0.0",
  "created": "2025-01-01T00:00:00.000Z",
  "context": {
    "projectName": "my-project",
    "description": "My awesome project",
    "license": "MIT"
  },
  "synced": {
    "LICENSE": "a1b2c3d4e5f6",
    ".gitignore": "f6e5d4c3b2a1"
  }
}
```

### ~/.config/orb/

Global configuration directory:
- `projects.json` - Registry of all projects
- `sources.json` - Template source configuration
- `sources/` - Cloned git template sources

## License

MIT
