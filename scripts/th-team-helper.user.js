// ==UserScript==
// @name         TH Management — Team Helper
// @namespace    th-management-team-helper
// @version      1.18
// @description  Девять помощников в одном скрипте: превью вложений при наведении с полноэкранным просмотром (поворот на 90° и масштабирование колесом мыши), тултип «Предыдущий статус» для закрытых тикетов, поиск лимитов по странице Confluence при выделении текста, справочник админов (имя и отдел по логину) в окне истории тикета, автоподстановка своего Reddy ID в модалку экспорта файла, автоподстановка диапазона дат в фильтр, кнопка «Данные тикета» в форме редактирования и в каждой строке таблицы, которая копирует собранные поля и опциональный шаблон комментария в буфер обмена, компактные кнопки вместо длинных ссылок на файлы в таблице, и копирование значения любой ячейки при наведении на неё. Каждую функцию можно включить или выключить в блоке CONFIG или через панель настроек на странице (кнопка в левом нижнем углу).
// @match        https://th-managment.com/en/admin/backoffice/paymentsupport*
// @match        https://my-managment.com/en/admin/backoffice/paymentsupport*
// @match        https://managment.io/en/admin/backoffice/paymentsupport*
// @match        https://th-managment.com/en/admin/backoffice/ExtendedPaymentRequestList*
// @match        https://my-managment.com/en/admin/backoffice/ExtendedPaymentRequestList*
// @match        https://managment.io/en/admin/backoffice/ExtendedPaymentRequestList*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      doc.office.lan
// @updateURL    https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-team-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-team-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // НАСТРОЙКИ
  // ------------------------------------------------------------------
  const CONFIG = {
    // Какие функции включены. Чтобы отключить любую — поставить false.
    features: {
      // Превью вложений при наведении на ссылку в таблице + полноэкранный просмотр
      filePreview: true,
      // Тултип с предыдущим статусом для закрытых тикетов
      prevStatus: true,
      // Поиск лимитов по странице Confluence при выделении текста
      limitsFinder: true,
      // Справочник админов: имя и отдел по логину в окне истории тикета
      adminDirectory: true,
      // Подстановка своего Reddy ID
      messengerId: true,
      // Автоподстановка диапазона дат после применения фильтра
      autoDateRange: true,
      // Кнопка «Данные тикета» в форме редактирования: собирает поля
      // тикета и копирует их в буфер обмена
      ticketCopy: true,
      // Компактные кнопки вместо длинных ссылок на файлы в таблице
      fileButtons: true,
      // Маленькая кнопка копирования значения одной ячейки при наведении
      cellCopy: true,
    },

    // ── Превью вложений ──────────────────────────────────────────────
    filePreview: {
      // Максимальная ширина картинки в попапе (px)
      maxWidth: 400,
      // Задержка перед скрытием попапа, чтобы успеть довести до него мышь (мс)
      hideDelay: 200,
      // Какие расширения считать картинками (для них доступен полноэкранный режим)
      imageExts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
      // Какие расширения считать видео (показывается иконка + имя файла)
      videoExts: ['mp4', 'webm', 'mov', 'avi'],
      // Масштабирование в полноэкранном режиме
      zoom: {
        // Во сколько раз меняется масштаб за одно деление колеса мыши
        step: 1.15,
        // Минимальный масштаб. 1 — картинка, вписанная в экран;
        // меньше единицы разрешает уменьшать её сильнее.
        min: 1,
        // Предел увеличения
        max: 8,
      },
    },

    // ── Предыдущий статус ────────────────────────────────────────────
    prevStatus: {
      // Для каких значений External Status показывать тултип (в нижнем регистре).
      // Сейчас — только закрытые тикеты. Чтобы расширить, дописать статусы сюда,
      // например: 'credited', 'credited (m)', 'duplicated ticket'.
      triggers: ['closed', 'closed (m)'],
      // Эндпоинт истории тикета
      historyUrl: '/admin/backoffice/paymentsupporthistory',
      // Задержка перед скрытием тултипа (мс)
      hideDelay: 150,
    },

    // ── Поиск лимитов в Confluence ───────────────────────────────────
    limitsFinder: {
      // ВАЖНО: проверьте, что это нужная вам страница. Адрес взят из
      // скрипта Team B; если у вашей команды лимиты лежат на другой
      // странице, замените ссылку здесь.
      pageUrl: 'https://doc.office.lan/spaces/MENA/pages/373073072/%D0%9B%D0%98%D0%9C%D0%98%D0%A2%D0%AB+%D0%A0%D0%A3%D0%A7%D0%9D%D0%AB%D0%95',
      // В какой колонке таблицы работает выделение текста (подстрока
      // названия колонки, в нижнем регистре)
      column: 'query subagent',
      // Сколько ждать ответа от Confluence (мс)
      timeout: 15000,
      // Ширина всплывающего окна (px)
      width: 340,
    },

    // ── Справочник админов ───────────────────────────────────────────
    adminDirectory: {
      // Страница Confluence «Расшифровка логинов L2 PS» — одна таблица из
      // трёх столбцов в этом порядке: логин | имя | отдел. Столбцы
      // читаются по позиции, а не по названию — заголовки могут быть
      // любыми.
      pageUrl: 'https://doc.office.lan/spaces/MENA/pages/663814054/%D0%A0%D0%B0%D1%81%D1%88%D0%B8%D1%84%D1%80%D0%BE%D0%B2%D0%BA%D0%B0+%D0%BB%D0%BE%D0%B3%D0%B8%D0%BD%D0%BE%D0%B2+L2+PS',
      // Название колонки в окне «История тикета», где лежит логин
      // (подстрока, в нижнем регистре)
      column: 'admin username',
      // Сколько ждать ответа от Confluence (мс)
      timeout: 15000,
      // Задержка перед скрытием тултипа (мс)
      hideDelay: 150,
    },

    // ── Подстановка Reddy ID ──────────────────────────────────────────
    messengerId: {
      // Ключ в хранилище Tampermonkey
      storageKey: 'reddyId',
      // Атрибут в серверной разметке страницы, откуда берётся ID
      // (технически это поле называется curr_medium, но в интерфейсе
      // и в кнопках сайт называет этот мессенджер Reddy)
      sourceAttr: 'curr_medium',
      // Плейсхолдер поля в модалке SweetAlert2, куда подставляется ID.
      // Именно по нему находим поле — оно не имеет id/name, а кнопка,
      // открывающая модалку, может называться по-разному в разных местах
      fieldPlaceholder: 'Reddy ID',
    },

    // ── Автоподстановка дат ──────────────────────────────────────────
    autoDateRange: {
      // Насколько назад отсчитывать начало диапазона
      yearsBack: 1,
      // Случайный сдвиг даты «от» вперёд от точки «год назад», в днях
      // [мин, макс] включительно. Минимум 1 — чтобы не выйти за годовое
      // окно и чтобы дата не была ровно «год назад» каждый раз.
      shiftDays: [1, 30],
      // Время начала и конца диапазона [часы, минуты]
      startTime: [0, 0],
      endTime: [23, 59],
      // Пауза после нажатия Apply, прежде чем искать поле даты (мс)
      applyDelay: 300,
      // Сколько ещё пытаться, если поле не появилось сразу
      retryInterval: 100,
      retryTimeout: 3000,
    },

    // ── Копирование данных тикета ──────────────────────────────────────
    ticketCopy: {
      // Заголовок поля, после которого вставляется кнопка
      anchorField: 'Comment (internal)',
      // Заголовки полей формы/шапки тикета, откуда берутся данные
      fields: {
        subagent: 'Subagent',
        userId: 'User ID',
        amount: 'Amount by receipt',
        date: 'Payment creation date',
        agentWallet: 'Agent wallet',
        userWallet: "User's wallet",
        recipientDepartment: 'Recipient department',
        transactionId: 'Transaction ID',
        uniqueTransferNumber: 'Unique transfer number',
        agent: 'Agent',
      },
      // Чем заменяется пустое значение поля в итоговом тексте
      emptyPlaceholder: '—',
      // Колонка в обычной таблице (не в форме Edit), куда вставляется
      // компактная кнопка копирования. Actions есть не на всех листах
      // (например, нет на ExtendedPaymentRequestList) — Ticket history
      // есть везде
      tableRowButtonColumn: 'Ticket history',
      // Заголовки колонок обычной таблицы для тех же 10 полей — не
      // совпадают дословно с названиями полей формы Edit (fields выше)
      tableFields: {
        subagent: 'Subagent',
        userId: 'User ID',
        amount: 'Amount',
        date: 'Date of payment',
        agentWallet: "Agent's wallet",
        userWallet: "User's wallet",
        recipientDepartment: 'Department',
        transactionId: 'Transaction ID',
        uniqueTransferNumber: 'Unique transfer number',
        agent: 'Agent',
      },
      // Варианты комментария в шапке сообщения. template получает объект
      // выбранных под-опций (или ничего, если под-опций нет) и
      // возвращает строку комментария, либо null — тогда комментарий не
      // добавляется вовсе.
      comments: [
        { label: 'Без комментария', template: null },
        {
          label: 'Лимит + возврат из Request for a refund',
          choices: [
            { key: 'limit', title: 'Сумма', options: ['ниже лимита', 'выше лимита'] },
            { key: 'status', title: 'Вернулся в', options: ['Received (M)', 'Approved (M)'] },
          ],
          template: (c) => `сумма ${c.limit}, уже ранее был в Request for a refund (M), вернулся в ${c.status} уточните, пожалуйста, получал ли агент средства?`,
        },
        {
          label: 'Подозрительный скриншот',
          template: () => 'уточните, пожалуйста, получал ли агент средства? Скриншот выглядит подозрительно.',
        },
      ],
    },

    // ── Кнопки вместо ссылок на файлы ──────────────────────────────────
    fileButtons: {
      // В каких колонках ссылки заменяются кнопками. Сравнение точное,
      // после нормализации пробелов и апострофов, в нижнем регистре.
      columns: ['user files', "agent's files", "support team's files"],
      // Подпись кнопки по расширению файла. Всё, что не попало сюда,
      // подписывается значением fallbackLabel.
      types: {
        'Скрин': ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'svg'],
        'GIF': ['gif'],
        'PDF': ['pdf'],
        'Видео': ['mp4', 'webm', 'mov', 'avi', 'mkv', 'mpeg', 'mpg', 'm4v', '3gp'],
        'Аудио': ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
        'DOC': ['doc', 'docx', 'odt', 'rtf'],
        'XLS': ['xls', 'xlsx', 'csv', 'ods'],
        'Архив': ['zip', 'rar', '7z', 'tar', 'gz'],
        'TXT': ['txt'],
      },
      fallbackLabel: 'Файл',
    },

    // Подробный лог в консоль (F12 → Console)
    debug: false,
  };

  // ------------------------------------------------------------------
  // ОБЩЕЕ
  // ------------------------------------------------------------------

  // Со включённым @grant скрипт работает в песочнице, и window здесь —
  // не окно страницы. Тему админка держит в своей переменной, поэтому
  // читаем её через unsafeWindow, когда он доступен.
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const isDark = pageWindow._THEME === 'dark';

  const T = isDark ? {
    bg: '#1C2128',
    border: '#30363D',
    text: '#C9D1D9',
    textStrong: '#E6EDF3',
    textDim: '#8B949E',
    imgBg: '#0D1117',
    panel: '#161B22',
    shadow: '0 8px 24px rgba(0,0,0,0.45)',
  } : {
    bg: '#fff',
    border: '#DFE1E6',
    text: '#42526E',
    textStrong: '#172B4D',
    textDim: '#8993A4',
    imgBg: '#F7F8FA',
    panel: '#F6F7F8',
    shadow: '0 8px 24px rgba(0,0,0,0.18)',
  };

  const ACCENT = '#2ABFCF';
  const ACCENT_HOVER = '#1fa8b8';

  function log(...args) {
    if (CONFIG.debug) console.log('[TeamHelper]', ...args);
  }

  function addStyle(id, css) {
    if (document.getElementById(id)) return false;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
    return true;
  }

  // Держит элемент в пределах экрана: возвращает координаты левого верхнего угла
  function clampToViewport(left, top, width, height, margin) {
    const m = margin === undefined ? 12 : margin;
    if (left + width > window.innerWidth - m) left = window.innerWidth - width - m;
    if (left < m) left = m;
    if (top + height > window.innerHeight - m) top = window.innerHeight - height - m;
    if (top < m) top = m;
    return { left, top };
  }

  // Ставит тултип рядом с курсором, переворачивая его у краёв экрана
  function placeNearCursor(el, x, y, margin) {
    const m = margin === undefined ? 14 : margin;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 50;
    el.style.left = (x + m + w > window.innerWidth ? x - w - m : x + m) + 'px';
    el.style.top = (y + m + h > window.innerHeight ? y - h - m : y + m) + 'px';
  }

  // ==================================================================
  // 1. ПРЕВЬЮ ВЛОЖЕНИЙ ПРИ НАВЕДЕНИИ
  // ==================================================================

  function initFilePreview() {
    const CFG = CONFIG.filePreview;

    addStyle('th-helper-preview-style', `
      #th-preview-popup {
        position: fixed;
        z-index: 99999;
        background: ${T.bg};
        border: .5px solid ${T.border};
        border-radius: 10px;
        box-shadow: ${T.shadow};
        overflow: hidden;
        pointer-events: none;
        display: none;
        opacity: 0;
        transition: opacity .15s;
        max-width: ${CFG.maxWidth}px;
        width: max-content;
      }
      #th-preview-popup.visible {
        display: block;
        opacity: 1;
        pointer-events: auto;
      }
      #th-preview-popup img {
        display: block;
        max-width: ${CFG.maxWidth}px;
        max-height: calc(100vh - 120px);
        width: auto;
        height: auto;
        object-fit: contain;
        background: ${T.imgBg};
      }
      .th-preview-actions {
        display: flex;
        border-bottom: .5px solid rgba(255,255,255,0.2);
      }
      .th-preview-btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        border-right: .5px solid rgba(255,255,255,0.2);
        background: ${ACCENT};
        font-size: 12px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
        white-space: nowrap;
        transition: background .12s;
        text-decoration: none;
        letter-spacing: .02em;
      }
      .th-preview-btn:last-child { border-right: none; }
      .th-preview-btn:hover { background: ${ACCENT_HOVER}; }
      .th-preview-btn svg { flex-shrink: 0; pointer-events: none; }
      .th-preview-file-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
      }
      .th-preview-file-name {
        font-size: 12px;
        color: ${T.text};
        font-weight: 500;
        word-break: break-all;
        max-width: 300px;
      }
      .th-preview-loading {
        padding: 20px 24px;
        font-size: 11px;
        color: ${T.textDim};
        text-align: center;
        min-width: 160px;
      }
      #th-lightbox {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(0,0,0,0.88);
        display: none;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 12px;
      }
      #th-lightbox.open { display: flex; }
      #th-lightbox-img-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        width: 100vw;
        box-sizing: border-box;
        padding: 0 16px;
      }
      /* Сцена обрезает картинку при увеличении. Картинка позиционируется
         абсолютно и центрируется через transform — так её размер можно
         задавать скриптом, не ломая раскладку соседних стрелок. */
      #th-lightbox-stage {
        flex: 1 1 auto;
        max-width: 88vw;
        height: 76vh;
        position: relative;
        overflow: hidden;
        touch-action: none;
      }
      #th-lightbox img {
        position: absolute;
        left: 50%;
        top: 50%;
        /* Размер задаёт скрипт — см. applyTransform */
        max-width: none;
        max-height: none;
        border-radius: 6px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.5);
        display: block;
        transform-origin: center center;
        user-select: none;
        -webkit-user-drag: none;
      }
      #th-lightbox img.zoomed { cursor: grab; }
      #th-lightbox img.dragging { cursor: grabbing; }
      #th-lightbox-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.10);
        border: .5px solid rgba(255,255,255,0.22);
      }
      .th-lightbox-tool {
        width: 32px; height: 32px;
        border-radius: 50%;
        background: transparent;
        border: none;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .15s;
        padding: 0;
      }
      .th-lightbox-tool:hover:not(:disabled) { background: rgba(255,255,255,0.20); }
      .th-lightbox-tool:disabled { opacity: .3; cursor: default; }
      .th-lightbox-sep {
        width: 1px;
        height: 18px;
        background: rgba(255,255,255,0.22);
        margin: 0 3px;
      }
      #th-lightbox-zoom-label {
        min-width: 48px;
        padding: 5px 2px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: rgba(255,255,255,0.85);
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        text-align: center;
        cursor: pointer;
        transition: background .15s;
      }
      #th-lightbox-zoom-label:hover { background: rgba(255,255,255,0.20); }
      .th-lightbox-arrow {
        width: 40px; height: 40px;
        border-radius: 50%;
        background: rgba(255,255,255,0.15);
        border: .5px solid rgba(255,255,255,0.3);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .15s;
        flex-shrink: 0;
      }
      .th-lightbox-arrow:hover { background: rgba(255,255,255,0.28); }
      .th-lightbox-arrow:disabled { opacity: 0.25; cursor: default; }
      #th-lightbox-counter {
        font-size: 12px;
        color: rgba(255,255,255,0.6);
        text-align: center;
        min-height: 16px;
      }
      #th-lightbox-close {
        position: absolute;
        top: 18px; right: 22px;
        width: 36px; height: 36px;
        border-radius: 50%;
        background: rgba(255,255,255,0.15);
        border: .5px solid rgba(255,255,255,0.3);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .15s;
        z-index: 1;
      }
      #th-lightbox-close:hover { background: rgba(255,255,255,0.28); }
    `);

    const ICON_FULLSCREEN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    const ICON_NEW_TAB = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    const ICON_PDF = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E24B4A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`;
    const ICON_VIDEO = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const ICON_ROTATE_LEFT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    const ICON_ROTATE_RIGHT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
    const ICON_ZOOM_IN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
    const ICON_ZOOM_OUT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;

    const popup = document.createElement('div');
    popup.id = 'th-preview-popup';
    document.body.appendChild(popup);

    // ── Полноэкранный просмотр ───────────────────────────────────────

    const lightbox = document.createElement('div');
    lightbox.id = 'th-lightbox';

    const lbClose = document.createElement('button');
    lbClose.id = 'th-lightbox-close';
    lbClose.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    const lbWrap = document.createElement('div');
    lbWrap.id = 'th-lightbox-img-wrap';

    const lbPrev = document.createElement('button');
    lbPrev.className = 'th-lightbox-arrow';
    lbPrev.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;

    const lbImg = document.createElement('img');

    const lbNext = document.createElement('button');
    lbNext.className = 'th-lightbox-arrow';
    lbNext.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

    const lbStage = document.createElement('div');
    lbStage.id = 'th-lightbox-stage';
    lbStage.appendChild(lbImg);

    const lbCounter = document.createElement('div');
    lbCounter.id = 'th-lightbox-counter';

    // ── Панель поворота и масштаба ───────────────────────────────────

    const toolbar = document.createElement('div');
    toolbar.id = 'th-lightbox-toolbar';

    function makeTool(title, icon) {
      const b = document.createElement('button');
      b.className = 'th-lightbox-tool';
      b.title = title;
      b.innerHTML = icon;
      return b;
    }

    const btnRotateL = makeTool('Повернуть влево на 90°', ICON_ROTATE_LEFT);
    const btnRotateR = makeTool('Повернуть вправо на 90°', ICON_ROTATE_RIGHT);
    const btnZoomOut = makeTool('Уменьшить', ICON_ZOOM_OUT);
    const btnZoomIn = makeTool('Увеличить', ICON_ZOOM_IN);

    const zoomLabel = document.createElement('button');
    zoomLabel.id = 'th-lightbox-zoom-label';
    zoomLabel.title = 'Сбросить поворот и масштаб';
    zoomLabel.textContent = '100%';

    const sep = document.createElement('div');
    sep.className = 'th-lightbox-sep';

    toolbar.appendChild(btnRotateL);
    toolbar.appendChild(btnRotateR);
    toolbar.appendChild(sep);
    toolbar.appendChild(btnZoomOut);
    toolbar.appendChild(zoomLabel);
    toolbar.appendChild(btnZoomIn);

    lbWrap.appendChild(lbPrev);
    lbWrap.appendChild(lbStage);
    lbWrap.appendChild(lbNext);
    lightbox.appendChild(lbClose);
    lightbox.appendChild(lbWrap);
    lightbox.appendChild(toolbar);
    lightbox.appendChild(lbCounter);
    document.body.appendChild(lightbox);

    let lbUrls = [];
    let lbIndex = 0;

    // Состояние просмотра текущей картинки
    let rotation = 0;   // градусы, кратно 90
    let zoom = 1;       // масштаб, заданный пользователем
    let panX = 0;       // сдвиг перетаскиванием, в пикселях экрана
    let panY = 0;

    // Пересчитывает размер и положение картинки.
    //
    // Размер задаётся в вёрстке (width/height), а не через transform: scale.
    // Это принципиально для чёткости: браузер растрирует картинку один раз
    // в её вёрстанном размере, и scale потом растягивает уже готовый растр,
    // не обращаясь к оригиналу. Вписанный в экран скриншот 2400px шириной
    // растрируется, скажем, в 912px — и при увеличении мы видим растянутые
    // 912px вместо настоящих 2400px. Если же менять именно вёрстанный
    // размер, браузер каждый раз растрирует заново из полноразмерного
    // оригинала, и вся детализация файла доходит до экрана.
    //
    // Растр крупнее натурального разрешения смысла не имеет — новых деталей
    // там взяться неоткуда, а память он съедает быстро. Поэтому вёрстанный
    // размер ограничен оригиналом, а всё, что сверх него, догоняется
    // через scale.
    function applyTransform() {
      const natW = lbImg.naturalWidth;
      const natH = lbImg.naturalHeight;
      // Пока новая картинка не загрузилась, размеры относятся к предыдущей
      if (!natW || !natH || !lbImg.complete) return;

      const stageW = lbStage.clientWidth;
      const stageH = lbStage.clientHeight;
      const upright = rotation % 180 === 0;

      // Во сколько раз ужать картинку, чтобы она целиком влезла в сцену
      // с учётом поворота. Мелкие картинки не растягиваем.
      const fit = Math.min(
        1,
        stageW / (upright ? natW : natH),
        stageH / (upright ? natH : natW)
      );

      // Размер, который картинка должна занять на экране
      const dispW = natW * fit * zoom;
      const dispH = natH * fit * zoom;

      const layoutW = Math.min(dispW, natW);
      const layoutH = layoutW * natH / natW;
      const extra = layoutW > 0 ? dispW / layoutW : 1;

      lbImg.style.width = layoutW + 'px';
      lbImg.style.height = layoutH + 'px';

      // Габарит на экране с учётом поворота — по нему ограничиваем сдвиг,
      // чтобы картинку нельзя было утащить за её собственные края
      const screenW = upright ? dispW : dispH;
      const screenH = upright ? dispH : dispW;
      const maxX = Math.max(0, (screenW - stageW) / 2);
      const maxY = Math.max(0, (screenH - stageH) / 2);
      panX = Math.min(maxX, Math.max(-maxX, panX));
      panY = Math.min(maxY, Math.max(-maxY, panY));

      // Порядок важен: -50% центрирует картинку в сцене, затем сдвиг
      // считается в координатах экрана и не «переворачивается» вместе
      // с картинкой, и только потом идут поворот и остаточный масштаб.
      lbImg.style.transform =
        `translate(-50%, -50%) translate(${Math.round(panX)}px, ${Math.round(panY)}px)`
        + ` rotate(${rotation}deg) scale(${extra.toFixed(4)})`;

      lbImg.classList.toggle('zoomed', zoom > 1);
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
      btnZoomOut.disabled = zoom <= CFG.zoom.min + 1e-6;
      btnZoomIn.disabled = zoom >= CFG.zoom.max - 1e-6;
      updateCounter();
    }

    function resetView() {
      rotation = 0;
      zoom = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    }

    function rotateBy(delta) {
      rotation = (rotation + delta + 360) % 360;
      // После поворота картинка перекладывается заново — сдвиг от прошлой
      // ориентации оказался бы бессмысленным
      panX = 0;
      panY = 0;
      applyTransform();
    }

    // cx, cy — точка, которая должна остаться на месте, в координатах
    // относительно центра сцены. Без них масштабируем от центра.
    function setZoom(next, cx, cy) {
      const clamped = Math.min(CFG.zoom.max, Math.max(CFG.zoom.min, next));
      if (Math.abs(clamped - zoom) < 1e-6) return;
      if (cx !== undefined) {
        const k = clamped / zoom;
        panX = cx - k * (cx - panX);
        panY = cy - k * (cy - panY);
      }
      zoom = clamped;
      applyTransform();
    }

    function stageCenterOffset(e) {
      const rect = lbStage.getBoundingClientRect();
      return {
        x: e.clientX - (rect.left + rect.width / 2),
        y: e.clientY - (rect.top + rect.height / 2),
      };
    }

    // Показываем разрешение файла: сразу видно, мелкий ли это оригинал,
    // если картинка выглядит нечёткой при увеличении
    function updateCounter() {
      const parts = [];
      if (lbUrls.length > 1) parts.push(`${lbIndex + 1} / ${lbUrls.length}`);
      if (lbImg.complete && lbImg.naturalWidth) {
        parts.push(`${lbImg.naturalWidth}×${lbImg.naturalHeight}`);
      }
      lbCounter.textContent = parts.join('  ·  ');
    }

    function updateLightbox() {
      lbImg.src = lbUrls[lbIndex];
      lbPrev.disabled = lbIndex === 0;
      lbNext.disabled = lbIndex === lbUrls.length - 1;
      lbPrev.style.visibility = lbUrls.length > 1 ? 'visible' : 'hidden';
      lbNext.style.visibility = lbUrls.length > 1 ? 'visible' : 'hidden';
      updateCounter();
      // Новая картинка — новый лист: поворот и масштаб сбрасываются
      resetView();
    }

    function openLightbox(urls, startIndex) {
      lbUrls = urls;
      lbIndex = startIndex || 0;
      updateLightbox();
      lightbox.classList.add('open');
    }

    function closeLightbox() {
      lightbox.classList.remove('open');
      lbImg.src = '';
      resetView();
    }

    // Размер картинки известен только после загрузки — тогда и считаем вписывание
    lbImg.addEventListener('load', applyTransform);
    window.addEventListener('resize', () => {
      if (lightbox.classList.contains('open')) applyTransform();
    });

    lbPrev.addEventListener('click', e => {
      e.stopPropagation();
      if (lbIndex > 0) { lbIndex--; updateLightbox(); }
    });
    lbNext.addEventListener('click', e => {
      e.stopPropagation();
      if (lbIndex < lbUrls.length - 1) { lbIndex++; updateLightbox(); }
    });
    lbClose.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });

    btnRotateL.addEventListener('click', e => { e.stopPropagation(); rotateBy(-90); });
    btnRotateR.addEventListener('click', e => { e.stopPropagation(); rotateBy(90); });
    btnZoomIn.addEventListener('click', e => { e.stopPropagation(); setZoom(zoom * CFG.zoom.step); });
    btnZoomOut.addEventListener('click', e => { e.stopPropagation(); setZoom(zoom / CFG.zoom.step); });
    zoomLabel.addEventListener('click', e => { e.stopPropagation(); resetView(); });

    // ── Масштабирование колесом мыши ─────────────────────────────────

    lightbox.addEventListener('wheel', e => {
      if (!lightbox.classList.contains('open')) return;
      // Иначе прокрутится страница под лайтбоксом
      e.preventDefault();
      const { x, y } = stageCenterOffset(e);
      setZoom(e.deltaY < 0 ? zoom * CFG.zoom.step : zoom / CFG.zoom.step, x, y);
    }, { passive: false });

    // ── Перетаскивание увеличенной картинки ──────────────────────────

    let dragging = false;
    let dragMoved = false;
    let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

    lbImg.addEventListener('mousedown', e => {
      if (zoom <= 1) return;
      e.preventDefault();
      dragging = true;
      dragMoved = false;
      dragStart = { x: e.clientX, y: e.clientY, panX: panX, panY: panY };
      lbImg.classList.add('dragging');
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
      panX = dragStart.panX + dx;
      panY = dragStart.panY + dy;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      lbImg.classList.remove('dragging');
    });

    lightbox.addEventListener('click', e => {
      // Если мышь отпустили за пределами картинки после перетаскивания,
      // клик всплывает до фона — закрывать лайтбокс в этом случае не нужно
      if (dragMoved) { dragMoved = false; return; }
      if (e.target === lightbox) closeLightbox();
    });

    lbImg.addEventListener('dblclick', e => { e.stopPropagation(); resetView(); });

    document.addEventListener('keydown', e => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft' && lbIndex > 0) { lbIndex--; updateLightbox(); }
      if (e.key === 'ArrowRight' && lbIndex < lbUrls.length - 1) { lbIndex++; updateLightbox(); }
    });

    // ── Разбор ссылок ────────────────────────────────────────────────

    function getExt(path) {
      return (path.split('?')[0].split('.').pop() || '').toLowerCase();
    }

    function getFileName(path) {
      try {
        return decodeURIComponent(path.split('?')[0].split('/').pop() || path);
      } catch (e) {
        return path.split('?')[0].split('/').pop() || path;
      }
    }

    function isImage(path) { return CFG.imageExts.includes(getExt(path)); }
    function isVideo(path) { return CFG.videoExts.includes(getExt(path)); }
    function isPdf(path) { return getExt(path) === 'pdf'; }
    function isPreviewable(path) { return isImage(path) || isPdf(path) || isVideo(path); }

    // Ссылка может вести на вьюер вида /viewer?url=<реальный путь>.
    // Тип файла определяем по реальному пути, а открываем — исходную ссылку.
    function resolveFileUrl(anchor) {
      const href = anchor.getAttribute('href') || '';
      try {
        const abs = new URL(href, window.location.origin);
        const urlParam = abs.searchParams.get('url');
        if (urlParam) return { previewUrl: href, filePath: decodeURIComponent(urlParam) };
      } catch (e) { /* относительный или битый href — используем как есть */ }
      return { previewUrl: href, filePath: href };
    }

    // Все картинки из той же ячейки — чтобы листать их в полноэкранном режиме
    function getCellImageUrls(anchor) {
      const td = anchor.closest('td');
      if (!td) return [];
      return Array.from(td.querySelectorAll('a'))
        .map(a => resolveFileUrl(a))
        .filter(({ filePath }) => isImage(filePath))
        .map(({ previewUrl }) => previewUrl);
    }

    // ── Сборка попапа ────────────────────────────────────────────────

    function makeActions(anchor, previewUrl, withFullscreen) {
      const bar = document.createElement('div');
      bar.className = 'th-preview-actions';

      if (withFullscreen) {
        const btnFull = document.createElement('button');
        btnFull.className = 'th-preview-btn';
        btnFull.innerHTML = `${ICON_FULLSCREEN} Fullscreen`;
        btnFull.addEventListener('click', e => {
          e.stopPropagation();
          const urls = getCellImageUrls(anchor);
          const startIdx = urls.indexOf(previewUrl);
          openLightbox(urls.length ? urls : [previewUrl], startIdx >= 0 ? startIdx : 0);
        });
        bar.appendChild(btnFull);
      }

      const btnTab = document.createElement('a');
      btnTab.className = 'th-preview-btn';
      btnTab.href = previewUrl;
      btnTab.target = '_blank';
      btnTab.rel = 'noopener noreferrer';
      btnTab.innerHTML = `${ICON_NEW_TAB} Open in new tab`;
      bar.appendChild(btnTab);

      return bar;
    }

    function makeFileRow(icon, fileName) {
      const wrap = document.createElement('div');
      wrap.className = 'th-preview-file-wrap';
      wrap.innerHTML = icon;
      const name = document.createElement('span');
      name.className = 'th-preview-file-name';
      name.textContent = fileName;
      wrap.appendChild(name);
      return wrap;
    }

    let currentHref = null;
    let currentAnchor = null;
    let hideTimer = null;
    // Счётчик поколений: если мышь ушла на другую ссылку, пока грузилась картинка,
    // её onload не должен подставить чужое изображение в попап.
    let loadGeneration = 0;

    function positionPopup() {
      if (!currentAnchor) return;
      const rect = currentAnchor.getBoundingClientRect();
      const popW = popup.offsetWidth || CFG.maxWidth;
      const popH = popup.offsetHeight || 300;

      // Пробуем справа от ссылки, если не влезает — слева
      let left = rect.right + 12;
      if (left + popW > window.innerWidth - 12) left = rect.left - popW - 12;

      const pos = clampToViewport(left, rect.top, popW, popH, 12);
      popup.style.left = pos.left + 'px';
      popup.style.top = pos.top + 'px';
    }

    function buildPopup(anchor) {
      popup.innerHTML = '';
      const { previewUrl, filePath } = resolveFileUrl(anchor);

      if (isImage(filePath)) {
        popup.appendChild(makeActions(anchor, previewUrl, true));

        const loading = document.createElement('div');
        loading.className = 'th-preview-loading';
        loading.textContent = 'Loading...';
        popup.appendChild(loading);

        const myGeneration = ++loadGeneration;
        const img = new Image();
        img.onload = () => {
          if (myGeneration !== loadGeneration) return;
          loading.remove();
          popup.appendChild(img);
          positionPopup();
        };
        img.onerror = () => {
          if (myGeneration !== loadGeneration) return;
          loading.textContent = 'Не удалось загрузить файл';
        };
        img.src = previewUrl;

      } else if (isPdf(filePath)) {
        popup.appendChild(makeActions(anchor, previewUrl, false));
        popup.appendChild(makeFileRow(ICON_PDF, getFileName(filePath)));

      } else if (isVideo(filePath)) {
        popup.appendChild(makeActions(anchor, previewUrl, false));
        popup.appendChild(makeFileRow(ICON_VIDEO, getFileName(filePath)));
      }
    }

    function showPopup(anchor) {
      const href = anchor.getAttribute('href') || '';
      if (!href) return;
      const { filePath } = resolveFileUrl(anchor);
      if (!isPreviewable(filePath)) return;

      clearTimeout(hideTimer);
      currentAnchor = anchor;

      if (href !== currentHref) {
        currentHref = href;
        buildPopup(anchor);
        positionPopup();
      }

      popup.classList.add('visible');
    }

    function hidePopup() {
      hideTimer = setTimeout(() => {
        popup.classList.remove('visible');
        loadGeneration++;
        currentHref = null;
        currentAnchor = null;
        setTimeout(() => {
          if (!popup.classList.contains('visible')) popup.innerHTML = '';
        }, 150);
      }, CFG.hideDelay);
    }

    // Пока мышь на самом попапе — не прячем, иначе до кнопок не дойти
    popup.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    popup.addEventListener('mouseleave', hidePopup);

    document.addEventListener('mouseover', e => {
      const anchor = e.target instanceof Element ? e.target.closest('td a') : null;
      if (anchor) showPopup(anchor);
    });

    document.addEventListener('mouseout', e => {
      const anchor = e.target instanceof Element ? e.target.closest('td a') : null;
      if (anchor) hidePopup();
    });

    log('Превью вложений включено');
  }

  // ==================================================================
  // 2. ТУЛТИП «ПРЕДЫДУЩИЙ СТАТУС»
  // ==================================================================

  function initPrevStatus() {
    const CFG = CONFIG.prevStatus;
    const TRIGGERS = new Set(CFG.triggers.map(s => s.trim().toLowerCase()));

    addStyle('th-helper-prevstatus-style', `
      #th-prevstatus-tt {
        position: fixed;
        z-index: 100000;
        max-width: 260px;
        background: ${T.bg};
        border: .5px solid ${T.border};
        border-radius: 8px;
        padding: 8px 11px;
        font-size: 11px;
        line-height: 1.5;
        color: ${T.text};
        box-shadow: ${T.shadow};
        opacity: 0;
        pointer-events: none;
        transition: opacity .12s;
      }
      #th-prevstatus-tt.show { opacity: 1; }
      #th-prevstatus-tt .th-pst-label {
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: ${T.textDim};
        margin-bottom: 3px;
      }
      #th-prevstatus-tt .th-pst-value {
        font-weight: 600;
        color: ${T.textStrong};
      }
      #th-prevstatus-tt .th-pst-date {
        color: ${T.textDim};
        margin-top: 3px;
        font-size: 10.5px;
      }
    `);

    const tt = document.createElement('div');
    tt.id = 'th-prevstatus-tt';
    document.body.appendChild(tt);

    // ticketId -> Promise<{status, date} | null>. Один запрос на тикет за сессию.
    const cache = new Map();

    function render(valueHtml, dateHtml) {
      tt.innerHTML =
        `<div class="th-pst-label">Предыдущий статус</div>` +
        `<div class="th-pst-value">${valueHtml}</div>` +
        (dateHtml ? `<div class="th-pst-date">${dateHtml}</div>` : '');
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fetchHistory(ticketId) {
      if (cache.has(ticketId)) return cache.get(ticketId);

      const p = fetch(CFG.historyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ ticketId: Number(ticketId), is_iframe: 1 }),
      })
        .then(r => r.json())
        .then(json => {
          const list = Array.isArray(json && json.data) ? json.data : [];
          // История идёт от новых к старым: находим запись о закрытии
          // и берём следующую за ней — это и есть статус до закрытия.
          const idx = list.findIndex(r => TRIGGERS.has((r.nameExternalStatus || '').trim().toLowerCase()));
          if (idx === -1 || idx + 1 >= list.length) return null;
          const prev = list[idx + 1];
          return { status: prev.nameExternalStatus || '—', date: prev.dateEdit || '' };
        })
        .catch(err => {
          log('Не удалось получить историю тикета', ticketId, err);
          return null;
        });

      cache.set(ticketId, p);
      return p;
    }

    // Индексы колонок в конкретной таблице
    function getColumnIndexes(table) {
      const headers = Array.from(table.querySelectorAll('thead th'));
      return {
        status: headers.findIndex(h => h.innerText.trim().toLowerCase() === 'external status'),
        ticket: headers.findIndex(h => h.innerText.trim().toLowerCase().includes('ticket id')),
      };
    }

    let hideTimer = null;
    let currentTicket = null;

    document.addEventListener('mouseover', e => {
      const td = e.target instanceof Element ? e.target.closest('td') : null;
      if (!td) return;

      const table = td.closest('table');
      const row = td.closest('tr');
      if (!table || !row) return;

      const cols = getColumnIndexes(table);
      if (cols.status === -1 || cols.ticket === -1) return;
      if (td.cellIndex !== cols.status) return;

      const statusText = ((td.querySelector('span') || {}).innerText || td.innerText || '').trim().toLowerCase();
      if (!TRIGGERS.has(statusText)) return;

      const ticketCell = row.querySelectorAll('td')[cols.ticket];
      if (!ticketCell) return;
      const ticketId = ((ticketCell.querySelector('span') || {}).innerText || ticketCell.innerText || '').trim();
      if (!ticketId) return;

      clearTimeout(hideTimer);
      currentTicket = ticketId;

      render('Загрузка…');
      tt.classList.add('show');
      placeNearCursor(tt, e.clientX, e.clientY);

      fetchHistory(ticketId).then(result => {
        // Пока грузилось, мышь могла уйти на другой тикет
        if (currentTicket !== ticketId) return;
        if (result) {
          render(escapeHtml(result.status), escapeHtml(result.date));
        } else {
          render('Не найдено');
        }
        placeNearCursor(tt, e.clientX, e.clientY);
      });
    });

    document.addEventListener('mousemove', e => {
      if (tt.classList.contains('show')) placeNearCursor(tt, e.clientX, e.clientY);
    });

    document.addEventListener('mouseout', e => {
      const td = e.target instanceof Element ? e.target.closest('td') : null;
      if (!td) return;
      hideTimer = setTimeout(() => {
        tt.classList.remove('show');
        currentTicket = null;
      }, CFG.hideDelay);
    });

    log('Тултип «Предыдущий статус» включён для статусов:', CFG.triggers.join(', '));
  }

  // ==================================================================
  // 3. ПОИСК ЛИМИТОВ В CONFLUENCE
  // ==================================================================

  function initLimitsFinder() {
    const CFG = CONFIG.limitsFinder;

    addStyle('th-helper-limits-style', `
      #th-lim-popup {
        position: fixed;
        z-index: 999999;
        display: none;
        flex-direction: column;
        background: ${T.bg};
        border: 1px solid ${T.border};
        border-radius: 10px;
        box-shadow: ${T.shadow};
        font-family: "Open Sans", Tahoma, Arial, sans-serif;
        font-size: 12px;
        color: ${T.text};
        width: ${CFG.width}px;
        max-height: calc(100vh - 32px);
        overflow: visible;
        clip-path: inset(0 round 10px);
        animation: th-lim-appear .16s cubic-bezier(0.34, 1.4, 0.64, 1) both;
        transform-origin: top center;
      }
      @keyframes th-lim-appear {
        from { opacity: 0; transform: scale(0.88) translateY(-4px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      #th-lim-popup.th-lim-hiding { animation: th-lim-vanish .1s ease both; }
      @keyframes th-lim-vanish {
        to { opacity: 0; transform: scale(0.94) translateY(-3px); }
      }

      #th-lim-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 12px 8px;
        background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_HOVER} 100%);
        flex-shrink: 0;
      }
      #th-lim-header-icon {
        width: 22px; height: 22px;
        border-radius: 5px;
        background: rgba(255,255,255,0.2);
        color: #fff;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      #th-lim-header-icon svg { width: 12px; height: 12px; }
      #th-lim-header-text { flex: 1; min-width: 0; }
      #th-lim-label {
        font-size: 9px; font-weight: 700;
        letter-spacing: .08em; text-transform: uppercase;
        color: rgba(255,255,255,0.8);
        margin-bottom: 1px;
      }
      #th-lim-query {
        font-size: 11.5px; font-weight: 600; color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #th-lim-open {
        color: rgba(255,255,255,0.7);
        text-decoration: none;
        flex-shrink: 0;
        display: flex; align-items: center;
        transition: color .1s;
      }
      #th-lim-open:hover { color: #fff; }
      #th-lim-open svg { width: 13px; height: 13px; }

      #th-lim-state {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 14px;
        font-size: 11.5px;
        color: ${T.textDim};
      }
      #th-lim-state.loading { color: ${ACCENT}; }
      #th-lim-state svg { width: 15px; height: 15px; flex-shrink: 0; }

      #th-lim-nav {
        display: none;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: ${T.panel};
        border-bottom: 1px solid ${T.border};
        flex-shrink: 0;
      }
      #th-lim-counter { flex: 1; font-size: 11px; font-weight: 600; color: ${T.textDim}; }
      #th-lim-counter b { color: ${T.text}; }
      .th-lim-nav-btn {
        width: 24px; height: 24px;
        border-radius: 5px;
        border: 1px solid ${T.border};
        background: ${T.bg};
        color: ${T.text};
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        padding: 0;
        transition: background .1s, border-color .1s;
      }
      .th-lim-nav-btn:hover { background: ${T.panel}; }
      .th-lim-nav-btn svg { width: 11px; height: 11px; }

      #th-lim-heading {
        display: none;
        align-items: center;
        gap: 6px;
        padding: 7px 12px 6px;
        background: rgba(42,191,207,0.07);
        border-bottom: 1px solid rgba(42,191,207,0.15);
        font-size: 11px;
        font-weight: 700;
        color: ${ACCENT_HOVER};
        line-height: 1.3;
      }
      #th-lim-heading svg { width: 11px; height: 11px; flex-shrink: 0; opacity: .7; }

      #th-lim-result {
        display: none;
        flex-direction: column;
        overflow-y: auto;
        overscroll-behavior: contain;
        min-height: 0;
        flex: 1 1 auto;
      }
      #th-lim-result::-webkit-scrollbar { width: 4px; }
      #th-lim-result::-webkit-scrollbar-track { background: transparent; }
      #th-lim-result::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
      .th-lim-row { display: flex; border-bottom: 1px solid ${T.border}; }
      .th-lim-row:last-child { border-bottom: none; }
      .th-lim-col-label {
        width: 110px;
        flex-shrink: 0;
        padding: 7px 10px;
        background: ${T.panel};
        border-right: 1px solid ${T.border};
        font-size: 10px;
        font-weight: 700;
        color: ${T.textDim};
        text-transform: uppercase;
        letter-spacing: .05em;
        line-height: 1.3;
        word-break: break-word;
        display: flex;
        align-items: flex-start;
      }
      .th-lim-col-value {
        flex: 1;
        padding: 7px 10px;
        font-size: 11.5px;
        color: ${T.text};
        line-height: 1.45;
        word-break: break-word;
        min-width: 0;
      }
      .th-lim-hl {
        background: #fde047;
        color: #1c1917;
        border-radius: 2px;
        padding: 0 1px;
        font-weight: 700;
      }
      /* Зачёркнутые строки таблицы означают отменённый лимит */
      .th-lim-row.striked .th-lim-col-value {
        color: ${T.textDim};
        text-decoration: line-through;
      }
      .th-lim-row.striked .th-lim-col-label { opacity: .6; }

      #th-lim-arrow {
        position: fixed;
        z-index: 999998;
        display: none;
        pointer-events: none;
        width: 12px; height: 7px;
      }
    `);

    const popup = document.createElement('div');
    popup.id = 'th-lim-popup';
    popup.innerHTML = `
      <div id="th-lim-header">
        <div id="th-lim-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
        <div id="th-lim-header-text">
          <div id="th-lim-label">Лимиты</div>
          <div id="th-lim-query">…</div>
        </div>
        <a id="th-lim-open" target="_blank" rel="noopener" title="Открыть страницу Confluence">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>

      <div id="th-lim-state">
        <svg id="th-lim-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
        <span id="th-lim-state-text"></span>
      </div>

      <div id="th-lim-nav">
        <span id="th-lim-counter"></span>
        <button class="th-lim-nav-btn" id="th-lim-prev" title="Предыдущий (стрелка влево)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="th-lim-nav-btn" id="th-lim-next" title="Следующий (стрелка вправо)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div id="th-lim-heading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/>
          <line x1="3" y1="18" x2="18" y2="18"/>
        </svg>
        <span id="th-lim-heading-text"></span>
      </div>
      <div id="th-lim-result"></div>
    `;
    document.body.appendChild(popup);
    popup.querySelector('#th-lim-open').href = CFG.pageUrl;

    const arrow = document.createElement('div');
    arrow.id = 'th-lim-arrow';
    arrow.innerHTML = `<svg width="12" height="7" viewBox="0 0 12 7">
      <path id="th-lim-arrow-path" d="M6 0L12 7H0Z" fill="${T.bg}"/></svg>`;
    document.body.appendChild(arrow);

    const stateEl = popup.querySelector('#th-lim-state');
    const stateIcon = popup.querySelector('#th-lim-state-icon');
    const stateText = popup.querySelector('#th-lim-state-text');
    const navEl = popup.querySelector('#th-lim-nav');
    const counterEl = popup.querySelector('#th-lim-counter');
    const headingEl = popup.querySelector('#th-lim-heading');
    const headingText = popup.querySelector('#th-lim-heading-text');
    const resultEl = popup.querySelector('#th-lim-result');
    const queryEl = popup.querySelector('#th-lim-query');

    let results = [];
    let curIdx = 0;
    let currentText = '';
    let hideTimer = null;

    // ── Загрузка страницы Confluence ─────────────────────────────────

    // Страница на другом домене, поэтому обычный fetch её не возьмёт:
    // нужен GM_xmlhttpRequest вместе с @connect в шапке. Запасной путь
    // через fetch оставлен для отладки вне Tampermonkey.
    function requestPage(url) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            timeout: CFG.timeout,
            onload: r => resolve(r.responseText),
            onerror: () => reject(new Error('network')),
            ontimeout: () => reject(new Error('timeout')),
          });
          return;
        }
        fetch(url, { credentials: 'include' })
          .then(r => r.text())
          .then(resolve, reject);
      });
    }

    // Один запрос на всю сессию. Параллельные вызовы получают тот же
    // промис, а после ошибки кэш сбрасывается, чтобы можно было повторить.
    let pagePromise = null;
    function loadPage() {
      if (!pagePromise) {
        pagePromise = requestPage(CFG.pageUrl)
          .then(html => new DOMParser().parseFromString(html, 'text/html'))
          .catch(err => { pagePromise = null; throw err; });
      }
      return pagePromise;
    }

    // ── Разбор страницы ──────────────────────────────────────────────

    // Ближайший заголовок выше таблицы: он говорит, к какому разделу
    // лимитов относится найденная строка
    function findHeadingBefore(table, doc) {
      const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4'));
      let best = null;
      for (const h of headings) {
        if (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
      }
      if (!best) return null;
      const clone = best.cloneNode(true);
      clone.querySelectorAll('.copy-heading-link-container, button, .aui-icon, [aria-label]')
        .forEach(n => n.remove());
      return clone.textContent.trim().replace(/\s+/g, ' ');
    }

    function searchTables(doc, query) {
      const q = query.trim().toLowerCase();
      const found = [];

      doc.querySelectorAll('table').forEach(table => {
        const headers = [];
        const theadCells = table.querySelectorAll('thead td, thead th');
        if (theadCells.length) {
          theadCells.forEach(th => headers.push(th.textContent.trim()));
        } else {
          const firstRow = table.querySelector('tr');
          if (firstRow) {
            firstRow.querySelectorAll('td, th').forEach(c => headers.push(c.textContent.trim()));
          }
        }

        const heading = findHeadingBefore(table, doc);

        table.querySelectorAll('tbody tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (!cells.length) return;
          // Совпадение ищем только в первом столбце: там имя субагента
          if (!cells[0].textContent.trim().toLowerCase().includes(q)) return;

          const cellData = [];
          cells.forEach((td, i) => {
            cellData.push({ label: headers[i] || `Столбец ${i + 1}`, html: td.innerHTML });
          });

          found.push({
            cells: cellData,
            striked: !!cells[0].querySelector('s'),
            raw: cells[0].textContent.trim(),
            heading: heading,
          });
        });
      });

      return found;
    }

    // ── Отрисовка ────────────────────────────────────────────────────

    function escHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escRx(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlight(text, query) {
      const q = query.trim();
      if (!q) return escHtml(text);
      return escHtml(text).replace(new RegExp(escRx(q), 'gi'), m => `<span class="th-lim-hl">${m}</span>`);
    }

    // Из разметки Confluence оставляем читаемый текст с переносами
    function cleanHtml(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      div.querySelectorAll('.tj-source, .tj-hidden').forEach(el => el.remove());
      div.querySelectorAll('p').forEach(p => p.insertAdjacentText('afterend', '\n'));
      div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      return div.textContent.trim().replace(/\n{3,}/g, '\n\n');
    }

    function renderResult(idx) {
      const res = results[idx];
      resultEl.innerHTML = '';

      if (res.heading) {
        headingText.textContent = res.heading;
        headingEl.style.display = 'flex';
      } else {
        headingEl.style.display = 'none';
      }

      res.cells.forEach((cell, i) => {
        const text = i === 0 ? res.raw : cleanHtml(cell.html);
        if (!text.trim()) return;

        const row = document.createElement('div');
        row.className = 'th-lim-row' + (res.striked ? ' striked' : '');

        const label = document.createElement('div');
        label.className = 'th-lim-col-label';
        label.textContent = cell.label;

        const value = document.createElement('div');
        value.className = 'th-lim-col-value';
        if (i === 0) {
          value.innerHTML = highlight(text, currentText);
        } else {
          value.style.whiteSpace = 'pre-line';
          value.textContent = text;
        }

        row.appendChild(label);
        row.appendChild(value);
        resultEl.appendChild(row);
      });

      resultEl.style.display = 'flex';
      requestAnimationFrame(() => { resultEl.scrollTop = 0; });
    }

    function renderNav() {
      if (results.length > 1) {
        navEl.style.display = 'flex';
        counterEl.innerHTML = `<b>${curIdx + 1}</b> из <b>${results.length}</b>`;
      } else {
        navEl.style.display = 'none';
      }
    }

    function showState(kind, text, iconMarkup) {
      stateEl.className = kind;
      stateEl.style.display = 'flex';
      stateIcon.innerHTML = iconMarkup;
      stateText.textContent = text;
      resultEl.style.display = 'none';
      navEl.style.display = 'none';
      headingEl.style.display = 'none';
    }

    const ICON_SPINNER = '<circle cx="12" cy="12" r="9" stroke-dasharray="28 57" stroke-linecap="round">'
      + '<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12"'
      + ' dur="0.9s" repeatCount="indefinite"/></circle>';
    const ICON_EMPTY = '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/>'
      + '<line x1="12" y1="16" x2="12.01" y2="16"/>';
    const ICON_ERROR = '<circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/>'
      + '<line x1="9" y1="9" x2="15" y2="15"/>';

    async function runSearch(query) {
      currentText = query.trim();
      queryEl.textContent = currentText.length > 36 ? currentText.slice(0, 36) + '…' : currentText;

      showState('loading', 'Загружаю страницу…', ICON_SPINNER);

      try {
        const doc = await loadPage();
        results = searchTables(doc, currentText);
        curIdx = 0;

        if (!results.length) {
          showState('empty', `«${currentText}» не найдено на странице`, ICON_EMPTY);
          return;
        }

        stateEl.style.display = 'none';
        renderResult(curIdx);
        renderNav();
      } catch (e) {
        log('Не удалось загрузить страницу Confluence', e);
        showState('empty', 'Ошибка загрузки страницы Confluence', ICON_ERROR);
      }
    }

    // ── Позиционирование ─────────────────────────────────────────────

    function place(rect) {
      popup.style.display = 'flex';
      popup.classList.remove('th-lim-hiding');

      const gap = 10;
      const margin = 8;
      const maxH = window.innerHeight - margin * 2;
      popup.style.maxHeight = maxH + 'px';

      const pw = popup.offsetWidth || CFG.width;
      const ph = Math.min(popup.offsetHeight || 80, maxH);

      let left = rect.left + rect.width / 2 - pw / 2;
      if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
      if (left < margin) left = margin;

      // Сначала пробуем над выделением, потом под ним, иначе прижимаем к верху
      let top = rect.top - ph - gap;
      let below = false;
      if (top < margin) {
        const topIfBelow = rect.bottom + gap;
        if (topIfBelow + ph <= window.innerHeight - margin) {
          top = topIfBelow;
          below = true;
        } else {
          top = margin;
        }
      }

      popup.style.left = left + 'px';
      popup.style.top = top + 'px';

      const ax = Math.min(Math.max(rect.left + rect.width / 2 - 6, left + 12), left + pw - 18);
      const path = document.getElementById('th-lim-arrow-path');
      if (path) path.setAttribute('fill', below ? ACCENT : T.bg);
      arrow.style.left = ax + 'px';
      arrow.style.top = (below ? top - 7 : top + ph) + 'px';
      arrow.querySelector('svg').style.transform = below ? 'rotate(0deg)' : 'rotate(180deg)';
      arrow.style.display = 'block';
    }

    function show(text, rect) {
      clearTimeout(hideTimer);
      place(rect);
      // После загрузки высота меняется, поэтому позицию считаем ещё раз
      runSearch(text).then(() => place(rect));
    }

    function hide() {
      clearTimeout(hideTimer);
      if (popup.style.display === 'none') return;
      popup.classList.add('th-lim-hiding');
      arrow.style.display = 'none';
      hideTimer = setTimeout(() => {
        popup.style.display = 'none';
        popup.classList.remove('th-lim-hiding');
        resultEl.style.display = 'none';
        navEl.style.display = 'none';
        stateEl.style.display = 'none';
        headingEl.style.display = 'none';
        results = [];
        curIdx = 0;
      }, 110);
    }

    // ── Определение нужной колонки ───────────────────────────────────

    function cellInTargetColumn(node) {
      const td = node && node.closest ? node.closest('td') : null;
      if (!td) return null;
      const tr = td.closest('tr');
      const table = td.closest('table');
      if (!tr || !table) return null;
      const headers = table.querySelectorAll('thead th');
      const idx = Array.from(tr.children).indexOf(td);
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].textContent.trim().toLowerCase().includes(CFG.column)) {
          return i === idx ? td : null;
        }
      }
      return null;
    }

    function elementOf(node) {
      if (!node) return null;
      return node.nodeType === 3 ? node.parentElement : node;
    }

    // ── События ──────────────────────────────────────────────────────

    document.getElementById('th-lim-prev').addEventListener('click', () => {
      curIdx = (curIdx - 1 + results.length) % results.length;
      renderResult(curIdx);
      renderNav();
    });
    document.getElementById('th-lim-next').addEventListener('click', () => {
      curIdx = (curIdx + 1) % results.length;
      renderResult(curIdx);
      renderNav();
    });

    document.addEventListener('mouseup', e => {
      if (popup.contains(e.target)) return;
      // Выделение появляется не мгновенно после отпускания кнопки
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) { hide(); return; }
        const text = sel.toString().trim();
        if (!text) { hide(); return; }
        const a = elementOf(sel.anchorNode);
        const f = elementOf(sel.focusNode);
        if (!cellInTargetColumn(a) && !cellInTargetColumn(f)) { hide(); return; }
        show(text, sel.getRangeAt(0).getBoundingClientRect());
      }, 15);
    });

    document.addEventListener('mousedown', e => {
      if (popup.contains(e.target) || arrow.contains(e.target)) return;
      hide();
    });

    document.addEventListener('keydown', e => {
      if (popup.style.display === 'none') return;
      if (e.key === 'Escape') { hide(); return; }
      if (results.length > 1) {
        if (e.key === 'ArrowLeft') document.getElementById('th-lim-prev').click();
        if (e.key === 'ArrowRight') document.getElementById('th-lim-next').click();
      }
    });

    document.addEventListener('scroll', e => {
      if (popup.contains(e.target)) return;
      hide();
    }, { passive: true, capture: true });

    // Прогреваем кэш, пока оператор только наводит мышь на колонку
    document.addEventListener('mouseover', e => {
      const el = elementOf(e.target);
      if (cellInTargetColumn(el)) loadPage().catch(() => {});
    }, { passive: true });

    log('Поиск лимитов включён, страница:', CFG.pageUrl);
  }

  // ==================================================================
  // 4. АВТОПОДСТАНОВКА ДИАПАЗОНА ДАТ
  // ==================================================================

  function initAutoDateRange() {
    const CFG = CONFIG.autoDateRange;

    function pad(n) { return String(n).padStart(2, '0'); }

    function fmt(d) {
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // «Примерно год назад → сегодня». Дата «от» — точка «год назад» плюс
    // случайный сдвиг вперёд из CFG.shiftDays; новый сдвиг на каждое
    // нажатие Apply. Минимальный сдвиг в 1 день заодно гарантирует, что
    // диапазон не выйдет за годовое окно.
    function getDateRange() {
      const now = new Date();

      const end = new Date(now);
      end.setHours(CFG.endTime[0], CFG.endTime[1], 0, 0);

      const [minShift, maxShift] = CFG.shiftDays;
      const shift = minShift + Math.floor(Math.random() * (maxShift - minShift + 1));

      const start = new Date(now);
      start.setFullYear(start.getFullYear() - CFG.yearsBack);
      start.setDate(start.getDate() + shift);
      start.setHours(CFG.startTime[0], CFG.startTime[1], 0, 0);

      return `${fmt(start)} ~ ${fmt(end)}`;
    }

    function findDateInput() {
      return document.querySelector('.mx-datepicker-range .mx-input')
        || document.querySelector('.mx-datepicker .mx-input')
        || document.querySelector('input.mx-input[name="date"]')
        || document.querySelector('input.mx-input');
    }

    // Значение ставим нативным сеттером — иначе Vue не заметит изменение
    function setDatepickerValue(input, value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function trySetDate() {
      const input = findDateInput();
      if (!input) return false;
      const value = getDateRange();
      setDatepickerValue(input, value);
      log('Диапазон дат подставлен:', value);
      return true;
    }

    // Кнопка Apply в модалке сохранённых фильтров
    function isApplyButton(el) {
      if (!el) return false;
      const isSuccess = el.classList.contains('btn-success');
      const isSubmit = el.type === 'submit';
      const textMatch = el.textContent.trim() === 'Apply';
      const inModal = !!el.closest('.modal_content, .wrap-white');
      return isSuccess && (isSubmit || textMatch) && inModal;
    }

    document.addEventListener('click', e => {
      const btn = e.target instanceof Element ? e.target.closest('button') : null;
      if (!isApplyButton(btn)) return;

      log('Нажат Apply — ждём перерисовку фильтров');

      setTimeout(() => {
        if (trySetDate()) return;
        // Поле ещё не отрисовано — пробуем, пока не появится
        const interval = setInterval(() => {
          if (trySetDate()) clearInterval(interval);
        }, CFG.retryInterval);
        setTimeout(() => clearInterval(interval), CFG.retryTimeout);
      }, CFG.applyDelay);
    }, true);

    log('Автоподстановка дат включена');
  }

  // ==================================================================
  // 5. ПОДСТАНОВКА REDDY ID
  // ==================================================================

  // Хранилище Tampermonkey переживает обновления скрипта и общее для всех
  // трёх доменов. Откат на localStorage нужен только для отладки вне
  // расширения, где GM-функций нет.
  const store = {
    get(key, fallback) {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const v = localStorage.getItem('th-helper:' + key);
      return v === null ? fallback : v;
    },
    set(key, value) {
      if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; }
      localStorage.setItem('th-helper:' + key, value);
    },
  };

  // Буфер обмена — используется несколькими независимо переключаемыми
  // функциями (копирование данных тикета, копирование значения ячейки),
  // поэтому вынесено сюда, а не дублируется в каждой из них.
  function copyTextFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) { /* браузер запретил — текст остаётся в поле */ }
    ta.remove();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    }
    return Promise.resolve(copyTextFallback(text));
  }

  function initMessengerId() {
    const CFG = CONFIG.messengerId;

    // Reddy ID лежит в серверной разметке страницы на компоненте leftpanel.
    // К моменту запуска скрипта Vue уже заменил этот элемент собой,
    // поэтому из DOM атрибут не достать — забираем исходный HTML страницы.
    function fetchIdFromPage() {
      return fetch(location.href, { credentials: 'same-origin' })
        .then(r => r.text())
        .then(html => {
          const m = html.match(new RegExp(CFG.sourceAttr + '="([^"]*)"'));
          return m && m[1] ? m[1].trim() : null;
        })
        .catch(err => {
          log('Не удалось получить ID со страницы', err);
          return null;
        });
    }

    // Один раз найденный ID сохраняется, дальше берётся из хранилища
    // мгновенно и без запроса.
    let idPromise = null;
    function resolveId() {
      const saved = store.get(CFG.storageKey, '');
      if (saved) return Promise.resolve(saved);
      if (!idPromise) {
        idPromise = fetchIdFromPage().then(id => {
          if (id) {
            store.set(CFG.storageKey, id);
            log('Reddy ID определён со страницы:', id);
          } else {
            // Пустой профиль или другая разметка: пусть попробует снова,
            // а оператор при желании задаст ID через меню расширения
            idPromise = null;
            log('Reddy ID на странице не найден, задайте его через меню Tampermonkey');
          }
          return id;
        });
      }
      return idPromise;
    }

    // Пункт меню нужен на случай, когда в профиле Reddy не заполнен
    // или ID надо поменять руками (например, чтобы временно подставлять
    // чужой ID вместо своего).
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Team Helper: мой Reddy ID', () => {
        const current = store.get(CFG.storageKey, '');
        const next = prompt(
          'Reddy ID для подстановки.\n'
          + 'Оставьте поле пустым, чтобы скрипт определил его со страницы заново.',
          current
        );
        if (next === null) return;
        store.set(CFG.storageKey, next.trim());
        idPromise = null;
        alert(next.trim()
          ? 'Reddy ID сохранён: ' + next.trim()
          : 'Reddy ID очищен, он будет определён со страницы автоматически.');
      });
    }

    // Прогреваем значение заранее, чтобы подстановка была мгновенной
    resolveId();

    // ── Подстановка в модалку SweetAlert2 ─────────────────────────────
    //
    // Поле не имеет id/name, поэтому ищем его по классу и плейсхолдеру —
    // это устойчиво к тому, какая именно кнопка открыла модалку.
    // Заполняем только если поле пустое: если оператор уже что-то ввёл
    // (например, чтобы отправить файл коллеге), скрипт это не трогает.
    // Флаг на самом элементе защищает от повторной обработки одного и
    // того же поля при последующих срабатываниях наблюдателя, а новая
    // модалка каждый раз создаёт новый DOM-элемент, так что для неё
    // подстановка сработает снова.
    function trySubstituteField(input) {
      if (input.dataset.thFilled) return;
      if (input.value.trim()) { input.dataset.thFilled = '1'; return; }
      resolveId().then(id => {
        if (!id) return;
        if (input.dataset.thFilled) return;
        if (!document.body.contains(input)) return; // модалку уже закрыли
        if (input.value.trim()) { input.dataset.thFilled = '1'; return; }
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, id);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dataset.thFilled = '1';
        log('Reddy ID подставлен в поле:', id);
      });
    }

    const fieldSelector = `input.swal2-input[placeholder="${CFG.fieldPlaceholder}"]`;
    new MutationObserver(() => {
      const input = document.querySelector(fieldSelector);
      if (input) trySubstituteField(input);
    }).observe(document.body, { childList: true, subtree: true });

    log('Подстановка Reddy ID включена');
  }

  // ==================================================================
  // 6. СПРАВОЧНИК АДМИНОВ
  // ==================================================================

  function initAdminDirectory() {
    const CFG = CONFIG.adminDirectory;

    addStyle('th-helper-admindir-style', `
      #th-admin-tt {
        position: fixed;
        z-index: 100000;
        max-width: 260px;
        background: ${T.bg};
        border: .5px solid ${T.border};
        border-radius: 8px;
        padding: 8px 11px;
        font-size: 11px;
        line-height: 1.5;
        color: ${T.text};
        box-shadow: ${T.shadow};
        opacity: 0;
        pointer-events: none;
        transition: opacity .12s;
      }
      #th-admin-tt.show { opacity: 1; }
      #th-admin-tt .th-adm-label {
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: ${T.textDim};
        margin-bottom: 3px;
      }
      #th-admin-tt .th-adm-login {
        font-weight: 600;
        color: ${T.textStrong};
      }
      #th-admin-tt .th-adm-divider {
        border: none;
        border-top: .5px solid ${T.border};
        margin: 6px 0;
      }
      #th-admin-tt .th-adm-name {
        font-weight: 600;
        color: ${T.textStrong};
      }
      #th-admin-tt .th-adm-dept {
        color: ${T.textDim};
        margin-top: 2px;
        font-size: 10.5px;
      }
      #th-admin-tt .th-adm-missing,
      #th-admin-tt .th-adm-loading {
        color: ${T.textDim};
        font-style: italic;
      }
    `);

    const tt = document.createElement('div');
    tt.id = 'th-admin-tt';
    document.body.appendChild(tt);

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Страница на другом домене — нужен GM_xmlhttpRequest вместе с @connect
    // в шапке. Тот же грант уже используется поиском лимитов, новый не
    // требуется. Запасной путь через fetch — для отладки вне Tampermonkey.
    function requestPage(url) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            timeout: CFG.timeout,
            onload: r => resolve(r.responseText),
            onerror: () => reject(new Error('network')),
            ontimeout: () => reject(new Error('timeout')),
          });
          return;
        }
        fetch(url, { credentials: 'include' })
          .then(r => r.text())
          .then(resolve, reject);
      });
    }

    // Ожидаемый формат страницы: одна таблица, три столбца в фиксированном
    // порядке — логин | имя | отдел. Столбцы читаются по позиции, а не
    // по названию заголовка, поэтому шапку таблицы можно оформить как угодно.
    function collectTables(doc) {
      const tables = Array.from(doc.querySelectorAll('table'));
      // HTML-макрос Confluence вставляет вложенный HTML как
      // <iframe srcdoc="...">, а не как обычные узлы в DOM страницы —
      // в исходнике это просто экранированная строка-атрибут, её нужно
      // распарсить отдельным DOMParser'ом, чтобы добраться до таблицы.
      doc.querySelectorAll('iframe[srcdoc]').forEach(frame => {
        const srcdoc = frame.getAttribute('srcdoc');
        if (!srcdoc) return;
        const inner = new DOMParser().parseFromString(srcdoc, 'text/html');
        tables.push(...collectTables(inner));
      });
      return tables;
    }

    function parseDirectory(doc) {
      const map = new Map();
      // Страница Confluence не гарантированно содержит только одну таблицу
      // (макросы, панели свойств и т.п. могут добавить свои перед таблицей
      // с данными) — читаем все и сливаем в одну карту.
      collectTables(doc).forEach(table => {
        table.querySelectorAll('tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) return; // строка заголовка обычно из th, сюда не попадёт
          const login = cells[0].textContent.trim();
          if (!login) return;
          map.set(login, {
            name: cells[1].textContent.trim(),
            department: cells[2].textContent.trim(),
          });
        });
      });

      return map;
    }

    // Справочник грузится один раз за сессию, дальше все наведения — это
    // мгновенный поиск в уже загруженной карте, без обращений к серверу.
    let dirPromise = null;
    function loadDirectory() {
      if (!dirPromise) {
        dirPromise = requestPage(CFG.pageUrl)
          .then(html => {
            const map = parseDirectory(new DOMParser().parseFromString(html, 'text/html'));
            if (map.size === 0) {
              log('Справочник админов загружен, но не удалось разобрать ни одной строки — проверьте разметку страницы Confluence');
            }
            return map;
          })
          .catch(err => {
            dirPromise = null;
            log('Не удалось загрузить справочник админов', err);
            throw err;
          });
      }
      return dirPromise;
    }

    function render(login, state, entry) {
      const header = `<div class="th-adm-label">Admin username</div>`
        + `<div class="th-adm-login">${escapeHtml(login)}</div>`
        + `<hr class="th-adm-divider">`;
      if (state === 'loading') { tt.innerHTML = header + `<span class="th-adm-loading">Загрузка…</span>`; return; }
      if (state === 'error')   { tt.innerHTML = header + `<span class="th-adm-missing">Ошибка загрузки справочника</span>`; return; }
      if (state === 'none')    { tt.innerHTML = header + `<span class="th-adm-missing">Не найден в справочнике</span>`; return; }
      tt.innerHTML = header
        + `<div class="th-adm-name">${escapeHtml(entry.name)}</div>`
        + (entry.department ? `<div class="th-adm-dept">${escapeHtml(entry.department)}</div>` : '');
    }

    // Таблица в окне «История тикета» не оборачивает шапку в <thead> —
    // строка заголовка это <tr class="table-head">, поэтому ищем и там,
    // и в <thead> на случай, если колонка встретится в таблице другого типа.
    function getAdminColIndex(table) {
      const headers = Array.from(table.querySelectorAll('tr.table-head th, thead th'));
      return headers.findIndex(h => h.textContent.trim().toLowerCase() === CFG.column);
    }

    let hideTimer = null;
    let currentLogin = null;

    document.addEventListener('mouseover', e => {
      const td = e.target instanceof Element ? e.target.closest('td') : null;
      if (!td) return;

      const table = td.closest('table');
      if (!table) return;

      const colIdx = getAdminColIndex(table);
      if (colIdx === -1 || td.cellIndex !== colIdx) return;

      const login = td.textContent.trim();
      if (!login) return;

      clearTimeout(hideTimer);
      currentLogin = login;

      render(login, 'loading');
      tt.classList.add('show');
      placeNearCursor(tt, e.clientX, e.clientY);

      loadDirectory().then(map => {
        // Пока грузилось, мышь могла уйти на другой логин
        if (currentLogin !== login) return;
        const entry = map.get(login);
        render(login, entry ? 'found' : 'none', entry);
        placeNearCursor(tt, e.clientX, e.clientY);
      }).catch(() => {
        if (currentLogin !== login) return;
        render(login, 'error');
        placeNearCursor(tt, e.clientX, e.clientY);
      });
    });

    document.addEventListener('mousemove', e => {
      if (tt.classList.contains('show')) placeNearCursor(tt, e.clientX, e.clientY);
    });

    document.addEventListener('mouseout', e => {
      const td = e.target instanceof Element ? e.target.closest('td') : null;
      if (!td) return;
      hideTimer = setTimeout(() => {
        tt.classList.remove('show');
        currentLogin = null;
      }, CFG.hideDelay);
    });

    log('Справочник админов включён, страница:', CFG.pageUrl);
  }

  // ==================================================================
  // 7. КОПИРОВАНИЕ ДАННЫХ ТИКЕТА
  // ==================================================================

  function initTicketCopy() {
    const CFG = CONFIG.ticketCopy;

    addStyle('th-helper-ticketcopy-style', `
      .th-tc-open-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 6px 0;
        padding: 6px 14px;
        border: none;
        border-radius: 6px;
        background: ${ACCENT};
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: .02em;
        transition: background .15s;
      }
      .th-tc-open-btn:hover { background: ${ACCENT_HOVER}; }

      #th-tc-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(0,0,0,0.5);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }
      #th-tc-overlay.show { display: flex; }

      #th-tc-modal {
        width: 420px;
        max-width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        background: ${T.bg};
        border: 1px solid ${T.border};
        border-radius: 10px;
        box-shadow: ${T.shadow};
        font-family: "Open Sans", Tahoma, Arial, sans-serif;
        font-size: 12px;
        color: ${T.text};
      }
      #th-tc-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_HOVER} 100%);
        border-radius: 10px 10px 0 0;
      }
      #th-tc-header-icon {
        width: 26px; height: 26px;
        border-radius: 6px;
        background: rgba(255,255,255,0.2);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      #th-tc-header-text { flex: 1; min-width: 0; }
      #th-tc-title { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.3; }
      #th-tc-subtitle {
        font-size: 10.5px; color: rgba(255,255,255,0.8); margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      #th-tc-body { padding: 14px 16px; }
      .th-tc-section-label {
        font-size: 10px; font-weight: 700; color: ${T.textDim};
        text-transform: uppercase; letter-spacing: .05em; margin-bottom: 7px;
      }
      .th-tc-options { display: flex; flex-direction: column; gap: 6px; }
      .th-tc-option {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 11px;
        border: 1px solid ${T.border};
        border-radius: 7px;
        background: ${T.bg};
        color: ${T.text};
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        box-sizing: border-box;
        transition: border-color .12s, background .12s;
      }
      .th-tc-option:hover { border-color: ${ACCENT}; }
      .th-tc-option.selected { border-color: ${ACCENT}; background: rgba(42,191,207,0.08); }
      .th-tc-opt-label { font-weight: 600; }
      .th-tc-choices {
        display: none;
        flex-direction: column;
        gap: 8px;
        margin-top: 9px;
        padding-top: 9px;
        border-top: 1px dashed ${T.border};
      }
      .th-tc-choices.visible { display: flex; }
      .th-tc-choice-block { display: flex; flex-direction: column; gap: 4px; }
      .th-tc-choice-title {
        font-size: 10px; color: ${T.textDim}; font-weight: 600;
        text-transform: uppercase; letter-spacing: .04em;
      }
      .th-tc-choice-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .th-tc-choice-btn {
        padding: 4px 11px;
        border: 1px solid ${T.border};
        border-radius: 999px;
        background: ${T.panel};
        color: ${T.text};
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        transition: background .12s, border-color .12s, color .12s;
      }
      .th-tc-choice-btn:hover { border-color: ${ACCENT}; }
      .th-tc-choice-btn.active { background: ${ACCENT}; border-color: ${ACCENT}; color: #fff; font-weight: 600; }

      .th-tc-preview-wrap { margin-top: 12px; border: 1px solid ${T.border}; border-radius: 7px; overflow: hidden; }
      .th-tc-preview-label {
        padding: 5px 10px; background: ${T.panel}; font-size: 10px; font-weight: 700;
        color: ${T.textDim}; text-transform: uppercase; letter-spacing: .06em;
        border-bottom: 1px solid ${T.border};
      }
      .th-tc-preview-text {
        margin: 0; padding: 9px 11px; background: ${T.bg}; font-size: 12px; color: ${T.text};
        line-height: 1.6; white-space: pre-wrap; word-break: break-word; font-family: inherit;
      }
      .th-tc-missing {
        margin-top: 10px; padding: 8px 11px; border-radius: 6px;
        background: rgba(226,75,74,0.08); border: 1px solid rgba(226,75,74,0.35);
        color: #E24B4A; font-size: 11px; line-height: 1.5;
      }

      #th-tc-footer {
        display: flex; gap: 8px; justify-content: flex-end;
        padding: 12px 16px; border-top: 1px solid ${T.border};
      }
      #th-tc-back {
        padding: 6px 16px; border-radius: 6px; font-size: 12px; font-family: inherit; font-weight: 500;
        cursor: pointer; border: 1px solid ${T.border}; background: ${T.panel}; color: ${T.text};
      }
      #th-tc-back:hover { opacity: .85; }
      #th-tc-copy {
        padding: 6px 18px; border-radius: 6px; font-size: 12px; font-family: inherit; font-weight: 600;
        cursor: pointer; border: none; background: ${ACCENT}; color: #fff;
        display: flex; align-items: center; gap: 5px;
      }
      #th-tc-copy:hover { background: ${ACCENT_HOVER}; }
      #th-tc-copy.copied { background: #3fb950; }

      .th-tc-history-cell {
        position: relative;
        padding-right: 30px;
      }
      .th-tc-row-btn {
        position: absolute;
        top: 50%;
        right: 4px;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 5px;
        background: ${ACCENT};
        color: #fff;
        cursor: pointer;
        z-index: 1;
        transition: background .12s;
      }
      .th-tc-row-btn:hover { background: ${ACCENT_HOVER}; }
      .th-tc-row-btn.copied { background: #3fb950; }
    `);

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ── Поиск полей в форме тикета ──────────────────────────────────
    // Портировано из скрипта коллег (Team B), уже проверено в проде
    // на этом же сайте.

    function ticketModalRoot(el) {
      return (el && el.closest && el.closest('.modal_content, .modal_wrap'))
          || document.querySelector('.modal_content, .modal_wrap[role="dialog"]')
          || document;
    }

    // Заголовки приходят с &nbsp;, разным регистром и разными апострофами
    // (User's wallet / User’s wallet) — сравниваем по нормализованному виду.
    function normTitle(text) {
      return (text || '')
        .replace(/ /g, ' ')
        .replace(/[’‘`´]/g, "'")
        .replace(/:\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    // Ищем сначала в переданном корне, а если не нашли — по всему
    // документу: открытая форма редактирования всё равно одна.
    function findGroup(root, title) {
      const wanted = normTitle(title);
      const scopes = root === document ? [document] : [root, document];
      for (const scope of scopes) {
        for (const group of scope.querySelectorAll('.input-group')) {
          const t = group.querySelector('.title');
          if (t && normTitle(t.textContent) === wanted) return group;
        }
      }
      return null;
    }

    function inputValueByTitle(root, title) {
      const group = findGroup(root, title);
      if (!group) return '';
      const inp = group.querySelector('input.mx-input, input[type="text"]:not(.multiselect__input)');
      return inp ? inp.value.trim() : '';
    }

    function selectValueByTitle(root, title) {
      const group = findGroup(root, title);
      if (!group) return '';
      const single = group.querySelector('.multiselect__single');
      return single ? single.textContent.trim() : '';
    }

    // Шапка тикета: <span class="success-txt"><strong>User ID:</strong> 889142155</span>
    function headerValue(root, label) {
      const wanted = normTitle(label);
      const scopes = root === document ? [document] : [root, document];
      for (const scope of scopes) {
        for (const sp of scope.querySelectorAll('.success-txt')) {
          const strong = sp.querySelector('strong');
          if (!strong || normTitle(strong.textContent) !== wanted) continue;
          const value = sp.textContent.replace(strong.textContent, '').trim();
          if (value) return value;
        }
      }
      return '';
    }

    function collectTicketData(root) {
      const F = CFG.fields;
      return {
        subagent: selectValueByTitle(root, F.subagent) || headerValue(root, F.subagent),
        userId: headerValue(root, F.userId) || inputValueByTitle(root, F.userId),
        amount: inputValueByTitle(root, F.amount),
        date: inputValueByTitle(root, F.date),
        agentWallet: inputValueByTitle(root, F.agentWallet),
        userWallet: inputValueByTitle(root, F.userWallet),
        recipientDepartment: selectValueByTitle(root, F.recipientDepartment),
        transactionId: inputValueByTitle(root, F.transactionId) || headerValue(root, F.transactionId),
        uniqueTransferNumber: inputValueByTitle(root, F.uniqueTransferNumber),
        agent: selectValueByTitle(root, F.agent) || headerValue(root, F.agent),
      };
    }

    function buildTicketText(data, comment) {
      const v = (x) => x || CFG.emptyPlaceholder;
      const head = comment ? `${v(data.subagent)} // ${comment}` : v(data.subagent);
      return [
        head,
        `User ID: ${v(data.userId)}`,
        `Amount: ${v(data.amount)}`,
        `Time of deposit: ${v(data.date)}`,
        `Agent wallet: ${v(data.agentWallet)}`,
        `User Wallet number: ${v(data.userWallet)}`,
        `Recipient department: ${v(data.recipientDepartment)}`,
        `Transaction ID: ${v(data.transactionId)}`,
        `Unique transfer number: ${v(data.uniqueTransferNumber)}`,
        `Agent: ${v(data.agent)}`,
      ].join('\n');
    }

    function missingFields(data) {
      const F = CFG.fields;
      return [
        [F.subagent, data.subagent],
        [F.userId, data.userId],
        [F.amount, data.amount],
        [F.date, data.date],
        [F.agentWallet, data.agentWallet],
        [F.userWallet, data.userWallet],
        [F.recipientDepartment, data.recipientDepartment],
        [F.transactionId, data.transactionId],
        [F.uniqueTransferNumber, data.uniqueTransferNumber],
        [F.agent, data.agent],
      ].filter(([, value]) => !value).map(([label]) => label);
    }

    // "Change ticket no.20538044" — единственный div.title в форме,
    // остальные заголовки полей лежат в span.title.
    function getModalSubtitle(root) {
      const titleEl = Array.from(root.querySelectorAll('div.title'))
        .find(t => /change ticket/i.test(t.textContent));
      return titleEl ? titleEl.textContent.trim() : '';
    }

    // ── Модалка «Данные тикета» ─────────────────────────────────────
    // copyText/copyTextFallback теперь общие — см. секцию 5.

    const overlay = document.createElement('div');
    overlay.id = 'th-tc-overlay';
    overlay.innerHTML = '<div id="th-tc-modal"></div>';
    document.body.appendChild(overlay);
    const modalEl = overlay.querySelector('#th-tc-modal');

    let state = null; // { data, subtitle, commentIdx, choiceValues }
    let copiedTimer = null;

    function resolveComment() {
      const option = CFG.comments[state.commentIdx];
      if (!option || !option.template) return null;
      const values = {};
      (option.choices || []).forEach(ch => {
        values[ch.key] = state.choiceValues[ch.key] || ch.options[0];
      });
      return option.template(values);
    }

    function renderModal() {
      const comment = resolveComment();
      const text = buildTicketText(state.data, comment);
      const missing = missingFields(state.data);

      const optionsHtml = CFG.comments.map((option, i) => {
        const selected = i === state.commentIdx;
        let choicesHtml = '';
        if (option.choices) {
          choicesHtml = `<div class="th-tc-choices${selected ? ' visible' : ''}">`
            + option.choices.map(ch => {
              const current = state.choiceValues[ch.key] || ch.options[0];
              return `<div class="th-tc-choice-block">`
                + `<span class="th-tc-choice-title">${escapeHtml(ch.title)}</span>`
                + `<div class="th-tc-choice-row">`
                + ch.options.map(opt => `<button type="button" class="th-tc-choice-btn${opt === current ? ' active' : ''}" data-choice-key="${escapeHtml(ch.key)}" data-choice-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')
                + `</div></div>`;
            }).join('')
            + `</div>`;
        }
        return `<div class="th-tc-option${selected ? ' selected' : ''}" role="button" tabindex="0" data-option-idx="${i}">`
          + `<div class="th-tc-opt-label">${escapeHtml(option.label)}</div>`
          + choicesHtml
          + `</div>`;
      }).join('');

      const missingHtml = missing.length
        ? `<div class="th-tc-missing">⚠ Не заполнено: <strong>${escapeHtml(missing.join(', '))}</strong></div>`
        : '';

      modalEl.innerHTML = `
        <div id="th-tc-header">
          <div id="th-tc-header-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </div>
          <div id="th-tc-header-text">
            <div id="th-tc-title">Данные тикета</div>
            <div id="th-tc-subtitle">${escapeHtml(state.subtitle)}</div>
          </div>
        </div>
        <div id="th-tc-body">
          <div class="th-tc-section-label">Комментарий</div>
          <div class="th-tc-options">${optionsHtml}</div>
          <div class="th-tc-preview-wrap">
            <div class="th-tc-preview-label">Что будет скопировано</div>
            <pre class="th-tc-preview-text">${escapeHtml(text)}</pre>
          </div>
          ${missingHtml}
        </div>
        <div id="th-tc-footer">
          <button type="button" id="th-tc-back">← Назад</button>
          <button type="button" id="th-tc-copy">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Копировать
          </button>
        </div>
      `;
    }

    function closeModal() {
      overlay.classList.remove('show');
      state = null;
      if (copiedTimer) { clearTimeout(copiedTimer); copiedTimer = null; }
    }

    function openModal(root) {
      state = {
        data: collectTicketData(root),
        subtitle: getModalSubtitle(root),
        commentIdx: 0,
        choiceValues: {},
      };
      renderModal();
      overlay.classList.add('show');
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (!state) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    });

    modalEl.addEventListener('click', (e) => {
      const choiceBtn = e.target.closest('.th-tc-choice-btn');
      if (choiceBtn) {
        e.preventDefault(); e.stopPropagation();
        state.choiceValues[choiceBtn.dataset.choiceKey] = choiceBtn.dataset.choiceValue;
        renderModal();
        return;
      }
      const optionBtn = e.target.closest('.th-tc-option');
      if (optionBtn) {
        e.preventDefault(); e.stopPropagation();
        state.commentIdx = Number(optionBtn.dataset.optionIdx);
        renderModal();
        return;
      }
      const backBtn = e.target.closest('#th-tc-back');
      if (backBtn) {
        e.preventDefault(); e.stopPropagation();
        closeModal();
        return;
      }
      const copyBtn = e.target.closest('#th-tc-copy');
      if (copyBtn) {
        e.preventDefault(); e.stopPropagation();
        const text = buildTicketText(state.data, resolveComment());
        copyText(text).then(() => {
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Скопировано`;
          if (copiedTimer) clearTimeout(copiedTimer);
          copiedTimer = setTimeout(() => {
            if (state) renderModal();
          }, 1500);
        });
        return;
      }
    });

    // ── Вставка кнопки в форму тикета ───────────────────────────────

    function getOpenTicketModal() {
      const modals = document.querySelectorAll('.modal_wrap[role="dialog"]');
      for (const m of modals) {
        if (window.getComputedStyle(m).display !== 'none') return m;
      }
      return null;
    }

    function buildOpenButton() {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'th-tc-open-btn';
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Данные тикета`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(ticketModalRoot(btn));
      });
      return btn;
    }

    // .input-group хранит флаг, чтобы не вставлять кнопку повторно —
    // при следующем открытии формы это уже новый DOM-узел, флаг сам
    // сбрасывается (тот же приём, что и thFilled в подстановке Reddy ID).
    function injectButton() {
      const modal = getOpenTicketModal();
      if (!modal) return;
      const group = findGroup(modal, CFG.anchorField);
      if (!group || group.dataset.thTicketCopyInjected) return;
      const titleEl = group.querySelector('.title');
      if (!titleEl) return;
      titleEl.insertAdjacentElement('afterend', buildOpenButton());
      group.dataset.thTicketCopyInjected = '1';
    }

    injectButton();
    new MutationObserver(injectButton).observe(document.body, { childList: true, subtree: true });

    // ── Кнопка в строке обычной таблицы: копирует сразу, без модалки ─

    // По образцу getFileColIndexes из initFileButtons — та же шапка
    // таблицы (tr.table-head внутри thead). normTitle уже определён выше
    // в этой функции.
    function getRowColIndexes(table) {
      const headers = Array.from(table.querySelectorAll('tr.table-head th, thead th'));
      const cols = {};
      headers.forEach((h, i) => {
        const norm = normTitle(h.textContent);
        Object.keys(CFG.tableFields).forEach(key => {
          if (normTitle(CFG.tableFields[key]) === norm) cols[key] = i;
        });
        if (norm === normTitle(CFG.tableRowButtonColumn)) cols.__rowBtn = i;
      });
      return cols;
    }

    function collectRowData(row, cols) {
      const data = {};
      Object.keys(CFG.tableFields).forEach(key => {
        const cell = cols[key] === undefined ? null : row.children[cols[key]];
        data[key] = cell ? cell.textContent.trim() : '';
      });
      return data;
    }

    const rowBtnIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const rowBtnCheckIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

    function buildRowButton(row, cols) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'th-tc-row-btn';
      btn.title = 'Копировать данные тикета';
      btn.innerHTML = rowBtnIcon;
      let copiedTimer2 = null;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = buildTicketText(collectRowData(row, cols), null);
        copyText(text).then(() => {
          btn.classList.add('copied');
          btn.innerHTML = rowBtnCheckIcon;
          if (copiedTimer2) clearTimeout(copiedTimer2);
          copiedTimer2 = setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = rowBtnIcon;
          }, 1500);
        });
      });
      return btn;
    }

    function processRowButtonsTable(table) {
      const cols = getRowColIndexes(table);
      if (cols.__rowBtn === undefined) return;

      table.querySelectorAll('tbody tr').forEach(row => {
        const cell = row.children[cols.__rowBtn];
        if (!cell || cell.dataset.thRowCopyInjected) return;
        cell.dataset.thRowCopyInjected = '1';
        // Кнопка позиционируется абсолютно (см. .th-tc-history-cell) —
        // выведена из потока текста, поэтому никогда не переносится на
        // отдельную строку рядом со ссылкой Show, независимо от ширины
        // колонки
        cell.classList.add('th-tc-history-cell');
        cell.appendChild(buildRowButton(row, cols));
      });
    }

    function processAllRowButtons() {
      document.querySelectorAll('table').forEach(processRowButtonsTable);
    }

    processAllRowButtons();
    new MutationObserver(processAllRowButtons).observe(document.body, { childList: true, subtree: true });

    log('Копирование данных тикета включено');
  }

  // ==================================================================
  // 8. КНОПКИ ВМЕСТО ССЫЛОК НА ФАЙЛЫ
  // ==================================================================

  function initFileButtons() {
    const CFG = CONFIG.fileButtons;

    addStyle('th-helper-filebtn-style', `
      .th-file-cell { white-space: normal !important; }

      a.th-file-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 80px;
        min-height: 30px;
        margin: 2px 3px 2px 0;
        padding: 3px 5px;
        border-radius: 6px;
        background: ${ACCENT};
        color: #fff !important;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.2;
        text-decoration: none !important;
        white-space: nowrap;
        cursor: pointer;
        transition: background .12s;
      }
      a.th-file-btn:hover { background: ${ACCENT_HOVER}; }
    `);

    // Заголовки приходят с разным регистром, лишними пробелами и разными
    // апострофами (Agent's files / Agent’s files) — сравниваем по
    // нормализованному виду. Неразрывный пробел отдельно обрабатывать не
    // нужно: \s в JS его уже покрывает.
    function normHeader(text) {
      return (text || '')
        .replace(/[’‘`´]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    // Возвращает набор индексов колонок с файлами. В этой админке шапка
    // бывает и в <thead>, и в <tr class="table-head"> — учитываем оба.
    function getFileColIndexes(table) {
      const headers = Array.from(table.querySelectorAll('tr.table-head th, thead th'));
      const indexes = new Set();
      headers.forEach((h, i) => {
        if (CFG.columns.includes(normHeader(h.textContent))) indexes.add(i);
      });
      return indexes;
    }

    // Ссылка ведёт на вьюер вида /admin/amazon/?url=<реальный путь>.
    // Тип файла и имя определяем по реальному пути, а href не трогаем.
    function resolveFilePath(anchor) {
      const href = anchor.getAttribute('href') || '';
      try {
        const abs = new URL(href, window.location.origin);
        const urlParam = abs.searchParams.get('url');
        if (urlParam) return urlParam.split('?')[0];
        return decodeURIComponent(abs.pathname);
      } catch (e) {
        return href.split('?')[0];
      }
    }

    function getExt(path) {
      const name = path.split('/').pop() || '';
      const m = name.match(/\.([a-z0-9]+)$/i);
      return m ? m[1].toLowerCase() : '';
    }

    function labelForExt(ext) {
      for (const label of Object.keys(CFG.types)) {
        if (CFG.types[label].includes(ext)) return label;
      }
      return CFG.fallbackLabel;
    }

    // Флаг на самой ссылке защищает от повторной обработки: без него
    // наблюдатель переписывал бы «1. Скрин» в «1. 1. Скрин» и вызывал
    // новые мутации по кругу.
    function decorate(anchor, number) {
      if (anchor.dataset.thFileBtn) return;

      const path = resolveFilePath(anchor);
      const fileName = path.split('/').pop() || path;

      anchor.textContent = `${number}. ${labelForExt(getExt(path))}`;
      anchor.title = fileName ? `Открыть: ${fileName}` : 'Открыть файл';
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.classList.add('th-file-btn');
      anchor.dataset.thFileBtn = '1';
    }

    function fileAnchors(cell) {
      return Array.from(cell.querySelectorAll('a[href]')).filter(a => {
        const href = a.getAttribute('href') || '';
        return href && !href.toLowerCase().startsWith('javascript:');
      });
    }

    function processTable(table) {
      const cols = getFileColIndexes(table);
      if (!cols.size) return;

      table.querySelectorAll('tr').forEach(row => {
        Array.from(row.children).forEach(cell => {
          if (cell.tagName !== 'TD' || !cols.has(cell.cellIndex)) return;
          const anchors = fileAnchors(cell);
          if (!anchors.length) return;
          cell.classList.add('th-file-cell');
          // Нумерация идёт по порядку ссылок в ячейке, чтобы номера на
          // кнопках совпадали с тем, что оператор видит слева направо.
          anchors.forEach((a, i) => decorate(a, i + 1));
        });
      });
    }

    function processAll() {
      document.querySelectorAll('table').forEach(processTable);
    }

    processAll();
    new MutationObserver(processAll).observe(document.body, { childList: true, subtree: true });

    log('Кнопки вместо ссылок на файлы включены');
  }

  // ==================================================================
  // 9. КОПИРОВАНИЕ ЗНАЧЕНИЯ ЯЧЕЙКИ
  // ==================================================================

  function initCellCopy() {
    addStyle('th-helper-cellcopy-style', `
      .th-cc-cell {
        position: relative;
        padding-right: 20px;
      }
      .th-cc-btn {
        position: absolute;
        top: 50%;
        right: 2px;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: ${T.textDim};
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        z-index: 1;
        transition: opacity .1s, color .1s, background .1s;
      }
      .th-cc-cell:hover .th-cc-btn {
        opacity: 1;
        pointer-events: auto;
      }
      .th-cc-btn:hover { background: ${ACCENT}; color: #fff; }
      .th-cc-btn.copied { background: #3fb950; color: #fff; opacity: 1; pointer-events: auto; }
    `);

    const ccIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const ccCheckIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

    // Только ячейки с обычным текстом — ячейки со своими ссылками/кнопками
    // (Ticket history, файлы) пропускаем: копировать там нечего или
    // непонятно что
    function isPlainCell(cell) {
      if (cell.querySelector('a, button')) return false;
      return !!cell.textContent.trim();
    }

    function buildCellButton(value) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'th-cc-btn';
      btn.title = 'Копировать';
      btn.innerHTML = ccIcon;
      let copiedTimer = null;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyText(value).then(() => {
          btn.classList.add('copied');
          btn.innerHTML = ccCheckIcon;
          if (copiedTimer) clearTimeout(copiedTimer);
          copiedTimer = setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = ccIcon;
          }, 1200);
        });
      });
      return btn;
    }

    function processCellsTable(table) {
      table.querySelectorAll('tbody tr').forEach(row => {
        Array.from(row.children).forEach(cell => {
          if (cell.tagName !== 'TD' || cell.dataset.thCellCopyInjected) return;
          cell.dataset.thCellCopyInjected = '1';
          if (!isPlainCell(cell)) return;
          // Значение берём до вставки кнопки — её иконка (svg) в
          // textContent не попадает, но так надёжнее
          const value = cell.textContent.trim();
          // Кнопка позиционируется абсолютно (см. .th-cc-cell) — выведена
          // из потока текста, поэтому никогда не переносится на отдельную
          // строку независимо от ширины колонки
          cell.classList.add('th-cc-cell');
          cell.appendChild(buildCellButton(value));
        });
      });
    }

    function processAllCells() {
      document.querySelectorAll('table').forEach(processCellsTable);
    }

    processAllCells();
    new MutationObserver(processAllCells).observe(document.body, { childList: true, subtree: true });

    log('Копирование значения ячейки при наведении включено');
  }

  // ==================================================================
  // ПАНЕЛЬ НАСТРОЕК: ВКЛЮЧЕНИЕ И ВЫКЛЮЧЕНИЕ ФУНКЦИЙ БЕЗ ПРАВКИ КОДА
  // ==================================================================

  // Порядок и подписи держим синхронно с CONFIG.features
  const FEATURE_LABELS = {
    filePreview: 'Превью вложений',
    prevStatus: 'Предыдущий статус',
    limitsFinder: 'Поиск лимитов в Confluence',
    adminDirectory: 'Справочник админов',
    messengerId: 'Автоподстановка Reddy ID',
    autoDateRange: 'Автоподстановка дат',
    ticketCopy: 'Копирование данных тикета',
    fileButtons: 'Кнопки вместо ссылок на файлы',
    cellCopy: 'Копирование значения ячейки при наведении',
  };

  // CONFIG.features задаёт дефолт при первом запуске; панель настроек и
  // пункт меню Tampermonkey пишут поверх него через store — переживает
  // обновления скрипта и общее для всех трёх доменов.
  function isFeatureEnabled(name) {
    return store.get('feature:' + name, CONFIG.features[name] ? '1' : '0') === '1';
  }

  function initSettingsPanel() {
    addStyle('th-helper-settings-style', `
      #th-settings-btn {
        position: fixed;
        left: 20px;
        bottom: 20px;
        z-index: 100000;
        width: 40px;
        height: 40px;
        border: 1px solid ${T.border};
        border-radius: 50%;
        background: ${T.panel};
        color: ${T.textDim};
        font-size: 18px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: ${T.shadow};
        opacity: .55;
        transition: opacity .15s, color .15s, border-color .15s;
      }
      #th-settings-btn:hover {
        opacity: 1;
        color: ${ACCENT};
        border-color: ${ACCENT};
      }

      #th-settings-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(0,0,0,0.5);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
      }
      #th-settings-overlay.show { display: flex; }

      #th-settings-panel {
        width: 360px;
        max-width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        background: ${T.bg};
        border: 1px solid ${T.border};
        border-radius: 10px;
        box-shadow: ${T.shadow};
        font-family: "Open Sans", Tahoma, Arial, sans-serif;
        font-size: 12px;
        color: ${T.text};
      }
      #th-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid ${T.border};
      }
      #th-settings-title {
        font-size: 13px;
        font-weight: 700;
        color: ${T.textStrong};
      }
      #th-settings-close {
        border: none;
        background: transparent;
        color: ${T.textDim};
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        padding: 0 4px;
      }
      #th-settings-close:hover { color: ${T.textStrong}; }

      #th-settings-body { padding: 4px 16px; }

      .th-settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 0;
        border-bottom: 1px solid ${T.border};
        cursor: pointer;
      }
      .th-settings-row:last-child { border-bottom: none; }
      .th-settings-row-label { color: ${T.text}; }

      .th-toggle {
        position: relative;
        display: inline-block;
        flex: 0 0 auto;
        width: 36px;
        height: 20px;
      }
      .th-toggle-input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        cursor: pointer;
        z-index: 1;
      }
      .th-toggle-track {
        position: absolute;
        inset: 0;
        background: ${T.border};
        border-radius: 999px;
        transition: background .15s;
      }
      .th-toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.3);
        transition: transform .15s;
      }
      .th-toggle-input:checked + .th-toggle-track { background: ${ACCENT}; }
      .th-toggle-input:checked + .th-toggle-track .th-toggle-thumb { transform: translateX(16px); }

      #th-settings-notice {
        display: none;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 12px 16px 14px;
        padding: 8px 10px;
        border-radius: 6px;
        background: ${T.panel};
        border: 1px solid ${T.border};
        color: ${T.textDim};
        font-size: 11px;
      }
      #th-settings-notice.show { display: flex; }
      #th-settings-reload {
        flex: 0 0 auto;
        border: none;
        border-radius: 6px;
        background: ${ACCENT};
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        padding: 5px 12px;
        cursor: pointer;
        transition: background .15s;
      }
      #th-settings-reload:hover { background: ${ACCENT_HOVER}; }
    `);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'th-settings-btn';
    btn.title = 'Настройки Team Helper';
    btn.textContent = '⚙';
    document.body.appendChild(btn);

    const rowsHtml = Object.keys(FEATURE_LABELS).map(name => `
      <label class="th-settings-row">
        <span class="th-settings-row-label">${FEATURE_LABELS[name]}</span>
        <span class="th-toggle">
          <input type="checkbox" class="th-toggle-input" data-feature="${name}">
          <span class="th-toggle-track"><span class="th-toggle-thumb"></span></span>
        </span>
      </label>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'th-settings-overlay';
    overlay.innerHTML = `
      <div id="th-settings-panel">
        <div id="th-settings-header">
          <div id="th-settings-title">Team Helper — настройки</div>
          <button type="button" id="th-settings-close" aria-label="Закрыть">×</button>
        </div>
        <div id="th-settings-body">${rowsHtml}</div>
        <div id="th-settings-notice">
          <span>Изменения вступят в силу после обновления страницы.</span>
          <button type="button" id="th-settings-reload">Обновить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const notice = overlay.querySelector('#th-settings-notice');
    const checkboxes = Array.from(overlay.querySelectorAll('.th-toggle-input'));

    function openPanel() {
      checkboxes.forEach(cb => { cb.checked = isFeatureEnabled(cb.dataset.feature); });
      notice.classList.remove('show');
      overlay.classList.add('show');
    }

    function closePanel() {
      overlay.classList.remove('show');
    }

    btn.addEventListener('click', () => {
      if (overlay.classList.contains('show')) closePanel(); else openPanel();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePanel();
    });

    overlay.querySelector('#th-settings-close').addEventListener('click', closePanel);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) closePanel();
    });

    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        store.set('feature:' + cb.dataset.feature, cb.checked ? '1' : '0');
        notice.classList.add('show');
      });
    });

    overlay.querySelector('#th-settings-reload').addEventListener('click', () => {
      location.reload();
    });

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Team Helper: Настройки', openPanel);
    }

    log('Панель настроек готова');
  }

  // ==================================================================
  // ЗАПУСК
  // ==================================================================

  function start() {
    initSettingsPanel();
    if (isFeatureEnabled('filePreview')) initFilePreview();
    if (isFeatureEnabled('prevStatus')) initPrevStatus();
    if (isFeatureEnabled('limitsFinder')) initLimitsFinder();
    if (isFeatureEnabled('adminDirectory')) initAdminDirectory();
    if (isFeatureEnabled('messengerId')) initMessengerId();
    if (isFeatureEnabled('autoDateRange')) initAutoDateRange();
    if (isFeatureEnabled('ticketCopy')) initTicketCopy();
    if (isFeatureEnabled('fileButtons')) initFileButtons();
    if (isFeatureEnabled('cellCopy')) initCellCopy();
    log('Скрипт запущен на', window.location.pathname);
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

})();
