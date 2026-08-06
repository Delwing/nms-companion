/**
 * Geometry helpers shared by the map's draw layers. Everything here builds
 * plain three.js buffers — no scene graph, no React — so the components stay
 * about layout and interaction.
 */
import * as THREE from 'three'
import type { Voxel } from '@shared/galaxyMap'
import { CELL_SIZE } from './theme'

/**
 * Cube corner index bits: 1 = +x, 2 = +z, 4 = +y. The edge list walks the
 * bottom ring, the top ring, then the four verticals.
 */
const CUBE_EDGES: [number, number][] = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
]

function corner(index: number, half: number): [number, number, number] {
  return [
    (index & 1 ? 1 : -1) * half,
    (index & 4 ? 1 : -1) * half,
    (index & 2 ? 1 : -1) * half
  ]
}

/** Scene position of a voxel, relative to a cluster origin. */
export function scenePosition(voxel: Voxel, origin: Voxel): [number, number, number] {
  return [
    (voxel.x - origin.x) * CELL_SIZE,
    (voxel.y - origin.y) * CELL_SIZE,
    (voxel.z - origin.z) * CELL_SIZE
  ]
}

/**
 * One LineSegments buffer holding the wireframes of every given cell. Drawing
 * all cubes' edges as a single geometry keeps the draw call count at one,
 * which matters far more than instancing at these counts.
 *
 * `colorFor` returns each cube's edge colour; omit it for an untinted buffer.
 */
export function buildEdgeGeometry(
  cells: readonly Voxel[],
  origin: Voxel,
  size: number,
  colorFor?: (index: number) => THREE.Color
): THREE.BufferGeometry {
  const half = size / 2
  const positions = new Float32Array(cells.length * CUBE_EDGES.length * 2 * 3)
  const colors = colorFor ? new Float32Array(cells.length * CUBE_EDGES.length * 2 * 3) : null

  let offset = 0
  cells.forEach((cell, index) => {
    const [cx, cy, cz] = scenePosition(cell, origin)
    const color = colorFor?.(index)
    for (const [a, b] of CUBE_EDGES) {
      for (const point of [corner(a, half), corner(b, half)]) {
        positions[offset] = cx + point[0]
        positions[offset + 1] = cy + point[1]
        positions[offset + 2] = cz + point[2]
        if (colors && color) {
          colors[offset] = color.r
          colors[offset + 1] = color.g
          colors[offset + 2] = color.b
        }
        offset += 3
      }
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** One buffer holding every given line segment, as [from, to] point pairs. */
export function buildSegments(
  pairs: readonly [[number, number, number], [number, number, number]][]
): THREE.BufferGeometry {
  const positions = new Float32Array(pairs.length * 6)
  pairs.forEach(([from, to], index) => {
    positions.set(from, index * 6)
    positions.set(to, index * 6 + 3)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

/**
 * Concentric rings on the XZ plane, as one line buffer. Used for the
 * overview's distance-from-core scale.
 */
export function buildRings(radii: readonly number[], segments = 128): THREE.BufferGeometry {
  const pairs: [[number, number, number], [number, number, number]][] = []
  for (const radius of radii) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const b = ((i + 1) / segments) * Math.PI * 2
      pairs.push([
        [Math.cos(a) * radius, 0, Math.sin(a) * radius],
        [Math.cos(b) * radius, 0, Math.sin(b) * radius]
      ])
    }
  }
  return buildSegments(pairs)
}

/**
 * A soft radial dot used as the star sprite. Generated at runtime rather than
 * shipped as an asset so the map folder stays self-contained and deletable.
 */
export function createStarTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(220,240,255,0.85)')
  gradient.addColorStop(1, 'rgba(180,220,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}
