import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, playUntilRoundEnd, prepare } from './driver';

for (const game of ['callbridge', 'twentynine', 'hazari'] as const) {
  test(`solo ${game}: play one full round`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await prepare(page);
    await page.goto('/');
    await expectNoHorizontalScroll(page);
    await page.getByTestId(`solo-${game}`).click();
    await page.getByTestId('solo-start').click();
    await expect(page).toHaveURL(new RegExp(`/solo/${game}`));
    await expectNoHorizontalScroll(page);
    await playUntilRoundEnd(page);
    await expect(page.getByTestId('next-round')).toBeVisible();
    await page.screenshot({ path: `test-results/solo-${game}-${test.info().project.name}.png` });

    // Refreshing resumes the saved game rather than starting over.
    await page.reload();
    await expect(page.getByTestId('next-round')).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
}
