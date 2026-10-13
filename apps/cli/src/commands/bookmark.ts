import { Command } from 'commander'
import chalk from 'chalk'
import { request, requestText, ApiError } from '../lib/api.js'
import { commandResult, printJsonFailure, runCommand, CommandError } from '../lib/command.js'
import type { AddUrlBookmarkReq, BookmarkMetadata, BookmarkListItem, ArchiveBookmarkReq, StarBookmarkReq, TrashBookmarkReq } from '../types.js'

interface AddOptions {
  title?: string
  description?: string
  tags?: string
  archive?: boolean
  json?: boolean
}

interface ListOptions {
  page: string
  size: string
  filter: string
  json?: boolean
}

interface GetOptions {
  json?: boolean
  markdown?: boolean
}

interface BookmarkActionOptions {
  json?: boolean
}

interface BookmarkListOutputItem {
  title: string
  id: string
  site: string | null
  host: string | null
  created: string | null
  snapshot: string
  origin: string
}

interface BookmarkDetailOutput {
  title: string
  author: string | null
  url: string
  status: string
  tags: string[]
  created: string | null
  words: number | null
  origin: string
  snapshot: string
  content: string | null
}

export function registerBookmarkCommands(program: Command): void {
  program
    .command('add <url>')
    .description('Add a bookmark by URL')
    .option('-t, --title <title>', 'Bookmark title')
    .option('-d, --description <desc>', 'Bookmark description')
    .option('--tags <tags>', 'Comma-separated tags (e.g. "tech,news")')
    .option('--archive', 'Enable archive mode')
    .option('--json', 'Output JSON')
    .action(async (url: string, opts: AddOptions) => {
      const inputUrl = url
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url
      }

      try {
        new URL(url)
      } catch {
        printJsonFailure(opts, 'invalid_url', `Invalid URL: ${inputUrl}`)
      }

      const tags: string[] = opts.tags
        ? opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : []

      const body: AddUrlBookmarkReq = {
        target_url: url,
        target_title: opts.title,
        description: opts.description,
        tags,
        is_archive: opts.archive ?? false,
      }

      await runCommand(opts, {
        loading: `Adding bookmark: ${chalk.dim(url)}`,
        failMessage: 'Failed to add bookmark',
        action: async () => {
          await request<unknown>('POST', '/v1/bookmark/add_url', body)
          return commandResult({
            data: { url, title: opts.title ?? null, description: opts.description ?? null, tags, archive: body.is_archive },
            render: () => {
              console.log(chalk.green(`Bookmark added: ${chalk.bold(url)}`))
              if (tags.length) console.log(chalk.dim(`  Tags: ${tags.join(', ')}`))
            },
          })
        },
      })
    })

  program
    .command('list')
    .alias('ls')
    .description('List your bookmarks')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Items per page', '20')
    .option('-f, --filter <type>', 'Filter type: all, inbox, archive, starred', 'all')
    .option('--json', 'Output JSON')
    .action(async (opts: ListOptions) => {
      const page = parseInt(opts.page, 10)
      const size = parseInt(opts.size, 10)
      if (isNaN(page) || page < 1) {
        printJsonFailure(opts, 'invalid_page', 'Page must be a positive number.')
      }
      if (isNaN(size) || size < 1) {
        printJsonFailure(opts, 'invalid_size', 'Size must be a positive number.')
      }

      await runCommand(opts, {
        loading: 'Fetching bookmarks...',
        failMessage: 'Failed to fetch bookmarks',
        action: async () => {
          const items = await request<BookmarkListItem[]>(
            'GET',
            `/v1/bookmark/list?page=${page}&size=${size}&filter=${opts.filter}`
          )
          const outputItems = bookmarkListOutput(items)
          return commandResult({
            data: { page, size, filter: opts.filter, items: outputItems },
            render: ({ items }) => renderBookmarkList(items, page, size, opts.filter),
          })
        },
      })
    })

  program
    .command('get <id>')
    .description('Get bookmark detail')
    .option('--markdown', 'Output bookmark content as Markdown')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: GetOptions) => {
      await runCommand(opts, {
        loading: 'Fetching bookmark...',
        failMessage: 'Failed to fetch bookmark',
        action: async () => {
          const metadata = await request<BookmarkMetadata>(
            'GET',
            `/v1/bookmark/metadata?bookmark_uid=${id}`
          )
          const contentHeaders: Record<string, string> = opts.markdown
            ? { accept: 'text/markdown' }
            : {}
          let content: string | null = null
          try {
            content = await requestText(
              'POST',
              '/v1/bookmark/content',
              { headers: contentHeaders, body: { bookmark_uid: id } }
            )
          } catch (err) {
            // only swallow 404 — content not yet generated; rethrow all other errors
            if (!(err instanceof ApiError && err.statusCode === 404)) throw err
          }
          const data = bookmarkDetailOutput(id, metadata, content)
          return commandResult({
            data,
            render: renderBookmarkDetail,
          })
        },
      })
    })

  program
    .command('archive <id>')
    .description('Move a bookmark to your archive')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: BookmarkActionOptions) => {
      await runCommand(opts, {
        loading: 'Archiving bookmark...',
        failMessage: 'Failed to archive bookmark',
        action: async () => {
          const body: ArchiveBookmarkReq = { bookmark_uid: id, status: 'archive' }
          await request<unknown>('POST', '/v1/bookmark/archive', body)
          return commandResult({
            data: { id, status: 'archive' },
            message: chalk.green(`Bookmark archived: ${chalk.bold(id)}`),
          })
        },
      })
    })

  program
    .command('unarchive <id>')
    .description('Move a bookmark back to your inbox')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: BookmarkActionOptions) => {
      await runCommand(opts, {
        loading: 'Unarchiving bookmark...',
        failMessage: 'Failed to unarchive bookmark',
        action: async () => {
          const body: ArchiveBookmarkReq = { bookmark_uid: id, status: 'inbox' }
          await request<unknown>('POST', '/v1/bookmark/archive', body)
          return commandResult({
            data: { id, status: 'inbox' },
            message: chalk.green(`Bookmark moved to inbox: ${chalk.bold(id)}`),
          })
        },
      })
    })

  program
    .command('star <id>')
    .description('Star a bookmark')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: BookmarkActionOptions) => {
      await runCommand(opts, {
        loading: 'Starring bookmark...',
        failMessage: 'Failed to star bookmark',
        action: async () => {
          const body: StarBookmarkReq = { bookmark_uid: id, status: 'star' }
          await request<unknown>('POST', '/v1/bookmark/star', body)
          return commandResult({
            data: { id, starred: true },
            message: chalk.green(`Bookmark starred: ${chalk.bold(id)}`),
          })
        },
      })
    })

  program
    .command('unstar <id>')
    .description('Remove the star from a bookmark')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: BookmarkActionOptions) => {
      await runCommand(opts, {
        loading: 'Unstarring bookmark...',
        failMessage: 'Failed to unstar bookmark',
        action: async () => {
          const body: StarBookmarkReq = { bookmark_uid: id, status: 'unstar' }
          await request<unknown>('POST', '/v1/bookmark/star', body)
          return commandResult({
            data: { id, starred: false },
            message: chalk.green(`Star removed: ${chalk.bold(id)}`),
          })
        },
      })
    })

  program
    .command('delete <id>')
    .description('Move a bookmark to trash (recoverable with `restore`)')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: BookmarkActionOptions) => {
      await runCommand(opts, {
        loading: 'Moving bookmark to trash...',
        failMessage: 'Failed to delete bookmark',
        action: async () => {
          const bookmarkId = await resolveBookmarkId(id)
          const body: TrashBookmarkReq = { bookmark_id: bookmarkId }
          await request<unknown>('POST', '/v1/bookmark/trash', body)
          return commandResult({
            data: { id, trashed: true },
            render: () => {
              console.log(chalk.green(`Bookmark moved to trash: ${chalk.bold(id)}`))
              console.log(chalk.dim(`Restore with: reader-cli restore ${id}`))
            },
          })
        },
      })
    })

  program
    .command('restore <id>')
    .description('Restore a bookmark from trash')
    .option('--json', 'Output JSON')
    .action(async (id: string, opts: BookmarkActionOptions) => {
      await runCommand(opts, {
        loading: 'Restoring bookmark...',
        failMessage: 'Failed to restore bookmark',
        action: async () => {
          const bookmarkId = await resolveBookmarkId(id)
          const body: TrashBookmarkReq = { bookmark_id: bookmarkId }
          await request<unknown>('POST', '/v1/bookmark/trash_revert', body)
          return commandResult({
            data: { id, trashed: false },
            message: chalk.green(`Bookmark restored: ${chalk.bold(id)}`),
          })
        },
      })
    })
}

function bookmarkListOutput(items: BookmarkListItem[]): BookmarkListOutputItem[] {
  return items.map(item => ({
    title: item.alias_title || item.title || '(untitled)',
    id: item.bookmark_user_uuid,
    site: item.site_name || null,
    host: item.host_url || null,
    created: item.created_at || null,
    snapshot: `https://r.slax.com/b/${item.bookmark_user_uuid}`,
    origin: item.target_url,
  }))
}

function renderBookmarkList(items: BookmarkListOutputItem[], page: number, size: number, filter: string): void {
  if (!items || items.length === 0) {
    console.log(chalk.dim('No bookmarks found.'))
    console.log(chalk.dim(`Tip: adjust filters or page with ${chalk.bold('reader-cli list --page <number> --size <number> --filter <type>')}.`))
    return
  }

  console.log(chalk.bold(`Bookmarks (page ${page}, ${items.length} items):\n`))
  for (const item of items) {
    console.log(chalk.bold(item.title))
    console.log(`Id: ${item.id}`)
    console.log(`Site: ${item.site ?? ''}`)
    console.log(`Host: ${item.host ?? ''}`)
    console.log(`Created: ${item.created ? new Date(item.created).toLocaleString() : ''}`)
    console.log(`Snapshot: ${item.snapshot}`)
    console.log(`Origin: ${item.origin}`)
    console.log()
  }
  const nextPage = page + 1
  const previousPage = page > 1 ? page - 1 : null
  console.log(chalk.dim(`Tip: use ${chalk.bold('reader-cli get <id>')} to read bookmark content.`))
  console.log(chalk.dim(`AI paging hint: current page is ${page}; request the next page with ${chalk.bold(`reader-cli list --page ${nextPage} --size ${size} --filter ${filter}`)}${previousPage ? `, or the previous page with ${chalk.bold(`reader-cli list --page ${previousPage} --size ${size} --filter ${filter}`)}` : ''}.`))
}

function bookmarkDetailOutput(bmUid: string, metadata: BookmarkMetadata, content: string | null): BookmarkDetailOutput {
  return {
    title: metadata.alias_title || metadata.title,
    author: metadata.byline || null,
    url: metadata.host_url,
    status: metadata.status,
    tags: metadata.tags?.map(t => t.name) ?? [],
    created: metadata.created_at ?? null,
    words: metadata.content_word_count ?? null,
    origin: metadata.target_url,
    snapshot: `https://r.slax.com/b/${bmUid}`,
    content,
  }
}

function renderBookmarkDetail(detail: BookmarkDetailOutput): void {
  console.log(chalk.bold(detail.title))
  console.log(chalk.dim('─'.repeat(60)))
  console.log()
  console.log(chalk.dim(`Author: ${detail.author ?? ''}`))
  console.log(chalk.dim(`Host: ${detail.url}`))
  console.log(chalk.dim(`Status: ${detail.status}`))
  console.log(chalk.dim(`Tags: ${detail.tags.join(',')}`))
  console.log(chalk.dim(`Created: ${detail.created ? new Date(detail.created).toLocaleString() : ''}`))
  console.log(chalk.dim(`Words: ${detail.words ?? ''}`))
  console.log(chalk.dim(`Origin: ${detail.origin}`))
  console.log(chalk.dim(`Snapshot: ${detail.snapshot}`))
  console.log()
  console.log(chalk.bold('Content'))
  console.log(detail.content ?? '')
}

async function resolveBookmarkId(uid: string): Promise<number> {
  const metadata = await request<BookmarkMetadata>('GET', `/v1/bookmark/metadata?bookmark_uid=${uid}`)
  if (metadata.bookmark_id == null) {
    throw new CommandError('bookmark_id_missing', `Could not resolve a numeric bookmark id for ${uid}.`)
  }
  return metadata.bookmark_id
}
