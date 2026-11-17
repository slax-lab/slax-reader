"""Exercise the real Nuxt reader with disposable accounts, API replies and local DB.
Run the opt-in reader-startup Nuxt layer on localhost:3218 first.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:3218'
OUT = Path('/tmp/slax-reader-startup-evidence')
OUT.mkdir(exist_ok=True)
PROFILE = {'userId': 1, 'email': 'reader@example.invalid', 'name': 'Reader Fixture', 'lang': 'en', 'timezone': 'UTC', 'subscription_end_at': '2099-01-01T00:00:00Z', 'subscription_type': 2}
TOKEN = 'eyJhbGciOiJub25lIn0.eyJpZCI6MX0.synthetic'
results = []

def record(case, **data):
    results.append({'case': case, **data})
    (OUT / (Path(sys.argv[0]).stem + '-results.json')).write_text(json.dumps(results, indent=2))
    print(json.dumps(results[-1]), flush=True)


def context(browser, *, paid=True, hold_profile=False, hold_entry=False, width=1280):
    ctx = browser.new_context(viewport={'width': width, 'height': 800}, record_video_dir=str(OUT / 'video'), record_video_size={'width':1280,'height':800})
    if paid:
        ctx.add_cookies([{'name':'slax_reader_test', 'value':TOKEN, 'url':BASE}])
    ctx.add_init_script("localStorage.setItem('slax:snapshot-panel-auto-open', 'closed')")
    ctx.add_init_script("window.readerPageShows=[]; addEventListener('pageshow', event=>window.readerPageShows.push(event.persisted))")
    ctx.add_init_script("window.readerScrollCalls=[]; const original=window.scrollTo.bind(window); window.scrollTo=(...args)=>{window.readerScrollCalls.push({args,y:scrollY,time:performance.now()});return original(...args)}")
    page = ctx.new_page()
    state = {'profile': [], 'entry': [], 'hold_profile': hold_profile, 'hold_entry':hold_entry, 'errors':[], 'requests':[]}
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    def api(route):
        path = route.request.url.split('?')[0]
        state['requests'].append(path)
        if path.endswith('/me'):
            if state['hold_profile']:
                state['profile'].append(route)
                return
            data = PROFILE
        elif path.endswith('/mark_list'):
            data = {'mark_list':[], 'user_list':{}}
        elif '/sync/' in path:
            route.fulfill(status=503, json={'code':503,'message':'Synthetic sync unavailable'})
            return
        elif '/list' in path or '/summary' in path or '/message' in path:
            data = []
        else:
            data = {}
        route.fulfill(json={'code':200,'message':'ok','data':data})
    page.route('**/v1/**', api)
    def entry(route):
        if state['hold_entry']:
            state['entry'].append(route)
        else:
            route.continue_()
    page.route('**/entry.async.js', entry)
    return ctx, page, state


def release(state, kind='profile', *, inactive=False, failed=False, profile=None):
    state['hold_'+kind] = False
    for route in state[kind][:]:
        if kind == 'entry':
            route.continue_()
        else:
            profile = profile or ({**PROFILE, 'subscription_end_at':'2000-01-01T00:00:00Z'} if inactive else PROFILE)
            route.fulfill(status=503 if failed else 200, json={'code':503 if failed else 200,'message':'Synthetic failure' if failed else 'ok','data':None if failed else profile})
    state[kind].clear()


def mounted(page):
    page.wait_for_function("document.documentElement.dataset.readerMounted === 'true'", timeout=60000)


def position(page):
    return page.evaluate("({y:scrollY, passage:[...document.querySelectorAll('.html-text p')].find(p=>p.getBoundingClientRect().bottom>70)?.id})")


def stable(page, initial, duration=2100):
    page.wait_for_timeout(duration)
    end = position(page)
    assert end['passage'] == initial['passage'] and abs(end['y']-initial['y']) < 64, (initial, end)
    return end


def close(ctx, page):
    page.evaluate("async () => { if(window.readerFixture?.db) { await window.readerFixture.db.disconnect(); await window.readerFixture.db.close(); } }")
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/Users/yjc/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell', ignore_default_args=['--disable-back-forward-cache'])
        if '--permissions-only' not in sys.argv:
            # Delay the entry module independently from saved-position/readiness delays.
            for local in [False, True]:
                ctx, page, state = context(browser, hold_entry=True)
                page.goto(BASE + '/b/reader-one' + ('?local=1' if local else ''), wait_until='commit', timeout=60000)
                expect(page.locator('.html-text p')).to_have_count(100)
                page.mouse.move(450, 400)
                page.mouse.wheel(0, 5500)
                page.wait_for_timeout(300)
                before = position(page)
                assert before['y'] > 1000
                assert page.evaluate('!window.readerFixture')
                release(state, 'entry')
                mounted(page)
                page.wait_for_timeout(2600)
                after = position(page)
                calls = page.evaluate('window.readerScrollCalls')
                assert after['passage'] == before['passage'] and abs(after['y']-before['y']) < 64, (before,after,calls)
                assert not calls, calls
                assert not state['errors'], state['errors']
                record('pre-client-scroll-local' if local else 'pre-client-scroll-rest', before=before, after=after, scrollCalls=calls)
                page.screenshot(path=str(OUT / ('early-local.png' if local else 'early-rest.png')))
                close(ctx, page)

            for scenario, query, interact in [('saved-progress', '?local=1', False), ('readiness-scroll', '?local=1&readyDelay=2000', True), ('lookup-scroll', '?local=1&positionDelay=2000', True)]:
                ctx, page, state = context(browser)
                page.goto(BASE + '/b/reader-one' + query)
                mounted(page)
                if interact:
                    page.wait_for_timeout(300)
                    page.mouse.move(450, 400)
                    page.mouse.wheel(0, 8500)
                    page.wait_for_timeout(250)
                    before = position(page)
                    after = stable(page, before, 3600)
                else:
                    page.wait_for_timeout(2400)
                    after = position(page)
                    assert after['passage'] == 'passage-15', after
                record(scenario, after=after)
                close(ctx, page)

            # Real Vue Router navigation, query-only update, hash and differing history/local state.
            ctx, page, state = context(browser)
            page.goto(BASE + '/b/reader-one?local=1')
            mounted(page)
            page.wait_for_timeout(2200)
            page.mouse.move(450,400)
            page.mouse.wheel(0,5000)
            page.wait_for_timeout(500)
            first = position(page)
            page.evaluate("window.readerFixture.router.push('/b/reader-two')")
            expect(page.locator('h1')).to_contain_text('reader-two')
            page.wait_for_timeout(2200)
            assert position(page)['y'] == 0, position(page)
            record('ordinary-spa-navigation', after=position(page))
            page.evaluate("window.readerFixture.db.execute(\"UPDATE local_reading_state SET anchor_index = 4, anchor_ratio = 0, percent = 0.04 WHERE id = 'reader-one'\")")
            page.evaluate("window.readerFixture.router.back()")
            expect(page.locator('h1')).to_contain_text('reader-one')
            page.wait_for_timeout(2200)
            stable(page, first)
            record('back-history', expected=first, actual=position(page))
            page.evaluate("window.readerFixture.router.forward()")
            expect(page.locator('h1')).to_contain_text('reader-two')
            page.wait_for_timeout(2200)
            assert position(page)['y'] == 0
            record('forward-history', actual=position(page))
            page.evaluate("""async () => {
              const db=window.readerFixture.db;
              await db.execute("INSERT OR REPLACE INTO sr_user_bookmark (id, archive_status, is_starred, type, metadata) VALUES ('reader-three', 0, 0, 0, '{}')");
              await db.execute("INSERT OR REPLACE INTO ps_data_local__local_reading_state (id,data) VALUES ('reader-three', ?)", [JSON.stringify({anchor_index:30,anchor_ratio:0,percent:0.3})]);
              await window.readerFixture.router.push('/b/reader-three');
            }""")
            expect(page.locator('h1')).to_contain_text('reader-three', timeout=15000)
            page.wait_for_timeout(2500)
            assert position(page)['passage']=='passage-31', (position(page),page.evaluate('window.__slaxReaderStartup.navigation'),page.evaluate('window.readerScrollCalls'),page.evaluate("window.readerFixture.db.getOptional(\"SELECT * FROM local_reading_state WHERE id='reader-three'\")"))
            record('ordinary-spa-saved-progress', actual=position(page))
            page.evaluate("window.readerFixture.router.push('/b/reader-one#passage-40')")
            expect(page.locator('h1')).to_contain_text('reader-one')
            page.wait_for_timeout(2200)
            assert position(page)['passage'] in ['passage-40', 'passage-41'], position(page)
            current = position(page)
            page.evaluate("window.readerFixture.router.replace('/b/reader-one?probe=cleanup#passage-40')")
            stable(page,current)
            record('hash-and-query-only', actual=position(page))
            page.evaluate("history.scrollRestoration='auto'; history.replaceState(history.state,'','/b/reader-one?local=1')")
            page.reload(wait_until='commit')
            mounted(page)
            page.wait_for_timeout(2400)
            assert position(page)['passage']=='passage-40', position(page)
            record('reload-native-position', after=position(page))
            restored=position(page)
            page.goto(BASE+'/reader-fixture')
            page.go_back(wait_until='commit')
            mounted(page)
            stable(page,restored,2400)
            record('document-back', after=position(page), pageShows=page.evaluate('window.readerPageShows'))
            close(ctx,page)

        if '--permissions-only' not in sys.argv:
            ctx,page,state=context(browser,hold_entry=True)
            page.unroute('**/v1/**')
            images=[]
            page.route('**/reader-delayed.svg',lambda route: images.append(route))
            page.goto(BASE+'/b/reader-marked-image?local=1',wait_until='commit')
            expect(page.locator('.html-text p')).to_have_count(100)
            page.mouse.move(450,400)
            page.mouse.wheel(0,7000)
            page.wait_for_timeout(300)
            before=position(page)
            release(state,'entry')
            mounted(page)
            for route in images:
                route.fulfill(content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#888"/></svg>')
            after=stable(page,before,3000)
            assert page.locator('slax-mark').count()>0
            assert page.evaluate("document.querySelector('.html-text img').naturalWidth")>0
            assert not page.evaluate('window.readerScrollCalls')
            record('early-reading-with-annotations-and-delayed-image',before=before,after=after,scrollCalls=[])
            close(ctx,page)

        # The original false-paywall trigger: click before /me finishes.
        for panel in ['chat','ai']:
            ctx,page,state=context(browser,hold_profile=True)
            page.goto(BASE+'/b/reader-one')
            mounted(page)
            page.locator('.edge-btn').nth(1 if panel=='chat' else 0).click()
            page.wait_for_timeout(200)
            expect(page.locator('.side-panel.open .subscription-status [role="status"]:visible')).to_be_visible()
            assert page.locator('.snapshot-chat-panel').count()==0
            page.screenshot(path=str(OUT/f'{panel}-checking.png'))
            release(state)
            expect(page.locator('.snapshot-chat-panel' if panel=='chat' else '.snapshot-ai-panel')).to_be_visible(timeout=15000)
            assert 'Upgrade to Pro' not in page.locator('body').inner_text()
            record('pending-'+panel, result='checking then opens selected panel; no upgrade')
            close(ctx,page)
        for scenario in ['failure-retry', 'inactive', 'abandon']:
            ctx,page,state=context(browser,hold_profile=True)
            page.goto(BASE+'/b/reader-one')
            mounted(page)
            page.locator('.edge-btn').nth(1).click()
            page.wait_for_timeout(200)
            expect(page.locator('.subscription-status [role="status"]:visible')).to_be_visible()
            if scenario=='abandon':
                page.locator('.side-panel-tab').nth(2).click()
            release(state, failed=scenario=='failure-retry', inactive=scenario=='inactive')
            if scenario=='failure-retry':
                expect(page.locator('.subscription-status [role="alert"]:visible')).to_be_visible()
                assert page.locator('.subscription-modal').count()==0
                page.screenshot(path=str(OUT/'profile-error.png'))
                page.locator('.subscription-status button:visible').click()
                expect(page.locator('.snapshot-chat-panel')).to_be_visible(timeout=15000)
            elif scenario=='inactive':
                expect(page.locator('.sub-modal')).to_be_visible(timeout=15000)
                assert page.locator('.snapshot-chat-panel').count()==0
            else:
                page.wait_for_timeout(2400)
                expect(page.locator('.side-panel')).to_have_attribute('data-active-tab','comment')
                assert page.locator('.snapshot-chat-panel').count()==0
            record(scenario, result='passed')
            close(ctx,page)
        for scenario in ['logout','account-switch']:
            ctx,page,state=context(browser,hold_profile=True)
            page.goto(BASE+'/b/reader-one')
            mounted(page)
            page.locator('.edge-btn').nth(1).click()
            page.wait_for_timeout(250)
            expect(page.locator('.subscription-status [role="status"]:visible')).to_be_visible()
            token='' if scenario=='logout' else 'eyJhbGciOiJub25lIn0.eyJpZCI6Mn0.synthetic'
            page.evaluate("token=>{document.cookie='slax_reader_test='+token+'; path=/'; window.readerFixture.account.sync()}",token)
            page.wait_for_timeout(300)
            if scenario=='account-switch':
                assert len(state['profile'])==2, len(state['profile'])
            release(state,profile={**PROFILE,'userId':2})
            page.wait_for_timeout(2400)
            assert page.locator('.snapshot-chat-panel').count()==0
            assert page.locator('.subscription-modal').count()==0
            record(scenario,result='old selected action abandoned; stale response does not reopen Chat')
            close(ctx,page)

        ctx,page,state=context(browser,paid=False)
        page.goto(BASE+'/b/reader-outline')
        mounted(page)
        page.locator('.edge-btn').first.click()
        expect(page.locator('.snapshot-ai-panel')).to_be_visible(timeout=15000)
        assert page.locator('.subscription-modal').count()==0
        record('anonymous-public-outline',result='existing outline remains accessible')
        close(ctx,page)
        browser.close()
    print(json.dumps({'checks':len(results),'output':str(OUT)}),flush=True)


if __name__ == '__main__':
    main()
