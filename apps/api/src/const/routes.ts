// Paths served by the AI Worker. Edge forwards these to AIGC and every other API path to Core;
// script/gen-routers.ts generates each Worker's router from the same list.
export const AI_ROUTES: readonly string[] = [
  '/v1/aigc/summaries',
  '/v1/aigc/chat',
  '/v1/bookmark/overview',
  '/v1/bookmark/outline',
  '/v1/bookmark/search',
  '/v1/search',
  '/v1/recommendations/articles',
  '/v1/recommendations/collections',
  '/v1/recommendations/feedback',
  '/v1/bookmark/vector/refresh',
  '/v1/bookmark/preference/refresh',
  '/v1/collection/vector/refresh',
  '/v1/collection/preference/refresh'
]

// Matches the generated routers (itty-router), which also serve a route followed by trailing slashes.
export const isAiRoute = (pathname: string): boolean => AI_ROUTES.includes(pathname.replace(/\/+$/, ''))
