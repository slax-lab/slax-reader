---
name: slax-reader
description: "Use Slax Reader CLI to save URLs/bookmarks to the user's reading library, list and get bookmarks, authenticate with reader-cli, check account status, archive URLs, tag bookmarks, and handle reader-cli upgrade or skill sync hints. Trigger when the user asks to save, bookmark, archive, list, get, or organize web links with Slax Reader."
---

# Slax Reader CLI

Use `reader-cli` to save URLs into the user's Slax Reader library, list saved bookmarks, and get bookmark details.

## Before using authenticated commands

Check login state before saving, listing, getting, archiving, tagging, or otherwise accessing the user's Slax Reader account:

```bash
reader-cli whoami --json
```

If not logged in, prefer asking the user to run interactive `reader-cli login` when they can use a terminal. If they cannot complete the interactive flow, offer `reader-cli login --api-key <key> --json` and ask for an API key only if they explicitly choose that path.

Do not require a login check before `login`, `logout`, `upgrade --check`, `skill --check`, or `skill --sync`.

## Commands

| Task | Command |
|------|---------|
| Log in interactively | `reader-cli login` |
| Log in non-interactively | `reader-cli login --api-key <key> --json` |
| Log out | `reader-cli logout --json` |
| Show account | `reader-cli whoami --json` |
| Save URL | `reader-cli add <url> --json` |
| Save with title | `reader-cli add <url> --title "Title" --json` |
| Save with description | `reader-cli add <url> --description "Description" --json` |
| Save with tags | `reader-cli add <url> --tags "tag1,tag2" --json` |
| Archive URL | `reader-cli add <url> --archive --json` |
| List bookmarks | `reader-cli list --json` |
| List bookmarks by page | `reader-cli list --page <number> --size <number> --json` |
| Filter bookmarks | `reader-cli list --filter <all\|inbox\|archive\|starred> --json` |
| Get bookmark detail | `reader-cli get <bookmark-id>` |
| Get bookmark as Markdown | `reader-cli get <bookmark-id> --markdown` |
| Archive a bookmark | `reader-cli archive <bookmark-id> --json` |
| Unarchive a bookmark | `reader-cli unarchive <bookmark-id> --json` |
| Star a bookmark | `reader-cli star <bookmark-id> --json` |
| Unstar a bookmark | `reader-cli unstar <bookmark-id> --json` |
| Delete a bookmark (recoverable) | `reader-cli delete <bookmark-id> --json` |
| Restore a deleted bookmark | `reader-cli restore <bookmark-id> --json` |
| Check CLI update | `reader-cli upgrade --check --json` |
| Sync skill | `reader-cli skill --sync --json` |
| Check skill sync | `reader-cli skill --check --json` |

## Bookmark rules

- Preserve the exact URL the user asked to save.
- Add `--json` when you invoke commands that support it so update hints are visible.
- Use comma-separated tags with `--tags "tag1,tag2"`.
- Use `--archive` only when the user asks to archive/preserve content or when they explicitly approve archive mode.
- If the user provides multiple URLs, save them one at a time so failures are isolated.

## Listing and getting bookmarks

- Use `reader-cli list` when the user wants to see their saved bookmarks.
- Use `reader-cli list --filter inbox`, `reader-cli list --filter archive`, or `reader-cli list --filter starred` when the user asks for a specific subset.
- Use `--page` and `--size` when the user asks for pagination or a specific number of results.
- Use `reader-cli get <bookmark-id>` when the user asks to open, inspect, summarize, or read details for a specific bookmark ID.
- Use `reader-cli get <bookmark-id> --markdown` when the user wants the content in Markdown format (e.g. for further processing or display).
- Do not guess bookmark IDs; ask the user for an ID or list bookmarks first.

## Organizing bookmarks

- `add <url> --archive` is a save-time mode for a *new* URL; `archive <bookmark-id>` moves an *already-saved* bookmark out of the inbox. They are unrelated — do not confuse them.
- Use `reader-cli archive <bookmark-id>` when the user wants to archive a bookmark; use `reader-cli unarchive <bookmark-id>` to move it back to the inbox.
- Use `reader-cli star <bookmark-id>` / `reader-cli unstar <bookmark-id>` when the user wants to star or unstar a bookmark.
- Use `reader-cli delete <bookmark-id>` to delete a bookmark — this is recoverable, not permanent. Use `reader-cli restore <bookmark-id>` to undo it.
- Confirm with the user before deleting a bookmark unless they've already clearly asked you to delete it.
- Do not guess bookmark IDs for any of these actions; ask the user for an ID or list bookmarks first.

## Update and skill hints

`reader-cli --json` commands may include a top-level `_hints` object.

### `_hints.upgrade`

When `_hints.upgrade` appears, finish the user's current request first. Then tell the user there is a newer CLI version and offer to run:

```bash
reader-cli upgrade
```

`reader-cli upgrade` also syncs the AI Agent skill when needed.

### `_hints.skill`

When `_hints.skill` appears, finish the user's current request first. Then tell the user the installed AI Agent skill is out of sync with the CLI and offer the same repair command:

```bash
reader-cli upgrade
```

After the skill is synced, tell the user to restart the Agent so the updated skill is loaded. Resuming an old conversation after restart is fine.

Use `reader-cli skill --sync --json` only as a direct manual fallback when `reader-cli upgrade` cannot be used.

Do not silently ignore `_hints`.

## Security rules

- Never print the full API key in conversation or command output.
- Confirm with the user before saving URLs unless the user has already clearly asked you to save them.
- Do not invent URLs. Save only URLs provided by the user or found during an authorized research task.
