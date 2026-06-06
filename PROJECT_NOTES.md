# PROJECT_NOTES — справочник по кодовой базе

> Файл для быстрого ввода в курс дела (в т.ч. после очистки контекста / в новой сессии).
> Цель: не изучать проект заново каждый раз. Здесь — карта кода, ключевые системы,
> где что искать и как всё устроено. Обновляй этот файл при крупных изменениях архитектуры.

## Что это за проект

Браузерная RTS в духе **Command & Conquer: Generals**. Сейчас основной режим —
**синглплеер против ИИ** (есть и заготовка мультиплеера через WebSocket).

**Стек:** React 19 + Three.js (`three@0.184`) + Vite 6 + TypeScript. Сервер — Express + `ws`
(`server.ts`), запускается через `tsx`. UI на Tailwind v4 (`@tailwindcss/vite`) + lucide-react.
Анимации — `motion`. Звук — собственный движок на Web Audio API (без файлов, всё синтезируется).

**Язык интерфейса/уведомлений:** русский.

### Команды
- `npm run dev` — дев-сервер (`tsx server.ts`, Express отдаёт Vite + WebSocket).
- `npm run build` — `vite build` + бандл сервера через esbuild в `dist/server.cjs`.
- `npm run start` — прод (`node dist/server.cjs`, `NODE_ENV=production`).
- `npm run lint` — `tsc --noEmit` (типы проверяются, но сборка идёт через esbuild и
  **не падает** от ошибок типов — см. ниже про «свободную типизацию»).

## Карта файлов

```
src/
  App.tsx                      — корневой компонент: лобби ↔ игра ↔ экран победы,
                                 WebSocket, выбор фракции/команды, запуск синглплеера с ИИ.
  main.tsx                     — точка входа React.
  index.css                    — Tailwind + ДИЗАЙН-СИСТЕМА (классы .ui-*, .prod-btn,
                                 .clip-bevel, анимации). ПЕРЕИСПОЛЬЗУЙ их, не лепи ad-hoc Tailwind.
  types.ts                     — общие типы: Player, Lobby, GameEntity, GameAction(Event).
  components/
    RTSGameCanvas.tsx          — ⭐ ГЛАВНЫЙ ФАЙЛ (~5300 строк). Вся игра: сцена Three.js,
                                 туман войны, игровой цикл (движение, бой, харвестеры,
                                 гарнизоны), ИИ-командир, весь игровой HUD (JSX внизу файла).
    LobbyPanel.tsx             — экран лобби (выбор фракции/команды, список игроков, чат).
    MobileShell.tsx            — полноэкранный режим + «поверните телефон» (rotate-gate).
  utils/
    audio.ts                   — RTSAudioEngine (синглтон `sound`). Спатиальный звук:
                                 sound.playSpatial('playExplosion'|'playGunshot'|..., x, z),
                                 sound.setListener(x,z,viewRadius,rotation) — вызывается каждый кадр.
                                 Прочее: playSelect/playOrder/playClick/playBuildComplete/
                                 playAlert/playLaunch и фракционные залпы (playAllianceZap и т.д.).
    factionProperties.ts       — статы юнитов/зданий ПО ФРАКЦИЯМ:
                                 getFactionUnitProperties(unitType, faction) -> {hp,speed,range,dps,cost,...}
                                 getFactionBuildingProperties(bType, faction) -> {hp,cost,power,...}
                                 getUnitShortName / getBuildingShortName — короткие имена для кнопок.
    mapGenerator.ts            — процедурная карта по сиду:
                                 generateProceduralMap(seed,size,players) -> GeneratedMap
                                 { nodes(сетка высот), startingBases, resourceSpots, decorations, size }
                                 createSeededRandom(seed) — детерминированный ГСЧ.
server.ts                      — Express + WebSocket: лобби, матчмейкинг, ретрансляция sync_action.
```

## Ключевые типы (`src/types.ts`)

- `Faction = 'Alliance' | 'Coalition' | 'Union' | 'Syndicate'`.
- `UnitType`: `drone_scout, drone_kamikaze, cyber_specops, precision_tank, artillery_mlrs,
  mobile_jammer, builder, harvester`.
- `BuildingType`: `command_center, power_plant, supply_refinery, barracks, war_factory,
  defense_turret, oil_derrick, civilian_building`.
- `GameEntity` — ядро симуляции. Поля: id, type('unit'|'building'), subType, playerId, team,
  health/maxHealth, x/z, angle, state, targetX/targetZ/targetId/targetType, buildProgress, cooldown.
  **state**: `idle | moving | attacking | constructing | dead | garrisoned`.
  **Runtime-поля** (доступны во время игры): pitch, roll, garrisonedIn, harvesterState, harvesterCargo.

### ⚠️ «Свободная типизация»
Симуляция исторически вешала на `GameEntity` поля, которых не было в типе (pitch, roll,
garrisonedIn, harvester*, state 'garrisoned'). Сборка идёт esbuild'ом и **игнорирует ошибки
типов**, поэтому раньше это компилировалось. Эти поля уже добавлены в `types.ts`. Если
добавляешь новое runtime-поле — **внеси его в `GameEntity`**, чтобы `npm run lint` оставался зелёным.

## RTSGameCanvas.tsx — устройство (самое важное)

Это один гигантский компонент. Логика живёт внутри нескольких `useEffect`. Внутри главного
эффекта создаётся сцена Three.js, замыкаются все хелперы и крутится `gameLoop` (requestAnimationFrame).
Состояние симуляции — в `simulationRef.current` (ref, не React-state), чтобы не дёргать ререндеры.

### Состояние симуляции (`simulationRef.current`, тип в районе строки ~138)
`{ entities: GameEntity[], players: Player[], map, selectedIds, camX/camZ/camZoom/camRotation,
   credits, powerGen, buildingToPlace, commandStrikeActive, aiStates, ... }`
Раз в 12 тиков `selectedIds` синхронизируется в React-state `setSelectedEntityIds` (для HUD).

### Игровой цикл `gameLoop` (внутри главного useEffect)
Порядок (метки a..f в комментариях кода):
- a. камера/звук-листенер.
- a3. **Туман войны**: `refreshFog()` раз в 12 тиков; нейтральный декор и ресурсы видны по `isExploredAt`.
- d. **Главный цикл по `sim.entities`** — для каждой сущности:
  - мёртвые → убрать меш + обломки (`spawnPhysicalExplosionWreckage`, добавляется в сцену **глобально**).
  - создание меша (`constructModel`) при первом появлении.
  - мягкое расталкивание юнитов; клэмп к высоте террейна (`getTerrainHeight`).
  - **видимость по туману**: `fogReveals = team===свои || isVisibleAt(x,z); mesh.visible = ...`.
  - анимации (роторы дронов, антенны, насосы), наклон техники по склону (pitch/roll).
  - **constructing-блок** (стройка зданий): прогресс от ближайшего строителя, сварочные искры
    (gated по видимости!), завершение (звук/уведомление — только для своих).
  - стейт-машины: гарнизон спецназа в civilian_building, харвестеры (idle→extract→unload).
  - **БОЕВАЯ СИСТЕМА** (см. ниже).
  - турели (defense_turret) — отдельный автонаведение/огонь.
- e. **ИИ-командир** (синглплеер) раз в ~3.5 c (см. ниже).
- f. экономика/энергия раз в 60 тиков (доход с CC/refinery/derrick), победа/поражение.
- проекстайлы/взрывы/частицы обновляются отдельными массивами (`activeProjectiles`, `explosionParticles`).

### Туман войны (строки ~715–812)
- Сетка `fogGrid: Uint8Array(gridS*gridS)`, значения `FOG_UNSEEN=0 / FOG_EXPLORED=1 / FOG_VISIBLE=2`.
- Рендерится плоскостью-оверлеем (`fogMesh`, renderOrder 5) с альфой в DataTexture
  (visible→0, explored→130, unseen→245). Это **плоский тёмный оверлей**, не объёмный.
- `refreshFog()`: гасит VISIBLE→EXPLORED, потом штампует круги обзора вокруг своих живых сущностей.
- `sightRadius(ent)`: CC 14, прочие здания 10, drone_scout 16, артиллерия 13, остальные 9.
- Запросы для HUD/миникарты: `fogQueryRef.current = { visible(x,z), explored(x,z) }`.
- **ВАЖНО про скрытие врага:** меши прячутся через `mesh.visible`. Но эффекты, добавляемые
  **прямо в `scene`** (сварочные искры, обломки, вспышки, трассеры), туманом НЕ скрываются
  автоматически — их нужно гейтить вручную через `isVisibleAt(...)` / проверку команды.
  (Утечку «видно как строятся вражеские здания» чинили именно гейтом искр.)

### Боевая система (в главном цикле по entities)
Состояния юнита и логика:
- **moving** (`state==='moving'` + есть targetX/targetZ): шаг к цели; групповая остановка
  (`dynamicStopRadius`). **Огонь на ходу / бой в пути:**
  - `weaponRange = getUnitProps(...).range`, `foe = hasWeapon(ent) ? findHostileInRange(ent, weaponRange) : null`.
  - **Мои юниты** (`ent.playerId === playerId`): едут к цели И стреляют по foe на ходу (не сворачивают).
  - **ИИ/враги**: `holdToFight=true` — **останавливаются**, бьют foe, после смерти foe марш
    возобновляется сам (state остаётся 'moving').
- **idle**: автозахват ближайшего врага в радиусе `range+2.5` → переходит в attacking.
- **attacking** (targetId): для **ИИ** — оппортунистический перехват: если назначенная цель вне
  радиуса, но кто-то уже в радиусе огня — сначала добивает помеху (`findHostileInRange`).
  Мои юниты при явном приказе атаки преследуют именно указанную цель. Если в радиусе — огонь,
  если нет — подъезжает. Учитывает РЭБ-глушение (`mobile_jammer`).

**Хелперы боя** (определены перед `gameLoop`, ~строка 3141):
- `fireUnitWeapon(ent, victim, mesh, dist)` — ⭐ единая функция выстрела: выбирает тип снаряда
  по subType (shell/rocket/machinegun), кулдаун, вспышку, спавнит проджектайл, фракционный звук;
  для `drone_kamikaze` — мгновенный подрыв. Используется и в attacking, и в огне-на-ходу.
- `hasWeapon(ent)` — `range>0 && dps>0` (строители/харвестеры/РЭБ оружия не имеют, в бой не лезут).
- `findHostileInRange(ent, radius)` — ближайший враг в радиусе (учитывает клоак под РЭБ).

### ИИ-командир (синглплеер, метка «e.», строки ~4250+)
- Тик раз в ~3.5 c. Состояние на игрока в `sim.aiStates[playerId]`.
- Фазы: `build_base → gather_army → strike_defenses → strike_base`.
  - build_base: ставит power_plant → refinery (на derrick) → barracks → war_factory → turrets,
    через анимацию стройки; задачи строителям `taskAiBuilders`.
  - gather_army: тренирует пехоту/танки/артиллерию; при ≥8 боевых юнитов → strike.
  - strike_defenses → strike_base: цель — турели врага, затем CC/производство; при <3 юнитах отступает.
- ИИ «знает» расположение вражеских зданий (сканирует все entities) — это допустимый чит уровня
  простого RTS. Боевая логика выше делает марш умным (не проезжает мимо).
- Уведомления о вражеской стройке убраны (утечка позиций в тумане).

### Управление / ввод
- **Десктоп:** мышь — выбор (клик/рамка), ПКМ/клик по земле — приказ движения, по врагу — атака;
  колесо — зум; край экрана/WASD — скролл; обработчики mousedown/move/up.
- **Тач (моб):** `handleTouchStart/Move/End`.
  - одиночный тап по своему юниту/зданию (когда ничего не выбрано) → **выбор** (добавлено для моб.);
  - одиночный тап при выделении → приказ движения/атаки; в режиме стройки/удара → постановка;
  - **двойной тап** → выбор; двойной тап с удержанием+движение → рамка выделения;
  - одним пальцем драг → скролл камеры.

### HUD (JSX, низ файла ~4860+)
- Верх: бюджет/энергосеть (слева), кнопка «Выйти» (справа, отступ под глобальные кнопки звук/фуллскрин).
- Уведомления — `notifications` (top-left).
- **Нижняя командная панель** (`absolute ... bottom-2/4`): миникарта (радар) + супероружие +
  контекстное производство (в зависимости от выбранного: builder→здания, CC→строители,
  barracks/war_factory→юниты). Тултипы по ховеру.
- **Мобильная адаптация:** панель всегда в один ряд (`flex-row`), компактные размеры
  (`p-2 gap-2 max-h-[46vh]`), миникарта `w-24 h-24` на телефоне; плавающая панель действий
  (выбор армии/сброс/отмена) вынесена наверх по центру, чтобы не перекрывать меню.
- Миникарта: враги/нейтралы рисуются только где есть видимость (`fogQueryRef`).

## Полезные ориентиры (как быстро найти)
- Туман: ищи `fogGrid`, `refreshFog`, `isVisibleAt`, `sightRadius`, `fogQueryRef`.
- Бой/огонь: `fireUnitWeapon`, `findHostileInRange`, `state === 'attacking'`, `activeProjectiles`.
- Движение: `state === 'moving'`, `dynamicStopRadius`, `getTerrainHeight`.
- ИИ: `aiStates`, `aiState.phase`, `lastAiTick`, `taskAiBuilders`.
- Производство игрока: `triggerConstructionAction`, `handleTrainUnit`, `activeConstructionMode`, `buildingToPlace`.
- Приказы: `triggerMovementAction`, `triggerAttackAction`, `triggerCommandStrikeAction`.
- Статы: правь `src/utils/factionProperties.ts` (а НЕ дефолтные `UNIT_PROPERTIES`/`BUILDING_PROPERTIES`
  в начале RTSGameCanvas — те только для тултипов/имён по умолчанию).

## Договорённости / на что обращать внимание
- Эффекты в `scene` (искры/обломки/трассеры/вспышки) **не скрываются туманом сами** — гейти вручную.
- Любое новое runtime-поле сущности → добавляй в `GameEntity` (`types.ts`).
- UI — переиспользуй классы дизайн-системы из `index.css` (`.ui-panel`, `.ui-btn`, `.prod-btn`,
  `.clip-bevel*`), не плоди ad-hoc Tailwind.
- Тяжёлые проходы по `sim.entities` часто O(n²) (расталкивание, поиск целей) — для текущего
  числа юнитов (<~100) ок; при росте — оптимизировать (пространственная сетка).
- Перед сдачей: `npm run lint` (tsc) и `npm run build` (vite) должны проходить.
```
