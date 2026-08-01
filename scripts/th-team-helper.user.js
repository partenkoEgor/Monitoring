// ==UserScript==
// @name         TH Management — Team Helper
// @namespace    th-management-team-helper
// @version      1.0
// @description  Три помощника в одном скрипте: превью вложений при наведении с полноэкранным просмотром, тултип «Предыдущий статус» для закрытых тикетов и автоподстановка диапазона дат в фильтр. Каждая функция включается и выключается отдельно в блоке CONFIG.
// @match        https://th-managment.com/en/admin/backoffice/paymentsupport*
// @match        https://my-managment.com/en/admin/backoffice/paymentsupport*
// @match        https://managment.io/en/admin/backoffice/paymentsupport*
// @match        https://th-managment.com/en/admin/backoffice/ExtendedPaymentRequestList*
// @match        https://my-managment.com/en/admin/backoffice/ExtendedPaymentRequestList*
// @match        https://managment.io/en/admin/backoffice/ExtendedPaymentRequestList*
// @match        https://th-managment.com/en/admin/report/requestrefill*
// @match        https://my-managment.com/en/admin/report/requestrefill*
// @match        https://managment.io/en/admin/report/requestrefill*
// @grant        none
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
      // Автоподстановка диапазона дат после применения фильтра
      autoDateRange: true,
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

    // ── Автоподстановка дат ──────────────────────────────────────────
    autoDateRange: {
      // Насколько назад отсчитывать начало диапазона.
      // Текущее правило: год назад (+1 день, чтобы попасть ровно в годовое окно).
      yearsBack: 1,
      daysOffset: 1,
      // Время начала и конца диапазона [часы, минуты]
      startTime: [0, 0],
      endTime: [23, 59],
      // Пауза после нажатия Apply, прежде чем искать поле даты (мс)
      applyDelay: 300,
      // Сколько ещё пытаться, если поле не появилось сразу
      retryInterval: 100,
      retryTimeout: 3000,
    },

    // Подробный лог в консоль (F12 → Console)
    debug: false,
  };

  // ------------------------------------------------------------------
  // ОБЩЕЕ
  // ------------------------------------------------------------------

  const isDark = window._THEME === 'dark';

  const T = isDark ? {
    bg: '#1C2128',
    border: '#30363D',
    text: '#C9D1D9',
    textStrong: '#E6EDF3',
    textDim: '#8B949E',
    imgBg: '#0D1117',
    shadow: '0 8px 24px rgba(0,0,0,0.45)',
  } : {
    bg: '#fff',
    border: '#DFE1E6',
    text: '#42526E',
    textStrong: '#172B4D',
    textDim: '#8993A4',
    imgBg: '#F7F8FA',
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
      }
      #th-lightbox img {
        max-width: 90vw;
        max-height: 85vh;
        object-fit: contain;
        border-radius: 6px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.5);
        display: block;
      }
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

    const lbCounter = document.createElement('div');
    lbCounter.id = 'th-lightbox-counter';

    lbWrap.appendChild(lbPrev);
    lbWrap.appendChild(lbImg);
    lbWrap.appendChild(lbNext);
    lightbox.appendChild(lbClose);
    lightbox.appendChild(lbWrap);
    lightbox.appendChild(lbCounter);
    document.body.appendChild(lightbox);

    let lbUrls = [];
    let lbIndex = 0;

    function updateLightbox() {
      lbImg.src = lbUrls[lbIndex];
      lbPrev.disabled = lbIndex === 0;
      lbNext.disabled = lbIndex === lbUrls.length - 1;
      lbPrev.style.visibility = lbUrls.length > 1 ? 'visible' : 'hidden';
      lbNext.style.visibility = lbUrls.length > 1 ? 'visible' : 'hidden';
      lbCounter.textContent = lbUrls.length > 1 ? `${lbIndex + 1} / ${lbUrls.length}` : '';
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
    }

    lbPrev.addEventListener('click', e => {
      e.stopPropagation();
      if (lbIndex > 0) { lbIndex--; updateLightbox(); }
    });
    lbNext.addEventListener('click', e => {
      e.stopPropagation();
      if (lbIndex < lbUrls.length - 1) { lbIndex++; updateLightbox(); }
    });
    lbClose.addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
    lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });

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
  // 3. АВТОПОДСТАНОВКА ДИАПАЗОНА ДАТ
  // ==================================================================

  function initAutoDateRange() {
    const CFG = CONFIG.autoDateRange;

    function pad(n) { return String(n).padStart(2, '0'); }

    function fmt(d) {
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // Всегда «год назад → сегодня». Смещение на день — чтобы попасть ровно
    // в годовое окно, а не выйти за него на сутки.
    function getDateRange() {
      const now = new Date();

      const end = new Date(now);
      end.setHours(CFG.endTime[0], CFG.endTime[1], 0, 0);

      const start = new Date(now);
      start.setFullYear(start.getFullYear() - CFG.yearsBack);
      start.setDate(start.getDate() + CFG.daysOffset);
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
  // ЗАПУСК
  // ==================================================================

  function start() {
    if (CONFIG.features.filePreview) initFilePreview();
    if (CONFIG.features.prevStatus) initPrevStatus();
    if (CONFIG.features.autoDateRange) initAutoDateRange();
    log('Скрипт запущен на', window.location.pathname);
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

})();
