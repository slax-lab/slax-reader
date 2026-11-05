import { defineEventHandler } from 'h3'

export default defineEventHandler(() => ({
  code: 200,
  message: 'ok',
  data: { mark_list: [], user_list: {} }
}))
