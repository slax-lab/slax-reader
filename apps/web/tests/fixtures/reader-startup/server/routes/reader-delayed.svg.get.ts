import { defineEventHandler, setHeader } from 'h3'

export default defineEventHandler(event => {
  setHeader(event, 'content-type', 'image/svg+xml')
  return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#888"/></svg>'
})
