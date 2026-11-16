export type Suit = 'S' | 'H' | 'D' | 'C';
/** 2..10 as numbers, 11 = J, 12 = Q, 13 = K, 14 = A */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
/** Compact card id used everywhere in state: suit letter + rank code, e.g. "SA", "H10", "D7". */
export type CardId = string;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_CODE: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const CODE_RANK: Record<string, Rank> = { J: 11, Q: 12, K: 13, A: 14 };

export function cardId(suit: Suit, rank: Rank): CardId {
  return suit + (RANK_CODE[rank] ?? String(rank));
}

export function suitOf(id: CardId): Suit {
  return id[0] as Suit;
}

export function rankOf(id: CardId): Rank {
  const code = id.slice(1);
  return (CODE_RANK[code] ?? Number(code)) as Rank;
}

export function parseCard(id: CardId): Card {
  return { suit: suitOf(id), rank: rankOf(id) };
}

export function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && /^[SHDC](10|[2-9JQKA])$/.test(value);
}

/** Full 52-card pack, or a filtered pack (e.g. 7..A for Twenty-nine). */
export function makeDeck(ranks: readonly Rank[] = RANKS): CardId[] {
  const deck: CardId[] = [];
  for (const s of SUITS) for (const r of ranks) deck.push(cardId(s, r));
  return deck;
}

/** Display order for hands: spades, hearts, clubs, diamonds (alternating colours), high to low. */
const SUIT_SORT: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };

export function sortHand(hand: readonly CardId[], power: (id: CardId) => number = rankOf): CardId[] {
  return [...hand].sort((a, b) => {
    const ds = SUIT_SORT[suitOf(a)] - SUIT_SORT[suitOf(b)];
    return ds !== 0 ? ds : power(b) - power(a);
  });
}

export function removeCard(hand: readonly CardId[], card: CardId): CardId[] {
  const i = hand.indexOf(card);
  if (i < 0) throw new Error(`card ${card} not in hand`);
  return [...hand.slice(0, i), ...hand.slice(i + 1)];
}
