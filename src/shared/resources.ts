/**
 * Canonical resource names with OCR-tolerant signatures. Order matters:
 * compound names (Activated Copper, Sodium Nitrate) are consumed from the
 * text before their base-metal counterparts can match.
 */
export const RESOURCE_SIGNATURES: Array<[string, RegExp]> = [
  ['Activated Copper', /activated\s+copper/i],
  ['Activated Cadmium', /activated\s+cadmium/i],
  ['Activated Emeril', /activated\s+emeril/i],
  ['Activated Indium', /activated\s+indium/i],
  ['Sodium Nitrate', /sodium\s+nitrate/i],
  ['Ionised Cobalt', /ionised\s+cobalt/i],
  // "Ferrite" is optional: the flight HUD wraps the name and OCR often
  // loses the second line, and no other resource starts "Magnetised".
  ['Magnetised Ferrite', /magneti[sz]ed(?:\s+ferrite)?/i],
  ['Copper', /copper/i],
  ['Cadmium', /cadmium/i],
  ['Emeril', /emeril/i],
  ['Indium', /indium/i],
  ['Paraffinium', /paraffinium/i],
  ['Pyrite', /pyrite/i],
  ['Ammonia', /ammonia/i],
  ['Uranium', /uranium/i],
  ['Dioxite', /dioxite/i],
  ['Phosphorus', /phosphorus/i],
  ['Star Bulb', /star\s*bulb/i],
  ['Solanium', /solanium/i],
  ['Solar Vine', /solar\s*vine/i],
  ['Frost Crystal', /frost\s*crystal/i],
  ['Fungal Mould', /fungal\s*mo[uo]ld/i],
  ['Cactus Flesh', /cactus/i],
  ['Gamma Root', /gamma\s*root/i],
  ['Sodium', /sodium/i],
  ['Cobalt', /cobalt/i],
  ['Silver', /\bsilver\b/i],
  ['Gold', /\bgold\b/i],
  ['Platinum', /platinum/i],
  ['Salt', /\bsalts?\b/i],
  ['Chlorine', /chlorine/i],
  ['Basalt', /basalt/i],
  ['Mordite', /mordite/i],
  ['Faecium', /faecium/i],
  ['Storm Crystal', /storm\s*crystal/i],
  // Corrupted-sentinel worlds (Interceptor update; absent from the older
  // extracted item table, so the itemNames fallback can't recover it).
  ['Atlantideum', /atlantideum/i],
  // Salvage/special resources: cards list these alongside minerals.
  ['Salvageable Scrap', /salvageable\s+scrap/i],
  ['Ancient Bones', /ancient\s+bones/i],
  ['Rusted Metal', /rusted\s+metal/i],
  ['Vile Brood', /vile\s+brood/i]
]

/** Every resource the OCR parser can recognise, in canonical spelling. */
export const KNOWN_RESOURCES: string[] = RESOURCE_SIGNATURES.map(([name]) => name)
