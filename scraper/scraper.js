#!/usr/bin/env node
/**
 * 3ddd.ru Scraper
 * API: POST https://3ddd.ru/api/models
 * Для получения избранного заходим на страницу каждой модели
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  catalogPages: 50,
  catalogDelayMs: 2000,
  detailDelayMs: 4000,
  detailDelayJitter: 2000,
  outputDir: './dashboard/data',
  stateFile: './dashboard/data/rotation-state.json',
  imageBase: 'https://b6.3ddd.ru/',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const SECTIONS = [
  { id: 'furniture',  name: 'Мебель',        cat: 'furniture',             icon: '🛋️' },
  { id: 'lighting',   name: 'Освещение',      cat: 'light',                 icon: '💡' },
  { id: 'decor',      name: 'Декор',          cat: 'decor',                 icon: '🖼️' },
  { id: 'bathroom',   name: 'Санузел',        cat: 'bathroom',              icon: '🚿' },
  { id: 'kitchen',    name: 'Кухня',          cat: 'kitchen',               icon: '🍳' },
  { id: 'plants',     name: 'Растения',       cat: 'plants',                icon: '🌿' },
  { id: 'tech',       name: 'Техника',        cat: 'tech',                  icon: '📱' },
  { id: 'exterior',   name: 'Экстерьер',      cat: 'exterior',              icon: '🏠' },
  { id: 'children',   name: 'Детская',        cat: 'children',              icon: '🧸' },
  { id: 'transport',  name: 'Транспорт',      cat: 'transport',             icon: '🚗' },
  { id: 'materials',  name: 'Материалы',      cat: 'materials',             icon: '🎨' },
  { id: 'textures',   name: 'Текстуры',       cat: 'textures',              icon: '🖼️' },
  { id: 'other',      name: 'Другие модели',  cat: 'miscellaneous-models',  icon: '📦' },
];

const SECTION_GROUPS = [
  ['furniture', 'lighting', 'decor'],
  ['bathroom', 'kitchen', 'plants'],
  ['tech', 'exterior', 'children'],
  ['transport', 'materials', 'textures'],
  ['other'],
];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) {
          const u = new URL(loc.startsWith('http') ? loc : 'https://3ddd.ru' + loc);
          return request({ ...options, hostname: u.hostname, path: u.pathname + u.search, method: 'GET' })
            .then(resolve).catch(reject);
        }
      }
      if (res.statusCode === 429) {
        console.log('    ⏳ Rate limit, жду 30 сек...');
        return setTimeout(() => request(options, body).then(resolve).catch(reject), 30000);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function commonHeaders(extra = {}) {
  return {
    'User-Agent': CONFIG.userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ru-RU,ru;q=0.9',
    'Referer': 'https://3ddd.ru/3dmodels',
    'Origin': 'https://3ddd.ru',
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fetchModelsPage(catSlug, page, order = 'date_desc') {
  // Пробуем разные варианты передачи параметров
  const body = JSON.stringify({ 
    category: catSlug, 
    cat: catSlug,
    page, 
    order,
    per_page: 60,
  });

  const { status, body: resp } = await request({
    hostname: '3ddd.ru',
    path: '/api/models',
    method: 'POST',
    headers: {
      ...commonHeaders(),
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  if (status !== 200) return null;
  try {
    const json = JSON.parse(resp);
    return json.data || null;
  } catch { return null; }
}

async function fetchModelPage(slug) {
  const { status, body } = await request({
    hostname: '3ddd.ru',
    path: `/3dmodels/show/${slug}`,
    method: 'GET',
    headers: commonHeaders({ 'Accept': 'text/html,application/xhtml+xml' }),
  });
  if (status !== 200) return null;
  return body;
}

function randomDelay(base, jitter = 0) {
  return new Promise(r => setTimeout(r, base + Math.floor(Math.random() * jitter)));
}

// ─── Парсинг ─────────────────────────────────────────────────────────────────

function parseModelFromApi(m) {
  const img = m.images?.[0];
  const preview = img ? `https://b6.3ddd.ru/${img.web_path}` : null;

  return {
    slug: m.slug,
    url: `https://3ddd.ru/3dmodels/show/${m.slug}`,
    name: m.title || m.title_en || m.slug,
    preview,
    price: parseInt(m.price || 0),
    isPro: m.model_type === 'pro',
    isFree: m.model_type === 'free' || !m.price || m.price === '0',
    votes: parseInt(m.votes_count || 0),
    cat: m.category_parent?.slug || null,
    subcat: m.category?.slug || null,
    subcatName: m.category?.title || null,
    favorites: null,
  };
}

function parseFavoritesFromHtml(html) {
  const m = html.match(/class="[^"]*added-to-collections[^"]*"[^>]*>\s*(\d+)\s*</i);
  return m ? parseInt(m[1]) : null;
}

// ─── Сканирование ─────────────────────────────────────────────────────────────

async function fetchAllModels(section) {
  const allModels = {};
  
  for (const order of ['date_desc', 'sell_rating']) {
    console.log(`\n  📋 ${section.name} / ${order}`);
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= CONFIG.catalogPages) {
      try {
        const data = await fetchModelsPage(section.cat, page, order);
        
        if (!data || !data.models?.length) {
          console.log(`    Стр.${page}: нет моделей, стоп`);
          break;
        }

        for (const m of data.models) {
          if (!allModels[m.slug]) {
            allModels[m.slug] = parseModelFromApi(m);
          }
        }

        const totalPages = Math.ceil((data.total_value || 0) / (data.per_page || 60));
        process.stdout.write(`    Стр.${page}/${Math.min(totalPages, CONFIG.catalogPages)}: +${data.models.length} (итого ${Object.keys(allModels).length})\r`);

        hasMore = page < totalPages;
        page++;
        await randomDelay(CONFIG.catalogDelayMs, 1000);
      } catch (err) {
        console.error(`\n    ❌ стр.${page}: ${err.message}`);
        break;
      }
    }
    console.log(`\n    ✓ После ${order}: ${Object.keys(allModels).length} моделей`);
  }

  return allModels;
}

async function enrichFavorites(allModels, existingModels) {
  const slugs = Object.keys(allModels);
  console.log(`\n  ❤️  Получаем избранное для ${slugs.length} моделей...`);
  let done = 0, errors = 0;

  for (const slug of slugs) {
    const model = allModels[slug];
    const existing = existingModels?.[slug];

    // Картинка — кэш навсегда
    if (!model.preview && existing?.preview) model.preview = existing.preview;

    try {
      const html = await fetchModelPage(slug);
      if (html) {
        const fav = parseFavoritesFromHtml(html);
        if (fav != null) model.favorites = fav;
        model.scannedAt = new Date().toISOString();
      }
      done++;
    } catch (err) {
      errors++;
    }

    // История без лимита
    if (model.favorites != null) {
      const prev = existing?.favoritesHistory || [];
      const lastVal = prev.length ? prev[prev.length - 1].value : null;
      if (lastVal !== model.favorites) {
        model.favoritesHistory = [...prev, { date: new Date().toISOString(), value: model.favorites }];
      } else {
        model.favoritesHistory = prev;
      }
    } else if (existing?.favoritesHistory) {
      model.favoritesHistory = existing.favoritesHistory;
    }

    if ((done + errors) % 50 === 0) {
      console.log(`    ${done}/${slugs.length} готово (ошибок: ${errors})`);
    }

    await randomDelay(CONFIG.detailDelayMs, CONFIG.detailDelayJitter);
  }

  console.log(`  ✓ Избранное: ${done} обновлено, ${errors} ошибок`);
}

// ─── Сохранение ───────────────────────────────────────────────────────────────

function loadExisting(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
}

async function processSection(section) {
  console.log(`\n${'═'.repeat(50)}\n  ${section.icon} ${section.name}\n${'═'.repeat(50)}`);

  const filePath = path.join(CONFIG.outputDir, `${section.id}.json`);
  const existing = loadExisting(filePath);

  // 1. Собираем список из API
  const allModels = await fetchAllModels(section);

  // Добавляем старые модели из предыдущего скана
  if (existing?.models) {
    for (const [slug, m] of Object.entries(existing.models)) {
      if (!allModels[slug]) allModels[slug] = m;
    }
  }

  console.log(`  📦 Всего моделей: ${Object.keys(allModels).length}`);

  // 2. Получаем избранное
  await enrichFavorites(allModels, existing?.models);

  // 3. Сортируем по избранному
  const topByFavorites = Object.values(allModels)
    .filter(m => m.favorites != null)
    .sort((a, b) => b.favorites - a.favorites)
    .map(m => m.slug);

  // 4. Статистика по подразделам
  const subcatStats = {};
  for (const m of Object.values(allModels)) {
    if (!m.subcat) continue;
    if (!subcatStats[m.subcat]) {
      subcatStats[m.subcat] = { id: m.subcat, name: m.subcatName || m.subcat, totalFavorites: 0, modelCount: 0, topFavorites: 0, topSlug: null };
    }
    subcatStats[m.subcat].modelCount++;
    if (m.favorites) {
      subcatStats[m.subcat].totalFavorites += m.favorites;
      if (m.favorites > subcatStats[m.subcat].topFavorites) {
        subcatStats[m.subcat].topFavorites = m.favorites;
        subcatStats[m.subcat].topSlug = m.slug;
      }
    }
  }

  const output = {
    id: section.id, name: section.name, icon: section.icon,
    updatedAt: new Date().toISOString(),
    totalModels: Object.keys(allModels).length,
    totalWithFavorites: topByFavorites.length,
    topByFavorites,
    subcatStats,
    models: allModels,
  };

  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
  const top = allModels[topByFavorites[0]];
  console.log(`  💾 Сохранено: ${output.totalModels} моделей`);
  if (top) console.log(`  🏆 Топ: "${top.name}" — ${top.favorites} ❤️`);
  return output;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 3ddd Scraper');
  console.log(`📅 ${new Date().toISOString()}`);

  fs.mkdirSync(CONFIG.outputDir, { recursive: true });

  const rotState = loadExisting(CONFIG.stateFile) || { currentGroup: 0 };
  const groupIndex = rotState.currentGroup % SECTION_GROUPS.length;
  const todayIds = SECTION_GROUPS[groupIndex];
  const todaySections = SECTIONS.filter(s => todayIds.includes(s.id));

  console.log(`\n🔄 Группа ${groupIndex + 1}/${SECTION_GROUPS.length}: ${todaySections.map(s => s.name).join(', ')}`);

  for (const section of todaySections) {
    await processSection(section);
  }

  // Мета
  const metaPath = path.join(CONFIG.outputDir, 'meta.json');
  const existingMeta = loadExisting(metaPath) || {};
  const sections = existingMeta.sections || {};

  for (const section of todaySections) {
    const data = loadExisting(path.join(CONFIG.outputDir, `${section.id}.json`));
    if (!data) continue;
    const top = data.topByFavorites?.map(s => data.models[s]).find(m => m?.favorites != null);
    sections[section.id] = {
      name: section.name, icon: section.icon,
      totalModels: data.totalModels,
      totalFavorites: Object.values(data.models).reduce((s, m) => s + (m.favorites || 0), 0),
      updatedAt: data.updatedAt,
      topModel: top?.name, topFavorites: top?.favorites,
    };
  }

  fs.writeFileSync(metaPath, JSON.stringify({
    ...existingMeta,
    finishedAt: new Date().toISOString(),
    currentGroup: groupIndex,
    nextGroup: (groupIndex + 1) % SECTION_GROUPS.length,
    sections_list: SECTIONS.map(s => ({ id: s.id, name: s.name, icon: s.icon })),
    sections,
  }, null, 2));

  fs.writeFileSync(CONFIG.stateFile, JSON.stringify({
    currentGroup: (groupIndex + 1) % SECTION_GROUPS.length,
    lastRun: new Date().toISOString(),
    lastSections: todaySections.map(s => s.name),
  }, null, 2));

  console.log('\n✅ Готово!');
}

main().catch(err => { console.error('💥', err); process.exit(1); });
