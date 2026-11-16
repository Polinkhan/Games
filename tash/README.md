# Tash

Call Bridge, Twenty-nine and Hazari in the browser: solo against bots, or online with friends, with bots filling empty seats.

## Run it

```bash
pnpm install
pnpm dev          # server on :3001, web on http://localhost:5173 (proxies the socket)
```

Production (one process serves the client and the socket server):

```bash
pnpm build
PORT=8080 pnpm start          # http://localhost:8080
# or
docker build -t tash . && docker run -p 8080:8080 tash
```

The server keeps rooms in memory and needs a host that supports long-lived WebSocket connections (Fly.io, Render, Railway, a VPS). Restarting it ends running online games; solo games are unaffected.

## Tests

```bash
pnpm test                         # engine rules, bot simulations, redaction, server integration
pnpm build && pnpm e2e            # Playwright: solo + two-browser multiplayer rounds (uses installed Chrome)
VISUAL=1 pnpm e2e --grep visual   # review screenshots in apps/web/test-results/visual
```

Set `PW_CHANNEL=chromium` to use Playwright's bundled Chromium instead of Chrome.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | All rules, bots and the `GameHost` (bot scheduling, timers). Pure TypeScript, shared by server and browser. |
| `packages/engine/src/<game>/rules.ts` | One game's rules: `init`, `validate`, `apply`, `viewFor`. |
| `packages/engine/src/<game>/bot.ts` | Heuristic bots; `hard.ts` adds determinised sampling for Call Bridge and 29. |
| `packages/engine/src/hazari/winTable.json` | Precomputed win probabilities for the Hazari arrangement search. Rebuild with `pnpm --filter @tash/engine hazari:table`. |
| `packages/engine/src/protocol.ts` | Socket messages, validated with Zod on the server. |
| `apps/server` | Fastify + Socket.IO. Rooms, reconnection, autopilot, host migration. |
| `apps/web` | React client. `director/` paces animations from engine events; `games/<id>/` holds each game's UI. |

## Adding or changing rules

House rules that vary are config fields with lobby toggles (`*ConfigSchema` in each game's `types.ts`). Changing a fixed rule means editing that game's `rules.ts` and its tests. See `PLAN.md` section 13 for the defaults that should be confirmed.
