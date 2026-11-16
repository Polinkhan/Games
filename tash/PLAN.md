# Tash — Call Bridge, Twenty-nine and Hazari on the web

Implementation plan. Read sections 1–5 before writing any code; sections 6–8 are the rules and bot specs for each game; section 12 is the build order.

## 1. What we are building

A single web app with three Bangladeshi card games:

- **Call Bridge** — 4 players, every player for themselves.
- **Twenty-nine (29)** — 4 players, two fixed teams of 2.
- **Hazari** — 4 players, every player for themselves.

Required behaviour:

- **Solo play**: 1 human and 3 bots. Works with no server connection.
- **Multiplayer**: 2–4 humans in a private room joined by code or link. Every seat with no human in it is played by a bot, so a game always has 4 players.
- **Clean modern UI**, smooth animation, responsive from a 360 px phone to a desktop monitor, touch and mouse.

Out of scope for version 1: accounts and login, public matchmaking, a database, real money or betting of any kind, chat (quick emotes only), spectators.

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict` on, everywhere | One language lets the rules engine run on both server and browser |
| Repo | pnpm workspaces monorepo | Node 24 and pnpm 10 are already installed |
| Client | React 19 + Vite | Fast dev loop, static build |
| Styling | Tailwind CSS v4 + CSS variables for design tokens | Responsive utilities, easy theming |
| Animation | `motion` (the library formerly named Framer Motion) | Shared-layout animation moves a card between hand, table and pile without manual maths |
| Drag and drop | `@dnd-kit/core` | Needed for Hazari arranging; works with touch |
| Client state | Zustand | Small, no boilerplate |
| Routing | React Router | Three or four routes only |
| Server | Node + Fastify + Socket.IO | Socket.IO gives rooms, acknowledgements and reconnection for free |
| Validation | Zod | Validate every message that crosses the network |
| Tests | Vitest (engine, bots), Playwright (two-browser multiplayer flows) | |
| Deploy | One Docker image: Fastify serves the built client and the WebSocket | Needs a host that keeps long-lived connections (Fly.io, Render, Railway, a VPS). Vercel/Netlify functions will not work for the socket server |

Check the current major versions with `pnpm view <pkg> version` at setup time rather than trusting version numbers from memory.

## 3. Repository layout

```
/
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json
├─ packages/
│  └─ engine/                 pure TypeScript, no DOM, no Node APIs
│     ├─ src/core/            cards, deck, seeded RNG, seat maths, shared types
│     ├─ src/callbridge/      rules.ts, bot.ts, types.ts, rules.test.ts
│     ├─ src/twentynine/      same shape
│     ├─ src/hazari/          same shape, plus combos.ts
│     ├─ src/registry.ts      gameId → GameDefinition
│     └─ src/simulate.ts      bot-vs-bot runner used by tests
├─ apps/
│  ├─ server/
│  │  └─ src/                 index.ts, rooms.ts, roomRunner.ts, protocol.ts
│  └─ web/
│     └─ src/
│        ├─ app/              routes, layout shell, theme
│        ├─ session/          GameSession interface, LocalSession, RemoteSession
│        ├─ director/         event queue that paces animations
│        ├─ components/       Card, Hand, Seat, Table, TrickArea, ScoreSheet, …
│        ├─ games/            callbridge/, twentynine/, hazari/ (game-specific UI)
│        ├─ screens/          Home, Lobby, Game, HowToPlay
│        └─ i18n/             en.json, bn.json
└─ PLAN.md
```

## 4. Architecture

### 4.1 The central idea

All rules live in `packages/engine` as pure functions. The server runs the engine for multiplayer. The browser runs the *same* engine for solo play. The UI never contains rules; it only renders a view and sends actions.

### 4.2 Engine contract

Every game exports one object of this shape:

```ts
interface GameDefinition<State, Action, View, Config> {
  id: 'callbridge' | 'twentynine' | 'hazari';
  defaultConfig: Config;
  configSchema: ZodType<Config>;

  // Start a match. `seed` makes shuffles reproducible in tests.
  init(config: Config, seed: string): State;

  // Whose input is the game waiting for. Usually one seat;
  // all four seats during Hazari arranging.
  pendingSeats(state: State): Seat[];

  // Every action this seat may take right now. Empty if not their turn.
  legalActions(state: State, seat: Seat): Action[];

  // Apply an action. Throws on illegal input. Never mutates `state`.
  apply(state: State, seat: Seat, action: Action): { state: State; events: GameEvent[] };

  // What this seat is allowed to see. Other hands become card counts.
  viewFor(state: State, seat: Seat): View;

  // Bot decision, made from the view only, so a bot can never cheat.
  botAction(view: View, difficulty: 'easy' | 'normal' | 'hard', rng: Rng): Action;

  result(state: State): MatchResult | null;   // non-null when the match is over
}
```

Rules that follow from this:

- `State` is plain JSON-serialisable data. No classes, no `Date`, no `Math.random`.
- Randomness comes from a seeded generator in `core/rng.ts`. The server seeds it from `crypto.randomBytes`; tests use fixed seeds.
- `apply` also advances automatic steps (finishing a trick, dealing the next round) and reports them as events, so the caller never has to "tick" the game.
- For Hazari, `legalActions` cannot list every arrangement. Use a `validate(state, seat, action): string | null` companion for that one action and return a marker action from `legalActions`.

### 4.3 Events

`apply` returns events that describe what happened, in order. The UI animates from events, not by diffing state. Examples:

`dealt`, `bidPlaced`, `cardPlayed {seat, card}`, `trickWon {seat, cards}`, `trumpRevealed {suit, bySeat}`, `pairDeclared`, `groupsRevealed`, `roundScored {deltas, totals}`, `matchEnded`.

Events are redacted per seat the same way views are (a `dealt` event shows only your own cards).

### 4.4 Sessions: one interface, two transports

```ts
interface GameSession {
  subscribe(cb: (update: { view: View; events: GameEvent[]; seq: number }) => void): () => void;
  send(action: Action): Promise<{ ok: true } | { ok: false; reason: string }>;
  leave(): void;
}
```

- **`LocalSession`** (solo): holds the engine state in the browser, applies the human's action, then runs bot turns with a short delay. Saves state to `localStorage` after every update so a refresh resumes the match.
- **`RemoteSession`** (multiplayer): wraps the Socket.IO connection.

The Game screen only knows `GameSession`, so solo and multiplayer share 100 % of the UI.

### 4.5 Server

In-memory `Map<roomCode, Room>`. A server restart ends running games; this is acceptable for version 1. Keep room storage behind a small interface so a Redis store can replace the map later.

```ts
interface Room {
  code: string;                 // 6 characters, no look-alikes (no 0/O, 1/I)
  gameId: GameId;
  config: unknown;              // validated with the game's configSchema
  hostPlayerId: string;
  seats: [SeatSlot, SeatSlot, SeatSlot, SeatSlot];
  phase: 'lobby' | 'playing' | 'finished';
  state?: unknown;              // engine state
  seq: number;                  // increments on every update
}
type SeatSlot =
  | { kind: 'open' }
  | { kind: 'bot'; difficulty: Difficulty }
  | { kind: 'human'; playerId: string; name: string; connected: boolean; autopilot: boolean };
```

**Identity.** No accounts. On first visit the client generates a random `playerId` and a secret `playerToken`, stores them in `localStorage`, and sends both on every connection. The server binds a seat to the token, so a refresh or a dropped connection gets the same seat back.

**Messages** (all validated with Zod, all with acknowledgements):

| Client → server | Meaning |
|---|---|
| `room:create {gameId, name}` | Returns room code; creator is host and sits in seat 0 |
| `room:join {code, name}` | Join lobby, take first open seat |
| `room:sit {seat}` | Move to another open seat (matters for 29 teams) |
| `room:setSeat {seat, slot}` | Host only: set a seat to open or bot, choose bot difficulty |
| `room:config {config}` | Host only, lobby only |
| `room:start` | Host only. Every open seat becomes a bot, then the engine starts |
| `game:action {action, seq}` | A move. Rejected if illegal or if `seq` is stale |
| `room:emote {id}` | One of a fixed set of emotes |
| `room:rematch` | Host only, after a match ends |
| `room:leave` | |

| Server → client | Meaning |
|---|---|
| `room:state` | Lobby snapshot: seats, config, host, phase |
| `game:update {view, events, seq}` | Full redacted view plus the events since the previous update |

Sending the full view every time (it is under 2 KB) keeps reconnection trivial: on reconnect the server sends the latest view with an empty event list and the client snaps to it without animation.

**Bots and missing players.**

- The room runner calls `pendingSeats` after every update. For each pending bot seat it waits 600–1400 ms (randomised so bots feel natural), then calls `botAction` and applies it.
- **Turn timer**: 30 s per human turn (90 s for Hazari arranging), configurable. On expiry the server plays that one move with the bot and shows a "played automatically" hint.
- **Disconnect**: seat shows "reconnecting". After 20 s the seat goes on autopilot (bot plays for it at normal difficulty). When the player returns, autopilot stops immediately.
- **Leave**: the seat becomes a bot for the rest of the match. If the host leaves, the next human becomes host. When no humans remain, delete the room.
- A late joiner can take over a bot seat only between rounds, never mid-round.

**Trust.** The server is the only authority. It never sends a card the seat may not see, never trusts client-reported state, rate-limits messages per socket, and caps name length and room count per IP.

## 5. Shared card conventions

- Seats are numbered 0–3. **Deal and play go counter-clockwise** in all three games (the South Asian convention): after seat `s` comes seat `(s + 1) % 4`, and on screen the next player sits to the **right** of the current one. The local player is always drawn at the bottom; rotate the other seats around them.
- Card type: `{ suit: 'S' | 'H' | 'D' | 'C'; rank: 2..14 }` with 11 = J, 12 = Q, 13 = K, 14 = A. Card id is a string such as `"SA"` or `"H10"`.
- The dealer moves one seat counter-clockwise each round. First dealer is random.
- Some rules below differ from house to house. Each such rule is a field in the game's `Config` with the default given here, editable by the host in the lobby. **Rules marked “verify” are the ones the product owner should confirm against how they actually play before the game is called finished.**

## 6. Call Bridge

### 6.1 Rules

- 52 cards, 13 each, dealt one at a time. Rank order A high to 2 low. **Spades are always trump.**
- **Calling**: starting from the seat after the dealer and ending with the dealer, each player calls the number of tricks they expect to win. Minimum `minCall` (default **1**), maximum 13. Calls are public. There is no passing and no requirement that calls add up to anything.
- **Play**: the seat after the dealer leads the first trick. Any card may be led, including a spade.
  - You must follow the led suit if you can.
  - If you cannot follow suit and you hold a spade that beats every spade already in the trick, you must play such a spade.
  - Otherwise you may play any card.
  - Config `mustBeatInSuit` (default **off**): when on, a player following suit must play a card higher than the best card of that suit so far, if they have one.
- The highest spade wins the trick; if no spade was played, the highest card of the led suit wins. The winner leads next.
- **Scoring**, config `overtricks`:
  - `'strict'` (default, verify): you succeed if you win exactly your call or one more. Success scores `+call`; anything else scores `−call`.
  - `'tenths'`: you succeed with your call or more. Success scores `call + 0.1 × extra tricks`; failure scores `−call`. Store scores as integers in tenths to avoid floating-point drift.
- Config `bonusCall` (default **on**): a successful call of 8 or more scores 13 instead.
- **Match end**, config `rounds` (default **5**): highest total after the last round wins. Ties share the win.

### 6.2 State phases

`calling` → `playing` (13 tricks) → `roundEnd` (score sheet shown; the engine waits for a `nextRound` action from any human, or auto-advances after 8 s) → next round or `matchEnd`.

### 6.3 Bot

**Calling** — estimate tricks, then round down:

- Spades: A and K count 1 each; Q counts 1 if holding 3 or more spades; J counts 0.5 with 4 or more; each spade beyond the fourth counts 1.
- Side suits: A counts 1; K counts 0.75 if the suit has 2–4 cards, 0.25 otherwise; Q counts 0.25 if the suit has exactly 3 cards.
- Ruffing: with 3 or more spades, add 1 for a void side suit and 0.5 for a singleton.
- Clamp to `minCall`..8. Easy bots add random noise of ±1.

**Play** — the bot tracks every card played so it knows which cards are now the highest left in each suit ("boss" cards).

- *Needs more tricks*: lead side-suit aces and boss cards early, before opponents run out of that suit and trump them. Lead a singleton to create a void. When following, win with the cheapest card that wins; if it cannot win, throw the lowest card. In last seat always win as cheaply as possible.
- *Has reached its call* under `'strict'` scoring: avoid further tricks. Lead low cards from long suits, play under the current winner, discard high cards when void.
- *Has reached its call* under `'tenths'`: keep winning cheap tricks but do not spend high spades.
- Hard bots additionally lead suits where an opponent who is about to exceed or fall short of their call will be hurt (push extra tricks onto a player who is already at call + 1 under strict scoring).

## 7. Twenty-nine (29)

### 7.1 Rules

- **32 cards**: 7, 8, 9, 10, J, Q, K, A in each suit.
- **Rank order in every suit, high to low: J, 9, A, 10, K, Q, 8, 7.**
- **Card points**: J = 3, 9 = 2, A = 1, 10 = 1, others 0. That is 28 in the pack. Config `lastTrickPoint` (default **on**) gives 1 more point to the side winning the last trick, making 29.
- **Teams**: seats 0 and 2 against seats 1 and 3. Partners sit opposite each other.
- **Deal, part 1**: 4 cards each.
- **Bidding**: starts with the seat after the dealer and goes round counter-clockwise. A bid is the number of card points the bidder's team promises to take. Minimum **16**, maximum 28, each bid higher than the last. A pass is final for that round. Bidding ends when three players have passed. If the first three players pass with no bid, the dealer must take the bid at 16.
- **Choosing trump**: the bid winner secretly chooses a trump suit, having seen only their first 4 cards. Nobody else is told. Show a face-down trump marker next to the bidder.
- **Deal, part 2**: 4 more cards each, so everyone holds 8.
- **Play**: the seat after the dealer leads. You must follow suit if you can.
  - **While trump is hidden**, a player who cannot follow suit chooses one of two actions: play any card without asking, or **ask for trump**. Asking reveals the trump suit to everyone; the asker must then play a trump if they hold one.
  - The bidder knows the trump but is under the same rule: when unable to follow suit they may reveal it themselves (and must then play a trump if they have one) or play any card.
  - While trump is hidden, cards of the trump suit have no special power: the highest card of the led suit wins.
  - The trump takes effect starting with the trick in which it is revealed, and trump-suit cards already played to that trick count as trumps (verify).
  - After the reveal: follow suit if possible; otherwise any card, trump or not. Highest trump wins, else highest card of the led suit.
- **Pair**: the K and Q of trump in one hand. Its holder may declare it at the moment their team wins a trick, provided trump is already revealed and both cards are still in their hand. Only one pair exists. If the bidding team declares, their target drops by 4 (not below 16). If the defenders declare, the bidder's target rises by 4 (not above 28). Config `pairEnabled` default **on**. In the UI, declare automatically and announce it — there is never a reason not to.
- **Round score**: add the card points in each team's tricks. If the bidding team reaches its (possibly adjusted) target it gains **1 game point**; otherwise it loses 1. The defenders' score never changes.
- **Match end**: a team wins at **+6** game points and loses at **−6** (config `targetGamePoints`, default 6).
- Deliberately left out of version 1: double and redouble, single-hand bids, seventh-card trump, and redeal claims for weak hands.

### 7.2 State phases

`deal1` → `bidding` → `chooseTrump` → `deal2` → `playing` (8 tricks) → `roundEnd` → next round or `matchEnd`.

View redaction is the delicate part here: `trumpSuit` is present in the bidder's view from `chooseTrump` onward and `null` in every other view until `trumpRevealed`. Write a test that asserts this for every phase.

### 7.3 Bot

**Bidding** — for each suit in the first 4 cards compute a strength: J = 3, 9 = 2, A = 1, 10 = 1, K/Q = 0.5, plus 1 per card of that suit beyond the first. Take the best suit's strength and add 1 for each J held in other suits.

| Strength | Highest bid the bot will make |
|---|---|
| under 4 | pass |
| 4–5 | 16 |
| 5.5–6.5 | 17 |
| 7–8 | 18 |
| 8.5–9.5 | 19 |
| 10 or more | 20–21 |

Add 1 to the limit if the partner has already bid. The bot bids one above the current bid while that stays within its limit, otherwise passes. If forced as dealer, it takes 16.

**Trump choice**: the best-strength suit; ties go to the longer suit, then to the suit holding the J.

**Play** — track played cards and which seats have shown out of which suits.

- *Leading*: lead a J of a non-trump suit (it cannot be beaten while everyone follows). Next, a card that is now the highest left in its suit. As bidder after reveal, draw trumps with the J and 9 when holding 3 or more trumps. Otherwise lead a low card from the longest non-trump suit. Never lead a bare 9 or 10.
- *Following suit*: if partner is currently winning, add the highest point card that does not beat partner's card unnecessarily (give points). If an opponent is winning and the bot can win, win with the cheapest winning card — but in second seat do not spend a 9 when the J of that suit is still unplayed. If it cannot win, play the lowest zero-point card.
- *Cannot follow, trump hidden*: ask for trump if the trick holds 2 or more points and partner is not winning it, or if the bot is the bidder's partner and holds no useful discard. Otherwise discard the lowest zero-point card. The bidder bot reveals when the trick holds 3 or more points and it can win by trumping.
- *Cannot follow, trump revealed*: trump in when an opponent is winning and the trick has points, using the lowest trump that wins; give points when partner is winning; otherwise discard low.
- Hard bots add determinised sampling: deal the unseen cards at random 60 times consistent with what is known, play each candidate card out with the normal heuristics, and pick the card with the best average result. Budget 150 ms per move; run it off the main thread in solo mode.

## 8. Hazari

### 8.1 Rules

- 52 cards, 13 each.
- **Arranging**: every player privately splits their 13 cards into four groups: **three groups of 3 cards and one group of 4**, in the fixed order group 1, group 2, group 3, group 4. Groups must be in descending strength: group 1 ≥ group 2 ≥ group 3 ≥ group 4. All four players arrange at the same time and then lock in.
- **Combinations**, strongest first:

  | # | Name | Meaning | Tie-break |
  |---|---|---|---|
  | 1 | Troy | three cards of the same rank | higher rank; AAA is best |
  | 2 | Colour run | three in sequence, same suit | see run order |
  | 3 | Run | three in sequence, mixed suits | see run order |
  | 4 | Colour | three of the same suit, not in sequence | highest card, then second, then third |
  | 5 | Pair | two of the same rank | higher pair, then the odd card |
  | 6 | Indi | none of the above | highest card, then second, then third |

  **Run order**: A-K-Q is the highest, **A-2-3 is second**, then K-Q-J, Q-J-10, and so on down to 4-3-2. K-A-2 is not a run. Suits never break ties.
- **The 4-card group** (verify): its value is the best 3-card combination that can be made from its four cards; the fourth card is used only as a last tie-break.
- **Showdown**: four tricks. For trick 1 every player reveals group 1, in turn order starting with the seat after the dealer. The strongest group wins all the cards played. The winner of each trick starts the next. **If the best groups are exactly equal, the one played later wins.** Trick 4 uses the 4-card groups.
- **Points**: A, K, Q, J, 10 are worth 10 each; 9 down to 2 are worth 5 each. A deal contains 360 points. Each player scores the points of the cards they won.
- **Match end**: when one or more players reach `targetScore` (default **1000**) at the end of a deal, the highest total wins.

### 8.2 State phases

`arranging` (all four seats pending at once) → `showdown` (four automatic tricks, emitted as events) → `roundEnd` → next deal or `matchEnd`.

An arrangement action is `{ groups: [Card[3], Card[3], Card[3], Card[4]] }`. Validation checks: exactly the player's 13 cards, correct sizes, descending strength. The view shows other players only as "arranging" or "ready".

`combos.ts` exports `evaluate(cards): { type, tiebreak: number[] }` and `compare(a, b)`. This file needs the most thorough unit tests in the project (see 11).

### 8.3 Bot

The search space is small enough to solve directly: there are about 200,000 distinct ways to split 13 cards into 3 + 3 + 3 + 4, which evaluates in well under 100 ms.

1. Enumerate every split. Sort the three 3-card groups by strength and check that the 4-card group is the weakest; discard splits that fail.
2. Score each split as the sum over its four groups of `winProbability(group, position) × expectedPot`, where `winProbability` comes from a precomputed table: for each position (1–4), the chance that a group of this strength beats three opponents' groups in the same position.
3. Build that table once with `simulate.ts` (100,000 random deals arranged by a simple greedy bot), commit it as a JSON file, and regenerate it after the search bot exists so the table reflects stronger opponents.
4. Play the highest-scoring split. Easy bots use the greedy arrangement only (take the best available group, then the next best, and so on).

Also expose the search to the UI as a **"Suggest"** button and use the greedy version for **"Auto-arrange"** on timer expiry.

## 9. Screens and flows

1. **Home** — three large game tiles, each with a short description and two buttons: *Play solo* and *Play with friends*. A *Join with code* field. Settings (name, language, sound, reduced motion, card back) behind a gear icon.
2. **Lobby** (`/room/:code`) — the four seats drawn around a small table. Each seat shows a human (name, ready dot), a bot (with difficulty selector for the host) or *Open — tap to sit*. For 29, colour the two teams so players can see who their partner will be. Rule options for the host in a collapsible panel; read-only for others. Copy-link and share buttons (use the Web Share API on phones). *Start* is enabled for the host at any time; a note says "Empty seats will be played by bots".
3. **Game** (`/room/:code` in playing phase, or `/solo/:gameId`) — see 10.
4. **Round summary** — a sheet sliding up over the table with the score table, deltas animated, and *Next round*.
5. **Match end** — winner highlight, final table, *Rematch* and *Home*.
6. **How to play** — one page per game written from sections 6–8, reachable from Home and from a `?` button in the game.

Solo flow: Home → pick difficulty → game starts immediately. If a saved solo match exists, offer *Resume*.

## 10. UI, animation and responsiveness

### 10.1 Visual direction

- Calm, flat, modern. No green felt, no skeuomorphic wood. Dark theme by default with a light theme; follow `prefers-color-scheme` and allow override.
- Tokens as CSS variables: `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--danger`, `--success`, `--card-face`, `--card-back`, `--suit-red`, `--suit-black`, radius scale, shadow scale. Suggested dark values: background `#0f1320`, surface `#181d2e`, accent `#6c8cff`. One accent hue per game (blue, violet, amber) applied through a `data-game` attribute.
- Font: Inter for Latin; Hind Siliguri for Bangla. Tabular numerals for scores.
- **Cards are drawn in code as SVG** — no image assets. White rounded rectangle, rank and suit in the top-left and bottom-right corners, one large suit glyph in the centre; J, Q, K show a large letter instead of a portrait. Offer a four-colour suit option (blue diamonds, green clubs) in settings for readability. Corner indices must stay legible at 44 px card width.

### 10.2 Table layout

- Root game container is `100dvh`, uses `env(safe-area-inset-*)`, and never scrolls.
- One CSS variable drives all sizing: `--card-w: clamp(44px, min(11vw, 13vh), 96px)`; card height is `1.4 ×` that.
- **Portrait phone**: opponents as compact chips at top, left and right (avatar, name, card count, call/tricks or bid). Trick area in the centre. Your hand along the bottom as an overlapping row, sorted by suit then rank; overlap tightens automatically so 13 cards fit in the width. Tapping lifts a card; tapping again (or dragging up) plays it. Setting: single-tap to play.
- **Landscape phone**: same, with the hand flatter and the score chip moved to a corner.
- **Tablet and desktop**: seats on all four sides with visible fanned card backs, more spacing, and a persistent score panel on the right from 1100 px.
- Illegal cards are dimmed and do not lift; tapping one shakes it and shows a one-line reason ("You must follow hearts").
- Game-specific controls appear in a bottom sheet above the hand: the call picker (Call Bridge), the bid ladder with *Pass* (29), the suit picker for trump (29), the *Ask for trump* button (29).
- **Hazari arranging** is its own layout: four labelled rows (3, 3, 3, 4 slots) above a tray of unplaced cards. Drag cards between slots, or tap a card then tap a slot. Each row shows the live name of its combination ("Colour run", "Pair of 9s"). A row turns red when it is stronger than the row above it. Buttons: *Suggest*, *Clear*, *Ready* (disabled until valid).

### 10.3 Animation

All motion goes through the **director**: a queue that takes the events from each update and plays them one after another, applying the matching piece of the new view when each animation ends. Without this, a fast server makes cards teleport. If the queue grows beyond 12 events (for example after a reconnect), skip to the latest view instantly.

| Event | Animation | Duration |
|---|---|---|
| Deal | Cards fly from the deck to each seat, staggered 30 ms, then your hand flips face up and sorts | 900 ms total |
| Play card | Card travels from hand or seat to its slot in the trick area with a slight rotation; the hand closes the gap | 280 ms |
| Trick won | 500 ms pause so everyone can read the trick, then all four cards slide to the winner and shrink away; the winner's counter ticks up | 500 + 350 ms |
| Bid or call | Speech bubble pops from the seat | 200 ms |
| Trump reveal (29) | The face-down marker flips in 3D and the suit pulses once in the header | 600 ms |
| Hazari showdown | Seats reveal their group in turn order with a flip, the combination names appear, the winner glows, cards sweep to the winner | about 2.2 s per trick |
| Score update | Numbers count up or down; positive deltas green, negative red | 600 ms |
| Turn change | A ring sweeps around the active seat and doubles as the turn timer | continuous |

Implementation notes:

- Give every card a stable `layoutId` equal to its card id so `motion` animates it between containers. Opponents' cards have no identity until played; spawn them at the seat position.
- Animate only `transform` and `opacity`. Use spring transitions (stiffness about 420, damping about 34) for card movement.
- Honour `prefers-reduced-motion` and the in-app setting: replace movement with 120 ms fades and shorten pauses.
- Optional sound effects (deal, play, win, your turn), off until the user turns them on. Use `navigator.vibrate(10)` on your turn where supported.

### 10.4 Other quality requirements

- Languages: English and Bangla from the first commit of the UI. All strings come from `i18n/*.json`; game names, combination names and suit names have Bangla entries. Ship English complete; Bangla can be completed in milestone 7.
- Accessibility: every card is a button with a label such as "Ace of spades"; arrow keys move across the hand and Enter plays; visible focus rings; colour is never the only signal.
- Installable PWA with the app shell cached, so solo play works offline.
- Connection status pill ("Reconnecting…") and a non-blocking toast for rejected actions.

## 11. Testing

- **Rules unit tests** (Vitest), one file per game, covering at least:
  - Call Bridge: follow-suit enforcement; forced over-trump; no forced trump when the player's spades cannot beat the spade already played; both scoring modes including call + 2 under strict; bonus call.
  - 29: rank order J > 9 > A > 10; bidding end conditions including the forced dealer bid; trump hidden from non-bidders in every phase; asking for trump forces a trump; trump-suit cards do not win before the reveal; pair adjusts the target with both clamps; last-trick point; game-point changes.
  - Hazari: every combination type; A-K-Q > A-2-3 > K-Q-J; K-A-2 is not a run; pair and colour tie-breaks; 4-card group evaluation; later player wins exact ties; descending-order validation; points per deal sum to 360.
- **Simulation test**: for each game run 2,000 full bot-vs-bot matches with random seeds and assert that no move is illegal, no card is duplicated or lost, each round's points total is correct (13 tricks; 28 or 29; 360), and every match terminates.
- **Redaction test**: for every state reached in simulation, `JSON.stringify(viewFor(state, seat))` must not contain any card id from another player's hidden hand.
- **Server tests**: create/join/start; an illegal action is rejected; a stale `seq` is rejected; disconnect leads to autopilot and reconnect restores the seat; host migration.
- **End-to-end** (Playwright): two browser contexts create and join a room, start with two bots, and play one full round of each game; one solo round of each game at a 390 × 844 viewport and at 1440 × 900.
- Manual check on a real phone before calling any milestone done: animation smoothness and tap targets cannot be judged from tests.

## 12. Build order

Each milestone is sized for one focused implementation session and ends in something that runs. Do not start a milestone until the previous one's acceptance check passes.

| # | Milestone | Deliverable | Acceptance check |
|---|---|---|---|
| 1 | Foundations | Monorepo, tooling, `engine/core` (cards, deck, seeded RNG, seat helpers, shared types), empty web and server apps that start | `pnpm test`, `pnpm dev` and `pnpm build` all succeed |
| 2 | Call Bridge engine + bot | `rules.ts`, `bot.ts`, tests, simulation | Unit tests pass; 2,000 simulated matches finish cleanly |
| 3 | Game UI on Call Bridge, solo | Card component, hand, table, seats, director, `LocalSession`, call picker, round summary, match end, Home screen | A full solo match is playable on phone and desktop with all animations from 10.3 |
| 4 | Multiplayer | Server, protocol, lobby, `RemoteSession`, bot fill, timers, disconnect and reconnect | Two browsers plus two bots finish a Call Bridge match; killing one tab mid-game triggers autopilot and reopening it restores the seat |
| 5 | Twenty-nine | Engine, bot, tests, then bidding / trump / ask-for-trump UI and team scoring display | Simulation passes; solo and two-human matches playable |
| 6 | Hazari | `combos.ts`, engine, search bot and probability table, tests, arranging UI with drag and drop, showdown animation | Simulation passes; arranging works by drag and by tap on a 360 px wide screen |
| 7 | Polish | Bangla strings, How to play pages, settings, sounds, PWA, accessibility pass, light theme, emotes | Lighthouse accessibility score of 95 or more; solo works offline |
| 8 | Ship | Dockerfile, health endpoint, rate limits, production build served by Fastify, deploy | A match played between two real phones on mobile data |

Milestone 3 is where the shared UI is designed, so build its components to take game-specific pieces as props (what the seat badge shows, what the control sheet contains) instead of hard-coding Call Bridge. Milestones 5 and 6 should then add only a `games/<id>/` folder each.

## 13. Decisions for the product owner

These have defaults in this plan; change them here before implementation starts if they are wrong.

1. **Call Bridge scoring** — default is strict (call or call + 1 succeeds, otherwise minus the call). The alternative used by many phone apps is 0.1 per extra trick.
2. **Call Bridge minimum call** — default 1; some tables use 2.
3. **29, trump-suit cards played earlier in the trick where trump is revealed** — default: they count as trumps.
4. **29 last-trick point** — default on (29 points in total).
5. **Hazari 4-card group** — default: best 3-card combination inside it, fourth card as tie-break.
6. **Hosting** — the server needs a host that supports long-lived WebSocket connections.
