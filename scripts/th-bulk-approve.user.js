// ==UserScript==
// @name         TH Management — Bulk Approve Tickets (225)
// @namespace    th-management-bulk-approve
// @version      2.2
// @description  Открывает каждый видимый тикет и переводит его в целевой статус, нажав Apply: "Bulk Approve (225)" — для тикетов с External Status "Approved (M)" выставляет "225 Approved by agent"; "Bulk Response (239)" — для тикетов с External Status "The money has not been sent, cancel it (M)" выставляет "239 Response to user (M)" (тикеты с Amount = 0 пропускаются и выносятся в отдельный список для ручной проверки). Колонки ищутся по названию в шапке таблицы (с резервным номером на случай, если названия не найдены). Ловит swal2-окна (кроме "OK!") и выводит список тикет-Transaction ID в финальном alert для ручной проверки на дубликаты. Есть кнопка СТОП.
// @match        https://th-managment.com/en/admin/backoffice/paymentsupport*
// @match        https://managment.io/en/admin/backoffice/paymentsupport*
// @match        https://my-managment.com/en/admin/backoffice/paymentsupport*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-bulk-approve.user.js
// @downloadURL  https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-bulk-approve.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // НАСТРОЙКИ — при необходимости поправь под реальную разметку
  // ------------------------------------------------------------------
  const CONFIG = {
    // Пауза между шагами (мс) — если Vue не успевает среагировать, увеличь
    stepDelay: 250,
    // Максимальное время ожидания появления/исчезновения элемента (мс)
    waitTimeout: 8000,
    // Пауза между обработкой тикетов
    betweenTicketsDelay: 2000,
  };

  // ------------------------------------------------------------------
  // WORKFLOWS — каждый описывает свой вариант массовой обработки:
  // какие тикеты брать (по External Status) и в какой статус их переводить.
  // Кнопка на экране создаётся по одной на каждый workflow.
  // ------------------------------------------------------------------
  const WORKFLOWS = [
    {
      id: '225',
      buttonLabel: 'Bulk Approve (225)',
      buttonColor: '#2ABFCF',
      // Обрабатывать тикет только если его External Status равен этому значению
      // (без учёта регистра и лишних пробелов). Остальные тикеты пропускаются.
      requiredExternalStatus: 'Approved (M)',
      // Текст, который печатается в поле поиска статуса (как это делает человек)
      searchTerm: '225',
      // Текст, который должен встречаться в опции статуса (нечувствительно к регистру)
      statusMatch: (text) => {
        const t = text.trim().toLowerCase();
        return t.includes('225') && t.includes('approved by agent');
      },
      // Только для текста в диалогах подтверждения/отчёта
      targetStatusLabel: '225 Approved by agent',
    },
    {
      id: '239',
      buttonLabel: 'Bulk Response (239)',
      buttonColor: '#8E6FCE',
      requiredExternalStatus: 'The money has not been sent, cancel it (M)',
      searchTerm: '239',
      statusMatch: (text) => {
        const t = text.trim().toLowerCase();
        return t.includes('239') && t.includes('response to user');
      },
      targetStatusLabel: '239 Response to user (M)',
      // У части тикетов 239 в колонке Amount стоит 0 — их нужно пропускать
      // и вынести в отдельный список для ручной проверки, а не обрабатывать
      // как обычно.
      skipZeroAmount: true,
    },
  ];

  // Общее состояние выполнения (используется кнопкой СТОП)
  const state = {
    isRunning: false,
    stopRequested: false,
  };

  // Спец. класс ошибки, которым прерываем цепочку await'ов при нажатии СТОП
  class StopSignal extends Error {}

  function checkStop() {
    if (state.stopRequested) {
      throw new StopSignal('Остановлено пользователем');
    }
  }

  // ------------------------------------------------------------------
  // Отлов swal2-окон (SweetAlert2), кроме стандартного "OK!" успеха
  // ------------------------------------------------------------------
  // Известный безопасный паттерн (как в отдельном auto-close скрипте):
  // иконка success + текст "OK!" + кнопка "OK" + БЕЗ кнопки отмены —
  // это штатное подтверждение сохранения, его просто закрываем и не логируем.
  // Всё остальное (предупреждения о дублях, любые другие сообщения) —
  // логируем в capturedPopups с привязкой к тикету, который обрабатывался
  // в этот момент, и показываем в конце прогона.

  const capturedPopups = []; // { ticketId, transactionId, icon, title, content, hadCancel, timestamp }
  let currentTicketId = null; // тикет, который обрабатывается прямо сейчас (для привязки логов)
  let currentTransactionId = null; // Transaction ID этого же тикета

  function normalizeOk(text) {
    return text
      .replace(/О/g, 'O')
      .replace(/о/g, 'o')
      .replace(/К/g, 'K')
      .replace(/к/g, 'k');
  }

  function classifySwalPopup(popup) {
    const iconClass = Array.from(popup.classList).find((c) => c.startsWith('swal2-icon-'));
    const icon = iconClass ? iconClass.replace('swal2-icon-', '') : '(без иконки)';

    const titleEl = popup.querySelector('.swal2-title');
    const title = titleEl ? titleEl.textContent.trim() : '';

    const contentEl = popup.querySelector('.swal2-html-container');
    const content = contentEl ? contentEl.textContent.trim() : '';

    const confirmBtn = popup.querySelector('.swal2-confirm');
    const cancelBtn = popup.querySelector('.swal2-cancel');
    const hasCancel = !!(cancelBtn && window.getComputedStyle(cancelBtn).display !== 'none');
    const confirmText = confirmBtn ? normalizeOk(confirmBtn.textContent.trim()) : '';

    const isKnownSuccessDismiss =
      icon === 'success' &&
      !hasCancel &&
      /^ok!?$/i.test(normalizeOk(content)) &&
      /^ok$/i.test(confirmText);

    return { icon, title, content, confirmBtn, cancelBtn, hasCancel, isKnownSuccessDismiss };
  }

  const swalObserver = new MutationObserver(() => {
    const popup = document.querySelector('.swal2-popup');
    if (!popup || popup.dataset.bulkApproveHandled) return;
    popup.dataset.bulkApproveHandled = '1'; // не обрабатываем один и тот же попап дважды

    const info = classifySwalPopup(popup);

    if (info.isKnownSuccessDismiss) {
      info.confirmBtn.click();
      console.log(
        `[BulkApprove] Закрыл попап как безопасный (тикет ${currentTicketId || '—'}): ` +
        `title "${info.title}", содержимое "${info.content}"`
      );
      return;
    }

    // Любое другое окно — логируем для ручной проверки
    capturedPopups.push({
      ticketId: currentTicketId || '(вне обработки тикета)',
      transactionId: currentTransactionId || '(нет данных)',
      icon: info.icon,
      title: info.title,
      content: info.content,
      hadCancel: info.hasCancel,
      timestamp: new Date().toISOString(),
    });
    console.log(
      `[BulkApprove] Поймано окно (тикет ${currentTicketId || '—'}, TXN ${currentTransactionId || '—'}): ` +
      `[${info.icon}] "${info.title}" — "${info.content}"` +
      (info.hasCancel ? ' — есть кнопка отмены, НЕ закрываю автоматически.' : '')
    );

    if (!info.hasCancel && info.confirmBtn && info.icon !== 'error') {
      // Единственный доступный путь — подтвердить/закрыть, это безопасно
      // (сайт не предлагает выбора, значит нет риска подтвердить не то действие).
      // Иконку "error" не трогаем: это не запрос решения, а сообщение об
      // ошибке (например, "Amount on receipt field must be filled in") —
      // его нужно оставить на экране, чтобы пользователь успел прочитать,
      // а не закрывать за него автоматически.
      info.confirmBtn.click();
    }
    // Если есть кнопка отмены — ничего не жмём, оставляем окно для ручного решения
  });

  swalObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitFor(checkFn, timeout = CONFIG.waitTimeout, interval = 100) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (state.stopRequested) {
          clearInterval(timer);
          reject(new StopSignal('Остановлено пользователем'));
          return;
        }
        const result = checkFn();
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error('waitFor: timeout waiting for condition'));
        }
      }, interval);
    });
  }

  function waitForGone(checkFn, timeout = CONFIG.waitTimeout, interval = 100) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (state.stopRequested) {
          clearInterval(timer);
          reject(new StopSignal('Остановлено пользователем'));
          return;
        }
        if (!checkFn()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error('waitForGone: timeout waiting for element to disappear'));
        }
      }, interval);
    });
  }

  // sleep, который тоже можно прервать по СТОП
  function interruptibleSleep(ms) {
    return new Promise((resolve, reject) => {
      const checkInterval = 100;
      let elapsed = 0;
      const timer = setInterval(() => {
        if (state.stopRequested) {
          clearInterval(timer);
          reject(new StopSignal('Остановлено пользователем'));
          return;
        }
        elapsed += checkInterval;
        if (elapsed >= ms) {
          clearInterval(timer);
          resolve();
        }
      }, checkInterval);
    });
  }

  function fireClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function getOpenModal() {
    // Второй modal_wrap (с role="dialog") — это тот, что реально показывается при Edit.
    const modals = document.querySelectorAll('.modal_wrap[role="dialog"]');
    for (const m of modals) {
      const style = window.getComputedStyle(m);
      if (style.display !== 'none') return m;
    }
    return null;
  }

  function getTicketRows() {
    return Array.from(document.querySelectorAll('.table-wrapper tbody tr[data-table-row]'));
  }

  // ------------------------------------------------------------------
  // Поиск колонок по названию из шапки таблицы (на случай, если у
  // другого пользователя колонки перетащены в другом порядке)
  // ------------------------------------------------------------------
  let columnIndexMap = null; // { 'external status': 8, 'ticket id': 9, ... } (1-based, как в nth-child)

  function refreshColumnIndexMap() {
    const headerCells = document.querySelectorAll('.table-wrapper thead th');
    if (headerCells.length === 0) {
      console.warn('[BulkApprove] Не найдены заголовки таблицы — использую резервные номера колонок.');
      columnIndexMap = null;
      return;
    }

    const map = {};
    headerCells.forEach((th, idx) => {
      const label = th.textContent.trim().toLowerCase();
      if (label) map[label] = idx + 1; // nth-child считается с 1
    });
    columnIndexMap = map;

    const required = ['external status', 'ticket id', 'transaction id', 'actions'];
    const missing = required.filter((name) => !map[name]);
    if (missing.length > 0) {
      console.warn(
        `[BulkApprove] Не найдены колонки по названию: ${missing.join(', ')} — для них будут использованы резервные номера.`
      );
    }
  }

  // Возвращает номер колонки по названию, либо резервный номер, если название не нашлось
  function getColumnIndex(name, fallbackIndex) {
    if (!columnIndexMap) return fallbackIndex;
    return columnIndexMap[name.toLowerCase()] || fallbackIndex;
  }

  function getTicketIdFromRow(row) {
    const idx = getColumnIndex('ticket id', 9);
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.textContent.trim() : '(unknown)';
  }

  function getExternalStatusFromRow(row) {
    const idx = getColumnIndex('external status', 8);
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.textContent.trim() : '';
  }

  function getTransactionIdFromRow(row) {
    const idx = getColumnIndex('transaction id', 11);
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.textContent.trim() : '';
  }

  // Возвращает { raw, value } из колонки Amount, либо null, если колонка не
  // нашлась по названию (резервного номера для неё нет — колонка нужна не
  // всем workflow, поэтому лучше честно не знать сумму, чем читать не ту
  // ячейку). value — число (0, если сумма 0), либо null, если распарсить
  // не удалось (например, ячейка пустая или содержит не число).
  function getAmountFromRow(row) {
    const idx = getColumnIndex('amount');
    if (!idx) return null;
    const cell = row.querySelector(`td:nth-child(${idx})`);
    if (!cell) return null;
    const raw = cell.textContent.trim();
    // Убираем валютные символы, пробелы и разделители тысяч, чтобы разобрать число
    const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '');
    const value = cleaned === '' ? null : Number(cleaned);
    return { raw, value: Number.isNaN(value) ? null : value };
  }

  function getEditLinkFromRow(row) {
    const idx = getColumnIndex('actions', 3);
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.querySelector('a') : null;
  }

  // Находит .input-group внутри модалки, где <span class="title"> точно равен label
  function findFieldGroup(modal, label) {
    const groups = modal.querySelectorAll('.form-add .input-group');
    for (const g of groups) {
      const titleEl = g.querySelector(':scope > span.title, :scope > [class*="title"]');
      if (titleEl && titleEl.textContent.trim().toLowerCase().startsWith(label.toLowerCase())) {
        return g;
      }
    }
    return null;
  }

  // Пытается аккуратно закрыть открытую модалку кнопкой Cancel (используется при остановке)
  function tryCancelModal() {
    const modal = getOpenModal();
    if (!modal) return;
    const cancelBtn = modal.querySelector('.filter.btn-block .btn-default');
    if (cancelBtn) {
      fireClick(cancelBtn);
    }
  }

  // Вызывается при ЛЮБОЙ ошибке уже ПОСЛЕ того, как модалка Edit открылась.
  // Критично закрыть её здесь: если оставить открытой, при клике Edit на
  // следующей строке сайт может не открыть новую модалку, а переиспользовать
  // старую — и скрипт применит статус/Apply к чужому, предыдущему тикету
  // (именно так один раз к тикету оказалась привязана транзакция от другого
  // тикета). Ждём подтверждения закрытия, а не просто кликаем и надеемся.
  async function failTicket(ticketId, workflow, result) {
    tryCancelModal();
    try {
      await waitForGone(() => getOpenModal(), 3000);
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      console.warn(
        `[BulkApprove/${workflow.id}] Тикет ${ticketId}: не удалось закрыть модалку после ошибки (${result.reason}) — ` +
        `она может остаться открытой и повлиять на обработку следующего тикета. Проверь вручную.`
      );
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Основная логика: обработка одного тикета
  // ------------------------------------------------------------------
  async function processTicket(row, index, total, workflow) {
    const ticketId = getTicketIdFromRow(row);
    const transactionId = getTransactionIdFromRow(row);
    currentTicketId = ticketId; // чтобы пойманные попапы привязывались к этому тикету
    currentTransactionId = transactionId;
    try {
      return await processTicketInner(row, ticketId, index, total, workflow);
    } finally {
      currentTicketId = null;
      currentTransactionId = null;
    }
  }

  async function processTicketInner(row, ticketId, index, total, workflow) {
    const externalStatus = getExternalStatusFromRow(row);

    const normalizedRequired = workflow.requiredExternalStatus.trim().toLowerCase();
    const normalizedActual = externalStatus.trim().toLowerCase();

    if (normalizedActual !== normalizedRequired) {
      console.log(
        `[BulkApprove/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: External Status = "${externalStatus}" ` +
        `(нужно "${workflow.requiredExternalStatus}") — пропускаю.`
      );
      return { ticketId, status: 'skipped', reason: 'wrong-external-status', externalStatus };
    }

    if (workflow.skipZeroAmount) {
      const amount = getAmountFromRow(row);
      if (amount && amount.value === 0) {
        console.log(
          `[BulkApprove/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: Amount = 0 — пропускаю, нужна ручная проверка.`
        );
        return { ticketId, status: 'skipped', reason: 'zero-amount', externalStatus };
      }
    }

    console.log(`[BulkApprove/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: открываю Edit...`);

    checkStop();

    const editLink = getEditLinkFromRow(row);
    if (!editLink) {
      console.warn(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: не найдена кнопка Edit, пропускаю.`);
      return { ticketId, status: 'failed', reason: 'no-edit-link' };
    }

    fireClick(editLink);

    // Ждём появления модалки
    let modal;
    try {
      modal = await waitFor(() => getOpenModal());
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      console.warn(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: модалка не появилась.`);
      return { ticketId, status: 'failed', reason: 'modal-not-shown' };
    }

    await interruptibleSleep(CONFIG.stepDelay);

    // Находим поле Status
    const statusGroup = findFieldGroup(modal, 'Status');
    if (!statusGroup) {
      console.warn(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: не найдено поле Status.`);
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'no-status-field' });
    }

    const multiselectTags = statusGroup.querySelector('.multiselect__tags');
    const multiselectInput = statusGroup.querySelector('.multiselect__input');
    if (!multiselectTags) {
      console.warn(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: не найден .multiselect__tags внутри Status.`);
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'no-multiselect-tags' });
    }

    checkStop();

    // ВАЖНО: у vue-multiselect выпадающий список открывается по ФОКУСУ на
    // внутреннем <input>, а не по клику на обёртку .multiselect__tags.
    // Поэтому сначала кликаем (на всякий случай — для попадания в нужную область),
    // а затем явно переводим фокус на сам инпут.
    fireClick(multiselectTags);
    if (multiselectInput) {
      multiselectInput.focus();
      multiselectInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }
    await interruptibleSleep(CONFIG.stepDelay);

    // Печатаем searchTerm workflow'а в поле поиска — так же, как это делает человек.
    // Это надёжнее, чем искать нужный текст в нераскрытом полном списке.
    if (multiselectInput) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      nativeInputValueSetter.call(multiselectInput, workflow.searchTerm);
      multiselectInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    let optionsList;
    try {
      // Сначала пробуем найти вариант в отфильтрованном (после ввода searchTerm) списке
      optionsList = await waitFor(() => {
        const wrapper = statusGroup.querySelector('.multiselect__content-wrapper');
        if (!wrapper) return null;
        let options = wrapper.querySelectorAll('.multiselect__option');
        if (options.length === 0) {
          options = wrapper.querySelectorAll('[id^="null-"]');
        }
        const matches = Array.from(options).filter((opt) => workflow.statusMatch(opt.textContent));
        return matches.length > 0 ? matches : null;
      }, 2500); // короче таймаут — если фильтрация не сработала, быстро уходим в fallback
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      console.log(
        `[BulkApprove/${workflow.id}] Тикет ${ticketId}: фильтрация по "${workflow.searchTerm}" не дала результата, ищу в полном списке...`
      );
      // Fallback: очищаем поиск и ищем по всему нераскрытому списку опций
      if (multiselectInput) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeInputValueSetter.call(multiselectInput, '');
        multiselectInput.dispatchEvent(new Event('input', { bubbles: true }));
        await interruptibleSleep(CONFIG.stepDelay);
      }
      try {
        optionsList = await waitFor(() => {
          const wrapper = statusGroup.querySelector('.multiselect__content-wrapper');
          if (!wrapper) return null;
          let options = wrapper.querySelectorAll('.multiselect__option');
          if (options.length === 0) {
            options = wrapper.querySelectorAll('[id^="null-"]');
          }
          const matches = Array.from(options).filter((opt) => workflow.statusMatch(opt.textContent));
          return matches.length > 0 ? matches : null;
        });
      } catch (e2) {
        if (e2 instanceof StopSignal) throw e2;
        console.warn(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: список опций статуса не раскрылся или вариант не найден.`);
        console.log(`[BulkApprove/${workflow.id}] Debug — HTML поля Status:`, statusGroup.outerHTML);
        return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'dropdown-not-opened-or-no-match' });
      }
    }

    checkStop();

    const targetOption = optionsList[0];

    fireClick(targetOption);
    await interruptibleSleep(CONFIG.stepDelay);

    checkStop();

    // Нажимаем Apply (первая кнопка в .filter.btn-block, класс btn-success)
    const applyBtn = modal.querySelector('.filter.btn-block .input-group:first-child .btn-success');
    if (!applyBtn) {
      console.warn(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: не найдена кнопка Apply.`);
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'no-apply-button' });
    }

    fireClick(applyBtn);

    // Ждём, пока модалка закроется (AJAX). Если по дороге появится swal2-окно —
    // отдельный наблюдатель (swalObserver) сам его залогирует и, если это
    // безопасно (нет кнопки отмены), закроет, не мешая этому ожиданию.
    try {
      await waitForGone(() => getOpenModal());
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      const relatedPopups = capturedPopups.filter((p) => p.ticketId === ticketId);
      console.warn(
        `[BulkApprove/${workflow.id}] Тикет ${ticketId}: модалка не закрылась после Apply — возможно, ошибка сохранения.` +
        (relatedPopups.length > 0 ? ' См. пойманные окна для этого тикета в отчёте.' : '')
      );
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'modal-not-closed' });
    }

    console.log(`[BulkApprove/${workflow.id}] Тикет ${ticketId}: готово ✅`);
    return { ticketId, status: 'success' };
  }

  // ------------------------------------------------------------------
  // Запуск по кнопке
  // ------------------------------------------------------------------
  async function runBulkApprove(workflow) {
    refreshColumnIndexMap();

    if (workflow.skipZeroAmount && !(columnIndexMap && columnIndexMap['amount'])) {
      console.warn(
        `[BulkApprove/${workflow.id}] Не найдена колонка Amount по названию — проверка на сумму 0 ` +
        `не будет работать в этом прогоне, тикеты с нулевой суммой обработаются как обычно.`
      );
    }

    const rows = getTicketRows();
    if (rows.length === 0) {
      alert('Не найдено ни одного тикета на странице.');
      return;
    }

    const confirmed = confirm(
      `Найдено тикетов на экране: ${rows.length}.\n` +
      `Будут обработаны только те, у кого External Status = "${workflow.requiredExternalStatus}"\n` +
      `(остальные — пропущены).\n` +
      `У подходящих будет выставлен статус "${workflow.targetStatusLabel}" и нажат Apply.` +
      (workflow.skipZeroAmount
        ? `\nТикеты с Amount = 0 тоже будут пропущены (отдельно отмечу в итоге для ручной проверки).`
        : '') +
      `\n\nПродолжить?`
    );
    if (!confirmed) return;

    capturedPopups.length = 0; // отчёт по попапам — только за этот прогон

    state.isRunning = true;
    state.stopRequested = false;
    updateButtonsUI();

    const results = [];
    let stoppedEarly = false;

    for (let i = 0; i < rows.length; i++) {
      if (state.stopRequested) {
        stoppedEarly = true;
        break;
      }

      // Важно: после Apply страница может перерисовать таблицу, поэтому
      // берём актуальный список строк заново на каждой итерации
      const currentRows = getTicketRows();
      const row = currentRows[i];
      if (!row) {
        console.warn(`[BulkApprove/${workflow.id}] Строка №${i + 1} больше не существует, пропускаю.`);
        continue;
      }

      let result;
      try {
        result = await processTicket(row, i, rows.length, workflow);
        results.push(result);
      } catch (e) {
        if (e instanceof StopSignal) {
          console.log(`[BulkApprove/${workflow.id}] Получен сигнал СТОП — прерываю выполнение.`);
          tryCancelModal();
          stoppedEarly = true;
          break;
        }
        console.error(`[BulkApprove/${workflow.id}] Необработанная ошибка на тикете №${i + 1}:`, e);
        result = { ticketId: '(error)', status: 'failed', reason: 'exception' };
        results.push(result);
      }

      const wasSkipped = result && result.status === 'skipped';

      if (i < rows.length - 1 && !state.stopRequested && !wasSkipped) {
        try {
          await interruptibleSleep(CONFIG.betweenTicketsDelay);
        } catch (e) {
          if (e instanceof StopSignal) {
            stoppedEarly = true;
            break;
          }
        }
      }
    }

    state.isRunning = false;
    state.stopRequested = false;
    updateButtonsUI();

    const successCount = results.filter((r) => r.status === 'success').length;
    const wrongStatusSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'wrong-external-status');
    const zeroAmountSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'zero-amount');
    const failCount = results.filter((r) => r.status === 'failed').length;
    const popupCount = capturedPopups.length;

    console.log(`[BulkApprove/${workflow.id}] ИТОГ:`, results);
    // Быстрый доступ из консоли, например:
    // window.__bulkApproveLastResults.find(r => r.ticketId === '19406922')
    window.__bulkApproveLastResults = results;

    if (popupCount > 0) {
      console.log(`[BulkApprove/${workflow.id}] Пойманные всплывающие окна (не "OK!"), требуют ручной проверки:`);
      console.table(
        capturedPopups.map((p) => ({
          Тикет: p.ticketId,
          'Transaction ID': p.transactionId,
          Иконка: p.icon,
          Заголовок: p.title,
          Текст: p.content,
          'Была кнопка отмены': p.hadCancel ? 'да' : 'нет',
        }))
      );
      // Тот же список доступен в любой момент через консоль:
      // window.__bulkApproveCapturedPopups
      window.__bulkApproveCapturedPopups = capturedPopups;
    }

    const popupsListText =
      popupCount > 0
        ? `\n\nТребуют ручной проверки на дубликаты (${popupCount}):\n` +
          capturedPopups.map((p) => `${p.ticketId} - ${p.transactionId}`).join('\n')
        : '';

    const zeroAmountListText =
      zeroAmountSkips.length > 0
        ? `\n\nПропущены из-за Amount = 0, требуют ручной проверки (${zeroAmountSkips.length}):\n` +
          zeroAmountSkips.map((r) => r.ticketId).join('\n')
        : '';

    const skippedSummaryLine =
      zeroAmountSkips.length > 0
        ? `Пропущено (не тот External Status): ${wrongStatusSkips.length}\nПропущено (Amount = 0): ${zeroAmountSkips.length}`
        : `Пропущено (не тот External Status): ${wrongStatusSkips.length}`;

    if (stoppedEarly) {
      alert(
        `Остановлено пользователем.\n` +
        `Обработано: ${results.length} из ${rows.length}\n` +
        `Успешно: ${successCount}\n${skippedSummaryLine}\nОшибок: ${failCount}` +
        popupsListText +
        zeroAmountListText +
        `\n\nПодробности — в консоли (F12).`
      );
    } else {
      alert(
        `Готово.\n` +
        `Успешно: ${successCount}\n${skippedSummaryLine}\nОшибок: ${failCount}` +
        popupsListText +
        zeroAmountListText +
        `\n\nПодробности — в консоли (F12).`
      );
    }
  }

  function requestStop() {
    if (!state.isRunning) return;
    state.stopRequested = true;
    console.log('[BulkApprove] Запрошена остановка — завершаю текущий шаг и останавливаюсь...');
    updateButtonsUI();
  }

  // ------------------------------------------------------------------
  // Кнопки на экране — по одной кнопке запуска на каждый workflow
  // из WORKFLOWS, плюс одна общая кнопка СТОП (одновременно может
  // выполняться только один прогон, это гарантирует state.isRunning).
  // ------------------------------------------------------------------
  let startBtns = [];
  let stopBtn;

  function updateButtonsUI() {
    if (startBtns.length === 0 || !stopBtn) return;
    startBtns.forEach((btn) => {
      btn.disabled = state.isRunning;
      btn.style.opacity = state.isRunning ? '0.5' : '1';
      btn.style.cursor = state.isRunning ? 'default' : 'pointer';
    });

    stopBtn.disabled = !state.isRunning || state.stopRequested;
    stopBtn.style.display = state.isRunning ? 'inline-block' : 'none';
    stopBtn.textContent = state.stopRequested ? 'Останавливаю...' : 'СТОП';
  }

  function addTriggerButtons() {
    if (document.getElementById('bulk-approve-btn')) return;

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 999999,
      display: 'flex',
      gap: '10px',
    });

    startBtns = WORKFLOWS.map((workflow, idx) => {
      const btn = document.createElement('button');
      btn.id = idx === 0 ? 'bulk-approve-btn' : `bulk-approve-btn-${workflow.id}`;
      btn.textContent = workflow.buttonLabel;
      Object.assign(btn.style, {
        padding: '12px 18px',
        background: workflow.buttonColor,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      });
      btn.addEventListener('click', () => {
        runBulkApprove(workflow).catch((e) => console.error(`[BulkApprove/${workflow.id}] Fatal error:`, e));
      });
      container.appendChild(btn);
      return btn;
    });

    stopBtn = document.createElement('button');
    stopBtn.id = 'bulk-approve-stop-btn';
    stopBtn.textContent = 'СТОП';
    Object.assign(stopBtn.style, {
      padding: '12px 18px',
      background: '#d32f2f',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      display: 'none',
    });
    stopBtn.addEventListener('click', requestStop);

    container.appendChild(stopBtn);
    document.body.appendChild(container);

    updateButtonsUI();
  }

  // Ждём, пока страница (Vue-приложение) отрисуется, и добавляем кнопки.
  // Без жёсткого таймаута: страница/фильтры могут грузиться дольше 8 секунд
  // (особенно если у формы фильтров method="post" и Apply делает полную
  // перезагрузку страницы — тогда ждать нужно заново после каждой такой перезагрузки).
  function waitForeverAndAddButtons() {
    if (document.querySelector('.table-wrapper tbody tr[data-table-row]')) {
      addTriggerButtons();
      return;
    }

    console.log('[BulkApprove] Жду появления таблицы тикетов...');
    let lastLog = Date.now();

    const observer = new MutationObserver(() => {
      if (document.querySelector('.table-wrapper tbody tr[data-table-row]')) {
        observer.disconnect();
        console.log('[BulkApprove] Таблица найдена, добавляю кнопки.');
        addTriggerButtons();
        return;
      }
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        console.log('[BulkApprove] Всё ещё жду таблицу тикетов...');
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  waitForeverAndAddButtons();

})();
