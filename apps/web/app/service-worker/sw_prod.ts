/// <reference lib="WebWorker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, Strategy } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

const dwebAPIBaseUrl = process.env.__DWEB_API_BASE_URL__
const requestCacheEnable = false
const strategies: [(url: URL, request: Request) => boolean, Strategy][] = requestCacheEnable
  ? [
      [
        (url, request) => request.destination === 'image' || /\.(?:png|jpg|jpeg|svg|gif|webp|woff|woff2|json)$/.test(url.pathname),
        new CacheFirst({
          cacheName: 'images-cache',
          plugins: [
            new ExpirationPlugin({
              maxEntries: 60,
              maxAgeSeconds: 30 * 24 * 60 * 60
            })
          ]
        })
      ],
      [
        (url, request) => !!dwebAPIBaseUrl && url.origin.indexOf(dwebAPIBaseUrl) === 0 && request.method === 'GET',
        new NetworkFirst({
          cacheName: 'apis-cache',
          plugins: [
            new ExpirationPlugin({
              maxEntries: 50,
              maxAgeSeconds: 60 * 60 * 24
            }),
            new CacheableResponsePlugin({
              statuses: [0, 200]
            })
          ]
        })
      ]
    ]
  : []

strategies.forEach(([match, strategy]) => registerRoute(({ url, request }) => match(url, request), strategy))
