import { defineEventHandler, getCookie, getQuery, setCookie, setResponseStatus } from 'h3'

// Only loaded by the explicit regression layer. No production account is involved.
export default defineEventHandler(async event => {
  if (event.path.split('?')[0] === '/v1/user/me') {
    await new Promise(resolve => setTimeout(resolve, Number(getCookie(event, 'reader_profile_delay') || 0)))
    const mode = getCookie(event, 'reader_profile_mode') || 'active'
    if (mode === 'error') {
      setCookie(event, 'reader_profile_mode', 'active', { path: '/' })
      setResponseStatus(event, 503)
      return { code: 503, message: 'Synthetic profile failure' }
    }
    return { code: 200, message: 'ok', data: { userId: 1, email: 'reader@example.invalid', name: 'Synthetic reader', lang: 'en', timezone: 'UTC', subscription_end_at: mode === 'inactive' ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', subscription_type: 2 } }
  }
  if (event.path.includes('/sync/')) {
    setResponseStatus(event, 503)
    return { code: 503, message: 'Synthetic sync service unavailable' }
  }
  if (event.path.includes('/mark_list')) {
    await new Promise(resolve => setTimeout(resolve, Number(getCookie(event, 'reader_mark_delay') || 0)))
    const uuid = String(getQuery(event).uuid || getQuery(event).bookmark_uid || '')
    const marked = uuid.includes('marked') || getCookie(event, 'reader_marks') === '1'
    const root = { id: 101, uuid: 'reader-mark', user_id: 1, type: 2, source: [{ type: 'text', path: '#passage-40', start: 0, end: 10 }], parent_id: 0, parent_uid: '', root_id: 101, root_uid: 'reader-mark', comment: 'Synthetic comment on Passage 40', created_at: '2026-11-17T00:00:00Z', is_deleted: false, children: [] }
    const reply = { ...root, id: 102, uuid: 'reader-reply', type: 3, parent_id: 101, parent_uid: 'reader-mark', comment: 'Synthetic reply', source: [] }
    return { code: 200, message: 'ok', data: { mark_list: marked ? [root, reply] : [], user_list: { '1': { id: 1, username: 'Synthetic reader', avatar: '' } } } }
  }
  return { code: 200, message: 'ok', data: event.path.includes('list') ? [] : {} }
})
