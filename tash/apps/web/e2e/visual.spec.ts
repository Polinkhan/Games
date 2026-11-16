import { test } from '@playwright/test';
import { prepare } from './driver';

/** Screenshots of key states for manual review: VISUAL=1 pnpm e2e --grep visual */
test.skip(!process.env.VISUAL, 'set VISUAL=1 to capture review screenshots');

for (const theme of ['dark', 'light'] as const) {
  test(`visual ${theme}`, async ({ page }, info) => {
    await prepare(page);
    await page.addInitScript((th) => {
      const s = JSON.parse(localStorage.getItem('tash.settings')!);
      localStorage.setItem('tash.settings', JSON.stringify({ ...s, theme: th, motion: 'full', singleTap: false }));
    }, theme);
    const shot = (n: string) => page.screenshot({ path: `test-results/visual/${info.project.name}-${theme}-${n}.png` });
    await page.goto('/');
    await page.waitForTimeout(600);
    await shot('home');

    // Call Bridge: calling, then mid-trick.
    await page.getByTestId('solo-callbridge').click();
    await page.getByTestId('solo-start').click();
    await page.locator('[data-testid^="call-"]').first().waitFor({ timeout: 20_000 });
    await shot('cb-call');
    await page.locator('[data-testid^="call-"]').nth(2).click();
    await page.locator('[data-testid="hand-card"][aria-disabled="false"]').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
    await shot('cb-turn');
    await page.locator('[data-testid="hand-card"][aria-disabled="false"]').first().click({ position: { x: 8, y: 24 } });
    await page.waitForTimeout(200);
    await shot('cb-lifted');

    // Twenty-nine bidding.
    await page.goto('/');
    await page.getByTestId('solo-twentynine').click();
    await page.getByTestId('solo-start').click();
    await page.waitForTimeout(6000);
    await shot('tn-bidding');

    // Hazari arranging.
    await page.goto('/');
    await page.getByTestId('solo-hazari').click();
    await page.getByTestId('solo-start').click();
    await page.getByTestId('hz-board').waitFor();
    await page.waitForTimeout(1200);
    await shot('hz-arrange');
    await page.getByTestId('hz-suggest').click();
    await page.waitForTimeout(500);
    await shot('hz-suggested');
    await page.getByTestId('hz-ready').click();
    await page.waitForTimeout(2600);
    await shot('hz-showdown');
  });
}
