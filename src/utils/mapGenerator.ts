// Seeded procedural generator for 3D battlegrounds.
// Guarantees all players render the exact same terrain from the lobby map seed.

export interface MapNode {
  x: number;
  z: number;
  height: number; // 0 = Plain, 1 = Low Hill, 2 = High Ridge, -1 = River / Water
  type: 'plain' | 'hill' | 'ridge' | 'water' | 'bridge';
  resourceSpot: boolean; // Oil Derrick site
}

export interface StartingBase {
  playerId: string;
  x: number;
  z: number;
  team: number;
}

export interface MapDecoration {
  type: 'tree' | 'rock' | 'ruin_pillar' | 'bush';
  x: number;
  z: number;
  scale: number;
  rotation: number;
}

export interface GeneratedMap {
  seed: number;
  size: number;
  nodes: MapNode[][];
  startingBases: StartingBase[];
  resourceSpots: { x: number; z: number }[];
  decorations: MapDecoration[];
}

// Simple deterministic seeded random generator
export function createSeededRandom(seed: number) {
  let s = seed;
  return function() {
    // Linear Congruential Generator (LCG)
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function generateProceduralMap(seed: number, size: number, players: { id: string; team: number }[]): GeneratedMap {
  const rand = createSeededRandom(seed);
  
  // 1. Initialize grid
  const nodes: MapNode[][] = [];
  for (let x = 0; x < size; x++) {
    nodes[x] = [];
    for (let z = 0; z < size; z++) {
      nodes[x][z] = {
        x,
        z,
        height: 0,
        type: 'plain',
        resourceSpot: false
      };
    }
  }

  // 2. Generate natural terrain features (Hills and Ridges)
  // We place radial clumps of hills deterministically
  const numHillClumps = Math.floor(size / 6);
  for (let i = 0; i < numHillClumps; i++) {
    const cx = Math.floor(rand() * (size - 10)) + 5;
    const cz = Math.floor(rand() * (size - 10)) + 5;
    const radius = Math.floor(rand() * 6) + 4;
    const peakHeight = rand() > 0.4 ? 1 : 2;

    for (let x = Math.max(0, cx - radius); x < Math.min(size, cx + radius); x++) {
      for (let z = Math.max(0, cz - radius); z < Math.min(size, cz + radius); z++) {
        const dx = x - cx;
        const dz = z - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < radius) {
          const factor = 1 - (dist / radius);
          const node = nodes[x][z];
          if (factor > 0.45) {
            node.height = peakHeight;
            node.type = peakHeight === 2 ? 'ridge' : 'hill';
          } else if (dist < radius && node.height === 0) {
            node.height = 1;
            node.type = 'hill';
          }
        }
      }
    }
  }

  // 3. Generate a primary diagonal or center-crossing river/rift
  // To divide the map and force tactical bottle-necks (bridges!)
  const riverType = rand() > 0.5 ? 'horizontal' : 'diagonal';
  const riverWidth = 3;

  if (riverType === 'horizontal') {
    const rz = Math.floor(size / 2);
    // Draw river
    for (let x = 0; x < size; x++) {
      // Small sine wave sway on the river
      const sway = Math.floor(Math.sin(x * 0.15) * 2);
      const tz = rz + sway;
      for (let w = -Math.floor(riverWidth/2); w <= Math.floor(riverWidth/2); w++) {
        const targetZ = tz + w;
        if (targetZ >= 0 && targetZ < size) {
          nodes[x][targetZ].height = -1;
          nodes[x][targetZ].type = 'water';
        }
      }
    }

    // Place 2 bridges across the river for ground columns to advance
    const bridgeX1 = Math.floor(size * 0.25);
    const bridgeX2 = Math.floor(size * 0.75);
    const bridges = [bridgeX1, bridgeX2];

    for (const bx of bridges) {
      const sway = Math.floor(Math.sin(bx * 0.15) * 2);
      const tz = rz + sway;
      for (let w = -3; w <= 3; w++) {
        const targetZ = tz + w;
        if (targetZ >= 0 && targetZ < size) {
          const node = nodes[bx][targetZ];
          node.height = 0;
          node.type = 'bridge';
        }
        // Also bridges should have a left-right support border
        for (let dw = -1; dw <= 1; dw++) {
          if (bx + dw >= 0 && bx + dw < size && targetZ >= 0 && targetZ < size) {
            const node = nodes[bx + dw][targetZ];
            node.height = 0;
            node.type = 'bridge';
          }
        }
      }
    }
  } else {
    // Diagonal river
    for (let x = 0; x < size; x++) {
      const targetZ = x;
      for (let w = -Math.floor(riverWidth/2); w <= Math.floor(riverWidth/2); w++) {
        const tz = targetZ + w;
        if (tz >= 0 && tz < size) {
          nodes[x][tz].height = -1;
          nodes[x][tz].type = 'water';
        }
      }
    }

    // Diagonal bridges: one around quarter-map, another around 3-quarters
    const bridgeOffsets = [Math.floor(size * 0.3), Math.floor(size * 0.7)];
    for (const bo of bridgeOffsets) {
      for (let w = -3; w <= 3; w++) {
        const xCoord = bo + w;
        const zCoord = bo - w; // Perpendicular bridge cross
        if (xCoord >= 0 && xCoord < size && zCoord >= 0 && zCoord < size) {
          nodes[xCoord][zCoord].height = 0;
          nodes[xCoord][zCoord].type = 'bridge';
        }
        // Make it wider
        if (xCoord + 1 < size && zCoord >= 0 && zCoord < size) {
          nodes[xCoord + 1][zCoord].height = 0;
          nodes[xCoord + 1][zCoord].type = 'bridge';
        }
      }
    }
  }

  // 4. Calculate starting bases symmetrically (evenly distributed in radius from center)
  const startingBases: StartingBase[] = [];
  const cx = size / 2;
  const cz = size / 2;
  const spawnRadius = size * 0.36; // Place them at ~36% out, safe from outer borders

  players.forEach((player, idx) => {
    // Evenly divide the angle
    const totalPlayers = players.length;
    const angle = (idx * 2 * Math.PI) / totalPlayers + Math.PI / 4; // Add slight tilt

    let sx = Math.floor(cx + Math.cos(angle) * spawnRadius);
    let sz = Math.floor(cz + Math.sin(angle) * spawnRadius);

    // Safeguard spawn boundaries
    sx = Math.max(5, Math.min(size - 6, sx));
    sz = Math.max(5, Math.min(size - 6, sz));

    // Clear nearby river/water at base spawning ground to avoid getting stuck in river!
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const tx = sx + dx;
        const tz = sz + dz;
        if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
          const node = nodes[tx][tz];
          if (node.type === 'water') {
            node.height = 0;
            node.type = 'bridge'; // Becomes playable field
          } else {
            // Flatten base area slightly
            node.height = 0;
            node.type = 'plain';
          }
        }
      }
    }

    startingBases.push({
      playerId: player.id,
      x: sx,
      z: sz,
      team: player.team
    });
  });

  // 5. Spawn strategic resource oil oil-wells / supply derrick sites
  // We place them in areas far from direct spawning bases (e.g. center, flanking corridors)
  const resourceSpots: { x: number; z: number }[] = [];
  const activeCount = players.length;
  // Place strategic spots: one exactly in the center, and 2 to 4 in remaining regions
  const spotsToPlace = Math.min(8, activeCount * 2);

  // Always try center spot
  const centerNodeX = Math.floor(size / 2);
  const centerNodeZ = Math.floor(size / 2);
  if (nodes[centerNodeX] && nodes[centerNodeX][centerNodeZ]) {
    nodes[centerNodeX][centerNodeZ].resourceSpot = true;
    nodes[centerNodeX][centerNodeZ].height = 0; // Flatten
    nodes[centerNodeX][centerNodeZ].type = 'plain';
    resourceSpots.push({ x: centerNodeX, z: centerNodeZ });
  }

  // Rest placed semi-randomly but balanced relative to center
  let attempts = 0;
  while (resourceSpots.length < spotsToPlace && attempts < 100) {
    attempts++;
    const rx = Math.floor(rand() * (size - 16)) + 8;
    const rz = Math.floor(rand() * (size - 16)) + 8;

    // Check distance to base coords (can't be right in someone's core spawn base)
    let tooClose = false;
    for (const base of startingBases) {
      const distSq = (rx - base.x) * (rx - base.x) + (rz - base.z) * (rz - base.z);
      if (distSq < 15 * 15) { // At least 15 units away from spawns
        tooClose = true;
        break;
      }
    }

    // Check distance to existing resources
    for (const spot of resourceSpots) {
      const distSq = (rx - spot.x) * (rx - spot.x) + (rz - spot.z) * (rz - spot.z);
      if (distSq < 12 * 12) { // At least 12 units apart
        tooClose = true;
        break;
      }
    }

    // Can't be in deep water unless we flatten it
    if (!tooClose) {
      nodes[rx][rz].resourceSpot = true;
      nodes[rx][rz].height = 0;
      nodes[rx][rz].type = 'plain';
      resourceSpots.push({ x: rx, z: rz });
    }
  }

  // 6. Natural procedural map decorations (trees, bushes, rocks, pillars)
  const decorations: MapDecoration[] = [];
  const numDecs = Math.floor(size * 1.5);
  for (let i = 0; i < numDecs; i++) {
    const rx = Math.floor(rand() * (size - 2)) + 1;
    const rz = Math.floor(rand() * (size - 2)) + 1;

    if (nodes[rx] === undefined || nodes[rx][rz] === undefined) continue;
    const node = nodes[rx][rz];

    // Avoid water (keep ground path navigable) and avoid bridges or resource spots
    if (node.type === 'water' || node.type === 'bridge' || node.resourceSpot) continue;

    // Avoid spawning too close to any starting spawn base
    let nearSpawn = false;
    for (const base of startingBases) {
      const distSq = (rx - base.x) * (rx - base.x) + (rz - base.z) * (rz - base.z);
      if (distSq < 7 * 7) { // 7 tiles safety clear zone around HQs
        nearSpawn = true;
        break;
      }
    }
    if (nearSpawn) continue;

    const roll = rand();
    let type: 'tree' | 'rock' | 'ruin_pillar' | 'bush';
    if (roll < 0.45) {
      type = 'tree';
    } else if (roll < 0.70) {
      type = 'bush';
    } else if (roll < 0.88) {
      type = 'rock';
    } else {
      type = 'ruin_pillar';
    }

    decorations.push({
      type,
      x: rx + (rand() - 0.5) * 0.4,
      z: rz + (rand() - 0.5) * 0.4,
      scale: rand() * 0.5 + 0.75,
      rotation: rand() * Math.PI * 2
    });
  }

  return {
    seed,
    size,
    nodes,
    startingBases,
    resourceSpots,
    decorations
  };
}
