import express from "express";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { Lobby, Player, Faction } from "./src/types.js"; // Note: we can import types safely

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;

// In-memory storage for lobbies
const lobbies: Map<string, Lobby> = new Map();

// Map tracking active WebSocket connections to their metadata
interface Session {
  playerId: string;
  lobbyId: string;
  ws: WebSocket;
}
const activeSessions: Map<WebSocket, Session> = new Map();

// Helper to generate a random room ID
function generateId(length = 6): string {
  const chars = "ABCDEFGHIJKLMOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Map faction colors
const FACTION_COLORS = {
  Alliance: "#3b82f6", // Blue
  Coalition: "#ef4444", // Red
  Union: "#10b981",    // Green (Eurasia/Siberian emerald)
  Syndicate: "#f59e0b" // Yellow/Orange
};

function getUniqueColor(lobby: Lobby, faction: Faction): string {
  return FACTION_COLORS[faction] || "#ef4444";
}

// Broadcasts updated lobby state to all connected players in the lobby
function broadcastLobbyState(lobbyId: string) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;

  const message = JSON.stringify({
    type: "lobby_state",
    lobby
  });

  for (const session of activeSessions.values()) {
    if (session.lobbyId === lobbyId && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(message);
    }
  }
}

// Tick system for matchmaking countdowns
setInterval(() => {
  for (const [lobbyId, lobby] of lobbies.entries()) {
    if (lobby.status === "countdown") {
      lobby.countdownLeft -= 1;
      
      // If countdown finishes, start the game
      if (lobby.countdownLeft <= 0) {
        lobby.status = "playing";
        broadcastLobbyState(lobbyId);
      } else {
        // Send countdown updates
        broadcastLobbyState(lobbyId);
      }
    }
  }
}, 1000);

// WebSocket connection lifecycle
wss.on("connection", (ws: WebSocket) => {
  ws.on("message", (rawMessage: string) => {
    try {
      const data = JSON.parse(rawMessage);
      const session = activeSessions.get(ws);

      if (data.type === "join") {
        const name = data.name || `General_${generateId(3)}`;
        const requestedLobbyId = data.lobbyId; // If Friends Lobby, this has a value
        const isCustom = !!requestedLobbyId;
        const faction: Faction = data.faction || "Alliance";

        let targetLobbyId = requestedLobbyId;
        let lobby: Lobby | undefined;

        if (isCustom) {
          // Custom Friends lobby: create if doesn't exist, else join
          lobby = lobbies.get(targetLobbyId);
          if (!lobby) {
            lobby = {
              id: targetLobbyId,
              isCustom: true,
              players: [],
              status: "waiting",
              countdownLeft: 0,
              mapSeed: Math.floor(Math.random() * 100000),
              mapSize: 60 // Starts small, scales with player count
            };
            lobbies.set(targetLobbyId, lobby);
          }
        } else {
          // Matchmaking search
          for (const [id, l] of lobbies.entries()) {
            if (!l.isCustom && l.status !== "playing" && l.players.length < 5) {
              lobby = l;
              targetLobbyId = id;
              break;
            }
          }

          // If no matchmaking lobby found, create new one
          if (!lobby) {
            targetLobbyId = `M_${generateId(5)}`;
            lobby = {
              id: targetLobbyId,
              isCustom: false,
              players: [],
              status: "waiting",
              countdownLeft: 60,
              mapSeed: Math.floor(Math.random() * 100000),
              mapSize: 60
            };
            lobbies.set(targetLobbyId, lobby);
          }
        }

        // Generate player ID
        const playerId = generateId(8);
        const isHost = lobby.players.length === 0; // First player is host

        // Teams check: Default to sequential team or FFA (different teams for all)
        // Let's increment team from 1 to 5 so everyone is hostile or they can change it
        const currentActiveTeams = lobby.players.map(p => p.team);
        let defaultTeam = 1;
        while (currentActiveTeams.includes(defaultTeam) && defaultTeam < 5) {
          defaultTeam++;
        }

        const newPlayer: Player = {
          id: playerId,
          name,
          faction,
          team: defaultTeam,
          color: getUniqueColor(lobby, faction),
          isHost,
          isReady: isCustom ? isHost : false, // In matchmaking, player clicks ready
          isAI: false,
          status: "online"
        };

        lobby.players.push(newPlayer);

        // Adjust map size dynamically based on player count so they do not crowd a tiny map!
        // 2 players: 60x60, 3 players: 80x80, 4 players: 100x100, 5 players: 120x120
        const activeCount = lobby.players.length;
        if (activeCount <= 2) lobby.mapSize = 60;
        else if (activeCount === 3) lobby.mapSize = 80;
        else if (activeCount === 4) lobby.mapSize = 100;
        else lobby.mapSize = 120;

        // In Matchmaking, trigger countdown if we go from 1 to 2 players
        if (!lobby.isCustom) {
          if (activeCount >= 2 && lobby.status === "waiting") {
            lobby.status = "countdown";
            lobby.countdownLeft = 60;
          }
          // If we reach max players (5) in matchmaking, start immediately without remaining countdown
          if (activeCount === 5) {
            lobby.status = "playing";
          }
        }

        // Save session
        activeSessions.set(ws, {
          playerId,
          lobbyId: targetLobbyId,
          ws
        });

        // Send back join confirmation with player's assignments
        ws.send(JSON.stringify({
          type: "joined_confirmation",
          playerId,
          lobbyId: targetLobbyId
        }));

        broadcastLobbyState(targetLobbyId);
      }

      else if (data.type === "update_player") {
        if (!session) return;
        const lobby = lobbies.get(session.lobbyId);
        if (!lobby) return;

        const player = lobby.players.find(p => p.id === session.playerId);
        if (player) {
          if (data.faction !== undefined) {
            player.faction = data.faction;
            player.color = getUniqueColor(lobby, player.faction);
          }
          if (data.team !== undefined) {
            player.team = data.team;
          }
          if (data.isReady !== undefined) {
            player.isReady = data.isReady;
          }

          // In matchmaking, check if everyone is ready to fast-forward, or just wait countdown.
          // In Friends lobby, readiness is tracked for players to let host see who is ready.
          broadcastLobbyState(session.lobbyId);
        }
      }

      else if (data.type === "start_game") {
        if (!session) return;
        const lobby = lobbies.get(session.lobbyId);
        if (!lobby) return;

        // Only Host can start Custom game
        const player = lobby.players.find(p => p.id === session.playerId);
        if (player && player.isHost) {
          lobby.status = "playing";
          broadcastLobbyState(session.lobbyId);
        }
      }

      else if (data.type === "chat") {
        if (!session) return;
        const lobby = lobbies.get(session.lobbyId);
        if (!lobby) return;

        const player = lobby.players.find(p => p.id === session.playerId);
        if (player) {
          const chatMsg = JSON.stringify({
            type: "chat_message",
            playerId: session.playerId,
            playerName: player.name,
            color: player.color,
            text: data.text
          });

          // Send to everyone in the lobby
          for (const activeSess of activeSessions.values()) {
            if (activeSess.lobbyId === session.lobbyId && activeSess.ws.readyState === WebSocket.OPEN) {
              activeSess.ws.send(chatMsg);
            }
          }
        }
      }

      else if (data.type === "sync_action") {
        // Fast relay of RTS action to other players in the game room
        if (!session) return;
        
        const actionPayload = JSON.stringify({
          type: "game_action",
          playerId: session.playerId,
          action: data.action
        });

        for (const activeSess of activeSessions.values()) {
          // Send to ALL other clients in the lobby (they run simulations on their end)
          if (activeSess.lobbyId === session.lobbyId && activeSess.ws !== ws && activeSess.ws.readyState === WebSocket.OPEN) {
            activeSess.ws.send(actionPayload);
          }
        }
      }

    } catch (err) {
      console.error("Error processing WebSocket message:", err);
    }
  });

  ws.on("close", () => {
    const session = activeSessions.get(ws);
    if (!session) return;

    activeSessions.delete(ws);
    
    // Remove player from lobby
    const lobby = lobbies.get(session.lobbyId);
    if (lobby) {
      const playerIdx = lobby.players.findIndex(p => p.id === session.playerId);
      if (playerIdx !== -1) {
        const removedPlayer = lobby.players[playerIdx];
        lobby.players.splice(playerIdx, 1);

        // If no players left, destroy lobby
        if (lobby.players.length === 0) {
          lobbies.delete(session.lobbyId);
        } else {
          // If the host left, assign new host
          if (removedPlayer.isHost) {
            lobby.players[0].isHost = true;
          }

          // Recalculate map size or adjust matchmaking state
          const activeCount = lobby.players.length;
          if (activeCount <= 2) lobby.mapSize = 60;
          else if (activeCount === 3) lobby.mapSize = 80;
          else if (activeCount === 4) lobby.mapSize = 100;
          else lobby.mapSize = 120;

          if (!lobby.isCustom) {
            if (activeCount < 2 && lobby.status === "countdown") {
              // Revert to waiting if only 1 player remains
              lobby.status = "waiting";
              lobby.countdownLeft = 60;
            }
          }

          // Inform remaining players
          broadcastLobbyState(session.lobbyId);
        }
      }
    }
  });
});

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", connections: activeSessions.size, lobbiesCount: lobbies.size });
});

// Serve Frontend using Vite in Dev, or Static Assets in Production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Command & Conquer: Modern Conflict running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
