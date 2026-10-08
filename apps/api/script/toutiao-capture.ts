import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchToutiaoArticle } from '../src/infra/external/toutiao'
import { ROOT } from './root'

export async function runToutiaoCapture(args: string[], token = process.env.TIKHUB_TOKEN): Promise<void> {
  const [url, flag, directory, ...rest] = args
  if (!url || (flag !== undefined && (flag !== '--output' || !directory)) || rest.length) {
    throw new Error('Usage: pnpm api -- debug:toutiao <url> [--output <directory>]')
  }
  const article = await fetchToutiaoArticle(token, url)
  const output = directory ? path.resolve(ROOT, directory) : path.join(ROOT, '.local/toutiao-capture', article.articleId)
  await fs.mkdir(output, { recursive: true })
  const { html, text, ...metadata } = article
  await Promise.all([
    fs.writeFile(path.join(output, 'capture.json'), JSON.stringify({ ...metadata, htmlCharacters: html.length, textCharacters: text.length }, null, 2) + '\n'),
    fs.writeFile(path.join(output, 'article.html'), html),
    fs.writeFile(path.join(output, 'article.txt'), text + '\n')
  ])
  console.log(
    `${article.title}\nAuthor: ${article.author || '(unavailable)'}\nPublished: ${article.publishedAt || '(unavailable)'}\nCanonical URL: ${article.canonicalUrl}\nBody: ${text.length} characters\nOutput: ${output}`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runToutiaoCapture(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : 'Toutiao capture failed')
    process.exitCode = 1
  })
}
