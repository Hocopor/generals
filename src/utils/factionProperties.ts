import { Faction, UnitType, BuildingType } from '../types';

export interface FactionUnitProp {
  name: string;
  hp: number;
  speed: number;
  range: number;
  dps: number;
  cost: number;
  desc: string;
}

export interface FactionBuildingProp {
  name: string;
  hp: number;
  cost: number;
  power: number;
  desc: string;
}

// Short, faction-agnostic labels for the compact HUD build buttons.
// The full faction-specific name + description appear in the hover tooltip.
const UNIT_SHORT_NAMES: Record<UnitType, string> = {
  builder: 'Строитель',
  harvester: 'Сборщик',
  drone_scout: 'Разведчик',
  drone_kamikaze: 'Камикадзе',
  cyber_specops: 'Пехота',
  precision_tank: 'Танк',
  artillery_mlrs: 'Артиллерия',
  mobile_jammer: 'РЭБ'
};

const BUILDING_SHORT_NAMES: Record<BuildingType, string> = {
  command_center: 'Штаб',
  power_plant: 'Энергия',
  supply_refinery: 'НПЗ',
  oil_derrick: 'Вышка',
  barracks: 'Казарма',
  war_factory: 'Завод',
  defense_turret: 'Турель',
  civilian_building: 'Гарнизон'
};

export function getUnitShortName(unitType: UnitType): string {
  return UNIT_SHORT_NAMES[unitType] || unitType;
}

export function getBuildingShortName(bType: BuildingType): string {
  return BUILDING_SHORT_NAMES[bType] || bType;
}

export function getFactionUnitProperties(unitType: UnitType, faction: Faction): FactionUnitProp {
  let name = '';
  let hp = 100;
  let speed = 1.0;
  let range = 4.0;
  let dps = 15;
  let cost = 100;
  let desc = '';

  switch (unitType) {
    case 'drone_scout':
      if (faction === 'Alliance') {
        name = 'Сканер Шёпот'; hp = 60; speed = 2.6; range = 4.0; dps = 10; cost = 150;
        desc = 'Быстрый союзный дрон с улучшенным сканером сверхдальнего обзора.';
      } else if (faction === 'Coalition') {
        name = 'Дрозд-Детектор'; hp = 80; speed = 2.4; range = 3.5; dps = 14; cost = 160;
        desc = 'Тяжелый разведывательный БПЛА Коалиции с толстой броней.';
      } else if (faction === 'Union') {
        name = 'Шпион Спутник-3'; hp = 50; speed = 2.8; range = 3.5; dps = 11; cost = 120;
        desc = 'Экономичный разведывательный дрон массового производства.';
      } else { // Syndicate
        name = 'Дрон-Фантом СН-4'; hp = 55; speed = 2.9; range = 3.8; dps = 15; cost = 170;
        desc = 'Быстрый лазутчик, оснащённый токсичным мини-пулемётом.';
      }
      break;

    case 'drone_kamikaze':
      if (faction === 'Alliance') {
        name = 'Энерго-Ступа'; hp = 45; speed = 3.1; range = 1.0; dps = 210; cost = 200;
        desc = 'Мини-заряд Альянса. Наносит сильный точечный плазменный взрыв.';
      } else if (faction === 'Coalition') {
        name = 'Бомба Шахид-М'; hp = 65; speed = 2.8; range = 1.0; dps = 240; cost = 220;
        desc = 'Ударный дрон со сверхтяжелой термобарической частью.';
      } else if (faction === 'Union') {
        name = 'КУБ-Москит'; hp = 40; speed = 3.4; range = 1.0; dps = 180; cost = 150;
        desc = 'Дешевый роевой дрон-камикадзе с повышенной скоростью.';
      } else { // Syndicate
        name = 'Кислотный Клещ'; hp = 40; speed = 3.3; range = 1.0; dps = 230; cost = 190;
        desc = 'Токсичный био-дрон. Оставляет после себя облако ядовитого газа.';
      }
      break;

    case 'cyber_specops':
      if (faction === 'Alliance') {
        name = 'Кибер-Тамплиер'; hp = 100; speed = 1.45; range = 4.8; dps = 20; cost = 250;
        desc = 'Высокотехнологичный боец со световым копьем и микро-щитом.';
      } else if (faction === 'Coalition') {
        name = 'Огнемётчик Выжигатель'; hp = 115; speed = 1.3; range = 3.8; dps = 24; cost = 220;
        desc = 'Элитный штурмовик в тяжелой термо-броне с зажигательной смесью.';
      } else if (faction === 'Union') {
        name = 'Тесла-Штурмовик'; hp = 85; speed = 1.35; range = 4.4; dps = 17; cost = 180;
        desc = 'Боец Союза, генерирующий мощные ЭМ-разряды. Дешевая пехота.';
      } else { // Syndicate
        name = 'Теневой Клинок'; hp = 70; speed = 1.6; range = 4.6; dps = 25; cost = 240;
        desc = 'Невидимый диверсант. Стреляет отравленными иглами, обходящими броню.';
      }
      break;

    case 'precision_tank':
      // Laser tank dps slightly reduced to weaken as requested (from 32 down to ~23-28 depending on faction traits)
      if (faction === 'Alliance') {
        name = 'Танк Гренадер-Светоносец'; hp = 260; speed = 1.15; range = 6.2; dps = 23; cost = 500;
        desc = 'Флагманский танк Альянса. Усилен скоростными лазерными орудиями.';
      } else if (faction === 'Coalition') {
        name = 'Тяжелый Танк Мамонт'; hp = 350; speed = 0.9; range = 5.5; dps = 27; cost = 550;
        desc = 'Медленный бронированный монстр Коалиции с двойными орудиями.';
      } else if (faction === 'Union') {
        name = 'Тесла-Вектор'; hp = 235; speed = 1.25; range = 5.0; dps = 22; cost = 430;
        desc = 'Маневренная боевая машина Союза. Бьет непрерывными молниями.';
      } else { // Syndicate
        name = 'Арахнид Жнец'; hp = 210; speed = 1.35; range = 5.8; dps = 26; cost = 470;
        desc = 'Скоростной шагающий танк Синдиката. Выпускает нестабильную плазму.';
      }
      break;

    case 'artillery_mlrs':
      if (faction === 'Alliance') {
        name = 'Рельсовая Артиллерия'; hp = 130; speed = 0.85; range = 11.5; dps = 44; cost = 650;
        desc = 'Рельсотрон сверхдальней точности с электромагнитной разгонкой.';
      } else if (faction === 'Coalition') {
        name = 'Град Торнадо-Г'; hp = 160; speed = 0.75; range = 10.5; dps = 52; cost = 700;
        desc = 'Разрушительная тяжелая РСЗО Коалиции большой площади поражения.';
      } else if (faction === 'Union') {
        name = 'Установка Катюша-ЭМ'; hp = 110; speed = 0.9; range = 11.0; dps = 40; cost = 550;
        desc = 'Легендарное недорогое реактивное орудие с быстрой перезарядкой.';
      } else { // Syndicate
        name = 'Опустошитель Скверна'; hp = 115; speed = 1.0; range = 11.2; dps = 48; cost = 620;
        desc = 'Дальнобойный био-миномет. Засеивает площадь едкими кислотными лужами.';
      }
      break;

    case 'mobile_jammer':
      if (faction === 'Alliance') {
        name = 'Щит-Протектор'; hp = 180; speed = 1.3; range = 0; dps = 0; cost = 400;
        desc = 'Машина РЭБ. Генерирует active силовое поле невидимой маскировки.';
      } else if (faction === 'Coalition') {
        name = 'Форпост-Заглушка'; hp = 220; speed = 1.1; range = 0; dps = 0; cost = 430;
        desc = 'Прочный бронетранспортер Коалиции с комплексом подавления радаров.';
      } else if (faction === 'Union') {
        name = 'Станция РЭБ Буран'; hp = 140; speed = 1.4; range = 0; dps = 0; cost = 340;
        desc = 'Недорогой глушитель на высокопроходимом гусеничном ходу.';
      } else { // Syndicate
        name = 'Искажатель Тень'; hp = 150; speed = 1.5; range = 0; dps = 0; cost = 380;
        desc = 'Сверхбыстрый стелс-глушитель, искривляющий лазерное наведение.';
      }
      break;

    case 'builder':
      if (faction === 'Alliance') {
        name = 'Внедорожник-Инженер «Авангард»'; hp = 110; speed = 1.4; range = 0; dps = 0; cost = 200;
        desc = 'Высокотехнологичный строительный джип. Направляет голографические сборочные лучи для возведения зданий.';
      } else if (faction === 'Coalition') {
        name = 'Инженерный Тягач «Долото»'; hp = 160; speed = 1.1; range = 0; dps = 0; cost = 200;
        desc = 'Тяжелая бронированная пионерная машина Коалиции с двойными гидро-манипуляторами.';
      } else if (faction === 'Union') {
        name = 'Строительный Трактор МПС-7'; hp = 135; speed = 1.25; range = 0; dps = 0; cost = 150;
        desc = 'Советский надежный гусеничный трактор с сильными сварочными дугами и автоматикой.';
      } else { // Syndicate
        name = 'Нано-Био Формовщик «Прядильщик»'; hp = 115; speed = 1.5; range = 0; dps = 0; cost = 220;
        desc = 'Парящий многоногий дрон- weaver Синдиката, плетущий каркасы зданий из нано-полимеров.';
      }
      break;

    case 'harvester':
      if (faction === 'Alliance') {
        name = 'Квантовый Сборщик «Хронос»'; hp = 160; speed = 1.6; range = 0; dps = 0; cost = 300;
        desc = 'Логистический грузовик Альянса с плазменным хранилищем для быстрой разгрузки.';
      } else if (faction === 'Coalition') {
        name = 'Тяжелый Рудовоз «Урал-Э»'; hp = 260; speed = 1.2; range = 0; dps = 0; cost = 300;
        desc = 'Медленный, но капитально защищенный грузовик снабжения Коалиции огромной емкости.';
      } else if (faction === 'Union') {
        name = 'Гусеничный Трак ПС-4'; hp = 180; speed = 1.35; range = 0; dps = 0; cost = 250;
        desc = 'Сбалансированный армейский самосвал Союза, приспособленный для сурового бездорожья.';
      } else { // Syndicate
        name = 'Био-Сифон «Токсин-Т6»'; hp = 140; speed = 1.7; range = 0; dps = 0; cost = 280;
        desc = 'Сверхбыстрый заправщик Синдиката. Всасывает топливный концентрат со скважин.';
      }
      break;
  }

  return { name, hp, speed, range, dps, cost, desc };
}

export function getFactionBuildingProperties(bType: BuildingType, faction: Faction): FactionBuildingProp {
  let name = '';
  let hp = 1000;
  let cost = 400;
  let power = 0;
  let desc = '';

  switch (bType) {
    case 'command_center':
      if (faction === 'Alliance') {
        name = 'Штаб Президиума'; hp = 1600; cost = 1200; power = 35;
        desc = 'Сверхтехнологичный узел Альянса. Обеспечивает резервной энергией.';
      } else if (faction === 'Coalition') {
        name = 'Командный Бункер'; hp = 2000; cost = 1300; power = 25;
        desc = 'Железобетонная цитадель Коалиции с потрясающим запасом прочности.';
      } else if (faction === 'Union') {
        name = 'Штаб Комитета'; hp = 1400; cost = 1000; power = 30;
        desc = 'Центральное ведомство Союза на колесах. Сбалансированный узел.';
      } else { // Syndicate
        name = 'Синдикат-Анклав'; hp = 1300; cost = 1100; power = 40;
        desc = 'Центр Теневой Сети. Имеет высокий уровень энерговыделения.';
      }
      break;

    case 'power_plant':
      if (faction === 'Alliance') {
        name = 'Сингулярный Реактор'; hp = 550; cost = 320; power = 110;
        desc = 'Термоядерный генератор чистой энергии на изотопах водорода.';
      } else if (faction === 'Coalition') {
        name = 'Дизель-Генератор'; hp = 700; cost = 300; power = 90;
        desc = 'Тяжелый генератор Коалиции. Огромная прочность, грубая сила.';
      } else if (faction === 'Union') {
        name = 'Реактор Энерго-Сетка'; hp = 450; cost = 240; power = 85;
        desc = 'Высокоэффективный дешевый генератор Союза с быстрой постройкой.';
      } else { // Syndicate
        name = 'Кристальный Аккумулятор'; hp = 440; cost = 290; power = 105;
        desc = 'Теневой узел синтеризации энергии, питающийся от тёмных кристаллов.';
      }
      break;

    case 'supply_refinery':
      if (faction === 'Alliance') {
        name = 'Плазменный Экстрактор'; hp = 800; cost = 400; power = -20;
        desc = 'Добывает сырьевые ресурсы методом сверхглубокого квантового бурения.';
      } else if (faction === 'Coalition') {
        name = 'Буровая Вышка'; hp = 1050; cost = 430; power = -25;
        desc = 'Тяжелая и прочная механическая вышка бурения коалиционных стандартов.';
      } else if (faction === 'Union') {
        name = 'Скважина Добытчик'; hp = 750; cost = 350; power = -15;
        desc = 'Упрощенный мобильный компрессор добычи нефти по льготному тарифу.';
      } else { // Syndicate
        name = 'Химический Абсорбер'; hp = 700; cost = 380; power = -18;
        desc = 'Аспирационная вышка Синдиката, растворяющая грунт кислотными катализаторами.';
      }
      break;

    case 'barracks':
      if (faction === 'Alliance') {
        name = 'Центр Моделирования'; hp = 650; cost = 350; power = -15;
        desc = 'Выпускает тактических штурмовиков Тамплиеров и сканирующих дронов.';
      } else if (faction === 'Coalition') {
        name = 'Казармы Нацгвардии'; hp = 800; cost = 370; power = -18;
        desc = 'Обучает бронированных огнеметчиков Выжигателей и дронов-камикадзе.';
      } else if (faction === 'Union') {
        name = 'Военкомат Ополчения'; hp = 550; cost = 270; power = -10;
        desc = 'Недорого производит советских Тесла-пехотинцев и мобильных КУБ-самолетов.';
      } else { // Syndicate
        name = 'Синдикат-Инкубатор'; hp = 580; cost = 330; power = -12;
        desc = 'Технологическая лаборатория подготовки Теневых Клинков и Кислотных Клещей.';
      }
      break;

    case 'war_factory':
      if (faction === 'Alliance') {
        name = 'Оружейная Фабрика'; hp = 900; cost = 600; power = -25;
        desc = 'Завод сборки тяжелой техники: Лазерных Танков и Рельсовой Артиллерии.';
      } else if (faction === 'Coalition') {
        name = 'Бронетанковый Комплекс'; hp = 1150; cost = 650; power = -30;
        desc = 'Сталеплавильный цех, создающий Мамонтов и РСЗО Торнадо-Г.';
      } else if (faction === 'Union') {
        name = 'Машиностроительный Цех'; hp = 800; cost = 500; power = -20;
        desc = 'Сборочный конвейер, поставляющий танки Тесла-Вектор и Катюши Союза.';
      } else { // Syndicate
        name = 'Кибер-Док Нанитов'; hp = 750; cost = 570; power = -22;
        desc = 'Нано-лаборатория, выращивающая Танки Арахид Жнец и Искажатели.';
      }
      break;

    case 'defense_turret':
      // Laser defense turret damage slightly tuned down as requested
      if (faction === 'Alliance') {
        name = 'Призматический Излучатель'; hp = 700; cost = 350; power = -20;
        desc = 'Световой оборонительный комплекс: фокусирует тепловые лазерные шпили.';
      } else if (faction === 'Coalition') {
        name = 'Двуствольный ДП-Дот'; hp = 950; cost = 380; power = -25;
        desc = 'Железобетонный форпост с парой тяжелых скорострельных пушек калибра 30-мм.';
      } else if (faction === 'Union') {
        name = 'Башня-Тесла С-400'; hp = 600; cost = 320; power = -15;
        desc = 'Электрический столб, испускающий уничтожающие цепные разряды.';
      } else { // Syndicate
        name = 'Плазменный Шип'; hp = 620; cost = 340; power = -18;
        desc = 'Биологическое стрелковое жало, плюющееся высокотемпературным аргоном.';
      }
      break;

    case 'oil_derrick':
      if (faction === 'Alliance') {
        name = 'Автоматив-Скважина АВ-10'; hp = 600; cost = 300; power = -10;
        desc = 'Нефтевышка. Строится строителем на поле. Качает ресурсы для грузовиков.';
      } else if (faction === 'Coalition') {
        name = 'Скважина Буровая «Базальт»'; hp = 850; cost = 320; power = -12;
        desc = 'Нефтевышка. Разрабатывается строителем. Имеет толстые стальные перекрытия.';
      } else if (faction === 'Union') {
        name = 'Нефтевышка НПЗ-Кама'; hp = 550; cost = 260; power = -8;
        desc = 'Нефтевышка. Строится строителем. Надежный советский насос качалки.';
      } else { // Syndicate
        name = 'Токсичный Сифон «Газ-Абсорб»'; hp = 580; cost = 290; power = -10;
        desc = 'Нефтевышка. Нагнетает давление, извлекая концентрированные химикаты.';
      }
      break;

    case 'civilian_building':
      name = 'Гражданский Комплекс охраны'; hp = 1500; cost = 0; power = 0;
      desc = 'Интерактивное защитное здание. Выберите пехоту и направьте правой кнопкой для занятия гарнизона.';
      break;
  }

  return { name, hp, cost, power, desc };
}
