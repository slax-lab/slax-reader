"""Generate deterministic, synthetic native-acceptance inputs; never open a user database."""
from copy import deepcopy
from hashlib import sha256, md5
from base64 import b64encode
from html import escape
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STAMP = "2026-10-10T04:00:00Z"
FUTURE = "2080-01-01T00:00:00Z"
PAST = "2000-01-01T00:00:00Z"
IDS = {name: f"{index:08d}-0000-4000-8000-000000000001" for index, name in enumerate([
    "user", "other", "mixed", "long", "video", "pending", "failed", "starred", "archived",
    "tag", "collection", "closed", "expired", "owner", "line", "comment", "reply", "deleted-root", "live-child", "image-mark", "overlap", "approximate",
], 1)}

mixed = '''<article id="reader-fixture"><p id="first">Alpha <strong>bold</strong> end.</p><p id="second">Second paragraph with quote.</p><h2 id="outline">A stable outline heading</h2><p>中文段落验证字体回退、换行与标点。Mixed English and Chinese content stays identical across both applications.</p><ul><li>One</li><li>Two with <em>emphasis</em></li></ul><ol><li>Ordered item</li><li>Another item</li></ol><blockquote>A quote with a <a href="https://fixture-pages.test/original">public original link</a>.</blockquote><pre><code>const value = 42;
console.log(value &lt; 50);</code></pre><table><thead><tr><th>Heading A</th><th>Heading B</th></tr></thead><tbody><tr><td>Cell A</td><td>Cell B</td></tr></tbody></table><p><span class="katex">x² + y²</span></p><img id="fixture-image" src="https://fixture-images.test/success.png" alt="Fixture artwork"><img id="fixture-failure" src="https://fixture-images.test/failure.png" alt="Unavailable fixture image"><details><summary>More</summary><p>Expandable content</p></details><p id="escaped-quote">The quote says `hello` and ${value}.</p><h3 id="last-heading">Final heading</h3><p>Final paragraph for scroll restoration and outline anchors.</p></article>'''
long = '<article id="long-fixture"><h2 id="long-start">Long fixture</h2>' + ''.join(f'<p id="paragraph-{index}">Paragraph {index:02d}. This fixed paragraph exercises scrolling, restored reading position, and native text selection. 此段落内容固定，用于核对滚动位置和中文排版。</p>' for index in range(1, 81)) + '<h2 id="long-end">End of fixture</h2></article>'
cues = [{"t": 0, "text": "Opening fixture cue."}, {"t": 42, "text": "Transcript fixture cue at 42 seconds."}, {"t": 84, "text": "字幕段落，用于滚动和定位。"}]
encoded_cues = escape(json.dumps(cues, ensure_ascii=False), quote=True)
transcript = ''.join(f'<p class="slax-yt-cue"><span class="slax-yt-cue-time" data-yt-seek="{cue["t"]}" role="button" tabindex="0">{cue["t"] // 60}:{cue["t"] % 60:02d}</span> <span class="slax-yt-cue-text">{escape(cue["text"])}</span></p>' for cue in cues)
video = f'<article id="video-fixture"><h2>Video fixture</h2><div class="slax-yt"><youtube-player data-video-id="abcdefghijk" data-cues="{encoded_cues}"><iframe src="https://www.youtube.com/embed/abcdefghijk" style="width:100%;aspect-ratio:16/9;border:0;" frameborder="0" allowfullscreen></iframe></youtube-player><div class="slax-yt-transcript">{transcript}</div></div><p>Player events are supplied by the fixture adapter; live YouTube is disabled in deterministic capture.</p></article>'
rss_html = '<article><h2>Feed heading</h2><p>Feed-provided <strong>bold</strong> content with <em>emphasis</em>.</p><ul><li>Feed item</li></ul><blockquote>Feed quote</blockquote><pre>fixture code</pre><p><a href="https://fixture-pages.test/rss-original">Original article</a></p><img src="https://fixture-images.test/rss.png?m=rss&amp;d=fixture-only" alt="Feed artwork"></article>'
htmls = {"mixed.html": mixed, "long.html": long, "video.html": video, "rss.html": rss_html, "short.html": '<article><p>One short article. 一篇简短文章。</p></article>', "delete-notice.html": '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Account deletion notice</h1>' + ''.join(f'<p>Notice paragraph {index:02d}. Deleting the synthetic fixture account cannot be undone.</p>' for index in range(1, 31)) + '<p id="notice-end">End of notice</p></body></html>',
         "terms.html": '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Controlled terms fixture</h1><p>Identical synthetic agreement content for source and Expo capture. This does not verify the remote terms document.</p><p>固定用户协议内容，用于比较原版和 Expo 的协议容器。</p></body></html>',
         "privacy.html": '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Controlled privacy fixture</h1><p>Identical synthetic privacy content for source and Expo capture. No provider account or remote document is used.</p><p>固定隐私政策内容，用于比较原版和 Expo 的协议容器。</p></body></html>'}
(ROOT / "articles").mkdir(parents=True, exist_ok=True)
for name, html in htmls.items():
    (ROOT / "articles" / name).write_text(html + "\n", encoding="utf-8")
(ROOT / "documents.ts").write_text('/** Generated from the pinned fixture HTML, for Metro without an extra asset loader. */\nexport const fixtureDocuments: Record<string, string> = ' + json.dumps({f'articles/{name}': html + '\n' for name, html in htmls.items()}, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
image_urls = ['https://fixture-images.test/success.png', 'https://fixture-images.test/failure.png', 'https://fixture-images.test/rss.png?m=rss&d=fixture-only']
artwork = (ROOT.parent / 'assets/drawable/ic_app_logo.png').read_bytes()
(ROOT / "resources.ts").write_text('/** Generated only from copied mobile artwork and synthetic image URLs. */\nexport const fixtureArtworkBase64 = ' + json.dumps(b64encode(artwork).decode('ascii')) + ';\nexport const fixtureImageHashes: Record<string, string> = ' + json.dumps({url: md5(url.encode()).hexdigest() for url in image_urls}, indent=2) + ';\n', encoding='utf-8')

def dumps(value): return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
def bookmark(name, title, *, status="success", starred=0, archived=0, url=None):
    bid = IDS[name]
    metadata = {"tags": [IDS["tag"]] if name == "mixed" else [], "bookmark": {"uuid": bid, "title": title, "target_url": url or f"https://fixture-pages.test/{name}", "host_url": "https://fixture-pages.test", "site_name": "Fixture Site", "description": "", "byline": "Fixture Author", "published_at": STAMP, "status": status, "content_cover": "", "content_icon": "", "content_word_count": 1200}}
    return {"id": bid, "user_id": IDS["user"], "alias_title": "", "created_at": STAMP, "updated_at": STAMP, "starred_at": STAMP if starred else "", "archived_at": STAMP if archived else "", "deleted_at": None, "is_read": 0, "is_starred": starred, "archive_status": archived, "type": 0, "metadata": dumps(metadata)}

records = [bookmark("mixed", "A fixed title with English and 中文 for line wrapping, images, tables, formulas, comments and highlights"), bookmark("long", "Long article for scroll restoration"), bookmark("video", "Video and transcript fixture", url="https://www.youtube.com/watch?v=abcdefghijk"), bookmark("pending", "Article still being processed", status="pending"), bookmark("failed", "Article parsing failed", status="failed"), bookmark("starred", "Starred fixture", starred=1), bookmark("archived", "Archived fixture", archived=1)]
cross_source = [{"type": "text", "path": "div:nth-child(1) > article#reader-fixture > p#first > strong", "start": 0, "end": 4}, {"type": "text", "path": "div:nth-child(1) > article#reader-fixture > p#first", "start": 10, "end": 15}, {"type": "text", "path": "div:nth-child(1) > article#reader-fixture > p#second", "start": 0, "end": 6}]
def mark(name, type_, *, source=None, comment="", user="user", root=None, parent=None, deleted=0, approximate=None):
    return {"id": IDS[name], "type": type_, "user_bookmark_uuid": IDS["mixed"], "source": dumps(source if source is not None else cross_source), "approx_source": dumps(approximate) if approximate else "", "content": dumps([{"type": "text", "text": "bold end.Second", "src": ""}]), "comment": comment, "is_deleted": deleted, "created_at": STAMP, "metadata": dumps({"user_id": IDS[user], "root_id": IDS[root] if root else None, "parent_id": IDS[parent] if parent else None, "source_type": None, "source_id": None, "bookmark_id": IDS["mixed"]})}
marks = [mark("line", 1), mark("overlap", 1, user="other", source=[cross_source[0]]), mark("comment", 2, comment="A fixed comment. 固定评论内容。"), mark("reply", 3, comment="Reply to the fixed comment.", root="comment", parent="comment", user="other"), mark("deleted-root", 2, comment="Deleted ancestor", deleted=1), mark("live-child", 3, comment="This live reply keeps its deleted ancestor in the thread.", root="deleted-root", parent="deleted-root"), mark("image-mark", 1, source=[{"type": "image", "path": "div:nth-child(1) > article#reader-fixture > img#fixture-image"}]), mark("approximate", 1, source=[], approximate={"exact": "Second paragraph with quote.", "prefix": "end.", "suffix": "A stable outline heading", "position_start": 20, "position_end": 48, "raw_text": "Second paragraph with quote."})]
profiles = [{"uuid": IDS["user"], "uid": IDS["user"], "nick_name": "Fixture Reader", "avatar": ""}, {"uuid": IDS["other"], "uid": IDS["other"], "nick_name": "Other Fixture Reader", "avatar": ""}]
overview = "A deterministic summary of the mixed article.\n固定摘要用于核对中英文排版。"
outline = "# Article outline\n\n- [A stable outline heading](#outline)\n  - [Final heading](#last-heading)\n"
local = [{"id": record["id"], "data": dumps({"id": record["id"], "is_downloaded": index % 4, "is_auto_cached": 1, "read_position": "240.0", "outline_read_position": "0.0", "overview": overview if index == 0 else "", "outline": outline if index == 0 else "", "key_takeaways": dumps(["First fixed takeaway", "第二条固定要点"]), "mark_users": dumps(profiles)})} for index, record in enumerate(records)]
collections = [{"id": IDS[name], "owner_id": IDS["owner"], "display_name": label, "avatar": "", "description": "Synthetic collection", "collection_code": f"fixture-{name}", "status": status, "type": 1, "updated_at": STAMP} for name, label, status in [("collection", "Active Collection", 1), ("closed", "Closed Collection", 0), ("expired", "Expired Collection", 1)]]
collection_bookmark = {"id": IDS["mixed"], "owner_id": IDS["owner"], "alias_title": "Shared fixture title", "metadata": records[0]["metadata"], "starred_at": STAMP, "created_at": STAMP, "updated_at": STAMP}
collection_key = f'collection-{IDS["owner"]}-{IDS["mixed"]}'
base = {"settings": {"user_language": "en", "cache_count": 50, "download_images": 1, "user_setting_detail_do_not_alert": "true", "continue_reading_bookmark": dumps({"bookmarkId": IDS["mixed"], "title": "Continue with the fixed article", "collectionOwnerId": None, "collectionId": None})}, "session": {"userId": IDS["user"], "token": "fixture-only-never-use-for-auth", "refreshedAt": 1791604800}, "database": {"sr_user": [{"id": IDS["user"], "name": "Fixture Reader", "email": "reader@example.test", "picture": "", "lang": "en", "ai_lang": "en", "timezone": "UTC"}], "sr_user_tag": [{"id": IDS["tag"], "user_id": IDS["user"], "tag_name": "Fixture tag", "display": "1", "source": "mine", "created_at": STAMP}], "sr_user_bookmark": records, "sr_bookmark_comment": marks, "sr_user_subscription": [{"id": IDS["user"], "subscribed": 1, "subscription_end_time": FUTURE, "source_type": "apple", "auto_renew": 0}], "sr_user_collection": collections, "sr_user_collection_subscriber": [{"id": f'subscriber-{item["id"]}', "collection_id": item["id"], "owner_id": item["owner_id"], "created_at": STAMP, "last_read_at": PAST, "subscription_end_time": PAST if item["id"] == IDS["expired"] else FUTURE, "is_cancelled": 0, "auto_renew": 0} for item in collections], "sr_collection_bookmark": [collection_bookmark], "sr_sharer_setting": [{"id": IDS["owner"], "allow_highlight": 0, "show_highlight": 1, "allow_access": 1}], "ps_data_local__local_bookmark_info": local + [{"id": collection_key, "data": dumps({"id": collection_key, "is_downloaded": 2, "is_auto_cached": 1, "read_position": "120.0", "overview": overview, "outline": outline})}]}, "cache": [{"bookmarkId": IDS[name], "key": IDS[name], "htmlFile": f"articles/{file}"} for name, file in [("mixed", "mixed.html"), ("long", "long.html"), ("video", "video.html"), ("starred", "short.html"), ("archived", "short.html")]] + [{"bookmarkId": IDS["mixed"], "ownerId": IDS["owner"], "key": collection_key, "htmlFile": "articles/mixed.html"}], "network": {"isConnected": True, "isInternetReachable": True}, "sync": {"connected": True, "connecting": False, "hasSynced": True, "uploading": False, "downloading": False}, "api": []}

rss_source = {"id": "rss-fixture", "feed_url": "https://fixture-pages.test/feed.xml", "title": "Fixture Feed", "remark": None, "site_url": "https://fixture-pages.test", "icon_url": None, "refreshing": False, "last_checked_at": STAMP, "last_success_at": STAMP, "next_fetch_at": FUTURE, "next_allowed_at": PAST, "error": None}
rss_entries = [{"id": f"rss-entry-{index}", "subscription_id": rss_source["id"], "source_title": rss_source["title"], "title": title, "author": "Fixture Feed Author", "summary": "A deterministic feed summary. 固定 RSS 摘要。", "article_url": f"https://fixture-pages.test/rss-{index}", "image_url": "https://fixture-images.test/rss.png?m=rss&d=fixture-only" if index == 1 else None, "published_at": STAMP, "first_seen_at": STAMP, "bookmark_user_uuid": IDS["mixed"] if index == 2 else None} for index, title in [(1, "An unsaved RSS entry"), (2, "An already saved RSS entry")]]
def response(path, data=None, *, method="GET", query=None, body=None, status=200, error=None, text=None, delay=0):
    route = {"method": method, "path": path, "query": query or {}, "status": status, "delayMs": delay}
    if body is not None: route["requestBody"] = body
    if text is not None: route.update({"contentType": "text/event-stream" if path.endswith(("overview", "outline")) else "text/html", "text": text})
    else: route["json"] = {"code": status, "message": "Fixture response" if error is None else error, "data": {"error": error} if error else data}
    return route
base["api"] = [response("/v1/user/labs", {"features": [{"key": "rss", "enabled": True}]}), response("/v1/rss/subscriptions", {"items": [rss_source]}), response("/v1/rss/entries", {"items": rss_entries, "next_cursor": "fixture-page-2", "has_more": True, "cached_more": True, "history_status": "available", "retry_at": None}), response("/v1/rss/entries", {"items": [dict(rss_entries[0], id="rss-entry-history", title="Earlier fixed RSS entry")], "next_cursor": None, "has_more": False, "cached_more": False, "history_status": "exhausted", "retry_at": None}, query={"cursor": "fixture-page-2"}), response("/v1/rss/entries/rss-entry-1", dict(rss_entries[0], content_html=rss_html, content_source="feed", content_truncated=False)), response("/v1/rss/entries/rss-entry-2", dict(rss_entries[1], content_html=rss_html, content_source="feed", content_truncated=False)), response("/v1/rss/entries/rss-entry-1/save", {"bookmark_user_uuid": IDS["mixed"], "result": "created", "processing_status": "ready"}, method="POST"), response("/v1/rss/subscriptions/rss-fixture/refresh", {"status": "accepted", "next_allowed_at": FUTURE}, method="POST"), response("/v1/user/report", "fixture-report-id", method="POST"), response("/v1/user/delete_my_account", {"canDelete": True, "reason": None}, method="POST"), response("/v1/user/setting/enable", True, method="POST"), response("/v1/user/setting/disable", True, method="POST")]
for name, file in [("mixed", "mixed.html"), ("long", "long.html"), ("video", "video.html")]:
    base["api"].append(response("/v1/bookmark/content", method="POST", body={"bookmark_uid": IDS[name]}, text=htmls[file]))
base["api"].append(response("/v1/mark/users", profiles, query={"bookmark_uid": IDS["mixed"]}))
base["api"].append(response("/v1/bookmark/overview", method="POST", text="\n".join(dumps(item) for item in [{"type": "overview", "data": {"overview": "A deterministic "}}, {"type": "overview", "data": {"overview": "streamed summary."}}, {"type": "key_takeaways", "data": {"key_takeaways": ["First fixed takeaway", "第二条固定要点"]}}, {"type": "done", "data": {"done": True}}]) + "\n"))
base["api"].append(response("/v1/bookmark/outline", method="POST", text="\n".join(dumps(item) for item in [{"type": "outline", "data": {"outline": "# Article outline\n"}}, {"type": "outline", "data": {"outline": outline}}, {"type": "done", "data": {"done": True}}]) + "\n"))
for route in base["api"]:
    if route["path"] in ["/v1/bookmark/overview", "/v1/bookmark/outline"]:
        route["chunks"] = [{"text": line + "\n", "delayMs": 250 if index else 0} for index, line in enumerate(route["text"].splitlines())]

scenarios = {}
def add(name, route, *, edits=None, actions=None):
    value = deepcopy(base)
    if edits: edits(value)
    scenarios[name] = {"route": route, "payload": value, "actions": actions or [], "nativeExecution": "pending-adapter-and-device"}
add("library-populated", {"name": "Library"})
add("library-empty", {"name": "Library"}, edits=lambda v: v["database"].update({"sr_user_bookmark": [], "sr_user_collection": [], "sr_user_collection_subscriber": []}))
add("library-unsynced", {"name": "Library"}, edits=lambda v: (v["database"].update({"sr_user_bookmark": []}), v["sync"].update({"connected": False, "connecting": True, "hasSynced": False})))
add("offline-cached", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"]}}, edits=lambda v: (v["network"].update({"isConnected": False, "isInternetReachable": False}), v["sync"].update({"connected": False}), v.update({"api": [], "unmatchedRequest": "offline-error"})))
add("reader-mixed", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"]}}, actions=[{"kind": "selection", "source": cross_source, "selectedText": "bold end.Second"}, {"kind": "open-comment", "markId": IDS["comment"]}, {"kind": "open-overview"}, {"kind": "open-outline"}, {"kind": "open-image", "imageId": "fixture-image"}])
add("reader-long", {"name": "Reader", "params": {"bookmarkId": IDS["long"]}}, actions=[{"kind": "scroll", "target": "#paragraph-40"}, {"kind": "background-flush"}, {"kind": "native-back"}, {"kind": "resume"}])
add("reader-video", {"name": "Reader", "params": {"bookmarkId": IDS["video"]}}, actions=[{"kind": "video-event", "state": "playing", "seconds": 42}, {"kind": "open-transcript"}, {"kind": "tap-cue", "seconds": 84}, {"kind": "native-back"}])
add("reader-collection", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"], "collectionOwnerId": IDS["owner"], "collectionId": IDS["collection"]}})
def reader_content_error(value):
    value["cache"] = []
    failure = response("/v1/bookmark/content", method="POST", body={"bookmark_uid": IDS["mixed"]}, status=503, error="source_unavailable")
    # Original ErrorResponse.data is nullable text, as emitted by the API contract.
    failure["json"]["data"] = "source_unavailable"
    value["api"].insert(0, failure)
add("reader-load-error", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"]}}, edits=reader_content_error)
def empty_ai(value):
    for row in value["database"]["ps_data_local__local_bookmark_info"]:
        data = json.loads(row["data"])
        data.update({"overview": "", "outline": "", "key_takeaways": ""})
        row["data"] = dumps(data)
add("reader-ai-empty", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"]}}, edits=empty_ai, actions=[{"kind": "open-overview"}, {"kind": "open-outline"}])
add("reader-ai-stream", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"]}}, edits=empty_ai, actions=[{"kind": "open-overview"}, {"kind": "generate-overview"}, {"kind": "capture-stream-chunk", "index": 1}, {"kind": "wait-stream-done"}, {"kind": "open-outline"}, {"kind": "generate-outline"}, {"kind": "capture-stream-chunk", "index": 1}, {"kind": "wait-stream-done"}])
add("reader-ai-error", {"name": "Reader", "params": {"bookmarkId": IDS["mixed"]}}, edits=lambda v: (empty_ai(v), v["api"].insert(0, response("/v1/bookmark/overview", method="POST", status=503, error="source_unavailable")), v["api"].insert(0, response("/v1/bookmark/outline", method="POST", status=503, error="source_unavailable"))), actions=[{"kind": "open-overview"}, {"kind": "generate-overview"}, {"kind": "open-outline"}, {"kind": "generate-outline"}])
add("rss-populated", {"name": "Library"}, actions=[{"kind": "select-list", "list": "rss"}, {"kind": "select-source", "id": rss_source["id"]}])
add("rss-disabled", {"name": "Settings"}, edits=lambda v: v["api"].insert(0, response("/v1/user/labs", {"features": [{"key": "rss", "enabled": False}]})))
add("rss-error", {"name": "Library"}, edits=lambda v: v["api"].insert(0, response("/v1/rss/entries", status=503, error="source_unavailable")), actions=[{"kind": "select-list", "list": "rss"}])
add("rss-truncated", {"name": "Reader", "params": {"bookmarkId": "", "rssEntryId": "rss-entry-1"}}, edits=lambda v: v["api"].insert(0, response("/v1/rss/entries/rss-entry-1", dict(rss_entries[0], content_html=rss_html, content_source="feed", content_truncated=True))))
add("rss-history-loading", {"name": "Library"}, edits=lambda v: v["api"].insert(0, response("/v1/rss/entries", {"items": rss_entries, "next_cursor": None, "has_more": True, "cached_more": False, "history_status": "loading", "retry_at": None})), actions=[{"kind": "select-list", "list": "rss"}])
add("rss-history-retry", {"name": "Library"}, edits=lambda v: v["api"].insert(0, response("/v1/rss/entries", {"items": rss_entries, "next_cursor": None, "has_more": True, "cached_more": False, "history_status": "error", "retry_at": FUTURE})), actions=[{"kind": "select-list", "list": "rss"}, {"kind": "load-history", "expectDisabled": True}])
add("rss-refresh-limited", {"name": "Library"}, edits=lambda v: v["api"].insert(0, response("/v1/rss/subscriptions", {"items": [dict(rss_source, next_allowed_at=FUTURE)]})), actions=[{"kind": "select-list", "list": "rss"}, {"kind": "select-source", "id": rss_source["id"]}, {"kind": "source-menu"}])
add("rss-save-error", {"name": "Reader", "params": {"bookmarkId": "", "rssEntryId": "rss-entry-1"}}, edits=lambda v: v["api"].insert(0, response("/v1/rss/entries/rss-entry-1/save", method="POST", status=503, error="source_unavailable")), actions=[{"kind": "save-rss"}])
add("settings", {"name": "Settings"})
add("feedback-error", {"name": "Feedback", "params": {"bookmarkId": IDS["mixed"], "targetUrl": "https://fixture-pages.test/mixed", "title": "Fixed article title", "entryPoint": "detail"}}, edits=lambda v: v["api"].insert(0, response("/v1/user/report", method="POST", status=400, error="fixture_feedback_error")), actions=[{"kind": "type", "testID": "feedback_input", "text": "A fixed feedback message"}, {"kind": "press", "testID": "feedback_submit"}])
add("delete-blocked", {"name": "DeleteAccount"}, edits=lambda v: v["api"].insert(0, response("/v1/user/delete_my_account", {"canDelete": False, "reason": "active_subscription"}, method="POST")), actions=[{"kind": "scroll", "target": "#notice-end"}, {"kind": "press-delete"}, {"kind": "confirm-delete"}])
add("upgrade-pending", {"name": "Library"}, edits=lambda v: v.update({"pendingCrud": [{"op": "PUT", "table": "sr_user_bookmark", "id": IDS["pending"], "data": records[3]}, {"op": "PATCH", "table": "sr_user_bookmark", "id": IDS["mixed"], "data": {"alias_title": "Pending offline edit"}}], "upgrade": {"ownership": "verification-required", "expectedWritesBeforeVerification": 0}}))
def login_fixture(value, outcome="cancel"):
    value["session"].update({"token": "", "userId": ""})
    value["authentication"] = {"outcome": outcome, "delayMs": 250, "message": "Synthetic provider failure"}
    value["api"].append(response("/v1/user/login", {"token": "fixture-only-never-use-for-auth", "user_id": IDS["user"]}, method="POST", delay=250))
add("login", {"name": "Login"}, edits=login_fixture)
add("login-agreements", {"name": "Login"}, edits=login_fixture, actions=[{"kind": "begin-login", "provider": "google"}, {"kind": "select-agreement", "agreement": "privacy"}, {"kind": "dismiss-agreement"}])
add("login-cancelled", {"name": "Login"}, edits=login_fixture, actions=[{"kind": "begin-login", "provider": "google"}, {"kind": "accept-agreement"}])
add("login-error", {"name": "Login"}, edits=lambda v: login_fixture(v, "error"), actions=[{"kind": "begin-login", "provider": "google"}, {"kind": "accept-agreement"}])
add("login-success", {"name": "Login"}, edits=lambda v: login_fixture(v, "success"), actions=[{"kind": "begin-login", "provider": "google"}, {"kind": "accept-agreement"}])

def pdf_fixture(name, identifier, document, title, overview, page, offline=False):
    record = bookmark("mixed", title, url=f"https://fixture-pages.test/{document}.pdf")
    record.update({"id": identifier, "type": 2})
    metadata = json.loads(record["metadata"])
    metadata["tags"] = []
    metadata["bookmark"].update({"uuid": identifier, "type": 2, "site_name": "Fixture PDF", "content_word_count": 600 if document == "long-pages" else 260 if document == "thirteen-pages" else 160})
    record["metadata"] = dumps(metadata)
    database = {table: [] for table in base["database"]}
    database.update({"sr_user": deepcopy(base["database"]["sr_user"]), "sr_user_bookmark": [record],
                     "ps_data_local__local_bookmark_info": [{"id": identifier, "data": dumps({"id": identifier, "is_downloaded": 0, "is_auto_cached": 1, "overview": overview, "outline": f"- [Page {page}](#page={page})", "mark_users": "[]"})}]})
    plan = {"bookmarkId": identifier, "document": document}
    if offline: plan["prepare"] = "complete"
    actions = [{"kind": "pdf-cache-status"}]
    if not offline: actions += [{"kind": "pdf-fill-cache"}, {"kind": "pdf-network-offline"}]
    actions += [{"kind": "background-flush"}, {"kind": "pdf-cache-status"}, {"kind": "pdf-network-online"}]
    scenarios[name] = {"route": {"name": "Reader", "params": {"bookmarkId": identifier}}, "payload": {
        "settings": {"user_language": "en", "cache_count": 0, "download_images": 0, "user_setting_detail_do_not_alert": "true"},
        "session": deepcopy(base["session"]), "database": database, "cache": [], "pdf": [plan],
        "network": {"isConnected": not offline, "isInternetReachable": not offline}, "sync": dict(base["sync"], connected=not offline),
        "api": [response("/v1/user/labs", {"features": [{"key": "pdf", "enabled": True}, {"key": "rss", "enabled": False}]}), response("/v1/mark/users", [])],
    }, "actions": actions, "nativeExecution": "pending-adapter-and-device"}

pdf_fixture("reader-pdf", "fixture-pdf-eight", "eight-pages", "Eight-page selectable PDF fixture", "Eight deterministic PDF pages, including a rotated third page.", 3)
pdf_fixture("reader-pdf-odd", "fixture-pdf-odd", "thirteen-pages", "13-page adaptive PDF fixture", "Thirteen synthetic pages for spread pairing and odd-final-page interaction.", 13)
pdf_fixture("reader-pdf-long", "fixture-pdf-long", "long-pages", "Thirty-page PDF range fixture", "Thirty deterministic PDF pages for bounded rendering and cache ranges.", 20)
pdf_fixture("reader-pdf-offline", "fixture-pdf-offline", "eight-pages", "Fully cached offline PDF fixture", "A PDF cached through the production queue before the network becomes unavailable.", 3, offline=True)
pdf_fixture("reader-pdf-import", "fixture-pdf-imported", "eight-pages", "Synthetic native PDF import", "The native picker copied the seeded PDF; upload and delayed synchronization are simulated locally.", 3)
import_scenario = scenarios["reader-pdf-import"]
import_scenario["route"] = {"name": "Library"}
import_scenario["actions"] = [{"kind": "open-add-link"}, {"kind": "pdf-cache-status"}]
import_scenario["payload"]["nativePdfImport"] = {"bookmarkId": "fixture-pdf-imported", "syncDelayMs": 2000,
    "rows": {table: import_scenario["payload"]["database"][table] for table in ["sr_user_bookmark", "ps_data_local__local_bookmark_info"]}}
for table in import_scenario["payload"]["nativePdfImport"]["rows"]:
    import_scenario["payload"]["database"][table] = []
pdf_fixture("reader-pdf-native-storage", "fixture-pdf-native", "long-pages", "Native production PDF storage fixture", "Thirty pages served in delayed ranges through the actual production file adapter.", 20)
scenarios["reader-pdf-native-storage"]["route"] = {"name": "Library"}
scenarios["reader-pdf-native-storage"]["actions"] = [{"kind": "pdf-production-storage"}, {"kind": "pdf-fill-cache"}, {"kind": "pdf-cache-status"}, {"kind": "pdf-network-offline"}, {"kind": "pdf-network-online"}]
pdf_fixture("reader-pdf-http", "fixture-pdf-http", "long-pages", "Loopback HTTP PDF fixture", "Real Expo HTTP transport and native owner enforcement with synthetic PDF bytes only.", 20)
scenarios["reader-pdf-http"]["payload"]["session"]["token"] = "slax-pdf-loopback-synthetic-only"
scenarios["reader-pdf-http"]["payload"]["api"] = []
scenarios["reader-pdf-http"]["actions"] = [{"kind": "pdf-production-storage"}, {"kind": "pdf-fill-cache"}, {"kind": "pdf-cache-status"}, {"kind": "pdf-http-status"}, {"kind": "pdf-http-mode", "mode": "metadata-404"}, {"kind": "pdf-http-mode", "mode": "normal"}, {"kind": "pdf-http-mode", "mode": "slow"}]

bundle = {"schemaVersion": 1, "synthetic": True, "clock": STAMP, "apiOrigin": "https://fixture-api.test", "webOrigin": "https://fixture-pages.test", "ids": IDS, "artwork": {"https://fixture-images.test/success.png": {"asset": "../assets/drawable/ic_app_logo.png"}, "https://fixture-images.test/rss.png?m=rss&d=fixture-only": {"asset": "../assets/drawable/ic_app_logo.png"}, "https://fixture-images.test/failure.png": {"status": 404}}, "documents": {"/delete-account-notice": "articles/delete-notice.html"}, "scenarios": scenarios}
output = ROOT / "scenarios.json"
output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
manifest = {"schemaVersion": 1, "synthetic": True, "nativeExecution": "pending-adapter-and-device", "files": [{"path": "scenarios.json", "sha256": sha256(output.read_bytes()).hexdigest()}] + [{"path": f"articles/{name}", "sha256": sha256((ROOT / "articles" / name).read_bytes()).hexdigest()} for name in sorted(htmls)] + [{"path": name, "sha256": sha256((ROOT / name).read_bytes()).hexdigest()} for name in ['documents.ts', 'resources.ts']], "scenarioCount": len(scenarios), "sourceCheckoutModified": False}
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(scenarios)} synthetic scenarios and {len(htmls)} documents; native adapters/capture remain pending.")
