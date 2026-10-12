import crypto from 'node:crypto';

/** UNO deck and move rules — no I/O, so the engine and its tests share one source of truth. */

export const COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type Color = (typeof COLORS)[number];
export type Value = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
export type Card = { id: string; color: Color | 'wild'; value: Value };

export const isWild = (c: Card) => c.value === 'wild' || c.value === 'wild4';
export const isNumber = (c: Card) => /^[0-9]$/.test(c.value);

/** The standard 108 cards: per color one 0, two of 1–9, skip, reverse and draw two; plus 4 wilds and 4 wild draw fours. */
export function newDeck(): Card[] {
  const cards: Omit<Card, 'id'>[] = [];
  for (const color of COLORS) {
    cards.push({ color, value: '0' });
    for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'] as const) {
      cards.push({ color, value }, { color, value });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ color: 'wild', value: 'wild' }, { color: 'wild', value: 'wild4' });
  return shuffle(cards.map((c) => ({ ...c, id: crypto.randomBytes(5).toString('hex') })));
}

/** Fisher–Yates with a cryptographic RNG, so nobody can predict the deal. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Plain match: same color as the one in play, same number or symbol, or any wild. Ignores the +4 restriction. */
function matches(card: Card, top: Card, color: Color) {
  if (isWild(card)) return true;
  return card.color === color || card.value === top.value;
}

/**
 * Whether `card` may go on the pile now. A Wild Draw Four is only allowed when nothing else in the
 * hand could be played (house rule from the NivoTalk rules card).
 */
export function canPlay(card: Card, hand: Card[], top: Card, color: Color) {
  if (!matches(card, top, color)) return false;
  if (card.value !== 'wild4') return true;
  return !hand.some((c) => c.value !== 'wild4' && matches(c, top, color));
}

export const hasPlayable = (hand: Card[], top: Card, color: Color) => hand.some((c) => canPlay(c, hand, top, color));
