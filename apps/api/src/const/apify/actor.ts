export async function buildRedditParam(url: string) {
  return `{
  "debugMode": false,
  "ignoreStartUrls": false,
  "includeNSFW": true,
  "maxComments": 10,
  "maxCommunitiesCount": 2,
  "maxItems": 10,
  "maxPostCount": 10,
  "maxUserCount": 2,
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  },
  "scrollTimeout": 40,
  "searchComments": false,
  "searchCommunities": false,
  "searchPosts": true,
  "searchUsers": false,
  "skipComments": true,
  "skipCommunity": true,
  "skipUserPosts": true,
  "sort": "new",
  "startUrls": [
    {
      "url": "${url}",
      "method": "GET"
    }
  ]
}`
}
