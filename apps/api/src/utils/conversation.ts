import { Content } from '@google/genai'
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs'

export function convertToGeminiContent(messages: ChatCompletionMessageParam[]): Content[] {
  return messages
    .map(msg => {
      switch (msg.role) {
        case 'user':
          if (typeof msg.content === 'string') {
            return { role: 'user', parts: [{ text: msg.content }] }
          }
          if (Array.isArray(msg.content)) {
            const parts = msg.content
              .map(part => {
                if (part.type === 'text') {
                  return { text: part.text }
                }
                if (part.type === 'image_url') {
                  return { inlineData: { data: part.image_url.url, mimeType: 'image/png' } }
                }
                return null
              })
              .filter((part): part is NonNullable<typeof part> => part !== null)
            return { role: 'user', parts }
          }
          return null

        case 'assistant':
          if (msg.content && typeof msg.content === 'string') {
            return { role: 'model', parts: [{ text: msg.content }] }
          }
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            return {
              role: 'model',
              parts: msg.tool_calls.map(tc => {
                let args = {}
                try {
                  args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
                } catch (e) {
                  console.error('Failed to parse tool call arguments:', tc.function.arguments)
                  args = {}
                }
                return {
                  functionCall: {
                    name: tc.function.name,
                    args
                  }
                }
              })
            }
          }
          return null

        case 'system':
          return null

        default:
          return null
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}
