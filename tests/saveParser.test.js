/**
 * Tests for save-file extraction, driven by synthetic save trees shaped
 * like a real Game Pass save (obfuscated keys, mixed address encodings).
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  DEFAULT_KEY_MAPPING,
  deobfuscateKeys,
  extractBases,
  extractPlanets,
  extractSystems
} = require('./.build/main/services/saveParser.js')

/** A base entry as it appears in a modern save, already deobfuscated. */
const base = (galacticAddress, type, name, objects = []) => ({
  GalacticAddress: galacticAddress,
  BaseType: { PersistentBaseTypes: type },
  Name: name,
  Objects: objects
})

test('extractBases: planet bases resolve system address and planet index', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        PersistentPlayerBases: [
          base('0x20720001B50AC3', 'HomePlanetBase', 'Auguso Outpost', [{}, {}, {}]),
          // Bare hex (no 0x prefix) appears in the same save's other entries.
          base('11fa0001b50ac3', 'HomePlanetBase', 'Ratfordu-Beyth Base')
        ]
      }
    }
  }
  const bases = extractBases(root)
  assert.strictEqual(bases.length, 2)
  assert.strictEqual(bases[0].name, 'Auguso Outpost')
  assert.strictEqual(bases[0].systemAddress, 'R0:-1341:1:-1200:114')
  assert.strictEqual(bases[0].planetIndex, 2)
  assert.strictEqual(bases[0].parts, 3)
  assert.strictEqual(bases[1].systemAddress, 'R0:-1341:1:-1200:506')
  assert.strictEqual(bases[1].planetIndex, 1)
})

test('extractBases: freighter base gets a fallback name and no planet', () => {
  const root = {
    PlayerStateData: {
      PersistentPlayerBases: [base(0x720001b50ac3, 'FreighterBase', '')]
    }
  }
  const bases = extractBases(root)
  assert.strictEqual(bases.length, 1)
  assert.strictEqual(bases[0].name, 'Freighter Base')
  assert.strictEqual(bases[0].baseType, 'FreighterBase')
  assert.strictEqual(bases[0].planetIndex, null)
  assert.strictEqual(bases[0].systemAddress, 'R0:-1341:1:-1200:114')
})

// A teleport endpoint with a structured UniversalAddress, as in a real save.
const endpoint = (type, name, planetIndex = 0, ssi = 424) => ({
  UniversalAddress: {
    RealityIndex: 0,
    GalacticAddress: {
      VoxelX: -1341,
      VoxelY: 1,
      VoxelZ: -1200,
      SolarSystemIndex: ssi,
      PlanetIndex: planetIndex
    }
  },
  TeleporterType: type,
  Name: name
})

test('only station endpoints may name a system', () => {
  // Real incident: the settlement endpoint "Einingc's Crossing" named its
  // whole system, hiding the true name (Idgefie) and orphaning its planets.
  const root = {
    BaseContext: {
      PlayerStateData: {
        TeleportEndpoints: [
          endpoint('Settlement', "Einingc's Crossing", 1, 424),
          endpoint('Base', 'Shvil Base', 2, 514),
          endpoint('Spacestation', 'Leuz Station Tau', 0, 122)
        ]
      }
    }
  }
  const byAddress = Object.fromEntries(extractSystems(root).map((s) => [s.universalAddress, s.name]))
  assert.deepStrictEqual(byAddress, {
    'R0:-1341:1:-1200:424': 'Unknown System',
    'R0:-1341:1:-1200:514': 'Unknown System',
    'R0:-1341:1:-1200:122': 'Leuz Station Tau'
  })
})

test('extractBases: the settlement endpoint lands on its planet', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        TeleportEndpoints: [
          endpoint('Settlement', "Einingc's Crossing", 1),
          endpoint('Spacestation', 'Leuz Station Tau', 0, 122) // not a base
        ],
        PersistentPlayerBases: [base('0x20720001B50AC3', 'HomePlanetBase', 'Auguso Outpost')]
      }
    }
  }
  const bases = extractBases(root)
  assert.deepStrictEqual(
    bases.map((b) => [b.name, b.baseType, b.systemAddress, b.planetIndex]),
    [
      ["Einingc's Crossing", 'Settlement', 'R0:-1341:1:-1200:424', 1],
      ['Auguso Outpost', 'HomePlanetBase', 'R0:-1341:1:-1200:114', 2]
    ]
  )
})

test("extractBases: other players' visited bases are skipped", () => {
  const root = {
    PlayerStateData: {
      PersistentPlayerBases: [
        base('0x20720001B50AC3', 'ExternalPlanetBase', 'Someone Else'),
        base('0x20720001B50AC3', 'HomePlanetBase', 'Mine')
      ]
    }
  }
  const bases = extractBases(root)
  assert.strictEqual(bases.length, 1)
  assert.strictEqual(bases[0].name, 'Mine')
})

// A SolarSystem discovery record; flags = the FL block ({ H: 1 } = hidden).
const discoveryRecord = (ua, flags) => ({
  DD: { UA: ua, DT: 'SolarSystem' },
  ...(flags ? { FL: flags } : {})
})

test('extractSystems: hidden discovery records are never-visited cache — skipped', () => {
  // Real save evidence: the store caches other players' discoveries (names
  // shown while browsing the galaxy map) with FL.H set; every system the
  // player verifiably visited (teleporter endpoints) lacks the flag.
  const root = {
    DiscoveryManagerData: {
      'DiscoveryData-v1': {
        Store: {
          Record: [
            discoveryRecord('0x10AB0001B50AC3'), // visited, no flags
            discoveryRecord('0x10AC0001B50AC3', { C: 1 }), // visited, uploaded
            discoveryRecord('0x10AD0001B50AC3', { C: 1, H: 1 }), // cached, hidden
            discoveryRecord('0x10AE0001B50AC3', { H: 1 }) // cached, hidden
          ]
        }
      }
    }
  }
  const addresses = extractSystems(root).map((s) => s.universalAddress)
  assert.deepStrictEqual(addresses, ['R0:-1341:1:-1200:171', 'R0:-1341:1:-1200:172'])
})

test('extractSystems: hidden-flag keys deobfuscate via the default mapping', () => {
  const obfuscated = {
    fDu: {
      ETO: {
        OsQ: {
          '?fB': [
            { '8P3': { '5L6': '0x10AB0001B50AC3', '<Dn': 'SolarSystem' }, '=wD': { bLr: 1 } },
            { '8P3': { '5L6': '0x10AD0001B50AC3', '<Dn': 'SolarSystem' }, '=wD': { bLr: 1, tiH: 1 } }
          ]
        }
      }
    }
  }
  const systems = extractSystems(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.deepStrictEqual(
    systems.map((s) => s.universalAddress),
    ['R0:-1341:1:-1200:171']
  )
})

test('extractSystems: player-given names come from the DM metadata block', () => {
  const root = {
    DiscoveryManagerData: {
      'DiscoveryData-v1': {
        Store: {
          Record: [
            { ...discoveryRecord('0x10AB0001B50AC3'), DM: { CN: 'Newpoint' } },
            discoveryRecord('0x10AC0001B50AC3'), // never renamed
            { ...discoveryRecord('0x10AD0001B50AC3', { H: 1 }), DM: { CN: 'Cached Name' } }
          ]
        }
      }
    }
  }
  const byAddress = Object.fromEntries(
    extractSystems(root).map((s) => [s.universalAddress, s.name])
  )
  // The hidden record stays skipped even when it carries a name.
  assert.deepStrictEqual(byAddress, {
    'R0:-1341:1:-1200:171': 'Newpoint',
    'R0:-1341:1:-1200:172': 'Unknown System'
  })
})

test('extractSystems: custom-name keys deobfuscate via the default mapping', () => {
  const obfuscated = {
    fDu: {
      ETO: {
        OsQ: {
          '?fB': [
            {
              '8P3': { '5L6': '0x10AB0001B50AC3', '<Dn': 'SolarSystem' },
              q9a: { q5u: 'Bam bam uh uh' }
            }
          ]
        }
      }
    }
  }
  const systems = extractSystems(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.strictEqual(systems[0].name, 'Bam bam uh uh')
})

test('extractPlanets: player-given planet names come from the DM block too', () => {
  const root = {
    DiscoveryManagerData: {
      'DiscoveryData-v1': {
        Store: {
          Record: [
            { DD: { UA: '0x30AB0001B50AC3', DT: 'Planet' }, DM: { CN: 'New Skjov' } },
            { DD: { UA: '0x40AB0001B50AC3', DT: 'Planet' } }
          ]
        }
      }
    }
  }
  const planets = extractPlanets(root)
  assert.deepStrictEqual(
    planets.map((p) => [p.name, p.planetIndex, p.hasCustomName]),
    [
      ['New Skjov', 3, true],
      ['Planet 4', 4, false]
    ]
  )
})

test('extractSystems: ownership yields discoverer, never a system name', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        TeleportEndpoints: [endpoint('Spacestation', 'Leuz Station Tau', 0, 171)]
      }
    },
    DiscoveryManagerData: {
      'DiscoveryData-v1': {
        Store: {
          Record: [
            {
              // Same system as the station endpoint: ownership merges in.
              ...discoveryRecord('0x10AB0001B50AC3'),
              OWS: { USN: 'I Am Chimpuat', PTK: 'XB', TS: 1566518400 }
            },
            {
              // Discovery-only system: USN must NOT become its name.
              ...discoveryRecord('0x10AC0001B50AC3'),
              OWS: { USN: 'Adirdax', TS: 1471464995 }
            }
          ]
        }
      }
    }
  }
  const byAddress = Object.fromEntries(
    extractSystems(root).map((s) => [s.universalAddress, [s.name, s.discoveredBy, s.discoveredAt?.slice(0, 10)]])
  )
  assert.deepStrictEqual(byAddress, {
    'R0:-1341:1:-1200:171': ['Leuz Station Tau', 'I Am Chimpuat', '2019-08-23'],
    'R0:-1341:1:-1200:172': ['Unknown System', 'Adirdax', '2016-08-17']
  })
})

test('extractSystems: ownership keys deobfuscate via the default mapping', () => {
  const obfuscated = {
    fDu: {
      ETO: {
        OsQ: {
          '?fB': [
            {
              '8P3': { '5L6': '0x10AB0001B50AC3', '<Dn': 'SolarSystem' },
              ksu: { 'V?:': 'Kai', D6b: 'NI', '3I1': 1760379033 }
            }
          ]
        }
      }
    }
  }
  const [sys] = extractSystems(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.strictEqual(sys.name, 'Unknown System')
  assert.strictEqual(sys.discoveredBy, 'Kai')
  assert.strictEqual(sys.discoveredAt?.slice(0, 10), '2025-10-13')
})

test('extractBases: obfuscated keys are handled via the default mapping', () => {
  const obfuscated = {
    vLc: {
      '6f=': {
        'F?0': [
          {
            GalacticAddress: '0x20720001B50AC3',
            peI: { DPp: 'HomePlanetBase' },
            NKm: 'Obfuscated Base',
            '@ZJ': [{}, {}]
          }
        ]
      }
    }
  }
  const bases = extractBases(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.strictEqual(bases.length, 1)
  assert.strictEqual(bases[0].name, 'Obfuscated Base')
  assert.strictEqual(bases[0].planetIndex, 2)
  assert.strictEqual(bases[0].parts, 2)
})
