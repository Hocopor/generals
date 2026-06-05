import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Faction, Lobby, LobbyStatus, Player } from '../types';
import { sound } from '../utils/audio';
import {
  Shield, Users, Radio, Copy, Check, MessageSquare, Swords, Bot, Zap, Globe,
  Radar, Crosshair, Flame, Wind, Crown, Send, ChevronRight, Cpu, Wifi
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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

interface FactionMeta {
  value: Faction;
  label: string;
  short: string;
  desc: string;
  icon: LucideIcon;
  hex: string;        // identity color
  rgb: string;        // "r g b" for rgb(var) usage
  traits: string[];
}

const FACTIONS: FactionMeta[] = [
  {
    value: 'Alliance',
    label: 'Западный Альянс',
    short: 'Альянс',
    desc: 'Высокотехнологичный камуфляж, превосходство разведывательных дронов и точечные орбитальные кинетические удары.',
    icon: Radar,
    hex: '#60a5fa',
    rgb: '96 165 250',
    traits: ['Стелс', 'Дроны-разведчики', 'Кинетика']
  },
  {
    value: 'Coalition',
    label: 'Восточная Коалиция',
    short: 'Коалиция',
    desc: 'Тяжелые бронетанковые батальоны, разрушительные заградительные залпы РСЗО и электромагнитное оружие.',
    icon: Crosshair,
    hex: '#f87171',
    rgb: '248 113 113',
    traits: ['Тяжелая броня', 'Залпы РСЗО', 'ЭМИ']
  },
  {
    value: 'Union',
    label: 'Евразийский Союз',
    short: 'Союз',
    desc: 'Прочные модульные конструкции, сверхтяжелые танки прорыва и орбитальная термобарическая бомбардировка.',
    icon: Flame,
    hex: '#fbbf24',
    rgb: '251 191 36',
    traits: ['Усиленный корпус', 'Сверхтяжёлые танки', 'Термобарика']
  },
  {
    value: 'Syndicate',
    label: 'Пустынный Синдикат',
    short: 'Синдикат',
    desc: 'Сверхмобильные штурмовые багги, рои дешевых дронов-камикадзе и ракеты с разъедающими токсинами.',
    icon: Wind,
    hex: '#34d399',
    rgb: '52 211 153',
    traits: ['Скорость', 'Камикадзе', 'Токсины']
  }
];

const FACTION_LABEL: Record<Faction, string> = {
  Alliance: 'Западный Альянс',
  Coalition: 'Восточная Коалиция',
  Union: 'Евразийский Союз',
  Syndicate: 'Пустынный Синдикат'
};

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

  const playerAndAiTeams = new Set([selectedTeam, ...aiSetups.map(ai => ai.team)]);
  const isSingleplayerAllSameTeam = aiCount > 0 && playerAndAiTeams.size <= 1;

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 md:p-8 font-sans selection:bg-cyan-500/30 selection:text-white relative overflow-hidden" id="lobby_viewport">
      <BackgroundBattle />

      {/* Glow ambient background grids */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-950/10 via-slate-950/40 to-slate-950 pointer-events-none z-1" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,24,38,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(18,24,38,0.1)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-20 z-1" />

      {/* Main Panel Frame — beveled tactical console */}
      <div className="w-full max-w-5xl bevel-frame shadow-2xl shadow-cyan-950/40 relative z-10 animate-scale-in">
       <div className="bevel-inner backdrop-blur-md flex flex-col min-h-[640px]">
        {/* Top bar */}
        <div className="ui-railed border-b border-slate-800/80 bg-slate-950/70 p-4 px-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="relative p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/25">
              <Swords className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-wide text-[#e8f4ff]">
                GENERALS <span className="text-cyan-400 font-bold">/ Современный Конфликт</span>
              </h1>
              <p className="text-[11px] text-slate-500 tracking-wider font-mono flex items-center gap-1.5">
                <Wifi className="w-3 h-3 text-emerald-400" /> Интерфейс боевого командования · v2.4a
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <label className="text-[11px] tracking-wide uppercase font-semibold text-slate-400 flex items-center gap-1.5 shrink-0">
              <Crown className="w-3.5 h-3.5 text-amber-400" /> Генерал
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value.slice(0, 16))}
              disabled={!!lobby}
              className="ui-field flex-1 sm:flex-none px-3 py-1.5 text-sm font-mono disabled:opacity-60"
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
                    <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                      </span>
                      Лобби <span className="text-cyan-400 font-mono text-base tracking-wider">{lobby.id}</span>
                    </h2>
                    <p className="text-xs text-slate-500 font-mono mt-1">
                      Процедурное плато пустыни · {lobby.mapSize}×{lobby.mapSize}
                    </p>
                  </div>
                  {lobby.isCustom && (
                    <button
                      onClick={handleCopyLink}
                      className="ui-btn ui-btn-ghost text-xs font-mono py-1.5 px-3"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? 'Скопировано!' : 'Ссылка-приглашение'}
                    </button>
                  )}
                </div>

                {/* Queue Countdown Indicator (for Random Matchmaking) */}
                {!lobby.isCustom && lobby.status === 'countdown' && (
                  <div className="ui-panel ui-panel-tight mb-6 p-4 flex items-center gap-3 border-cyan-500/30">
                    <div className="relative flex items-center justify-center shrink-0">
                      <span className="absolute animate-ping inline-flex h-9 w-9 rounded-full bg-cyan-400 opacity-20" />
                      <div className="h-9 w-9 rounded-full bg-cyan-950/50 border border-cyan-500/50 flex items-center justify-center text-sm font-mono font-bold text-cyan-300">
                        {lobby.countdownLeft}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-100 tracking-wide">
                        Соединение установлено · таймер запуска
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                        Командиры готовы. Инициализация поля боя...
                      </p>
                    </div>
                  </div>
                )}
                {!lobby.isCustom && lobby.status === 'waiting' && (
                  <div className="ui-panel ui-panel-tight mb-6 p-5 text-center flex flex-col items-center">
                    <Users className="w-7 h-7 text-slate-500 mb-2" />
                    <p className="text-sm font-semibold text-slate-300">Ожидание других командиров</p>
                    <p className="text-xs text-slate-500 mt-1.5 max-w-md leading-relaxed">
                      Для обратного отсчёта нужно минимум 2 игрока. Скопируйте ссылку-приглашение и отправьте друзьям, чтобы начать быстрее.
                    </p>
                  </div>
                )}

                {/* Players List */}
                <h3 className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-3 font-semibold">Личный состав</h3>
                <div className="space-y-2.5">
                  {lobby.players.map((plr) => {
                    const isSelf = plr.id === playerId;
                    const FacIcon = FACTIONS.find(f => f.value === plr.faction)?.icon || Shield;
                    return (
                      <div
                        key={plr.id}
                        className={`relative overflow-hidden p-3.5 pl-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition ${
                          isSelf ? 'bg-cyan-950/15 border-cyan-700/50' : 'bg-slate-950/40 border-slate-800/80'
                        }`}
                      >
                        {/* faction color rail */}
                        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: plr.color }} />
                        <div className="flex items-center gap-3">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border"
                            style={{ backgroundColor: `${plr.color}1f`, borderColor: `${plr.color}55`, color: plr.color }}
                          >
                            <FacIcon className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-100">{plr.name}</span>
                              {plr.isHost && (
                                <span className="ui-chip border-amber-500/40 text-amber-300">
                                  <Crown className="w-2.5 h-2.5" /> Хост
                                </span>
                              )}
                              {isSelf && (
                                <span className="ui-chip border-cyan-500/40 text-cyan-300">Вы</span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 mt-0.5 block">
                              {FACTION_LABEL[plr.faction]}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                          {isSelf ? (
                            <select
                              value={selectedTeam}
                              onChange={(e) => c_updatePlayerTeam(parseInt(e.target.value))}
                              className="ui-select text-xs font-mono py-1.5 px-2.5"
                            >
                              {[1, 2, 3, 4, 5].map(t => (
                                <option key={t} value={t}>Команда {t}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-xs font-mono bg-slate-900/70 border border-slate-800 text-slate-300 px-3 py-1.5 rounded-lg">
                              Команда {plr.team}
                            </div>
                          )}

                          {plr.isReady ? (
                            <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wide bg-emerald-500/10 border border-emerald-500/40 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                              <Check className="w-3.5 h-3.5" /> Готов
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-800/30 border border-slate-700/50 px-3 py-1.5 rounded-lg">
                              Подготовка
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lobby Control Action footer */}
              {allOnSameTeam && (
                <div className="mt-4 bg-rose-950/40 border border-rose-800/60 p-3.5 rounded-xl flex items-center gap-3 text-rose-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping shrink-0" />
                  <p className="text-xs leading-relaxed">
                    <strong className="text-rose-100">Запуск заблокирован.</strong> Все командиры в одной команде. Смените номера команд, чтобы разделиться по сторонам.
                  </p>
                </div>
              )}

              <div className="mt-8 border-t border-slate-800/80 pt-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
                <button
                  onClick={onLeaveLobby}
                  className="ui-btn ui-btn-ghost w-full sm:w-auto text-xs uppercase tracking-wide py-2.5 px-6"
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
                      className="ui-btn ui-btn-primary clip-bevel-sm w-full sm:w-auto uppercase tracking-widest py-3 px-8"
                    >
                      <Swords className="w-4 h-4" /> Начать кампанию
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const nextReady = !selfPlayer?.isReady;
                        onUpdatePlayer(selectedFaction, selectedTeam, nextReady);
                        sound.playClick();
                      }}
                      disabled={allOnSameTeam && !selfPlayer?.isReady}
                      className={`ui-btn w-full sm:w-auto uppercase tracking-widest py-3 px-8 ${
                        selfPlayer?.isReady ? 'ui-btn-ghost' : 'ui-btn-primary clip-bevel-sm'
                      }`}
                    >
                      {selfPlayer?.isReady ? 'Отменить готовность' : 'Подтвердить готовность'}
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
                    className={`ui-btn w-full sm:w-auto uppercase tracking-widest py-3 px-8 ${
                      selfPlayer?.isReady ? 'ui-btn-ghost' : 'ui-btn-primary clip-bevel-sm'
                    }`}
                  >
                    {selfPlayer?.isReady ? 'Отменить готовность' : 'Подтвердить готовность'}
                  </button>
                )}
              </div>
            </div>

            {/* Right Col: Lobby Chat & Faction selector */}
            <div className="p-6 bg-slate-950/30 flex flex-col justify-between h-[520px] lg:h-auto">
              <div className="flex flex-col flex-1 h-0">
                <h3 className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-3 font-semibold flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-cyan-400" /> Тактический чат
                </h3>

                {/* Chat feed */}
                <div className="flex-1 bg-slate-950/80 border border-slate-800/70 rounded-xl p-4 font-mono text-xs overflow-y-auto space-y-2.5 min-h-[220px]">
                  {chatMessages.length === 0 ? (
                    <p className="text-center text-slate-500 mt-12 leading-relaxed not-italic">Линия связи защищена.<br />Скоординируйте атаку с союзниками.</p>
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
                    placeholder="Сообщение союзникам..."
                    className="ui-field flex-1 px-3 py-2 text-xs font-mono"
                  />
                  <button
                    type="submit"
                    className="ui-btn ui-btn-ghost px-3.5 text-cyan-400"
                    aria-label="Отправить сообщение"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>

              {/* Quick Faction Toggle Inside lobby */}
              <div className="mt-6 border-t border-slate-800/80 pt-5">
                <h3 className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-3 font-semibold">Сменить фракцию</h3>
                <div className="grid grid-cols-2 gap-2">
                  {FACTIONS.map((fac) => {
                    const active = selectedFaction === fac.value;
                    const FacIcon = fac.icon;
                    return (
                      <button
                        key={fac.value}
                        onClick={() => c_updatePlayerFaction(fac.value)}
                        className="ui-btn flex items-center gap-2 justify-start text-left p-2.5 rounded-lg border text-xs transition"
                        style={active
                          ? { background: `rgb(${fac.rgb} / 0.14)`, borderColor: `rgb(${fac.rgb} / 0.7)`, color: fac.hex }
                          : { background: 'rgb(15 23 42 / 0.5)', borderColor: 'rgb(148 163 184 / 0.15)', color: 'rgb(148 163 184)' }}
                      >
                        <FacIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-semibold truncate">{fac.short}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Matchmaking / Setup selection */
          <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-[500px] relative">
            {/* Active CRT tactical line sweep animation inside workspace */}
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(34,211,238,0.05)_50%,transparent)] h-full w-full pointer-events-none animate-radar-sweep opacity-25 z-0" />

            {/* 3 columns: Left / Faction Selection */}
            <div className="md:col-span-3 p-6 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-800/80 relative z-10">
              <div>
                <h2 className="text-[11px] tracking-[0.18em] uppercase text-slate-500 mb-5 font-semibold flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-cyan-400" /> Выбор фракции командования
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {FACTIONS.map((fac) => {
                    const isSelected = selectedFaction === fac.value;
                    const FacIcon = fac.icon;
                    return (
                      <button
                        key={fac.value}
                        onClick={() => c_updatePlayerFaction(fac.value)}
                        className="text-left p-4 rounded-xl border transition-all duration-200 hover:-translate-y-0.5 cursor-pointer flex flex-col justify-between h-[168px] relative group overflow-hidden"
                        style={isSelected
                          ? { background: `rgb(${fac.rgb} / 0.10)`, borderColor: `rgb(${fac.rgb} / 0.75)`, boxShadow: `0 10px 30px -12px rgb(${fac.rgb} / 0.5)` }
                          : { background: 'rgb(2 6 12 / 0.4)', borderColor: 'rgb(148 163 184 / 0.14)' }}
                      >
                        {/* faction color rail */}
                        <span className="absolute left-0 top-0 bottom-0 w-1 transition-opacity" style={{ backgroundColor: fac.hex, opacity: isSelected ? 1 : 0.3 }} />

                        <div>
                          <div className="flex items-center gap-2.5 mb-2">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
                              style={{ background: `rgb(${fac.rgb} / 0.15)`, borderColor: `rgb(${fac.rgb} / 0.4)`, color: fac.hex }}
                            >
                              <FacIcon className="w-5 h-5" />
                            </div>
                            <h3 className="font-black tracking-wide text-sm" style={{ color: isSelected ? fac.hex : 'rgb(226 232 240)' }}>
                              {fac.label}
                            </h3>
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                            {fac.desc}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 relative z-10">
                          {fac.traits.map(t => (
                            <span
                              key={t}
                              className="text-[9px] font-mono border px-2 py-0.5 rounded uppercase font-semibold"
                              style={isSelected
                                ? { borderColor: `rgb(${fac.rgb} / 0.4)`, color: fac.hex, background: `rgb(${fac.rgb} / 0.12)` }
                                : { borderColor: 'rgb(148 163 184 / 0.18)', color: 'rgb(100 116 139)' }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 ui-panel ui-panel-tight p-4">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide whitespace-nowrap">Команда</span>
                    <select
                      value={selectedTeam}
                      onChange={(e) => c_updatePlayerTeam(parseInt(e.target.value))}
                      className="ui-select text-xs font-mono py-1.5 px-3 text-cyan-300"
                    >
                      {[1, 2, 3, 4, 5].map(t => (
                        <option key={t} value={t}>Команда {t}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Игроки с одинаковым номером воюют на одной стороне. Разные номера — режим «каждый сам за себя».
                  </p>
                </div>
              </div>

              {/* Mode select and credits */}
              <div className="mt-8 border-t border-slate-800/80 pt-5 flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="flex bg-slate-950/80 border border-slate-800/80 p-1 rounded-xl">
                  <button
                    onClick={() => {
                      setActiveTab('single');
                      sound.playClick();
                    }}
                    className={`ui-btn flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs tracking-wide uppercase ${
                      activeTab === 'single'
                        ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" /> Одиночная
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('multi');
                      sound.playClick();
                    }}
                    className={`ui-btn flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs tracking-wide uppercase ${
                      activeTab === 'multi'
                        ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" /> Мультиплеер
                  </button>
                </div>

                <p className="text-[10px] font-mono text-slate-600">© 2026 GENERALS · MODERN CONFLICT</p>
              </div>
            </div>

            {/* Right Col: Details depending on ActiveTab */}
            <div className="md:col-span-2 p-6 bg-slate-950/20 flex flex-col justify-between relative z-10">
              {activeTab === 'single' ? (
                /* SINGLE PLAYER CONFIG */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <h2 className="text-[11px] tracking-[0.18em] uppercase text-slate-500 mb-4 font-semibold flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-cyan-400" /> Настройка боя
                    </h2>

                    <div className="ui-panel ui-panel-tight p-5 space-y-5">
                      {/* AI Count */}
                      <div className="space-y-2.5">
                        <label className="text-xs text-slate-300 font-semibold uppercase tracking-wide flex justify-between">
                          <span>Количество врагов</span>
                          <span className="text-cyan-400 font-bold font-mono">{aiCount} / 5</span>
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
                        <p className="text-[10px] text-slate-500 leading-normal">
                          Размер карты растёт с числом бойцов (120×120 → 200×200), чтобы у каждого генерала был простор для базы.
                        </p>
                      </div>

                      {/* Opponent Setup Details */}
                      <div className="space-y-2.5 pt-4 border-t border-slate-800/70 max-h-[220px] overflow-y-auto pr-1">
                        <p className="text-[10px] text-slate-500 uppercase tracking-[0.14em] font-semibold">Оппоненты ИИ</p>
                        {aiSetups.map((ai, index) => {
                          const FacIcon = FACTIONS.find(f => f.value === ai.faction)?.icon || Bot;
                          const facHex = FACTIONS.find(f => f.value === ai.faction)?.hex || '#94a3b8';
                          return (
                          <div key={ai.id} className="p-2.5 bg-slate-950/50 border border-slate-800/80 rounded-lg flex flex-col sm:flex-row gap-2 justify-between items-start sm:items-center text-xs">
                            <span className="font-semibold text-slate-300 font-mono text-[11px] flex items-center gap-1.5">
                              <FacIcon className="w-3.5 h-3.5 shrink-0" style={{ color: facHex }} />
                              {ai.name.replace('General', 'Генерал')}
                            </span>
                            <div className="flex gap-2 w-full sm:w-auto justify-end">
                              <select
                                value={ai.faction}
                                onChange={(e) => updateAiFaction(index, e.target.value as Faction)}
                                className="ui-select text-[11px] font-mono py-1 px-2"
                              >
                                {FACTIONS.map(f => (
                                  <option key={f.value} value={f.value}>{f.short}</option>
                                ))}
                              </select>
                              <select
                                value={ai.team}
                                onChange={(e) => updateAiTeam(index, parseInt(e.target.value))}
                                className="ui-select text-[11px] font-mono py-1 px-2"
                              >
                                {[1, 2, 3, 4, 5].map(t => (
                                  <option key={t} value={t}>Ком. {t}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                    {isSingleplayerAllSameTeam && (
                      <div className="mt-3.5 bg-rose-950/40 border border-rose-800/60 p-3.5 rounded-xl flex gap-3 text-rose-200">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping mt-1.5 shrink-0" />
                        <p className="text-[11px] leading-relaxed">
                          <strong className="text-rose-100">Запуск заблокирован.</strong> Вы и все боты в одной команде. Измените номера команд, чтобы разделиться.
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleLaunchSingleplayer}
                    disabled={isSingleplayerAllSameTeam}
                    className="ui-btn ui-btn-primary clip-bevel w-full mt-6 uppercase tracking-widest py-3.5 px-6"
                  >
                    <Swords className="w-4 h-4" /> Начать одиночный бой
                  </button>
                </div>
              ) : (
                /* MULTIPLAYER LOBBY JOIN CONFIG */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <h2 className="text-[11px] tracking-[0.18em] uppercase text-slate-500 mb-4 font-semibold flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-cyan-400" /> Сетевой командный центр
                    </h2>

                    <div className="space-y-3.5">
                      {/* Random Matchmaker explanation */}
                      <div className="ui-panel ui-panel-tight p-4 space-y-2.5">
                        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          <Radio className="w-4 h-4 text-cyan-400" /> Быстрый подбор
                        </h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Подключайтесь к другим генералам в общем пуле. Таймер запуска активируется при входе минимум 2 человек.
                        </p>
                        <button
                          onClick={() => {
                            sound.playLaunch();
                            onJoinMatchmaking(playerName, selectedFaction, selectedTeam);
                          }}
                          className="ui-btn ui-btn-ghost w-full mt-1 text-xs uppercase tracking-wide py-3 border-cyan-700/50 text-cyan-300"
                        >
                          Найти игру · {matchmakingQueueCount} в очереди
                        </button>
                      </div>

                      {/* Custom/Friends room section */}
                      <div className="ui-panel ui-panel-tight p-4 space-y-2.5">
                        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                          <Users className="w-4 h-4 text-cyan-400" /> Игра с друзьями
                        </h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Создайте выделенную комнату и получите ссылку-приглашение, чтобы собрать друзей в одном лобби.
                        </p>
                        <button
                          onClick={handleCreateCustom}
                          className="ui-btn ui-btn-primary clip-bevel-sm w-full mt-1 text-xs uppercase tracking-wide py-3"
                        >
                          <ChevronRight className="w-4 h-4" /> Создать комнату
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-500 mt-6 leading-relaxed flex items-center gap-1.5">
                    <Cpu className="w-3 h-3 text-slate-600 shrink-0" /> Связь по WebSocket с минимальным пингом. Задайте имя генерала вверху перед запуском.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
       </div>
      </div>
    </div>
  );
}

function BackgroundBattle() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    
    // 1. Create Three.js Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#05080c', 0.035);

    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 120);
    camera.position.set(24, 13, 24);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    // 2. Dynamic lighting for visual pop
    const hemiLight = new THREE.HemisphereLight('#1e293b', '#070b0f', 1.0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight('#22d3ee', 2.0);
    dirLight1.position.set(12, 18, 10);
    scene.add(dirLight1);

    const redBaseLight = new THREE.PointLight('#f87171', 4.0, 15);
    redBaseLight.position.set(16, 1.5, 4);
    scene.add(redBaseLight);

    const blueBaseLight = new THREE.PointLight('#60a5fa', 4.0, 15);
    blueBaseLight.position.set(-16, 1.5, -4);
    scene.add(blueBaseLight);

    // 3. Grid Ground Plane representing digital grid battlefield
    const size = 70;
    const divisions = 28;
    const gridHelper = new THREE.GridHelper(size, divisions, '#14b8a6', '#111827');
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    // 4. Tiberium / Resource Crystal Fields: Green & Teal glowing shards
    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: '#10b981',
      emissive: '#047857',
      roughness: 0.1,
      metalness: 0.9,
      flatShading: true
    });
    
    const crystalGroup = new THREE.Group();
    const crystalCoords = [
      { x: -5, z: -3, scale: 0.7 },
      { x: -6, z: -4, scale: 0.9 },
      { x: -4, z: -2, scale: 0.6 },
      { x: 5, z: 4, scale: 0.8 },
      { x: 6, z: 3, scale: 0.9 },
      { x: 4, z: 5, scale: 0.5 },
      { x: 0, z: -8, scale: 1.1 },
      { x: -1, z: -9, scale: 0.7 },
      { x: 1, z: -7, scale: 0.6 }
    ];
    
    crystalCoords.forEach(c => {
      const crystalGeo = new THREE.ConeGeometry(0.35 * c.scale, 1.2 * c.scale, 5);
      const crystalMesh = new THREE.Mesh(crystalGeo, crystalMaterial);
      crystalMesh.position.set(c.x, 0.4 * c.scale, c.z);
      // Random tilt
      crystalMesh.rotation.set(
        (Math.random() - 0.5) * 0.4,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.4
      );
      crystalGroup.add(crystalMesh);
    });
    scene.add(crystalGroup);

    // 5. Defensive Static Towers that fire energy particles
    const createDefenseTower = (x: number, z: number, laserColor: string) => {
      const g = new THREE.Group();
      
      // Tower base skeleton
      const baseGeo = new THREE.CylinderGeometry(0.8, 1.2, 1.5, 6);
      const baseMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.6, metalness: 0.5 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.75;
      g.add(base);

      // Central generator pillar
      const coreGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.0, 6);
      const coreMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.8 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 1.6;
      g.add(core);

      // Glowing condenser ring
      const ringGeo = new THREE.TorusGeometry(0.5, 0.15, 6, 12);
      const ringMat = new THREE.MeshStandardMaterial({ color: laserColor, emissive: laserColor, roughness: 0.2 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 2.0;
      ring.name = "glowing_ring";
      g.add(ring);

      g.position.set(x, 0, z);
      scene.add(g);
      return g;
    };

    const blueTower = createDefenseTower(-18, -6, '#60a5fa');
    const redTower = createDefenseTower(18, 6, '#f87171');

    // 6. Combatants structures (Tanks, Barracks, and Fortresses)
    const entities: { mesh: THREE.Group; faction: 'ally' | 'enemy'; speed: number; x: number; z: number; targetX: number; targetZ: number; shootCooldown: number }[] = [];

    // Create a tank body helper
    const createTankMesh = (color: string, factionColor: string) => {
      const g = new THREE.Group();
      
      // Bottom chassis
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2.1), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
      body.position.y = 0.225;
      g.add(body);

      // Tread overlays to signify heavy armor
      const leftBelt = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 2.3), new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 }));
      leftBelt.position.set(-0.85, 0.175, 0);
      const rightBelt = leftBelt.clone();
      rightBelt.position.x = 0.85;
      g.add(leftBelt);
      g.add(rightBelt);

      // Turret dome
      const turret = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4 }));
      turret.scale.set(1.1, 0.7, 1.1);
      turret.position.set(0, 0.55, -0.1);
      g.add(turret);

      // Cannon barrel
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8), new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.7 }));
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(0, 0.55, 0.7);
      g.add(cannon);

      // Faction glow antennna
      const antGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4);
      const antMesh = new THREE.Mesh(antGeo, new THREE.MeshBasicMaterial({ color: factionColor }));
      antMesh.position.set(0.3, 0.8, -0.4);
      g.add(antMesh);

      return g;
    };

    // Spawn Alliance vehicles (Blue)
    for (let i = 0; i < 4; i++) {
      const tank = createTankMesh('#1e293b', '#60a5fa');
      tank.position.set(-16 + i * 3, 0, -3 + (Math.random() - 0.5) * 6);
      scene.add(tank);
      entities.push({
        mesh: tank,
        faction: 'ally',
        speed: 0.016 + Math.random() * 0.006,
        x: tank.position.x,
        z: tank.position.z,
        targetX: -14 + i * 3.2 + (Math.random() - 0.5) * 5,
        targetZ: -1 + (Math.random() - 0.5) * 6,
        shootCooldown: 40 + Math.random() * 80
      });
    }

    // Spawn Coalition vehicles (Red)
    for (let i = 0; i < 4; i++) {
      const tank = createTankMesh('#1e1b1b', '#f87171');
      tank.rotation.y = Math.PI;
      tank.position.set(16 - i * 3, 0, 3 + (Math.random() - 0.5) * 6);
      scene.add(tank);
      entities.push({
        mesh: tank,
        faction: 'enemy',
        speed: 0.016 + Math.random() * 0.006,
        x: tank.position.x,
        z: tank.position.z,
        targetX: 14 - i * 3.2 + (Math.random() - 0.5) * 5,
        targetZ: 1 + (Math.random() - 0.5) * 6,
        shootCooldown: 40 + Math.random() * 80
      });
    }

    // 7. Tactical UAV Drone hovering in sky
    const createDroneUav = () => {
      const g = new THREE.Group();
      // Fuselage
      const fuseGeo = new THREE.ConeGeometry(0.3, 1.4, 4);
      const fuseMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.3 });
      const fuse = new THREE.Mesh(fuseGeo, fuseMat);
      fuse.rotation.x = Math.PI / 2;
      g.add(fuse);

      // Swept wing
      const wingGeo = new THREE.BoxGeometry(3.0, 0.04, 0.4);
      const wing = new THREE.Mesh(wingGeo, fuseMat);
      wing.position.set(0, 0.05, 0.1);
      g.add(wing);

      // Glowing status optic eye
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: '#22d3ee' }));
      eye.position.set(0, -0.15, 0.5);
      g.add(eye);

      // Spinning propeller on tail
      const propGroup = new THREE.Group();
      const bladeGeo = new THREE.BoxGeometry(0.8, 0.06, 0.02);
      const blades = new THREE.Mesh(bladeGeo, new THREE.MeshBasicMaterial({ color: '#475569' }));
      propGroup.add(blades);
      propGroup.position.set(0, 0, -0.75);
      propGroup.name = "propellers";
      g.add(propGroup);

      g.position.set(0, 7, 0);
      scene.add(g);
      return g;
    };

    const droneUav = createDroneUav();
    let droneAngle = 0;

    // 8. Active lasers & rocket projectiles
    const bullets: { mesh: THREE.Group; startY: number; startX: number; startZ: number; currX: number; currY: number; currZ: number; targetX: number; targetZ: number; t: number; speed: number; color: string }[] = [];
    
    // Spark and Explosion particles
    const particles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; startColor: string }[] = [];

    const createExplosion = (ex: number, ey: number, ez: number, color: string) => {
      const count = 12;
      for (let i = 0; i < count; i++) {
        const sizeMultiplier = Math.random() > 0.6 ? 1.6 : 0.8;
        const gm = new THREE.SphereGeometry(0.14 * sizeMultiplier, 4, 4);
        
        // Dynamic fiery gradient color simulation!
        const flameColor = Math.random() > 0.5 ? '#f59e0b' : color;
        const mt = new THREE.MeshBasicMaterial({ color: flameColor, transparent: true, opacity: 0.95 });
        const p = new THREE.Mesh(gm, mt);
        p.position.set(ex, ey, ez);
        scene.add(p);
        
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        const sp = 0.05 + Math.random() * 0.12;
        
        particles.push({
          mesh: p,
          vx: Math.sin(phi) * Math.cos(theta) * sp,
          vy: Math.sin(phi) * Math.sin(theta) * sp + 0.04,
          vz: Math.cos(phi) * sp,
          life: 1.0,
          startColor: flameColor
        });
      }

      // Add small battlefield lingering rising smoke plume!
      for (let s = 0; s < 4; s++) {
        const gm = new THREE.SphereGeometry(0.25, 4, 4);
        const mt = new THREE.MeshBasicMaterial({ color: '#334155', transparent: true, opacity: 0.55 });
        const p = new THREE.Mesh(gm, mt);
        p.position.set(
          ex + (Math.random() - 0.5) * 0.5,
          ey + 0.1,
          ez + (Math.random() - 0.5) * 0.5
        );
        scene.add(p);
        particles.push({
          mesh: p,
          vx: (Math.random() - 0.5) * 0.015,
          vy: 0.035 + Math.random() * 0.025,
          vz: (Math.random() - 0.5) * 0.015,
          life: 0.8 + Math.random() * 0.5,
          startColor: '#334155'
        });
      }
    };

    // 9. Slowly orbiting cinematic camera path
    let cameraAngle = 0;

    // 10. Core Render Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Rotor animation of hovering reconnaissance drone
      droneAngle += 0.0055;
      droneUav.position.x = Math.sin(droneAngle) * 20;
      droneUav.position.z = Math.cos(droneAngle) * 16;
      droneUav.position.y = 7.5 + Math.sin(droneAngle * 2) * 1.5;
      droneUav.rotation.y = -droneAngle + Math.PI / 2;
      
      const rotors = droneUav.getObjectByName('propellers');
      if (rotors) {
        rotors.rotation.z += 0.8;
      }

      // Spin tower condenser rings slightly to look energized
      const blueRing = blueTower.getObjectByName('glowing_ring');
      if (blueRing) {
        blueRing.rotation.z += 0.04;
        blueRing.position.y = 2.0 + Math.sin(Date.now() * 0.005) * 0.06;
      }
      const redRing = redTower.getObjectByName('glowing_ring');
      if (redRing) {
        redRing.rotation.z += 0.04;
        redRing.position.y = 2.0 + Math.sin(Date.now() * 0.005 + 2) * 0.06;
      }

      // Slowly rotate crystal shards
      crystalGroup.children.forEach((c, idx) => {
        c.rotation.y += 0.0025 * (1 + (idx % 3));
      });

      // Orbit camera slowly over timeframe to capture the battle depth in epic perspective
      cameraAngle += 0.0010;
      camera.position.x = Math.cos(cameraAngle) * 31 + 1.5;
      camera.position.z = Math.sin(cameraAngle) * 31;
      camera.position.y = 12 + Math.sin(cameraAngle * 1.4) * 2.5;
      camera.lookAt(new THREE.Vector3(0, 0.8, 0));

      // Update tanks movement & reload times
      entities.forEach(ent => {
        const dx = ent.targetX - ent.x;
        const dz = ent.targetZ - ent.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist > 0.5) {
          ent.x += (dx / dist) * ent.speed;
          ent.z += (dz / dist) * ent.speed;
          ent.mesh.position.set(ent.x, 0, ent.z);
          ent.mesh.rotation.y = Math.atan2(dx, dz);
        } else {
          // Relocate new target coordinates
          if (ent.faction === 'ally') {
            ent.targetX = -13 + Math.random() * 10;
            ent.targetZ = (Math.random() - 0.5) * 12;
          } else {
            ent.targetX = 3 + Math.random() * 10;
            ent.targetZ = (Math.random() - 0.5) * 12;
          }
        }

        // Fire logic
        ent.shootCooldown -= 1;
        if (ent.shootCooldown <= 0) {
          ent.shootCooldown = 90 + Math.random() * 100; // restart bullet buffer timer
          
          const enemies = entities.filter(opponent => opponent.faction !== ent.faction);
          if (enemies.length > 0) {
            const trg = enemies[Math.floor(Math.random() * enemies.length)];
            
            // Spawn bullet cylinder pointing forward
            const bulletGroup = new THREE.Group();
            const shellColor = ent.faction === 'ally' ? '#60a5fa' : '#f87171';
            const cylinder = new THREE.Mesh(
              new THREE.CylinderGeometry(0.1, 0.1, 0.42, 4),
              new THREE.MeshBasicMaterial({ color: shellColor })
            );
            cylinder.rotation.x = Math.PI / 2;
            bulletGroup.add(cylinder);

            // Muzzle barrel flash particle
            const flare = new THREE.Mesh(new THREE.SphereGeometry(0.28, 4, 4), new THREE.MeshBasicMaterial({ color: '#f59e0b' }));
            flare.position.set(ent.x, 0.55, ent.z);
            scene.add(flare);
            particles.push({ mesh: flare, vx: 0, vy: 0, vz: 0, life: 0.12, startColor: '#f59e0b' });

            bulletGroup.position.set(ent.x, 0.55, ent.z);
            scene.add(bulletGroup);

            bullets.push({
              mesh: bulletGroup,
              startX: ent.x,
              startY: 0.55,
              startZ: ent.z,
              currX: ent.x,
              currY: 0.55,
              currZ: ent.z,
              targetX: trg.x,
              targetZ: trg.z,
              t: 0,
              speed: 0.022 + Math.random() * 0.012,
              color: shellColor
            });
          }
        }
      });

      // Defensive static defense tower automatic pulse lasers
      [ { tower: blueTower, faction: 'ally', color: '#60a5fa', tx: 6, tz: 3 },
        { tower: redTower, faction: 'enemy', color: '#f87171', tx: -6, tz: -3 }
      ].forEach(twRef => {
        if (Math.random() < 0.008) { // occasional laser discharge
          const enemies = entities.filter(e => e.faction !== twRef.faction);
          if (enemies.length > 0) {
            const targetUnit = enemies[Math.floor(Math.random() * enemies.length)];
            const distSq = (targetUnit.x - twRef.tower.position.x) * (targetUnit.x - twRef.tower.position.x) + (targetUnit.z - twRef.tower.position.z) * (targetUnit.z - twRef.tower.position.z);
            if (distSq < 225) { // within range of 15
              
              // Raycast thin cylinder representing discharge laser beam
              const beamGroup = new THREE.Group();
              const beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 4);
              const beamMat = new THREE.MeshBasicMaterial({ color: twRef.color });
              const beamMesh = new THREE.Mesh(beamGeo, beamMat);
              beamMesh.rotation.x = Math.PI / 2;
              beamGroup.add(beamMesh);
              beamGroup.position.set(twRef.tower.position.x, 2.0, twRef.tower.position.z);
              scene.add(beamGroup);

              bullets.push({
                mesh: beamGroup,
                startX: twRef.tower.position.x,
                startY: 2.0,
                startZ: twRef.tower.position.z,
                currX: twRef.tower.position.x,
                currY: 2.0,
                currZ: twRef.tower.position.z,
                targetX: targetUnit.x,
                targetZ: targetUnit.z,
                t: 0,
                speed: 0.045, // fast laser pulse
                color: twRef.color
              });
            }
          }
        }
      });

      // Maintain active bullets
      for (let bIdx = bullets.length - 1; bIdx >= 0; bIdx--) {
        const b = bullets[bIdx];
        b.t += b.speed;
        
        if (b.t >= 1) {
          createExplosion(b.targetX, 0.25, b.targetZ, b.color === '#60a5fa' ? '#3b82f6' : '#ef4444');
          scene.remove(b.mesh);
          bullets.splice(bIdx, 1);
        } else {
          // Arc calculation for ballistic shells, linear for tower lasers (which move fast)
          const isLaser = b.speed > 0.04;
          const arc = isLaser ? 0.0 : Math.sin(b.t * Math.PI) * 4.5;
          b.currX = b.startX + (b.targetX - b.startX) * b.t;
          b.currY = b.startY + (0.25 - b.startY) * b.t + arc;
          b.currZ = b.startZ + (b.targetZ - b.startZ) * b.t;
          b.mesh.position.set(b.currX, b.currY, b.currZ);
          
          // Align bullet mesh direction to motion vector
          b.mesh.lookAt(new THREE.Vector3(b.targetX, b.startY + arc, b.targetZ));
        }
      }

      // Maintain particulate debris explosions
      for (let pIdx = particles.length - 1; pIdx >= 0; pIdx--) {
        const p = particles[pIdx];
        p.life -= p.startColor === '#334155' ? 0.012 : 0.035; // smoke lasts longer than sparks
        if (p.life <= 0) {
          scene.remove(p.mesh);
          particles.splice(pIdx, 1);
        } else {
          p.mesh.position.x += p.vx;
          p.mesh.position.y += p.vy;
          p.mesh.position.z += p.vz;
          if (p.startColor !== '#334155') {
            p.vy -= 0.0035; // pull sparks downwards by gravity
          } else {
            p.vy += 0.001; // smoke drifts slowly upwards
            p.vx += Math.sin(Date.now() * 0.01 + pIdx) * 0.0015; // smooth wind sway
          }
          (p.mesh.material as THREE.Material).opacity = p.life * 0.8;
          p.mesh.scale.setScalar(p.life);
        }
      }

      renderer.render(scene, camera);
    };
    
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      scene.remove(gridHelper);
      scene.remove(crystalGroup);
      scene.remove(blueTower);
      scene.remove(redTower);
      scene.remove(droneUav);
      entities.forEach(e => scene.remove(e.mesh));
      bullets.forEach(b => scene.remove(b.mesh));
      particles.forEach(p => scene.remove(p.mesh));
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={mountRef} className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-hidden bg-[#05080c]" />
  );
}
