import React, { useState, useEffect } from 'react';
import { Faction, Lobby, LobbyStatus, Player } from '../types';
import { sound } from '../utils/audio';
import { Shield, Users, Radio, Copy, Check, MessageSquare, Flame, HelpCircle, Swords, Bot, Zap, Globe } from 'lucide-react';

interface LobbyPanelProps {
  onStartSingleplayer: (
    playerFaction: Faction,
    playerTeam: number,
    aiOpponents: { name: string; faction: Faction; team: number }[]
  ) => void;
  onJoinMatchmaking: (name: string, faction: Faction, team: number) => void;
  onJoinFriendsLobby: (name: string, faction: Faction, team: number, lobbyId?: string) => void;
  onLeaveLobby: () => void;
  lobby: Lobby | null;
  playerId: string;
  chatMessages: { playerName: string; text: string; color: string }[];
  onSendMessage: (text: string) => void;
  onUpdatePlayer: (faction: Faction, team: number, isReady?: boolean) => void;
  onStartMultiplayerGame: () => void;
  matchmakingQueueCount: number;
}

const FACTIONS: { value: Faction; label: string; desc: string; icon: string; traits: string[] }[] = [
  {
    value: 'Alliance',
    label: 'Западный Альянс',
    desc: 'Высокотехнологичный камуфляж, полное воздушное превосходство разведывательных дронов и точечные орбитальные кинетические удары.',
    icon: 'Alliance-icon',
    traits: ['Стелс-технологии', 'Дроны-разведчики', 'Кинетический удар']
  },
  {
    value: 'Coalition',
    label: 'Восточная Коалиция',
    desc: 'Тяжелые бронетанковые батальоны, разрушительные заградительные залпы РСЗО и мощное электромагнитное оружие.',
    icon: 'Coalition-icon',
    traits: ['Тяжелая броня', 'Залпы РСЗО', 'Электромагнитная волна']
  },
  {
    value: 'Union',
    label: 'Евразийский Союз',
    desc: 'Прочные модульные конструкции, тяжелые ударные танки прорыва и мощная орбитальная термобарическая бомбардировка.',
    icon: 'Union-icon',
    traits: ['Усиленный корпус', 'Сверхтяжелые танки', 'Термобарическая бомба']
  },
  {
    value: 'Syndicate',
    label: 'Пустынный Синдикат',
    desc: 'Сверхмобильные штурмовые багги, рои дешевых дронов-камикадзе и ракеты с разъедающими токсинами.',
    icon: 'Syndicate-icon',
    traits: ['Высокая скорость', 'Дроны-камикадзе', 'Химические токсины']
  }
];

export default function LobbyPanel({
  onStartSingleplayer,
  onJoinMatchmaking,
  onJoinFriendsLobby,
  onLeaveLobby,
  lobby,
  playerId,
  chatMessages,
  onSendMessage,
  onUpdatePlayer,
  onStartMultiplayerGame,
  matchmakingQueueCount
}: LobbyPanelProps) {
  const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('cnc_playerName') || `General_${Math.floor(Math.random() * 900 + 100)}`;
  });
  const [selectedFaction, setSelectedFaction] = useState<Faction>('Alliance');
  const [selectedTeam, setSelectedTeam] = useState<number>(1);

  // Singleplayer states
  const [aiCount, setAiCount] = useState<number>(1);
  const [aiSetups, setAiSetups] = useState<{ id: number; name: string; faction: Faction; team: number }[]>([
    { id: 1, name: 'General Granger (AI)', faction: 'Coalition', team: 2 }
  ]);

  // UI state
  const [chatText, setChatText] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const uniqueTeams = lobby ? new Set(lobby.players.map(p => p.team)) : new Set();
  const allOnSameTeam = lobby ? (lobby.players.length > 1 && uniqueTeams.size <= 1) : false;

  useEffect(() => {
    localStorage.setItem('cnc_playerName', playerName);
  }, [playerName]);

  // Synchronize AI setup changes as AI Count grows
  useEffect(() => {
    let list = [...aiSetups];
    if (aiCount > list.length) {
      const names = ['Granger', 'Kwai', 'Fai', 'Takahara', 'Goth', 'Al-Ghazali'];
      const factionsList: Faction[] = ['Alliance', 'Coalition', 'Union', 'Syndicate'];
      for (let i = list.length; i < aiCount; i++) {
        const fac = factionsList[i % factionsList.length];
        // Team sequence default starts at 2, 3, etc
        const team = (i + 1) + 1 <= 5 ? (i + 1) + 1 : 5;
        list.push({
          id: i + 1,
          name: `General ${names[i % names.length]} (AI)`,
          faction: fac,
          team: team
        });
      }
    } else if (aiCount < list.length) {
      list = list.slice(0, aiCount);
    }
    setAiSetups(list);
  }, [aiCount]);

  const updateAiFaction = (index: number, faction: Faction) => {
    const list = [...aiSetups];
    list[index].faction = faction;
    setAiSetups(list);
    sound.playClick();
  };

  const updateAiTeam = (index: number, team: number) => {
    const list = [...aiSetups];
    list[index].team = team;
    setAiSetups(list);
    sound.playClick();
  };

  const c_updatePlayerFaction = (faction: Faction) => {
    setSelectedFaction(faction);
    sound.playSelect();
    if (lobby) {
      onUpdatePlayer(faction, selectedTeam, false);
    }
  };

  const c_updatePlayerTeam = (team: number) => {
    setSelectedTeam(team);
    sound.playClick();
    if (lobby) {
      onUpdatePlayer(selectedFaction, team, false);
    }
  };

  const handleLaunchSingleplayer = () => {
    sound.playLaunch();
    onStartSingleplayer(
      selectedFaction,
      selectedTeam,
      aiSetups.map(ai => ({ name: ai.name, faction: ai.faction, team: ai.team }))
    );
  };

  const handleCreateCustom = () => {
    sound.playOrder();
    const randId = Math.random().toString(36).substring(2, 8).toUpperCase();
    onJoinFriendsLobby(playerName, selectedFaction, selectedTeam, randId);
  };

  const handleCopyLink = () => {
    if (!lobby) return;
    const link = `${window.location.origin}?lobby=${lobby.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setIsCopied(true);
      sound.playClick();
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const handleSendTrigger = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    onSendMessage(chatText.trim());
    setChatText('');
  };

  // Check if player query URL contains lobby join instructions
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinLobbyId = params.get('lobby');
    if (joinLobbyId && !lobby) {
      setActiveTab('multi');
      onJoinFriendsLobby(playerName, selectedFaction, selectedTeam, joinLobbyId);
    }
  }, []);

  const selfPlayer = lobby?.players.find(p => p.id === playerId);

  return (
    <div className="min-h-screen bg-[#070b0e] text-slate-100 flex flex-col justify-center items-center p-4 md:p-8 font-sans selection:bg-cyan-500/30 selection:text-white" id="lobby_viewport">
      {/* Glow ambient background grids */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-950/20 via-slate-950/80 to-[#070b0e] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,24,38,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(18,24,38,0.1)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />

      {/* Main Panel Frame */}
      <div className="w-full max-w-5xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-2xl shadow-cyan-950/20 rounded-xl overflow-hidden flex flex-col relative z-10 min-h-[640px]">
        {/* Top bar */}
        <div className="border-b border-slate-800 bg-slate-950/80 p-4 px-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <Swords className="w-8 h-8 text-cyan-400 animate-pulse" />
            <div>
              <h1 className="text-xl font-bold tracking-widest text-[#e2f1ff] uppercase">
                Generals: <span className="text-cyan-400">Современный Конфликт</span>
              </h1>
              <p className="text-xs text-slate-400 tracking-wider font-mono">ИНТЕРФЕЙС БОЕВОГО КОМАНДОВАНИЯ v2.4a</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs tracking-wider uppercase font-mono text-slate-400 font-semibold">Имя генерала:</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value.slice(0, 16))}
              disabled={!!lobby}
              className="bg-slate-900 border border-slate-800 focus:border-cyan-500 focus:outline-none rounded px-3 py-1 text-sm font-mono text-cyan-200 transition"
              placeholder="Имя командира"
            />
          </div>
        </div>

        {/* If joined active room Lobby */}
        {lobby ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 flex-1">
            {/* Left Col: Match Setup / Players State */}
            <div className="lg:col-span-2 p-6 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800">
              <div>
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                      <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
                      Лобби: <span className="text-cyan-400 font-mono text-base">{lobby.id}</span>
                    </h2>
                    <p className="text-xs text-slate-400 font-mono mt-1">
                      Карта: Процедурное плато пустыни ({lobby.mapSize}x{lobby.mapSize})
                    </p>
                  </div>
                  {lobby.isCustom && (
                    <button
                      onClick={handleCopyLink}
                      className="flex items-center gap-2 bg-slate-950 hover:bg-slate-800 text-xs font-mono text-cyan-300 font-semibold py-1.5 px-3 border border-slate-800 hover:border-cyan-500/50 rounded transition hover:scale-105"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? 'Ссылка скопирована!' : 'Копировать ссылку'}
                    </button>
                  )}
                </div>

                {/* Queue Countdown Indicator (for Random Matchmaking) */}
                {!lobby.isCustom && lobby.status === 'countdown' && (
                  <div className="mb-6 bg-cyan-950/30 border border-cyan-800/40 p-4 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center">
                        <span className="absolute animate-ping inline-flex h-8 w-8 rounded-full bg-cyan-400 opacity-20"></span>
                        <div className="h-8 w-8 rounded-full bg-cyan-950/40 border border-cyan-500/50 flex items-center justify-center text-xs font-mono font-bold text-cyan-400">
                          {lobby.countdownLeft}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wide">
                          СОЕДИНЕНИЕ УСТАНОВЛЕНО! ТАЙМЕР ЗАПУСКА
                        </p>
                        <p className="text-[11px] font-mono text-slate-400">
                          Командиры готовы. Инициализация процедурного плато сражения...
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {!lobby.isCustom && lobby.status === 'waiting' && (
                  <div className="mb-6 bg-slate-950/60 border border-slate-800/50 p-4 rounded-lg text-center flex flex-col items-center justify-center py-6">
                    <Users className="w-8 h-8 text-slate-500 animate-pulse mb-2" />
                    <p className="text-sm font-semibold text-slate-400">ОЖИДАНИЕ ПОДКЛЮЧЕНИЯ ДРУГИХ КОМАНДИРОВ</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-md font-mono">
                      Для запуска обратного отсчета требуется минимум 2 игрока. В очереди: 1/5. Копируйте и отправляйте ссылку приглашения друзьям, чтобы начать битву вместе быстрее!
                    </p>
                  </div>
                )}

                {/* Players List Grid */}
                <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3 font-bold">СПИСОК ЛИЧНОГО СОСТАВА</h3>
                <div className="space-y-3">
                  {lobby.players.map((plr, i) => {
                    const isSelf = plr.id === playerId;
                    return (
                      <div
                        key={plr.id}
                        className={`p-4 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition ${
                          isSelf ? 'bg-cyan-950/20 border-cyan-800/60' : 'bg-slate-950/50 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: plr.color }} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-100">{plr.name}</span>
                              {plr.isHost && (
                                <span className="text-[10px] bg-amber-500/20 border border-amber-500/40 text-amber-300 px-1.5 py-0.2 rounded uppercase font-mono tracking-wider">
                                  ХОСТ ШТАБА
                                </span>
                              )}
                              {isSelf && (
                                <span className="text-[10px] bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 px-1.5 py-0.2 rounded uppercase font-mono tracking-wider">
                                  ВЫ
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-mono text-slate-400 flex items-center gap-1.5 mt-1">
                              Фракция: <strong className="text-slate-300">
                                {plr.faction === 'Alliance' ? 'Западный Альянс' : plr.faction === 'Coalition' ? 'Восточная Коалиция' : plr.faction === 'Union' ? 'Евразийский Союз' : 'Пустынный Синдикат'}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
                          {isSelf ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-slate-400">Ваша Команда:</span>
                              <select
                                value={selectedTeam}
                                onChange={(e) => c_updatePlayerTeam(parseInt(e.target.value))}
                                className="bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 p-1 px-2 rounded focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 cursor-pointer animate-pulse"
                              >
                                {[1, 2, 3, 4, 5].map(t => (
                                  <option key={t} value={t}>Команда {t}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="text-xs font-mono bg-slate-900 border border-slate-800 text-slate-300 px-3 py-1 rounded">
                              Команда {plr.team}
                            </div>
                          )}

                          <div>
                            {plr.isReady ? (
                              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest bg-emerald-900/10 border border-emerald-800/40 px-3 py-1 rounded">
                                Готов
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest bg-slate-800/20 border border-slate-800/50 px-3 py-1 rounded">
                                Подготовка
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lobby Control Action footer */}
              {allOnSameTeam && (
                <div className="mt-4 bg-rose-950/40 border border-rose-800/60 p-4 rounded-lg flex flex-col sm:flex-row items-center gap-3 text-rose-300">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping shrink-0" />
                  <p className="text-xs font-mono">
                    <strong className="text-rose-200">БЛОКИРОВКА ЗАПУСКА:</strong> Все командиры выбрали одинаковую команду! Смените номер команды, чтобы распределиться по противоборствующим сторонам.
                  </p>
                </div>
              )}

              <div className="mt-8 border-t border-slate-800 pt-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
                <button
                  onClick={onLeaveLobby}
                  className="w-full sm:w-auto text-slate-400 hover:text-slate-100 text-xs font-mono tracking-widest uppercase border border-slate-800 hover:border-slate-500/50 py-2.5 px-6 rounded transition cursor-pointer"
                >
                  Выйти из лобби
                </button>

                {lobby.isCustom ? (
                  selfPlayer?.isHost ? (
                    <button
                      onClick={() => {
                        sound.playLaunch();
                        onStartMultiplayerGame();
                      }}
                      disabled={lobby.players.length < 1 || allOnSameTeam}
                      className="w-full sm:w-auto bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-505 disabled:hover:scale-100 font-bold uppercase tracking-widest text-[#070b0e] py-3 px-8 rounded shadow-lg shadow-cyan-950/20 transition cursor-pointer"
                    >
                      НАЧАТЬ ВОЕННУЮ КАМПАНИЮ
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const nextReady = !selfPlayer?.isReady;
                        onUpdatePlayer(selectedFaction, selectedTeam, nextReady);
                        sound.playClick();
                      }}
                      disabled={allOnSameTeam && !selfPlayer?.isReady}
                      className={`w-full sm:w-auto font-bold uppercase tracking-widest py-3 px-8 rounded shadow-lg transition cursor-pointer disabled:bg-slate-800 disabled:text-slate-550 ${
                        selfPlayer?.isReady 
                          ? 'bg-slate-800 text-slate-350 hover:bg-slate-700' 
                          : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950'
                      }`}
                    >
                      {selfPlayer?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'ПОДТВЕРДИТЬ ГОТОВНОСТЬ'}
                    </button>
                  )
                ) : (
                  // Matchmaking mode
                  <button
                    onClick={() => {
                      const nextReady = !selfPlayer?.isReady;
                      onUpdatePlayer(selectedFaction, selectedTeam, nextReady);
                      sound.playClick();
                    }}
                    disabled={allOnSameTeam && !selfPlayer?.isReady}
                    className={`w-full sm:w-auto font-bold uppercase tracking-widest py-3 px-8 rounded border shadow-lg transition cursor-pointer disabled:bg-slate-800 disabled:text-slate-550 disabled:border-slate-850 ${
                      selfPlayer?.isReady 
                        ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-400' 
                        : 'bg-cyan-500 border-cyan-400 text-slate-950 hover:bg-cyan-400'
                    }`}
                  >
                    {selfPlayer?.isReady ? 'ОТМЕНИТЬ ГОТОВНОСТЬ' : 'ПОДТВЕРДИТЬ ГОТОВНОСТЬ'}
                  </button>
                )}
              </div>
            </div>

            {/* Right Col: Lobby Chat & Faction selector */}
            <div className="p-6 bg-slate-950/40 flex flex-col justify-between h-[520px] lg:h-auto">
              <div className="flex flex-col flex-1 h-0">
                <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3 font-bold flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> Орбитальный тактический чат
                </h3>
                
                {/* Chat feed */}
                <div className="flex-1 bg-slate-950/90 border border-slate-900 rounded-lg p-4 font-mono text-xs overflow-y-auto space-y-2.5 min-h-[220px]">
                  {chatMessages.length === 0 ? (
                    <p className="text-slate-650 italic text-center text-slate-500 mt-12">Линия связи защищена. Введите указания или скоординируйте атаку со своими союзниками.</p>
                  ) : (
                    chatMessages.map((msg, i) => (
                      <div key={i} className="leading-relaxed">
                        <span className="font-bold" style={{ color: msg.color }}>
                          {msg.playerName}:
                        </span>{' '}
                        <span className="text-slate-300">{msg.text}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* Message send form */}
                <form onSubmit={handleSendTrigger} className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value.slice(0, 80))}
                    placeholder="Введите тактическое сообщение..."
                    className="flex-1 bg-slate-900 border border-slate-800 focus:border-cyan-500 focus:outline-none rounded px-3 py-2 text-xs font-mono text-slate-200 transition"
                  />
                  <button
                    type="submit"
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-4 text-xs font-mono uppercase font-semibold text-cyan-400 cursor-pointer"
                  >
                    Отправить
                  </button>
                </form>
              </div>

              {/* Quick Faction Toggle Inside lobby */}
              <div className="mt-6 border-t border-slate-800 pt-5">
                <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3 font-bold">СМЕНИТЬ ФРАКЦИЮ В ПОЛЕТЕ</h3>
                <div className="grid grid-cols-2 gap-2">
                  {FACTIONS.map((fac) => (
                    <button
                      key={fac.value}
                      onClick={() => c_updatePlayerFaction(fac.value)}
                      className={`text-left p-2.5 rounded border transition cursor-pointer text-xs ${
                        selectedFaction === fac.value
                          ? 'bg-cyan-950/30 border-cyan-500 text-cyan-200 font-bold'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-600 text-slate-400'
                      }`}
                    >
                      <p className="uppercase">{fac.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Matchmaking / Setup selection */
          <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-[500px]">
            {/* 3 columns: Left / Faction Selection */}
            <div className="md:col-span-3 p-6 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-800">
              <div>
                <h2 className="text-sm tracking-wider uppercase font-mono text-slate-400 mb-4 font-bold flex items-center gap-2">
                  <Shield className="w-4 h-4 text-cyan-400" /> ВЫБРАТЬ ФРАКЦИЮ
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {FACTIONS.map((fac) => {
                    const isSelected = selectedFaction === fac.value;
                    return (
                      <button
                        key={fac.value}
                        onClick={() => c_updatePlayerFaction(fac.value)}
                        className={`text-left p-4 rounded-lg border transition duration-150 cursor-pointer flex flex-col justify-between h-[155px] relative ${
                          isSelected
                            ? 'bg-cyan-950/20 border-cyan-500/80 shadow-md shadow-cyan-950/10'
                            : 'bg-slate-950/30 border-slate-800 hover:border-slate-700 hover:bg-slate-950/50'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                          </div>
                        )}
                        <div>
                          <h3 className={`font-bold uppercase tracking-wider text-xs ${isSelected ? 'text-cyan-300' : 'text-slate-200'}`}>
                            {fac.label}
                          </h3>
                          <p className="text-[11px] text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                            {fac.desc}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {fac.traits.map(t => (
                            <span key={t} className="text-[9px] font-mono border border-slate-800 text-slate-400 px-1.5 py-0.2 rounded uppercase">
                              {t}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-slate-950/40 p-4 rounded-lg border border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400 font-semibold uppercase">Команда командира:</span>
                    <select
                      value={selectedTeam}
                      onChange={(e) => c_updatePlayerTeam(parseInt(e.target.value))}
                      className="bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 p-1.5 px-3 rounded focus:outline-none focus:border-cyan-500 cursor-pointer animate-pulse"
                    >
                      {[1, 2, 3, 4, 5].map(t => (
                        <option key={t} value={t}>Команда {t}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono leading-relaxed">
                    Союзники объединяются в одну команду. Игроки с одинаковым номером будут воевать плечом к плечу! Выбирайте разные команды для режима «каждый сам за себя».
                  </p>
                </div>
              </div>

              {/* Mode select and credits */}
              <div className="mt-8 border-t border-slate-800 pt-5 flex items-center justify-between">
                <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-lg">
                  <button
                    onClick={() => {
                      setActiveTab('single');
                      sound.playClick();
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-md font-semibold text-xs tracking-wider uppercase transition cursor-pointer ${
                      activeTab === 'single'
                        ? 'bg-cyan-900/30 text-cyan-300 border border-cyan-800/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" /> Одиночная игра
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('multi');
                      sound.playClick();
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-md font-semibold text-xs tracking-wider uppercase transition cursor-pointer ${
                      activeTab === 'multi'
                        ? 'bg-cyan-900/30 text-cyan-300 border border-cyan-800/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" /> Мультиплеер
                  </button>
                </div>

                <p className="text-[10px] font-mono text-slate-600">© 2026 GENERALS: MODERN CONFLICT</p>
              </div>
            </div>

            {/* Right Col: Details depending on ActiveTab */}
            <div className="md:col-span-2 p-6 bg-slate-950/30 flex flex-col justify-between">
              {activeTab === 'single' ? (
                /* SINGLE PLAYER CONFIG */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <h2 className="text-sm tracking-wider uppercase font-mono text-slate-400 mb-4 font-bold flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-cyan-400" /> Настройка Одиночной Игры
                    </h2>
                    
                    <div className="bg-slate-950/60 p-4 border border-slate-800/60 rounded-lg space-y-4">
                      {/* AI Count */}
                      <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 font-mono uppercase font-semibold flex justify-between">
                          <span>Количество врагов</span>
                          <span className="text-cyan-400 font-bold">{aiCount} из 5</span>
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={aiCount}
                          onChange={(e) => {
                            setAiCount(parseInt(e.target.value));
                            sound.playClick();
                          }}
                          className="w-full accent-cyan-400 bg-slate-900 h-1.5 rounded cursor-pointer"
                        />
                        <p className="text-[10px] text-slate-500 font-mono mt-1 leading-normal">
                          Площадь генерируемой карты увеличивается с ростом числа бойцов (от 120x120 до 200x200), чтобы у каждого генерала было свободное пространство для застройки баз!
                        </p>
                      </div>

                      {/* Opponent Setup Details */}
                      <div className="space-y-3 pt-3 border-t border-slate-900 max-h-[220px] overflow-y-auto pr-1">
                        <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-semibold">Настройка Генералов ИИ:</p>
                        {aiSetups.map((ai, index) => (
                          <div key={ai.id} className="p-3 bg-slate-900/60 border border-slate-800 rounded flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center text-xs">
                            <span className="font-bold text-slate-300 font-mono text-xs">{ai.name.replace('General', 'Генерал')}</span>
                            <div className="flex gap-2 w-full sm:w-auto justify-end">
                              <select
                                value={ai.faction}
                                onChange={(e) => updateAiFaction(index, e.target.value as Faction)}
                                className="bg-slate-950 border border-slate-800 text-xs font-mono p-1 rounded hover:border-slate-700 cursor-pointer"
                              >
                                {FACTIONS.map(f => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                              </select>
                              <select
                                value={ai.team}
                                onChange={(e) => updateAiTeam(index, parseInt(e.target.value))}
                                className="bg-slate-950 border border-slate-800 text-xs font-mono p-1 rounded hover:border-slate-700 cursor-pointer"
                              >
                                {[1, 2, 3, 4, 5].map(t => (
                                  <option key={t} value={t}>Ком. {t}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleLaunchSingleplayer}
                    className="w-full mt-6 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-widest py-3.5 px-6 rounded shadow-lg shadow-cyan-900/20 hover:scale-[1.02] transform transition cursor-pointer"
                  >
                    НАЧАТЬ ОДИНОЧНЫЙ БОЙ
                  </button>
                </div>
              ) : (
                /* MULTIPLAYER LOBBY JOIN CONFIG */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <h2 className="text-sm tracking-wider uppercase font-mono text-slate-400 mb-4 font-bold flex items-center gap-1.5 animate-pulse">
                      <Globe className="w-4 h-4 text-cyan-400 animate-spin" /> Сетевой Командный Центр
                    </h2>

                    <div className="space-y-4">
                      {/* Random Matchmaker explanation */}
                      <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg space-y-2">
                        <h3 className="text-xs font-mono text-cyan-300 uppercase font-bold">1. Быстрый подбор соперников</h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                          Мгновенно подключайтесь к другим генералам в случайном пуле. Таймер запуска активируется при входе хотя бы 2 человек.
                        </p>
                        <button
                          onClick={() => {
                            sound.playLaunch();
                            onJoinMatchmaking(playerName, selectedFaction, selectedTeam);
                          }}
                          className="w-full mt-2 bg-slate-900 hover:bg-slate-800 border-2 border-dashed border-cyan-800 text-cyan-400 hover:text-cyan-300 font-bold text-xs uppercase tracking-wider py-2.5 px-4 rounded transition cursor-pointer hover:border-cyan-400"
                        >
                          НАЙТИ ИГРУ ({matchmakingQueueCount} ожидают)
                        </button>
                      </div>

                      {/* Custom/Friends room section */}
                      <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg space-y-2">
                        <h3 className="text-xs font-mono text-cyan-300 uppercase font-bold">2. Своя игра с друзьями</h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                          Инициализируйте выделенный военный сервер боевой песочницы. Вы получите зашифрованную ссылку, которую можно напрямую скопировать друзьям для игры в одном лобби.
                        </p>
                        <button
                          onClick={handleCreateCustom}
                          className="w-full mt-2 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-slate-950 font-bold text-xs uppercase tracking-wider py-2.5 px-4 rounded shadow transition cursor-pointer hover:scale-103"
                        >
                          ИНИЦИАЛИЗИРОВАТЬ СВОЙ СЕРВЕР
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500 font-mono mt-6 leading-relaxed">
                    Передача данных производится посредством двунаправленных WebSockets с минимальным пингом. Задайте имя генерала вверху перед запуском!
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
