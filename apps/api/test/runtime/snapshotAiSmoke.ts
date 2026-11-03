import assert from 'node:assert/strict'

/** Deterministic provider transport; the real AI services and request handlers still run. */
export async function snapshotAiProviderResponse(request: Request) {
  const body = (await request.json()) as { contents: unknown; systemInstruction?: unknown; generationConfig?: { responseMimeType?: string } }
  const input = JSON.stringify([body.contents, body.systemInstruction])
  assert.ok(input.includes('Original source body.'), 'AI must receive the saved destination text')
  assert.ok(!input.includes('Stale source text'), 'AI must not receive the separate source text object')
  const text =
    body.generationConfig?.responseMimeType === 'application/json'
      ? JSON.stringify({ overview: { gist: 'Snapshot text verified', key_takeaways: [] }, tags: [] })
      : 'Snapshot text verified'
  const result = { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }
  if (new URL(request.url).pathname.includes(':streamGenerateContent')) {
    return new Response(`data: ${JSON.stringify(result)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  return Response.json(result)
}

export async function exerciseSnapshotAi(fetch: (path: string, options?: RequestInit) => Promise<Response>, headers: Record<string, string>, uuid: string) {
  for (const feature of ['outline', 'overview', 'chat']) {
    const response = await fetch(`/__fixture/snapshot-ai/${feature}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bookmark_uid: uuid, messages: [{ role: 'user', content: 'Explain this saved article' }], platform: 'desktop' })
    })
    const text = await response.text()
    assert.equal(response.status, 200, text)
    if (feature === 'chat') {
      const answer = text
        .split('\n')
        .filter(line => line.startsWith('data: {'))
        .flatMap(line => JSON.parse(line.slice(6)).choices[0].delta as { content?: string }[])
        .map(delta => delta.content || '')
        .join('')
      assert.equal(answer, 'Snapshot text verified')
      assert.ok(text.includes('data: [DONE]'), 'chat stream must finish')
    } else {
      assert.ok(text.includes('Snapshot text verified'), `${feature} must return generated content: ${text}`)
    }
    assert.ok(!text.includes('"type":"error"'), text)
  }
}
