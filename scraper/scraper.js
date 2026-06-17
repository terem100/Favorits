#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  catalogPages: 50,
  catalogDelayMs: 2000,
  detailDelayMs: 3000,
  outputDir: './dashboard/data',
  stateFile: './dashboard/data/rotation-state.json',
  // Системный Chrome на GitHub Actions Ubuntu
  chromePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
};

const SECTIONS = [
  { id: 'furniture', name: 'Мебель',        cat: 'furniture',           icon: '🛋️', subcategories: ['armchairs','beds','chairs','consoles','dressing-tables','hallway-furniture','headboards','miscellaneous-furniture','miscellaneous-soft-seating','office-furniture','racks','sideboards-and-chests-of-drawers','sofas','tables','tables-and-chairs','tv-walls','wardrobes-and-display-cabinets'] },
  { id: 'lighting',  name: 'Освещение',     cat: 'light',               icon: '💡', subcategories: ['built-in-lamps','ceiling-lamps','floor-lamps','neon','pendant-lamps','street-lamps','table-lamps','technical-lamps','wall-lamps'] },
  { id: 'decor',     name: 'Декор',         cat: 'decor',               icon: '🖼️', subcategories: ['3d-panels','books','carpets','clocks','clothes-and-shoes','curtains','decorative-set','frames','interior-objects','mirrors','molding','pillows','sculptures','vases'] },
  { id: 'bathroom',  name: 'Санузел',       cat: 'bathroom',            icon: '🚿', subcategories: ['bath-decor','bath-faucets','bathtubs','bathroom-furniture','shower-cabins','towel-rails','wash-basins','wc-and-bidet'] },
  { id: 'kitchen',   name: 'Кухня',         cat: 'kitchen',             icon: '🍳', subcategories: ['dishes','food-and-drinks','kitchen-appliances','kitchen-faucets','kitchen-furniture','kitchen-sinks','kitchen-stuff'] },
  { id: 'plants',    name: 'Растения',      cat: 'plants',              icon: '🌿', subcategories: ['bouquets','bushes','grass','indoor-plants','outdoor-plants','phytowalls','trees'] },
  { id: 'tech',      name: 'Техника',       cat: 'tech',                icon: '📱', subcategories: ['audio','computers-and-electronics','home-appliances','phones','tech-other','tv'] },
  { id: 'exterior',  name: 'Экстерьер',     cat: 'exterior',            icon: '🏠', subcategories: ['barbecue-and-grill','buildings','exterior-other','facade-elements','fencing','nature-details','pavement','playground','urban-environment'] },
  { id: 'children',  name: 'Детская',       cat: 'children',            icon: '🧸', subcategories: ['children-beds','children-items','children-tables-and-chairs','children-wardrobes','other-children-items','toys'] },
  { id: 'transport', name: 'Транспорт',     cat: 'transport',           icon: '🚗', subcategories: ['air-transport','land-transport','water-transport'] },
  { id: 'materials', name: 'Материалы',     cat: 'materials',           icon: '🎨', subcategories: ['fabric-materials','glass-materials','leather-materials','liquid-materials','metal-materials','miscellaneous-materials','plastic-materials','stone-materials','tile-materials','wood-materials'] },
  { id: 'textures',  name: 'Текстуры',      cat: 'textures',            icon: '🖼️', subcategories: ['brick-textures','carpet-textures','fabric-textures','floor-textures','hdri','leather-textures','metal-textures','miscellaneous-textures','organic-textures','panoramic','stone-textures','tile-textures','wall-textures','wood-textures'] },
  { id: 'other',     name: 'Другие модели', cat: 'miscellaneous-models', icon: '📦', subcategories: ['beauty-salon','billiards','doors','fireplaces','living-creatures','miscellaneous-objects','musical-instruments','radiators','restaurant','shop','sport','stairs','weapons','windows'] },
];

const SECTION_GROUPS = [
  ['furniture', 'lighting', 'decor'],
  ['bathroom', 'kitchen', 'plants'],
  ['tech', 'exterior', 'children'],
  ['transport', 'materials', 'textures'],
  ['other'],
];

function delay(ms, jitter = 0) {
  return new Promise(r => setTimeout(r, ms + Math.floor(Math.random() * jitter)));
}

function loadExisting(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
}

// ─── Запускаем браузер один раз на весь скрипт ───────────────────────────────
async function launchBrowser() {
  console.log(`🌐 Запуск Chrome: ${CONFIG.chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: CONFIG.chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=ru-RU',
    ],
  });
  console.log(`✓ Chrome запущен (версия: ${await browser.version()})`);
  return browser;
}

// ─── Получаем все модели раздела через перехват API-запросов ─────────────────
async function fetchAllModels(browser, section) {
  const allModels = {};
  const page = await browser.newPage();

  // Притворяемся обычным пользователем
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });
  await page.setViewport({ width: 1440, height: 900 });

  console.log(`\n  📋 ${section.name}`);
  let pageNum = 1;

  try {
    while (pageNum <= CONFIG.catalogPages) {
      const url = `https://3ddd.ru/3dmodels?cat=${section.cat}&${section.subcategories.map(s => `subcat=${s}`).join('&')}&page=${pageNum}`;

      // Перехватываем ответ /api/models который сайт сам делает при загрузке страницы
      let apiData = null;
      const responseHandler = async (response) => {
        if (response.url().includes('/api/models') && response.request().method() === 'POST') {
          try {
            const json = await response.json();
            if (json.data?.models?.length) apiData = json.data;
          } catch {}
        }
      };
      page.on('response', responseHandler);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      // Даём время на подгрузку если networkidle2 не поймал
      if (!apiData) await delay(3000);

      page.off('response', responseHandler);

      if (!apiData || !apiData.models?.length) {
        console.log(`    Стр.${pageNum}: моделей нет, стоп`);
        break;
      }

      const before = Object.keys(allModels).length;
      for (const m of apiData.models) {
        if (!allModels[m.slug]) {
          const img = m.images?.[0];
          allModels[m.slug] = {
            slug: m.slug,
            url: `https://3ddd.ru/3dmodels/show/${m.slug}`,
            name: m.title || m.title_en || m.slug,
            preview: img ? `https://b6.3ddd.ru/${img.web_path}` : null,
            price: parseInt(m.price || 0),
            isPro: m.model_type === 'pro',
            isFree: m.model_type === 'free' || !m.price || m.price === '0',
            votes: parseInt(m.votes_count || 0),
            subcat: m.category?.slug || null,
            subcatName: m.category?.title || null,
            favorites: null,
          };
        }
      }

      const added = Object.keys(allModels).length - before;
      const total = apiData.total_value || 0;
      const perPage = apiData.per_page || 60;
      const totalPages = Math.ceil(total / perPage);
      console.log(`    Стр.${pageNum}/${Math.min(totalPages, CONFIG.catalogPages)}: +${added} новых, итого ${Object.keys(allModels).length}`);

      if (added === 0 || pageNum >= totalPages) break;
      pageNum++;
      await delay(CONFIG.catalogDelayMs, 1000);
    }
  } finally {
    await page.close();
  }

  return allModels;
}

// ─── Получаем счётчик избранного со страницы каждой модели ──────────────────
async function enrichFavorites(browser, allModels, existingModels) {
  const slugs = Object.keys(allModels);
  if (!slugs.length) return;
  console.log(`\n  ❤️  Избранное для ${slugs.length} моделей...`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  let done = 0, found = 0, errors = 0;

  try {
    for (const slug of slugs) {
      const model = allModels[slug];
      const existing = existingModels?.[slug];
      if (!model.preview && existing?.preview) model.preview = existing.preview;

      try {
        await page.goto(`https://3ddd.ru/3dmodels/show/${slug}`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });

        // Читаем уже отрендеренный DOM — никакого regex
        const fav = await page.$eval(
          '.added-to-collections',
          el => parseInt(el.textContent.trim()) || null
        ).catch(() => null);

        if (fav != null) {
          model.favorites = fav;
          found++;

          const prev = existing?.favoritesHistory || [];
          const lastVal = prev.length ? prev[prev.length - 1].value : null;
          model.favoritesHistory = lastVal !== fav
            ? [...prev, { date: new Date().toISOString(), value: fav }]
            : prev;
        } else if (existing?.favoritesHistory) {
          model.favoritesHistory = existing.favoritesHistory;
        }

        // Имя и превью если не было
        if (!model.name || model.name === slug) {
          const t = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => null);
          if (t) model.name = t.replace(/\s*-.*$/, '').trim();
        }
        if (!model.preview) {
          const i = await page.$eval('meta[property="og:image"]', el => el.content).catch(() => null);
          if (i) model.preview = i;
        }

        model.scannedAt = new Date().toISOString();
        done++;
      } catch (e) {
        errors++;
      }

      if ((done + errors) % 20 === 0) {
        console.log(`    ${done + errors}/${slugs.length} готово, ❤️ найдено: ${found}`);
      }
      await delay(CONFIG.detailDelayMs, 1000);
    }
  } finally {
    await page.close();
  }

  console.log(`  ✓ ${done} обработано, ❤️ найдено: ${found}, ошибок: ${errors}`);
}

// ─── Обработка одного раздела ────────────────────────────────────────────────
async function processSection(browser, section) {
  console.log(`\n${'═'.repeat(48)}\n  ${section.icon} ${section.name}\n${'═'.repeat(48)}`);
  const filePath = path.join(CONFIG.outputDir, `${section.id}.json`);
  const existing = loadExisting(filePath);

  const allModels = await fetchAllModels(browser, section);

  // Подтягиваем старые модели
  if (existing?.models) {
    for (const [slug, m] of Object.entries(existing.models)) {
      if (!allModels[slug]) allModels[slug] = m;
    }
  }
  console.log(`  📦 Всего: ${Object.keys(allModels).length}`);

  await enrichFavorites(browser, allModels, existing?.models);

  const topByFavorites = Object.values(allModels)
    .filter(m => m.favorites != null)
    .sort((a, b) => b.favorites - a.favorites)
    .map(m => m.slug);

  const subcatStats = {};
  for (const m of Object.values(allModels)) {
    if (!m.subcat) continue;
    if (!subcatStats[m.subcat]) subcatStats[m.subcat] = { id: m.subcat, name: m.subcatName || m.subcat, totalFavorites: 0, modelCount: 0, topFavorites: 0, topSlug: null };
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
    topByFavorites, subcatStats, models: allModels,
  };
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
  const top = allModels[topByFavorites[0]];
  console.log(`  💾 Сохранено: ${output.totalModels} моделей, ${output.totalWithFavorites} с избранным`);
  if (top) console.log(`  🏆 Топ: "${top.name}" — ${top.favorites} ❤️`);
}

// ─── Главная функция ─────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 3ddd Scraper (Puppeteer)');
  console.log(`📅 ${new Date().toISOString()}`);
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });

  const rotState = loadExisting(CONFIG.stateFile) || { currentGroup: 0 };
  const groupIndex = rotState.currentGroup % SECTION_GROUPS.length;
  const todayIds = SECTION_GROUPS[groupIndex];
  const todaySections = SECTIONS.filter(s => todayIds.includes(s.id));

  console.log(`\n🔄 Группа ${groupIndex + 1}/${SECTION_GROUPS.length}: ${todaySections.map(s => s.name).join(', ')}`);

  const browser = await launchBrowser();
  try {
    for (const section of todaySections) {
      await processSection(browser, section);
    }
  } finally {
    await browser.close();
  }

  // Обновляем meta.json
  const metaPath = path.join(CONFIG.outputDir, 'meta.json');
  const existingMeta = loadExisting(metaPath) || {};
  const sections = existingMeta.sections || {};
  for (const s of todaySections) {
    const d = loadExisting(path.join(CONFIG.outputDir, `${s.id}.json`));
    if (!d) continue;
    const top = d.topByFavorites?.map(sl => d.models[sl]).find(m => m?.favorites != null);
    sections[s.id] = {
      name: s.name, icon: s.icon,
      totalModels: d.totalModels,
      totalFavorites: Object.values(d.models).reduce((a, m) => a + (m.favorites || 0), 0),
      updatedAt: d.updatedAt,
      topModel: top?.name,
      topFavorites: top?.favorites,
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
