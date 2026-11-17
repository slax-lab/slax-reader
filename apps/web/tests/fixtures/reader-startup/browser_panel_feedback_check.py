"""Exercise early panel clicks and held async modules in the real reader lab.
Start the opt-in Nuxt layer first; defaults to http://127.0.0.1:3228.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import browser_check as lab

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:3228')
args = parser.parse_args()
lab.BASE = args.base_url
OUT = Path('/tmp/slax-reader-panel-feedback-evidence')
OUT.mkdir(exist_ok=True)
results = []


def record(case, **data):
    results.append({'case': case, **data})
    (OUT / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results[-1]), flush=True)


def hold_panel(page, panel):
    held = []
    name = 'SnapshotAIPanel' if panel == 'ai' else 'SnapshotChatPanel'
    def intercept(route):
        if route.request.resource_type == 'script' and 'vue&type=' not in route.request.url:
            held.append(route)
        else:
            route.continue_()
    page.route('**/components/Snapshot/' + name + '.vue*', intercept)
    return held


def panel_control(page, panel, width=1280, opened=False):
    root = '.side-panel.open' if opened else '.bottom-toolbar' if width <= 768 else '.edge-toolbar'
    return page.locator(root + ' button[data-snapshot-panel="' + panel + '"]')


def assert_no_hydration_errors(page, state, messages):
    errors = [text for text in messages if 'hydration' in text.lower() and ('mismatch' in text.lower() or 'error' in text.lower())]
    assert not errors, errors
    assert not state['errors'], state['errors']


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Users/yjc/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell')

    # Navigation starts before Nuxt replaces the source article DOM.
    ctx, page, state = lab.context(browser)
    page.goto(lab.BASE + '/b/reader-one')
    lab.mounted(page)
    destination = []
    page.route('**/api/content/reader-two*', lambda route: destination.append(route))
    page.evaluate("void window.readerFixture.router.push('/b/reader-two')")
    page.wait_for_function("window.__slaxReaderStartup.navigation.path === '/b/reader-two'")
    expect(page.locator('h1')).to_have_text('Reader startup reader-one')
    panel_control(page, 'comment').click()
    expect(page.locator('html')).not_to_have_attribute('data-slax-pending-panel', 'comment')
    for route in destination:
        route.continue_()
    expect(page.locator('h1')).to_have_text('Reader startup reader-two')
    expect(page.locator('.side-panel')).not_to_have_attribute('data-active-tab', 'comment')
    record('source-control-during-navigation', result='source click is not handed to destination')
    lab.close(ctx, page)

    # The actual entry module is withheld: there is no Vue click handler yet.
    for panel in ['ai', 'chat']:
        ctx, page, state = lab.context(browser, hold_entry=True)
        messages = []
        page.on('console', lambda msg: messages.append(msg.text))
        held = hold_panel(page, panel)
        page.goto(lab.BASE + '/b/reader-outline', wait_until='commit', timeout=60000)
        entry = panel_control(page, panel)
        expect(entry).to_be_visible()
        before = entry.bounding_box()
        entry.click()
        entry.click()
        expect(page.locator('html')).to_have_attribute('data-slax-pending-panel', panel)
        expect(entry.locator('.panel-icon-ring')).to_be_visible()
        expect(entry.locator('.panel-icon-art')).to_be_hidden()
        assert not page.evaluate('document.documentElement.dataset.readerMounted')
        assert entry.bounding_box() == before
        page.screenshot(path=str(OUT / (panel + '-before-hydration.png')))
        lab.release(state, 'entry')
        lab.mounted(page)
        expect(page.locator('.side-panel')).to_have_attribute('data-active-tab', panel)
        control = panel_control(page, panel, opened=True)
        expect(control).to_have_attribute('aria-busy', 'true')
        expect(control.locator('.panel-icon-ring')).to_be_visible()
        assert len(held) == 1, len(held)
        page.screenshot(path=str(OUT / (panel + '-module-pending.png')))
        for route in held:
            route.continue_()
        expect(page.locator('.snapshot-ai-panel' if panel == 'ai' else '.snapshot-chat-panel')).to_be_visible(timeout=15000)
        expect(control).to_have_attribute('aria-busy', 'false')
        expect(control.locator('.panel-icon-art')).to_be_visible()
        expect(page.locator('html')).not_to_have_attribute('data-slax-pending-panel', panel)
        assert_no_hydration_errors(page, state, messages)
        record('early-click-handoff', panel=panel, module_requests=len(held), repeated_click='one activation', hydration_errors=[])
        video = page.video
        lab.close(ctx, page)
        video.save_as(str(OUT / (panel + '-startup-and-code-loading.webm')))

    # A later choice wins while the application bundle remains unavailable.
    ctx, page, state = lab.context(browser, hold_entry=True)
    page.goto(lab.BASE + '/b/reader-outline', wait_until='commit', timeout=60000)
    panel_control(page, 'ai').click()
    panel_control(page, 'comment').click()
    expect(page.locator('html')).to_have_attribute('data-slax-pending-panel', 'comment')
    expect(panel_control(page, 'ai').locator('.panel-icon-ring')).to_be_hidden()
    lab.release(state, 'entry')
    lab.mounted(page)
    expect(page.locator('.side-panel')).to_have_attribute('data-active-tab', 'comment')
    record('latest-early-choice', selected='comment')
    lab.close(ctx, page)

    # Existing subscription decisions remain authoritative after early activation.
    for outcome in ['pending-active', 'inactive', 'failure-retry']:
        ctx, page, state = lab.context(browser, hold_entry=True, hold_profile=True)
        page.goto(lab.BASE + '/b/reader-one', wait_until='commit', timeout=60000)
        panel_control(page, 'chat').click()
        lab.release(state, 'entry')
        lab.mounted(page)
        expect(page.locator('.subscription-status [role="status"]:visible')).to_be_visible()
        assert page.locator('.snapshot-chat-panel').count() == 0
        lab.release(state, inactive=outcome == 'inactive', failed=outcome == 'failure-retry')
        if outcome == 'inactive':
            expect(page.locator('.sub-modal')).to_be_visible(timeout=15000)
            assert page.locator('.snapshot-chat-panel').count() == 0
        else:
            if outcome == 'failure-retry':
                expect(page.locator('.subscription-status [role="alert"]:visible')).to_be_visible()
                page.locator('.subscription-status button:visible').click()
            expect(page.locator('.snapshot-chat-panel')).to_be_visible(timeout=15000)
        record('early-access-checks', outcome=outcome)
        lab.close(ctx, page)

    # Existing opening and placeholder behavior, all supported themes and widths.
    for width in [1280, 768, 375]:
        for theme in ['light', 'dark', 'eink']:
            ctx, page, state = lab.context(browser, width=width)
            held = hold_panel(page, 'ai')
            page.goto(lab.BASE + '/b/reader-outline')
            lab.mounted(page)
            page.locator('.theme-switcher').first.hover()
            page.locator('.theme-btn').nth(['light', 'dark', 'eink'].index(theme)).click()
            expect(page.locator('html')).to_have_attribute('data-slax-theme', theme)
            entry = panel_control(page, 'ai', width)
            entry.focus()
            entry.press('Enter')
            expect(page.locator('.side-panel')).to_have_attribute('data-active-tab', 'ai')
            expect(page.locator('.side-panel .dot-loading:visible')).to_be_visible()
            if width > 768:
                control = panel_control(page, 'ai', opened=True)
                expect(control).to_have_attribute('aria-busy', 'true')
                expect(control.locator('.panel-icon-ring')).to_be_visible()
                ring = control.locator('.panel-icon-ring')
                assert ring.evaluate("el => getComputedStyle(el).animationName === 'none'") == (theme == 'eink')
                assert control.bounding_box()['width'] >= 44
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT / f'pending-{theme}-{width}.png'))
            for route in held:
                route.continue_()
            expect(page.locator('.snapshot-ai-panel')).to_be_visible(timeout=15000)
            record('presentation', width=width, theme=theme, loading_icon='expanded tab' if width > 768 else 'mobile entry hidden by existing sheet; content placeholder visible')
            lab.close(ctx, page)

    for outcome in ['switch', 'close', 'reject', 'timeout', 'reduced-motion']:
        ctx, page, state = lab.context(browser)
        if outcome == 'reduced-motion':
            page.emulate_media(reduced_motion='reduce')
        held = hold_panel(page, 'ai')
        page.goto(lab.BASE + '/b/reader-outline')
        lab.mounted(page)
        panel_control(page, 'ai').click()
        control = panel_control(page, 'ai', opened=True)
        expect(control).to_have_attribute('aria-busy', 'true')
        if outcome == 'switch':
            panel_control(page, 'comment', opened=True).click()
        elif outcome == 'close':
            page.locator('.side-panel-close').click()
        elif outcome == 'reject':
            for route in held:
                route.abort()
        elif outcome == 'timeout':
            expect(page.locator('.panel-load-error:visible')).to_be_visible(timeout=20000)
        elif outcome == 'reduced-motion':
            assert control.locator('.panel-icon-ring').evaluate("el => getComputedStyle(el).animationName === 'none'")
        if outcome == 'reject':
            expect(page.locator('.panel-load-error:visible')).to_be_visible(timeout=10000)
        if outcome in ['reject', 'timeout']:
            expect(control).to_have_attribute('aria-busy', 'false')
            expect(control.locator('.panel-icon-ring')).to_be_hidden()
        if outcome != 'reject':
            for route in held:
                route.continue_()
        if outcome == 'switch':
            expect(page.locator('.side-panel')).to_have_attribute('data-active-tab', 'comment')
        elif outcome == 'close':
            expect(page.locator('.side-panel')).not_to_have_class('side-panel open')
            expect(panel_control(page, 'ai').locator('.panel-icon-ring')).to_be_hidden()
        record('pending-module-terminal-state', outcome=outcome)
        lab.close(ctx, page)
    browser.close()
