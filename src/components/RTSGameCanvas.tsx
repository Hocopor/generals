import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Faction, Lobby, Player, GameEntity, BuildingType, UnitType, GameActionEvent } from '../types';
import { sound } from '../utils/audio';
import { generateProceduralMap, GeneratedMap, MapNode } from '../utils/mapGenerator';
import { getFactionUnitProperties, getFactionBuildingProperties, getUnitShortName, getBuildingShortName } from '../utils/factionProperties';
import { Shield, Zap, Swords, Play, RefreshCw, AlertTriangle, ChevronRight, ChevronUp, ChevronDown, Coins, LogOut, Radar, Crosshair, Target } from 'lucide-react';

interface RTSGameCanvasProps {
  lobby: Lobby;
  playerId: string;
  isSingleplayer: boolean;
  aiOpponents: { name: string; faction: Faction; team: number }[];
  socketRef: React.MutableRefObject<WebSocket | null>;
  onGameOver: (winnerTeam: number, isVictory: boolean) => void;
  onExitGame: () => void;
}

// Visual layout constants
const UNIT_PROPERTIES: Record<UnitType, { name: string; hp: number; speed: number; range: number; dps: number; cost: number; desc: string }> = {
  drone_scout: { name: 'Дрон-разведчик', hp: 60, speed: 2.5, range: 3.5, dps: 12, cost: 150, desc: 'Быстрый воздушный разведчик с мощным радаром.' },
  drone_kamikaze: { name: 'Дрон-камикадзе', hp: 45, speed: 3.2, range: 1.0, dps: 200, cost: 200, desc: 'Барражирующий боеприпас. Самодетонирует при ударе.' },
  cyber_specops: { name: 'Спецназ ССО', hp: 80, speed: 1.4, range: 4.5, dps: 18, cost: 250, desc: 'Элитная пехота. Может захватывать нефтяные вышки.' },
  precision_tank: { name: 'Лазерный Танк', hp: 260, speed: 1.1, range: 6.0, dps: 24, cost: 500, desc: 'Основная боевая машина. Высокая броня и прочность.' },
  artillery_mlrs: { name: 'РСЗО Торнадо', hp: 130, speed: 0.8, range: 11.0, dps: 45, cost: 650, desc: 'Тяжелая ракетная артиллерия дальнего боя. Осадный специалист.' },
  mobile_jammer: { name: 'РЭБ Глушитель', hp: 160, speed: 1.3, range: 0, dps: 0, cost: 400, desc: 'Отключает вражеские турели и маскирует союзников поблизости.' },
  builder: { name: 'Юнит-Строитель', hp: 120, speed: 1.3, range: 0, dps: 0, cost: 150, desc: 'Инженерно-строительный комплекс. Строит все типы зданий на поле.' },
  harvester: { name: 'Сборщик Ресурсов', hp: 180, speed: 1.4, range: 0, dps: 0, cost: 280, desc: 'Логистический грузовик. Доставляет сырьё с нефтевышек на базу.' }
};

const BUILDING_PROPERTIES: Record<BuildingType, { name: string; hp: number; cost: number; power: number; desc: string }> = {
  command_center: { name: 'Штаб Командования', hp: 1500, cost: 1200, power: 30, desc: 'Главная база. Генерирует постоянный доход и позволяет обучать Строителей.' },
  power_plant: { name: 'Электростанция', hp: 500, cost: 300, power: 100, desc: 'Вырабатывает энергию для обеспечения работы баз.' },
  supply_refinery: { name: 'Центр Снабжения', hp: 800, cost: 400, power: -20, desc: 'Станция сбора ресурсов. Разгружает прибывающие логистические грузовики.' },
  barracks: { name: 'Казармы Дронов', hp: 600, cost: 350, power: -15, desc: 'Обучает ССО и производит тактические беспилотники.' },
  war_factory: { name: 'Военный Завод', hp: 850, cost: 600, power: -25, desc: 'Строит наземную технику: танки, артиллерию и машины РЭБ.' },
  defense_turret: { name: 'Лазерная Турель', hp: 700, cost: 350, power: -20, desc: 'Автоматическая оборонительная турель против наземных и воздушных целей.' },
  oil_derrick: { name: 'Нефтевышка', hp: 600, cost: 300, power: -10, desc: 'Строится на поле инженером. Позволяет постоянно качать ресурсы.' },
  civilian_building: { name: 'Городское Здание', hp: 1500, cost: 0, power: 0, desc: 'Нейтральное строение на поле боя. Подходит для защиты и ведения огня пехотой.' }
};

function getFaction(playerId: string, players: Player[]): Faction {
  const p = players.find(x => x.id === playerId);
  return p ? p.faction : 'Alliance';
}

function getUnitProps(unitType: UnitType, playerId: string, players: Player[]) {
  return getFactionUnitProperties(unitType, getFaction(playerId, players));
}

function getBuildingProps(bType: BuildingType, playerId: string, players: Player[]) {
  return getFactionBuildingProperties(bType, getFaction(playerId, players));
}

// Helper to get smooth terrain height using bilinear interpolation
function getTerrainHeight(x: number, z: number, map: GeneratedMap): number {
  if (!map || !map.nodes) return 0;
  
  const x1 = Math.floor(x);
  const z1 = Math.floor(z);
  const x2 = Math.ceil(x);
  const z2 = Math.ceil(z);
  
  const h11 = (map.nodes[x1] && map.nodes[x1][z1]) ? map.nodes[x1][z1].height * 1.6 : 0;
  const h21 = (map.nodes[x2] && map.nodes[x2][z1]) ? map.nodes[x2][z1].height * 1.6 : 0;
  const h12 = (map.nodes[x1] && map.nodes[x1][z2]) ? map.nodes[x1][z2].height * 1.6 : 0;
  const h22 = (map.nodes[x2] && map.nodes[x2][z2]) ? map.nodes[x2][z2].height * 1.6 : 0;
  
  const tx = x - x1;
  const tz = z - z1;
  
  // Three.js PlaneGeometry splits quads along the BL-TR diagonal (tx + tz = 1)
  if (tx + tz <= 1) {
    // Top-Left Triangle
    return h11 + (h21 - h11) * tx + (h12 - h11) * tz;
  } else {
    // Bottom-Right Triangle
    return h22 + (h12 - h22) * (1 - tx) + (h21 - h22) * (1 - tz);
  }
}

export default function RTSGameCanvas({
  lobby,
  playerId,
  isSingleplayer,
  aiOpponents,
  socketRef,
  onGameOver,
  onExitGame
}: RTSGameCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Core React Simulation states
  const [credits, setCredits] = useState<number>(1000);
  const [powerGenerated, setPowerGenerated] = useState<number>(150);
  const [powerRequired, setPowerRequired] = useState<number>(0);
  const [commandCharge, setCommandCharge] = useState<number>(20); // 0 to 100%

  // HUD and Selection options
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [dragSelection, setDragSelection] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [buildingToPlace, setBuildingToPlace] = useState<BuildingType | null>(null);
  const [productionQueue, setProductionQueue] = useState<{ buildingId: string; type: UnitType; progress: number }[]>([]);
  const [commandStrikeActive, setCommandStrikeActive] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<{ id: string; text: string; type: 'info' | 'warn' | 'success' }[]>([]);

  // Mobile adaptation states
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileMode, setMobileMode] = useState<'select' | 'order'>('select');
  const mobileModeRef = useRef<'select' | 'order'>('select');

  useEffect(() => {
    mobileModeRef.current = mobileMode;
  }, [mobileMode]);

  useEffect(() => {
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmall = window.innerWidth <= 1024;
    const mobileDetected = isTouch || isSmall;
    setIsMobile(mobileDetected);
    if (mobileDetected) {
      setIsMenuCollapsed(true);
    }
  }, []);

  // Viewport mapping and collapsible state HUD options
  const [camPos, setCamPos] = useState({ x: 30, z: 30, zoom: 30 });
  const [isMenuCollapsed, setIsMenuCollapsed] = useState<boolean>(false);
  const [hoveredItem, setHoveredItem] = useState<{ type: 'unit' | 'building'; key: string } | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState<boolean>(false);

  // Lets the minimap (rendered in JSX) query the fog-of-war grid that lives
  // inside the Three.js effect closure, so the radar respects vision too.
  const fogQueryRef = useRef<{ visible: (x: number, z: number) => boolean; explored: (x: number, z: number) => boolean } | null>(null);

  // Internal simulated references (for THREE.js loop connection)
  const simulationRef = useRef<{
    entities: GameEntity[];
    players: Player[];
    map: GeneratedMap | null;
    selectedIds: string[];
    credits: number;
    powerGen: number;
    powerReq: number;
    commandCharge: number;
    buildingToPlace: BuildingType | null;
    placeX: number;
    placeZ: number;
    camX: number;
    camZ: number;
    camZoom: number;
    camRotation: number;
    camPitch: number;
    commandStrikeActive: boolean;
    gameOverSignalled: boolean;
  }>({
    entities: [],
    players: [],
    map: null,
    selectedIds: [],
    credits: 1000,
    powerGen: 150,
    powerReq: 0,
    commandCharge: 20,
    buildingToPlace: null,
    placeX: 0,
    placeZ: 0,
    camX: 30,
    camZ: 30,
    camZoom: 22,
    camRotation: 0,
    camPitch: Math.PI / 3.3,
    commandStrikeActive: false,
    gameOverSignalled: false
  });

  const selfPlayer = lobby.players.find(p => p.id === playerId) || {
    id: playerId,
    name: localStorage.getItem('cnc_playerName') || 'General',
    faction: 'Alliance' as Faction,
    team: 1,
    color: '#3b82f6'
  };

  // Add a nice visual notification to HUD logs
  const pushNotification = (text: string, type: 'info' | 'warn' | 'success' = 'info') => {
    const id = Math.random().toString();
    setNotifications(prev => [{ id, text, type }, ...prev].slice(0, 5));
    if (type === 'warn') sound.playAlert();
  };

  // Hover tooltip timer watcher — short delay so the full name + description
  // surface quickly when hovering a build button (Generals-style).
  useEffect(() => {
    if (!hoveredItem) {
      setTooltipVisible(false);
      return;
    }
    const timer = setTimeout(() => {
      setTooltipVisible(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [hoveredItem]);

  // Setup initial player lists (human + dynamic computer AI profiles)
  useEffect(() => {
    const sim = simulationRef.current;
    
    // Set map and players
    const fullPlayersList: Player[] = [...lobby.players];
    
    if (isSingleplayer) {
      aiOpponents.forEach((ai, idx) => {
        fullPlayersList.push({
          id: `AI_ENEMY_${idx + 1}`,
          name: ai.name,
          faction: ai.faction as Faction,
          team: ai.team,
          color: ai.faction === 'Alliance' ? '#60a5fa' : ai.faction === 'Coalition' ? '#f87171' : ai.faction === 'Union' ? '#34d399' : '#fbbf24',
          isHost: false,
          isReady: true,
          isAI: true,
          status: 'online'
        });
      });
    }

    sim.players = fullPlayersList;
    const computedMap = generateProceduralMap(lobby.mapSeed, lobby.mapSize, fullPlayersList);
    sim.map = computedMap;

    // Anchor camera around user base
    const spawn = computedMap.startingBases.find(b => b.playerId === playerId);
    if (spawn) {
      sim.camX = spawn.x;
      sim.camZ = spawn.z;
    } else {
      sim.camX = lobby.mapSize / 2;
      sim.camZ = lobby.mapSize / 2;
    }

    // Spawn starting structures: Command Center for each alive participator!
    const startingEntities: GameEntity[] = [];
    computedMap.startingBases.forEach((base) => {
      const bProps = getBuildingProps('command_center', base.playerId, fullPlayersList);
      const bObj: GameEntity = {
        id: `spawn_cc_${base.playerId}`,
        type: 'building',
        subType: 'command_center',
        playerId: base.playerId,
        team: base.team,
        health: bProps.hp,
        maxHealth: bProps.hp,
        x: base.x,
        z: base.z,
        angle: 0,
        state: 'idle',
        buildProgress: 1
      };
      startingEntities.push(bObj);

      // Start with some defensive guards nearby starting bases
      const guardTypes: UnitType[] = ['drone_scout', 'precision_tank', 'builder'];
      guardTypes.forEach((gt, uIdx) => {
        const theta = (uIdx * 2 * Math.PI) / guardTypes.length;
        const uProps = getUnitProps(gt, base.playerId, fullPlayersList);
        startingEntities.push({
          id: `spawn_guard_${base.playerId}_${uIdx}`,
          type: 'unit',
          subType: gt,
          playerId: base.playerId,
          team: base.team,
          health: uProps.hp,
          maxHealth: uProps.hp,
          x: base.x + Math.cos(theta) * 3,
          z: base.z + Math.sin(theta) * 3,
          angle: theta,
          state: 'idle'
        });
      });
    });

    sim.entities = startingEntities;
    pushNotification('Дроны активированы. Системы базы функционируют на оптимальной мощности.', 'success');
  }, [lobby, playerId, isSingleplayer, aiOpponents]);

  // Command Power labels based on Faction
  const getCommandPowerName = (fac: Faction) => {
    switch (fac) {
      case 'Alliance': return 'Кинетический Удар';
      case 'Coalition': return 'Импульсный Перегруз (ЭМИ)';
      case 'Union': return 'Термобарический Обстрел';
      case 'Syndicate': return 'Химическое Разъедание';
    }
  };

  const getCommandPowerDesc = (fac: Faction) => {
    switch (fac) {
      case 'Alliance': return 'Орбитальный кинеческий удар. Разрушает строения и пробивает танковую броню.';
      case 'Coalition': return 'Высоковольтный электромагнитный импульс. Временно отключает технику и оборонительные турели.';
      case 'Union': return 'Огневой шторм. Вызывает тяжелые длительные повреждения в выбранном секторе.';
      case 'Syndicate': return 'Выброс едкого токсина. Мгновенно разъедает броню строений и плавит обшивку техники.';
    }
  };

  // Keyboard and Mouse camera control listeners
  useEffect(() => {
    const keysPressed: Record<string, boolean> = {};
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed[e.key.toLowerCase()] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed[e.key.toLowerCase()] = false;
    };

    let mouseX = 0;
    let mouseY = 0;
    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);

    // Camera tick checking
    const camInterval = setInterval(() => {
      const sim = simulationRef.current;
      const step = 0.04 * sim.camZoom;

      const cosRot = Math.cos(sim.camRotation);
      const sinRot = Math.sin(sim.camRotation);

      const wWidth = window.innerWidth;
      const wHeight = window.innerHeight;

      let moveForward = keysPressed['w'] || keysPressed['arrowup'];
      let moveBackward = keysPressed['s'] || keysPressed['arrowdown'];
      let moveLeft = keysPressed['a'] || keysPressed['arrowleft'];
      let moveRight = keysPressed['d'] || keysPressed['arrowright'];

      // Edge scrolling: mouse close to edges triggers pan
      if (mouseY > 0 && mouseY < 30) {
        moveForward = true;
      }
      if (mouseY > 0 && mouseY > wHeight - 30) {
        moveBackward = true;
      }
      if (mouseX > 0 && mouseX < 30) {
        moveLeft = true;
      }
      if (mouseX > 0 && mouseX > wWidth - 30) {
        moveRight = true;
      }

      if (moveForward) {
        sim.camX += sinRot * step;
        sim.camZ += cosRot * step;
      }
      if (moveBackward) {
        sim.camX -= sinRot * step;
        sim.camZ -= cosRot * step;
      }
      if (moveLeft) {
        sim.camX += cosRot * step;
        sim.camZ -= sinRot * step;
      }
      if (moveRight) {
        sim.camX -= cosRot * step;
        sim.camZ += sinRot * step;
      }
      if (keysPressed['q']) {
        sim.camRotation += 0.04;
      }
      if (keysPressed['e']) {
        sim.camRotation -= 0.04;
      }
      // Boundary safe
      if (sim.map) {
        sim.camX = Math.max(0, Math.min(sim.map.size, sim.camX));
        sim.camZ = Math.max(0, Math.min(sim.map.size, sim.camZ));
      }
    }, 16);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      clearInterval(camInterval);
    };
  }, []);

  // WebGL Render & Game physics loop (Integrated Three.js engine)
  useEffect(() => {
    if (!mountRef.current || !simulationRef.current.map) return;
    const sim = simulationRef.current;
    const map = sim.map!;

    let lastSentCamX = sim.camX;
    let lastSentCamZ = sim.camZ;
    let lastSentCamZoom = sim.camZoom;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1016');
    scene.fog = new THREE.FogExp2('#0b1016', 0.015);

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Clear element to prevent duplicates on hot rebuilds
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    // 3. Lighting setups
    const ambientLight = new THREE.AmbientLight('#2a3542', 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ccf0ff', 2.8);
    dirLight.position.set(30, 80, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 180;
    const dCoord = 60;
    dirLight.shadow.camera.left = -dCoord;
    dirLight.shadow.camera.right = dCoord;
    dirLight.shadow.camera.top = dCoord;
    dirLight.shadow.camera.bottom = -dCoord;
    scene.add(dirLight);

    // 4. Procedural Map Terrain meshes
    // Create an elevated plane geometry matching procedural height map nodes!
    const cellSize = 1;
    const gridS = map.size;
    const terrainGeo = new THREE.PlaneGeometry(gridS, gridS, gridS - 1, gridS - 1);
    terrainGeo.rotateX(-Math.PI / 2); // Lay flat on X-Z plane

    // Offset terrain offset to match 3D center
    terrainGeo.translate(gridS / 2, 0, gridS / 2);

    // Set vertex heights matching map nodes and apply gorgeous realistic vertex colors
    const posAttr = terrainGeo.attributes.position;
    const colorsArray = new Float32Array(posAttr.count * 3);

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      
      const xIndex = Math.max(0, Math.min(gridS - 1, Math.round(vx)));
      const zIndex = Math.max(0, Math.min(gridS - 1, Math.round(vz)));
      
      const node = map.nodes[xIndex]?.[zIndex] || map.nodes[0][0];
      const heightVal = node.height;
      
      // Apply smooth organic height factor
      posAttr.setY(i, heightVal * 1.6);
      
      // Professional color palettes matching real environment ecosystems
      let r = 40/255, g = 71/255, b = 37/255; // forest green default
      
      if (node.type === 'water') {
        // Beach shorelines / silt sand
        r = 115/255; g = 101/255; b = 77/255;
      } else if (node.type === 'bridge') {
        // Reinforced concrete crossing gray
        r = 85/255; g = 89/255; b = 92/255;
      } else if (node.type === 'ridge') {
        // Rugged mountains to snowy peaks
        if (heightVal > 1.6) {
          r = 210/255; g = 215/255; b = 220/255; // snow glacier white
        } else {
          r = 95/255; g = 100/255; b = 105/255; // craggy steep granite
        }
      } else if (node.type === 'hill') {
        // Mud clay slopes
        r = 101/255; g = 84/255; b = 64/255;
      } else {
        // Plain grassfields: include custom coordinates-based variations
        const sway = Math.sin(xIndex * 0.455) * Math.cos(zIndex * 0.455);
        if (sway > 0.4) {
          r = 28/255; g = 54/255; b = 24/255; // dark mossy shade
        } else if (sway < -0.4) {
          r = 65/255; g = 92/255; b = 58/255; // lighter summer dry crop turf
        } else {
          r = 40/255; g = 71/255; b = 37/255; // military standard green
        }
        
        // Oil dirt rings near resource spots
        if (node.resourceSpot) {
          r = 26/255; g = 21/255; b = 18/255; // petroleum smudge soil
        }
      }
      
      colorsArray[i * 3] = r;
      colorsArray[i * 3 + 1] = g;
      colorsArray[i * 3 + 2] = b;
    }

    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));
    terrainGeo.computeVertexNormals();

    // Material matching smooth organic terrain shading
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: false // Smooth curves!
    });

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Track which building entities have already flattened the terrain under them
    const flattenedBuildingIds = new Set<string>();

    const updateTerrainGeometryHeights = () => {
      const pAttr = terrainGeo.attributes.position;
      for (let i = 0; i < pAttr.count; i++) {
        const vx = pAttr.getX(i);
        const vz = pAttr.getZ(i);
        
        const xIndex = Math.max(0, Math.min(gridS - 1, Math.round(vx)));
        const zIndex = Math.max(0, Math.min(gridS - 1, Math.round(vz)));
        
        const node = map.nodes[xIndex]?.[zIndex] || map.nodes[0][0];
        const heightVal = node.height;
        
        pAttr.setY(i, heightVal * 1.6);
      }
      pAttr.needsUpdate = true;
      terrainGeo.computeVertexNormals();
    };

    const flattenTerrainForBuilding = (bx: number, bz: number, radius: number = 2) => {
      if (!map || !map.nodes) return;
      // Get the height at the center of the building footprint
      const buildH = map.nodes[bx]?.[bz]?.height ?? 0.0;
      
      // Flatten nodes around the building coordinates
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const tx = bx + dx;
          const tz = bz + dz;
          if (map.nodes[tx]?.[tz]) {
            const node = map.nodes[tx][tz];
            node.height = buildH;
            if (node.type !== 'water') {
              node.type = 'plain';
            }
          }
        }
      }
      
      updateTerrainGeometryHeights();
    };

    // Glistening navy-blue transparent water plane fills river channels nicely
    const waterGeo = new THREE.PlaneGeometry(gridS, gridS);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.translate(gridS / 2, -0.28, gridS / 2); // Sea depth below dry areas

    const waterMat = new THREE.MeshStandardMaterial({
      color: '#0e3a60',
      transparent: true,
      opacity: 0.72,
      roughness: 0.12,
      metalness: 0.88,
      flatShading: false
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    scene.add(waterMesh);

    // Add resource spots explicitly with cool spinning oil rigs and yellow light flares!
    const resourceGeoms: THREE.Group[] = [];
    map.resourceSpots.forEach(spot => {
      const group = new THREE.Group();
      const spotH = getTerrainHeight(spot.x, spot.z, map);
      group.position.set(spot.x, spotH + 0.05, spot.z);

      // Base plate
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.4, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.8 })
      );
      group.add(base);

      // Main drilling frame
      const tower = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 2.2, 4),
        new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.4 })
      );
      tower.position.y = 1.1;
      group.add(tower);

      // Flashing beam indicator
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#fbbf24' })
      );
      glow.position.y = 2.2;
      group.add(glow);

      scene.add(group);
      resourceGeoms.push(group);
    });

    // Add natural map decorations (Trees, rocks, ruins, bushes)
    // Tracked with positions so the fog of war can hide unexplored scenery.
    const decoGroups: { group: THREE.Group; x: number; z: number }[] = [];
    if (map.decorations) {
      map.decorations.forEach((dec, idx) => {
        const decGroup = new THREE.Group();
        decGroup.position.set(dec.x, 0, dec.z);

        // Sit exactly on top of elevated hills/ridges
        decGroup.position.y = getTerrainHeight(dec.x, dec.z, map);

        if (dec.type === 'tree') {
          // Trunk
          const trunkGeo = new THREE.CylinderGeometry(0.12 * dec.scale, 0.18 * dec.scale, 1.2 * dec.scale, 5);
          const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.y = 0.6 * dec.scale;
          trunk.castShadow = true;
          decGroup.add(trunk);

          // Foliage
          const leavesGeo = new THREE.ConeGeometry(0.5 * dec.scale, 1.5 * dec.scale, 5);
          const leavesMat = new THREE.MeshStandardMaterial({ color: '#2e5a1c', roughness: 0.8, flatShading: true });
          const leaves = new THREE.Mesh(leavesGeo, leavesMat);
          leaves.position.y = (1.2 + 0.5) * dec.scale;
          leaves.castShadow = true;
          decGroup.add(leaves);

        } else if (dec.type === 'rock') {
          const rockGeo = new THREE.DodecahedronGeometry(0.35 * dec.scale, 1);
          const rockMat = new THREE.MeshStandardMaterial({ color: '#4b5563', metalness: 0.1, roughness: 0.8, flatShading: true });
          const rock = new THREE.Mesh(rockGeo, rockMat);
          rock.position.y = 0.15 * dec.scale;
          rock.rotation.set(dec.rotation, dec.rotation * 1.5, 0);
          rock.scale.set(1, 0.7 + Math.sin(idx)*0.3, 1);
          rock.castShadow = true;
          decGroup.add(rock);

        } else if (dec.type === 'bush') {
          const bushGeo = new THREE.DodecahedronGeometry(0.4 * dec.scale, 1);
          const bushMat = new THREE.MeshStandardMaterial({ color: '#3f6212', roughness: 0.9, flatShading: true });
          const bush = new THREE.Mesh(bushGeo, bushMat);
          bush.position.y = 0.25 * dec.scale;
          bush.scale.set(1.2, 0.8, 1.2);
          bush.castShadow = true;
          decGroup.add(bush);

        } else if (dec.type === 'ruin_pillar') {
          const baseGeo = new THREE.BoxGeometry(0.6 * dec.scale, 0.15 * dec.scale, 0.6 * dec.scale);
          const baseMat = new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.9 });
          const base = new THREE.Mesh(baseGeo, baseMat);
          base.position.y = 0.07 * dec.scale;
          base.castShadow = true;
          decGroup.add(base);

          const pillarGeo = new THREE.CylinderGeometry(0.18 * dec.scale, 0.22 * dec.scale, 1.8 * dec.scale, 4);
          const pillarMat = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.85, flatShading: true });
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.y = (0.07 + 0.9) * dec.scale;
          pillar.rotation.y = dec.rotation;
          pillar.rotation.x = Math.sin(idx) * 0.15;
          pillar.castShadow = true;
          decGroup.add(pillar);
        } else if (dec.type === 'house') {
          // Rural house building base
          const cottageGeo = new THREE.BoxGeometry(0.85 * dec.scale, 0.6 * dec.scale, 0.85 * dec.scale);
          const cottageMat = new THREE.MeshStandardMaterial({ color: '#d1d5db', roughness: 0.85 }); // light plaster walls
          const cottage = new THREE.Mesh(cottageGeo, cottageMat);
          cottage.position.y = 0.3 * dec.scale;
          cottage.castShadow = true;
          cottage.receiveShadow = true;
          decGroup.add(cottage);

          // Gable roof (Triangular Prism modeled with Cone)
          const roofGeo = new THREE.ConeGeometry(0.72 * dec.scale, 0.5 * dec.scale, 4);
          const roofMat = new THREE.MeshStandardMaterial({ color: '#b91c1c', roughness: 0.75, flatShading: true }); // terracotta red roof
          const roof = new THREE.Mesh(roofGeo, roofMat);
          roof.position.y = (0.6 + 0.25) * dec.scale;
          roof.rotation.y = Math.PI / 4; // align cone sides to house base
          roof.castShadow = true;
          decGroup.add(roof);

          // Small chimney cylinder
          const chimneyGeo = new THREE.CylinderGeometry(0.06 * dec.scale, 0.06 * dec.scale, 0.3 * dec.scale, 4);
          const chimneyMat = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.9 });
          const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
          chimney.position.set(-0.2 * dec.scale, 0.75 * dec.scale, 0.1 * dec.scale);
          chimney.castShadow = true;
          decGroup.add(chimney);
        }

        scene.add(decGroup);
        decoGroups.push({ group: decGroup, x: dec.x, z: dec.z });
      });
    }

    // ============================================================
    // FOG OF WAR
    // A per-cell visibility grid drives a soft dark overlay that hugs the
    // terrain. 0 = never seen (full black), 1 = explored but currently out of
    // sight (dim shroud), 2 = in active sight of a friendly unit (clear).
    // Enemy units, neutral scenery and resource rigs are only revealed where
    // there is vision, exactly like classic C&C Generals.
    // ============================================================
    const FOG_UNSEEN = 0, FOG_EXPLORED = 1, FOG_VISIBLE = 2;
    // Grid indexed [x * gridS + z]; world coords map 1:1 to cell indices.
    const fogGrid = new Uint8Array(gridS * gridS); // all unseen initially

    // DataTexture: black RGB, per-texel alpha encodes how much fog covers it.
    const fogTexW = gridS, fogTexH = gridS;
    const fogData = new Uint8Array(fogTexW * fogTexH * 4);
    for (let i = 0; i < fogTexW * fogTexH; i++) fogData[i * 4 + 3] = 245; // start fully fogged
    const fogTexture = new THREE.DataTexture(fogData, fogTexW, fogTexH, THREE.RGBAFormat);
    fogTexture.minFilter = THREE.LinearFilter;
    fogTexture.magFilter = THREE.LinearFilter;
    fogTexture.needsUpdate = true;

    // Overlay mesh follows the terrain so the shroud sits flush on hills.
    const fogSegs = Math.min(gridS - 1, 120);
    const fogGeo = new THREE.PlaneGeometry(gridS, gridS, fogSegs, fogSegs);
    fogGeo.rotateX(-Math.PI / 2);
    fogGeo.translate(gridS / 2, 0, gridS / 2);
    {
      const fp = fogGeo.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        fp.setY(i, getTerrainHeight(fp.getX(i), fp.getZ(i), map) + 0.35);
      }
      fp.needsUpdate = true;
    }
    const fogMat = new THREE.MeshBasicMaterial({
      map: fogTexture,
      transparent: true,
      depthWrite: false,
      color: 0x05080b
    });
    const fogMesh = new THREE.Mesh(fogGeo, fogMat);
    fogMesh.renderOrder = 5; // draw over terrain/water/scenery
    scene.add(fogMesh);

    // Returns the sight radius (world units) a friendly entity reveals.
    const sightRadius = (ent: GameEntity): number => {
      if (ent.type === 'building') return ent.subType === 'command_center' ? 14 : 10;
      if (ent.subType === 'drone_scout') return 16;
      if (ent.subType === 'artillery_mlrs') return 13;
      return 9;
    };

    const isVisibleAt = (x: number, z: number): boolean => {
      const cx = Math.round(x), cz = Math.round(z);
      if (cx < 0 || cz < 0 || cx >= gridS || cz >= gridS) return false;
      return fogGrid[cx * gridS + cz] === FOG_VISIBLE;
    };
    const isExploredAt = (x: number, z: number): boolean => {
      const cx = Math.round(x), cz = Math.round(z);
      if (cx < 0 || cz < 0 || cx >= gridS || cz >= gridS) return false;
      return fogGrid[cx * gridS + cz] !== FOG_UNSEEN;
    };
    fogQueryRef.current = { visible: isVisibleAt, explored: isExploredAt };

    // Recompute the whole grid and push it into the texture. Throttled in the
    // game loop — this is the only O(cells) work the fog does per refresh.
    const refreshFog = () => {
      // Demote everything currently-visible back to merely-explored.
      for (let i = 0; i < fogGrid.length; i++) {
        if (fogGrid[i] === FOG_VISIBLE) fogGrid[i] = FOG_EXPLORED;
      }
      // Stamp a visibility disc around every living friendly entity.
      for (const ent of sim.entities) {
        if (ent.state === 'dead' || ent.team !== selfPlayer.team) continue;
        const r = sightRadius(ent);
        const r2 = r * r;
        const minX = Math.max(0, Math.floor(ent.x - r));
        const maxX = Math.min(gridS - 1, Math.ceil(ent.x + r));
        const minZ = Math.max(0, Math.floor(ent.z - r));
        const maxZ = Math.min(gridS - 1, Math.ceil(ent.z + r));
        for (let cx = minX; cx <= maxX; cx++) {
          const ddx = cx - ent.x;
          for (let cz = minZ; cz <= maxZ; cz++) {
            const ddz = cz - ent.z;
            if (ddx * ddx + ddz * ddz <= r2) fogGrid[cx * gridS + cz] = FOG_VISIBLE;
          }
        }
      }
      // Write alpha per texel. Texel (tx,ty) → world (tx, gridS-1-ty) because
      // the plane's V axis is flipped relative to world Z (see UV derivation).
      for (let ty = 0; ty < fogTexH; ty++) {
        const cz = (gridS - 1) - ty;
        for (let tx = 0; tx < fogTexW; tx++) {
          const state = fogGrid[tx * gridS + cz];
          const alpha = state === FOG_VISIBLE ? 0 : state === FOG_EXPLORED ? 130 : 245;
          fogData[(ty * fogTexW + tx) * 4 + 3] = alpha;
        }
      }
      fogTexture.needsUpdate = true;
    };

    // 5. Visual representations/models of Game Entities mapped by entity ID
    const entityMeshes: Map<string, THREE.Group> = new Map();

    function constructModel(ent: GameEntity, colorHex: string): THREE.Group {
      const g = new THREE.Group();
      const pColor = new THREE.Color(colorHex);
      const faction = getFaction(ent.playerId, sim.players);

      let structuralHull = new THREE.MeshStandardMaterial({ color: '#374151', metalness: 0.8, roughness: 0.3 });
      let glowingCore = new THREE.MeshBasicMaterial({ color: pColor });

      // Apply gorgeous thematic materials based on player's Faction
      if (faction === 'Alliance') {
        structuralHull = new THREE.MeshStandardMaterial({ color: '#f1f5f9', metalness: 0.9, roughness: 0.1 });
        glowingCore = new THREE.MeshBasicMaterial({ color: new THREE.Color('#38bdf8') });
      } else if (faction === 'Coalition') {
        structuralHull = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.7, roughness: 0.4 });
        glowingCore = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f97316') });
      } else if (faction === 'Union') {
        structuralHull = new THREE.MeshStandardMaterial({ color: '#854d0e', metalness: 0.8, roughness: 0.2 });
        glowingCore = new THREE.MeshBasicMaterial({ color: new THREE.Color('#eab308') });
      } else { // Syndicate
        structuralHull = new THREE.MeshStandardMaterial({ color: '#1e1b4b', metalness: 0.6, roughness: 0.5 });
        glowingCore = new THREE.MeshBasicMaterial({ color: new THREE.Color('#22c55e') });
      }

      const vehicleHull = structuralHull;
      const dynamicCoating = new THREE.MeshStandardMaterial({ color: pColor, metalness: 0.5, roughness: 0.3 });

      if (ent.type === 'building') {
        if (ent.subType === 'command_center') {
          if (faction === 'Alliance') {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 1.0, 8), structuralHull);
            b.position.y = 0.5;
            b.castShadow = true;
            b.receiveShadow = true;
            g.add(b);

            const pillar1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), structuralHull);
            pillar1.position.set(-0.8, 1.25, -0.8);
            g.add(pillar1);

            const pillar2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), structuralHull);
            pillar2.position.set(0.8, 1.25, 0.8);
            g.add(pillar2);

            const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12), glowingCore);
            sphere.position.y = 1.9;
            g.add(sphere);

            const antenna = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.25, 8), glowingCore);
            antenna.rotation.z = Math.PI / 4;
            antenna.position.set(0.8, 1.0, -0.8);
            antenna.name = 'radar_dish';
            g.add(antenna);

          } else if (faction === 'Coalition') {
            const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.8, 6), structuralHull);
            base.position.y = 0.4;
            base.castShadow = true;
            base.receiveShadow = true;
            g.add(base);

            const controlRoom = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), structuralHull);
            controlRoom.position.y = 1.1;
            g.add(controlRoom);

            const glowBand = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 1.45), glowingCore);
            glowBand.position.y = 1.1;
            g.add(glowBand);

            const plate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.7), structuralHull);
            plate.position.y = 1.45;
            g.add(plate);

            const antennaSupport = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5), structuralHull);
            antennaSupport.position.set(0.7, 1.1, 0.7);
            g.add(antennaSupport);

            const satDish = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.3, 8), glowingCore);
            satDish.rotation.z = Math.PI / 3;
            satDish.position.set(0.7, 1.4, 0.7);
            satDish.name = 'radar_dish';
            g.add(satDish);

          } else if (faction === 'Union') {
            const towerBase = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 2.6), structuralHull);
            towerBase.position.y = 0.7;
            towerBase.castShadow = true;
            towerBase.receiveShadow = true;
            g.add(towerBase);

            const pillarCorner1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.8), structuralHull);
            pillarCorner1.position.set(-1.1, 0.9, -1.1);
            g.add(pillarCorner1);

            const pillarCorner2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.8), structuralHull);
            pillarCorner2.position.set(1.1, 0.9, 1.1);
            g.add(pillarCorner2);

            const centralCoil = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 8), glowingCore);
            centralCoil.position.y = 1.85;
            g.add(centralCoil);

            const ballSphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), structuralHull);
            ballSphere.position.set(-0.7, 1.6, 0.7);
            g.add(ballSphere);

            const satDish = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.25, 8), glowingCore);
            satDish.rotation.z = Math.PI / 4;
            satDish.position.set(-0.7, 1.9, 0.7);
            satDish.name = 'radar_dish';
            g.add(satDish);

          } else { // Syndicate
            const organicHiveBase = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 6), structuralHull);
            organicHiveBase.scale.set(1.1, 0.4, 1.1);
            organicHiveBase.position.y = 0.3;
            organicHiveBase.castShadow = true;
            organicHiveBase.receiveShadow = true;
            g.add(organicHiveBase);

            const crystalOb = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.0, 4), glowingCore);
            crystalOb.position.y = 1.3;
            g.add(crystalOb);

            const sideSpike1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.4, 4), structuralHull);
            sideSpike1.position.set(1.0, 0.7, -1.0);
            sideSpike1.rotation.z = -0.3;
            g.add(sideSpike1);

            const sideSpike2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.4, 4), structuralHull);
            sideSpike2.position.set(-1.0, 0.7, 1.0);
            sideSpike2.rotation.z = 0.3;
            g.add(sideSpike2);

            const glowTorus = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 4, 12), glowingCore);
            glowTorus.rotation.x = Math.PI / 2;
            glowTorus.position.y = 0.9;
            glowTorus.name = 'radar_dish';
            g.add(glowTorus);
          }

        } else if (ent.subType === 'power_plant') {
          if (faction === 'Alliance') {
            const flatRingBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.2, 3), structuralHull);
            flatRingBase.position.y = 0.1;
            flatRingBase.castShadow = true;
            g.add(flatRingBase);

            const centerOrb = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 12), glowingCore);
            centerOrb.position.y = 1.0;
            g.add(centerOrb);

            const protectionCol = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4), structuralHull);
            protectionCol.position.set(0.9, 0.7, 0);
            g.add(protectionCol);

            const protectionCol2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4), structuralHull);
            protectionCol2.position.set(-0.9, 0.7, 0);
            g.add(protectionCol2);

            const hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 4, 16), glowingCore);
            hoverRing.rotation.x = Math.PI / 2;
            hoverRing.position.y = 1.0;
            g.add(hoverRing);

          } else if (faction === 'Coalition') {
            const blockBase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.6), structuralHull);
            blockBase.position.y = 0.5;
            blockBase.castShadow = true;
            g.add(blockBase);

            const chimneyS1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 8), structuralHull);
            chimneyS1.position.set(-0.5, 1.25, -0.4);
            g.add(chimneyS1);

            const chimneyGlow1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 6), glowingCore);
            chimneyGlow1.position.set(-0.5, 2.1, -0.4);
            g.add(chimneyGlow1);

            const chimneyS2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.3, 8), structuralHull);
            chimneyS2.position.set(0.5, 1.15, -0.4);
            g.add(chimneyS2);

            const chimneyGlow2 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.25, 6), glowingCore);
            chimneyGlow2.position.set(0.5, 1.9, -0.4);
            g.add(chimneyGlow2);

            const dieselPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8), glowingCore);
            dieselPiston.position.set(0, 0.9, 0.4);
            g.add(dieselPiston);

          } else if (faction === 'Union') {
            const subStationCyl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 8), structuralHull);
            subStationCyl.position.y = 0.4;
            subStationCyl.castShadow = true;
            g.add(subStationCyl);

            const rib1 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.15, 4, 16), structuralHull);
            rib1.rotation.x = Math.PI / 2;
            rib1.position.y = 0.3;
            g.add(rib1);

            const coilPole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.2), glowingCore);
            coilPole.position.y = 1.3;
            g.add(coilPole);

            const emitterRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 4, 12), glowingCore);
            emitterRing1.rotation.x = Math.PI / 2;
            emitterRing1.position.y = 1.4;
            g.add(emitterRing1);

            const topGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), glowingCore);
            topGlobe.position.y = 1.9;
            g.add(topGlobe);

          } else { // Syndicate
            const baseDerrick = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), structuralHull);
            baseDerrick.position.y = 0.15;
            baseDerrick.castShadow = true;
            g.add(baseDerrick);

            const centerPrism = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 4), structuralHull);
            centerPrism.rotation.x = Math.PI;
            centerPrism.position.y = 1.0;
            g.add(centerPrism);

            const giantCrys = new THREE.Mesh(new THREE.OctahedronGeometry(0.52), glowingCore);
            giantCrys.position.y = 1.5;
            g.add(giantCrys);

            const orbitalS1 = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), glowingCore);
            orbitalS1.position.set(0.65, 1.4, 0.65);
            g.add(orbitalS1);

            const orbitalS2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), glowingCore);
            orbitalS2.position.set(-0.65, 1.4, -0.65);
            g.add(orbitalS2);
          }

        } else if (ent.subType === 'supply_refinery') {
          const refineryBase = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), structuralHull);
          refineryBase.position.y = 0.4;
          refineryBase.castShadow = true;
          refineryBase.receiveShadow = true;
          g.add(refineryBase);

          if (faction === 'Alliance') {
            const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.3, 8), structuralHull);
            chimney.position.set(-0.6, 1.15 + 0.4, -0.6);
            g.add(chimney);

            const flare = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), glowingCore);
            flare.position.set(-0.6, 2.5 + 0.4, -0.6);
            g.add(flare);

            const pumpRig = new THREE.Group();
            pumpRig.position.set(0.6, 0.8, 0);
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.15), structuralHull);
            shaft.position.y = 0.5;
            pumpRig.add(shaft);
            const walkingBeam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.2), glowingCore);
            walkingBeam.position.set(0.3, 1.0, 0);
            walkingBeam.name = 'pump_arm';
            pumpRig.add(walkingBeam);
            g.add(pumpRig);

          } else if (faction === 'Coalition') {
            const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 2.5, 8), structuralHull);
            chimney.position.set(-0.5, 1.25 + 0.4, -0.5);
            g.add(chimney);

            const flare = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 8), glowingCore);
            flare.position.set(-0.5, 2.7 + 0.4, -0.5);
            g.add(flare);

            const pumpRig = new THREE.Group();
            pumpRig.position.set(0.5, 0.8, 0.1);
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.2), structuralHull);
            shaft.position.y = 0.5;
            pumpRig.add(shaft);
            const walkingBeam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.3), glowingCore);
            walkingBeam.position.set(0.4, 1.0, 0);
            walkingBeam.name = 'pump_arm';
            pumpRig.add(walkingBeam);
            g.add(pumpRig);

          } else if (faction === 'Union') {
            const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.1, 8), structuralHull);
            chimney.position.set(-0.5, 1.05 + 0.4, -0.5);
            g.add(chimney);

            const flare = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.45, 8), glowingCore);
            flare.position.set(-0.5, 2.3 + 0.4, -0.5);
            g.add(flare);

            const electricalCoil = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), glowingCore);
            electricalCoil.position.set(-0.5, 2.65 + 0.4, -0.5);
            g.add(electricalCoil);

            const pumpRig = new THREE.Group();
            pumpRig.position.set(0.5, 0.8, 0);
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), structuralHull);
            shaft.position.y = 0.45;
            pumpRig.add(shaft);
            const walkingBeam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 0.22), glowingCore);
            walkingBeam.position.set(0.3, 0.9, 0);
            walkingBeam.name = 'pump_arm';
            pumpRig.add(walkingBeam);
            g.add(pumpRig);

          } else { // Syndicate
            const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8), structuralHull);
            chimney.position.set(-0.6, 1.1 + 0.4, -0.6);
            g.add(chimney);

            const flare = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.52, 6), glowingCore);
            flare.position.set(-0.6, 2.45 + 0.4, -0.6);
            g.add(flare);

            const chemicalPipe = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.08, 4, 12), glowingCore);
            chemicalPipe.position.set(-0.6, 0.8 + 0.4, -0.6);
            g.add(chemicalPipe);

            const pumpRig = new THREE.Group();
            pumpRig.position.set(0.6, 0.8, 0);
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 0.15), structuralHull);
            shaft.position.y = 0.45;
            pumpRig.add(shaft);
            const walkingBeam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.2), glowingCore);
            walkingBeam.position.set(0.35, 0.9, 0);
            walkingBeam.name = 'pump_arm';
            pumpRig.add(walkingBeam);
            g.add(pumpRig);
          }

        } else if (ent.subType === 'barracks') {
          if (faction === 'Alliance') {
            const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.14, 4, 16), structuralHull);
            outerRing.rotation.x = Math.PI / 2;
            outerRing.position.y = 0.1;
            outerRing.castShadow = true;
            g.add(outerRing);

            const holoGate = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 8), glowingCore);
            holoGate.position.y = 0.7;
            holoGate.scale.set(1.0, 1.0, 0.2);
            g.add(holoGate);

          } else if (faction === 'Coalition') {
            const hangar = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 12, 1), structuralHull);
            hangar.rotation.z = Math.PI / 2;
            hangar.scale.set(1.0, 1.0, 0.75);
            hangar.position.y = 0.6;
            hangar.castShadow = true;
            g.add(hangar);

            const gateDoor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.1), glowingCore);
            gateDoor.position.set(0, 0.4, 1.05);
            g.add(gateDoor);

          } else if (faction === 'Union') {
            const blockyA = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 2.0), structuralHull);
            blockyA.position.y = 0.65;
            blockyA.castShadow = true;
            g.add(blockyA);

            const entranceCover = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.6), glowingCore);
            entranceCover.position.set(0, 0.35, 1.1);
            g.add(entranceCover);

            const antennaSteel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8), structuralHull);
            antennaSteel.position.set(0.7, 1.5, -0.7);
            g.add(antennaSteel);

          } else { // Syndicate
            const pond = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.2, 8), structuralHull);
            pond.position.y = 0.1;
            pond.castShadow = true;
            g.add(pond);

            const podCapsule = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), glowingCore);
            podCapsule.scale.set(1.0, 1.3, 1.0);
            podCapsule.position.y = 0.8;
            g.add(podCapsule);

            const shellAppendage = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.1, 4, 12), structuralHull);
            shellAppendage.rotation.y = Math.PI / 2;
            shellAppendage.position.y = 0.8;
            g.add(shellAppendage);
          }

        } else if (ent.subType === 'war_factory') {
          if (faction === 'Alliance') {
            const flatBay = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.16, 2.8), structuralHull);
            flatBay.position.y = 0.08;
            flatBay.castShadow = true;
            g.add(flatBay);

            const archGantry = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.25, 0.4), structuralHull);
            archGantry.position.set(0, 1.8, 0);
            g.add(archGantry);

            const archLLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.4), structuralHull);
            archLLeg.position.set(-1.4, 0.9, 0);
            g.add(archLLeg);

            const archRLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.4), structuralHull);
            archRLeg.position.set(1.4, 0.9, 0);
            g.add(archRLeg);

            const scanningBeamLaser = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.08), glowingCore);
            scanningBeamLaser.position.set(0, 1.65, 0);
            g.add(scanningBeamLaser);

          } else if (faction === 'Coalition') {
            const warehouse = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.6, 2.2), structuralHull);
            warehouse.position.y = 0.8;
            warehouse.castShadow = true;
            g.add(warehouse);

            const heavyGate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.15), glowingCore);
            heavyGate.position.set(0, 0.55, 1.12);
            g.add(heavyGate);

            const chimneySmelter1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.3), structuralHull);
            chimneySmelter1.position.set(-1.1, 1.7, -0.6);
            g.add(chimneySmelter1);

            const chimneySmelter2 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.3), structuralHull);
            chimneySmelter2.position.set(1.1, 1.7, -0.6);
            g.add(chimneySmelter2);

          } else if (faction === 'Union') {
            const mainBuildWorkshop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 2.4), structuralHull);
            mainBuildWorkshop.position.y = 0.65;
            mainBuildWorkshop.castShadow = true;
            g.add(mainBuildWorkshop);

            const glowingLineA = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 0.1), glowingCore);
            glowingLineA.position.set(0, 1.25, 1.21);
            g.add(glowingLineA);

            const powerRailCopper = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 4, 16), glowingCore);
            powerRailCopper.rotation.y = Math.PI / 2;
            powerRailCopper.position.set(-1.0, 1.3, 0);
            g.add(powerRailCopper);

            const assemblyCraneRail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), structuralHull);
            assemblyCraneRail.position.set(1.0, 1.1, 0.9);
            g.add(assemblyCraneRail);

          } else { // Syndicate
            const hollowRuinBase = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.8, 8), structuralHull);
            hollowRuinBase.position.y = 0.4;
            hollowRuinBase.castShadow = true;
            g.add(hollowRuinBase);

            const glowingChemicalFluidS = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.1, 8), glowingCore);
            glowingChemicalFluidS.position.y = 0.78;
            g.add(glowingChemicalFluidS);

            const injectorPipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1), structuralHull);
            injectorPipe1.rotation.z = -0.6;
            injectorPipe1.position.set(-1.1, 0.7, 0);
            g.add(injectorPipe1);

            const injectorPipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1), structuralHull);
            injectorPipe2.rotation.z = 0.6;
            injectorPipe2.position.set(1.1, 0.7, 0);
            g.add(injectorPipe2);
          }

        } else if (ent.subType === 'defense_turret') {
          const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.7, 8), structuralHull);
          turretBase.position.y = 0.35;
          turretBase.castShadow = true;
          g.add(turretBase);

          if (faction === 'Alliance') {
            const pedestalCol = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 1.6), structuralHull);
            pedestalCol.position.y = 1.15;
            g.add(pedestalCol);

            const headRotGroupNode = new THREE.Group();
            headRotGroupNode.position.y = 1.95;
            headRotGroupNode.name = 'railgun_head';

            const laserPrismCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), glowingCore);
            laserPrismCore.name = 'floating_crys';
            headRotGroupNode.add(laserPrismCore);

            const crystalRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 4, 12), structuralHull);
            crystalRing.rotation.x = Math.PI / 2;
            headRotGroupNode.add(crystalRing);

            g.add(headRotGroupNode);

          } else if (faction === 'Coalition') {
            const pivotHeadGroupNode = new THREE.Group();
            pivotHeadGroupNode.position.y = 0.7;
            pivotHeadGroupNode.name = 'railgun_head';

            const shieldP = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), structuralHull);
            shieldP.position.y = 0.3;
            pivotHeadGroupNode.add(shieldP);

            const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4), glowingCore);
            b1.rotation.x = Math.PI / 2;
            b1.position.set(-0.2, 0.3, 0.6);
            pivotHeadGroupNode.add(b1);

            const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4), glowingCore);
            b2.rotation.x = Math.PI / 2;
            b2.position.set(0.2, 0.3, 0.6);
            pivotHeadGroupNode.add(b2);

            g.add(pivotHeadGroupNode);

          } else if (faction === 'Union') {
            const antennaMastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5), structuralHull);
            antennaMastPole.position.y = 1.1;
            g.add(antennaMastPole);

            const glassGrid1 = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 4, 12), structuralHull);
            glassGrid1.rotation.x = Math.PI / 2;
            glassGrid1.position.y = 1.0;
            g.add(glassGrid1);

            const glassGrid2 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 4, 12), structuralHull);
            glassGrid2.rotation.x = Math.PI / 2;
            glassGrid2.position.y = 1.4;
            g.add(glassGrid2);

            const headRotGroupNode = new THREE.Group();
            headRotGroupNode.position.y = 1.85;
            headRotGroupNode.name = 'railgun_head';

            const copperGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), glowingCore);
            headRotGroupNode.add(copperGlobe);

            g.add(headRotGroupNode);

          } else { // Syndicate
            const organicMountSegment = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.2), structuralHull);
            organicMountSegment.rotation.z = 0.15;
            organicMountSegment.position.set(-0.15, 0.9, 0);
            g.add(organicMountSegment);

            const headRotGroupNode = new THREE.Group();
            headRotGroupNode.position.set(0, 1.4, 0);
            headRotGroupNode.name = 'railgun_head';

            const spikeSackHead = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 8), structuralHull);
            spikeSackHead.rotation.x = Math.PI / 2;
            headRotGroupNode.add(spikeSackHead);

            const organicVenomCoreBall = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), glowingCore);
            organicVenomCoreBall.position.set(0, 0, 0.3);
            headRotGroupNode.add(organicVenomCoreBall);

            g.add(headRotGroupNode);
          }

        } else if (ent.subType === 'oil_derrick') {
          // Robust Industrial oil pumping derrick frame with fully automated walking beam
          const baseTruss = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.65, 1.3, 4),
            new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.8, roughness: 0.3 })
          );
          baseTruss.position.y = 0.65;
          baseTruss.castShadow = true;
          baseTruss.receiveShadow = true;
          g.add(baseTruss);

          // Support neck joints
          const beamPivotJoint = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 0.4),
            structuralHull
          );
          beamPivotJoint.rotation.x = Math.PI/2;
          beamPivotJoint.position.set(0, 1.25, 0);
          g.add(beamPivotJoint);

          // Walking beam named 'pump_arm' for automatic sin tilt vibrations!
          const walkingBeamGroup = new THREE.Group();
          walkingBeamGroup.name = 'pump_arm';
          walkingBeamGroup.position.set(0, 1.25, 0); // pivot centered on joint

          const mainArmBeam = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.14, 1.6),
            new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.7, roughness: 0.4 })
          );
          mainArmBeam.position.set(0, 0, 0.2); // offset along Z so it pivots appropriately
          walkingBeamGroup.add(mainArmBeam);

          // Hammer counterweight Horsehead
          const horseHeadBox = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, 0.45, 0.22),
            glowingCore
          );
          horseHeadBox.position.set(0, 0.05, 1.0);
          walkingBeamGroup.add(horseHeadBox);

          // Sucker rod link connecting to the ground
          const suckerThinCyl = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, 1.1),
            new THREE.MeshStandardMaterial({ color: '#94a3b8', rawRefReference: true } as any)
          );
          suckerThinCyl.position.set(0, -0.5, 1.0);
          walkingBeamGroup.add(suckerThinCyl);

          g.add(walkingBeamGroup);

          // Big heavy raw petroleum storage tank container near the foundation
          const fuelTankDrum = new THREE.Mesh(
            new THREE.CylinderGeometry(0.4, 0.4, 0.65, 12),
            structuralHull
          );
          fuelTankDrum.position.set(0.65, 0.32, -0.6);
          fuelTankDrum.rotation.z = Math.PI / 2;
          g.add(fuelTankDrum);

          // Little warning light signal indicator
          const warningL = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 6, 6),
            new THREE.MeshBasicMaterial({ color: '#ef4444' })
          );
          warningL.position.set(-0.35, 1.35, -0.35);
          g.add(warningL);

        } else if (ent.subType === 'civilian_building') {
          // High-density neutral urban skyscraper optimized for infantry garrisons
          const skyBlock = new THREE.Mesh(
            new THREE.BoxGeometry(1.65, 2.7, 1.65),
            new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.5, metalness: 0.2 })
          );
          skyBlock.position.y = 1.35;
          skyBlock.castShadow = true;
          skyBlock.receiveShadow = true;
          g.add(skyBlock);

          // Symmetrical rows of dark glass windows that light up inside!
          const windowMat = new THREE.MeshBasicMaterial({ color: '#eab308' }); // warm cozy lit window yellow
          for (let floor = 0; floor < 4; floor++) {
            const hCoord = 0.45 + floor * 0.62;
            
            // Front face windows
            const frontW1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.03), windowMat);
            frontW1.position.set(-0.45, hCoord, 0.84);
            g.add(frontW1);

            const frontW2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.03), windowMat);
            frontW2.position.set(0.45, hCoord, 0.84);
            g.add(frontW2);

            // Left side face windows
            const sideW1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.25), windowMat);
            sideW1.position.set(-0.84, hCoord, -0.4);
            g.add(sideW1);

            const sideW2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.25), windowMat);
            sideW2.position.set(-0.84, hCoord, 0.4);
            g.add(sideW2);
          }

          // Modern high-impact communication aerial rooftop frame on top of skyscraper
          const supportDomeNode = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.65, 0.15, 8),
            structuralHull
          );
          supportDomeNode.position.y = 2.76;
          g.add(supportDomeNode);

          const transmitterPin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 0.85),
            new THREE.MeshStandardMaterial({ color: '#f1f5f9', metalness: 0.9 })
          );
          transmitterPin.position.set(0, 3.2, 0);
          g.add(transmitterPin);

          const bulbGlow = new THREE.Mesh(
            new THREE.SphereGeometry(0.07, 6, 6),
            new THREE.MeshBasicMaterial({ color: '#ef4444' }) // ruby aviation signal beacon
          );
          bulbGlow.position.set(0, 3.65, 0);
          g.add(bulbGlow);
        }

      } else {
        if (ent.subType === 'drone_scout') {
          if (faction === 'Alliance') {
            const wingTri = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3), dynamicCoating);
            wingTri.rotation.x = Math.PI / 2;
            wingTri.position.y = 0.65;
            g.add(wingTri);

            const lightS = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), glowingCore);
            lightS.position.set(0, 0.52, 0.2);
            g.add(lightS);

          } else if (faction === 'Coalition') {
            const hullBox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.65), vehicleHull);
            hullBox.position.y = 0.6;
            g.add(hullBox);

            const rotGroup = new THREE.Group();
            rotGroup.name = 'rotors';
            const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.02, 0.05), dynamicCoating);
            b1.position.set(0, 0.74, 0.15);
            b1.name = 'blade_0';
            rotGroup.add(b1);
            const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.02, 0.05), dynamicCoating);
            b2.position.set(0, 0.78, -0.15);
            b2.name = 'blade_1';
            rotGroup.add(b2);
            g.add(rotGroup);

          } else if (faction === 'Union') {
            const wireSputnik = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 10), vehicleHull);
            wireSputnik.position.y = 0.65;
            g.add(wireSputnik);

            const searchEyeLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2), glowingCore);
            searchEyeLamp.rotation.x = Math.PI/2;
            searchEyeLamp.position.set(0, 0.65, 0.16);
            g.add(searchEyeLamp);

            [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]].forEach((off) => {
              const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6), glowingCore);
              ant.rotation.set(0.4, 0, (Math.random()-0.5)*0.3);
              ant.position.set(off[0], 0.45, off[1]);
              g.add(ant);
            });

          } else { // Syndicate
            const heartFrame = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), vehicleHull);
            heartFrame.position.y = 0.64;
            g.add(heartFrame);

            const venomScythe1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.2), dynamicCoating);
            venomScythe1.rotation.y = 0.4;
            venomScythe1.position.set(0.25, 0.65, 0.15);
            g.add(venomScythe1);

            const venomScythe2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.2), dynamicCoating);
            venomScythe2.rotation.y = -0.4;
            venomScythe2.position.set(-0.25, 0.65, 0.15);
            g.add(venomScythe2);
          }

        } else if (ent.subType === 'drone_kamikaze') {
          if (faction === 'Alliance') {
            const bodyR = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8), structuralHull);
            bodyR.rotation.x = Math.PI / 2;
            bodyR.position.y = 0.65;
            g.add(bodyR);

            const exhaustThrusterJet = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 6), glowingCore);
            exhaustThrusterJet.rotation.x = -Math.PI / 2;
            exhaustThrusterJet.position.set(0, 0.65, -0.45);
            g.add(exhaustThrusterJet);

          } else if (faction === 'Coalition') {
            const slabG = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.7), vehicleHull);
            slabG.position.y = 0.6;
            g.add(slabG);

            const redExposeNose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), glowingCore);
            redExposeNose.position.set(0, 0.6, 0.35);
            g.add(redExposeNose);

            const rearBladeNode = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.04), structuralHull);
            rearBladeNode.name = 'rear_prop';
            rearBladeNode.position.set(0, 0.6, -0.38);
            g.add(rearBladeNode);

          } else if (faction === 'Union') {
            const thinBody = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.75), dynamicCoating);
            thinBody.rotation.x = Math.PI / 2;
            thinBody.position.y = 0.62;
            g.add(thinBody);

            const wingTop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.2), structuralHull);
            wingTop.position.set(0, 0.75, 0.1);
            g.add(wingTop);

            const wingBot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.2), structuralHull);
            wingBot.position.set(0, 0.48, 0.1);
            g.add(wingBot);

            const spinBladeGroup = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.03), structuralHull);
            spinBladeGroup.name = 'rear_prop';
            spinBladeGroup.position.set(0, 0.62, 0.38);
            g.add(spinBladeGroup);

          } else { // Syndicate
            const tickShieldHull = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), vehicleHull);
            tickShieldHull.position.y = 0.45;
            g.add(tickShieldHull);

            const acidEggGland = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), glowingCore);
            acidEggGland.scale.set(0.9, 0.9, 1.25);
            acidEggGland.position.set(0, 0.52, -0.15);
            g.add(acidEggGland);

            const mandLeft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.16), glowingCore);
            mandLeft.position.set(-0.08, 0.4, 0.22);
            g.add(mandLeft);

            const mandRight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.16), glowingCore);
            mandRight.position.set(0.08, 0.4, 0.22);
            g.add(mandRight);
          }

        } else if (ent.subType === 'cyber_specops') {
          const baseHumCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.8, 8), vehicleHull);
          baseHumCyl.position.y = 0.4;
          g.add(baseHumCyl);

          if (faction === 'Alliance') {
            const visorL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), glowingCore);
            visorL.position.set(0, 0.72, 0.12);
            g.add(visorL);

            const lanceArm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2), glowingCore);
            lanceArm.rotation.x = Math.PI / 4;
            lanceArm.position.set(0.22, 0.45, 0.12);
            g.add(lanceArm);

          } else if (faction === 'Coalition') {
            const flamethrowerTank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5), dynamicCoating);
            flamethrowerTank.position.set(0, 0.45, -0.22);
            g.add(flamethrowerTank);

            const weaponNozzlePipe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.65), structuralHull);
            weaponNozzlePipe.position.set(0.2, 0.35, 0.2);
            g.add(weaponNozzlePipe);

            const maskVisorS = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), glowingCore);
            maskVisorS.position.set(0, 0.72, 0.1);
            g.add(maskVisorS);

          } else if (faction === 'Union') {
            const conductorPlates = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.45, 0.38), dynamicCoating);
            conductorPlates.position.set(0, 0.42, -0.16);
            g.add(conductorPlates);

            const coilLHand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22), glowingCore);
            coilLHand.position.set(-0.24, 0.3, 0.1);
            g.add(coilLHand);

            const coilRHand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22), glowingCore);
            coilRHand.position.set(0.24, 0.3, 0.1);
            g.add(coilRHand);

          } else { // Syndicate
            const hoodHelmet = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 4), structuralHull);
            hoodHelmet.position.y = 0.58;
            g.add(hoodHelmet);

            const bladeL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.5), glowingCore);
            bladeL.rotation.x = Math.PI / 4;
            bladeL.position.set(-0.2, 0.3, 0.2);
            g.add(bladeL);

            const bladeR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.5), glowingCore);
            bladeR.rotation.x = Math.PI / 4;
            bladeR.position.set(0.2, 0.3, 0.2);
            g.add(bladeR);
          }

        } else if (ent.subType === 'precision_tank') {
          if (faction === 'Alliance') {
            const hoverBody = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 1.8), vehicleHull);
            hoverBody.position.y = 0.25;
            g.add(hoverBody);

            const hoverPadL = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.7), dynamicCoating);
            hoverPadL.rotation.x = Math.PI / 2;
            hoverPadL.position.set(-0.64, 0.12, 0);
            g.add(hoverPadL);

            const hoverPadR = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.7), dynamicCoating);
            hoverPadR.rotation.x = Math.PI / 2;
            hoverPadR.position.set(0.64, 0.12, 0);
            g.add(hoverPadR);

            const turPivotGroupNode = new THREE.Group();
            turPivotGroupNode.position.y = 0.44;
            turPivotGroupNode.name = 'tank_head';

            const sleekCapNode = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), vehicleHull);
            sleekCapNode.scale.set(1.0, 0.6, 1.0);
            sleekCapNode.position.y = 0.15;
            turPivotGroupNode.add(sleekCapNode);

            const heavyDoubleLasers = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3), glowingCore);
            heavyDoubleLasers.rotation.x = Math.PI / 2;
            heavyDoubleLasers.position.set(-0.16, 0.15, 0.72);
            turPivotGroupNode.add(heavyDoubleLasers);

            const heavyDoubleLasers2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3), glowingCore);
            heavyDoubleLasers2.rotation.x = Math.PI / 2;
            heavyDoubleLasers2.position.set(0.16, 0.15, 0.72);
            turPivotGroupNode.add(heavyDoubleLasers2);

            g.add(turPivotGroupNode);

          } else if (faction === 'Coalition') {
            const treadsL1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.95), structuralHull);
            treadsL1.position.set(-0.6, 0.18, 0.52);
            g.add(treadsL1);
            const treadsR1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.95), structuralHull);
            treadsR1.position.set(0.6, 0.18, 0.52);
            g.add(treadsR1);
            const treadsL2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.95), structuralHull);
            treadsL2.position.set(-0.6, 0.18, -0.52);
            g.add(treadsL2);
            const treadsR2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.95), structuralHull);
            treadsR2.position.set(0.6, 0.18, -0.52);
            g.add(treadsR2);

            const fortressPlate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.9), dynamicCoating);
            fortressPlate.position.y = 0.36;
            g.add(fortressPlate);

            const turPivotGroupNode = new THREE.Group();
            turPivotGroupNode.position.y = 0.54;
            turPivotGroupNode.name = 'tank_head';

            const centralDomeBlock = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 1.05), vehicleHull);
            centralDomeBlock.position.y = 0.22;
            turPivotGroupNode.add(centralDomeBlock);

            const massiveL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), structuralHull);
            massiveL.rotation.x = Math.PI / 2;
            massiveL.position.set(-0.2, 0.22, 0.75);
            turPivotGroupNode.add(massiveL);

            const massiveR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), structuralHull);
            massiveR.rotation.x = Math.PI / 2;
            massiveR.position.set(0.2, 0.22, 0.75);
            turPivotGroupNode.add(massiveR);

            g.add(turPivotGroupNode);

          } else if (faction === 'Union') {
            const wheelTreads = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.3, 1.6), vehicleHull);
            wheelTreads.position.y = 0.15;
            g.add(wheelTreads);

            const copperPlateTop = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.2, 1.35), dynamicCoating);
            copperPlateTop.position.y = 0.38;
            g.add(copperPlateTop);

            const turPivotGroupNode = new THREE.Group();
            turPivotGroupNode.position.y = 0.48;
            turPivotGroupNode.name = 'tank_head';

            const globeCoreArm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), vehicleHull);
            globeCoreArm.position.y = 0.2;
            turPivotGroupNode.add(globeCoreArm);

            const ringConductorLine = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 4, 12), glowingCore);
            ringConductorLine.rotation.x = Math.PI / 2;
            ringConductorLine.position.y = 0.2;
            turPivotGroupNode.add(ringConductorLine);

            const lightningBallPew = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), glowingCore);
            lightningBallPew.position.set(0, 0.2, 0.55);
            turPivotGroupNode.add(lightningBallPew);

            g.add(turPivotGroupNode);

          } else { // Syndicate
            const spiderBodyCap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), dynamicCoating);
            spiderBodyCap.scale.set(1.0, 0.65, 1.4);
            spiderBodyCap.position.y = 0.4;
            g.add(spiderBodyCap);

            const offsets = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];
            offsets.forEach((off) => {
              const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7), structuralHull);
              leg.rotation.z = off[0] > 0 ? 0.6 : -0.6;
              leg.position.set(off[0]*0.9, 0.25, off[1]*0.9);
              g.add(leg);
            });

            const turPivotGroupNode = new THREE.Group();
            turPivotGroupNode.position.y = 0.68;
            turPivotGroupNode.name = 'tank_head';

            const venomDripSac = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), glowingCore);
            venomDripSac.position.set(0, 0, 0.1);
            turPivotGroupNode.add(venomDripSac);

            const bioBarrelP = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.9, 6), structuralHull);
            bioBarrelP.rotation.x = Math.PI / 2 + 0.1;
            bioBarrelP.position.set(0, 0.04, 0.48);
            turPivotGroupNode.add(bioBarrelP);

            g.add(turPivotGroupNode);
          }

        } else if (ent.subType === 'artillery_mlrs') {
          if (faction === 'Alliance') {
            const baseChas = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.35, 1.9), vehicleHull);
            baseChas.position.y = 0.2;
            g.add(baseChas);

            const launchRig = new THREE.Group();
            launchRig.position.set(0, 0.35, -0.3);
            launchRig.name = 'mlrs_barrel';
            const railSNode = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 1.6), dynamicCoating);
            railSNode.position.z = 0.4;
            launchRig.add(railSNode);
            const lineMagnet = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.8), glowingCore);
            lineMagnet.position.set(0, 0.13, 0.4);
            launchRig.add(lineMagnet);
            g.add(launchRig);

          } else if (faction === 'Coalition') {
            const truckBody = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.4, 2.1), vehicleHull);
            truckBody.position.y = 0.22;
            g.add(truckBody);

            const heavyCabS = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.55), dynamicCoating);
            heavyCabS.position.set(0, 0.58, 0.68);
            g.add(heavyCabS);

            const launchRig = new THREE.Group();
            launchRig.position.set(0, 0.42, -0.36);
            launchRig.name = 'mlrs_barrel';
            const tubesRack = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.48, 1.25), dynamicCoating);
            tubesRack.position.z = -0.15;
            launchRig.add(tubesRack);
            g.add(launchRig);

          } else if (faction === 'Union') {
            const flatbedChas = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 1.8), vehicleHull);
            flatbedChas.position.y = 0.15;
            g.add(flatbedChas);

            const driverBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5), dynamicCoating);
            driverBox.position.set(0, 0.48, 0.58);
            g.add(driverBox);

            const launchRig = new THREE.Group();
            launchRig.position.set(0, 0.3, -0.3);
            launchRig.name = 'mlrs_barrel';

            const frameworkGirder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 1.2), structuralHull);
            launchRig.add(frameworkGirder);

            for (let k = -2; k <= 2; k++) {
              if (k === 0) continue;
              const rocketB = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8), glowingCore);
              rocketB.rotation.x = Math.PI / 2;
              rocketB.position.set(k*0.18, 0.12, 0.15);
              launchRig.add(rocketB);
            }
            g.add(launchRig);

          } else { // Syndicate
            const organicFlatchNode = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 8), vehicleHull);
            organicFlatchNode.scale.set(1.15, 0.45, 1.7);
            organicFlatchNode.position.y = 0.22;
            g.add(organicFlatchNode);

            const launchRig = new THREE.Group();
            launchRig.position.set(0, 0.45, -0.2);
            launchRig.name = 'mlrs_barrel';

            const venomSporeCat = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), glowingCore);
            venomSporeCat.scale.set(0.7, 0.7, 1.25);
            launchRig.add(venomSporeCat);

            const nozzleH = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.18, 0.65), structuralHull);
            nozzleH.rotation.x = Math.PI/2;
            nozzleH.position.set(0, 0, 0.55);
            launchRig.add(nozzleH);

            g.add(launchRig);
          }

        } else if (ent.subType === 'mobile_jammer') {
          const bodyCabin = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 1.75), vehicleHull);
          bodyCabin.position.y = 0.22;
          g.add(bodyCabin);

          if (faction === 'Alliance') {
            const domeProjector = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), glowingCore);
            domeProjector.position.set(0, 0.66, -0.1);
            g.add(domeProjector);

            const emitterRingS = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 4, 12), glowingCore);
            emitterRingS.rotation.x = Math.PI / 2;
            emitterRingS.position.set(0, 0.7, -0.1);
            emitterRingS.name = 'ew_antenna';
            g.add(emitterRingS);

          } else if (faction === 'Coalition') {
            const postRack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.65), structuralHull);
            postRack.position.set(0, 0.66, -0.15);
            g.add(postRack);

            const rotatingDishGrid = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.25, 8), glowingCore);
            rotatingDishGrid.rotation.z = Math.PI / 3;
            rotatingDishGrid.position.set(0, 0.95, -0.15);
            rotatingDishGrid.name = 'ew_antenna';
            g.add(rotatingDishGrid);

          } else if (faction === 'Union') {
            const mastRack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.12), structuralHull);
            mastRack.position.set(0, 0.65, -0.1);
            g.add(mastRack);

            const loopGridCoilL = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 4, 12), glowingCore);
            loopGridCoilL.rotation.y = Math.PI / 2;
            loopGridCoilL.position.set(-0.25, 0.95, -0.1);
            loopGridCoilL.name = 'ew_antenna';
            g.add(loopGridCoilL);

            const loopGridCoilR = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 4, 12), glowingCore);
            loopGridCoilR.rotation.y = Math.PI / 2;
            loopGridCoilR.position.set(0.25, 0.95, -0.1);
            loopGridCoilR.name = 'ew_antenna';
            g.add(loopGridCoilR);

          } else { // Syndicate
            const driftCrys = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), glowingCore);
            driftCrys.position.set(0, 0.74, -0.1);
            driftCrys.name = 'ew_antenna';
            g.add(driftCrys);

            const protectiveOrbClaws1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 4), structuralHull);
            protectiveOrbClaws1.position.set(0.3, 0.54, 0.1);
            protectiveOrbClaws1.rotation.z = -0.3;
            g.add(protectiveOrbClaws1);

            const protectiveOrbClaws2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 4), structuralHull);
            protectiveOrbClaws2.position.set(-0.3, 0.54, 0.1);
            protectiveOrbClaws2.rotation.z = 0.3;
            g.add(protectiveOrbClaws2);
          }

        } else if (ent.subType === 'builder') {
          // --- FACTION SPECIFIC BUILDER 3D MODEL DESIGNS ---
          if (faction === 'Alliance') {
            // "Внедорожник-Инженер «Авангард»" - Sleek hover rover
            const sleekBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 1.3), vehicleHull);
            sleekBody.position.y = 0.25;
            g.add(sleekBody);

            const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.25, 0.55), glowingCore);
            cabinGlass.position.set(0, 0.45, 0.25);
            g.add(cabinGlass);

            // Hovering side thruster rings
            [[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]].forEach(([sx, sz]) => {
              const ringMat = glowingCore;
              const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 12), ringMat);
              ring.rotation.x = Math.PI / 2;
              ring.position.set(sx, 0.15, sz);
              g.add(ring);
            });

            // Modern vertical hologram laser arm
            const laserPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65), structuralHull);
            laserPost.position.set(0, 0.55, -0.3);
            g.add(laserPost);

            const holoEmitter = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), glowingCore);
            holoEmitter.position.set(0, 0.88, -0.3);
            g.add(holoEmitter);

          } else if (faction === 'Coalition') {
            // "Инженерный Тягач «Долото»" - Heavy duty double-hydraulics tractor
            const heavyChassis = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.5), vehicleHull);
            heavyChassis.position.y = 0.2;
            g.add(heavyChassis);

            const wideCabin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 0.65), structuralHull);
            wideCabin.position.set(0, 0.55, 0.25);
            g.add(wideCabin);

            const orangeVisor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.05), glowingCore);
            orangeVisor.position.set(0, 0.6, 0.58);
            g.add(orangeVisor);

            // Double high-impact hydraulics manipulator claw
            const d1Arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.75), structuralHull);
            d1Arm.rotation.x = -Math.PI / 6;
            d1Arm.position.set(-0.35, 0.55, -0.35);
            g.add(d1Arm);

            const d2Arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.75), structuralHull);
            d2Arm.rotation.x = -Math.PI / 6;
            d2Arm.position.set(0.35, 0.55, -0.35);
            g.add(d2Arm);

            const welderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), glowingCore);
            welderJoint.position.set(0, 0.75, -0.65);
            g.add(welderJoint);

            // Continuous heavy crawlers tracks helper
            for (let side = -1; side <= 1; side += 2) {
              const trackBelt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.35, 1.48), structuralHull);
              trackBelt.position.set(side * 0.58, 0.15, 0);
              g.add(trackBelt);
            }

          } else if (faction === 'Union') {
            // "Строительный Трактор МПС-7" - Classic strong Soviet welding bulldozer
            const frameBaseObj = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.35, 1.4), vehicleHull);
            frameBaseObj.position.y = 0.2;
            g.add(frameBaseObj);

            const backDriverBox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.65), structuralHull);
            backDriverBox.position.set(0, 0.55, -0.2);
            g.add(backDriverBox);

            const yellowShieldWindows = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.05), glowingCore);
            yellowShieldWindows.position.set(0, 0.6, 0.14);
            g.add(yellowShieldWindows);

            // Front high-pressure mechanical scraper bulldozer blade
            const plateScraper = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.45, 0.12), dynamicCoating);
            plateScraper.position.set(0, 0.22, 0.75);
            g.add(plateScraper);

            // Rear mechanical welding crane
            const welderCrane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.65), structuralHull);
            welderCrane.rotation.x = -Math.PI / 3;
            welderCrane.position.set(0.25, 0.65, -0.5);
            g.add(welderCrane);

            const blueWeldingDiode = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), glowingCore);
            blueWeldingDiode.position.set(0.25, 0.9, -0.75);
            g.add(blueWeldingDiode);

            // Sturdy cast iron wheels
            for (let side = -1; side <= 1; side += 2) {
              for (let tIdx = -1.1; tIdx <= 1.1; tIdx += 1.1) {
                const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 6), structuralHull);
                wh.rotation.z = Math.PI / 2;
                wh.position.set(side * 0.54, 0.15, tIdx * 0.48);
                g.add(wh);
              }
            }

          } else {
            // "Нано-Био Формовщик «Прядильщик»" - Floating insectoid multi-claw nanite weaver
            const centralOrganicHead = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), dynamicCoating);
            centralOrganicHead.position.set(0, 0.62, 0);
            g.add(centralOrganicHead);

            const floatingEnergyRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 4, 12), glowingCore);
            floatingEnergyRing.rotation.x = Math.PI / 2;
            floatingEnergyRing.position.set(0, 0.52, 0);
            g.add(floatingEnergyRing);

            const chemicalSacBack = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 6), glowingCore);
            chemicalSacBack.position.set(0, 0.72, -0.32);
            g.add(chemicalSacBack);

            // 4 Bio-mechanical multi-segment crawling legs
            [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].forEach(([lx, lz]) => {
              const legLeg = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 4), structuralHull);
              legLeg.rotation.z = lx > 0 ? 0.3 : -0.3;
              legLeg.rotation.x = lz > 0 ? 0.15 : -0.15;
              legLeg.position.set(lx, 0.28, lz);
              g.add(legLeg);
            });
          }

        } else if (ent.subType === 'harvester') {
          // --- FACTION SPECIFIC HARVESTER 3D MODEL DESIGNS ---
          if (faction === 'Alliance') {
            // "Квантовый Сборщик «Хронос»" - Ultra-modern hover cargo rig with glowing plasma cells
            const mainBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.7), vehicleHull);
            mainBody.position.y = 0.22;
            g.add(mainBody);

            const sleekHoverCapsule = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.4, 0.6), structuralHull);
            sleekHoverCapsule.position.set(0, 0.45, 0.5);
            g.add(sleekHoverCapsule);

            const blueVisorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.05), glowingCore);
            blueVisorGlass.position.set(0, 0.5, 0.81);
            g.add(blueVisorGlass);

            // Dual glowing cylinder quantum capsules for clean resources
            const quantTankL = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 8), glowingCore);
            quantTankL.rotation.x = Math.PI / 2;
            quantTankL.position.set(-0.28, 0.42, -0.35);
            g.add(quantTankL);

            const quantTankR = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 8), glowingCore);
            quantTankR.rotation.x = Math.PI / 2;
            quantTankR.position.set(0.28, 0.42, -0.35);
            g.add(quantTankR);

            // Hover jets
            [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0.6], [0.5, 0.6]].forEach(([hx, hz]) => {
              const hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 4, 10), glowingCore);
              hoverRing.rotation.x = Math.PI / 2;
              hoverRing.position.set(hx, 0.1, hz);
              g.add(hoverRing);
            });

          } else if (faction === 'Coalition') {
            // "Тяжелый Рудовоз «Урал-Э»" - Mega Ural-E dumper with triple massive rubber tires
            const bedBlock = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 2.0), vehicleHull);
            bedBlock.position.y = 0.2;
            g.add(bedBlock);

            const hugeTruckCab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.7), structuralHull);
            hugeTruckCab.position.set(0, 0.55, 0.65);
            g.add(hugeTruckCab);

            const redGlowFilter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.18, 0.05), glowingCore);
            redGlowFilter.position.set(0, 0.6, 1.01);
            g.add(redGlowFilter);

            // Giant heavy duty industrial petroleum silos
            const giantSiloL = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.15, 8), structuralHull);
            giantSiloL.rotation.x = Math.PI / 2;
            giantSiloL.position.set(-0.3, 0.5, -0.25);
            g.add(giantSiloL);

            const giantSiloR = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.15, 8), structuralHull);
            giantSiloR.rotation.x = Math.PI / 2;
            giantSiloR.position.set(0.3, 0.5, -0.25);
            g.add(giantSiloR);

            const warningLightS = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), glowingCore);
            warningLightS.position.set(0, 0.88, 0.65);
            g.add(warningLightS);

            // Triple wheels sets for high payloads
            for (let side = -1; side <= 1; side += 2) {
              for (let wz = -0.7; wz <= 0.7; wz += 0.7) {
                const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.18, 8), structuralHull);
                tire.rotation.z = Math.PI / 2;
                tire.position.set(side * 0.64, 0.12, wz);
                g.add(tire);
              }
            }

          } else if (faction === 'Union') {
            // "Гусеничный Трак ПС-4" - Tracked heavy dumper tank with single large horizontal petroleum pod
            const trackBedUnion = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 1.8), vehicleHull);
            trackBedUnion.position.y = 0.25;
            g.add(trackBedUnion);

            const smallDriverSideCabin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.55), structuralHull);
            smallDriverSideCabin.position.set(-0.25, 0.5, 0.6);
            g.add(smallDriverSideCabin);

            const greenWindowGlow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.05), glowingCore);
            greenWindowGlow.position.set(-0.25, 0.52, 0.88);
            g.add(greenWindowGlow);

            // Single enormous central oil extraction silo cylinder
            const centralHugeContainerTank = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.3), dynamicCoating);
            centralHugeContainerTank.rotation.x = Math.PI / 2;
            centralHugeContainerTank.position.set(0.12, 0.48, -0.22);
            g.add(centralHugeContainerTank);

            // Sturdy dual wide black crawler tracks
            for (let side = -1; side <= 1; side += 2) {
              const crawlerUnion = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 1.7), structuralHull);
              crawlerUnion.position.set(side * 0.56, 0.17, 0);
              g.add(crawlerUnion);
            }

          } else {
            // "Био-Сифон «Токсин-Т6»" - Insectoid spider oil carrier with green chemical fluid abdomen
            const thoraxSaddle = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), structuralHull);
            thoraxSaddle.position.set(0, 0.55, 0.35);
            g.add(thoraxSaddle);

            const toxicGlowBallAbdomen = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 8), glowingCore);
            toxicGlowBallAbdomen.scale.set(0.8, 0.8, 1.3);
            toxicGlowBallAbdomen.position.set(0, 0.45, -0.32);
            g.add(toxicGlowBallAbdomen);

            // Insect biological scanner antenna pins
            const ant1 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4), glowingCore);
            ant1.rotation.set(0.3, 0.3, 0);
            ant1.position.set(0.1, 0.72, 0.52);
            g.add(ant1);

            const ant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4), glowingCore);
            ant2.rotation.set(0.3, -0.3, 0);
            ant2.position.set(-0.1, 0.72, 0.52);
            g.add(ant2);

            // Spider side legs
            [[-0.45, -0.4], [0.45, -0.4], [-0.45, 0.4], [0.45, 0.4]].forEach(([sx, sz]) => {
              const spLeg = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.55, 4), structuralHull);
              spLeg.rotation.z = sx > 0 ? 0.35 : -0.35;
              spLeg.position.set(sx, 0.25, sz);
              g.add(spLeg);
            });
          }
        }
      }

      // Final adjustments (scale to fit game boards perfectly)
      const targetElevation = getTerrainHeight(ent.x, ent.z, map);
      
      const isDrone = ent.type === 'unit' && ent.subType.includes('drone');
      const baseY = isDrone ? 3.0 : targetElevation + 0.05;
      
      g.position.set(ent.x, baseY, ent.z);
      g.rotation.y = ent.angle;
      return g;
    }

    // 6. Projective Selection Decal boxes
    const selectionRingGeom = new THREE.RingGeometry(1.3, 1.45, 16);
    selectionRingGeom.rotateX(-Math.PI / 2); // Lay flat
    selectionRingGeom.translate(0, 0.08, 0);
    const selectionRingMat = new THREE.MeshBasicMaterial({ color: '#22d3ee', side: THREE.DoubleSide });

    const activeSelectionRings: Map<string, THREE.Mesh> = new Map();

    // 7. Click raycasting for node picking, terrain selection, command triggers
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const mouseUpPos = { x: 0, y: 0 };
    const mouseDownPos = { x: 0, y: 0 };
    let isMouseDown = false;
    let selectBoxActive = false;

    // Touch event tracking
    let isTouching = false;
    const touchStartPos = { x: 0, y: 0 };
    const touchLastPos = { x: 0, y: 0 };
    let touchHasDragged = false;

    // Build placement helper bounding cube (colored green if valid placement coordinates)
    const placeBoxGeo = new THREE.BoxGeometry(2.5, 1.2, 2.5);
    const placeBoxMat = new THREE.MeshBasicMaterial({
      color: '#10b981',
      transparent: true,
      opacity: 0.44,
      wireframe: false
    });
    const placeBoxMesh = new THREE.Mesh(placeBoxGeo, placeBoxMat);
    scene.add(placeBoxMesh);

    // Flashing move destination beacon marker
    const beaconGeo = new THREE.CylinderGeometry(0.1, 0.8, 1, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.7 });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.visible = false;
    scene.add(beaconMesh);

    // Glowing impact fire particle swarms list
    const explosionParticles: { mesh: THREE.Mesh; stepY: number; life: number; stepX?: number; stepZ?: number; sizeShrink?: number }[] = [];

    // Active projectiles in flight
    const activeProjectiles: {
      mesh: THREE.Object3D;
      targetId: string;
      damage: number;
      speed: number;
      subType: 'machinegun' | 'shell' | 'rocket' | 'laser';
      x: number;
      y: number;
      z: number;
      color: string;
      life: number; // For max lifetime, distance checking limit
      startX: number;
      startZ: number;
      distanceTotal: number;
      ownerId: string;
    }[] = [];

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only trigger for left-clicks
      isMouseDown = true;
      mouseDownPos.x = e.clientX;
      mouseDownPos.y = e.clientY;
    };

    const handleMouseMoveSelection = (e: MouseEvent) => {
      if (!isMouseDown) return;
      const deltaX = Math.abs(e.clientX - mouseDownPos.x);
      const deltaY = Math.abs(e.clientY - mouseDownPos.y);
      if (deltaX >= 6 || deltaY >= 6) {
        setDragSelection({
          x1: mouseDownPos.x,
          y1: mouseDownPos.y,
          x2: e.clientX,
          y2: e.clientY
        });
      } else {
        setDragSelection(null);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        // --- LEFT CLICK RELEASE (Selection block) ---
        isMouseDown = false;
        setDragSelection(null);
        mouseUpPos.x = e.clientX;
        mouseUpPos.y = e.clientY;

        const deltaX = Math.abs(mouseUpPos.x - mouseDownPos.x);
        const deltaY = Math.abs(mouseUpPos.y - mouseDownPos.y);

        if (deltaX < 6 && deltaY < 6) {
          // Simple click selection
          const bounds = renderer.domElement.getBoundingClientRect();
          mouse.x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
          mouse.y = -((e.clientY - bounds.top) / bounds.height) * 2 + 1;

          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObject(terrainMesh);

          if (intersects.length > 0) {
            const pt = intersects[0].point;
            const mapX = Math.round(pt.x);
            const mapZ = Math.round(pt.z);

            // If currently planning to place a building structure
            if (sim.buildingToPlace) {
              triggerConstructionAction(sim.buildingToPlace, mapX, mapZ);
              return;
            }

            // If currently planning to trigger a Commander Strike power
            if (sim.commandStrikeActive) {
              triggerCommandStrikeAction(mapX, mapZ);
              return;
            }

            // Select player entities underneath cursor
            const hitEntity = findEntityAt(pt.x, pt.z, 2.0);
            if (hitEntity && hitEntity.playerId === playerId) {
              sim.selectedIds = [hitEntity.id];
              sound.playSelect();
            } else {
              sim.selectedIds = []; // clicked plain terrain
            }
          }
        } else {
          // Multi-Selecting Box sweep finished
          handleDragSelection(mouseDownPos, mouseUpPos);
        }
      } else if (e.button === 2) {
        // --- RIGHT CLICK RELEASE (Command & Cancel block) ---
        e.preventDefault();

        // 1. Right click cancels active placement state or airstrike state
        if (sim.buildingToPlace) {
          sim.buildingToPlace = null;
          setBuildingToPlace(null);
          pushNotification('Строительство отменено', 'info');
          sound.playClick();
          return;
        }
        if (sim.commandStrikeActive) {
          sim.commandStrikeActive = false;
          setCommandStrikeActive(false);
          pushNotification('Удар супероружием отменен', 'info');
          sound.playClick();
          return;
        }

        // 2. Issue movement or combat strikes
        const bounds = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
        mouse.y = -((e.clientY - bounds.top) / bounds.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(terrainMesh);

        if (intersects.length > 0) {
          const pt = intersects[0].point;

          if (sim.selectedIds.length > 0) {
            const clickedTarget = findEntityAt(pt.x, pt.z, 2.0);
            if (clickedTarget && clickedTarget.playerId !== playerId) {
              // Ordering attack
              triggerAttackAction(sim.selectedIds, clickedTarget.id, clickedTarget.type);
            } else {
              // Ordering movement
              triggerMovementAction(sim.selectedIds, pt.x, pt.z);

              // Show flashing destination beacon momentarily
              const beaconElev = getTerrainHeight(pt.x, pt.z, map);
              beaconMesh.position.set(pt.x, beaconElev + 0.15, pt.z);
              beaconMesh.visible = true;
              setTimeout(() => { beaconMesh.visible = false; }, 850);
            }
          }
        }
      }
    };

    // Find nearest game entity by radius query
    function findEntityAt(rx: number, rz: number, radius = 1.5): GameEntity | null {
      let nearest: GameEntity | null = null;
      let minDistSq = radius * radius;

      sim.entities.forEach(ent => {
        if (ent.state === 'dead') return;
        const dx = ent.x - rx;
        const dz = ent.z - rz;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          nearest = ent;
        }
      });
      return nearest;
    }

    // Direct multi-unit drag bounding box selector
    function handleDragSelection(pDown: { x: number; y: number }, pUp: { x: number; y: number }) {
      const bounds = renderer.domElement.getBoundingClientRect();
      // Calculate viewport rectangle corners
      const x1 = Math.min(pDown.x, pUp.x) - bounds.left;
      const x2 = Math.max(pDown.x, pUp.x) - bounds.left;
      const y1 = Math.min(pDown.y, pUp.y) - bounds.top;
      const y2 = Math.max(pDown.y, pUp.y) - bounds.top;

      const selectedIdsList: string[] = [];
      
      sim.entities.forEach(ent => {
        // Only select self units
        if (ent.playerId !== playerId || ent.type !== 'unit' || ent.state === 'dead') return;

        // project 3D coordinate to screen pixels
        const vec = new THREE.Vector3(ent.x, 0.4, ent.z);
        vec.project(camera);

        const sx = ((vec.x + 1) * bounds.width) / 2;
        const sy = ((-vec.y + 1) * bounds.height) / 2;

        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
          selectedIdsList.push(ent.id);
        }
      });

      sim.selectedIds = selectedIdsList;
      if (selectedIdsList.length > 0) {
        sound.playSelect();
      }
    }

    // Order constructions
    function triggerConstructionAction(bType: BuildingType, x: number, z: number) {
      const bProps = getBuildingProps(bType, playerId, sim.players);
      const cost = bProps.cost;
      if (sim.credits < cost) {
        pushNotification('Недостаточно средств для развертывания строения!', 'warn');
        sim.buildingToPlace = null;
        setBuildingToPlace(null);
        return;
      }

      // Check alignment of nearest strategic oil wells for resource snap zone:
      let snappedSpot = null;
      let minSpotDist = 4.5; // Highly generous snapping radius
      if (map && map.resourceSpots) {
        map.resourceSpots.forEach(spot => {
          const d = Math.sqrt((spot.x - x)*(spot.x - x) + (spot.z - z)*(spot.z - z));
          if (d < minSpotDist) {
            minSpotDist = d;
            snappedSpot = spot;
          }
        });
      }

      // Snap coordinates if near a strategic well zone
      let targetX = x;
      let targetZ = z;
      if (snappedSpot) {
        targetX = snappedSpot.x;
        targetZ = snappedSpot.z;
      }

      // Check if location is clear of rivers/hills or other buildings
      if (map.nodes[targetX] === undefined || map.nodes[targetX][targetZ] === undefined) return;
      const node = map.nodes[targetX][targetZ];
      
      let blockedVal = false;
      // Generously bypass water bodies and hill height clamps if building on a snapped resource location!
      if (!snappedSpot && (node.type === 'water' || node.height > 1)) {
        blockedVal = true;
      }
      
      // Can't place refinery over blank ground unless there is a valid resource spot snapped!
      if (bType === 'supply_refinery') {
        if (snappedSpot) {
          node.resourceSpot = true;
        } else {
          pushNotification('Центры снабжения (Нефтезаводы) можно строить только непосредственно на нефтяных скважинах (желтые вышки)!', 'warn');
          sim.buildingToPlace = null;
          setBuildingToPlace(null);
          return;
        }
      }

      const buildingId = `b_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // Check structural intersections
      sim.entities.forEach(ent => {
        if (ent.state === 'dead' || ent.id === buildingId) return;
        const dx = Math.abs(ent.x - targetX);
        const dz = Math.abs(ent.z - targetZ);
        if (ent.type === 'building' && dx < 3.0 && dz < 3.0) {
          if (ent.state !== 'dead') {
            blockedVal = true;
          }
        }
      });

      if (blockedVal) {
        pushNotification('Эта зона занята или заблокирована ландшафтом!', 'warn');
        return;
      }

      const pObj: GameActionEvent = {
        event: 'build',
        buildingType: bType,
        x: targetX,
        z: targetZ,
        id: buildingId
      };

      // Apply locally instantly
      sim.credits -= cost;
      setCredits(sim.credits);
      sound.playSpatial('playConstruction', targetX, targetZ);

      sim.entities.push({
        id: buildingId,
        type: 'building',
        subType: bType,
        playerId,
        team: selfPlayer.team,
        health: bProps.hp,
        maxHealth: bProps.hp,
        x: targetX,
        z: targetZ,
        angle: 0,
        state: 'constructing',
        buildProgress: 0.05
      });

      // Automatically task selected or closest friendly Builder units to go construct it
      const selectedBuilders = sim.entities.filter(ent => 
        sim.selectedIds.includes(ent.id) && 
        ent.playerId === playerId && 
        ent.subType === 'builder' && 
        ent.state !== 'dead'
      );
      if (selectedBuilders.length > 0) {
        selectedBuilders.forEach(b => {
          b.state = 'moving';
          // Move slightly spaced from center
          b.targetX = targetX + (Math.random() - 0.5) * 1.5;
          b.targetZ = targetZ + (Math.random() - 0.5) * 1.5;
        });
        pushNotification(`Юнитам-строителям отправлены координаты объекта!`, 'info');
      } else {
        const anyBuilders = sim.entities.filter(ent => 
          ent.playerId === playerId && 
          ent.subType === 'builder' && 
          ent.state !== 'dead'
        );
        if (anyBuilders.length > 0) {
          let closestB = anyBuilders[0];
          let minDistSq = 999999;
          anyBuilders.forEach(b => {
            const dSq = (b.x - targetX)*(b.x - targetX) + (b.z - targetZ)*(b.z - targetZ);
            if (dSq < minDistSq) {
              minDistSq = dSq;
              closestB = b;
            }
          });
          closestB.state = 'moving';
          closestB.targetX = targetX + (Math.random() - 0.5) * 1.5;
          closestB.targetZ = targetZ + (Math.random() - 0.5) * 1.5;
          pushNotification(`Ближайший строительный комплекс выдвигается на стройплощадку!`, 'info');
        } else {
          pushNotification(`Внимание: Нет свободных Строителей! Закажите инженера в Штабе Командования.`, 'warn');
        }
      }

      // Relay actions through Websockets
      sendSocketAction(pObj);

      sim.buildingToPlace = null;
      setBuildingToPlace(null);
    }

    // Trigger precise orbital missile strikes
    function triggerCommandStrikeAction(x: number, z: number) {
      if (sim.commandCharge < 100) {
        pushNotification('Commander tactical powers are currently charging.', 'warn');
        return;
      }

      const pObj: GameActionEvent = {
        event: 'command_strike',
        strikeType: selfPlayer.faction === 'Alliance' ? 'kinetic' : selfPlayer.faction === 'Coalition' ? 'emp' : selfPlayer.faction === 'Union' ? 'thermobaric' : 'chemical',
        x,
        z
      };

      // Discharge points
      sim.commandCharge = 0;
      setCommandCharge(0);
      sound.playSpatial('playLaunch', x, z);

      // Trigger effects instantly locally
      executeVisualAirstrike(pObj.strikeType, x, z);
      sendSocketAction(pObj);

      sim.commandStrikeActive = false;
      setCommandStrikeActive(false);
    }

    // Push local units movement
    function triggerMovementAction(ids: string[], tx: number, tz: number) {
      sound.playOrder();
      const pObj: GameActionEvent = {
        event: 'move_units',
        unitIds: ids,
        targetX: tx,
        targetZ: tz
      };

      // Apply order locally
      sim.entities.forEach(ent => {
        if (ids.includes(ent.id)) {
          ent.state = 'moving';
          ent.targetX = tx;
          ent.targetZ = tz;
          ent.targetId = undefined; // override attack target
        }
      });

      sendSocketAction(pObj);
    }

    // Push Local Combat targeting
    function triggerAttackAction(ids: string[], targetId: string, targetType: 'unit' | 'building') {
      sound.playOrder();
      const pObj: GameActionEvent = {
        event: 'attack_target',
        unitIds: ids,
        targetId,
        targetType
      };

      // Set combat targets
      sim.entities.forEach(ent => {
        if (ids.includes(ent.id)) {
          ent.state = 'attacking';
          ent.targetId = targetId;
          ent.targetType = targetType;
        }
      });

      sendSocketAction(pObj);
    }

    // Core combat strike execution math
    function executeVisualAirstrike(type: string, x: number, z: number) {
      pushNotification(`Commander deployed ${type.toUpperCase()} strike coordinates!`, 'success');

      const baseElev = getTerrainHeight(x, z, simulationRef.current.map!);
      
      // Create amazing 3D light flare and sound rumble procedural impact!
      const beaconLight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 3.5, 12, 16),
        new THREE.MeshBasicMaterial({ color: type === 'emp' ? '#06b6d4' : type === 'thermobaric' ? '#ef4444' : type === 'chemical' ? '#a3e635' : '#fbbf24', transparent: true, opacity: 0.6 })
      );
      beaconLight.position.set(x, baseElev + 6, z);
      scene.add(beaconLight);

      sound.playSpatial('playExplosion', x, z);

      // Spawn drifting fire particles
      for (let i = 0; i < 35; i++) {
        const rad = Math.random() * 3;
        const theta = Math.random() * 2 * Math.PI;
        const px = x + Math.cos(theta) * rad;
        const pz = z + Math.sin(theta) * rad;

        const pMesh = new THREE.Mesh(
          new THREE.SphereGeometry(Math.random() * 0.4 + 0.15, 6, 6),
          new THREE.MeshBasicMaterial({ color: type === 'emp' ? '#22d3ee' : type === 'thermobaric' ? '#f97316' : type === 'chemical' ? '#84cc16' : '#f59e0b', transparent: true, opacity: 0.85 })
        );
        pMesh.position.set(px, baseElev + 0.1, pz);
        scene.add(pMesh);
        explosionParticles.push({
          mesh: pMesh,
          stepY: Math.random() * 0.08 + 0.03,
          life: 1.0
        });
      }

      // Shake camera slightly
      const origX = sim.camX;
      sim.camX += (Math.random() - 0.5) * 1.5;
      setTimeout(() => {
        sim.camX = origX;
        scene.remove(beaconLight);
      }, 500);

      // Apply heavy area of effect damages securely to hostiles
      const maxRadius = type === 'emp' ? 8.0 : 5.05;
      sim.entities.forEach(ent => {
        if (ent.state === 'dead') return;
        const dist = Math.sqrt((ent.x - x) * (ent.x - x) + (ent.z - z) * (ent.z - z));
        if (dist <= maxRadius) {
          // If on same team, shield from friendly damage unless FFA
          if (ent.team !== selfPlayer.team) {
            if (type === 'emp') {
              // Lock target states
              ent.cooldown = 400; // frozen
              ent.state = 'idle';
              pushNotification(`Locked structure network systems inside blast grid!`, 'info');
            } else {
              const damage = type === 'kinetic' ? 380 : type === 'thermobaric' ? 240 : 150;
              ent.health -= damage;
              if (ent.health <= 0) {
                ent.health = 0;
                ent.state = 'dead';
                pushNotification(`Meltdown confirmed on hostile structures!`, 'info');
              }
            }
          }
        }
      });
    }

    // Physical explosion wreckage / debris, shockwave and fire particles
    function spawnPhysicalExplosionWreckage(x: number, z: number, sizeFactor: number = 1.0) {
      if (!map) return;
      const baseElev = getTerrainHeight(x, z, map);

      // 1. Spawning dynamic expanding shockwave ring flat on the ground
      const ringGeo = new THREE.RingGeometry(0.1, 0.45, 16);
      const ringMat = new THREE.MeshBasicMaterial({ 
        color: '#ffffff', 
        side: THREE.DoubleSide, 
        transparent: true, 
        opacity: 0.855 
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.set(x, baseElev + 0.08, z);
      scene.add(ringMesh);

      explosionParticles.push({
        mesh: ringMesh,
        stepY: 0,
        life: 0.8,
        isRing: true,
        sizeShrink: 1.05
      } as any);

      // 2. Spawning tumbling physical wreckage / debris pieces falling to ground
      const fragmentMat = new THREE.MeshStandardMaterial({ 
        color: '#4b5563', 
        metalness: 0.8, 
        roughness: 0.3 
      });

      const piecesCount = Math.floor(Math.random() * 3) + 3;
      for (let k = 0; k < piecesCount; k++) {
        const pieceGeo = new THREE.BoxGeometry(0.18 * sizeFactor, 0.12 * sizeFactor, 0.18 * sizeFactor);
        const pieceMesh = new THREE.Mesh(pieceGeo, fragmentMat);
        pieceMesh.position.set(
          x + (Math.random() - 0.5) * 0.4, 
          baseElev + 0.2, 
          z + (Math.random() - 0.5) * 0.4
        );
        scene.add(pieceMesh);

        explosionParticles.push({
          mesh: pieceMesh,
          stepX: (Math.random() - 0.5) * 0.12,
          stepY: Math.random() * 0.12 + 0.08,
          stepZ: (Math.random() - 0.5) * 0.12,
          life: 1.2,
          hasGravity: true,
          rotX: (Math.random() - 0.5) * 0.15,
          rotY: (Math.random() - 0.5) * 0.15,
        } as any);
      }

      // 3. Spawning fiery explosion flashes
      for (let j = 0; j < 6; j++) {
        const fireMesh = new THREE.Mesh(
          new THREE.SphereGeometry(Math.random() * 0.35 + 0.15, 6, 6),
          new THREE.MeshBasicMaterial({ color: '#f97316', transparent: true, opacity: 0.9 })
        );
        fireMesh.position.set(
          x + (Math.random() - 0.5) * 0.3,
          baseElev + 0.2,
          z + (Math.random() - 0.5) * 0.3
        );
        scene.add(fireMesh);
        explosionParticles.push({
          mesh: fireMesh,
          stepX: (Math.random() - 0.5) * 0.04,
          stepY: Math.random() * 0.06 + 0.02,
          stepZ: (Math.random() - 0.5) * 0.04,
          life: 0.6,
          sizeShrink: 0.9
        });
      }
    }

    // Handles inbound Websocket notifications safely
    function handleSocketMessage(e: MessageEvent) {
      try {
        const data = JSON.parse(e.data);
        
        if (data.type === 'game_action') {
          const authorId = data.playerId;
          const act: GameActionEvent = data.action;

          if (act.event === 'build') {
            sound.playSpatial('playConstruction', act.x, act.z);
            const bProps = getBuildingProps(act.buildingType, authorId, sim.players);
            sim.entities.push({
              id: act.id,
              type: 'building',
              subType: act.buildingType,
              playerId: authorId,
              team: getPlayerTeam(authorId),
              health: bProps.hp,
              maxHealth: bProps.hp,
              x: act.x,
              z: act.z,
              angle: 0,
              state: 'constructing',
              buildProgress: 0.05
            });
          }

          else if (act.event === 'produce_unit') {
            sound.playClick();
            // Spawns unit near war factory/barracks gates
            const factory = sim.entities.find(e => e.id === act.factoryId);
            const fx = factory ? factory.x : map.size / 2;
            const fz = factory ? factory.z + 2 : map.size / 2;

            const uProps = getUnitProps(act.unitType, authorId, sim.players);
            sim.entities.push({
              id: act.id,
              type: 'unit',
              subType: act.unitType,
              playerId: authorId,
              team: getPlayerTeam(authorId),
              health: uProps.hp,
              maxHealth: uProps.hp,
              x: fx,
              z: fz,
              angle: Math.PI,
              state: 'idle'
            });
          }

          else if (act.event === 'move_units') {
            sim.entities.forEach(ent => {
              if (act.unitIds.includes(ent.id)) {
                ent.state = 'moving';
                ent.targetX = act.targetX;
                ent.targetZ = act.targetZ;
                ent.targetId = undefined;
              }
            });
          }

          else if (act.event === 'attack_target') {
            sim.entities.forEach(ent => {
              if (act.unitIds.includes(ent.id)) {
                ent.state = 'attacking';
                ent.targetId = act.targetId;
                ent.targetType = act.targetType;
              }
            });
          }

          else if (act.event === 'command_strike') {
            executeVisualAirstrike(act.strikeType, act.x, act.z);
          }
        }
      } catch (err) {
        console.error('Error handling sync operations:', err);
      }
    }

    function getPlayerTeam(pId: string): number {
      const p = sim.players.find(x => x.id === pId);
      return p ? p.team : 1;
    }

    if (socketRef.current) {
      socketRef.current.addEventListener('message', handleSocketMessage);
    }

    function sendSocketAction(action: GameActionEvent) {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'sync_action',
          action
        }));
      }
    }

    // Hook WebGL window resizing gracefully
    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    // Entering/leaving fullscreen or rotating fires before layout settles —
    // recompute on the next frame so clientWidth/Height are final.
    const deferredResize = () => requestAnimationFrame(() => requestAnimationFrame(handleResize));
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', deferredResize);
    window.addEventListener('orientationchange', deferredResize);

    // Touch event implementations
    let lastTouchEndTime = 0;
    const lastTouchEndPos = { x: 0, y: 0 };
    let isDoubleTapHolding = false;
    const doubleTapStartPos = { x: 0, y: 0 };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      isTouching = true;

      const clickX = e.touches[0].clientX;
      const clickY = e.touches[0].clientY;

      touchStartPos.x = clickX;
      touchStartPos.y = clickY;
      touchLastPos.x = clickX;
      touchLastPos.y = clickY;
      touchHasDragged = false;

      const now = Date.now();
      const timeDiff = now - lastTouchEndTime;
      const dist = Math.sqrt(
        (clickX - lastTouchEndPos.x) * (clickX - lastTouchEndPos.x) +
        (clickY - lastTouchEndPos.y) * (clickY - lastTouchEndPos.y)
      );

      // Identify second tap of double-tap starting within 300ms and close to first tap
      if (timeDiff < 300 && dist < 40) {
        isDoubleTapHolding = true;
        doubleTapStartPos.x = clickX;
        doubleTapStartPos.y = clickY;
      } else {
        isDoubleTapHolding = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTouching || e.touches.length === 0) return;
      const currentTouchX = e.touches[0].clientX;
      const currentTouchY = e.touches[0].clientY;

      const dragDist = Math.sqrt(
        (currentTouchX - touchStartPos.x) * (currentTouchX - touchStartPos.x) +
        (currentTouchY - touchStartPos.y) * (currentTouchY - touchStartPos.y)
      );
      if (dragDist > 10) {
        touchHasDragged = true;
      }

      const deltaX = currentTouchX - touchLastPos.x;
      const deltaY = currentTouchY - touchLastPos.y;

      touchLastPos.x = currentTouchX;
      touchLastPos.y = currentTouchY;

      if (isDoubleTapHolding) {
        // Dragging selection box
        setDragSelection({
          x1: doubleTapStartPos.x,
          y1: doubleTapStartPos.y,
          x2: currentTouchX,
          y2: currentTouchY
        });
      } else {
        // Scrolling camera around map
        const sim = simulationRef.current;
        if (sim) {
          const cosRot = Math.cos(sim.camRotation);
          const sinRot = Math.sin(sim.camRotation);
          const factor = 0.05 * (sim.camZoom / 18);

          sim.camX += (cosRot * deltaX + sinRot * deltaY) * factor;
          sim.camZ -= (sinRot * deltaX - cosRot * deltaY) * factor;

          if (sim.map) {
            sim.camX = Math.max(0, Math.min(sim.map.size, sim.camX));
            sim.camZ = Math.max(0, Math.min(sim.map.size, sim.camZ));
          }
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      isTouching = false;
      const now = Date.now();
      const bounds = renderer.domElement.getBoundingClientRect();

      if (isDoubleTapHolding) {
        isDoubleTapHolding = false;
        setDragSelection(null);

        if (touchHasDragged) {
          // Drag selection box finished
          handleDragSelection(doubleTapStartPos, touchLastPos);
        } else {
          // Double-tap on unit/building -> Select it!
          mouse.x = ((touchStartPos.x - bounds.left) / bounds.width) * 2 - 1;
          mouse.y = -((touchStartPos.y - bounds.top) / bounds.height) * 2 + 1;

          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObject(terrainMesh);

          if (intersects.length > 0) {
            const pt = intersects[0].point;
            const hitEntity = findEntityAt(pt.x, pt.z, 2.5);
            const sim = simulationRef.current;
            if (sim) {
              if (hitEntity && hitEntity.playerId === playerId) {
                sim.selectedIds = [hitEntity.id];
                sound.playSelect();
              } else {
                sim.selectedIds = [];
              }
            }
          }
        }
      } else {
        // Single tap -> Action Order or placing building/power
        if (!touchHasDragged) {
          mouse.x = ((touchStartPos.x - bounds.left) / bounds.width) * 2 - 1;
          mouse.y = -((touchStartPos.y - bounds.top) / bounds.height) * 2 + 1;

          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObject(terrainMesh);

          if (intersects.length > 0) {
            const pt = intersects[0].point;
            const mapX = Math.round(pt.x);
            const mapZ = Math.round(pt.z);

            const sim = simulationRef.current;
            if (sim) {
              if (sim.buildingToPlace) {
                triggerConstructionAction(sim.buildingToPlace, mapX, mapZ);
                setIsMenuCollapsed(true);
              } else if (sim.commandStrikeActive) {
                triggerCommandStrikeAction(mapX, mapZ);
                setIsMenuCollapsed(true);
              } else if (sim.selectedIds.length > 0) {
                const clickedTarget = findEntityAt(pt.x, pt.z, 2.5);
                if (clickedTarget && clickedTarget.playerId !== playerId) {
                  // Attack order
                  triggerAttackAction(sim.selectedIds, clickedTarget.id, clickedTarget.type);
                  setIsMenuCollapsed(true);
                } else {
                  // Move order
                  triggerMovementAction(sim.selectedIds, pt.x, pt.z);

                  const beaconElev = getTerrainHeight(pt.x, pt.z, map);
                  beaconMesh.position.set(pt.x, beaconElev + 0.15, pt.z);
                  beaconMesh.visible = true;
                  setTimeout(() => { beaconMesh.visible = false; }, 850);
                  setIsMenuCollapsed(true);
                }
              } else {
                // Nothing selected and no active mode: a single tap on one of our
                // own units or buildings selects it (so opening the build menu on
                // a phone is just one tap, not a double-tap).
                const tapped = findEntityAt(pt.x, pt.z, 2.5);
                if (tapped && tapped.playerId === playerId) {
                  sim.selectedIds = [tapped.id];
                  sound.playSelect();
                }
              }
            }
          }
        }
      }

      lastTouchEndTime = now;
      lastTouchEndPos.x = touchStartPos.x;
      lastTouchEndPos.y = touchStartPos.y;
    };

    const canvasDom = renderer.domElement;
    canvasDom.addEventListener('mousedown', handleMouseDown);
    canvasDom.addEventListener('mousemove', handleMouseMoveSelection);
    canvasDom.addEventListener('mouseup', handleMouseUp);
    canvasDom.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvasDom.addEventListener('touchmove', handleTouchMove, { passive: true });
    canvasDom.addEventListener('touchend', handleTouchEnd);
    canvasDom.addEventListener('contextmenu', (e) => e.preventDefault()); // Stop native popup right clicks

    // 8. Main Animation Frame & RTS Simulation Tick loop
    let animationId: number;
    let tickCount = 0;

    // AI simulation scheduler runs once every ~3 seconds offline
    let lastAiTick = 0;

    // Reusable weapon discharge. Spawns the correct projectile (or detonates a
    // kamikaze drone) at `victim`, applies the unit's reload cooldown and plays
    // the faction firing sound. Caller guarantees: victim alive, target within
    // weapon range, cooldown ready, the firing unit is not jammed and actually
    // carries a weapon. Used both when a unit is statically attacking AND when
    // it fires opportunistically while driving to a move order.
    const fireUnitWeapon = (ent: GameEntity, victim: GameEntity, mesh: THREE.Object3D, dist: number) => {
      const props = getUnitProps(ent.subType as UnitType, ent.playerId, sim.players);
      const angleVal = Math.atan2(victim.z - ent.z, victim.x - ent.x);
      ent.cooldown = 45; // default reload, overridden per chassis below

      if (ent.subType === 'drone_kamikaze') {
        ent.health = 0; // dies upon collision!
        ent.state = 'dead';
        sound.playSpatial('playExplosion', ent.x, ent.z);
        victim.health -= props.dps;
        if (victim.health <= 0) {
          victim.health = 0;
          victim.state = 'dead';
          pushNotification(`Meltdown on targeted enemy structural frame!`, 'warn');
        }
        return;
      }

      const owner = sim.players.find(p => p.id === ent.playerId) || selfPlayer;
      let pType: 'machinegun' | 'shell' | 'rocket' | 'laser' = 'machinegun';
      let pColor = owner.color;
      let pSpeed = 0.5;

      if (ent.subType === 'precision_tank') {
        pType = 'shell';
        pColor = '#f59e0b';
        pSpeed = 0.8;
      } else if (ent.subType === 'artillery_mlrs') {
        pType = 'rocket';
        pColor = '#eab308';
        pSpeed = 0.3;
        ent.cooldown = 65;
      } else if (ent.subType === 'cyber_specops' || ent.subType === 'drone_scout') {
        pType = 'machinegun';
        pColor = '#38bdf8';
        pSpeed = 0.75;
        ent.cooldown = 15;
      }

      const pMesh = new THREE.Object3D();
      if (pType === 'shell') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 4), new THREE.MeshBasicMaterial({ color: pColor }));
        m.rotation.x = Math.PI / 2;
        pMesh.add(m);
      } else if (pType === 'rocket') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#4b5563' }));
        m.rotation.x = Math.PI / 2;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), new THREE.MeshStandardMaterial({ color: '#f59e0b' }));
        tip.position.z = 0.4;
        tip.rotation.x = Math.PI / 2;
        const fire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.01, 0.3, 4), new THREE.MeshBasicMaterial({ color: pColor }));
        fire.position.z = -0.4;
        fire.rotation.x = Math.PI / 2;
        pMesh.add(m);
        pMesh.add(tip);
        pMesh.add(fire);
      } else {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.4), new THREE.MeshBasicMaterial({ color: pColor }));
        pMesh.add(m);
      }

      const startHeight = mesh.position.y + (ent.subType === 'precision_tank' ? 0.3 : 0.1);

      const flash = new THREE.Mesh(new THREE.SphereGeometry(Math.random()*0.15 + 0.1, 4, 4), new THREE.MeshBasicMaterial({ color: pColor }));
      flash.position.set(ent.x + Math.cos(angleVal)*0.5, startHeight, ent.z + Math.sin(angleVal)*0.5);
      scene.add(flash);
      explosionParticles.push({ mesh: flash, stepY: 0, life: 0.1, sizeShrink: 0.8 });

      pMesh.position.set(ent.x, startHeight, ent.z);
      pMesh.lookAt(victim.x, startHeight, victim.z);
      scene.add(pMesh);

      activeProjectiles.push({
        mesh: pMesh,
        targetId: victim.id,
        damage: pType === 'machinegun' ? props.dps / (45/15) : (pType === 'rocket' ? props.dps * 1.5 : props.dps),
        speed: pSpeed,
        subType: pType,
        x: ent.x,
        y: startHeight,
        z: ent.z,
        color: pColor,
        life: 0,
        startX: ent.x,
        startZ: ent.z,
        distanceTotal: dist,
        ownerId: owner.id
      });

      const entFaction = getFaction(ent.playerId, sim.players);
      if (entFaction === 'Alliance') sound.playSpatial('playAllianceZap', ent.x, ent.z);
      else if (entFaction === 'Coalition') sound.playSpatial('playCoalitionBoom', ent.x, ent.z);
      else if (entFaction === 'Union') sound.playSpatial('playUnionTesla', ent.x, ent.z);
      else sound.playSpatial('playSyndicateAcid', ent.x, ent.z);
    };

    // True when the unit has an offensive weapon (builders / jammers / harvesters
    // carry none, so they must never auto-engage or stop to "fire").
    const hasWeapon = (ent: GameEntity): boolean => {
      const p = getUnitProps(ent.subType as UnitType, ent.playerId, sim.players);
      return p.range > 0 && p.dps > 0;
    };

    // Finds the closest hostile to `ent` within `radius` world units (respects
    // Mobile Jammer cloaking just like the manual/idle target acquisition).
    const findHostileInRange = (ent: GameEntity, radius: number): GameEntity | null => {
      let best: GameEntity | null = null;
      let bestDist = radius;
      for (const v of sim.entities) {
        if (v.state === 'dead' || v.team === ent.team) continue;
        const dx = v.x - ent.x, dz = v.z - ent.z;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d >= bestDist) continue;
        const isTargetCloaked = v.type === 'unit' && v.subType !== 'mobile_jammer' && sim.entities.some(j =>
          j.state !== 'dead' && j.subType === 'mobile_jammer' && j.playerId === v.playerId &&
          Math.sqrt((j.x - v.x)*(j.x - v.x) + (j.z - v.z)*(j.z - v.z)) < 8.0
        );
        if (isTargetCloaked && d > 2.8) continue;
        bestDist = d;
        best = v;
      }
      return best;
    };

    const gameLoop = () => {
      animationId = requestAnimationFrame(gameLoop);
      tickCount++;

      // a. Synthesize camera matrix positions smoothly
      camera.position.set(
        sim.camX - Math.sin(sim.camRotation) * sim.camZoom,
        sim.camZoom,
        sim.camZ - Math.cos(sim.camRotation) * sim.camZoom
      );
      camera.lookAt(new THREE.Vector3(sim.camX, 0, sim.camZ));

      // a2. Move the 3D audio listener to the centre of the current view.
      // viewRadius scales with zoom (higher camera = more ground visible), so
      // sounds inside the frame stay loud and those off-screen fade out fast.
      sound.setListener(sim.camX, sim.camZ, sim.camZoom * 0.95, sim.camRotation);

      // a3. Refresh fog of war a few times a second (not every frame — vision
      // changes slowly and the grid sweep is the fog's only heavy work).
      if (tickCount % 12 === 0) {
        refreshFog();
        // Neutral scenery & resource rigs only appear once explored.
        decoGroups.forEach(d => { d.group.visible = isExploredAt(d.x, d.z); });
        resourceGeoms.forEach(rig => {
          rig.visible = isExploredAt(rig.position.x, rig.position.z);
        });
      }

      // b. Sync resource rig visual animations
      resourceGeoms.forEach(rig => {
        const pArm = rig.getObjectByName('pump_arm');
        if (pArm) {
          pArm.rotation.z = Math.sin(tickCount * 0.05) * 0.25;
        }
        const beam = rig.getObjectByName('radar_dish');
        if (beam) {
          beam.rotation.y += 0.02;
        }
      });

      // c. Power generated vs Power Required recalculations
      let cacheGen = 30; // base CC generator
      let cacheReq = 0;
      let userCoreCcDead = true;

      // d. Unit movement physics, combat collisions, structure additions
      sim.entities.forEach(ent => {
        if (ent.state === 'dead') {
          // Remove from mesh scenes
          const mesh = entityMeshes.get(ent.id);
          if (mesh) {
            spawnPhysicalExplosionWreckage(ent.x, ent.z, ent.type === 'building' ? 2.5 : 1.0);
            scene.remove(mesh);
            entityMeshes.delete(ent.id);
          }
          return;
        }

        // Automatic continuous ground flattening under newly deployed buildings
        if (ent.type === 'building' && !flattenedBuildingIds.has(ent.id)) {
          flattenedBuildingIds.add(ent.id);
          const radius = ent.subType === 'command_center' ? 3 : 2;
          flattenTerrainForBuilding(ent.x, ent.z, radius);
        }

        // Global cooldown tick decrement! Corrects lock conditions and EMP duration.
        if (ent.cooldown && ent.cooldown > 0) {
          ent.cooldown -= 1;
        }

        // Keep track of power variables
        if (ent.playerId === playerId) {
          if (ent.type === 'building' && ent.buildProgress && ent.buildProgress >= 1) {
            const props = getBuildingProps(ent.subType as BuildingType, ent.playerId, sim.players);
            if (props.power > 0) cacheGen += props.power;
            else cacheReq += Math.abs(props.power);

            if (ent.subType === 'command_center') userCoreCcDead = false;
          }
        }

        // Check if visual mesh elements exists, if not build item models!
        let mesh = entityMeshes.get(ent.id);
        if (!mesh) {
          const owner = sim.players.find(p => p.id === ent.playerId) || selfPlayer;
          mesh = constructModel(ent, owner.color);
          scene.add(mesh);
          entityMeshes.set(ent.id, mesh);
        }

        // Soft separation push logic for active physical vehicles / infantry
        const isDrone = ent.type === 'unit' && ent.subType.includes('drone');
        if (ent.type === 'unit' && ent.state !== 'dead' && ent.state !== 'garrisoned' && !isDrone) {
          sim.entities.forEach(other => {
            if (other.id === ent.id || other.state === 'dead' || other.state === 'garrisoned' || other.type !== 'unit' || other.subType.includes('drone')) return;
            const dx = ent.x - other.x;
            const dz = ent.z - other.z;
            const distSq = dx * dx + dz * dz;
            const minSpace = 1.35;
            const minSpaceSq = minSpace * minSpace;
            if (distSq < minSpaceSq) {
              const dist = Math.sqrt(distSq) || 0.01;
              const overlap = minSpace - dist;
              const pushX = (dx / dist) * overlap * 0.08;
              const pushZ = (dz / dist) * overlap * 0.08;
              ent.x += pushX;
              ent.z += pushZ;
            }
          });
          // Constrain within map bounds
          ent.x = Math.max(1, Math.min(lobby.mapSize - 1.5, ent.x));
          ent.z = Math.max(1, Math.min(lobby.mapSize - 1.5, ent.z));
        }

        // CRITICAL GROUND CLAMP PROTOCOL: Lock 3D physical position to terrain heights on every frame tick!
        // Guarantees all vehicles, infantry, and structures glide over slopes correctly without sinking.
        const currentElevation = getTerrainHeight(ent.x, ent.z, map);
        
        let visualY = currentElevation + 0.05;
        if (isDrone) {
          visualY = 3.0; // quadcopter drones float majestically
        } else if (ent.type === 'building') {
          visualY = currentElevation + 0.05;
        }

        // Fog of war: our own forces are always drawn; everyone else only
        // while a friendly unit currently has eyes on their tile.
        const fogReveals = ent.team === selfPlayer.team || isVisibleAt(ent.x, ent.z);
        mesh.visible = ent.state !== 'garrisoned' && fogReveals;
        mesh.position.set(ent.x, visualY, ent.z);

        // Mobile Jammer stealth field transparency application
        const isCloaked = ent.type === 'unit' && ent.subType !== 'mobile_jammer' && sim.entities.some(j => 
          j.state !== 'dead' &&
          j.subType === 'mobile_jammer' &&
          j.playerId === ent.playerId &&
          Math.sqrt((j.x - ent.x)*(j.x - ent.x) + (j.z - ent.z)*(j.z - ent.z)) < 8.0
        );

        mesh.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const m = (child as THREE.Mesh).material as THREE.Material | THREE.Material[];
            const mats = Array.isArray(m) ? m : [m];
            mats.forEach(mat => {
              mat.transparent = true;
              mat.opacity = isCloaked ? 0.35 : 1.0;
            });
          }
        });

        // Rotate and smoothly tilt units along terrain slope
        if (ent.type === 'unit') {
          mesh.rotation.order = 'YXZ';
          mesh.rotation.y = ent.angle;

          if (!isDrone) {
            const stepForward = 0.5;
            const angleVal = -ent.angle + Math.PI / 2;
            
            const fX = ent.x + Math.cos(angleVal) * stepForward;
            const fZ = ent.z + Math.sin(angleVal) * stepForward;
            const bX = ent.x - Math.cos(angleVal) * stepForward;
            const bZ = ent.z - Math.sin(angleVal) * stepForward;

            const heightFront = getTerrainHeight(fX, fZ, map);
            const heightBack = getTerrainHeight(bX, bZ, map);
                        const pitch = -Math.atan2(heightFront - heightBack, stepForward * 2);

            const perpAngle = angleVal + Math.PI / 2;
            const lX = ent.x + Math.cos(perpAngle) * stepForward;
            const lZ = ent.z + Math.sin(perpAngle) * stepForward;
            const rX = ent.x - Math.cos(perpAngle) * stepForward;
            const rZ = ent.z - Math.sin(perpAngle) * stepForward;

            const heightLeft = getTerrainHeight(lX, lZ, map);
            const heightRight = getTerrainHeight(rX, rZ, map);
            const roll = -Math.atan2(heightLeft - heightRight, stepForward * 2);

            if (ent.pitch === undefined) ent.pitch = 0;
            if (ent.roll === undefined) ent.roll = 0;

            ent.pitch += (pitch - ent.pitch) * 0.15;
            ent.roll += (roll - ent.roll) * 0.15;

            mesh.rotation.x = ent.pitch;
            mesh.rotation.z = ent.roll;
          } else {
            mesh.rotation.x = 0;
            mesh.rotation.z = 0;
          }
        }

        // Visual entity highlights for user selections
        if (sim.selectedIds.includes(ent.id)) {
          let ring = activeSelectionRings.get(ent.id);
          if (!ring) {
            ring = new THREE.Mesh(selectionRingGeom, selectionRingMat);
            mesh.add(ring);
            activeSelectionRings.set(ent.id, ring);
          }
          ring.rotation.y += 0.04; // rotate highlights
        } else {
          const ring = activeSelectionRings.get(ent.id);
          if (ring) {
            mesh.remove(ring);
            activeSelectionRings.delete(ent.id);
          }
        }

        // Animate rotors on quadcopters
        if (ent.subType === 'drone_scout') {
          const rotors = mesh.getObjectByName('rotors');
          if (rotors) {
            rotors.children.forEach(c => {
              if (c.name.startsWith('blade')) c.rotation.y += 0.45;
            });
          }
        }
        if (ent.subType === 'drone_kamikaze') {
          const prop = mesh.getObjectByName('rear_prop');
          if (prop) prop.rotation.z += 0.5;
        }

        // Faction-tailored real-time mechanical animations
        const ewAntenna = mesh.getObjectByName('ew_antenna');
        if (ewAntenna) {
          ewAntenna.rotation.y += 0.04;
        }
        const spinDish = mesh.getObjectByName('radar_dish');
        if (spinDish) {
          spinDish.rotation.y += 0.02;
        }
        const floatingCrys = mesh.getObjectByName('floating_crys');
        if (floatingCrys) {
          floatingCrys.rotation.y += 0.03;
          floatingCrys.position.y = Math.sin(Date.now() * 0.003) * 0.12;
        }
        const pumpArm = mesh.getObjectByName('pump_arm');
        if (pumpArm) {
          pumpArm.rotation.z = Math.sin(Date.now() * 0.002) * 0.35;
        }

        // Building construction update ticks
        if (ent.type === 'building' && ent.state === 'constructing') {
          // See if any builder belonging to the same player is nearby
          const builders = sim.entities.filter(b => b.type === 'unit' && b.subType === 'builder' && b.playerId === ent.playerId && b.state !== 'dead');
          const nearBuilder = builders.find(b => {
            const dx = b.x - ent.x;
            const dz = b.z - ent.z;
            return dx*dx + dz*dz < 20.25; // within 4.5 units radius
          });

          if (nearBuilder) {
            // Build progress goes up fast!
            ent.buildProgress = (ent.buildProgress || 0) + 0.006; 
            
            // Turn nearBuilder to face the building
            const angleToBuild = Math.atan2(ent.x - nearBuilder.x, ent.z - nearBuilder.z);
            nearBuilder.angle = angleToBuild;

            // Spawn visual welding sparks at construction site — but only where
            // we actually have vision, so an enemy base being raised inside the
            // fog of war stays completely hidden (sparks live in the scene, not
            // under the building's fog-gated mesh, so they must be gated here).
            const constructionVisible = ent.team === selfPlayer.team || isVisibleAt(ent.x, ent.z);
            if (constructionVisible && Math.random() < 0.45) {
              const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.9 });
              const sparkMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 4, 4), sparkMaterial);
              sparkMesh.position.set(
                ent.x + (Math.random() - 0.5) * 1.6,
                currentElevation + (ent.buildProgress || 0) * 0.9 + 0.1,
                ent.z + (Math.random() - 0.5) * 1.6
              );
              scene.add(sparkMesh);
              explosionParticles.push({
                mesh: sparkMesh,
                stepY: Math.random() * 0.06 + 0.02,
                life: 0.2,
                sizeShrink: 0.9
              });
            }
          } else {
            // Both AI and player need active builders to construct structures! No passive materialized bases are allowed without constructors.
            ent.buildProgress = (ent.buildProgress || 0) + 0.0001;
          }

          mesh.scale.set(1, Math.min(1.0, ent.buildProgress || 0.05), 1); // rise above ground
          if (ent.buildProgress >= 1.0) {
            ent.buildProgress = 1.0;
            ent.state = 'idle';
            // Only announce our OWN construction — an enemy finishing a structure
            // in the fog must not leak its presence via chime or alert.
            if (ent.playerId === playerId) {
              sound.playBuildComplete();
              pushNotification(`Строительство завершено успешно: ${BUILDING_PROPERTIES[ent.subType as BuildingType]?.name || ent.subType}`, 'success');
            }
          }
        }

        // --- INTERACTIVE GARRISONING STATE MACHINE ---
        if (ent.type === 'unit' && ent.state === 'moving' && ent.subType === 'cyber_specops') {
          // Find if there is any active civilian building within 1.6 meters to occupy!
          const nearCiv = sim.entities.find(e => 
            e.type === 'building' && 
            e.subType === 'civilian_building' && 
            e.state !== 'dead' && 
            Math.sqrt((e.x - ent.x)*(e.x - ent.x) + (e.z - ent.z)*(e.z - ent.z)) < 1.6
          );
          if (nearCiv) {
            // Claim entry!
            ent.state = 'garrisoned';
            ent.garrisonedIn = nearCiv.id;
            ent.targetX = undefined;
            ent.targetZ = undefined;
            pushNotification(`Спецназ закрепился на огневых позициях в городском здании!`, 'success');
          }
        }

        // Active Garrison firing loop inside building
        if (ent.type === 'unit' && ent.state === 'garrisoned' && ent.garrisonedIn) {
          const b = sim.entities.find(e => e.id === ent.garrisonedIn);
          if (b && b.state !== 'dead') {
            // Lock unit position to building coordinate
            ent.x = b.x;
            ent.z = b.z;

            // Dynamically claim building ownership to garrisoned player!
            if (b.playerId !== ent.playerId) {
              b.playerId = ent.playerId;
              b.team = ent.team;
              pushNotification(`Установлен контроль над городским узлом обороны!`, 'success');
            }

            // Passive periodic shooting out of structural windows!
            if (!ent.cooldown || ent.cooldown <= 0) {
              const enemies = sim.entities.filter(e => e.state !== 'dead' && e.team !== ent.team && Math.sqrt((e.x - b.x)*(e.x - b.x) + (e.z - b.z)*(e.z - b.z)) < 7.0);
              if (enemies.length > 0) {
                const victim = enemies[0];
                ent.cooldown = 35; // fire pace

                // Render bright direct glowing rifle bullet tracer cylinder
                const lClr = ent.playerId === playerId ? '#22d3ee' : '#f87171';
                const tracerB = new THREE.Mesh(
                  new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4),
                  new THREE.MeshBasicMaterial({ color: lClr })
                );
                // Position tracer at correct altitude
                tracerB.position.set((b.x + victim.x)/2, currentElevation + 1.2, (b.z + victim.z)/2);
                scene.add(tracerB);
                explosionParticles.push({ mesh: tracerB, stepY: 0.05, life: 0.1 });

                // Hurt the target with infantry bullets damage
                victim.health = Math.max(0, victim.health - 15);
                if (victim.health <= 0) {
                  victim.state = 'dead';
                  pushNotification(`Гарнизон уничтожил вражескую пехоту!`, 'warn');
                }
              }
            }
          } else {
            // Building got destroyed: eject surviving infantry at half health!
            ent.state = 'idle';
            ent.garrisonedIn = undefined;
            ent.health = Math.max(15, Math.floor(ent.health * 0.5));
            ent.x = ent.x + (Math.random() - 0.5) * 2;
            ent.z = ent.z + (Math.random() - 0.5) * 2;
            pushNotification(`Гарнизон выбит взрывом из разрушенного строения!`, 'warn');
          }
        }


        // --- AUTOMATED HARVESTER STATE MACHINE ---
        if (ent.type === 'unit' && ent.subType === 'harvester' && ent.state !== 'dead') {
          if (!ent.harvesterState) ent.harvesterState = 'idle';
          if (ent.harvesterCargo === undefined) ent.harvesterCargo = 0;

          if (ent.harvesterState === 'idle') {
            // Locate closest completed oil derrick
            const derricks = sim.entities.filter(e => e.type === 'building' && e.subType === 'oil_derrick' && e.state !== 'dead' && e.buildProgress && e.buildProgress >= 1);
            if (derricks.length > 0) {
              let closestD = derricks[0];
              let minDistSq = 999999;
              derricks.forEach(d => {
                const dSq = (d.x - ent.x)*(d.x - ent.x) + (d.z - ent.z)*(d.z - ent.z);
                if (dSq < minDistSq) {
                  minDistSq = dSq;
                  closestD = d;
                }
              });
              ent.harvesterState = 'moving_to_extract';
              ent.targetX = closestD.x;
              ent.targetZ = closestD.z;
              ent.state = 'moving';
            } else {
              // Stay close to refineries or Base
              const hubs = sim.entities.filter(e => e.type === 'building' && (e.subType === 'supply_refinery' || e.subType === 'command_center') && e.playerId === ent.playerId && e.state !== 'dead');
              if (hubs.length > 0 && ent.state === 'idle') {
                ent.targetX = hubs[0].x + (Math.random() - 0.5) * 4;
                ent.targetZ = hubs[0].z + (Math.random() - 0.5) * 4;
                ent.state = 'moving';
              }
            }
          }

          else if (ent.harvesterState === 'moving_to_extract') {
            const derricks = sim.entities.filter(e => e.type === 'building' && e.subType === 'oil_derrick' && e.state !== 'dead');
            const targetD = derricks.find(d => Math.abs(d.x - (ent.targetX || 0)) < 1.0 && Math.abs(d.z - (ent.targetZ || 0)) < 1.0);
            if (!targetD) {
              ent.harvesterState = 'idle';
            } else {
              const dx = targetD.x - ent.x;
              const dz = targetD.z - ent.z;
              const dist = Math.sqrt(dx*dx + dz*dz);
              if (dist < 1.8) {
                ent.state = 'idle';
                ent.harvesterState = 'extracting';
                ent.harvesterTimer = 150; // 2.5 seconds loading oil cargo
              } else {
                ent.state = 'moving';
                ent.targetX = targetD.x;
                ent.targetZ = targetD.z;
              }
            }
          }

          else if (ent.harvesterState === 'extracting') {
            ent.harvesterTimer = (ent.harvesterTimer || 150) - 1;

            // Spasmodic yellow sparks cargo indicator
            if (Math.random() < 0.3) {
              const oilSpark = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 4), new THREE.MeshBasicMaterial({ color: '#fbbf24' }));
              oilSpark.position.set(ent.x + (Math.random()-0.5)*0.6, currentElevation + 0.3, ent.z + (Math.random()-0.5)*0.6);
              scene.add(oilSpark);
              explosionParticles.push({ mesh: oilSpark, stepY: 0.04, life: 0.2, sizeShrink: 0.9 });
            }

            if (ent.harvesterTimer <= 0) {
              ent.harvesterCargo = 150; // oil payload
              ent.harvesterState = 'moving_to_unload';

              // Find closest delivery point
              const hubs = sim.entities.filter(e => e.type === 'building' && (e.subType === 'supply_refinery' || e.subType === 'command_center') && e.playerId === ent.playerId && e.state !== 'dead');
              if (hubs.length > 0) {
                let closestH = hubs[0];
                let minDistSq = 999999;
                hubs.forEach(h => {
                  const dSq = (h.x - ent.x)*(h.x - ent.x) + (h.z - ent.z)*(h.z - ent.z);
                  if (dSq < minDistSq) {
                    minDistSq = dSq;
                    closestH = h;
                  }
                });
                ent.targetX = closestH.x;
                ent.targetZ = closestH.z;
                ent.state = 'moving';
              } else {
                ent.harvesterState = 'idle'; // await dropoff building
              }
            }
          }

          else if (ent.harvesterState === 'moving_to_unload') {
            const hubs = sim.entities.filter(e => e.type === 'building' && (e.subType === 'supply_refinery' || e.subType === 'command_center') && e.playerId === ent.playerId && e.state !== 'dead');
            const targetH = hubs.find(h => Math.abs(h.x - (ent.targetX || 0)) < 1.0 && Math.abs(h.z - (ent.targetZ || 0)) < 1.0) || hubs[0];
            if (!targetH) {
              ent.harvesterState = 'idle';
            } else {
              const dx = targetH.x - ent.x;
              const dz = targetH.z - ent.z;
              const dist = Math.sqrt(dx*dx + dz*dz);
              if (dist < 2.2) {
                ent.state = 'idle';
                ent.harvesterState = 'unloading';
                ent.harvesterTimer = 90; // 1.5 seconds pumping resources
              } else {
                ent.state = 'moving';
                ent.targetX = targetH.x;
                ent.targetZ = targetH.z;
              }
            }
          }

          else if (ent.harvesterState === 'unloading') {
            ent.harvesterTimer = (ent.harvesterTimer || 90) - 1;
            if (ent.harvesterTimer <= 0) {
              const payload = ent.harvesterCargo || 150;
              ent.harvesterCargo = 0;
              ent.harvesterState = 'idle';

              // Pay player account!
              if (ent.playerId === playerId) {
                sim.credits += payload;
                setCredits(sim.credits);
                pushNotification(`Экономика: Сырая нефть доставлена! Бюджет пополнен на +$${payload}`, 'success');
              } else {
                // AI gets budget
                const ai = sim.players.find(p => p.id === ent.playerId);
                if (ai) {
                  // AI keeps moving
                }
              }

              // Coin release visual representation
              const coinG = new THREE.CylinderGeometry(0.18, 0.18, 0.04, 8);
              const coinM = new THREE.MeshBasicMaterial({ color: '#facc15' });
              const coinMesh = new THREE.Mesh(coinG, coinM);
              coinMesh.position.set(ent.x, currentElevation + 1.2, ent.z);
              scene.add(coinMesh);
              explosionParticles.push({ mesh: coinMesh, stepY: 0.03, life: 0.4, sizeShrink: 0.95 });
            }
          }
        }

        // Units movement physics with standard soft collision and pathfinding avoidance
        if (ent.type === 'unit' && ent.state === 'moving' && ent.targetX !== undefined && ent.targetZ !== undefined) {
          const dx = ent.targetX - ent.x;
          const dz = ent.targetZ - ent.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          const maxSp = getUnitProps(ent.subType as UnitType, ent.playerId, sim.players).speed * 0.08;

          // Dynamic group grouping/stopping: stop next to other resting units at the target
          let dynamicStopRadius = 0.44;
          if (!ent.subType.includes('drone')) {
            const staticTeammatesAtTarget = sim.entities.filter(other => 
              other.id !== ent.id &&
              other.type === 'unit' &&
              other.playerId === ent.playerId &&
              !other.subType.includes('drone') &&
              (other.state === 'idle' || other.state === 'attacking') &&
              other.targetX === ent.targetX &&
              other.targetZ === ent.targetZ
            );
            for (const other of staticTeammatesAtTarget) {
              const dxO = ent.targetX! - other.x;
              const dzO = ent.targetZ! - other.z;
              const dO = Math.sqrt(dxO*dxO + dzO*dzO);
              if (dO < 2.5) {
                const dxU = ent.x - other.x;
                const dzU = ent.z - other.z;
                const dU = Math.sqrt(dxU*dxU + dzU*dzU);
                if (dU < 1.45) {
                  dynamicStopRadius = Math.max(dynamicStopRadius, dist);
                  break;
                }
              }
            }
          }

          // Opportunistic combat while travelling. A hostile that wanders into
          // weapon range is engaged on the way: the human player's own columns
          // keep rolling to the ordered destination and fire on the move, while
          // AI / enemy columns HALT to hammer the blocker and resume the march
          // once it is destroyed (state stays 'moving', so travel auto-resumes).
          const weaponRange = getUnitProps(ent.subType as UnitType, ent.playerId, sim.players).range;
          const foe = hasWeapon(ent) ? findHostileInRange(ent, weaponRange) : null;
          const isHumanOwned = ent.playerId === playerId;

          if (foe) {
            const fAng = Math.atan2(foe.z - ent.z, foe.x - ent.x);
            if (!isHumanOwned) {
              // Turn the whole chassis to face the target it has stopped for.
              ent.angle = -fAng + Math.PI / 2;
              mesh.rotation.y = ent.angle;
            }
            if (!ent.cooldown || ent.cooldown <= 0) {
              fireUnitWeapon(ent, foe, mesh, Math.sqrt((foe.x - ent.x) * (foe.x - ent.x) + (foe.z - ent.z) * (foe.z - ent.z)));
            }
          }

          const holdToFight = !!foe && !isHumanOwned;

          if (!holdToFight && dist > dynamicStopRadius) {
            // Apply step toward target
            const angleVal = Math.atan2(dz, dx);
            ent.angle = -angleVal + Math.PI / 2; // rotating mesh face
            mesh.rotation.y = ent.angle;

            ent.x += Math.cos(angleVal) * maxSp;
            ent.z += Math.sin(angleVal) * maxSp;

            // Restrain heights to procedural hills
            const targetElevation = getTerrainHeight(ent.x, ent.z, map);

            // Scout drones fly high
            const visualHeight = ent.subType.includes('drone') ? 3.0 : targetElevation + 0.08;
            mesh.position.set(ent.x, visualHeight, ent.z);
          } else if (!holdToFight) {
            ent.state = 'idle';
          }
        }

        // Combat targeting firing checks
        if (ent.type === 'unit' && ent.state === 'idle') {
          // Auto acquire targets if idle
          let closestHostile: GameEntity | null = null;
          let minRange = (getUnitProps(ent.subType as UnitType, ent.playerId, sim.players)?.range || 5) + 2.5; // aggressive radius
          
          sim.entities.forEach(v => {
            if (v.state === 'dead' || v.team === ent.team) return;
            
            // Jamming stealth support: if targeted entity is cloaked under an active Mobile Jammer, we cannot target it unless we are directly beside it
            const isTargetCloaked = v.type === 'unit' && v.subType !== 'mobile_jammer' && sim.entities.some(j => 
              j.state !== 'dead' &&
              j.subType === 'mobile_jammer' &&
              j.playerId === v.playerId &&
              Math.sqrt((j.x - v.x)*(j.x - v.x) + (j.z - v.z)*(j.z - v.z)) < 8.0
            );

            const dist = Math.sqrt((v.x - ent.x) * (v.x - ent.x) + (v.z - ent.z) * (v.z - ent.z));
            if (isTargetCloaked && dist > 2.8) return; // Stealth lock!

            if (dist < minRange) {
              minRange = dist;
              closestHostile = v;
            }
          });

          if (closestHostile) {
            ent.state = 'attacking';
            ent.targetId = closestHostile.id;
            ent.targetType = closestHostile.type;
          }
        }

        if (ent.type === 'unit' && ent.state === 'attacking' && ent.targetId !== undefined) {
          // Opportunistic retarget for AI columns: if the assigned objective is
          // out of weapon range but a hostile is already within firing range,
          // destroy that blocker first instead of marching past it. The human's
          // own units always pursue the exact target the player ordered.
          if (ent.playerId !== playerId && hasWeapon(ent)) {
            const wr = getUnitProps(ent.subType as UnitType, ent.playerId, sim.players).range;
            const cur = sim.entities.find(e => e.id === ent.targetId);
            const curDist = cur ? Math.sqrt((cur.x - ent.x) * (cur.x - ent.x) + (cur.z - ent.z) * (cur.z - ent.z)) : Infinity;
            if (!cur || cur.state === 'dead' || curDist > wr) {
              const closer = findHostileInRange(ent, wr);
              if (closer && closer.id !== ent.targetId) {
                ent.targetId = closer.id;
                ent.targetType = closer.type;
              }
            }
          }
          const victim = sim.entities.find(e => e.id === ent.targetId);
          if (!victim || victim.state === 'dead') {
            ent.state = 'idle';
            ent.targetId = undefined;
          } else {
            // Check distance to fire weapon spikes
            const dx = victim.x - ent.x;
            const dz = victim.z - ent.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            const props = getUnitProps(ent.subType as UnitType, ent.playerId, sim.players);

            // Direct facing turns
            const angleVal = Math.atan2(dz, dx);
            ent.angle = -angleVal + Math.PI / 2;
            mesh.rotation.y = ent.angle;

            if (dist > props.range) {
              // Advance to get closer in range
              const maxSp = props.speed * 0.08;
              ent.x += Math.cos(angleVal) * maxSp;
              ent.z += Math.sin(angleVal) * maxSp;
              
              const targetElevation = getTerrainHeight(ent.x, ent.z, map);
              const visualHeight = ent.subType.includes('drone') ? 3.0 : targetElevation + 0.05;
              mesh.position.set(ent.x, visualHeight, ent.z);
            } else {
              // Target is securely in range, weapon systems free!
              const isJammed = sim.entities.some(v => 
                v.state !== 'dead' &&
                v.subType === 'mobile_jammer' &&
                v.team !== ent.team &&
                Math.sqrt((v.x - ent.x)*(v.x - ent.x) + (v.z - ent.z)*(v.z - ent.z)) < 11.0
              );

              if (isJammed) {
                ent.cooldown = 15; // stall firing
                const startHeight = mesh.position.y + 0.4;
                const spar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#22d3ee' }));
                spar.position.set(ent.x + (Math.random()-0.5)*0.3, startHeight, ent.z + (Math.random()-0.5)*0.3);
                scene.add(spar);
                explosionParticles.push({ mesh: spar, stepY: 0.05, life: 0.15, sizeShrink: 0.85 });
              } else if (!ent.cooldown || ent.cooldown <= 0) {
                fireUnitWeapon(ent, victim, mesh, dist);
              }
            }
          }
        }

        // Automated Laser Turret Point Defense target acquisitions
        if (ent.subType === 'defense_turret' && ent.state !== 'constructing') {
          // Check if jammed by any active mobile_jammer from an enemy team!
          const activeJammerNearby = sim.entities.some(v => 
            v.state !== 'dead' && 
            v.subType === 'mobile_jammer' && 
            v.team !== ent.team && 
            Math.sqrt((v.x - ent.x)*(v.x - ent.x) + (v.z - ent.z)*(v.z - ent.z)) < 11.0
          );
          
          if (activeJammerNearby) {
            ent.cooldown = 20; // force lock firing capability
            const hBlock = mesh.getObjectByName('railgun_head');
            if (hBlock) {
              hBlock.rotation.y += 0.12; // spin head in confusion
            }
          } else {
            // Look for closest hostile within weapon radius
            let closestHostile: GameEntity | null = null;
            let minRange = 7.5; // active radius

            sim.entities.forEach(v => {
              if (v.state === 'dead' || v.team === ent.team) return;

              // Jet/vehicle cloaked shield guard checks
              const isTargetCloaked = v.type === 'unit' && v.subType !== 'mobile_jammer' && sim.entities.some(j => 
                j.state !== 'dead' &&
                j.subType === 'mobile_jammer' &&
                j.playerId === v.playerId &&
                Math.sqrt((j.x - v.x)*(j.x - v.x) + (j.z - v.z)*(j.z - v.z)) < 8.0
              );

              const dist = Math.sqrt((v.x - ent.x) * (v.x - ent.x) + (v.z - ent.z) * (v.z - ent.z));
              if (isTargetCloaked && dist > 2.8) return; // Cloak blocks lock-on except point-blank detection sweeps!

              if (dist < minRange) {
                minRange = dist;
                closestHostile = v;
              }
            });

            if (closestHostile) {
              const hBlock = mesh.getObjectByName('railgun_head');
              const target: GameEntity = closestHostile;
              const dx = target.x - ent.x;
              const dz = target.z - ent.z;
              const angleVal = Math.atan2(dz, dx);
              
              if (hBlock) {
                hBlock.rotation.y = -angleVal + Math.PI / 2; // sweep head (corrected 180 deg)
              }

              if (!ent.cooldown || ent.cooldown <= 0) {
              ent.cooldown = 20;

              const owner = sim.players.find(p => p.id === ent.playerId) || selfPlayer;
              let pColor = owner.color;
              
              // Muzzle flash particle
              const startHeight = mesh.position.y + 1.2;
              const flash = new THREE.Mesh(new THREE.SphereGeometry(0.15, 4, 4), new THREE.MeshBasicMaterial({color: '#f43f5e'}));
              flash.position.set(ent.x + Math.cos(angleVal)*0.4, startHeight, ent.z + Math.sin(angleVal)*0.4);
              scene.add(flash);
              explosionParticles.push({ mesh: flash, stepY: 0, life: 0.1, sizeShrink: 0.8 });

              const pMesh = new THREE.Object3D();
              const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#f43f5e' }));
              m.rotation.x = Math.PI / 2;
              pMesh.add(m);

              pMesh.position.set(ent.x, startHeight, ent.z);
              pMesh.lookAt(target.x, startHeight, target.z);
              scene.add(pMesh);

              activeProjectiles.push({
                  mesh: pMesh,
                  targetId: target.id,
                  damage: 10, // Slightly reduced laser defense turret damage as requested (dps balanced)
                  speed: 0.7,
                  subType: 'laser',
                  x: ent.x,
                  y: startHeight,
                  z: ent.z,
                  color: '#f43f5e',
                  life: 0,
                  startX: ent.x,
                  startZ: ent.z,
                  distanceTotal: minRange,
                  ownerId: owner.id
              });

              const turFaction = getFaction(ent.playerId, sim.players);
              if (turFaction === 'Alliance') {
                sound.playSpatial('playAllianceZap', ent.x, ent.z);
              } else if (turFaction === 'Coalition') {
                sound.playSpatial('playCoalitionBoom', ent.x, ent.z);
              } else if (turFaction === 'Union') {
                sound.playSpatial('playUnionTesla', ent.x, ent.z);
              } else { // Syndicate
                sound.playSpatial('playSyndicateAcid', ent.x, ent.z);
              }
            }
            } // close if (!ent.cooldown
          }
        }
      });

      // Update particle explosions animation steps
      for (let i = explosionParticles.length - 1; i >= 0; i--) {
        const p: any = explosionParticles[i];
        
        // Apply physics-based gravity to falling wreckage debris
        if (p.hasGravity) {
          p.stepY -= 0.007; // pull down by gravity
          p.mesh.rotation.x += p.rotX || 0.04;
          p.mesh.rotation.y += p.rotY || 0.04;

          p.mesh.position.y += p.stepY;
          if (p.stepX !== undefined) p.mesh.position.x += p.stepX;
          if (p.stepZ !== undefined) p.mesh.position.z += p.stepZ;

          // Detect collision against terrain height for bouncing!
          const terrHeight = getTerrainHeight(p.mesh.position.x, p.mesh.position.z, map);
          if (p.mesh.position.y < terrHeight + 0.06) {
            p.mesh.position.y = terrHeight + 0.06;
            p.stepY = -p.stepY * 0.45; // bounce index
            p.stepX = (p.stepX || 0) * 0.65; // friction index
            p.stepZ = (p.stepZ || 0) * 0.65; // friction index
          }
        } else if (p.isRing) {
          // Ring shockwave expansion & opacity fading
          p.mesh.scale.multiplyScalar(p.sizeShrink || 1.06);
          if (p.mesh.material && typeof p.mesh.material.opacity === 'number') {
            p.mesh.material.opacity -= 0.035;
          }
        } else {
          // Standard smoke/spark particles
          p.mesh.position.y += p.stepY;
          if (p.stepX !== undefined) p.mesh.position.x += p.stepX;
          if (p.stepZ !== undefined) p.mesh.position.z += p.stepZ;
          if (p.sizeShrink !== undefined && p.mesh.scale.x > 0.01) {
            p.mesh.scale.multiplyScalar(p.sizeShrink);
          }
        }

        p.life -= 0.02;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          if (p.mesh) {
            if (p.mesh.geometry) p.mesh.geometry.dispose();
            if (p.mesh.material) {
              if (Array.isArray(p.mesh.material)) {
                p.mesh.material.forEach((m: any) => m.dispose());
              } else {
                p.mesh.material.dispose();
              }
            }
          }
          explosionParticles.splice(i, 1);
        }
      }

      // Update flying weapon projectiles
      for (let i = activeProjectiles.length - 1; i >= 0; i--) {
        const p = activeProjectiles[i];
        const targetEnt = sim.entities.find(e => e.id === p.targetId);
        
        let dx = 0; let dy = 0; let dz = 0;
        let tHit = false;

        if (!targetEnt || targetEnt.health <= 0) {
           // Target is gone, just drop the projectile or fade it
           p.life += p.speed * 0.1;
           if (p.life > 1) tHit = true; // pretend it hit the ground
        } else {
           const tx = targetEnt.x;
           const tz = targetEnt.z;
           const targetMesh = entityMeshes.get(targetEnt.id);
           const ty = targetMesh ? targetMesh.position.y + 0.5 : 1.0;
           
           dx = tx - p.x;
           dy = ty - p.y;
           dz = tz - p.z;
           
           const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
           if (dist < p.speed) {
             tHit = true;
           } else {
             // Move projectile
             p.x += (dx / dist) * p.speed;
             p.y += (dy / dist) * p.speed;
             p.z += (dz / dist) * p.speed;

             if (p.subType === 'rocket') {
               // Arcing rockets 
               const distDone = Math.sqrt((p.x - p.startX)*(p.x - p.startX) + (p.z - p.startZ)*(p.z - p.startZ));
               const maxH = p.distanceTotal * 0.4; // peak height
               const safeDist = Math.max(p.distanceTotal, 0.1);
               const arc = Math.sin((distDone / safeDist) * Math.PI) * maxH;
               p.mesh.position.set(p.x, p.y + arc, p.z);
               
               // Particle smoke trail
               if (tickCount % 2 === 0) {
                 const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), new THREE.MeshBasicMaterial({color: '#9ca3af'}));
                 smoke.position.copy(p.mesh.position);
                 scene.add(smoke);
                 explosionParticles.push({mesh: smoke, stepY: 0.01, life: 0.8, sizeShrink: 0.9});
               }
             } else {
               p.mesh.position.set(p.x, p.y, p.z);
             }
             p.mesh.lookAt(targetEnt.x, ty, targetEnt.z);
           }
        }

        if (p.life > 1 || tHit) {
          // Hits target
          scene.remove(p.mesh);
          activeProjectiles.splice(i, 1);

          if (tHit && targetEnt && targetEnt.health > 0) {
             targetEnt.health -= p.damage;
             
             // Impact explosion visuals based on weapon
             let pCount = p.subType === 'rocket' ? 12 : p.subType === 'shell' ? 6 : 2;
             const pColor = p.subType === 'rocket' ? '#f97316' : p.subType === 'shell' ? '#f59e0b' : p.color;

             for (let m=0; m<pCount; m++) {
               const spark = new THREE.Mesh(new THREE.SphereGeometry(Math.random()*0.15 + 0.05, 4, 4), new THREE.MeshBasicMaterial({color: pColor}));
               const tx = targetEnt.x + (Math.random() - 0.5) * 0.5;
               const tz = targetEnt.z + (Math.random() - 0.5) * 0.5;
               const targetM3 = entityMeshes.get(targetEnt.id);
               spark.position.set(tx, targetM3 ? targetM3.position.y + Math.random()*1.0 : 1, tz);
               scene.add(spark);
               explosionParticles.push({
                 mesh: spark, 
                 stepY: Math.random()*0.05 + 0.02, 
                 stepX: (Math.random()-0.5)*0.1, 
                 stepZ: (Math.random()-0.5)*0.1,
                 life: 0.5,
                 sizeShrink: 0.9
               });
             }

             if (targetEnt.health <= 0) {
                targetEnt.health = 0;
                targetEnt.state = 'dead';
                sound.playSpatial('playExplosion', targetEnt.x, targetEnt.z);
                if (targetEnt.type === 'building') {
                  pushNotification(`Вражеская структура разрушена!`, 'warn');
                }
             } else if (p.subType === 'rocket' || p.subType === 'shell') {
                sound.playSpatial('playExplosion', targetEnt.x, targetEnt.z); // smaller explosive thump
             }
          }
        }
      }

      // e. Local Computer AI commander tick triggers (Singleplayer offline)
      if (isSingleplayer && Date.now() - lastAiTick > 3500) {
        lastAiTick = Date.now();

        if (!sim.aiStates) {
          sim.aiStates = {};
        }

        // Standard computer generals action loop
        sim.players.forEach(p => {
          if (!p.isAI) return;

          // Find AI CommandCenter
          const aiCc = sim.entities.find(e => e.playerId === p.id && e.subType === 'command_center' && e.state !== 'dead');
          if (!aiCc) return; // AI is defeated!

          // Helper to task AI builders to move and construct
          const taskAiBuilders = (pId: string, tx: number, tz: number) => {
            const builders = sim.entities.filter(b => b.playerId === pId && b.subType === 'builder' && b.state !== 'dead');
            builders.forEach(b => {
              b.state = 'moving';
              b.targetX = tx + (Math.random() - 0.5) * 1.5;
              b.targetZ = tz + (Math.random() - 0.5) * 1.5;
            });
          };

          // Respawn AI builder at CommandCenter if they have none
          let aliveBuilders = sim.entities.filter(e => e.playerId === p.id && e.subType === 'builder' && e.state !== 'dead');
          if (aliveBuilders.length === 0) {
            const uProps = getUnitProps('builder', p.id, sim.players);
            sim.entities.push({
              id: `ai_builder_respawn_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
              type: 'unit',
              subType: 'builder',
              playerId: p.id,
              team: p.team,
              health: uProps.hp,
              maxHealth: uProps.hp,
              x: aiCc.x + (Math.random() - 0.5) * 3,
              z: aiCc.z + 3,
              angle: Math.PI,
              state: 'idle'
            });
            // (No alert — enemy production must stay hidden until actually scouted.)
            aliveBuilders = sim.entities.filter(e => e.playerId === p.id && e.subType === 'builder' && e.state !== 'dead');
          }

          // Direct idle or wandering builders to construct any current building projects
          const currentConstructs = sim.entities.filter(e => e.playerId === p.id && e.type === 'building' && e.state === 'constructing');
          if (currentConstructs.length > 0) {
            aliveBuilders.forEach(b => {
              if (b.state === 'idle') {
                const targetC = currentConstructs[0];
                b.state = 'moving';
                b.targetX = targetC.x + (Math.random() - 0.5) * 1.5;
                b.targetZ = targetC.z + (Math.random() - 0.5) * 1.5;
              }
            });
          }

          // Initialize AI State for this player if none exists
          if (!sim.aiStates[p.id]) {
            sim.aiStates[p.id] = {
              phase: 'build_base', // 'build_base' | 'gather_army' | 'strike_defenses' | 'strike_base'
              timer: 0,
              warned: false
            };
          }

          const aiState = sim.aiStates[p.id];
          aiState.timer += 3.5;

          const refineries = sim.entities.filter(e => e.playerId === p.id && e.subType === 'supply_refinery' && e.state !== 'dead');
          const barracks = sim.entities.find(e => e.playerId === p.id && e.subType === 'barracks' && e.state !== 'dead');
          const warFactories = sim.entities.find(e => e.playerId === p.id && e.subType === 'war_factory' && e.state !== 'dead');
          const powerPlants = sim.entities.filter(e => e.playerId === p.id && e.subType === 'power_plant' && e.state !== 'dead');
          const turrets = sim.entities.filter(e => e.playerId === p.id && e.subType === 'defense_turret' && e.state !== 'dead');

          // --- 1. BASE BUILDING STATE MACHINE ---
          if (aiState.phase === 'build_base') {
            // Build structures step-by-step with real construction animation progress!
            if (powerPlants.length === 0 && aliveBuilders.length > 0 && aiState.timer >= 10) {
              const bx = aiCc.x - 5;
              const bz = aiCc.z - 2;
              const bProps = getBuildingProps('power_plant', p.id, sim.players);
              sim.entities.push({
                id: `ai_pp_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
                type: 'building',
                subType: 'power_plant',
                playerId: p.id,
                team: p.team,
                health: bProps.hp,
                maxHealth: bProps.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing', // Nice rise animated build!
                buildProgress: 0.05
              });
              taskAiBuilders(p.id, bx, bz);
            }

            else if (refineries.length === 0 && powerPlants.length > 0 && aliveBuilders.length > 0 && aiState.timer >= 25) {
              // Find closest strategic derrick
              let nearestDerrick: { x: number; z: number } | null = null;
              let dSqMin = 999999;
              map.resourceSpots.forEach(spot => {
                let occ = false;
                sim.entities.forEach(ent => {
                  if (ent.subType === 'supply_refinery' && Math.round(ent.x) === spot.x && Math.round(ent.z) === spot.z && ent.state !== 'dead') {
                    occ = true;
                  }
                });
                if (!occ) {
                  const distS = (spot.x - aiCc.x) * (spot.x - aiCc.x) + (spot.z - aiCc.z) * (spot.z - aiCc.z);
                  if (distS < dSqMin) {
                    dSqMin = distS;
                    nearestDerrick = spot;
                  }
                }
              });

              if (nearestDerrick) {
                const bProps = getBuildingProps('supply_refinery', p.id, sim.players);
                sim.entities.push({
                  id: `ai_ref_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
                  type: 'building',
                  subType: 'supply_refinery',
                  playerId: p.id,
                  team: p.team,
                  health: bProps.hp,
                  maxHealth: bProps.hp,
                  x: nearestDerrick.x,
                  z: nearestDerrick.z,
                  angle: 0,
                  state: 'constructing',
                  buildProgress: 0.05
                });
                pushNotification(`Вражеский снабженец разворачивает нефтевышку!`, 'info');
                taskAiBuilders(p.id, (nearestDerrick as any).x, (nearestDerrick as any).z);
              }
            }

            else if (!barracks && refineries.length > 0 && aliveBuilders.length > 0 && aiState.timer >= 45) {
              const bx = aiCc.x + 4;
              const bz = aiCc.z - 4;
              const bProps = getBuildingProps('barracks', p.id, sim.players);
              sim.entities.push({
                id: `ai_b_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
                type: 'building',
                subType: 'barracks',
                playerId: p.id,
                team: p.team,
                health: bProps.hp,
                maxHealth: bProps.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing',
                buildProgress: 0.05
              });
              pushNotification(`Разведка докладывает о постройке вражеских казарм!`, 'info');
              taskAiBuilders(p.id, bx, bz);
            }

            else if (barracks && !warFactories && aliveBuilders.length > 0 && aiState.timer >= 65) {
              const bx = aiCc.x - 3;
              const bz = aiCc.z + 5;
              const bProps = getBuildingProps('war_factory', p.id, sim.players);
              sim.entities.push({
                id: `ai_wf_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
                type: 'building',
                subType: 'war_factory',
                playerId: p.id,
                team: p.team,
                health: bProps.hp,
                maxHealth: bProps.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing',
                buildProgress: 0.05
              });
              pushNotification(`Замечена закладка фундамента тяжелого военного завода врага!`, 'info');
              taskAiBuilders(p.id, bx, bz);
            }

            else if (warFactories && turrets.length === 0 && aliveBuilders.length > 0 && aiState.timer >= 90) {
              // Build standard defensive turret guarding the front
              const bx = aiCc.x + 3;
              const bz = aiCc.z + 4;
              const bProps = getBuildingProps('defense_turret', p.id, sim.players);
              sim.entities.push({
                id: `ai_tur_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
                type: 'building',
                subType: 'defense_turret',
                playerId: p.id,
                team: p.team,
                health: bProps.hp,
                maxHealth: bProps.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing',
                buildProgress: 0.05
              });
              taskAiBuilders(p.id, bx, bz);
            }

            // Transition after building phase completes
            if (aiState.timer >= 120) {
              aiState.phase = 'gather_army';
            }
          }

          // --- 2. GATHER ARMY & TRAINING STATE ---
          if (aiState.phase === 'gather_army') {
            const aiForces = sim.entities.filter(e => e.playerId === p.id && e.type === 'unit' && e.state !== 'dead');
            
            if (barracks && barracks.state !== 'constructing' && aiForces.length < 15 && Math.random() > 0.45) {
              const utToSpawn: UnitType = Math.random() > 0.5 ? 'drone_scout' : 'drone_kamikaze';
              const uProps = getUnitProps(utToSpawn, p.id, sim.players);
              sim.entities.push({
                id: `ai_u_${Date.now()}_r_${Math.floor(Math.random() * 1000000)}`,
                type: 'unit',
                subType: utToSpawn,
                playerId: p.id,
                team: p.team,
                health: uProps.hp,
                maxHealth: uProps.hp,
                x: barracks.x + (Math.random() - 0.5) * 4,
                z: barracks.z + 3,
                angle: Math.PI,
                state: 'idle'
              });
            }

            // Train tanks if war factory is ready and operational
            if (warFactories && warFactories.state !== 'constructing' && aiForces.length < 15 && Math.random() > 0.40) {
              const utToSpawn: UnitType = Math.random() > 0.65 ? 'artillery_mlrs' : 'precision_tank';
              const uProps = getUnitProps(utToSpawn, p.id, sim.players);
              sim.entities.push({
                id: `ai_u_${Date.now()}_rt_${Math.floor(Math.random() * 1000000)}`,
                type: 'unit',
                subType: utToSpawn,
                playerId: p.id,
                team: p.team,
                health: uProps.hp,
                maxHealth: uProps.hp,
                x: warFactories.x + (Math.random() - 0.5) * 4,
                z: warFactories.z + 3,
                angle: Math.PI,
                state: 'idle'
              });
            }

            // Once strike division is mature (at least 8 units recruited), trigger invasion strike!
            const idleArmy = sim.entities.filter(e => e.playerId === p.id && e.type === 'unit' && (e.state === 'idle' || e.state === 'moving'));
            if (idleArmy.length >= 8) {
              aiState.phase = 'strike_defenses';
              aiState.warned = false; // reset warning
            }
          }

          // --- 3. STRIKE TARGET ACQUISITIONS ---
          if (aiState.phase === 'strike_defenses' || aiState.phase === 'strike_base') {
            const idleArmy = sim.entities.filter(e => e.playerId === p.id && e.type === 'unit' && (e.state === 'idle' || e.state === 'moving' || e.state === 'attacking'));
            
            if (idleArmy.length < 3) {
              // Army defeated/diluted, retreat remainder to defend base and gather forces again!
              idleArmy.forEach(u => {
                u.state = 'moving';
                u.targetX = aiCc.x + (Math.random() - 0.5) * 6;
                u.targetZ = aiCc.z + (Math.random() - 0.5) * 6;
                u.targetId = undefined;
              });
              aiState.phase = 'gather_army';
              pushNotification(`Вражеская дивизия понесла тяжелые потери и отступает на перегруппировку!`, 'info');
              return;
            }

            if (!aiState.warned) {
              aiState.warned = true;
              pushNotification(`ВНИМАНИЕ: На радарах обнаружена штурмовая колонна ${p.name.replace('General', 'Генерала')}! Цель: подавление наших позиций!`, 'warn');
              sound.playAlert();
            }

            // Identify hostile target priorities belonging to different teams
            if (aiState.phase === 'strike_defenses') {
              // Try to locate any opposing team's defensive turrets first to breach perimeter
              const targetDef = sim.entities.find(e => {
                if (e.state === 'dead' || e.type !== 'building' || e.subType !== 'defense_turret') return false;
                const entPlayer = sim.players.find(pl => pl.id === e.playerId) || selfPlayer;
                return entPlayer.team !== p.team;
              });

              if (targetDef) {
                idleArmy.forEach(u => {
                  if (u.state !== 'attacking' || u.targetId !== targetDef.id) {
                    u.state = 'attacking';
                    u.targetId = targetDef.id;
                    u.targetType = 'building';
                  }
                });
              } else {
                // Outer ring breached! Advance directly onto their primary base!
                aiState.phase = 'strike_base';
              }
            }

            if (aiState.phase === 'strike_base') {
              // Locate any opposing team's primary CommandCenter, refineries or barracks to dismantle
              const enemyCc = sim.entities.find(e => {
                if (e.state === 'dead' || e.type !== 'building' || e.subType !== 'command_center') return false;
                const entPlayer = sim.players.find(pl => pl.id === e.playerId) || selfPlayer;
                return entPlayer.team !== p.team;
              });

              const enemyProd = sim.entities.find(e => {
                if (e.state === 'dead' || e.type !== 'building' || !['war_factory', 'barracks'].includes(e.subType || '')) return false;
                const entPlayer = sim.players.find(pl => pl.id === e.playerId) || selfPlayer;
                return entPlayer.team !== p.team;
              });
              
              const finalObjective = enemyCc || enemyProd;
              if (finalObjective) {
                idleArmy.forEach(u => {
                  if (u.state !== 'attacking') {
                     u.state = 'attacking';
                     u.targetId = finalObjective.id;
                     u.targetType = 'building';
                  }
                });
              }
            }
          }
        });
      }

      // f. Cash & Power HUD Synchronization triggers
      if (tickCount % 60 === 0) { // standard 1 second logic
        let tickIncome = 0; // standard cash generation

        sim.entities.forEach(ent => {
          if (ent.playerId === playerId && ent.state !== 'dead') {
            if (ent.subType === 'command_center') {
              // Command Center continuous fixed income! Guaranteed floor cash
              tickIncome += 15;
            } else if (ent.subType === 'supply_refinery' && ent.buildProgress && ent.buildProgress >= 1) {
              // Warehouse resource processing passive income
              tickIncome += 15;
            } else if (ent.subType === 'oil_derrick' && ent.buildProgress && ent.buildProgress >= 1) {
              // Active derrick pumping passive cash flows
              tickIncome += 12;
            }
          }
        });

        sim.credits += tickIncome;
        setCredits(sim.credits);
        sim.powerGen = cacheGen;
        sim.powerReq = cacheReq;
        setPowerGenerated(cacheGen);
        setPowerRequired(cacheReq);

        // Slow charge Commander powers
        if (sim.commandCharge < 100) {
          sim.commandCharge = Math.min(100, sim.commandCharge + 1);
          setCommandCharge(sim.commandCharge);
        }

        // Check Victory or Defeat statuses
        if (!sim.gameOverSignalled) {
          // Check if player's CommandCenter is dead, yielding immediate defeat!
          if (userCoreCcDead) {
            sim.gameOverSignalled = true;
            onGameOver(2, false); // loose
          }

          // Check if all enemy Command Centers are demolished, yielding victory!
          let liveEnemyHqs = false;
          sim.players.forEach(p => {
            if (p.team !== selfPlayer.team) {
              const enemyCc = sim.entities.find(e => e.playerId === p.id && e.subType === 'command_center' && e.state !== 'dead');
              if (enemyCc) liveEnemyHqs = true;
            }
          });

          if (!liveEnemyHqs) {
            sim.gameOverSignalled = true;
            onGameOver(selfPlayer.team, true); // victory
          }
        }
      }

      // Real-time smooth synchronizing of camera coordinates with Minimap on actual movement
      if (tickCount % 4 === 0) {
        if (Math.abs(sim.camX - lastSentCamX) > 0.05 || 
            Math.abs(sim.camZ - lastSentCamZ) > 0.05 || 
            Math.abs(sim.camZoom - lastSentCamZoom) > 0.05) {
          lastSentCamX = sim.camX;
          lastSentCamZ = sim.camZ;
          lastSentCamZoom = sim.camZoom;
          setCamPos({ x: sim.camX, z: sim.camZ, zoom: sim.camZoom });
        }
      }

      // Sync active selections periodically with React states
      if (tickCount % 12 === 0) {
        setSelectedEntityIds([...sim.selectedIds]);
      }

      renderer.render(scene, camera);
    };

    // Prime the fog once so the first painted frame already reveals our base
    // (and hides everything else) instead of flashing fully black.
    refreshFog();
    decoGroups.forEach(d => { d.group.visible = isExploredAt(d.x, d.z); });
    resourceGeoms.forEach(rig => { rig.visible = isExploredAt(rig.position.x, rig.position.z); });

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', deferredResize);
      window.removeEventListener('orientationchange', deferredResize);
      canvasDom.removeEventListener('mousedown', handleMouseDown);
      canvasDom.removeEventListener('mousemove', handleMouseMoveSelection);
      canvasDom.removeEventListener('mouseup', handleMouseUp);
      canvasDom.removeEventListener('touchstart', handleTouchStart);
      canvasDom.removeEventListener('touchmove', handleTouchMove);
      canvasDom.removeEventListener('touchend', handleTouchEnd);
      if (socketRef.current) {
        socketRef.current.removeEventListener('message', handleSocketMessage);
      }
      renderer.dispose();
      terrainGeo.dispose();
      terrainMat.dispose();
      placeBoxGeo.dispose();
      placeBoxMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
      selectionRingGeom.dispose();
      selectionRingMat.dispose();
      fogGeo.dispose();
      fogMat.dispose();
      fogTexture.dispose();
    };
  }, [lobby, isSingleplayer, aiOpponents]);

  // Production queue controller triggers
  const handleTrainUnit = (unitType: UnitType) => {
    const uProps = getFactionUnitProperties(unitType, selfPlayer.faction);
    const cost = uProps.cost;
    if (credits < cost) {
      pushNotification('Недостаточно средств для мобилизации сил.', 'warn');
      return;
    }

    // Match appropriate structure for recruiting/production
    let requiredBuildingType: BuildingType = 'war_factory';
    if (unitType === 'builder') {
      requiredBuildingType = 'command_center';
    } else if (unitType === 'harvester') {
      requiredBuildingType = 'war_factory';
    } else {
      const isInfantry = ['drone_scout', 'drone_kamikaze', 'cyber_specops'].includes(unitType);
      requiredBuildingType = isInfantry ? 'barracks' : 'war_factory';
    }

    const sim = simulationRef.current;
    const producingFactory = sim.entities.find(
      e => e.playerId === playerId && e.subType === requiredBuildingType && e.state !== 'dead'
    );

    if (!producingFactory) {
      const bNames: Record<BuildingType, string> = {
        command_center: 'Штаб Командования',
        power_plant: 'Электростанция',
        supply_refinery: 'Центр Снабжения',
        barracks: 'Казармы Дронов',
        war_factory: 'Военный Завод',
        defense_turret: 'Защитная Турель',
        oil_derrick: 'Нефтяная Вышка',
        civilian_building: 'Городское Здание'
      };
      pushNotification(`Для производства требуется готовое здание: ${bNames[requiredBuildingType]}!`, 'warn');
      return;
    }

    // Deduct cash flow
    sim.credits -= cost;
    setCredits(sim.credits);
    sound.playClick();

    const unitId = `u_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const actionObj: GameActionEvent = {
      event: 'produce_unit',
      unitType,
      factoryId: producingFactory.id,
      id: unitId
    };

    // Spawn locally instantly
    sim.entities.push({
      id: unitId,
      type: 'unit',
      subType: unitType,
      playerId,
      team: selfPlayer.team,
      health: uProps.hp,
      maxHealth: uProps.hp,
      x: producingFactory.x,
      z: producingFactory.z + 2, // rollout door offsets
      angle: Math.PI,
      state: 'idle'
    });

    // Relay action over socket
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'sync_action',
        action: actionObj
      }));
    }

    pushNotification(`${uProps.name} выходит со сборочной линии.`, 'success');
  };

  const activeConstructionMode = (type: BuildingType) => {
    sound.playSelect();
    simulationRef.current.buildingToPlace = type;
    setBuildingToPlace(type);
    pushNotification(`Сектор развертывания выбран. Кликните левой кнопкой на плоской поверхности, чтобы построить.`, 'info');
  };

  const handleCommandStrikeSelection = () => {
    if (commandCharge < 100) return;
    sound.playSelect();
    simulationRef.current.commandStrikeActive = true;
    setCommandStrikeActive(true);
    pushNotification(`Лазерный прицел супероружия захвачен. Выберите цель штурма левой кнопкой мыши!`, 'warn');
  };

  // Minimap interactions teleport cameras around board
  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const pz = (e.clientY - box.top) / box.height;

    const sim = simulationRef.current;
    sim.camX = (1 - px) * lobby.mapSize;
    sim.camZ = (1 - pz) * lobby.mapSize; // vertical flip match
    sound.playClick();
  };

  const simForUI = simulationRef.current;
  const selectedEntities = simForUI.entities.filter(ent => selectedEntityIds.includes(ent.id));
  
  const hasSelectedBuilder = selectedEntities.some(ent => ent.type === 'unit' && ent.subType === 'builder');
  const hasSelectedCC = selectedEntities.some(ent => ent.type === 'building' && ent.subType === 'command_center');
  const hasSelectedBarracks = selectedEntities.some(ent => ent.type === 'building' && ent.subType === 'barracks');
  const hasSelectedWarFactory = selectedEntities.some(ent => ent.type === 'building' && ent.subType === 'war_factory');
  const isContextActive = hasSelectedBuilder || hasSelectedCC || hasSelectedBarracks || hasSelectedWarFactory;

  return (
    <div className="h-[100dvh] w-screen bg-[#070b0e] text-slate-100 flex flex-col relative select-none font-sans overflow-hidden">
      {/* 3D Viewport container */}
      <div ref={mountRef} className="flex-1 w-full h-full cursor-crosshair relative" />

      {/* Visible drag selection box overlay */}
      {dragSelection && (
        <div
          className="absolute border border-cyan-400 bg-cyan-400/15 pointer-events-none z-50 rounded"
          style={{
            left: Math.min(dragSelection.x1, dragSelection.x2),
            top: Math.min(dragSelection.y1, dragSelection.y2),
            width: Math.abs(dragSelection.x2 - dragSelection.x1),
            height: Math.abs(dragSelection.y2 - dragSelection.y1),
          }}
        />
      )}

      {/* Top HUD Controls Panel bar */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none z-20">
        {/* Cash flow index card */}
        <div className="ui-panel ui-railed clip-bevel-sm p-3 px-4 flex items-center gap-5 pointer-events-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/12 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] text-slate-500 tracking-[0.16em] uppercase">Бюджет</p>
              <p className="text-lg font-bold font-mono text-emerald-400 leading-tight">${credits}</p>
            </div>
          </div>
          <div className="w-px h-8 bg-slate-700/50" />
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${powerGenerated >= powerRequired ? 'bg-cyan-500/12 border-cyan-500/30 text-cyan-400' : 'bg-rose-500/12 border-rose-500/40 text-rose-400'}`}>
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] text-slate-500 tracking-[0.16em] uppercase">Энергосеть</p>
              <p className={`text-sm font-bold font-mono leading-tight ${powerGenerated >= powerRequired ? 'text-cyan-400' : 'text-rose-500 animate-pulse'}`}>
                {powerRequired} / {powerGenerated} ГВт
                {powerGenerated < powerRequired && <span className="ml-1 text-[10px]">АВАРИЯ</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Quick exit — offset left so it never hides behind the global
            fullscreen + sound controls pinned at the top-right corner. */}
        <button
          onClick={onExitGame}
          className="ui-btn ui-btn-ghost clip-bevel-sm px-3.5 py-2.5 text-xs uppercase tracking-wide pointer-events-auto mr-[104px]"
        >
          <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Выйти</span>
        </button>
      </div>

      {/* Absolute Compact Tactical Alerts in Top-Left under Budget card */}
      <div className="absolute top-[102px] left-6 flex flex-col gap-0.5 max-w-sm pointer-events-none z-30">
        {notifications.map(n => (
          <div
            key={n.id}
            className={`text-[11px] font-mono font-bold tracking-wide transition-all duration-300 animate-slide-in drop-shadow-[0_1.5px_2px_rgba(0,0,0,1)] uppercase ${
              n.type === 'warn'
                ? 'text-rose-400'
                : n.type === 'success'
                ? 'text-emerald-400'
                : 'text-cyan-300'
            }`}
          >
            ● {n.text}
          </div>
        ))}
      </div>

      {/* Modern Bottom Horizontal HUD Command Panel containing minimap, tactical superweapon, and dynamic assembly yards */}
      <div className={`absolute left-2 right-2 bottom-2 md:left-4 md:right-4 md:bottom-4 max-h-[46vh] md:max-h-none h-auto md:h-[224px] ui-panel ui-railed p-2 md:p-4 flex flex-row gap-2 md:gap-5 z-20 transition-all duration-300 ease-in-out ${isMenuCollapsed ? 'translate-y-[calc(100%-12px)] opacity-40 hover:opacity-100' : ''}`}>

        {/* Toggle Collapse handle anchored on top border of panel */}
        <button
          onClick={() => setIsMenuCollapsed(!isMenuCollapsed)}
          className="absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-6 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-t-lg flex items-center justify-center text-slate-350 cursor-pointer shadow-lg z-30"
          title={isMenuCollapsed ? "Развернуть панель" : "Свернуть панель"}
        >
          {isMenuCollapsed ? (
            <ChevronUp className="w-4 h-4 text-cyan-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {/* 1. Left Section: Radar Minimap with colored indicator targets */}
        <div className="w-24 md:w-44 select-none shrink-0 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1 md:mb-1.5">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-slate-400 uppercase flex items-center gap-1.5">
              <Radar className="w-3.5 h-3.5 text-cyan-400" /> <span className="hidden md:inline">Радар</span>
            </h3>
            <span className="text-[9px] text-emerald-300 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/25 uppercase tracking-wider hidden md:flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-emerald-400" /> онлайн
            </span>
          </div>

          <div
            onClick={handleMinimapClick}
            className="w-24 h-24 md:w-[164px] md:h-[164px] bg-[#0b1016] border border-slate-800 rounded-lg relative overflow-hidden cursor-crosshair shadow-inner mx-auto md:mx-0"
            style={{
              backgroundImage: `radial-gradient(circle at center, rgba(8, 145, 178, 0.1) 1px, transparent 1px)`,
              backgroundSize: '16px 16px'
            }}
          >
            {/* Symmetrical Starting bases overlayed on mini viewport (only once explored) */}
            {simulationRef.current.map?.resourceSpots
              .filter(spot => !fogQueryRef.current || fogQueryRef.current.explored(spot.x, spot.z))
              .map((spot, idx) => (
              <div
                key={idx}
                className="absolute w-2 h-2 bg-yellow-500 rounded-full border border-black animate-pulse"
                style={{
                  left: `${(1 - spot.x / lobby.mapSize) * 100}%`,
                  top: `${(1 - spot.z / lobby.mapSize) * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              />
            ))}

            {/* Active player HQ hubs dots representing base zones */}
            {simulationRef.current.entities.map(ent => {
              if (ent.state === 'dead') return null;
              
              const owner = simulationRef.current.players.find(p => p.id === ent.playerId) || selfPlayer;
              const isFriendly = ent.playerId === playerId;

              // Hide enemy units that are cloaked under a Mobile Jammer
              const isTargetCloaked = ent.type === 'unit' && ent.subType !== 'mobile_jammer' && simulationRef.current.entities.some(j => 
                j.state !== 'dead' &&
                j.subType === 'mobile_jammer' &&
                j.playerId === ent.playerId &&
                Math.sqrt((j.x - ent.x)*(j.x - ent.x) + (j.z - ent.z)*(j.z - ent.z)) < 8.0
              );

              if (isTargetCloaked && !isFriendly) return null;

              // Fog of war on the radar: enemies/neutrals only show where we
              // currently have vision (own forces are always tracked).
              const isOwnTeam = ent.team === selfPlayer.team;
              if (!isOwnTeam && fogQueryRef.current && !fogQueryRef.current.visible(ent.x, ent.z)) return null;

              return (
                <div
                  key={ent.id}
                  className={`absolute rounded-xs shadow-sm ${ent.type === 'building' ? 'w-2 h-2 scale-125 rotate-45' : 'w-1 h-1'}`}
                  style={{
                    backgroundColor: owner.color,
                    left: `${(1 - ent.x / lobby.mapSize) * 100}%`,
                    top: `${(1 - ent.z / lobby.mapSize) * 100}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              );
            })}

            {/* Real-time Player Viewport Camera Frame indicator */}
            <div
              className="absolute border border-dashed border-cyan-400/80 pointer-events-none rounded-xs bg-cyan-500/5 transition-all duration-75"
              style={{
                width: `${(26 / lobby.mapSize) * 100}%`,
                height: `${(20 / lobby.mapSize) * 100}%`,
                left: `${(1 - camPos.x / lobby.mapSize) * 100}%`,
                top: `${(1 - camPos.z / lobby.mapSize) * 100}%`,
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 6px rgba(34, 211, 238, 0.25)'
              }}
            >
              {/* Retro tiny viewfinder corner brackets */}
              <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-cyan-400" />
              <div className="absolute top-0 right-0 w-1 h-1 border-t border-r border-cyan-400" />
              <div className="absolute bottom-0 left-0 w-1 h-1 border-b border-l border-cyan-400" />
              <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-cyan-400" />
            </div>

            {/* Scanning radar sweep visually layered */}
            <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/0 via-cyan-500/5 to-cyan-500/0 animate-radar-sweep pointer-events-none" />
          </div>
        </div>

        {/* 2. Center Section: Command Power Charges */}
        <div className="w-36 md:w-64 flex flex-col justify-center border-l border-r border-slate-800/80 px-2 md:px-5 shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <Target className={`w-4 h-4 shrink-0 ${commandCharge >= 100 ? 'text-cyan-400' : 'text-slate-500'}`} />
            <div className="min-w-0">
              <h4 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide leading-none">
                Супероружие
              </h4>
              <span className="text-[10px] text-cyan-400 font-semibold truncate block">{getCommandPowerName(selfPlayer.faction)}</span>
            </div>
          </div>

          <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                commandCharge >= 100
                  ? 'bg-gradient-to-r from-cyan-400 to-cyan-500 animate-pulse'
                  : 'bg-cyan-600/70'
              }`}
              style={{ width: `${commandCharge}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[9px] font-mono mt-1 text-slate-400">
            <span className="uppercase tracking-wide">Заряд</span>
            <span className={commandCharge >= 100 ? "text-cyan-400 font-bold" : "text-cyan-600"}>{commandCharge}%</span>
          </div>

          <button
            onClick={handleCommandStrikeSelection}
            disabled={commandCharge < 100}
            className={`ui-btn w-full mt-3 text-xs uppercase tracking-wide py-2.5 ${
              commandCharge >= 100 ? 'ui-btn-primary clip-bevel-sm' : 'ui-btn-ghost'
            }`}
          >
            {commandCharge >= 100 ? <><Crosshair className="w-3.5 h-3.5" /> Нанести удар</> : 'Идёт зарядка...'}
          </button>
        </div>

        {/* 3. Right Section: Structure Deployers / Factories recruiters */}
        <div className="flex-1 flex flex-col justify-center overflow-y-auto overflow-x-hidden min-w-0">
          <div className="w-full h-full flex flex-col justify-center">
            
            {/* Context: Builder selected */}
            {hasSelectedBuilder && (
              <div className="animate-fade-in flex flex-col h-full justify-between">
                <div className="flex justify-between items-center mb-1.5 md:mb-2">
                  <h4 className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold">РАЗВЕРТЫВАНИЕ СТРОЕНИЙ (СТРОИТЕЛЬ ПРЯМОГО ПОДЧИНЕНИЯ)</h4>
                  <span className="text-[9px] font-mono text-slate-500 hidden sm:inline">ВЫБЕРИТЕ ЗДАНИЕ И СЕКТОР КЛИКОМ НА КАРТЕ</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {(['power_plant', 'supply_refinery', 'oil_derrick', 'barracks', 'war_factory', 'defense_turret'] as BuildingType[]).map(key => {
                    const prop = getFactionBuildingProperties(key, selfPlayer.faction);
                    const active = buildingToPlace === key;
                    const canAfford = credits >= prop.cost;
                    return (
                      <button
                        key={key}
                        onClick={() => activeConstructionMode(key)}
                        onMouseEnter={() => setHoveredItem({ type: 'building', key })}
                        onMouseLeave={() => setHoveredItem(null)}
                        disabled={!canAfford}
                        className={`prod-btn ${active ? 'is-active' : ''}`}
                      >
                        <span className="text-[10px] font-bold uppercase truncate w-full">{getBuildingShortName(key)}</span>
                        <span className="text-[9px] font-mono font-bold text-emerald-400 mt-0.5">${prop.cost}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Context: Command Center selected */}
            {hasSelectedCC && (
              <div className="animate-fade-in flex flex-col h-full justify-between">
                <div className="mb-2">
                  <h4 className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold text-left">ШТАБ: ПОДГОТОВКА СТРОИТЕЛЬНЫХ ДРОНОВ</h4>
                  <span className="text-[9px] font-mono text-slate-500 hidden sm:inline">СТРОИТЕЛИ ИГРАЮТ КЛЮЧЕВУЮ РОЛЬ В СТРОИТЕЛЬСТВЕ СЕКТОРОВ</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {(['builder'] as UnitType[]).map(key => {
                    const prop = getFactionUnitProperties(key, selfPlayer.faction);
                    const canAfford = credits >= prop.cost;
                    return (
                      <button
                        key={key}
                        onClick={() => handleTrainUnit(key)}
                        onMouseEnter={() => setHoveredItem({ type: 'unit', key })}
                        onMouseLeave={() => setHoveredItem(null)}
                        disabled={!canAfford}
                        className="prod-btn"
                      >
                        <span className="text-[10px] font-bold uppercase truncate w-full">{getUnitShortName(key)}</span>
                        <span className="text-[9px] font-mono font-bold text-emerald-400 mt-0.5">${prop.cost}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Context: Barracks selected */}
            {hasSelectedBarracks && (
              <div className="animate-fade-in flex flex-col h-full justify-between">
                <div className="mb-2 flex justify-between items-center">
                  <h4 className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold text-left">КАЗАРМА: МОДУЛЬНАЯ СБОРКА РОБОТОТЕХНИКИ И ОТРЯДОВ</h4>
                  <span className="text-[9px] font-mono text-slate-500 hidden sm:inline">ДЕСАНТ И ДРОНЫ-КАМИКАДЗЕ ДЛЯ БЫСТРЫХ СХВАТОК</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {(['drone_scout', 'drone_kamikaze', 'cyber_specops'] as UnitType[]).map(key => {
                    const prop = getFactionUnitProperties(key, selfPlayer.faction);
                    const canAfford = credits >= prop.cost;
                    return (
                      <button
                        key={key}
                        onClick={() => handleTrainUnit(key)}
                        onMouseEnter={() => setHoveredItem({ type: 'unit', key })}
                        onMouseLeave={() => setHoveredItem(null)}
                        disabled={!canAfford}
                        className="prod-btn"
                      >
                        <span className="text-[10px] font-bold uppercase truncate w-full">{getUnitShortName(key)}</span>
                        <span className="text-[9px] font-mono font-bold text-emerald-400 mt-0.5">${prop.cost}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Context: War Factory selected */}
            {hasSelectedWarFactory && (
              <div className="animate-fade-in flex flex-col h-full justify-between">
                <div className="mb-2 flex justify-between items-center">
                  <h4 className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold text-left">ВОЕННЫЙ ЗАВОД: СБОРКА ТЯЖЕЛОЙ БРОНЕТЕХНИКИ</h4>
                  <span className="text-[9px] font-mono text-slate-500 hidden sm:inline">ПРОИЗВОДИТЕЛЬ ТАНКОВ, РСЗО, ГАРВЕСТЕРОВ И ПОДАВИТЕЛЕЙ ПОМЕХ</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                  {(['precision_tank', 'artillery_mlrs', 'mobile_jammer', 'harvester'] as UnitType[]).map(key => {
                    const prop = getFactionUnitProperties(key, selfPlayer.faction);
                    const canAfford = credits >= prop.cost;
                    return (
                      <button
                        key={key}
                        onClick={() => handleTrainUnit(key)}
                        onMouseEnter={() => setHoveredItem({ type: 'unit', key })}
                        onMouseLeave={() => setHoveredItem(null)}
                        disabled={!canAfford}
                        className="prod-btn"
                      >
                        <span className="text-[10px] font-bold uppercase truncate w-full">{getUnitShortName(key)}</span>
                        <span className="text-[9px] font-mono font-bold text-emerald-400 mt-0.5">${prop.cost}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Default: HQ instructions if no building is selected */}
            {!isContextActive && (
              <div className="bg-slate-950/40 border border-slate-900/85 p-3.5 rounded-xl text-center space-y-3 shadow-inner">
                <p className="text-[11px] font-mono text-cyan-500 animate-pulse uppercase tracking-widest font-bold">ОПЕРАТИВНЫЙ ШТАБ</p>
                <p className="text-[10px] text-slate-400 leading-normal">
                  Кликните по дружественному <span className="text-slate-200 font-semibold uppercase">Штабу</span>, <span className="text-slate-200 font-semibold uppercase">Строителю</span> или <span className="text-slate-200 font-semibold uppercase">Заводу</span> на поле боя для активации меню заказов.
                </p>
                <div className="flex flex-col items-stretch gap-1 text-[10px] font-mono border-t border-slate-900/60 pt-2 text-slate-500">
                  <div className="flex justify-between">
                    <span>ФРАКЦИЯ:</span>
                    <span className="text-slate-350 font-bold uppercase text-cyan-400">{selfPlayer.faction}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ЛИМИТ НА КАРТЕ:</span>
                    <span className="text-slate-350">{simulationRef.current?.entities.filter(e => e.playerId === playerId && e.state !== 'dead').length || 0} ЕД.</span>
                  </div>
                </div>
              </div>
            )}

            {/* Gorgeous glowing 2-second hover tooltip display */}
            {hoveredItem && tooltipVisible && (
              <div className="border border-cyan-800/45 bg-cyan-950/25 p-3 rounded-xl animate-fade-in shadow-lg text-left">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10.5px] font-bold text-cyan-300 uppercase">
                    {hoveredItem.type === 'unit' 
                      ? getFactionUnitProperties(hoveredItem.key as UnitType, selfPlayer.faction).name 
                      : getFactionBuildingProperties(hoveredItem.key as BuildingType, selfPlayer.faction).name}
                  </span>
                  <span className="text-[9px] font-mono font-bold text-emerald-400">
                    ${hoveredItem.type === 'unit' 
                      ? getFactionUnitProperties(hoveredItem.key as UnitType, selfPlayer.faction).cost 
                      : getFactionBuildingProperties(hoveredItem.key as BuildingType, selfPlayer.faction).cost}
                  </span>
                </div>
                <p className="text-[10px] text-cyan-200/70 leading-relaxed font-mono">
                  {hoveredItem.type === 'unit' 
                    ? getFactionUnitProperties(hoveredItem.key as UnitType, selfPlayer.faction).desc 
                    : getFactionBuildingProperties(hoveredItem.key as BuildingType, selfPlayer.faction).desc}
                </p>
              </div>
            )}

          </div>
        </div>

      </div>



      {/* Mobile-tailored Touch Actions Dashboard — pinned to the top centre so it
          never collides with the bottom command panel (which now fits on screen). */}
      {isMobile && (
        <div className="absolute top-[58px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 pointer-events-none z-30 animate-fade-in max-w-[94vw]">
          {/* Active Help Bar */}
          <div className="bg-slate-950/90 text-cyan-400 border border-cyan-500/30 text-[10px] uppercase font-mono px-3 py-1 rounded-full shadow-lg backdrop-blur shadow-black/60 text-center">
            {buildingToPlace ? (
              <span className="text-yellow-400 animate-pulse">● СТРОИТЕЛЬСТВО — Тапните по карте</span>
            ) : commandStrikeActive ? (
              <span className="text-rose-400 animate-pulse">● УДАР — Выберите координаты</span>
            ) : selectedEntityIds.length > 0 ? (
              <span className="text-emerald-400 font-bold">● ВЫБРАНО: {selectedEntityIds.length} — Тап: Движение/Атака</span>
            ) : (
              <span>🟢 2× ТАП — ВЫБОР • 2× ТАП+ДЕРЖАТЬ — РАМКА</span>
            )}
          </div>

          {/* Action Deck */}
          <div className="ui-panel p-1.5 flex items-center justify-center gap-1.5 pointer-events-auto">

            {/* Tactical actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const sim = simulationRef.current;
                  if (!sim) return;
                  const combatIds = sim.entities
                    .filter(ent => ent.playerId === playerId && ent.state !== 'dead' && ent.type === 'unit' && ent.subType !== 'builder')
                    .map(ent => ent.id);
                  sim.selectedIds = combatIds;
                  setSelectedEntityIds(combatIds);
                  sound.playSelect();
                  pushNotification(`Выбрана боевая армия: ${combatIds.length} ед.`, 'success');
                }}
                className="bg-slate-950 hover:bg-slate-850 text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 px-2.5 py-2 rounded-lg text-[9.5px] font-bold uppercase font-mono tracking-wider transition cursor-pointer"
              >
                Войска ({simulationRef.current?.entities.filter(e => e.playerId === playerId && e.state !== 'dead' && e.type === 'unit' && e.subType !== 'builder').length || 0})
              </button>

              {selectedEntityIds.length > 0 && (
                <button
                  onClick={() => {
                    const sim = simulationRef.current;
                    if (!sim) return;
                    sim.selectedIds = [];
                    setSelectedEntityIds([]);
                    sound.playSelect();
                  }}
                  className="bg-slate-950 hover:bg-slate-850 text-slate-400 hover:text-slate-250 border border-slate-800 px-2.5 py-2 rounded-lg text-[9.5px] font-mono uppercase transition cursor-pointer"
                >
                  Сбросить
                </button>
              )}

              {/* Cancel State button (only shown if building or superweapon active) */}
              {(buildingToPlace || commandStrikeActive) && (
                <button
                  onClick={() => {
                    const sim = simulationRef.current;
                    if (!sim) return;
                    if (sim.buildingToPlace) {
                      sim.buildingToPlace = null;
                      setBuildingToPlace(null);
                      pushNotification('Строительство отменено', 'info');
                    }
                    if (sim.commandStrikeActive) {
                      sim.commandStrikeActive = false;
                      setCommandStrikeActive(false);
                      pushNotification('Удар отменен', 'info');
                    }
                    sound.playClick();
                  }}
                  className="bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 px-3 py-2 rounded-lg text-[9.5px] font-bold uppercase transition animate-pulse cursor-pointer"
                >
                  Отмена
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Screen edge scrolls overlay helper blocks */}
      <div className="absolute inset-x-0 top-0 h-1 pointer-events-none hover:bg-cyan-500/10 cursor-n-resize transition" />
      <div className="absolute inset-y-0 right-0 w-1 pointer-events-none hover:bg-cyan-500/10 cursor-e-resize transition" />
      <div className="absolute inset-x-0 bottom-0 h-1 pointer-events-none hover:bg-cyan-500/10 cursor-s-resize transition" />
      <div className="absolute inset-y-0 left-0 w-1 pointer-events-none hover:bg-cyan-500/10 cursor-w-resize transition" />
    </div>
  );
}
