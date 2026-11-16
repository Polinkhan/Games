import { expect, type Page } from '@playwright/test';

/** Fast settings for tests: single-tap play, reduced motion, English. */
export async function prepare(page: Page, name = 'Tester') {
  await page.addInitScript((n) => {
    localStorage.setItem('tash.settings', JSON.stringify({ name: n, lang: 'en', motion: 'reduced', singleTap: true, sound: false }));
  }, name);
}

/**
 * Take whatever action the page offers (call, bid, trump, arrange, play a card)
 * until the round summary appears.
 */
export async function playUntilRoundEnd(page: Page, maxMs = 150_000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (await page.getByTestId('next-round').isVisible()) return;
    const call = page.locator('[data-testid^="call-"]');
    if (await call.count()) {
      await call.nth(Math.min(2, (await call.count()) - 1)).click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const pass = page.getByTestId('bid-pass');
    if (await pass.isVisible().catch(() => false)) {
      await pass.click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const forced = page.getByTestId('bid-16');
    if (await forced.isVisible().catch(() => false)) {
      await forced.click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const trump = page.locator('[data-testid^="trump-"]');
    if (await trump.count()) {
      await trump.first().click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const suggest = page.getByTestId('hz-suggest');
    if (await suggest.isVisible().catch(() => false)) {
      await suggest.click();
      await expect(page.getByTestId('hz-ready')).toBeEnabled();
      await page.getByTestId('hz-ready').click();
      continue;
    }
    const legal = page.locator('[data-testid="hand-card"][aria-disabled="false"]');
    if (await legal.count()) {
      // Cards overlap: click the visible left strip, not the centre.
      await legal.first().click({ timeout: 2000, position: { x: 8, y: 24 } }).catch(() => {});
      await page.waitForTimeout(150);
      continue;
    }
    await page.waitForTimeout(200);
  }
  throw new Error('round did not finish in time');
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
