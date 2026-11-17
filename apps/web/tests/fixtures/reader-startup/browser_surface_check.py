"""Presentation matrix for the real reader's checking/error/retry states."""
import json
from playwright.sync_api import sync_playwright, expect
from browser_check import BASE, OUT, close, context, mounted, record, release

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/Users/yjc/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell')
    for width in [375, 768, 1280]:
        for theme in ['light', 'dark', 'eink']:
            ctx,page,state=context(browser,hold_profile=True,width=width)
            page.goto(BASE+'/b/reader-one')
            mounted(page)
            page.locator('.theme-switcher').first.hover()
            page.locator('.theme-btn').nth(['light','dark','eink'].index(theme)).click()
            page.wait_for_timeout(250)
            expect(page.locator('html')).to_have_attribute('data-slax-theme',theme)
            page.locator('.bottom-toolbar button[title="Chat"]' if width<=768 else '.edge-btn[title="Chat"]').click()
            page.wait_for_timeout(250)
            expect(page.locator('.subscription-status [role="status"]:visible')).to_be_visible()
            page.screenshot(path=str(OUT/f'checking-{theme}-{width}.png'))
            release(state,failed=True)
            expect(page.locator('.subscription-status [role="alert"]:visible')).to_be_visible()
            button=page.locator('.subscription-status button:visible')
            bounds=button.bounding_box()
            assert bounds['height']>=44 and bounds['x']>=0 and bounds['x']+bounds['width']<=width, bounds
            assert page.locator('.subscription-modal').count()==0
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            button.focus()
            page.screenshot(path=str(OUT/f'error-{theme}-{width}.png'))
            button.click()
            expect(page.locator('.snapshot-chat-panel')).to_be_visible(timeout=15000)
            record('checking-error-retry-presentation',theme=theme,width=width,result='local feedback, accessible retry, paid panel only after confirmation')
            close(ctx,page)
    browser.close()
