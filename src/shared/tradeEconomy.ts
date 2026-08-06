/**
 * Trade-route knowledge: which economy class produces each trade-good
 * family and where it sells at the biggest markup.
 *
 * NMS trade goods follow two fixed loops (each economy consumes the goods
 * of the previous one at up to +80% in wealthy systems):
 *   Mining -> Manufacturing -> Technology -> Power Generation -> Mining
 *   Scientific -> Trading -> Advanced Materials -> Scientific
 * Smuggled goods sit outside the loops: bought cheap at outlaw stations,
 * sold at a premium in any regulated system.
 */

export type EconomyClass =
  | 'Mining'
  | 'Manufacturing'
  | 'Technology'
  | 'Power Generation'
  | 'Trading'
  | 'Advanced Materials'
  | 'Scientific'

/**
 * In-game economy descriptor -> canonical class. Every system shows one of
 * four flavour names per class; the keys match the canonical labels emitted
 * by systemParser's ECONOMY_TYPES. "Construction" is ambiguous in-game
 * (Manufacturing flavour, while "Nano-construction" belongs to Technology);
 * the parser folds both into 'Construction', so it lands on Manufacturing.
 */
const ECONOMY_CLASS: Record<string, EconomyClass> = {
  'Mining': 'Mining',
  'Minerals': 'Mining',
  'Ore Extraction': 'Mining',
  'Prospecting': 'Mining',
  'Manufacturing': 'Manufacturing',
  'Industrial': 'Manufacturing',
  'Construction': 'Manufacturing',
  'Mass Production': 'Manufacturing',
  'Technology': 'Technology',
  'High Tech': 'Technology',
  'Engineering': 'Technology',
  'Nano-construction': 'Technology',
  'Power Generation': 'Power Generation',
  'Energy Supply': 'Power Generation',
  'Fuel Generation': 'Power Generation',
  'High Voltage': 'Power Generation',
  'Trading': 'Trading',
  'Commercial': 'Trading',
  'Mercantile': 'Trading',
  'Shipping': 'Trading',
  'Advanced Materials': 'Advanced Materials',
  'Alchemical': 'Advanced Materials',
  'Metal Processing': 'Advanced Materials',
  'Ore Processing': 'Advanced Materials',
  'Scientific': 'Scientific',
  'Research': 'Scientific',
  'Experimental': 'Scientific',
  'Mathematical': 'Scientific'
}

/** Wealth descriptor -> tier (1 poor, 2 average, 3 wealthy). */
const WEALTH_TIER: Record<string, 1 | 2 | 3> = {
  'Declining': 1,
  'Destitute': 1,
  'Failing': 1,
  'Fledgling': 1,
  'Low Supply': 1,
  'Struggling': 1,
  'Unpromising': 1,
  'Unsuccessful': 1,
  'Adequate': 2,
  'Balanced': 2,
  'Comfortable': 2,
  'Developing': 2,
  'Medium Supply': 2,
  'Promising': 2,
  'Satisfactory': 2,
  'Sustainable': 2,
  'Advanced': 3,
  'Affluent': 3,
  'Booming': 3,
  'Flourishing': 3,
  'High Supply': 3,
  'Opulent': 3,
  'Prosperous': 3,
  'Wealthy': 3
}

/**
 * Classify a stored economy descriptor ("Ore Extraction · Booming",
 * "High Tech", ...) into its canonical class, or null if unknown.
 */
export function classifyEconomy(economy: string | null | undefined): EconomyClass | null {
  if (!economy) return null
  const type = economy.split('·')[0].trim()
  return ECONOMY_CLASS[type] ?? null
}

/** Wealth tier of a stored economy descriptor, or null if not recorded. */
export function economyWealth(economy: string | null | undefined): 1 | 2 | 3 | null {
  if (!economy) return null
  const strength = economy.split('·')[1]?.trim()
  return strength ? (WEALTH_TIER[strength] ?? null) : null
}

export interface TradeSellAdvice {
  /** Economy class that produces (sells cheap) this family. */
  producedBy: EconomyClass | null
  /** Economy class that pays the markup, or null when any regulated system does. */
  sellAt: EconomyClass | null
  /** One-line human note for the UI. */
  note: string
}

/** Item group (AssistantNMS naming, as used by itemInfo) -> sell advice. */
const SELL_ADVICE: Record<string, TradeSellAdvice> = {
  'Trade Goods (Minerals)': advice('Mining', 'Manufacturing'),
  'Trade Goods (Industrial)': advice('Manufacturing', 'Technology'),
  'Trade Goods (Technology)': advice('Technology', 'Power Generation'),
  'Trade Goods (Energy Source)': advice('Power Generation', 'Mining'),
  'Trade Goods (Scientific)': advice('Scientific', 'Trading'),
  'Trade Goods': advice('Trading', 'Advanced Materials'),
  'Trade Goods (Construction)': advice('Advanced Materials', 'Scientific'),
  'Smuggled Goods': {
    producedBy: null,
    sellAt: null,
    note: 'Bought cheap at outlaw stations — sells at a premium in any regulated system'
  }
}

function advice(producedBy: EconomyClass, sellAt: EconomyClass): TradeSellAdvice {
  return {
    producedBy,
    sellAt,
    note: `Made by ${producedBy} economies — sells highest in wealthy ${sellAt} systems`
  }
}

/** Best-economy advice for an item group, or null for non-trade groups. */
export function tradeSellAdvice(group: string | null | undefined): TradeSellAdvice | null {
  return group ? (SELL_ADVICE[group] ?? null) : null
}
