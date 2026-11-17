"""Hold real panel modules to inspect the reader sidebar's loading presentation."""
import argparse
import re

from playwright.sync_api import expect, sync_playwright
from browser_check import BASE, OUT, close, context, mounted, record


def open_panel(page, panel, width):
    label = 'Chat' if panel == 'Chat' else 'Analysis'
    page.locator(f'.bottom-toolbar button[title="{label}"]' if width <= 768 else f'.edge-btn[title="{label}"]').click()


def geometry(page):
    return page.locator('.panel-slot:visible').evaluate("""slot => {
      const area = slot.getBoundingClientRect();
      const dots = [...slot.querySelectorAll('.dot-loading .dot')].map(dot => dot.getBoundingClientRect());
      return {
        slot: {x: area.x, y: area.y, width: area.width, height: area.height},
        dx: dots.reduce((sum, dot) => sum + dot.x + dot.width / 2, 0) / 4 - (area.x + area.width / 2),
        dy: dots.reduce((sum, dot) => sum + dot.y + dot.height / 2, 0) / 4 - (area.y + area.height / 2)
      };
    }""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', action='store_true')
    parser.add_argument('--selection-only', action='store_true')
    parser.add_argument('--browser-executable', default=None)
    args = parser.parse_args()
    baseline = args.before
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=args.browser_executable)
        matrix = [(1280, 'light', 'AI')] if baseline else [
            (width, theme, panel)
            for width in [375, 768, 1280]
            for theme in ['light', 'dark', 'eink']
            for panel in ['AI', 'Chat']
        ]
        if args.selection_only:
            matrix = [(1280, 'light', panel) for panel in ['AI', 'Chat']]
        for width, theme, panel in matrix:
            ctx, page, state = context(browser, width=width)
            held = []
            page.route(re.compile(r'/components/Snapshot/Snapshot' + panel + r'Panel\.vue(?:\?t=\d+)?$'), lambda route: held.append(route))
            page.goto(BASE + '/b/reader-outline')
            mounted(page)
            page.locator('.theme-switcher').first.hover()
            page.locator('.theme-btn').nth(['light', 'dark', 'eink'].index(theme)).click()
            expect(page.locator('html')).to_have_attribute('data-slax-theme', theme)
            page.wait_for_timeout(250)
            open_panel(page, panel, width)
            dots = page.locator('.panel-slot:visible .dot-loading .dot')
            expect(dots).to_have_count(4)
            page.wait_for_timeout(400)
            assert held, 'Expected to hold an actual asynchronous panel module'
            bounds = geometry(page)
            if baseline:
                assert abs(bounds['dx']) > 50 and abs(bounds['dy']) > 50, bounds
            else:
                assert abs(bounds['dx']) < 2 and abs(bounds['dy']) < 2, bounds
                status = page.locator('.snapshot-panel-loading:visible')
                expect(status).to_have_attribute('role', 'status')
                expect(status).to_have_attribute('aria-label', 'Loading...')
                expect(status.locator('[aria-hidden="true"] .dot')).to_have_count(4)
                if theme == 'eink':
                    assert dots.first.evaluate("el => getComputedStyle(el).animationName") == 'none'
                page.emulate_media(reduced_motion='reduce')
                assert dots.first.evaluate("el => getComputedStyle(el).animationName") == 'none'
                page.emulate_media(reduced_motion='no-preference')
            prefix = 'before' if baseline else 'after'
            page.screenshot(path=str(OUT / f'panel-loading-{prefix}-{panel}-{theme}-{width}.png'))
            changed_selection = not baseline and width == 1280 and theme == 'light'
            if changed_selection:
                if panel == 'AI':
                    page.locator('.side-panel-tab').last.click()
                    expect(page.locator('.side-panel')).to_have_attribute('data-active-tab', 'comment')
                else:
                    page.locator('.side-panel-close').click()
                    expect(page.locator('.side-panel')).not_to_have_class(re.compile(r'\bopen\b'))
            for route in held:
                route.continue_()
            loaded = page.locator('.snapshot-chat-panel' if panel == 'Chat' else '.snapshot-ai-panel')
            if changed_selection:
                page.wait_for_timeout(800)
                expect(loaded).not_to_be_visible()
                if panel == 'AI':
                    expect(page.locator('.side-panel')).to_have_attribute('data-active-tab', 'comment')
                    page.locator('.side-panel-tab').first.click()
                else:
                    expect(page.locator('.side-panel')).not_to_have_class(re.compile(r'\bopen\b'))
                    open_panel(page, panel, width)
            expect(loaded).to_be_visible(timeout=15000)
            expect(page.locator('.snapshot-panel-loading')).to_have_count(0)
            assert page.locator('.subscription-modal').count() == 0
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert not state['errors'], state['errors']
            record('panel-module-loading-' + prefix, panel=panel, theme=theme, width=width, geometry=bounds)
            close(ctx, page)
        browser.close()


if __name__ == '__main__':
    main()
