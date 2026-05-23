import React, { useState, useEffect, useRef } from 'react';
import { Faction, Lobby, Player } from './types';
import LobbyPanel from './components/LobbyPanel';
import RTSGameCanvas from './components/RTSGameCanvas';
import { sound } from './utils/audio';
import { Shield, Swords, RefreshCw, Volume2, VolumeX, Medal, Trophy, LogOut, Radio } from 'lucide-react';

export default function App() {
  const [gameState, setGameState] = useState<'lobby' | 'playing' | 'game_over'>('lobby');
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<{ playerName: string; text: string; color: string }[]>([]);
  const [matchmakingQueueCount, setMatchmakingQueueCount] = useState<number>(0);

  // Singleplayer variables
  const [isSingleplayer, setIsSingleplayer] = useState<boolean>(true);
  const [aiOpponents, setAiOpponents] = useState<{ name: string; faction: Faction; team: number }[]>([]);

  // Sound Engine Volume
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // WebSocket referencing
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);

  // Victory states
  const [gameResult, setGameResult] = useState<{ winnerTeam: number; isVictory: boolean } | null>(null);

  // Handle clean WebSocket establishment
  const connectWebSocket = (name: string, faction: Faction, team: number, targetLobbyId?: string) => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    setConnecting(true);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      sound.playClick();
      // Join immediately
      ws.send(JSON.stringify({
        type: 'join',
        name,
        faction,
        team,
        lobbyId: targetLobbyId
      }));
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'joined_confirmation') {
          setPlayerId(data.playerId);
          const lobbyId = data.lobbyId;

          // Rewrite URL cleanly so they can easily share this exact link with friends to join!
          const newUrl = `${window.location.origin}?lobby=${lobbyId}`;
          window.history.pushState({ path: newUrl }, '', newUrl);
        }

        else if (data.type === 'lobby_state') {
          const l: Lobby = data.lobby;
          setLobby(l);
          setMatchmakingQueueCount(l.players.length);

          if (l.status === 'playing') {
            setIsSingleplayer(false);
            setGameState('playing');
            sound.playLaunch();
          }
        }

        else if (data.type === 'chat_message') {
          setChatMessages(prev => [...prev, {
            playerName: data.playerName,
            text: data.text,
            color: data.color
          }].slice(-30)); // Cap the feed
          sound.playClick();
        }
      } catch (err) {
        console.error('Error parsing client socket payload:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      setLobby(null);
    };

    ws.onerror = (err) => {
      console.error('WS Connection error:', err);
      setConnecting(false);
    };
  };

  const handleStartSingleplayer = (
    playerFaction: Faction,
    playerTeam: number,
    aiUnits: { name: string; faction: Faction; team: number }[]
  ) => {
    setIsSingleplayer(true);
    setAiOpponents(aiUnits);

    // Build mock local lobby for single player
    const mockLobby: Lobby = {
      id: 'LOCAL_SANDBOX',
      isCustom: true,
      players: [
        {
          id: 'PLAYER_LOCAL',
          name: localStorage.getItem('cnc_playerName') || 'General',
          faction: playerFaction,
          team: playerTeam,
          color: '#3b82f6',
          isHost: true,
          isReady: true,
          isAI: false,
          status: 'online'
        }
      ],
      status: 'playing',
      countdownLeft: 0,
      mapSeed: Math.floor(Math.random() * 100000),
      mapSize: aiUnits.length <= 1 ? 120 : aiUnits.length <= 3 ? 160 : 200
    };

    setLobby(mockLobby);
    setPlayerId('PLAYER_LOCAL');
    setGameState('playing');
  };

  const handleJoinMatchmaking = (name: string, faction: Faction, team: number) => {
    connectWebSocket(name, faction, team);
  };

  const handleJoinFriendsLobby = (name: string, faction: Faction, team: number, lobbyId?: string) => {
    connectWebSocket(name, faction, team, lobbyId);
  };

  const handleSendMessage = (text: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'chat',
        text
      }));
    }
  };

  const handleUpdatePlayer = (faction: Faction, team: number, isReady?: boolean) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'update_player',
        faction,
        team,
        isReady
      }));
    }
  };

  const handleStartMultiplayerGame = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'start_game'
      }));
    }
  };

  const handleLeaveLobby = () => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    setLobby(null);
    setGameState('lobby');
    setChatMessages([]);
    // Remove query params
    const cleanUrl = window.location.origin;
    window.history.pushState({ path: cleanUrl }, '', cleanUrl);
    sound.playClick();
  };

  const handleGameOver = (winnerTeam: number, isVictory: boolean) => {
    setGameResult({ winnerTeam, isVictory });
    setGameState('game_over');
    if (isVictory) sound.playBuildComplete();
    else sound.playAlert();
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sound.toggle(next);
    sound.playClick();
  };

  return (
    <div className="min-h-screen bg-[#070b0e] text-slate-100 flex flex-col justify-between overflow-x-hidden relative">
      {/* Sound controller */}
      <div className="absolute top-4 right-4 z-50">
        <button
          onClick={toggleSound}
          className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg backdrop-blur-md cursor-pointer transition shadow-lg"
          title={soundEnabled ? 'Disable Audio Effects' : 'Enable Audio Effects'}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4" />}
        </button>
      </div>

      {gameState === 'lobby' && (
        <LobbyPanel
          onStartSingleplayer={handleStartSingleplayer}
          onJoinMatchmaking={handleJoinMatchmaking}
          onJoinFriendsLobby={handleJoinFriendsLobby}
          onLeaveLobby={handleLeaveLobby}
          lobby={lobby}
          playerId={playerId}
          chatMessages={chatMessages}
          onSendMessage={handleSendMessage}
          onUpdatePlayer={handleUpdatePlayer}
          onStartMultiplayerGame={handleStartMultiplayerGame}
          matchmakingQueueCount={matchmakingQueueCount}
        />
      )}

      {gameState === 'playing' && lobby && (
        <RTSGameCanvas
          lobby={lobby}
          playerId={playerId}
          isSingleplayer={isSingleplayer}
          aiOpponents={aiOpponents}
          socketRef={socketRef}
          onGameOver={handleGameOver}
          onExitGame={handleLeaveLobby}
        />
      )}

      {gameState === 'game_over' && gameResult && (
        <div className="min-h-screen w-full flex flex-col justify-center items-center p-6 relative z-40 bg-[#070b0e] select-none" id="game_over_viewport">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-950/20 via-slate-950/80 to-[#070b0e] pointer-events-none" />
          
          <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 p-8 rounded-xl backdrop-blur-xl shadow-2xl text-center space-y-6 relative">
            <div className="flex justify-center">
              {gameResult.isVictory ? (
                <div className="p-4 bg-emerald-950/35 border-2 border-emerald-500 rounded-full text-emerald-400 animate-bounce">
                  <Trophy className="w-12 h-12" />
                </div>
              ) : (
                <div className="p-4 bg-rose-950/35 border-2 border-rose-500 rounded-full text-rose-400 animate-pulse">
                  <Shield className="w-12 h-12" />
                </div>
              )}
            </div>

            <div>
              <h1 className={`text-3xl font-black tracking-widest uppercase ${gameResult.isVictory ? 'text-emerald-400' : 'text-rose-500'}`}>
                {gameResult.isVictory ? 'ПОБЕДА ДОСТИГНУТА' : 'РАЗГРОМ'}
              </h1>
              <p className="text-xs text-slate-400 font-mono tracking-wider mt-1 uppercase">
                Кампания завершена • Оперативная группа {gameResult.winnerTeam} удерживает сектор
              </p>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed font-mono">
              {gameResult.isVictory
                ? 'Превосходное командование, Генерал! Вражеские Командные Центры были деактивированы и уничтожены. Стратегический сектор полностью зачищен.'
                : 'Тактическая тревога! Ваш Командный Центр разрушен ударными силами противника. Координаты отступления активированы.'}
            </p>

            <div className="pt-4 border-t border-slate-800 flex gap-4">
              <button
                onClick={handleLeaveLobby}
                className="flex-1 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-slate-950 font-bold uppercase tracking-widest py-3 px-6 rounded shadow transition cursor-pointer"
              >
                Вернуться в Штаб
              </button>
            </div>
          </div>
        </div>
      )}

      {connecting && (
        <div className="fixed inset-0 z-55 bg-black/70 flex justify-center items-center backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-lg text-center space-y-4 shadow-xl">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
            <p className="text-sm font-semibold tracking-wider uppercase font-mono text-slate-350">ПОДКЛЮЧЕНИЕ К ВОЕННОЙ СЕТИ...</p>
          </div>
        </div>
      )}
    </div>
  );
}
