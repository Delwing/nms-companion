/**
 * Game-accurate display metadata for catalogued planetary resources.
 *
 * `colour` is the substance tint NMS itself uses on its icons, extracted
 * from the AssistantNMS English datasets (github.com/AssistantNMS/App,
 * assets/json/en: RawMaterials/Products/Curiosity, field `Colour`).
 * `group` is the in-game subtitle for the item. Panel-only rows
 * (Salvageable Scrap, Ancient Bones, Vile Brood) are not items in the
 * game data — their colours are hand-picked to match the panel icons.
 * Regenerate extracted values from the datasets rather than editing.
 */
export type ResourceFamily = 'stellar' | 'mineral' | 'plant' | 'special'

export interface ResourceMeta {
  colour: string
  group: string
  family: ResourceFamily
}

export const FAMILY_ORDER: ResourceFamily[] = ['stellar', 'mineral', 'plant', 'special']

export const FAMILY_LABELS: Record<ResourceFamily, string> = {
  stellar: 'Stellar metals',
  mineral: 'Minerals & elements',
  plant: 'Harvested flora',
  special: 'Special & salvage'
}

export const RESOURCE_META: Record<string, ResourceMeta> = {
  // Stellar metals, coloured by star class like the game does.
  'Copper': { colour: '#E59001', group: 'Refined Stellar Metal: Yellow', family: 'stellar' },
  'Activated Copper': { colour: '#E59001', group: 'Refined Stellar Metal: Yellow', family: 'stellar' },
  'Cadmium': { colour: '#7B0000', group: 'Refined Stellar Metal: Red', family: 'stellar' },
  'Activated Cadmium': { colour: '#7B0000', group: 'Refined Stellar Metal: Red', family: 'stellar' },
  'Emeril': { colour: '#36611C', group: 'Refined Stellar Metal: Green', family: 'stellar' },
  'Activated Emeril': { colour: '#36611C', group: 'Refined Stellar Metal: Green', family: 'stellar' },
  'Indium': { colour: '#01387D', group: 'Refined Stellar Metal: Blue', family: 'stellar' },
  'Activated Indium': { colour: '#01387D', group: 'Refined Stellar Metal: Blue', family: 'stellar' },

  'Paraffinium': { colour: '#4E404F', group: 'Localised Earth Element', family: 'mineral' },
  'Pyrite': { colour: '#E57002', group: 'Localised Earth Element', family: 'mineral' },
  'Ammonia': { colour: '#00A64D', group: 'Localised Earth Element', family: 'mineral' },
  'Uranium': { colour: '#FFAD00', group: 'Localised Earth Element', family: 'mineral' },
  'Dioxite': { colour: '#1E4FD0', group: 'Localised Earth Element', family: 'mineral' },
  'Phosphorus': { colour: '#DB2400', group: 'Localised Earth Element', family: 'mineral' },
  'Basalt': { colour: '#1A2733', group: 'Localised Earth Element', family: 'mineral' },
  'Sodium': { colour: '#F26D15', group: 'Unrefined Catalytic Element', family: 'mineral' },
  'Sodium Nitrate': { colour: '#F26D15', group: 'Refined Catalytic Element', family: 'mineral' },
  'Cobalt': { colour: '#005C83', group: 'Subterranean Mineral', family: 'mineral' },
  'Ionised Cobalt': { colour: '#005C83', group: 'Processed Subterranean Mineral', family: 'mineral' },
  'Magnetised Ferrite': { colour: '#8A7F72', group: 'Charged Metallic Element', family: 'mineral' },
  'Silver': { colour: '#8A7F72', group: 'Valuable Asteroid Mineral', family: 'mineral' },
  'Gold': { colour: '#AA6E06', group: 'Valuable Asteroid Mineral', family: 'mineral' },
  'Platinum': { colour: '#507575', group: 'Valuable Asteroid Mineral', family: 'mineral' },
  'Salt': { colour: '#1E8A42', group: 'Aquatic Mineral Extract', family: 'mineral' },
  'Chlorine': { colour: '#1E8A42', group: 'Processed Aquatic Mineral', family: 'mineral' },
  'Atlantideum': { colour: '#4D2957', group: 'Disharmonic Metal', family: 'mineral' },

  'Star Bulb': { colour: '#208DAB', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Solanium': { colour: '#B94318', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Solar Vine': { colour: '#F3A923', group: 'Plantable Seed', family: 'plant' },
  'Frost Crystal': { colour: '#1E4FD0', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Fungal Mould': { colour: '#00A64D', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Cactus Flesh': { colour: '#239626', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Gamma Root': { colour: '#C5871D', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Faecium': { colour: '#79502E', group: 'Harvested Agricultural Substance', family: 'plant' },
  'Mordite': { colour: '#512741', group: 'Harvested Substance', family: 'plant' },

  'Storm Crystal': { colour: '#CCCCCC', group: 'Unique Valuable Curiosity', family: 'special' },
  'Rusted Metal': { colour: '#5B6F35', group: 'Junk', family: 'special' },
  'Salvageable Scrap': { colour: '#CCCCCC', group: 'Planetary Salvage', family: 'special' },
  'Ancient Bones': { colour: '#C9B27C', group: 'Buried Remains', family: 'special' },
  'Vile Brood': { colour: '#007951', group: 'Infestation', family: 'special' }
}

const DEFAULT_META: ResourceMeta = {
  colour: '#67E8F9',
  group: 'Unclassified substance',
  family: 'special'
}

/** Metadata for a resource; item-table fallback finds can miss the map. */
export function resourceMeta(name: string): ResourceMeta {
  return RESOURCE_META[name] ?? DEFAULT_META
}

/** Sort comparator: game family order, then name — clusters like colours. */
export function compareResources(a: string, b: string): number {
  const fa = FAMILY_ORDER.indexOf(resourceMeta(a).family)
  const fb = FAMILY_ORDER.indexOf(resourceMeta(b).family)
  return fa - fb || a.localeCompare(b)
}
