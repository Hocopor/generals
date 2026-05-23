import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Faction, Lobby, Player, GameEntity, BuildingType, UnitType, GameActionEvent } from '../types';
import { sound } from '../utils/audio';
import { generateProceduralMap, GeneratedMap, MapNode } from '../utils/mapGenerator';
import { Shield, Zap, Sparkles, Swords, Play, Compass, RefreshCw, AlertTriangle } from 'lucide-react';

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
  precision_tank: { name: 'Лазерный Танк', hp: 260, speed: 1.1, range: 6.0, dps: 32, cost: 500, desc: 'Основная боевая машина. Высокая броня и прочность.' },
  artillery_mlrs: { name: 'РСЗО Торнадо', hp: 130, speed: 0.8, range: 11.0, dps: 45, cost: 650, desc: 'Тяжелая ракетная артиллерия дальнего боя. Осадный специалист.' },
  mobile_jammer: { name: 'РЭБ Глушитель', hp: 160, speed: 1.3, range: 0, dps: 0, cost: 400, desc: 'Отключает вражеские турели и маскирует союзников поблизости.' }
};

const BUILDING_PROPERTIES: Record<BuildingType, { name: string; hp: number; cost: number; power: number; desc: string }> = {
  command_center: { name: 'Штаб Командования', hp: 1500, cost: 1200, power: 30, desc: 'Главная база. Генерирует бюджет и обеспечивает работу радара.' },
  power_plant: { name: 'Электростанция', hp: 500, cost: 300, power: 100, desc: 'Вырабатывает энергию для обеспечения работы баз.' },
  supply_refinery: { name: 'Нефтевышка', hp: 800, cost: 400, power: -20, desc: 'Размещается на нефтяных точках для добычи ресурсов и пополнения бюджета.' },
  barracks: { name: 'Казармы Дронов', hp: 600, cost: 350, power: -15, desc: 'Обучает ССО и производит тактические беспилотники.' },
  war_factory: { name: 'Военный Завод', hp: 850, cost: 600, power: -25, desc: 'Строит наземную технику: танки, артиллерию и машины РЭБ.' },
  defense_turret: { name: 'Лазерная Турель', hp: 700, cost: 350, power: -20, desc: 'Автоматическая оборонительная турель против наземных и воздушных целей.' }
};

// Helper to get smooth terrain height using bilinear interpolation
function getTerrainHeight(x: number, z: number, map: GeneratedMap): number {
  if (!map || !map.nodes) return 0;
  
  const x1 = Math.floor(x);
  const z1 = Math.floor(z);
  const x2 = Math.ceil(x);
  const z2 = Math.ceil(z);
  
  const h11 = (map.nodes[x1] && map.nodes[x1][z1]) ? map.nodes[x1][z1].height * 1.5 : 0;
  const h21 = (map.nodes[x2] && map.nodes[x2][z1]) ? map.nodes[x2][z1].height * 1.5 : 0;
  const h12 = (map.nodes[x1] && map.nodes[x1][z2]) ? map.nodes[x1][z2].height * 1.5 : 0;
  const h22 = (map.nodes[x2] && map.nodes[x2][z2]) ? map.nodes[x2][z2].height * 1.5 : 0;
  
  const tx = x - x1;
  const tz = z - z1;
  
  const top = h11 * (1 - tx) + h21 * tx;
  const bottom = h12 * (1 - tx) + h22 * tx;
  
  return top * (1 - tz) + bottom * tz;
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
  const [buildingToPlace, setBuildingToPlace] = useState<BuildingType | null>(null);
  const [productionQueue, setProductionQueue] = useState<{ buildingId: string; type: UnitType; progress: number }[]>([]);
  const [commandStrikeActive, setCommandStrikeActive] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<{ id: string; text: string; type: 'info' | 'warn' | 'success' }[]>([]);

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
      const bObj: GameEntity = {
        id: `spawn_cc_${base.playerId}`,
        type: 'building',
        subType: 'command_center',
        playerId: base.playerId,
        team: base.team,
        health: BUILDING_PROPERTIES.command_center.hp,
        maxHealth: BUILDING_PROPERTIES.command_center.hp,
        x: base.x,
        z: base.z,
        angle: 0,
        state: 'idle',
        buildProgress: 1
      };
      startingEntities.push(bObj);

      // Start with some defensive guards nearby starting bases
      const guardTypes: UnitType[] = ['drone_scout', 'precision_tank'];
      guardTypes.forEach((gt, uIdx) => {
        const theta = (uIdx * 2 * Math.PI) / guardTypes.length;
        startingEntities.push({
          id: `spawn_guard_${base.playerId}_${uIdx}`,
          type: 'unit',
          subType: gt,
          playerId: base.playerId,
          team: base.team,
          health: UNIT_PROPERTIES[gt].hp,
          maxHealth: UNIT_PROPERTIES[gt].hp,
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

    // Set vertex heights matching map nodes
    const posAttr = terrainGeo.attributes.position;
    for (let x = 0; x < gridS; x++) {
      for (let z = 0; z < gridS; z++) {
        const heightVal = map.nodes[x][z].height;
        // Vertices are ordered differently, but we search matching index
        for (let i = 0; i < posAttr.count; i++) {
          const vx = posAttr.getX(i);
          const vz = posAttr.getZ(i);
          if (Math.abs(vx - x) < 0.1 && Math.abs(vz - z) < 0.1) {
            // Apply a nice elevation factor
            posAttr.setY(i, heightVal * 1.5);
          }
        }
      }
    }
    terrainGeo.computeVertexNormals();

    // Material matching sleek grid shader look without heavy outside patterns
    const terrainMat = new THREE.MeshStandardMaterial({
      color: '#1a222c',
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true,
      vertexColors: false
    });

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Add a modern wireframe grid sitting slightly above terrain to trace heights
    const wireGeo = terrainGeo.clone();
    wireGeo.translate(0, 0.02, 0); // lift slightly
    const wireMat = new THREE.MeshBasicMaterial({
      color: '#0891b2',
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    scene.add(wireMesh);

    // Add resource spots explicitly with cool spinning oil rigs and yellow light flares!
    const resourceGeoms: THREE.Group[] = [];
    map.resourceSpots.forEach(spot => {
      const group = new THREE.Group();
      group.position.set(spot.x, 0.05, spot.z);

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
        }

        scene.add(decGroup);
      });
    }

    // 5. Visual representations/models of Game Entities mapped by entity ID
    const entityMeshes: Map<string, THREE.Group> = new Map();

    function constructModel(ent: GameEntity, colorHex: string): THREE.Group {
      const g = new THREE.Group();
      const pColor = new THREE.Color(colorHex);

      if (ent.type === 'building') {
        const structuralHull = new THREE.MeshStandardMaterial({ color: '#374151', metalness: 0.8, roughness: 0.3 });
        const glowingCore = new THREE.MeshBasicMaterial({ color: pColor });

        if (ent.subType === 'command_center') {
          // Large heavy base building
          const base = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.5, 3.5), structuralHull);
          base.position.y = 0.75;
          base.castShadow = true;
          base.receiveShadow = true;
          g.add(base);

          const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, 1, 8), glowingCore);
          core.position.y = 1.5 + 0.5;
          g.add(core);

          // Radar dish antenna
          const radMount = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7), structuralHull);
          radMount.position.set(1.2, 1.5, 1.2);
          g.add(radMount);

          const radarDish = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.4, 8), glowingCore);
          radarDish.rotation.z = Math.PI / 4;
          radarDish.position.set(1.2, 1.9, 1.2);
          radarDish.name = 'radar_dish'; // can animate spinning
          g.add(radarDish);

        } else if (ent.subType === 'power_plant') {
          // Circular cylinder building
          const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1.8, 8), structuralHull);
          base.position.y = 0.9;
          base.castShadow = true;
          g.add(base);

          const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.2, 6, 16), glowingCore);
          ring1.rotation.x = Math.PI / 2;
          ring1.position.y = 1.2;
          g.add(ring1);

          const lightningCone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1, 4), glowingCore);
          lightningCone.position.y = 1.8 + 0.5;
          g.add(lightningCone);

        } else if (ent.subType === 'supply_refinery') {
          // Tall refinery tower blocks
          const refineryBase = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.2, 2.5), structuralHull);
          refineryBase.position.y = 0.6;
          g.add(refineryBase);

          const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 2.8, 8), structuralHull);
          chimney.position.set(-0.6, 1.4, -0.6);
          chimney.castShadow = true;
          g.add(chimney);

          const flameTip = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 8), glowingCore);
          flameTip.position.set(-0.6, 2.8 + 0.3, -0.6);
          g.add(flameTip);

          // Rotating automated oil pump arm
          const pumpRig = new THREE.Group();
          pumpRig.position.set(0.6, 1.2, 0);

          const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), structuralHull);
          shaft.position.y = 0.6;
          pumpRig.add(shaft);

          const walkingBeam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.3), glowingCore);
          walkingBeam.position.set(0.4, 1.2, 0);
          walkingBeam.name = 'pump_arm'; // animate pivot
          pumpRig.add(walkingBeam);

          g.add(pumpRig);

        } else if (ent.subType === 'barracks') {
          // Circular command dome
          const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 2, 1.6, 8), structuralHull);
          dome.position.y = 0.8;
          g.add(dome);

          const landingPad = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), glowingCore);
          landingPad.position.set(0, 0.1, 0);
          g.add(landingPad);

        } else if (ent.subType === 'war_factory') {
          // Blocky open-door vehicle assembly building
          const hangar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 2.4), structuralHull);
          hangar.position.y = 0.9;
          g.add(hangar);

          // Glowing internal scanner grid
          const gate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.2), glowingCore);
          gate.position.set(0, 0.6, 1.22);
          g.add(gate);

        } else if (ent.subType === 'defense_turret') {
          // Ground base plus high railgun turret neck turn
          const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1, 8), structuralHull);
          turretBase.position.y = 0.5;
          g.add(turretBase);

          // Head turning part
          const neckGroup = new THREE.Group();
          neckGroup.position.y = 1;
          neckGroup.name = 'railgun_head';

          const headBlock = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), structuralHull);
          headBlock.position.y = 0.25;
          neckGroup.add(headBlock);

          // Heavy gun tubes
          const barrel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6), glowingCore);
          barrel1.rotation.x = Math.PI / 2;
          barrel1.position.set(-0.22, 0.25, -0.6);
          neckGroup.add(barrel1);

          const barrel2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6), glowingCore);
          barrel2.rotation.x = Math.PI / 2;
          barrel2.position.set(0.22, 0.25, -0.6);
          neckGroup.add(barrel2);

          g.add(neckGroup);
        }
      } else {
        // ENTTY IS UNIT
        const vehicleHull = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.5 });
        const dynamicCoating = new THREE.MeshStandardMaterial({ color: pColor, roughness: 0.3 });

        if (ent.subType === 'drone_scout') {
          // Quadcopter layout mesh
          const frame = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), vehicleHull);
          frame.position.y = 0.65;
          g.add(frame);

          const rotRings = new THREE.Group();
          rotRings.name = 'rotors';

          // 4 corner rotors
          const rPosCoords = [
            [-0.4, 0.65, -0.4],
            [0.4, 0.65, -0.4],
            [-0.4, 0.65, 0.4],
            [0.4, 0.65, 0.4]
          ];
          rPosCoords.forEach((coord, rIdx) => {
            const rotBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1), vehicleHull);
            rotBase.position.set(coord[0], coord[1], coord[2]);
            rotRings.add(rotBase);

            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.02, 0.06), dynamicCoating);
            blade.position.set(coord[0], coord[1] + 0.05, coord[2]);
            blade.name = `blade_${rIdx}`;
            rotRings.add(blade);
          });
          g.add(rotRings);

        } else if (ent.subType === 'drone_kamikaze') {
          // Delta wing flying rocket drone
          const wing = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 3), dynamicCoating);
          wing.rotation.x = Math.PI / 2; // point forward
          wing.position.y = 0.8;
          g.add(wing);

          const spinBlade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.04), vehicleHull);
          spinBlade.position.set(0, 0.8, -0.56);
          spinBlade.name = 'rear_prop';
          g.add(spinBlade);

        } else if (ent.subType === 'cyber_specops') {
          // Special infantry model cylinders
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.8, 8), vehicleHull);
          body.position.y = 0.4;
          g.add(body);

          const visor = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: pColor }));
          visor.position.set(0, 0.72, 0.1);
          g.add(visor);

        } else if (ent.subType === 'precision_tank') {
          // Combat tank - body tread plus separate head pivoting towards targets!
          const treads = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.8), vehicleHull);
          treads.position.y = 0.2;
          g.add(treads);

          const plate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 1.5), dynamicCoating);
          plate.position.y = 0.4 + 0.1;
          g.add(plate);

          const pivotTurret = new THREE.Group();
          pivotTurret.position.y = 0.6;
          pivotTurret.name = 'tank_head';

          const headBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.4, 8), vehicleHull);
          headBlock.position.y = 0.2;
          pivotTurret.add(headBlock);

          const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.5, 6), dynamicCoating);
          gunBarrel.rotation.x = Math.PI / 2;
          // Extend out the front (+Z is front!)
          gunBarrel.position.set(0, 0.2, 0.75);
          pivotTurret.add(gunBarrel);

          g.add(pivotTurret);

        } else if (ent.subType === 'artillery_mlrs') {
          // Heavy truck MLRS carrying raised rocket pod
          const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 2.0), vehicleHull);
          body.position.y = 0.25;
          g.add(body);

          const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.5), dynamicCoating);
          cab.position.set(0, 0.55, 0.65);
          g.add(cab);

          const launcherPod = new THREE.Group();
          launcherPod.position.set(0, 0.5, -0.4);
          launcherPod.name = 'mlrs_barrel';

          const tubes = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.3), dynamicCoating);
          tubes.position.z = -0.3;
          launcherPod.add(tubes);

          g.add(launcherPod);

        } else if (ent.subType === 'mobile_jammer') {
          // EW Vehicle carrying rotating magenta ring radar antenna dish!
          const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.8), vehicleHull);
          body.position.y = 0.25;
          g.add(body);

          const radarDishBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6), dynamicCoating);
          radarDishBase.position.set(0, 0.7, 0);
          g.add(radarDishBase);

          const activeDish = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.08, 4, 16), new THREE.MeshBasicMaterial({ color: '#d946ef' }));
          activeDish.rotation.x = Math.PI / 2;
          activeDish.position.set(0, 1.0, 0);
          activeDish.name = 'ew_antenna';
          g.add(activeDish);
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
      isMouseDown = true;
      mouseDownPos.x = e.clientX;
      mouseDownPos.y = e.clientY;
    };

    const handleMouseUp = (e: MouseEvent) => {
      isMouseDown = false;
      mouseUpPos.x = e.clientX;
      mouseUpPos.y = e.clientY;

      const deltaX = Math.abs(mouseUpPos.x - mouseDownPos.x);
      const deltaY = Math.abs(mouseUpPos.y - mouseDownPos.y);

      // Simple Click Selection (vs drag box selector)
      if (deltaX < 6 && deltaY < 6) {
        // Compute intersected elements
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

          if (e.button === 0) {
            // Left click: select player entities underneath cursor
            const hitEntity = findEntityAt(pt.x, pt.z, 2.0);
            if (hitEntity && hitEntity.playerId === playerId) {
              sim.selectedIds = [hitEntity.id];
              sound.playSelect();
            } else {
              sim.selectedIds = []; // clicked plain terrain
            }
          } else if (e.button === 2) {
            // Right click: issue order to selected squad!
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
      } else {
        // Multi-Selecting Box sweep finished
        handleDragSelection(mouseDownPos, mouseUpPos);
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
      const cost = BUILDING_PROPERTIES[bType].cost;
      if (sim.credits < cost) {
        pushNotification('Insufficient funds to deploy building structures!', 'warn');
        sim.buildingToPlace = null;
        setBuildingToPlace(null);
        return;
      }

      // Check if location is clear of rivers/hills or other buildings
      if (map.nodes[x] === undefined || map.nodes[x][z] === undefined) return;
      const node = map.nodes[x][z];
      
      let blockedVal = false;
      if (node.type === 'water' || node.height > 1) blockedVal = true;
      
      // Can't place refinery over blank ground unless there is a resource Oil derrick spot there!
      if (bType === 'supply_refinery' && !node.resourceSpot) {
        pushNotification('Oil refineries can only be placed directly over strategic Oil Wells (Yellow towers)!', 'warn');
        sim.buildingToPlace = null;
        setBuildingToPlace(null);
        return;
      }

      // Check structural intersections
      sim.entities.forEach(ent => {
        if (ent.state === 'dead') return;
        const dx = Math.abs(ent.x - x);
        const dz = Math.abs(ent.z - z);
        if (ent.type === 'building' && dx < 3.0 && dz < 3.0) {
          blockedVal = true;
        }
      });

      if (blockedVal) {
        pushNotification('Terrain occupied or blocked. Deployment path interrupted.', 'warn');
        return;
      }

      // Create local building object
      const buildingId = `b_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const pObj: GameActionEvent = {
        event: 'build',
        buildingType: bType,
        x,
        z,
        id: buildingId
      };

      // Apply locally instantly
      sim.credits -= cost;
      setCredits(sim.credits);
      sound.playConstruction();

      sim.entities.push({
        id: buildingId,
        type: 'building',
        subType: bType,
        playerId,
        team: selfPlayer.team,
        health: BUILDING_PROPERTIES[bType].hp,
        maxHealth: BUILDING_PROPERTIES[bType].hp,
        x,
        z,
        angle: 0,
        state: 'constructing',
        buildProgress: 0.05
      });

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
      sound.playLaunch();

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

      sound.playExplosion();

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

    // Handles inbound Websocket notifications safely
    function handleSocketMessage(e: MessageEvent) {
      try {
        const data = JSON.parse(e.data);
        
        if (data.type === 'game_action') {
          const authorId = data.playerId;
          const act: GameActionEvent = data.action;

          if (act.event === 'build') {
            sound.playConstruction();
            sim.entities.push({
              id: act.id,
              type: 'building',
              subType: act.buildingType,
              playerId: authorId,
              team: getPlayerTeam(authorId),
              health: BUILDING_PROPERTIES[act.buildingType].hp,
              maxHealth: BUILDING_PROPERTIES[act.buildingType].hp,
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

            sim.entities.push({
              id: act.id,
              type: 'unit',
              subType: act.unitType,
              playerId: authorId,
              team: getPlayerTeam(authorId),
              health: UNIT_PROPERTIES[act.unitType].hp,
              maxHealth: UNIT_PROPERTIES[act.unitType].hp,
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
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const canvasDom = renderer.domElement;
    canvasDom.addEventListener('mousedown', handleMouseDown);
    canvasDom.addEventListener('mouseup', handleMouseUp);
    canvasDom.addEventListener('contextmenu', (e) => e.preventDefault()); // Stop native popup right clicks

    // 8. Main Animation Frame & RTS Simulation Tick loop
    let animationId: number;
    let tickCount = 0;

    // AI simulation scheduler runs once every ~3 seconds offline
    let lastAiTick = 0;

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
            scene.remove(mesh);
            entityMeshes.delete(ent.id);
          }
          return;
        }

        // Global cooldown tick decrement! Corrects lock conditions and EMP duration.
        if (ent.cooldown && ent.cooldown > 0) {
          ent.cooldown -= 1;
        }

        // Keep track of power variables
        if (ent.playerId === playerId) {
          if (ent.type === 'building' && ent.buildProgress && ent.buildProgress >= 1) {
            const props = BUILDING_PROPERTIES[ent.subType as BuildingType];
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

        // Building construction update ticks
        if (ent.type === 'building' && ent.state === 'constructing') {
          ent.buildProgress = (ent.buildProgress || 0) + 0.0015; // smooth delta
          mesh.scale.set(1, ent.buildProgress, 1); // rise above ground
          if (ent.buildProgress >= 1.0) {
            ent.buildProgress = 1.0;
            ent.state = 'idle';
            sound.playBuildComplete();
            pushNotification(`Structure construction blueprint finalized!`, 'success');
          }
        }

        // Units movement physics with standard soft collision and pathfinding avoidance
        if (ent.type === 'unit' && ent.state === 'moving' && ent.targetX !== undefined && ent.targetZ !== undefined) {
          const dx = ent.targetX - ent.x;
          const dz = ent.targetZ - ent.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          const maxSp = UNIT_PROPERTIES[ent.subType as UnitType].speed * 0.08;

          if (dist > 0.4) {
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
          } else {
            ent.state = 'idle';
          }
        }

        // Combat targeting firing checks
        if (ent.type === 'unit' && ent.state === 'idle') {
          // Auto acquire targets if idle
          let closestHostile: GameEntity | null = null;
          let minRange = (UNIT_PROPERTIES[ent.subType as UnitType]?.range || 5) + 2.5; // aggressive radius
          
          sim.entities.forEach(v => {
            if (v.state === 'dead' || v.team === ent.team) return;
            const dist = Math.sqrt((v.x - ent.x) * (v.x - ent.x) + (v.z - ent.z) * (v.z - ent.z));
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
          const victim = sim.entities.find(e => e.id === ent.targetId);
          if (!victim || victim.state === 'dead') {
            ent.state = 'idle';
            ent.targetId = undefined;
          } else {
            // Check distance to fire weapon spikes
            const dx = victim.x - ent.x;
            const dz = victim.z - ent.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            const props = UNIT_PROPERTIES[ent.subType as UnitType];

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
              if (!ent.cooldown || ent.cooldown <= 0) {
                ent.cooldown = 45; // default loop rate limit

                if (ent.subType === 'drone_kamikaze') {
                  ent.health = 0; // dies upon collision!
                  ent.state = 'dead';
                  sound.playExplosion();
                  // Instant damage for kamikaze
                  victim.health -= props.dps;
                  if (victim.health <= 0) {
                    victim.health = 0;
                    victim.state = 'dead';
                    pushNotification(`Meltdown on targeted enemy structural frame!`, 'warn');
                  }
                  return; // skips projectile creation
                }

                // Determine projectile visual and properties based on unit subtype
                const owner = sim.players.find(p => p.id === ent.playerId) || selfPlayer;
                let pType: 'machinegun' | 'shell' | 'rocket' | 'laser' = 'machinegun';
                let pColor = owner.color;
                let pSpeed = 0.5;

                if (ent.subType === 'precision_tank') {
                  pType = 'shell';
                  pColor = '#f59e0b'; // orange shell
                  pSpeed = 0.8;
                } else if (ent.subType === 'artillery_mlrs') {
                  pType = 'rocket';
                  pColor = '#eab308'; // rocket fire
                  pSpeed = 0.3;
                  ent.cooldown = 65; // slow reload
                } else if (ent.subType === 'cyber_specops' || ent.subType === 'drone_scout') {
                  pType = 'machinegun';
                  pColor = '#38bdf8'; // blueish tracers
                  pSpeed = 0.75;
                  ent.cooldown = 15; // fast fire
                }

                // Create mesh
                const pMesh = new THREE.Object3D();
                if (pType === 'shell') {
                  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 4), new THREE.MeshBasicMaterial({ color: pColor }));
                  m.rotation.x = Math.PI / 2;
                  pMesh.add(m);
                } else if (pType === 'rocket') {
                  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#4b5563' }));
                  m.rotation.x = Math.PI / 2;
                  const fire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.01, 0.3, 4), new THREE.MeshBasicMaterial({ color: pColor }));
                  fire.position.z = 0.4;
                  fire.rotation.x = Math.PI / 2;
                  pMesh.add(m);
                  pMesh.add(fire);
                } else {
                  // machinegun
                  const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.4), new THREE.MeshBasicMaterial({ color: pColor }));
                  pMesh.add(m);
                }

                const startHeight = mesh.position.y + (ent.subType === 'precision_tank' ? 0.3 : 0.1);
                
                // Muzzle flash particle
                const flash = new THREE.Mesh(new THREE.SphereGeometry(Math.random()*0.15 + 0.1, 4, 4), new THREE.MeshBasicMaterial({color: pColor}));
                flash.position.set(ent.x + Math.cos(angleVal)*0.5, startHeight, ent.z + Math.sin(angleVal)*0.5);
                scene.add(flash);
                explosionParticles.push({ mesh: flash, stepY: 0, life: 0.1, sizeShrink: 0.8 });

                pMesh.position.set(ent.x, startHeight, ent.z);
                // Look at target initially in flat 2D
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

                if (pType === 'machinegun') {
                  sound.playGunshot();
                } else if (pType === 'laser') {
                  sound.playLaser();
                } else {
                  sound.playLaunch();
                }
              }
            }
          }
        }

        // Automated Laser Turret Point Defense target acquisitions
        if (ent.subType === 'defense_turret' && ent.state !== 'constructing') {
          // Look for closest hostile within weapon radius
          let closestHostile: GameEntity | null = null;
          let minRange = 7.5; // active radius

          sim.entities.forEach(v => {
            if (v.state === 'dead' || v.team === ent.team) return;
            const dist = Math.sqrt((v.x - ent.x) * (v.x - ent.x) + (v.z - ent.z) * (v.z - ent.z));
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
              hBlock.rotation.y = -angleVal - Math.PI / 2; // sweep head
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
                  damage: 35 / (50/20), // Balance slightly lower since 20cd vs 40cd original = 40/20 instead of 50/20? Wait, original was 40. So 35 / (40/20) = 17.5.
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

              sound.playLaser();
            }
          }
        }
      });

      // Update particle explosions animation steps
      for (let i = explosionParticles.length - 1; i >= 0; i--) {
        const p = explosionParticles[i];
        p.mesh.position.y += p.stepY;
        if (p.stepX !== undefined) p.mesh.position.x += p.stepX;
        if (p.stepZ !== undefined) p.mesh.position.z += p.stepZ;
        if (p.sizeShrink !== undefined && p.mesh.scale.x > 0.01) {
          p.mesh.scale.multiplyScalar(p.sizeShrink);
        }

        p.life -= 0.02;
        if (p.life <= 0) {
          scene.remove(p.mesh);
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
                sound.playExplosion();
                if (targetEnt.type === 'building') {
                  pushNotification(`Вражеская структура разрушена!`, 'warn');
                }
             } else if (p.subType === 'rocket' || p.subType === 'shell') {
                sound.playExplosion(); // smaller explosive thump
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
            if (powerPlants.length === 0 && aiState.timer >= 10) {
              const bx = aiCc.x - 5;
              const bz = aiCc.z - 2;
              sim.entities.push({
                id: `ai_pp_${Date.now()}`,
                type: 'building',
                subType: 'power_plant',
                playerId: p.id,
                team: p.team,
                health: BUILDING_PROPERTIES.power_plant.hp,
                maxHealth: BUILDING_PROPERTIES.power_plant.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing', // Nice rise animated build!
                buildProgress: 0.05
              });
              pushNotification(`Зафиксирована тепловая сигнатура постройки противника!`, 'info');
            }

            else if (refineries.length === 0 && powerPlants.length > 0 && aiState.timer >= 25) {
              // Find closest strategic derrick
              let nearestDerrick: { x: number; z: number } | null = null;
              let dSqMin = 45 * 45;
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
                sim.entities.push({
                  id: `ai_ref_${Date.now()}`,
                  type: 'building',
                  subType: 'supply_refinery',
                  playerId: p.id,
                  team: p.team,
                  health: BUILDING_PROPERTIES.supply_refinery.hp,
                  maxHealth: BUILDING_PROPERTIES.supply_refinery.hp,
                  x: nearestDerrick.x,
                  z: nearestDerrick.z,
                  angle: 0,
                  state: 'constructing',
                  buildProgress: 0.05
                });
                pushNotification(`Вражеский снабженец разворачивает нефтевышку!`, 'info');
              }
            }

            else if (!barracks && refineries.length > 0 && aiState.timer >= 45) {
              const bx = aiCc.x + 4;
              const bz = aiCc.z - 4;
              sim.entities.push({
                id: `ai_b_${Date.now()}`,
                type: 'building',
                subType: 'barracks',
                playerId: p.id,
                team: p.team,
                health: BUILDING_PROPERTIES.barracks.hp,
                maxHealth: BUILDING_PROPERTIES.barracks.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing',
                buildProgress: 0.05
              });
              pushNotification(`Разведка докладывает о постройке вражеских казарм!`, 'info');
            }

            else if (barracks && !warFactories && aiState.timer >= 65) {
              const bx = aiCc.x - 3;
              const bz = aiCc.z + 5;
              sim.entities.push({
                id: `ai_wf_${Date.now()}`,
                type: 'building',
                subType: 'war_factory',
                playerId: p.id,
                team: p.team,
                health: BUILDING_PROPERTIES.war_factory.hp,
                maxHealth: BUILDING_PROPERTIES.war_factory.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing',
                buildProgress: 0.05
              });
              pushNotification(`Замечена закладка фундамента тяжелого военного завода врага!`, 'info');
            }

            else if (warFactories && turrets.length === 0 && aiState.timer >= 90) {
              // Build standard defensive turret guarding the front
              const bx = aiCc.x + 3;
              const bz = aiCc.z + 4;
              sim.entities.push({
                id: `ai_tur_${Date.now()}`,
                type: 'building',
                subType: 'defense_turret',
                playerId: p.id,
                team: p.team,
                health: BUILDING_PROPERTIES.defense_turret.hp,
                maxHealth: BUILDING_PROPERTIES.defense_turret.hp,
                x: bx,
                z: bz,
                angle: 0,
                state: 'constructing',
                buildProgress: 0.05
              });
              pushNotification(`Генерал ИИ разворачивает защитную турель для охраны периметра!`, 'info');
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
              sim.entities.push({
                id: `ai_u_${Date.now()}_r`,
                type: 'unit',
                subType: utToSpawn,
                playerId: p.id,
                team: p.team,
                health: UNIT_PROPERTIES[utToSpawn].hp,
                maxHealth: UNIT_PROPERTIES[utToSpawn].hp,
                x: barracks.x + (Math.random() - 0.5) * 4,
                z: barracks.z + 3,
                angle: Math.PI,
                state: 'idle'
              });
            }

            // Train tanks if war factory is ready and operational
            if (warFactories && warFactories.state !== 'constructing' && aiForces.length < 15 && Math.random() > 0.40) {
              const utToSpawn: UnitType = Math.random() > 0.65 ? 'artillery_mlrs' : 'precision_tank';
              sim.entities.push({
                id: `ai_u_${Date.now()}_rt`,
                type: 'unit',
                subType: utToSpawn,
                playerId: p.id,
                team: p.team,
                health: UNIT_PROPERTIES[utToSpawn].hp,
                maxHealth: UNIT_PROPERTIES[utToSpawn].hp,
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

            // Identify Player target priorities
            if (aiState.phase === 'strike_defenses') {
              // Try to locate player's defensive turrets first to breach perimeter
              const targetDef = sim.entities.find(e => e.playerId === playerId && e.subType === 'defense_turret' && e.state !== 'dead');
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
              // Locate primary CommandCenter, refineries or barracks to dismantle
              const playerCc = sim.entities.find(e => e.playerId === playerId && e.subType === 'command_center' && e.state !== 'dead');
              const playerProd = sim.entities.find(e => e.playerId === playerId && (e.subType === 'war_factory' || e.subType === 'barracks') && e.state !== 'dead');
              
              const finalObjective = playerCc || playerProd;
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
        let tickIncome = 5; // Base passive cash generate

        // Add Oil refiner metrics
        sim.entities.forEach(ent => {
          if (ent.playerId === playerId && ent.state !== 'dead') {
            if (ent.subType === 'supply_refinery' && ent.buildProgress && ent.buildProgress >= 1) {
              tickIncome += 15;
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

      // Sync active selections periodically with React states
      if (tickCount % 12 === 0) {
        setSelectedEntityIds([...sim.selectedIds]);
      }

      renderer.render(scene, camera);
    };

    animationId = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      canvasDom.removeEventListener('mousedown', handleMouseDown);
      canvasDom.removeEventListener('mouseup', handleMouseUp);
      if (socketRef.current) {
        socketRef.current.removeEventListener('message', handleSocketMessage);
      }
      renderer.dispose();
      terrainGeo.dispose();
      terrainMat.dispose();
      wireGeo.dispose();
      wireMat.dispose();
      placeBoxGeo.dispose();
      placeBoxMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
      selectionRingGeom.dispose();
      selectionRingMat.dispose();
    };
  }, [lobby, isSingleplayer, aiOpponents]);

  // Production queue controller triggers
  const handleTrainUnit = (unitType: UnitType) => {
    const cost = UNIT_PROPERTIES[unitType].cost;
    if (credits < cost) {
      pushNotification('Недостаточно средств для мобилизации сил.', 'warn');
      return;
    }

    // Must have matching barracks or war factory structure
    const isInfantry = ['drone_scout', 'drone_kamikaze', 'cyber_specops'].includes(unitType);
    const requiredBuildingType = isInfantry ? 'barracks' : 'war_factory';

    const sim = simulationRef.current;
    const producingFactory = sim.entities.find(
      e => e.playerId === playerId && e.subType === requiredBuildingType && e.state === 'idle'
    );

    if (!producingFactory) {
      pushNotification(`Для производства требуется готовое здание типа: ${requiredBuildingType === 'barracks' ? 'Казармы' : 'Военный Завод'}!`, 'warn');
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
      health: UNIT_PROPERTIES[unitType].hp,
      maxHealth: UNIT_PROPERTIES[unitType].hp,
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

    pushNotification(`${UNIT_PROPERTIES[unitType].name} выходит со сборочной линии.`, 'success');
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
    sim.camX = px * lobby.mapSize;
    sim.camZ = pz * lobby.mapSize;
    sound.playClick();
  };

  return (
    <div className="h-screen w-screen bg-[#070b0e] text-slate-100 flex flex-col relative select-none font-sans overflow-hidden">
      {/* 3D Viewport container */}
      <div ref={mountRef} className="flex-1 w-full h-full cursor-crosshair relative" />

      {/* Top HUD Controls Panel bar */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none z-20">
        {/* Cash flow index card */}
        <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-md p-3 px-5 rounded-lg flex items-center gap-6 pointer-events-auto shadow-lg shadow-black/40">
          <div>
            <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">БЮДЖЕТ</p>
            <p className="text-xl font-bold font-mono text-emerald-400">⟨${credits}⟩</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">СТАТУС ЭНЕРГОСЕТИ</p>
            <p className={`text-md font-bold font-mono ${powerGenerated >= powerRequired ? 'text-cyan-400' : 'text-rose-500 animate-pulse'}`}>
              ⚡ {powerRequired} / {powerGenerated} ГВт {powerGenerated < powerRequired && 'АВАРИЯ СЕТИ'}
            </p>
          </div>
        </div>

        {/* Tactical Alerts center logs */}
        <div className="hidden md:flex flex-col gap-1.5 max-w-sm pointer-events-none items-end">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`p-2.5 px-4 rounded text-xs font-mono border backdrop-blur-md transition-all duration-300 animate-slide-in ${
                n.type === 'warn'
                  ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                  : n.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                  : 'bg-slate-900/80 border-slate-800 text-cyan-200'
              }`}
            >
              {n.text}
            </div>
          ))}
        </div>

        {/* Quick Back arrow */}
        <button
          onClick={onExitGame}
          className="bg-slate-900/80 hover:bg-slate-800 border border-slate-800 backdrop-blur px-4 py-2 text-xs font-mono uppercase font-bold text-slate-300 hover:text-slate-100 rounded-lg pointer-events-auto transition cursor-pointer"
        >
          Выйти из Игры
        </button>
      </div>

      {/* Modern Right HUD Command Panel Construction yard, Minimap, and power bars */}
      <div className="absolute right-4 bottom-4 top-16 w-80 bg-slate-950/95 border border-slate-800 backdrop-blur p-4 rounded-xl flex flex-col justify-between shadow-2xl z-20">
        
        {/* Top Section: Radar Minimap with colored indicator targets */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-mono font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-cyan-400 animate-spin" /> Тактическая Карта
            </h3>
            <span className="text-[10px] font-mono text-cyan-500 font-semibold bg-cyan-950/30 px-2 py-0.5 rounded uppercase border border-cyan-800/20">РАДАР АКТИВЕН</span>
          </div>

          <div
            onClick={handleMinimapClick}
            className="w-full aspect-square bg-[#0b1016] border border-slate-800 rounded-lg relative overflow-hidden cursor-crosshair shadow-inner"
            style={{
              backgroundImage: `radial-gradient(circle at center, rgba(8, 145, 178, 0.1) 1px, transparent 1px)`,
              backgroundSize: '16px 16px'
            }}
          >
            {/* Symmetrical Starting bases overlayed on mini viewport */}
            {simulationRef.current.map?.resourceSpots.map((spot, idx) => (
              <div
                key={idx}
                className="absolute w-2 h-2 bg-yellow-500 rounded-full border border-black animate-pulse"
                style={{
                  left: `${(spot.x / lobby.mapSize) * 100}%`,
                  top: `${(spot.z / lobby.mapSize) * 100}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              />
            ))}

            {/* Active player HQ hubs dots representing base zones */}
            {simulationRef.current.entities.map(ent => {
              if (ent.state === 'dead') return null;
              const owner = simulationRef.current.players.find(p => p.id === ent.playerId) || selfPlayer;
              return (
                <div
                  key={ent.id}
                  className={`absolute rounded-xs shadow-sm ${ent.type === 'building' ? 'w-2 h-2 scale-125 rotate-45' : 'w-1 h-1'}`}
                  style={{
                    backgroundColor: owner.color,
                    left: `${(ent.x / lobby.mapSize) * 100}%`,
                    top: `${(ent.z / lobby.mapSize) * 100}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              );
            })}

            {/* Scanning radar sweep visually layered */}
            <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/0 via-cyan-500/5 to-cyan-500/0 animate-radar-sweep pointer-events-none" />
          </div>
        </div>

        {/* Middle Section: Command Power Charges */}
        <div className="border-t border-slate-900 pt-3 mt-3">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest">{getCommandPowerName(selfPlayer.faction)}</span>
            <span className="text-[10px] font-mono text-cyan-400 font-semibold">{commandCharge}% ГОТОВНО</span>
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
          
          <button
            onClick={handleCommandStrikeSelection}
            disabled={commandCharge < 100}
            className={`w-full mt-2.5 text-xs font-bold uppercase tracking-widest py-2 rounded-lg transition border cursor-pointer ${
              commandCharge >= 100
                ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 border-cyan-400 shadow-md shadow-cyan-900/30'
                : 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {commandCharge >= 100 ? 'АКТИВИРОВАТЬ ТАКТИЧЕСКИЙ УДАР' : 'ЗАРЯДКА СУПЕРСИСТЕМЫ'}
          </button>
        </div>

        {/* Bottom Section: Structure Deployers / Factories recruiters */}
        <div className="border-t border-slate-900 pt-3 mt-3 flex-1 flex flex-col justify-end">
          
          {/* Construction Blueprint options */}
          <div className="space-y-4">
            <div>
              <h4 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold mb-2">РАЗВЕРТЫВАНИЕ СТРОЕНИЙ</h4>
              <div className="grid grid-cols-3 gap-1.5">
                {(['power_plant', 'supply_refinery', 'barracks', 'war_factory', 'defense_turret'] as BuildingType[]).map(key => {
                  const prop = BUILDING_PROPERTIES[key];
                  const active = buildingToPlace === key;
                  return (
                    <button
                      key={key}
                      onClick={() => activeConstructionMode(key)}
                      disabled={credits < prop.cost}
                      className={`p-2.5 rounded-lg text-center flex flex-col items-center justify-between transition cursor-pointer border ${
                        active 
                          ? 'bg-cyan-950/20 border-cyan-400 text-cyan-300' 
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-350'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <span className="text-[10px] font-bold uppercase line-clamp-1">{prop.name}</span>
                      <span className="text-[9px] font-mono font-bold text-emerald-400 mt-1">${prop.cost}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recruit Unit options */}
            <div className="border-t border-slate-900 pt-3">
              <h4 className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold mb-2">ПРОИЗВОДСТВО ВОЙСК</h4>
              <div className="grid grid-cols-3 gap-1.5">
                {(['drone_scout', 'drone_kamikaze', 'cyber_specops', 'precision_tank', 'artillery_mlrs', 'mobile_jammer'] as UnitType[]).map(key => {
                  const prop = UNIT_PROPERTIES[key];
                  return (
                    <button
                      key={key}
                      onClick={() => handleTrainUnit(key)}
                      disabled={credits < prop.cost}
                      className="p-1 px-2.5 bg-slate-900/60 border border-slate-800 hover:border-slate-700 disabled:opacity-40 rounded-lg text-center flex flex-col items-center justify-between transition cursor-pointer disabled:cursor-not-allowed"
                    >
                      <span className="text-[9.5px] font-bold uppercase line-clamp-1">{prop.name}</span>
                      <span className="text-[9px] font-mono font-bold text-emerald-400 mt-0.5">${prop.cost}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Dynamic Selection Details Card HUD (Bottom center overlayed) */}
      {selectedEntityIds.length > 0 && (
        <div className="absolute bottom-6 left-6 right-96 flex justify-center pointer-events-none z-20">
          <div className="bg-slate-900/95 border border-slate-800 backdrop-blur-md p-4 rounded-xl flex items-center gap-6 max-w-xl pointer-events-auto shadow-2xl">
            <div className="relative p-2.5 bg-cyan-950/20 border border-cyan-800/30 rounded-lg text-cyan-400">
              <Swords className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-cyan-200">
                ОТРЯД СФОРМИРОВАН ({selectedEntityIds.length} ЕД. ПОД КОНТРОЛЕМ)
              </h4>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed font-mono">
                Нажмите Правой Кнопкой Мыши по карте, чтобы переместить войска, или кликните по объектам врага для ведения огня!
              </p>
              <div className="flex gap-2 mt-2">
                <span className="text-[9.5px] font-mono bg-cyan-950/40 border border-cyan-800/30 text-cyan-300 px-2 py-0.5 rounded-full uppercase">ЗАХВАТ ЦЕЛИ</span>
                <span className="text-[9.5px] font-mono bg-slate-950 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-full uppercase">ГОРЯЧИЙ СТАРТ СИСТЕМ</span>
              </div>
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
