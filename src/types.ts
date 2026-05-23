export type Faction = 'Alliance' | 'Coalition' | 'Union' | 'Syndicate';

export interface Player {
  id: string;
  name: string;
  faction: Faction;
  team: number; // 1 to 5 (0 can be FFA, let's use 1..5 for actual team numbers, if every player has a different team they are all hostile, which matches Generals 'each for themselves' or team setups)
  color: string;
  isHost: boolean;
  isReady: boolean;
  isAI: boolean;
  status: 'online' | 'disconnected';
}

export type LobbyStatus = 'waiting' | 'countdown' | 'playing';

export interface Lobby {
  id: string;
  isCustom: boolean; // True if created via link, false if matchmaking
  players: Player[];
  status: LobbyStatus;
  countdownLeft: number; // Seconds left if countdown
  mapSeed: number;
  mapSize: number; // Grid cells (e.g. 60, 80, 100, 120)
}

// Modern Warfare RTS Entity Types
export type UnitType = 
  | 'drone_scout'       // Fast, high vision, weak attack
  | 'drone_kamikaze'    // Fast, explosive attack, self-destructs
  | 'cyber_specops'     // Infiltrator, can capture buildings, cloaked while standing still
  | 'precision_tank'    // Standard combat arm, balanced range and armor
  | 'artillery_mlrs'    // Long-range barrage launcher, fragile
  | 'mobile_jammer';    // EW vehicle, cloaks nearby allies, disables nearby enemy radar

export type BuildingType =
  | 'command_center'    // Spawn point, radar, command power triggers
  | 'power_plant'       // Increases production speed and powers defenses
  | 'supply_refinery'   // Collects oil/credits automatically or spawns trucks
  | 'barracks'          // Recruits infantry/drones
  | 'war_factory'       // Builds vehicles like tanks, artillery, jammers
  | 'defense_turret';   // Automated heavy weapon turret

export interface GameEntity {
  id: string;
  type: 'unit' | 'building';
  subType: UnitType | BuildingType;
  playerId: string;
  team: number;
  health: number;
  maxHealth: number;
  x: number;
  z: number;
  angle: number;
  state: 'idle' | 'moving' | 'attacking' | 'constructing' | 'dead';
  targetX?: number;
  targetZ?: number;
  targetId?: string;
  targetType?: 'unit' | 'building';
  buildProgress?: number; // 0 to 1
  cooldown?: number;
}

// WebSocket message payloads
export type GameAction =
  | { type: 'chat'; text: string }
  | { type: 'lobby_state'; lobby: Lobby }
  | { type: 'join'; name: string; faction?: Faction; team?: number }
  | { type: 'update_player'; faction?: Faction; team?: number; isReady?: boolean }
  | { type: 'start_game' }
  | { type: 'sync_action'; action: GameActionEvent };

export type GameActionEvent =
  | { event: 'build'; buildingType: BuildingType; x: number; z: number; id: string }
  | { event: 'cancel_build'; id: string }
  | { event: 'produce_unit'; unitType: UnitType; factoryId: string; id: string }
  | { event: 'move_units'; unitIds: string[]; targetX: number; targetZ: number }
  | { event: 'attack_target'; unitIds: string[]; targetId: string; targetType: 'unit' | 'building' }
  | { event: 'command_strike'; strikeType: 'kinetic' | 'emp' | 'thermobaric' | 'chemical'; x: number; z: number }
  | { event: 'ping'; x: number; z: number };

export interface ServerMessage {
  type: string;
  [key: string]: any;
}
