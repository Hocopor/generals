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
  type: 'tree' | 'rock' | 'ruin_pillar' | 'bush' | 'house';
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
  
  // Create a 2D Value Noise Grid for continuous organic smooth terrain
  const noiseSize = 32;
  const noiseGrid: number[][] = [];
  for (let i = 0; i < noiseSize; i++) {
    noiseGrid[i] = [];
    for (let j = 0; j < noiseSize; j++) {
      noiseGrid[i][j] = rand();
    }
  }

  // Smooth bilinear interpolation of the noise grid
  function getNoise(x: number, z: number, frequency = 0.12): number {
    const nx = (x * frequency) % (noiseSize - 1);
    const nz = (z * frequency) % (noiseSize - 1);
    
    const x0 = Math.floor(nx);
    const x1 = x0 + 1;
    const z0 = Math.floor(nz);
    const z1 = z0 + 1;
    
    const tx = nx - x0;
    const tz = nz - z0;
    
    // Smoothstep formulation
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    
    const v00 = noiseGrid[x0][z0];
    const v10 = noiseGrid[x1][z0];
    const v01 = noiseGrid[x0][z1];
    const v11 = noiseGrid[x1][z1];
    
    const top = v00 + sx * (v10 - v00);
    const bot = v01 + sx * (v11 - v01);
    
    return top + sz * (bot - top);
  }

  // Fractional Brownian Motion (Multi-frequency noise helper)
  function fbm(x: number, z: number, octaves = 3): number {
    let value = 0;
    let amplitude = 1.0;
    let freq = 0.08;
    let maxVal = 0;
    for (let i = 0; i < octaves; i++) {
      value += amplitude * getNoise(x, z, freq);
      maxVal += amplitude;
      amplitude *= 0.5;
      freq *= 2.0;
    }
    return value / maxVal;
  }

  // 1. Initialize grid with basic continuous waving heights
  const nodes: MapNode[][] = [];
  for (let x = 0; x < size; x++) {
    nodes[x] = [];
    for (let z = 0; z < size; z++) {
      // Gentle slope fluctuations on the base plain (0.0 to 0.25)
      const plainSway = fbm(x, z, 2) * 0.25;

      nodes[x][z] = {
        x,
        z,
        height: plainSway,
        type: 'plain',
        resourceSpot: false
      };
    }
  }

  // 2. Generate natural terrain (Hills and Ridges) using smooth 2D Noise
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      // Main hill noise frequency
      const elevationNoise = fbm(x + 125, z + 267, 3);
      
      // Filter the noise to construct isolated, smooth highlands and mountains
      if (elevationNoise > 0.62) {
        // High strategic ridges/cliffs
        const factor = (elevationNoise - 0.62) / (1 - 0.62);
        // Elevate smoothly up to 2.0
        nodes[x][z].height = 0.95 + factor * 1.05;
        nodes[x][z].type = 'ridge';
      } else if (elevationNoise > 0.44) {
        // Gentle traversable hills
        const factor = (elevationNoise - 0.44) / (0.62 - 0.44);
        nodes[x][z].height = 0.25 + factor * 0.70;
        nodes[x][z].type = 'hill';
      }
    }
  }

  // 3. Generate a winding, realistic river dividing the battleground
  // Choose horizontal or vertical river flows
  const riverIsHorizontal = fbm(seed, seed) > 0.5;
  const riverWidth = 4.0;
  const shoreWidth = 4.0;
  const bridgeWidth = 4.5; // wider bridges for easier tank crossings

  // List of bridges to place along the flow
  const bridgePositions = [Math.floor(size * 0.28), Math.floor(size * 0.72)];

  if (riverIsHorizontal) {
    const midZ = size / 2;
    for (let x = 0; x < size; x++) {
      // Smooth sinusoidal snake wave + noise sway
      const riverCenterZ = midZ + Math.sin(x * 0.12) * 7 + getNoise(x, 100, 0.05) * 5;
      
      const isAtBridge = bridgePositions.some(bp => Math.abs(x - bp) < bridgeWidth);

      for (let z = 0; z < size; z++) {
        const distToCenter = Math.abs(z - riverCenterZ);
        
        if (distToCenter < riverWidth) {
          if (isAtBridge) {
            nodes[x][z].height = 0.0;
            nodes[x][z].type = 'bridge';
          } else {
            const depthFactor = distToCenter / riverWidth; // 1 at shore, 0 at center
            const finalDepth = -0.8 + 0.65 * (depthFactor * depthFactor);
            nodes[x][z].height = finalDepth;
            nodes[x][z].type = 'water';
          }
        } else if (distToCenter < riverWidth + shoreWidth) {
          if (isAtBridge) {
            nodes[x][z].height = 0.0;
            nodes[x][z].type = 'bridge';
          } else {
            const shoreFactor = (distToCenter - riverWidth) / shoreWidth;
            const targetH = nodes[x][z].height;
            nodes[x][z].height = -0.15 * (1.0 - shoreFactor) + targetH * shoreFactor;
          }
        }
      }
    }
  } else {
    // Vertical river flow
    const midX = size / 2;
    for (let z = 0; z < size; z++) {
      const riverCenterX = midX + Math.sin(z * 0.12) * 7 + getNoise(100, z, 0.05) * 5;
      
      const isAtBridge = bridgePositions.some(bp => Math.abs(z - bp) < bridgeWidth);

      for (let x = 0; x < size; x++) {
        const distToCenter = Math.abs(x - riverCenterX);
        
        if (distToCenter < riverWidth) {
          if (isAtBridge) {
            nodes[x][z].height = 0.0;
            nodes[x][z].type = 'bridge';
          } else {
            const depthFactor = distToCenter / riverWidth;
            const finalDepth = -0.8 + 0.65 * (depthFactor * depthFactor);
            nodes[x][z].height = finalDepth;
            nodes[x][z].type = 'water';
          }
        } else if (distToCenter < riverWidth + shoreWidth) {
          if (isAtBridge) {
            nodes[x][z].height = 0.0;
            nodes[x][z].type = 'bridge';
          } else {
            const shoreFactor = (distToCenter - riverWidth) / shoreWidth;
            const targetH = nodes[x][z].height;
            nodes[x][z].height = -0.15 * (1.0 - shoreFactor) + targetH * shoreFactor;
          }
        }
      }
    }
  }

  // 4. Calculate starting base spawns and flatten/clear surrounding terrain
  const startingBases: StartingBase[] = [];
  const cx = size / 2;
  const cz = size / 2;
  const spawnRadius = size * 0.36;

  players.forEach((player, idx) => {
    const totalPlayers = players.length;
    const spawnAngle = (idx * 2 * Math.PI) / totalPlayers + Math.PI / 4;

    let sx = Math.floor(cx + Math.cos(spawnAngle) * spawnRadius);
    let sz = Math.floor(cz + Math.sin(spawnAngle) * spawnRadius);

    sx = Math.max(7, Math.min(size - 8, sx));
    sz = Math.max(7, Math.min(size - 8, sz));

    const centerNodeH = nodes[sx]?.[sz]?.height ?? 0.0;

    // Flatten bases inside an 8x8 radius to guarantee easy base building layout
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const tx = sx + dx;
        const tz = sz + dz;
        
        if (tx >= 0 && tx < size && tz >= 0 && tz < size) {
          const node = nodes[tx][tz];
          const distFromBase = Math.sqrt(dx * dx + dz * dz);
          
          if (distFromBase < 5.0) {
            // Flatten completely
            node.height = centerNodeH;
            node.type = 'plain';
          } else if (distFromBase < 6.5) {
            // Smooth transition outline
            const factor = (distFromBase - 5.0) / 1.5;
            node.height = centerNodeH * (1.0 - factor) + node.height * factor;
            if (node.type === 'water') {
              node.type = 'plain';
            }
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

  // 5. Spawn strategic supply oil derricks / gold spots
  const resourceSpots: { x: number; z: number }[] = [];
  const spotsToPlace = Math.min(16, players.length * 4 + 2);

  // Center strategic derrick
  const centerNodeX = Math.floor(size / 2);
  const centerNodeZ = Math.floor(size / 2);
  let centerNode = nodes[centerNodeX]?.[centerNodeZ];
  if (centerNode) {
    centerNode.resourceSpot = true;
    centerNode.type = 'plain';
    resourceSpots.push({ x: centerNodeX, z: centerNodeZ });
  }

  // Flanker and center-perpendicular corridors
  let resourceAttempts = 0;
  while (resourceSpots.length < spotsToPlace && resourceAttempts < 250) {
    resourceAttempts++;
    const rx = Math.floor(rand() * (size - 16)) + 8;
    const rz = Math.floor(rand() * (size - 16)) + 8;

    let tooClose = false;

    // Check starting bases
    for (const base of startingBases) {
      const distSq = (rx - base.x) * (rx - base.x) + (rz - base.z) * (rz - base.z);
      if (distSq < 16 * 16) {
        tooClose = true;
        break;
      }
    }

    // Check existing spots
    for (const spot of resourceSpots) {
      const distSq = (rx - spot.x) * (rx - spot.x) + (rz - spot.z) * (rz - spot.z);
      if (distSq < 13 * 13) {
        tooClose = true;
        break;
      }
    }

    // Must be flat buildable lands
    if (!tooClose && nodes[rx] && nodes[rx][rz]) {
      const node = nodes[rx][rz];
      if (node.type !== 'water' && node.type !== 'bridge') {
        node.resourceSpot = true;
        node.type = 'plain';
        resourceSpots.push({ x: rx, z: rz });
      }
    }
  }

  // 6. Natural decorations (forest dense clumps, rock piles, ruins, and villages!)
  const decorations: MapDecoration[] = [];

  // Generate 2 or 3 tiny rustic "Villages" in comfortable neutral regions
  const numVillages = 3;
  const villageCoords: { x: number; z: number }[] = [];
  let villAttempts = 0;
  while (villageCoords.length < numVillages && villAttempts < 80) {
    villAttempts++;
    const vx = Math.floor(rand() * (size - 24)) + 12;
    const vz = Math.floor(rand() * (size - 24)) + 12;

    let ok = true;
    for (const base of startingBases) {
      const d = Math.sqrt((vx - base.x) ** 2 + (vz - base.z) ** 2);
      if (d < 18) ok = false;
    }
    for (const res of resourceSpots) {
      const d = Math.sqrt((vx - res.x) ** 2 + (vz - res.z) ** 2);
      if (d < 12) ok = false;
    }
    
    const node = nodes[vx]?.[vz];
    if (node && node.type !== 'plain') ok = false;

    if (ok) {
      villageCoords.push({ x: vx, z: vz });
      
      // Spawn 3 to 6 cosy houses closely spaced inside the village center!
      const buildingsInVillage = Math.floor(rand() * 4) + 3;
      for (let h = 0; h < buildingsInVillage; h++) {
        const hx = vx + (rand() - 0.5) * 3.5;
        const hz = vz + (rand() - 0.5) * 3.5;
        
        const hNode = nodes[Math.round(hx)]?.[Math.round(hz)];
        if (hNode && hNode.type === 'plain' && !hNode.resourceSpot) {
          decorations.push({
            type: 'house',
            x: hx,
            z: hz,
            scale: rand() * 0.12 + 0.88,
            rotation: rand() * Math.PI * 2
          });
          
          // Flatten cottage ground slightly
          hNode.height = Math.max(0.0, hNode.height * 0.5);
        }
      }
    }
  }

  // Distribute forest clusters, bushes, rock clusters
  const numDecClumps = Math.floor(size / 3.2);
  for (let c = 0; c < numDecClumps; c++) {
    const cx = Math.floor(rand() * (size - 6)) + 3;
    const cz = Math.floor(rand() * (size - 6)) + 3;
    
    // Choose clump type
    const clumpType = rand() > 0.4 ? 'forest' : 'rocks';
    const clumpSize = Math.floor(rand() * 4) + 3;

    for (let d = 0; d < clumpSize; d++) {
      // Offset slightly from clump center
      const theta = rand() * Math.PI * 2;
      const radius = rand() * 3.0;
      const rx = Math.round(cx + Math.cos(theta) * radius);
      const rz = Math.round(cz + Math.sin(theta) * radius);

      if (nodes[rx] === undefined || nodes[rx][rz] === undefined) continue;
      const node = nodes[rx][rz];

      // Blocked on water, bridges or active base HQ points
      if (node.type === 'water' || node.type === 'bridge' || node.resourceSpot) continue;

      let nearSpawn = false;
      for (const base of startingBases) {
        const dSq = (rx - base.x) ** 2 + (rz - base.z) ** 2;
        if (dSq < 8 * 8) {
          nearSpawn = true;
          break;
        }
      }
      if (nearSpawn) continue;

      const scale = rand() * 0.4 + 0.8;
      const rotation = rand() * Math.PI * 2;

      if (clumpType === 'forest') {
        decorations.push({
          type: rand() > 0.3 ? 'tree' : 'bush',
          x: rx + (rand() - 0.5) * 0.3,
          z: rz + (rand() - 0.5) * 0.3,
          scale,
          rotation
        });
      } else {
        decorations.push({
          type: rand() > 0.35 ? 'rock' : 'ruin_pillar',
          x: rx + (rand() - 0.5) * 0.3,
          z: rz + (rand() - 0.5) * 0.3,
          scale,
          rotation
        });
      }
    }
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
