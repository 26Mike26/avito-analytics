import type {
  AccountKpi,
  AvitoItem,
  AvitoItemStatus,
  BidHistoryEntry,
  IntegrationSettings,
  ItemMetrics,
} from '../types';

const categories = [
  'Недвижимость',
  'Авто',
  'Услуги',
  'Электроника',
  'Личные вещи',
  'Бытовая техника',
  'Работа',
  'Хобби и отдых',
];

const regions = [
  'Москва',
  'Санкт-Петербург',
  'Екатеринбург',
  'Казань',
  'Новосибирск',
  'Краснодар',
  'Нижний Новгород',
];

const titlesByCategory: Record<string, string[]> = {
  'Недвижимость': [
    '2-к квартира, 54 м²',
    'Студия в новостройке',
    '3-к квартира с ремонтом',
    'Дом 120 м² с участком',
    'Коммерческое помещение 80 м²',
  ],
  'Авто': [
    'Toyota Camry 2019',
    'Hyundai Solaris 2020',
    'Kia Rio в идеале',
    'Lada Vesta 2021',
    'Volkswagen Polo 2018',
  ],
  'Услуги': [
    'Ремонт квартир под ключ',
    'Натяжные потолки за день',
    'Грузоперевозки по городу',
    'Сборка мебели',
    'Уборка квартир',
  ],
  'Электроника': [
    'iPhone 14 Pro 256 Гб',
    'MacBook Air M2',
    'PlayStation 5 Slim',
    'Samsung Galaxy S23',
    'Apple Watch Series 9',
  ],
  'Личные вещи': [
    'Куртка зимняя мужская',
    'Кроссовки Nike Air Max',
    'Платье вечернее',
    'Сумка кожаная',
    'Часы наручные',
  ],
  'Бытовая техника': [
    'Холодильник Samsung',
    'Стиральная машина LG',
    'Робот-пылесос Xiaomi',
    'Кофемашина De’Longhi',
    'Микроволновка Bosch',
  ],
  'Работа': [
    'Менеджер по продажам',
    'Курьер на личном авто',
    'Администратор салона',
    'Дизайнер интерьера',
    'Бухгалтер на удалёнку',
  ],
  'Хобби и отдых': [
    'Велосипед горный',
    'Гитара акустическая',
    'Настольная игра',
    'Палатка туристическая',
    'Удочка спиннинг',
  ],
};

const random = (min: number, max: number) =>
  Math.round(min + Math.random() * (max - min));

const randomFloat = (min: number, max: number) =>
  +(min + Math.random() * (max - min)).toFixed(2);

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const statuses: AvitoItemStatus[] = ['active', 'active', 'active', 'paused', 'archived'];

const today = new Date('2026-05-01');

function isoDate(daysAgo: number) {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function generateMockItems(): AvitoItem[] {
  const items: AvitoItem[] = [];
  let id = 1;
  for (const category of categories) {
    const titles = titlesByCategory[category];
    const count = 5 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const status = pick(statuses);
      const profile = Math.random();
      let views: number;
      let contacts: number;
      let spend: number;
      let bid: number;

      if (profile < 0.25) {
        // эффективное
        views = random(800, 2400);
        contacts = random(20, 60);
        spend = random(3000, 9000);
        bid = random(40, 90);
      } else if (profile < 0.5) {
        // перерасход
        views = random(600, 1500);
        contacts = random(2, 8);
        spend = random(8000, 18000);
        bid = random(80, 180);
      } else if (profile < 0.7) {
        // мало данных
        views = random(20, 200);
        contacts = random(0, 3);
        spend = random(200, 1500);
        bid = random(20, 60);
      } else if (profile < 0.85) {
        // низкая конверсия
        views = random(2000, 5000);
        contacts = random(3, 10);
        spend = random(4000, 10000);
        bid = random(40, 90);
      } else {
        // средний
        views = random(400, 1200);
        contacts = random(8, 25);
        spend = random(2000, 6000);
        bid = random(30, 80);
      }

      const price = random(1500, 8500000);
      const favorites = Math.round(contacts * randomFloat(1.2, 4));
      const hasRevenue = Math.random() > 0.55 && contacts > 0;
      const revenue = hasRevenue ? contacts * random(500, 3500) : undefined;

      items.push({
        id: `item-${id}`,
        title: `${pick(titles)} №${id}`,
        status: status === 'archived' && i % 3 !== 0 ? 'active' : status,
        category,
        region: pick(regions),
        price,
        currentBid: bid,
        recommendedBid: bid, // пересчитаем позже
        views,
        contacts,
        favorites,
        spend,
        revenue,
        createdAt: isoDate(random(5, 90)),
      });
      id++;
    }
  }
  return items;
}

export function generateMetricsForItems(items: AvitoItem[]): ItemMetrics[] {
  const result: ItemMetrics[] = [];
  for (const item of items) {
    // распределим суммарные метрики по 30 дням
    const days = 30;
    const totalViews = item.views;
    const totalContacts = item.contacts;
    const totalSpend = item.spend;
    const totalFav = item.favorites;

    let restViews = totalViews;
    let restContacts = totalContacts;
    let restSpend = totalSpend;
    let restFav = totalFav;

    for (let d = days - 1; d >= 0; d--) {
      const factor = d === 0 ? 1 : Math.random();
      const v =
        d === 0 ? restViews : Math.round(((totalViews / days) * (0.5 + factor)) | 0);
      const c =
        d === 0
          ? restContacts
          : Math.min(restContacts, Math.round((totalContacts / days) * factor));
      const s =
        d === 0
          ? restSpend
          : Math.round(((totalSpend / days) * (0.5 + factor)) | 0);
      const f =
        d === 0
          ? restFav
          : Math.min(restFav, Math.round((totalFav / days) * factor));

      restViews -= v;
      restContacts -= c;
      restSpend -= s;
      restFav -= f;

      result.push({
        itemId: item.id,
        date: isoDate(d),
        views: Math.max(0, v),
        contacts: Math.max(0, c),
        favorites: Math.max(0, f),
        spend: Math.max(0, s),
        bid: item.currentBid + random(-5, 5),
      });
    }
  }
  return result;
}

export const defaultKpi: AccountKpi = {
  targetCpl: 350,
  targetLeads: 800,
  targetConversionRate: 2.5,
  monthlyBudget: 250000,
  weeklyBudget: 60000,
  dailyBudget: 9000,
  targetRoi: 120,
  allowedOverspend: 15,
  strategy: 'balanced',
};

export const defaultBidHistory: BidHistoryEntry[] = [];

export const defaultIntegration: IntegrationSettings = {
  clientId: '',
  clientSecret: '',
  accessToken: '',
  userId: '',
  mode: 'demo',
  lastSyncAt: today.toISOString(),
};
