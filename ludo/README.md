# Ludo · লুডু

Ludo in the browser: solo against the computer, or online with friends in a private room. Computer players fill empty seats. English and Bangla.

Live at https://games.polinkhan.com/ludo/

## Run it

```bash
npm install
npm run build                 # client -> dist/ (built for the /ludo/ sub-path)
PORT=3003 npm start           # serves dist/ and the room server on http://127.0.0.1:3003
```

For local development run `npm run dev:server` and `npm run dev`, then open http://localhost:5174/ludo/.
To serve from a domain root instead of `/ludo/`, build with `BASE_PATH=/ npm run build`.

The server runs TypeScript directly with Node's built-in type stripping, so it needs Node 23.6 or newer and has no build step. Rooms live in memory: restarting the server ends online games. Solo games are saved in the browser.

## Tests

```bash
npm test          # rules, captures, dice, input parsing, and full bot-vs-bot matches for every rule variant
npm run typecheck
```

## Layout

| Path | What it is |
|---|---|
| `src/shared/rules.ts` | The rules: movement, captures, extra rolls, safe squares, win. Pure functions, shared by server and browser. |
| `src/shared/bot.ts` | Computer players (easy = random, normal/hard weigh captures, safety and danger). |
| `src/shared/host.ts` | `GameHost`: runs a match, schedules bots and turn timers. Used by the server and by solo play. |
| `src/shared/protocol.ts` | Socket.IO messages between browser and server. |
| `server/index.ts` | Static file server and rooms (create, join, seats, host hand-off, reconnection, rate limits). |
| `src/client/` | Browser UI: SVG board (`board.ts`), table and animations (`game.ts`), home and lobby (`main.ts`). |

## Rules implemented

- A 6 brings a token out onto its start square. Tokens go clockwise once around the board, then up their home column; the exact number is needed to finish.
- A 6, a capture, or getting a token home earns another roll.
- Landing on an opponent sends their token back to its yard. Start squares are always safe.
- The first player with all four tokens home wins.
- House rules (lobby toggles): safe star squares (on), three 6s in a row lose the turn (on), must capture before entering home (off).
- Dice are rolled on the server from a secret seed, so online players cannot predict or fake them.
