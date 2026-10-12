<div align="center">

# Slax Reader CLI

**Save anything to your Slax Reader library from the command line — or let your AI Agent do it.**

[![npm version](https://img.shields.io/npm/v/@slax-lab/reader-cli)](https://www.npmjs.com/package/@slax-lab/reader-cli)
[![Node LTS](https://img.shields.io/badge/node-22%20%7C%2024%20LTS-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[🇺🇸 English](README.md) · [🇨🇳 中文](README.zh.md)

</div>

---

| I'm a human user | I'm an AI Agent |
|------------------|-----------------|
| [Install & Usage →](#human-users) | [Agent Setup →](#ai-agent-integration) |

---

## Features

- 📌 **Save bookmarks by URL** — with optional title, description, tags, and archive mode
- 📚 **Browse your library** — list bookmarks (with snapshot and origin URLs) and get individual bookmark details
- 🗂️ **Organize bookmarks** — archive, unarchive, star, unstar, delete, and restore bookmarks
- 👤 **Account management** — login, logout, and get current user info
- 🔄 **Auto update notifications** — notified of new versions after each command; upgrade in one step
- 🤖 **AI Agent skill** — install a skill so your agent always knows how to use the CLI, with automatic sync hints when the CLI is upgraded

---

## Human Users

### Prerequisites

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (prefer Node 22 or 24 LTS)

For monorepo development and automated npm/GitHub releases, see [development](https://github.com/slax-lab/slax-reader/blob/dev/docs/cli/DEVELOPMENT.md) and [release setup](https://github.com/slax-lab/slax-reader/blob/dev/docs/cli/RELEASE.md).

### Installation

**One-line setup** (installs CLI + AI Agent skill):

```bash
npx @slax-lab/reader-cli@latest install
```

Verify:

```bash
reader-cli --version
```

### Get Your API Key

1. Sign in at [Slax Reader](https://reader.slax.com)
2. Go to **Settings → API Keys**
3. Click **Create Key** — your key starts with `sr-`

### Quick Start

```bash
# Log in
reader-cli login

# Save a bookmark
reader-cli add https://example.com

# Save with metadata
reader-cli add https://example.com \
  --title "My Article" \
  --description "Worth reading later" \
  --tags "tech,ai" \
  --archive

# List bookmarks
reader-cli list

# Get bookmark detail
reader-cli get <bookmark-id>
```

### Command Reference

#### `reader-cli login`

Authenticate with your API Key.

| Option | Description |
|--------|-------------|
| `--api-key <key>` | API Key (starts with `sr-`). Prompted interactively if omitted. |
| `--api-base <url>` | Custom API base URL (for self-hosted instances). |

#### `reader-cli logout`

Clear stored credentials from local config.

#### `reader-cli whoami`

Display current user information.

```
Current User:
  Username : john
  Email    : john@example.com
  API Base : https://api-reader.slax.com
  API Key  : sr-xxxxxxx...
```

#### `reader-cli add <url>`

Save a URL as a bookmark.

| Option | Description |
|--------|-------------|
| `-t, --title <title>` | Custom bookmark title |
| `-d, --description <desc>` | Short description |
| `--tags <tags>` | Comma-separated tags, e.g. `"tech,news"` |
| `--archive` | Enable archive mode |

Examples:

```bash
reader-cli add https://example.com
reader-cli add https://example.com --title "Example" --tags "reading,ai"
reader-cli add https://example.com --archive
```

#### `reader-cli list`

List your bookmarks. Alias: `reader-cli ls`.

| Option | Description |
|--------|-------------|
| `-p, --page <number>` | Page number (default: `1`) |
| `-s, --size <number>` | Items per page (default: `20`) |
| `-f, --filter <type>` | Filter: `all`, `inbox`, `archive`, or `starred` (default: `all`) |
| `--json` | Output JSON |

Examples:

```bash
reader-cli list
reader-cli list --filter inbox --page 2
reader-cli ls --size 10
```

#### `reader-cli get <bookmark-id>`

Get bookmark detail, including metadata and extracted content.

| Option | Description |
|--------|-------------|
| `--markdown` | Fetch content as Markdown instead of plain text |
| `--json` | Output JSON |

Examples:

```bash
reader-cli get fe32cc83-0766-45ad-bbb9-957bd3e78f38
reader-cli get fe32cc83-0766-45ad-bbb9-957bd3e78f38 --markdown
```

#### `reader-cli archive <bookmark-id>`

Move a bookmark to your archive. Not to be confused with `add --archive` (a save-time content-preservation mode) — this moves an already-saved bookmark out of the inbox.

| Option | Description |
|--------|-------------|
| `--json` | Output JSON |

#### `reader-cli unarchive <bookmark-id>`

Move a bookmark back to your inbox.

| Option | Description |
|--------|-------------|
| `--json` | Output JSON |

#### `reader-cli star <bookmark-id>`

Star a bookmark.

| Option | Description |
|--------|-------------|
| `--json` | Output JSON |

#### `reader-cli unstar <bookmark-id>`

Remove the star from a bookmark.

| Option | Description |
|--------|-------------|
| `--json` | Output JSON |

#### `reader-cli delete <bookmark-id>`

Move a bookmark to trash. Recoverable with `reader-cli restore <bookmark-id>`.

| Option | Description |
|--------|-------------|
| `--json` | Output JSON |

#### `reader-cli restore <bookmark-id>`

Restore a bookmark that was previously deleted.

| Option | Description |
|--------|-------------|
| `--json` | Output JSON |

#### `reader-cli upgrade`

Upgrade the CLI to the latest version.

| Option | Description |
|--------|-------------|
| `--check` | Check for a newer version only; do not install |

#### `reader-cli skill`

Manage the AI Agent skill. The skill teaches your agent how to use the CLI and is installed automatically by `npx @slax-lab/reader-cli@latest install`.

| Option | Description |
|--------|-------------|
| `--check` | Show whether the installed skill is in sync with the current CLI version |
| `--sync` | Install or update the skill to match the current CLI version |
| `--force` | Force reinstall even if already in sync |

After upgrading the CLI, `reader-cli upgrade` also keeps the skill in sync. When your agent sees `_hints.upgrade` or `_hints.skill` in command output, it should offer the same repair command: `reader-cli upgrade`.

#### `reader-cli --help`

Show full usage and all available commands.

---

## AI Agent Integration

Let your AI Agent install and configure everything for you. Copy the prompt below and send it to your AI Agent (Claude Code, Codex, Gemini CLI, Cursor, OpenClaw, etc.):

### Install via AI Agent

```
Help me install and set up Slax Reader CLI: https://github.com/slax-lab/slax-reader/blob/dev/docs/cli/ai-agent-installation-guide.md
```

> Your agent will read the guide, install the CLI and the AI Agent skill, walk you through authentication — all automatically.

Supports: **Claude Code** · **Claude Desktop** · **OpenAI Codex** · **Gemini CLI** · **OpenClaw** · **Cursor** · **Windsurf**

### AI Agent Skill

The skill (`skills/slax-reader/SKILL.md`) teaches your agent how to use the CLI. Once installed, your agent will:

- Know all available commands and options
- Automatically notify you when a new CLI version is available (`_hints.upgrade`)
- Automatically notify you when the skill is out of sync with the CLI (`_hints.skill`) and offer to run `reader-cli upgrade`

Install or update the skill manually if needed:

```bash
reader-cli skill --sync
```

Check sync status:

```bash
reader-cli skill --check
```

<details>
<summary>Already installed? Add this to your agent's system prompt</summary>

```
You have access to the `reader-cli` CLI for saving bookmarks to Slax Reader.

Available commands:

  reader-cli add <url> [options]    Save a URL as a bookmark
    -t, --title <title>              Custom title
    -d, --description <desc>         Short description
    --tags <tags>                    Comma-separated tags, e.g. "tech,news"
    --archive                        Enable archive mode

  reader-cli list [options]         List bookmarks
    -p, --page <number>              Page number, default 1
    -s, --size <number>              Items per page, default 20
    -f, --filter <type>              all, inbox, archive, or starred

  reader-cli get <bookmark-id>      Get bookmark detail
    --markdown                       Fetch content as Markdown

  reader-cli archive <bookmark-id>  Move a bookmark to archive
  reader-cli unarchive <bookmark-id> Move a bookmark back to inbox
  reader-cli star <bookmark-id>     Star a bookmark
  reader-cli unstar <bookmark-id>   Remove a bookmark's star
  reader-cli delete <bookmark-id>   Move a bookmark to trash (recoverable)
  reader-cli restore <bookmark-id>  Restore a bookmark from trash

  reader-cli whoami                 Show current user
  reader-cli logout                 Clear credentials
  reader-cli upgrade                Update to latest version
  reader-cli --help                 Full usage

Notes:
- All commands support --json for machine-readable output.
- URLs without http(s):// are auto-prefixed with https://
- If you get an auth error, ask the user to run: reader-cli login
```

</details>

---

## Terms of Service

By installing or using this CLI you agree to the [Slax Reader Terms of Service](https://slax.com/terms). Key points:

1. **Personal or authorized use only** — do not use this tool on behalf of others without their explicit consent.
2. **Keep your API Key private** — do not commit it to version control or share it publicly.
3. **No bulk scraping or abuse** — automated mass-saving without genuine user intent violates our fair-use policy.
4. **Data & privacy** — bookmark data is handled per the [Slax Reader Privacy Policy](https://slax.com/privacy).
5. **Terms may change** — the official website is always authoritative; this README is a summary only.

---

## License

MIT © [slax-lab](https://github.com/slax-lab)
