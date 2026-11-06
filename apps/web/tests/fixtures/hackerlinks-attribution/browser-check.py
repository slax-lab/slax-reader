import argparse
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://localhost:3215')
parser.add_argument('--executable', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
args = parser.parse_args()
BASE = args.base.rstrip('/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.executable)
    for medium in ['header', 'resource_detail']:
        context = browser.new_context()
        page = context.new_page()
        full_path = f'/?utm_source=hackerlinks&utm_campaign=mvp&utm_medium={medium}&utm_content=zh'
        page.goto(BASE + full_path)
        page.wait_for_url('**/login?**', timeout=60000)
        expect(page.locator('.google-login-button')).to_be_visible()
        query = parse_qs(urlparse(page.url).query)
        assert query['utm_source'] == ['hackerlinks']
        assert query['utm_campaign'] == ['mvp']
        assert query['utm_medium'] == [medium]
        assert 'utm_content' not in query
        assert query['redirect'] == [BASE + full_path]
        context.close()

    context = browser.new_context()
    page = context.new_page()
    page.goto(BASE + '/?utm_source=hackerlinks&utm_campaign=mvp')
    page.wait_for_url('**/login?**', timeout=60000)
    query = parse_qs(urlparse(page.url).query)
    assert not any(key.startswith('utm_') for key in query)
    context.close()
    browser.close()

print('PASS: real Nuxt root-to-login navigation preserves only complete HackerLinks triplets for both media; partial input remains unattributed.')
