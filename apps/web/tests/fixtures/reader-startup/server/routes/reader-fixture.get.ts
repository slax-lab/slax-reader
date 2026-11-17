import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'

export default defineEventHandler(event => {
  const scenario = getQuery(event).case
  if (scenario) {
    setCookie(event, 'slax_reader_test', scenario === 'public' ? '' : 'eyJhbGciOiJub25lIn0.eyJpZCI6MX0.synthetic', { path: '/', sameSite: 'lax' })
    setCookie(event, 'reader_profile_mode', scenario === 'inactive' ? 'inactive' : scenario === 'error' ? 'error' : 'active', { path: '/' })
    setCookie(event, 'reader_profile_delay', '4000', { path: '/' })
    setCookie(event, 'reader_marks', scenario === 'marked' ? '1' : '0', { path: '/' })
    return sendRedirect(event, `/b/reader-${scenario === 'public' ? 'outline' : scenario === 'marked' ? 'marked' : 'one'}?local=1&startupDelay=2500&readyDelay=1500&manual=1`)
  }
  return '<!doctype html><meta charset="utf-8"><title>Reader regression lab</title><h1>Reader regression lab</h1><p>Disposable synthetic account and article. This does not change any real subscription.</p><p>Scroll during startup; select Chat or Analysis while the profile is checking. No interaction should still restore Passage 15.</p><ul><li><a href="?case=active">Active subscriber — slow startup and profile</a></li><li><a href="?case=error">Profile fails once — explicit retry</a></li><li><a href="?case=inactive">Confirmed expired subscriber</a></li><li><a href="?case=marked">Annotated article</a></li><li><a href="?case=public">Anonymous public Outline</a></li></ul>'
})
