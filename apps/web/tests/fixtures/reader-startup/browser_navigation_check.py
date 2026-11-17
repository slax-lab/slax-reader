"""Exercise existing highlight/reply/comment/Outline passage locators."""
import sys

from playwright.sync_api import sync_playwright, expect
from browser_check import BASE, OUT, close, context, mounted, position, record


def passage_visible(page):
    rect=page.locator('#passage-40').bounding_box()
    assert rect and rect['y']<700 and rect['y']+rect['height']>70, (rect,position(page))
    return round(rect['y'],2)


with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/Users/yjc/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell')
    for scenario in (['outline'] if '--outline-only' in sys.argv else ['highlight','reply','same-page-highlight','comment-card','outline']):
        ctx,page,state=context(browser)
        page.unroute('**/v1/**')
        ctx.add_cookies([{'name':'reader_marks','value':'1' if scenario!='outline' else '0','url':BASE},{'name':'reader_mark_delay','value':'1500','url':BASE}])
        target='reader-outline' if scenario=='outline' else 'reader-marked'
        query='?local=1&positionDelay=3000'
        if scenario in ['highlight','reply']:
            query+='&highlight='+('reader-reply' if scenario=='reply' else 'reader-mark')
        page.goto(BASE+'/b/'+target+query)
        mounted(page)
        if scenario=='same-page-highlight':
            page.evaluate("window.readerFixture.router.push('/b/reader-marked?local=1&positionDelay=3000&highlight=reader-mark')")
        elif scenario=='comment-card':
            page.locator('.edge-btn').nth(2).click()
            page.locator('.comment-item').first.wait_for(timeout=15000)
            page.locator('.comment-item').first.click()
        elif scenario=='outline':
            page.wait_for_timeout(500)
            page.locator('.edge-btn').first.click()
            page.wait_for_timeout(800)
            page.locator('.panel-outline-text a').first.click()
        page.wait_for_timeout(5000)
        top=passage_visible(page)
        if scenario in ['highlight','reply','same-page-highlight']:
            assert 'highlight=' not in page.url, page.url
        if scenario!='outline':
            assert page.locator('slax-mark').count()>0
        page.wait_for_timeout(1800)
        assert abs(passage_visible(page)-top)<3
        assert not state['errors'], state['errors']
        record(scenario,passage40Top=top,result='existing locator remains stable after late saved-position result')
        page.screenshot(path=str(OUT/(scenario+'.png')))
        close(ctx,page)
    browser.close()
