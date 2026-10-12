# Slax Reader CLI: Let Your AI Agent Save What Matters

Your AI Agent is smart — it can research, summarize, write code, and draft emails. But when it finds something worth keeping, it can't do anything about it. It tells you "here's the link," and you have to open a browser, log in, and save it yourself.

Slax Reader CLI changes that. Once installed, your agent can save any URL directly to your Slax Reader library — with titles, descriptions, tags, and archive mode. No more copy-pasting links. No more "I'll save that later" and forgetting.

Before: your AI finds it, you save it. Now: your AI finds it, your AI saves it. You just approve.

## Quick Start

### Option 1: Let your AI Agent do the install

Copy this prompt and send it to your AI Agent (Claude Code, Codex, Gemini CLI, Cursor, etc.):

```
Help me install and set up Slax Reader CLI: https://github.com/slax-lab/slax-reader/blob/dev/docs/cli/ai-agent-installation-guide.md
```

### Option 2: Manual install

```bash
npm install -g @slax-lab/reader-cli@latest
npx -y skills add https://github.com/slax-lab/slax-reader/tree/dev/apps/cli/skills/slax-reader --skill slax-reader -g -y
reader-cli login
```

That's it. Your agent can now run `reader-cli` commands.

---

## User Scenarios

### Scenario 1: Save as You Research

You're deep in a research session with your AI. It's pulling up articles, papers, and documentation. Instead of opening each link yourself, just say:

| Your Prompt | What Happens |
|-------------|-------------|
| "Save all these links to my reading list with tag 'research'" | Agent runs `reader-cli add <url> --tags "research"` for each link it found |
| "That article about transformers was great, bookmark it" | Agent identifies the URL from context and runs `reader-cli add https://arxiv.org/abs/... --title "Attention Is All You Need" --tags "ml,paper"` |

### Scenario 2: Curate While You Code

During a code review or debugging session, your agent finds relevant docs, Stack Overflow answers, or GitHub issues. Save them without breaking your flow:

| Your Prompt | What Happens |
|-------------|-------------|
| "Save this GitHub issue for follow-up" | `reader-cli add https://github.com/org/repo/issues/42 --tags "bug,follow-up"` |
| "Bookmark this MDN page, I keep coming back to it" | `reader-cli add https://developer.mozilla.org/... --title "CSS Grid Guide" --tags "reference,css"` |
| "Archive this blog post before it goes offline" | `reader-cli add https://blog.example.com/post --archive --tags "engineering"` |

### Scenario 3: Daily Reading Digest

Set up a workflow where your agent curates your daily reading. Tell it what topics you care about, and let it save the best finds:

| Your Prompt | What Happens |
|-------------|-------------|
| "Here are today's Hacker News links I liked: [list]. Save them all with today's date as a tag" | Agent batch-saves each URL with `--tags "hn,2026-05-11"` |
| "Go through my starred GitHub repos from this week and bookmark any that have good README docs" | Agent checks each repo, evaluates README quality, saves the good ones |

### Scenario 4: Team Knowledge Sharing

Found something your team should read? Save it and share the bookmark:

| Your Prompt | What Happens |
|-------------|-------------|
| "Save this API design guide — tag it 'team-reading' so everyone can find it" | `reader-cli add https://... --title "API Design Best Practices" --tags "team-reading,api"` |
| "Bookmark these three articles about React Server Components for the frontend team" | Agent saves each with `--tags "frontend,rsc,team-reading"` |

### Scenario 5: Archive Before It Disappears

Web content vanishes. Blog posts get deleted, pages get restructured, paywalls go up. When your agent finds something valuable, archive it:

| Your Prompt | What Happens |
|-------------|-------------|
| "This looks like it might get taken down, archive it" | `reader-cli add https://... --archive --title "..." --tags "archived"` |
| "Save and archive all the documentation links from this thread" | Agent extracts URLs and runs `reader-cli add <url> --archive` for each |

---

## Capability Map

| Domain | What the CLI Can Do |
|--------|-------------------|
| Bookmarks | Save any URL with custom title, description, tags, and archive mode |
| Browse | List saved bookmarks with filtering and pagination; get full bookmark detail and content |
| Authentication | Login with API Key, logout, view current user info |
| Tags | Organize bookmarks with comma-separated tags for easy retrieval |
| Archive | Enable archive mode to preserve page content as-is |
| Organize | Archive, unarchive, star, unstar, delete, and restore saved bookmarks |
| Updates | Auto-detect new CLI versions, one-command upgrade |

---

## Command Reference

Run `reader-cli --help` for the full overview.

| Action | Command |
|--------|---------|
| Log in with API Key | `reader-cli login [--api-key <key>]` |
| Log out | `reader-cli logout` |
| View current user | `reader-cli whoami` |
| Save a bookmark | `reader-cli add <url> [-t title] [-d desc] [--tags t1,t2] [--archive]` |
| List bookmarks | `reader-cli list [--page <n>] [--size <n>] [--filter all\|inbox\|archive\|starred]` |
| Get bookmark detail | `reader-cli get <bookmark-id> [--markdown]` |
| Archive a bookmark | `reader-cli archive <bookmark-id>` |
| Unarchive a bookmark | `reader-cli unarchive <bookmark-id>` |
| Star a bookmark | `reader-cli star <bookmark-id>` |
| Unstar a bookmark | `reader-cli unstar <bookmark-id>` |
| Delete a bookmark (recoverable) | `reader-cli delete <bookmark-id>` |
| Restore a deleted bookmark | `reader-cli restore <bookmark-id>` |
| Check for updates | `reader-cli upgrade --check` |
| Upgrade to latest | `reader-cli upgrade` |
| Show help | `reader-cli --help` |

---

## FAQ

- **Where is my API Key stored?**

  Locally in your system config directory (managed by the [conf](https://github.com/sindresorhus/conf) library). Run `reader-cli whoami` to see the config path. Your key never leaves your machine except when making API calls to Slax Reader.

- **`command not found: reader-cli` after install?**

  Your npm global bin directory may not be in your PATH. Run `npm root -g` to find the global directory, then add its parent `bin/` folder to your PATH.

- **Can my AI Agent save bookmarks without me approving each one?**

  That depends on your agent's permission model. Claude Code, for example, will ask before running shell commands unless you've pre-approved them. You can add `reader-cli` to your agent's allowed commands for a smoother experience.

- **Does the CLI work with self-hosted Slax Reader instances?**

  Yes. Use `reader-cli login --api-base https://your-instance.com` to point the CLI to your own server.

- **How do I use this with multiple accounts?**

  Currently the CLI stores one API Key at a time. To switch accounts, run `reader-cli logout` followed by `reader-cli login` with the other account's key.

- **How do I get help?**

  Run `reader-cli --help` for command overview, or visit the [GitHub repo](https://github.com/slax-lab/slax-reader) to open an issue.
