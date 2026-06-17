// ══════════════════════════════════════════════════════
//  НАСТРОЙКИ ДАШБОРДА — отредактируй перед использованием
// ══════════════════════════════════════════════════════

window.DASHBOARD_CONFIG = {

  // URL твоего Cloudflare Worker для проксирования картинок
  // Пример: 'https://my-worker.username.workers.dev'
  // Оставь пустым если не настроил Worker (картинки будут грузиться напрямую)
  workerUrl: 'https://small-cell-a7d7.teremok1522.workers.dev',

  // Разделы сайта
  sections: [
    { id: 'furniture',  name: 'Мебель',        icon: '🛋️' },
    { id: 'lighting',   name: 'Освещение',      icon: '💡' },
    { id: 'decor',      name: 'Декор',          icon: '🖼️' },
    { id: 'bathroom',   name: 'Санузел',        icon: '🚿' },
    { id: 'kitchen',    name: 'Кухня',          icon: '🍳' },
    { id: 'plants',     name: 'Растения',       icon: '🌿' },
    { id: 'tech',       name: 'Техника',        icon: '📱' },
    { id: 'exterior',   name: 'Экстерьер',      icon: '🏠' },
    { id: 'other',      name: 'Другие модели',  icon: '📦' },
    { id: 'children',   name: 'Детская',        icon: '🧸' },
    { id: 'transport',  name: 'Транспорт',      icon: '🚗' },
    { id: 'materials',  name: 'Материалы',      icon: '🎨' },
    { id: 'textures',   name: 'Текстуры',       icon: '🖼️' },
  ],

  // Путь к папке с данными (относительно index.html)
  dataPath: './data',
};
