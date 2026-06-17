#!/usr/bin/env node
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
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const SECTIONS = [
  { id: 'furniture', name: 'Мебель', cat: 'furniture', icon: '🛋️', subcategories: ['armchairs','beds','chairs','consoles','dressing-tables','hallway-furniture','headboards','miscellaneous-furniture','miscellaneous-soft-seating','office-furniture','racks','sideboards-and-chests-of-drawers','sofas','tables','tables-and-chairs','tv-walls','wardrobes-and-display-cabinets'] },
  { id: 'lighting',  name: 'Освещение', cat: 'light', icon: '💡', subcategories: ['built-in-lamps','ceiling-lamps','floor-lamps','neon','pendant-lamps','street-lamps','table-lamps','technical-lamps','wall-lamps'] },
  { id: 'decor',     name: 'Декор', cat: 'decor', icon: '🖼️', subcategories: ['3d-panels','books','carpets','clocks','clothes-and-shoes','curtains','decorative-set','frames','interior-objects','mirrors','molding','pillows','sculptures','vases'] },
  { id: 'bathroom',  name: 'Санузел', cat: 'bathroom', icon: '🚿', subcategories: ['bath-decor','bath-faucets','bathtubs','bathroom-furniture','shower-cabins','towel-rails','wash-basins','wc-and-bidet'] },
  { id: 'kitchen',   name: 'Кухня', cat: 'kitchen', icon: '🍳', subcategories: ['dishes','food-and-drinks','kitchen-appliances','kitchen-faucets','kitchen-furniture','kitchen-sinks','kitchen-stuff'] },
  { id: 'plants',    name: 'Растения', cat: 'plants', icon: '🌿', subcategories: ['bouquets','bushes','grass','indoor-plants','outdoor-plants','phytowalls','trees'] },
  { id: 'tech',      name: 'Техника', cat: 'tech', icon: '📱', subcategories: ['audio','computers-and-electronics','home-appliances','phones','tech-other','tv'] },
  { id: 'exterior',  name: 'Экстерьер', cat: 'exterior', icon: '🏠', subcategories: ['barbecue-and-grill','buildings','exterior-other','facade-elements','fencing','nature-details','pavement','playground','urban-environment'] },
  { id: 'children',  name: 'Детская', cat: 'children', icon: '🧸', subcategories: ['children-beds','children-items','children-tables-and-chairs','children-wardrobes','other-children-items','toys'] },
  { id: 'transport', name: 'Транспорт', cat: 'transport', icon: '🚗', subcategories: ['air-transport','land-transport','water-transport'] },
  { id: 'materials', name: 'Материалы', cat: 'materials', icon: '🎨', subcategories: ['fabric-materials','glass-materials','leather-materials','liquid-materials','metal-materials','miscellaneous-materials','plastic-materials','stone-materials','tile-materials','wood-materials'] },
  { id: 'textures',  name: 'Текстуры', cat: 'textures', icon: '🖼️', subcategories: ['brick-textures','carpet-textures','fabric-textures','floor-textures','hdri','leather-textures','metal-textures','miscellaneous-textures','organic-textures','panoramic','stone-textures','tile-textures','wall-textures','wood-textures'] },
  { id: 'other',     name: 'Другие модели', cat: 'miscellaneous-models', icon: '📦', subcategories: ['beauty-salon','billiards','doors','fireplaces','living-creatures','miscellaneous-objects','musical-instruments','radiators','restaurant','shop','sport','stairs','weapons','windows'] },
];

const SECTION_GROUPS = [
  ['furniture', 'lighting', 'decor'],
  ['bathroom', 'kitchen', 'plants'],
  ['tech', 'exterior', 'children'],
  ['transport', 'materials', 'textures'],
  ['other'],
];

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      if ([301,302].includes(res.statusCode)) {
        const loc = res.headers.location;
        if (loc) return req({...options, hostname:'3ddd.ru', path: loc.startsWith('http') ? new URL(loc).pathname : loc, method: options.method}, body).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    r.on('error', reject);
    r.setTimeout(20000, () => { r.destroy(); reject(new Error('Timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

function delay(ms, jitter = 0) {
  return new Promise(r => setTimeout(r, ms + Math.floor(Math.random() * jitter)));
}

// Получаем список моделей через страницу каталога с sitemaps
async function fetchModelsViaSearch(cat, subcats, page, order) {
  // Сразу используем JSON API
  try {
    const modelsBody = JSON.stringify({ categories: subcats, page });
    const refererUrl = subcats.length > 0
      ? `https://3ddd.ru/3dmodels?cat=${cat}&${subcats.map(s=>`subcat=${s}`).join('&')}&page=${page}`
      : `https://3ddd.ru/3dmodels?cat=${cat}&page=${page}`;

    const { status, body: resp } = await req({
      hostname: '3ddd.ru',
      path: '/api/models',
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(modelsBody),
        'referer': refererUrl,
        'user-agent': CONFIG.userAgent,
        'origin': 'https://3ddd.ru',
        'cookie': 'besrv=app180',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'expires': 'Sat, 01 Jan 2000 00:00:00 GMT',
      },
    }, modelsBody);

    console.log(`    API стр.${page}: статус ${status}`);

    if (status === 200) {
      const json = JSON.parse(resp);
      if (json.data?.models?.length) {
        return json.data;
      }
      console.log(`    ⚠️ Моделей нет (total: ${json.data?.total_value}, hash: ${json.data?.search_hash})`);
    }
  } catch(e) {
    console.log(`    ❌ API ошибка: ${e.message}`);
  }
  return null;
}


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
    subcat: m.category?.slug || null,
    subcatName: m.category?.title || null,
    favorites: null,
  };
}

function parseFavoritesFromHtml(html) {
  const m = html.match(/class="[^"]*added-to-collections[^"]*"[^>]*>\s*(\d+)\s*</i);
  return m ? parseInt(m[1]) : null;
}

async function fetchAllModels(section) {
  const allModels = {};

  for (const order of ['date_desc', 'sell_rating']) {
    console.log(`\n  📋 ${section.name} / ${order}`);
    let page = 1;

    while (page <= CONFIG.catalogPages) {
      const data = await fetchModelsViaSearch(section.cat, section.subcategories || [], page, order);

      if (!data || !data.models?.length) break;

      for (const m of data.models) {
        const slug = m.slug;
        if (!allModels[slug]) {
          allModels[slug] = m.fromHtml
            ? { slug, url: `https://3ddd.ru/3dmodels/show/${slug}`, name: slug, preview: null, price: 0, isPro: false, isFree: true, favorites: null }
            : parseModelFromApi(m);
        }
      }

      const total = data.total_value || 0;
      const perPage = data.per_page || 60;
      const totalPages = Math.ceil(total / perPage);
      console.log(`    Стр.${page}/${Math.min(totalPages || page, CONFIG.catalogPages)}: итого ${Object.keys(allModels).length}`);

      if (page >= (totalPages || 1)) break;
      page++;
      await delay(CONFIG.catalogDelayMs, 1000);
    }
  }

  return allModels;
}

async function enrichFavorites(allModels, existingModels) {
  const slugs = Object.keys(allModels);
  if (!slugs.length) return;
  console.log(`\n  ❤️  Получаем избранное для ${slugs.length} моделей...`);
  let done = 0, errors = 0;

  for (const slug of slugs) {
    const model = allModels[slug];
    const existing = existingModels?.[slug];
    if (!model.preview && existing?.preview) model.preview = existing.preview;

    try {
      const { status, body } = await req({
        hostname: '3ddd.ru',
        path: `/3dmodels/show/${slug}`,
        method: 'GET',
        headers: { 'User-Agent': CONFIG.userAgent, 'Accept': 'text/html', 'Referer': 'https://3ddd.ru/3dmodels' },
      });
      if (status === 200) {
        const fav = parseFavoritesFromHtml(body);
        if (fav != null) model.favorites = fav;
        // Название из og:title если нет
        if (!model.name || model.name === slug) {
          const t = body.match(/property="og:title"\s+content="([^"]+)"/i);
          if (t) model.name = t[1].replace(/\s*-.*$/, '').trim();
        }
        if (!model.preview) {
          const i = body.match(/property="og:image"\s+content="([^"]+)"/i);
          if (i) model.preview = i[1];
        }
        model.scannedAt = new Date().toISOString();
      }
      done++;
    } catch { errors++; }

    if (model.favorites != null) {
      const prev = existing?.favoritesHistory || [];
      const lastVal = prev.length ? prev[prev.length-1].value : null;
      model.favoritesHistory = lastVal !== model.favorites
        ? [...prev, { date: new Date().toISOString(), value: model.favorites }]
        : prev;
    } else if (existing?.favoritesHistory) {
      model.favoritesHistory = existing.favoritesHistory;
    }

    if ((done+errors) % 50 === 0) console.log(`    ${done}/${slugs.length} готово`);
    await delay(CONFIG.detailDelayMs, CONFIG.detailDelayJitter);
  }
  console.log(`  ✓ ${done} обновлено, ${errors} ошибок`);
}

function loadExisting(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : null; } catch { return null; }
}

async function processSection(section) {
  console.log(`\n${'═'.repeat(48)}\n  ${section.icon} ${section.name}\n${'═'.repeat(48)}`);
  const filePath = path.join(CONFIG.outputDir, `${section.id}.json`);
  const existing = loadExisting(filePath);

  const allModels = await fetchAllModels(section);
  if (existing?.models) {
    for (const [slug, m] of Object.entries(existing.models)) {
      if (!allModels[slug]) allModels[slug] = m;
    }
  }
  console.log(`  📦 Всего: ${Object.keys(allModels).length}`);

  await enrichFavorites(allModels, existing?.models);

  const topByFavorites = Object.values(allModels)
    .filter(m => m.favorites != null)
    .sort((a,b) => b.favorites - a.favorites)
    .map(m => m.slug);

  const subcatStats = {};
  for (const m of Object.values(allModels)) {
    if (!m.subcat) continue;
    if (!subcatStats[m.subcat]) subcatStats[m.subcat] = { id: m.subcat, name: m.subcatName||m.subcat, totalFavorites:0, modelCount:0, topFavorites:0, topSlug:null };
    subcatStats[m.subcat].modelCount++;
    if (m.favorites) {
      subcatStats[m.subcat].totalFavorites += m.favorites;
      if (m.favorites > subcatStats[m.subcat].topFavorites) { subcatStats[m.subcat].topFavorites = m.favorites; subcatStats[m.subcat].topSlug = m.slug; }
    }
  }

  const output = { id:section.id, name:section.name, icon:section.icon, updatedAt:new Date().toISOString(), totalModels:Object.keys(allModels).length, totalWithFavorites:topByFavorites.length, topByFavorites, subcatStats, models:allModels };
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
  const top = allModels[topByFavorites[0]];
  console.log(`  💾 Сохранено: ${output.totalModels} моделей`);
  if (top) console.log(`  🏆 Топ: "${top.name}" — ${top.favorites} ❤️`);
}

async function main() {
  console.log('🚀 3ddd Scraper');
  console.log(`📅 ${new Date().toISOString()}`);
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });

  const rotState = loadExisting(CONFIG.stateFile) || { currentGroup: 0 };
  const groupIndex = rotState.currentGroup % SECTION_GROUPS.length;
  const todayIds = SECTION_GROUPS[groupIndex];
  const todaySections = SECTIONS.filter(s => todayIds.includes(s.id));

  console.log(`\n🔄 Группа ${groupIndex+1}/${SECTION_GROUPS.length}: ${todaySections.map(s=>s.name).join(', ')}`);

  for (const section of todaySections) await processSection(section);

  const metaPath = path.join(CONFIG.outputDir, 'meta.json');
  const existingMeta = loadExisting(metaPath) || {};
  const sections = existingMeta.sections || {};
  for (const s of todaySections) {
    const d = loadExisting(path.join(CONFIG.outputDir, `${s.id}.json`));
    if (!d) continue;
    const top = d.topByFavorites?.map(sl => d.models[sl]).find(m => m?.favorites != null);
    sections[s.id] = { name:s.name, icon:s.icon, totalModels:d.totalModels, totalFavorites:Object.values(d.models).reduce((a,m)=>a+(m.favorites||0),0), updatedAt:d.updatedAt, topModel:top?.name, topFavorites:top?.favorites };
  }

  fs.writeFileSync(metaPath, JSON.stringify({ ...existingMeta, finishedAt:new Date().toISOString(), currentGroup:groupIndex, nextGroup:(groupIndex+1)%SECTION_GROUPS.length, sections_list:SECTIONS.map(s=>({id:s.id,name:s.name,icon:s.icon})), sections }, null, 2));
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify({ currentGroup:(groupIndex+1)%SECTION_GROUPS.length, lastRun:new Date().toISOString(), lastSections:todaySections.map(s=>s.name) }, null, 2));

  console.log('\n✅ Готово!');
}

main().catch(err => { console.error('💥', err); process.exit(1); });
