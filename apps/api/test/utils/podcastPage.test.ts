import { describe, expect, test } from 'vitest'
import { parsePublicPodcastPage, exactPodcastFeedItem } from '@/utils/podcastPage'
const url = 'https://open.spotify.com/episode/abc123'
const page = (value: object) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`
const episode = { '@type': 'PodcastEpisode', name: 'A conversation', datePublished: '2026-10-01', duration: 'PT30M', audio: { '@type': 'AudioObject', contentUrl: 'https://cdn.example.com/episode.mp3' } }

describe('public episode metadata', () => {
  test('reads complete episode audio and an explicitly linked video', () => {
    const parsed = parsePublicPodcastPage(url, page({ ...episode, video: { '@type': 'VideoObject', embedUrl: 'https://www.youtube.com/embed/Jv5B5CEaPJI' } }))!
    expect(parsed.info.audioUrl).toBe('https://cdn.example.com/episode.mp3')
    expect(parsed.info.durationSec).toBe(1800)
    expect(parsed.info.transcripts[0].url).toBe('https://www.youtube.com/watch?v=Jv5B5CEaPJI')
  })
  test('never uses Spotify preview metadata as episode audio', () => {
    const parsed = parsePublicPodcastPage(url, '<meta property="og:audio" content="https://cdn.example.com/preview.mp3">')!
    expect(parsed.info.audioUrl).toBe('')
  })
  test.each(['http://127.0.0.1/a.mp3', 'https://u:p@example.com/a.mp3', 'file:///a.mp3'])('rejects unsafe audio %s', contentUrl => {
    expect(parsePublicPodcastPage(url, page({ ...episode, audio: { '@type': 'AudioObject', contentUrl } }))!.info.audioUrl).toBe('')
  })
  test('does not use restricted episode audio', () => {
    expect(parsePublicPodcastPage(url, page({ ...episode, isAccessibleForFree: false }))!.info.audioUrl).toBe('')
  })
  test('does not use unrelated video recommendations', () => {
    expect(parsePublicPodcastPage(url, page([episode, { '@type': 'VideoObject', contentUrl: 'https://www.youtube.com/watch?v=Jv5B5CEaPJI' }]))!.info.transcripts).toEqual([])
  })
  test('does not select a feed item by title alone', () => {
    const info = parsePublicPodcastPage(url, page({ '@type': 'PodcastEpisode', name: 'A conversation' }))!.info
    expect(exactPodcastFeedItem(info, { items: [{ title: info.title, audioUrl: 'https://cdn.example.com/wrong.mp3' }] } as any)).toBeNull()
  })
})


test('a preview marker prevents fallback to an unmarked player URL', () => {
  const html = page({ ...episode, audio: { ...episode.audio, isPreview: true } }) + '<audio src="https://cdn.example.com/preview.mp3"></audio>'
  expect(parsePublicPodcastPage(url, html)!.info.audioUrl).toBe('')
})
