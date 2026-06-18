#!/usr/bin/env node
// ТЕСТОВЫЙ СКРИПТ — 1 раздел, 1 страница, 5 моделей
// Проверяет: запуск Chrome, сбор каталога, картинки, избранное
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome';

async function main() {
  console.log('🧪 Тест скрапера');
  console.log(`🌐 Chrome: ${CHROME_PATH}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  console.log(`✓ Chrome: ${await browser.version()}\n`);

  // ШАГ 1: Каталог — берём 1 страницу мебели
  console.log('📋 Шаг 1: Сбор каталога (1 страница мебели)...');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  let apiData = null;
  page.on('response', async (response) => {
    if (response.url().includes('/api/models') && response.request().method() === 'POST') {
      try { const json = await response.json(); if (json.data?.models?.length) apiData = json.data; } catch {}
    }
  });

  await page.goto('https://3ddd.ru/3dmodels?cat=furniture&order=sell_rating&page=1', { waitUntil: 'networkidle2', timeout: 30000 });
  if (!apiData) await new Promise(r => setTimeout(r, 3000));
  await page.close();

  if (!apiData?.models?.length) {
    console.log('❌ Каталог не загрузился'); await browser.close(); process.exit(1);
  }

  // Берём только 5 моделей для теста
  const testModels = apiData.models.slice(0, 5).map(m => {
    const img = m.images?.[0];
    return {
      slug: m.slug,
      name: m.title || m.slug,
      preview: img ? `https://b6.3ddd.ru/media/cache/models-list-webp/${img.web_path}` : null,
      votes: parseInt(m.votes_count || 0),
      favorites: null,
    };
  });

  console.log(`✓ Получено ${testModels.length} моделей:`);
  testModels.forEach(m => console.log(`  - ${m.name} (👍 ${m.votes})`));

  // ШАГ 2: Проверяем картинку первой модели
  console.log('\n🖼️  Шаг 2: Проверка картинки...');
  const firstPreview = testModels[0].preview;
  console.log(`  URL: ${firstPreview}`);
  const testPage = await browser.newPage();
  const imgResponse = await testPage.goto(firstPreview, { timeout: 10000 }).catch(() => null);
  console.log(imgResponse?.status() === 200 ? '✓ Картинка загружается' : `❌ Картинка: статус ${imgResponse?.status()}`);
  await testPage.close();

  // ШАГ 3: Избранное для 5 моделей
  console.log('\n❤️  Шаг 3: Сбор избранного...');
  const detailPage = await browser.newPage();
  await detailPage.setViewport({ width: 1440, height: 900 });
  let found = 0;

  for (const model of testModels) {
    await detailPage.goto(`https://3ddd.ru/3dmodels/show/${model.slug}`, { waitUntil: 'networkidle2', timeout: 30000 });
    model.favorites = await detailPage.$eval('.added-to-collections', el => parseInt(el.textContent.trim()) || null).catch(() => null);
    console.log(`  ${model.name}: ❤️ ${model.favorites ?? 'не найдено'}`);
    if (model.favorites != null) found++;
    await new Promise(r => setTimeout(r, 1500));
  }
  await detailPage.close();

  // Результат
  console.log('\n📊 Итог:');
  console.log(`  Моделей: ${testModels.length}`);
  console.log(`  Картинка: ${firstPreview ? '✓' : '❌'}`);
  console.log(`  Избранное найдено: ${found}/${testModels.length}`);

  fs.writeFileSync('test-result.json', JSON.stringify(testModels, null, 2));
  console.log('\n✅ Готово! Результат в test-result.json');

  if (found === testModels.length) {
    console.log('🎉 Всё работает правильно!');
  } else {
    console.log('⚠️  Не все избранные нашлись — проверь test-result.json');
  }

  await browser.close();
}

main().catch(err => { console.error('💥', err); process.exit(1); });
