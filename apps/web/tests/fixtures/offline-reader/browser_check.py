"""Run against the production worker and the opt-in offline-reader Nuxt layer."""
import os
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright

origin = os.getenv("READER_ORIGIN", "http://127.0.0.1:4187")
cache = "slax-public-reader-v1"


def revision(value):
    with urlopen(Request(origin + "/api/content/offline-fixture-state/" + value, method="POST")) as response:
        assert response.status == 200


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.getenv("CHROME_BIN"))
    for width, theme in [(390, "light"), (768, "eink"), (1280, "dark")]:
        revision("first")
        context = browser.new_context(viewport={"width": width, "height": 850})
        context.add_cookies([{"name": "slax-color-mode", "value": theme, "url": origin}])
        page = context.new_page()
        page.goto(origin + "/s/offline-share", wait_until="domcontentloaded")
        page.get_by_text("first article paragraph 60.", exact=True).scroll_into_view_if_needed()
        page.wait_for_function("navigator.serviceWorker.controller !== null")
        page.wait_for_function("async name => !!(await (await caches.open(name)).match('/s/offline-share'))", arg=cache)
        for address in ["/b/offline-public", "/s/offline-share"]:
            context.set_offline(True)
            page.goto(origin + address, wait_until="domcontentloaded")
            text = page.locator("article").inner_text()
            assert "first article paragraph 1." in text and text.endswith("first article paragraph 60.")
            assert "Offline" in page.locator("header").inner_text()
            assert page.locator("html").get_attribute("data-slax-theme") == theme
            assert "Account annotation sentinel" not in page.content()
        page.goto(origin + "/b/offline-unvisited")
        assert "unavailable offline" in page.locator("h1").inner_text(), (page.url, page.locator("h1").inner_text(), page.locator("body").inner_text()[:90], page.evaluate("async () => (await (await caches.open('slax-public-reader-v1')).keys()).map(x => x.url)"))

        context.set_offline(False)
        revision("updated")
        page.goto(origin + "/b/offline-public")
        page.get_by_text("updated article paragraph 60.", exact=True).wait_for()
        page.wait_for_function("async name => (await (await (await caches.open(name)).match('/b/offline-public')).json()).text.includes('updated')", arg=cache)
        context.set_offline(True)
        page.goto(origin + "/s/offline-share")
        actual = page.locator("article").inner_text()
        assert actual.endswith("updated article paragraph 60."), (page.url, actual[:80], actual[-100:], page.locator("header").first.inner_text()[:120])
        context.set_offline(False)
        revision("revoked")
        page.get_by_role("link", name="Retry").click()
        page.wait_for_function("async name => !(await (await caches.open(name)).match('/b/offline-public'))", arg=cache)
        context.set_offline(True)
        page.goto(origin + "/s/offline-share")
        assert "unavailable offline" in page.locator("h1").inner_text(), (page.url, page.locator("h1").inner_text(), page.locator("body").inner_text()[:90], page.evaluate("async () => (await (await caches.open('slax-public-reader-v1')).keys()).map(x => x.url)"))

        context.set_offline(False)
        revision("first")
        context.add_cookies([{"name": "slax_reader_test", "value": "synthetic-owner", "url": origin}])
        with page.expect_response(lambda response: "/api/content/offline-private" in response.url and response.status == 404):
            document = page.goto(origin + "/b/offline-private", wait_until="domcontentloaded")
            assert document.status == 200 and "Owner-only body sentinel" in document.text()
        context.set_offline(True)
        page.goto(origin + "/b/offline-private")
        assert "unavailable offline" in page.locator("h1").inner_text() and "Owner-only" not in page.content()
        context.close()
        print(f"{width}px / {theme}: public reread, freshness, revocation, alias and owner isolation passed", flush=True)
    browser.close()
