/**
 * Cloudflare Worker — прокси для картинок с 3ddd.ru
 * 
 * Деплой:
 * 1. Зайди на https://workers.cloudflare.com
 * 2. Создай новый Worker
 * 3. Вставь этот код
 * 4. Сохрани и скопируй URL вида https://xxx.workers.dev
 * 5. Вставь этот URL в dashboard/config.js
 */

const ALLOWED_HOSTS = ['3ddd.ru', 'b1.3ddd.ru', 'b2.3ddd.ru', 'b3.3ddd.ru', 'b4.3ddd.ru', 'b5.3ddd.ru', 'b6.3ddd.ru'];
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 дней

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    const imageUrl = url.searchParams.get('url');

    if (!imageUrl) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    // Проверяем что URL ведёт на 3ddd
    let parsedUrl;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    const hostname = parsedUrl.hostname;
    if (!ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
      return new Response('Only 3ddd.ru images are allowed', { status: 403 });
    }

    // Проверяем кэш
    const cache = caches.default;
    const cacheKey = new Request(imageUrl);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set('X-Cache', 'HIT');
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;
    }

    // Запрашиваем картинку с серверов 3ddd
    let imageResponse;
    try {
      imageResponse = await fetch(imageUrl, {
        headers: {
          'Referer': 'https://3ddd.ru/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
    } catch (e) {
      return new Response('Failed to fetch image: ' + e.message, { status: 502 });
    }

    if (!imageResponse.ok) {
      return new Response('Image not found', { status: imageResponse.status });
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // Кэшируем ответ
    const response = new Response(imageResponse.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'MISS',
        'X-Proxied-From': hostname,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
