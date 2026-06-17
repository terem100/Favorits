#!/usr/bin/env node
/**
 * 3ddd.ru Scraper
 * - Ротация по 5 группам разделов (3 раздела за ночь)
 * - Сканирует подразделы отдельно для точной статистики
 * - История избранного — без лимита, навсегда
 * - Картинки кэшируются раз и навсегда
 * - Избранное обновляется каждый обход
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  catalogPages: 50,
  catalogDelayMs: 3000,
  detailDelayMs: 4000,
  detailDelayJitter: 2000,
  outputDir: './dashboard/data',
  stateFile: './dashboard/data/rotation-state.json',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Полная структура разделов и подразделов
const SECTIONS = [
  { id: 'furniture', name: 'Мебель', cat: 'furniture', icon: '🛋️', subcats: [
    { id: 'sofas',           name: 'Диваны',           subcat: 'sofas' },
    { id: 'armchairs',       name: 'Кресла',           subcat: 'armchairs' },
    { id: 'beds',            name: 'Кровати',          subcat: 'beds' },
    { id: 'tables',          name: 'Столы',            subcat: 'tables' },
    { id: 'chairs',          name: 'Стулья',           subcat: 'chairs' },
    { id: 'table-chair',     name: 'Стол + стул',      subcat: 'table-and-chair' },
    { id: 'wardrobes',       name: 'Шкафы',            subcat: 'wardrobes' },
    { id: 'shelving',        name: 'Стеллаж',          subcat: 'shelving' },
    { id: 'cabinets',        name: 'Тумбы, комоды',    subcat: 'cabinets-commodes' },
    { id: 'tv-stand',        name: 'ТВ стенка',        subcat: 'tv-stand' },
    { id: 'office',          name: 'Офисная мебель',   subcat: 'office-furniture' },
    { id: 'hallway',         name: 'Прихожая',         subcat: 'hallway' },
    { id: 'headboards',      name: 'Изголовья',        subcat: 'headboards' },
    { id: 'console',         name: 'Консоль',          subcat: 'console' },
    { id: 'dressing-table',  name: 'Туалетный столик', subcat: 'dressing-table' },
    { id: 'soft-other',      name: 'Другая мягкая',    subcat: 'other-soft-furniture' },
    { id: 'furniture-other', name: 'Другое',           subcat: 'other-furniture' },
  ]},
  { id: 'lighting', name: 'Освещение', cat: 'light', icon: '💡', subcats: [
    { id: 'pendant',    name: 'Подвесной',   subcat: 'pendant-lamps' },
    { id: 'ceiling',    name: 'Потолочный',  subcat: 'ceiling-lamps' },
    { id: 'floor-lamp', name: 'Торшеры',     subcat: 'floor-lamps' },
    { id: 'table-lamp', name: 'Настольный',  subcat: 'table-lamps' },
    { id: 'wall-lamp',  name: 'Бра',         subcat: 'wall-lamps' },
    { id: 'built-in',   name: 'Встроенный',  subcat: 'built-in-lamps' },
    { id: 'technical',  name: 'Технический', subcat: 'technical-lamps' },
    { id: 'street',     name: 'Уличный',     subcat: 'street-lamps' },
    { id: 'neon',       name: 'Неон',        subcat: 'neon' },
  ]},
  { id: 'decor', name: 'Декор', cat: 'decor', icon: '🖼️', subcats: [
    { id: 'vases',      name: 'Вазы',               subcat: 'vases' },
    { id: 'mirrors',    name: 'Зеркала',            subcat: 'mirrors' },
    { id: 'carpets',    name: 'Ковры',              subcat: 'carpets' },
    { id: 'pillows',    name: 'Подушки',            subcat: 'pillows' },
    { id: 'curtains',   name: 'Шторы',              subcat: 'curtains' },
    { id: 'sculptures', name: 'Скульптуры',         subcat: 'sculptures' },
    { id: 'clocks',     name: 'Часы',               subcat: 'clocks' },
    { id: 'books',      name: 'Книги',              subcat: 'books' },
    { id: 'panels-3d',  name: '3D панель',          subcat: '3d-panels' },
    { id: 'molding',    name: 'Лепнина',            subcat: 'molding' },
    { id: 'frames',     name: 'Багеты',             subcat: 'frames' },
    { id: 'clothes',    name: 'Одежда и обувь',     subcat: 'clothes-and-shoes' },
    { id: 'decor-set',  name: 'Декоративный набор', subcat: 'decorative-set' },
    { id: 'decor-other',name: 'Другие предметы',    subcat: 'other-interior-objects' },
  ]},
  { id: 'bathroom', name: 'Санузел', cat: 'bathroom', icon: '🚿', subcats: [
    { id: 'bath',        name: 'Ванна',              subcat: 'bathtubs' },
    { id: 'shower',      name: 'Душевая кабина',     subcat: 'shower-cabin' },
    { id: 'sink',        name: 'Умывальники',        subcat: 'wash-basins' },
    { id: 'toilet',      name: 'Унитаз и Биде',      subcat: 'toilet-and-bidet' },
    { id: 'bath-faucet', name: 'Смеситель',          subcat: 'bathroom-faucet' },
    { id: 'towel-rail',  name: 'Полотенцесушитель',  subcat: 'towel-rail' },
    { id: 'bath-furn',   name: 'Мебель',             subcat: 'bathroom-furniture' },
    { id: 'bath-decor',  name: 'Декор для санузла',  subcat: 'bathroom-decor' },
  ]},
  { id: 'kitchen', name: 'Кухня', cat: 'kitchen', icon: '🍳', subcats: [
    { id: 'kitchens',     name: 'Кухни',          subcat: 'kitchens' },
    { id: 'dishes',       name: 'Посуда',         subcat: 'dishes' },
    { id: 'food',         name: 'Еда и напитки',  subcat: 'food-and-drinks' },
    { id: 'kitchen-tech', name: 'Техника',        subcat: 'kitchen-appliances' },
    { id: 'kitchen-sink', name: 'Мойка',          subcat: 'kitchen-sink' },
    { id: 'kit-faucet',   name: 'Смеситель',      subcat: 'kitchen-faucet' },
    { id: 'kit-small',    name: 'Мелочь',         subcat: 'kitchen-stuff' },
  ]},
  { id: 'plants', name: 'Растения', cat: 'plants', icon: '🌿', subcats: [
    { id: 'indoor',    name: 'Комнатные', subcat: 'indoor-plants' },
    { id: 'trees',     name: 'Деревья',   subcat: 'trees' },
    { id: 'outdoor',   name: 'Уличные',   subcat: 'outdoor-plants' },
    { id: 'bushes',    name: 'Кусты',     subcat: 'bushes' },
    { id: 'grass',     name: 'Трава',     subcat: 'grass' },
    { id: 'bouquets',  name: 'Букеты',    subcat: 'bouquets' },
    { id: 'phytowalls',name: 'Фитостены', subcat: 'phytowalls' },
  ]},
  { id: 'tech', name: 'Техника', cat: 'tech', icon: '📱', subcats: [
    { id: 'tv',           name: 'Телевизоры',          subcat: 'tv' },
    { id: 'computers',    name: 'Компьютеры',          subcat: 'computers-electronics' },
    { id: 'phones',       name: 'Телефоны',            subcat: 'phones' },
    { id: 'audio',        name: 'Аудиотехника',        subcat: 'audio' },
    { id: 'appliances',   name: 'Бытовая техника',     subcat: 'home-appliances' },
    { id: 'tech-other',   name: 'Разное',              subcat: 'tech-other' },
  ]},
  { id: 'exterior', name: 'Экстерьер', cat: 'exterior', icon: '🏠', subcats: [
    { id: 'buildings',    name: 'Здания',          subcat: 'buildings' },
    { id: 'urban',        name: 'Городская среда', subcat: 'urban-environment' },
    { id: 'fencing',      name: 'Ограждение',      subcat: 'fencing' },
    { id: 'facade',       name: 'Элемент фасада',  subcat: 'facade-element' },
    { id: 'playground',   name: 'Детская площадка',subcat: 'playground' },
    { id: 'pavement',     name: 'Брусчатка',       subcat: 'pavement' },
    { id: 'bbq',          name: 'Барбекю и гриль', subcat: 'bbq-and-grill' },
    { id: 'nature',       name: 'Детали природы',  subcat: 'nature-details' },
    { id: 'ext-other',    name: 'Разное',          subcat: 'exterior-other' },
  ]},
  { id: 'children', name: 'Детская', cat: 'children', icon: '🧸', subcats: [
    { id: 'child-beds',   name: 'Кровати',       subcat: 'children-beds' },
    { id: 'toys',         name: 'Игрушки',       subcat: 'toys' },
    { id: 'child-tables', name: 'Столы и стулья',subcat: 'children-tables-chairs' },
    { id: 'child-wardr',  name: 'Шкафы',         subcat: 'children-wardrobes' },
    { id: 'child-other',  name: 'Другие',        subcat: 'other-children-items' },
    { id: 'child-items',  name: 'Детские',       subcat: 'children-items' },
  ]},
  { id: 'transport', name: 'Транспорт', cat: 'transport', icon: '🚗', subcats: [
    { id: 'land',  name: 'Наземный',   subcat: 'land-transport' },
    { id: 'air',   name: 'Воздушный',  subcat: 'air-transport' },
    { id: 'water', name: 'Водный',     subcat: 'water-transport' },
  ]},
  { id: 'materials', name: 'Материалы', cat: 'materials', icon: '🎨', subcats: [
    { id: 'mat-wood',    name: 'Дерево',         subcat: 'wood-materials' },
    { id: 'mat-stone',   name: 'Камень',         subcat: 'stone-materials' },
    { id: 'mat-metal',   name: 'Металл',         subcat: 'metal-materials' },
    { id: 'mat-fabric',  name: 'Ткань',          subcat: 'fabric-materials' },
    { id: 'mat-glass',   name: 'Стекло',         subcat: 'glass-materials' },
    { id: 'mat-leather', name: 'Кожа',           subcat: 'leather-materials' },
    { id: 'mat-plastic', name: 'Пластик',        subcat: 'plastic-materials' },
    { id: 'mat-tile',    name: 'Кафель, плитка', subcat: 'tile-materials' },
    { id: 'mat-liquid',  name: 'Жидкости',       subcat: 'liquid-materials' },
    { id: 'mat-other',   name: 'Разное',         subcat: 'other-materials' },
  ]},
  { id: 'textures', name: 'Текстуры', cat: 'textures', icon: '🖼️', subcats: [
    { id: 'tex-wood',    name: 'Дерево',            subcat: 'wood-textures' },
    { id: 'tex-stone',   name: 'Камень',            subcat: 'stone-textures' },
    { id: 'tex-tile',    name: 'Кафель, плитка',    subcat: 'tile-textures' },
    { id: 'tex-metal',   name: 'Металл',            subcat: 'metal-textures' },
    { id: 'tex-fabric',  name: 'Ткань',             subcat: 'fabric-textures' },
    { id: 'tex-leather', name: 'Кожа',              subcat: 'leather-textures' },
    { id: 'tex-carpet',  name: 'Ковры',             subcat: 'carpet-textures' },
    { id: 'tex-brick',   name: 'Кирпич',            subcat: 'brick-textures' },
    { id: 'tex-floor',   name: 'Напольные покрытия',subcat: 'floor-textures' },
    { id: 'tex-wall',    name: 'Стены, обои',       subcat: 'wall-textures' },
    { id: 'hdri',        name: 'HDRI',              subcat: 'hdri' },
    { id: 'panoramic',   name: 'Панорамные',        subcat: 'panoramic' },
    { id: 'organic',     name: 'Органика',          subcat: 'organic-textures' },
    { id: 'tex-other',   name: 'Разное',            subcat: 'other-textures' },
  ]},
  { id: 'other', name: 'Другие модели', cat: 'miscellaneous-models', icon: '📦', subcats: [
    { id: 'doors',       name: 'Двери',               subcat: 'doors' },
    { id: 'windows',     name: 'Окна',                subcat: 'windows' },
    { id: 'fireplaces',  name: 'Камин',               subcat: 'fireplaces' },
    { id: 'stairs',      name: 'Лестницы',            subcat: 'stairs' },
    { id: 'radiators',   name: 'Радиатор',            subcat: 'radiators' },
    { id: 'sport',       name: 'Спорт',               subcat: 'sport' },
    { id: 'music',       name: 'Музыкальные инструменты', subcat: 'musical-instruments' },
    { id: 'billiards',   name: 'Бильярд',             subcat: 'billiards' },
    { id: 'shop',        name: 'Магазин',             subcat: 'shop' },
    { id: 'restaurant',  name: 'Ресторан',            subcat: 'restaurant' },
    { id: 'beauty',      name: 'Салон красоты',       subcat: 'beauty-salon' },
    { id: 'creatures',   name: 'Живые существа',      subcat: 'living-creatures' },
    { id: 'weapons',     name: 'Оружие',              subcat: 'weapons' },
    { id: 'misc',        name: 'Разное',              subcat: 'miscellaneous-objects' },
  ]},
];

// Группы для ротации (5 групп)
const SECTION_GROUPS = [
  ['furniture', 'lighting', 'decor'],
  ['bathroom', 'kitchen', 'plants'],
  ['tech', 'exterior', 'children'],
  ['transport', 'materials', 'textures'],
  ['other'],
];

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function fetchPage(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': CONFIG.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer': 'https://3ddd.ru/3dmodels',
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) return fetchPage(loc.startsWith('http') ? loc : 'https://3ddd.ru' + loc, retries).then(resolve).catch(reject);
      }
      if (res.statusCode === 429 || res.statusCode === 503) {
        if (retries > 0) {
          console.log(`    ⏳ Rate limit, жду 30 сек...`);
          return setTimeout(() => fetchPage(url, retries - 1).then(resolve).catch(reject), 30000);
        }
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    });
    req.on('error', err => retries > 0
      ? setTimeout(() => fetchPage(url, retries-1).then(resolve).catch(reject), 5000)
      : reject(err));
    req.on('timeout', () => { req.destroy(); retries > 0
      ? setTimeout(() => fetchPage(url, retries-1).then(resolve).catch(reject), 5000)
      : reject(new Error('Timeout')); });
  });
}

function randomDelay(base, jitter = 0) {
  return new Promise(r => setTimeout(r, base + Math.floor(Math.random() * jitter)));
}

// ─── Парсинг ──────────────────────────────────────────────────────────────────

function parseCatalogPage(html) {
  const models = [];
  const seen = new Set();
  for (const match of html.matchAll(/href="(\/3dmodels\/show\/([a-z0-9_-]+))"/gi)) {
    const slug = match[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const pos = match.index;
    const block = html.substring(Math.max(0, pos - 50), pos + 600);
    const imgMatch = block.match(/(?:src|data-src)="(https?:\/\/b\d\.3ddd\.ru\/media\/cache\/[^"]+\.(?:jpg|jpeg|png|webp))"/i);
    const titleMatch = block.match(/title="([^"]{3,120})"/);
    const priceMatch = block.match(/(\d[\d\s]{0,6})\s*₽/);
    models.push({
      slug,
      url: 'https://3ddd.ru' + match[1],
      name: titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' '),
      preview: imgMatch ? imgMatch[1] : null,
      price: priceMatch ? parseInt(priceMatch[1].replace(/\s/g, '')) : 0,
      isPro: /\bPRO\b/.test(block),
      isFree: !/\bPRO\b/.test(block),
    });
  }
  return models;
}

function parseModelPage(html) {
  const favMatch = html.match(/class="[^"]*added-to-collections[^"]*"[^>]*>\s*(\d+)\s*</i);
  const ogImg = html.match(/property="og:image"\s+content="([^"]+)"/i) || html.match(/content="([^"]+)"\s+property="og:image"/i);
  const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i) || html.match(/content="([^"]+)"\s+property="og:title"/i);
  const authorMatch = html.match(/href="\/users\/([a-z0-9_-]+)"/i);
  const dateMatch = html.match(/Опубликована\s+([^\n<]{3,30})/i);
  const likeMatch = html.match(/(\d+)\s*Рекоменд/i);
  // Подраздел из хлебных крошек — ссылка вида ?subcat=xxx&cat=yyy
  const subcatMatch = html.match(/\?subcat=([a-z0-9_-]+)&cat=([a-z0-9_-]+)/i);

  return {
    favorites:   favMatch   ? parseInt(favMatch[1])                              : null,
    preview:     ogImg      ? ogImg[1]                                           : null,
    name:        ogTitle    ? ogTitle[1].replace(/\s*-\s*.*$/, '').trim()       : null,
    author:      authorMatch? authorMatch[1]                                     : null,
    publishedAt: dateMatch  ? dateMatch[1].trim()                               : null,
    likes:       likeMatch  ? parseInt(likeMatch[1])                            : null,
    subcat:      subcatMatch? subcatMatch[1]                                     : null,
  };
}

// ─── Сканирование ─────────────────────────────────────────────────────────────

async function scrapeCatalog(cat, subcat, sortParam) {
  const allModels = {};
  let page = 1;
  const baseUrl = subcat
    ? `https://3ddd.ru/3dmodels?cat=${cat}&subcat=${subcat}&order=${sortParam}`
    : `https://3ddd.ru/3dmodels?cat=${cat}&order=${sortParam}`;

  while (page <= CONFIG.catalogPages) {
    const url = `${baseUrl}&page=${page}`;
    try {
      const { status, html } = await fetchPage(url);
      if (status !== 200) break;
      const models = parseCatalogPage(html);
      if (models.length === 0) break;
      for (const m of models) if (!allModels[m.slug]) allModels[m.slug] = m;
      const hasNext = html.includes(`page=${page+1}`) || html.includes('class="next"');
      if (!hasNext) break;
      page++;
      await randomDelay(CONFIG.catalogDelayMs, 1500);
    } catch (err) {
      console.error(`    ❌ стр.${page}: ${err.message}`);
      break;
    }
  }
  return allModels;
}

async function enrichWithFavorites(allModels, existingModels) {
  const slugs = Object.keys(allModels);
  let done = 0, errors = 0;

  for (const slug of slugs) {
    const model = allModels[slug];
    const existing = existingModels?.[slug];

    // Картинка — из кэша навсегда
    if (!model.preview && existing?.preview) model.preview = existing.preview;

    try {
      const { status, html } = await fetchPage(model.url);
      if (status === 200) {
        const d = parseModelPage(html);
        if (d.favorites != null) model.favorites = d.favorites;
        if (!model.preview && d.preview) model.preview = d.preview;
        if (!model.author   && d.author)      model.author = d.author;
        if (!model.publishedAt && d.publishedAt) model.publishedAt = d.publishedAt;
        if (d.likes != null) model.likes = d.likes;
        if (d.name)  model.name = d.name;
        // Подраздел — сохраняем если нашли
        if (d.subcat && !model.subcat) model.subcat = d.subcat;
        model.scannedAt = new Date().toISOString();
      }
      done++;
    } catch (err) {
      errors++;
    }

    // История избранного — без лимита, навсегда
    if (model.favorites != null) {
      const prevHistory = existing?.favoritesHistory || [];
      const lastValue = prevHistory.length ? prevHistory[prevHistory.length - 1].value : null;
      // Добавляем точку только если значение изменилось (экономим место)
      if (lastValue !== model.favorites) {
        model.favoritesHistory = [
          ...prevHistory,
          { date: new Date().toISOString(), value: model.favorites },
        ];
      } else {
        model.favoritesHistory = prevHistory;
      }
    }

    if ((done + errors) % 50 === 0) {
      console.log(`    Прогресс: ${done}/${slugs.length} (ошибок: ${errors})`);
    }
    await randomDelay(CONFIG.detailDelayMs, CONFIG.detailDelayJitter);
  }

  console.log(`  ✓ ${done} обновлено, ${errors} ошибок`);
}

// ─── Главная функция ──────────────────────────────────────────────────────────

function loadExisting(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; }
  catch { return null; }
}

function loadRotationState() {
  return loadExisting(CONFIG.stateFile) || { currentGroup: 0 };
}

async function processSection(section) {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  ${section.icon} ${section.name.toUpperCase()}`);
  console.log(`${'═'.repeat(55)}`);

  const filePath = path.join(CONFIG.outputDir, `${section.id}.json`);
  const existing = loadExisting(filePath);

  // Собираем модели по всему разделу
  console.log(`  📋 Сканируем весь раздел...`);
  const popularAll = await scrapeCatalog(section.cat, null, 'popular');
  await randomDelay(CONFIG.catalogDelayMs, 2000);
  const newAll = await scrapeCatalog(section.cat, null, 'new');

  // Объединяем
  const allModels = { ...newAll, ...popularAll };

  // Добавляем старые модели (чтобы не терять историю)
  if (existing?.models) {
    for (const [slug, m] of Object.entries(existing.models)) {
      if (!allModels[slug]) allModels[slug] = m;
    }
  }

  console.log(`  📦 Уникальных моделей: ${Object.keys(allModels).length}`);
  console.log(`  ❤️  Получаем избранное...`);

  await enrichWithFavorites(allModels, existing?.models);

  // Сортируем по избранному
  const topByFavorites = Object.values(allModels)
    .filter(m => m.favorites != null)
    .sort((a, b) => b.favorites - a.favorites)
    .map(m => m.slug);

  // Статистика по подразделам — считаем из данных моделей
  const subcatStats = {};
  for (const subcat of section.subcats) {
    subcatStats[subcat.id] = {
      id: subcat.id,
      name: subcat.name,
      subcat: subcat.subcat,
      totalFavorites: 0,
      modelCount: 0,
      topSlug: null,
      topFavorites: 0,
    };
  }

  // Распределяем модели по подразделам (по полю subcat из страницы модели)
  for (const model of Object.values(allModels)) {
    if (!model.subcat) continue;
    const found = section.subcats.find(s => s.subcat === model.subcat || s.id === model.subcat);
    if (!found) continue;
    const stat = subcatStats[found.id];
    if (!stat) continue;
    stat.modelCount++;
    if (model.favorites) {
      stat.totalFavorites += model.favorites;
      if (model.favorites > stat.topFavorites) {
        stat.topFavorites = model.favorites;
        stat.topSlug = model.slug;
      }
    }
  }

  const output = {
    id: section.id,
    name: section.name,
    icon: section.icon,
    updatedAt: new Date().toISOString(),
    totalModels: Object.keys(allModels).length,
    totalWithFavorites: topByFavorites.length,
    topByFavorites,
    popularSlugs: Object.keys(popularAll),
    newSlugs: Object.keys(newAll),
    subcats: section.subcats,
    subcatStats,
    models: allModels,
  };

  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));

  const topModel = allModels[topByFavorites[0]];
  console.log(`  💾 Сохранено: ${output.totalModels} моделей`);
  if (topModel) console.log(`  🏆 Топ: "${topModel.name}" — ${topModel.favorites} ❤️`);

  return output;
}

async function main() {
  console.log('🚀 3ddd Scraper');
  console.log(`📅 ${new Date().toISOString()}`);

  fs.mkdirSync(CONFIG.outputDir, { recursive: true });

  const rotationState = loadRotationState();
  const groupIndex = rotationState.currentGroup % SECTION_GROUPS.length;
  const todayIds = SECTION_GROUPS[groupIndex];
  const todaySections = SECTIONS.filter(s => todayIds.includes(s.id));

  console.log(`\n🔄 Группа ${groupIndex + 1}/${SECTION_GROUPS.length}: ${todaySections.map(s => s.name).join(', ')}`);

  for (const section of todaySections) {
    await processSection(section);
  }

  // Обновляем meta.json
  const metaPath = path.join(CONFIG.outputDir, 'meta.json');
  const existingMeta = loadExisting(metaPath) || {};
  const sections = existingMeta.sections || {};

  for (const section of todaySections) {
    const data = loadExisting(path.join(CONFIG.outputDir, `${section.id}.json`));
    if (!data) continue;
    const top = data.topByFavorites?.map(s => data.models[s]).find(m => m?.favorites != null);
    sections[section.id] = {
      name: section.name,
      icon: section.icon,
      totalModels: data.totalModels,
      totalFavorites: Object.values(data.models).reduce((s, m) => s + (m.favorites || 0), 0),
      updatedAt: data.updatedAt,
      topModel: top?.name,
      topFavorites: top?.favorites,
    };
  }

  const meta = {
    ...existingMeta,
    finishedAt: new Date().toISOString(),
    currentGroup: groupIndex,
    nextGroup: (groupIndex + 1) % SECTION_GROUPS.length,
    sections_list: SECTIONS.map(s => ({ id: s.id, name: s.name, icon: s.icon })),
    sections,
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  // Сохраняем состояние ротации
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify({
    currentGroup: (groupIndex + 1) % SECTION_GROUPS.length,
    lastRun: new Date().toISOString(),
    lastSections: todaySections.map(s => s.name),
  }, null, 2));

  console.log('\n✅ Готово!');
  console.log(`🔄 Завтра: ${SECTION_GROUPS[(groupIndex+1) % SECTION_GROUPS.length].join(', ')}`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
