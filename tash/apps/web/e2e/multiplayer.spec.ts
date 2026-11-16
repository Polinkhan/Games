import { expect, test } from '@playwright/test';
import { playUntilRoundEnd, prepare } from './driver';

test.describe.configure({ mode: 'serial' });

for (const game of ['callbridge', 'twentynine', 'hazari'] as const) {
  test(`multiplayer ${game}: two humans and two bots finish a round`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'multiplayer flow runs once');
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    await prepare(host, 'Host');
    await prepare(guest, 'Guest');

    await host.goto('/');
    await host.getByTestId(`friends-${game}`).click();
    await expect(host).toHaveURL(/\/room\/[A-Z0-9]{6}$/);
    const code = (await host.getByTestId('room-code').textContent())!.trim();

    await guest.goto('/');
    await guest.getByTestId('join-code').fill(code);
    await guest.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(host.getByText('Guest')).toBeVisible();

    await host.getByTestId('lobby-start').click();
    await Promise.all([playUntilRoundEnd(host), playUntilRoundEnd(guest)]);
    await host.screenshot({ path: `test-results/mp-${game}-host.png` });
    await guest.screenshot({ path: `test-results/mp-${game}-guest.png` });
    await hostCtx.close();
    await guestCtx.close();
  });
}
