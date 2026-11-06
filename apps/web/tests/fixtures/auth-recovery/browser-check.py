"""Exercise the actual callback and HTTP fault service; all credentials are synthetic.

Run the fixture on 44020 and its --baseline on 44021, then run this script.
Optional arguments: --base URL --baseline URL --executable PATH --output DIR.
"""
import argparse
import json
from pathlib import Path
import time
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:44020')
parser.add_argument('--baseline', default='http://127.0.0.1:44021')
parser.add_argument('--executable', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
parser.add_argument('--output', default='/tmp/slax-auth-recovery-evidence')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
results = []


def callback(base, mode, *, theme='light', locale='en', provider='google', malformed=False, attribution=None):
    state = {'redirectUrl': base + '/auth', 'target': '/__fixture/done?return=preserved', 'affCode': 'synthetic-referral', 'platform': provider}
    if attribution is not None:
        state['auth_attribution'] = attribution
    return base + '/auth?' + urlencode({'case': mode, 'code': 'synthetic-' + mode, 'state': '{' if malformed else json.dumps(state), 'theme': theme, 'locale': locale})


def no_session(context):
    assert not any(cookie['name'] == 'slax_auth_probe' for cookie in context.cookies())


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.executable)
    # A before capture of the real previous page, composable and toast implementation.
    context = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = context.new_page()
    page.goto(callback(args.baseline, 'disconnect'))
    expect(page.locator('.text-toast')).to_contain_text('TypeError', timeout=15000)
    assert page.locator('.i-svg-spinners\\:180-ring-with-bg').is_visible()
    page.screenshot(path=str(out / 'before-light-1280.png'))
    page.wait_for_timeout(3000)
    assert page.locator('.i-svg-spinners\\:180-ring-with-bg').is_visible()
    results.append({'case': 'baseline-disconnect', 'result': 'raw toast then persistent spinner'})
    context.close()

    for mode in ['disconnect', 'provider-error', 'pending', 'navigation-error', 'malformed', 'apple', 'collection', 'acquisition-google', 'acquisition-apple']:
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        actual_mode = 'provider-error' if mode in ['apple', 'collection', 'acquisition-google', 'acquisition-apple'] else 'disconnect' if mode == 'malformed' else mode
        attribution = {'collection_id': 'Collection123', 'source_screen': 'collection', 'presentation': 'modal', 'trigger_element_id': 'collection_subscribe_button'} if mode == 'collection' else None
        if mode.startswith('acquisition-'):
            attribution = {'source': 'hackerlinks', 'medium': 'resource_detail' if mode == 'acquisition-apple' else 'header', 'campaign': 'mvp'}
        provider = 'apple' if mode in ['apple', 'acquisition-apple'] else 'google'
        started = time.monotonic()
        page.goto(callback(args.base, actual_mode, provider=provider, malformed=mode == 'malformed', attribution=attribution))
        expect(page.get_by_role('alert')).to_be_visible(timeout=30000)
        expect(page).to_have_title('Sign-in not complete - Slax Reader')
        if mode == 'pending':
            assert time.monotonic() - started >= 19.8
            expect(page.get_by_role('alert')).to_contain_text('timed out')
        assert page.locator('.text-toast').count() == 0
        assert page.get_by_role('status').count() == 0
        assert not errors, errors
        if mode != 'navigation-error':
            no_session(context)
        if mode == 'disconnect':
            page.screenshot(path=str(out / 'after-light-1280.png'))
            page.wait_for_timeout(3000)
            expect(page.get_by_role('alert')).to_be_visible()
        page.get_by_role('button').click()
        expect(page.get_by_role('heading', name='Fresh provider authorization started')).to_be_visible()
        query = parse_qs(urlparse(page.url).query)
        assert 'code' not in query
        state = json.loads(query['state'][0])
        assert state['target'] == ('/bookmarks' if mode == 'malformed' else '/__fixture/done?return=preserved')
        assert state['affCode'] == ('' if mode == 'malformed' else 'synthetic-referral')
        assert state['platform'] == provider
        if mode in ['collection', 'acquisition-google', 'acquisition-apple']:
            assert state['auth_attribution'] == attribution
        results.append({'case': mode, 'result': 'persistent recovery, no raw toast/unhandled rejection, fresh authorization', 'elapsedSeconds': round(time.monotonic() - started, 2)})
        context.close()

    context = browser.new_context()
    page = context.new_page()
    page.goto(callback(args.base, 'success'))
    expect(page.get_by_role('heading', name='Login completed')).to_be_visible()
    assert any(cookie['name'] == 'slax_auth_probe' and cookie['value'] == 'synthetic-session-token' for cookie in context.cookies())
    assert parse_qs(urlparse(page.url).query)['return'] == ['preserved']
    results.append({'case': 'success', 'result': 'real cookie and destination preserved'})
    context.close()

    # Required state/theme/width matrix. Only these pending cases use an accelerated clock.
    for theme in ['light', 'dark', 'eink']:
        for width in [320, 768, 1280]:
            for locale in ['en', 'zh']:
                for mode in ['disconnect', 'pending']:
                    context = browser.new_context(viewport={'width': width, 'height': 800})
                    page = context.new_page()
                    if mode == 'pending':
                        page.clock.install()
                        with page.expect_request(lambda request: '/v1/user/login' in request.url):
                            page.goto(callback(args.base, mode, theme=theme, locale=locale))
                        expect(page.get_by_role('status')).to_be_visible()
                        expect(page).to_have_title(('认证中' if locale == 'zh' else 'Authenticating') + ' - Slax Reader')
                        page.clock.fast_forward(20001)
                    else:
                        page.goto(callback(args.base, mode, theme=theme, locale=locale))
                    expect(page.get_by_role('alert')).to_be_visible()
                    expect(page.get_by_role('heading')).to_contain_text('登录未完成' if locale == 'zh' else 'Sign-in not complete')
                    expect(page).to_have_title(('登录未完成' if locale == 'zh' else 'Sign-in not complete') + ' - Slax Reader')
                    button = page.get_by_role('button')
                    assert button.is_enabled()
                    bounds = button.bounding_box()
                    assert bounds and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                    no_session(context)
                    if locale == 'zh' and mode == 'disconnect':
                        page.screenshot(path=str(out / f'after-{theme}-{width}-zh.png'))
                    results.append({'case': mode, 'theme': theme, 'width': width, 'locale': locale, 'result': 'visible recovery, usable action, no horizontal overflow'})
                    context.close()
    browser.close()

with urlopen(args.base + '/__fixture/requests') as response:
    requests = json.load(response)
assert any(entry.get('mode') == 'pending' and entry.get('canceled') for entry in requests)
assert any(entry.get('body', {}).get('auth_attribution', {}).get('collection_id') == 'Collection123' for entry in requests)
assert any(entry.get('body', {}).get('type') == 'google' and entry.get('body', {}).get('auth_attribution') == {'source': 'hackerlinks', 'medium': 'header', 'campaign': 'mvp'} for entry in requests)
assert any(entry.get('body', {}).get('type') == 'apple' and entry.get('body', {}).get('auth_attribution') == {'source': 'hackerlinks', 'medium': 'resource_detail', 'campaign': 'mvp'} for entry in requests)
(out / 'results.json').write_text(json.dumps(results, indent=2))
(out / 'http-requests.json').write_text(json.dumps(requests, indent=2))
print(json.dumps({'checks': len(results), 'result': 'passed', 'output': str(out)}))
