// ==UserScript==
// @name         TH Management — Bulk Approve Tickets (BETA)
// @namespace    th-management-bulk-approve-beta
// @version      0.5
// @description  Открывает каждый видимый тикет и переводит его в целевой статус, нажав Apply: "Bulk Approve (225)" — для тикетов с External Status "Approved (M)" выставляет "225 Approved by agent" (перед прогоном можно вставить список Ticket ID, и тогда скрипт сам подставляет их в фильтр страницы пачками по 100, либо нажать «Запустить по экрану» и работать с тем, что уже выведено); "Bulk Response (239)" — для тикетов, у которых транзакция в статусе rejected, а External Status — один из семи (The money has not been sent, cancel it (M); Adjust the payout amount (M); 185; 191; 199; 203; 238), выставляет "239 Response to user (M)" (если в списке Amount = 0, сумма берётся из колонки Transaction Amount и вписывается числом в поле Amount by receipt, после чего скрипт проверяет, что она действительно сохранилась; если взять нечего или сумма не сохранилась — тикет выносится в отдельный список). Колонки ищутся по названию в шапке таблицы (с резервным номером на случай, если названия не найдены). Ловит swal2-окна (кроме "OK!") и выводит список тикет-Transaction ID в финальном alert для ручной проверки на дубликаты. В конце показывает итоговое окно, из которого можно скопировать таблицу «Ticket ID / Transaction ID / Amount» для учёта. В сводке видно, сколько обработанных тикетов были свежими, а сколько зависшими (по колонке Processing Date). Третий режим — «по списку (225)»: оператор приносит список «Ticket ID → Transaction ID», скрипт вписывает номер транзакции в тикеты, у которых он пуст, и закрывает их как 225; с включённым автопилотом он сам подставляет тикеты из списка в фильтр страницы пачками по 100 и нажимает Apply, пока список не кончится. Есть кнопка СТОП.
// @match        https://th-managment.com/en/admin/backoffice/paymentsupport*
// @match        https://managment.io/en/admin/backoffice/paymentsupport*
// @match        https://my-managment.com/en/admin/backoffice/paymentsupport*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-bulk-approve-beta.user.js
// @downloadURL  https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-bulk-approve-beta.user.js
// ==/UserScript==

// ОБКАТОЧНАЯ ВЕРСИЯ. Основана на th-bulk-approve.user.js 2.10.
//
// Живёт отдельным файлом, чтобы команда продолжала работать на стабильном
// скрипте, пока новое проверяется на бою. Это ВРЕМЕННЫЙ файл: когда обкатка
// закончится, содержимое уезжает в основной скрипт, а этот удаляется —
// порядок переноса расписан в README, раздел про бету.
//
// От стабильного отличается только тем, что обязано отличаться: шапкой,
// id элементов на странице, подписями кнопок и префиксом в консоли. Имена
// window.__bulkApprove* намеренно оставлены прежними, чтобы обратный перенос
// был копированием, а не вылавливанием переименований.

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
    // Сколько ждать возвращения таблицы, если она вдруг стала пустой
    // (перезагрузка страницы, ошибки сервера, повторное применение фильтров)
    tableReloadTimeout: 15000,
    // Сколько ждать, пока оператор закроет висящее окно сайта, прежде чем
    // остановить прогон
    blockingPopupTimeout: 5000,
    // Столько ошибок подряд — и прогон останавливается сам
    maxConsecutiveFailures: 3,
    // Проверять после Apply, что подставленная сумма действительно сохранилась
    // (см. verifyAmountSaved). Выключать стоит только для отладки: без этого
    // тикет может закрыться со статусом, но без суммы, и никто не заметит.
    verifyAmountSaved: true,
    // С какого возраста тикет считается зависшим (часы). Возраст берётся из
    // колонки Processing Date и считается на момент обработки тикета.
    staleAfterHours: 24,

    // ── Догрузка данных после ввода Transaction ID ────────────────────
    // Вписав номер транзакции, сайт идёт за её данными и дозаполняет
    // остальные поля окна. Трогать Status до конца этой загрузки нельзя:
    // ответ сервера перетирает выбранный статус.
    //
    // Замеры на боевой странице (дважды, разброс менее 50 мс): сайт шлёт ДВЕ
    // независимые волны запросов от одного события ввода — первую примерно
    // через 500 мс, вторую примерно через 3000 мс, и между ними 2,4 секунды
    // полной тишины. Поэтому ждать «тишину после последнего ответа» нельзя:
    // она закончилась бы ровно в этом разрыве.
    transactionLoadEndpoints: [
      'checkPaymentSupportRequestByTrxId', // занята ли транзакция другим тикетом
      'getTransactionInfo',
      'GetSubAgentInfo',
    ],
    // Ждём ИМЕННО этот запрос, а не время. Два замера одинаково показали
    // старт второй волны около 3000 мс от ввода, но теми же данными не
    // отличается гипотеза «волна идёт от ответа первой» — в обоих замерах
    // первая ответила одинаково быстро. Если верна вторая гипотеза, на
    // тикете с медленным сервером волна уедет дальше любого разумного
    // порога. Ожидание самого запроса снимает вопрос целиком.
    transactionLoadSecondWave: 'getTransactionInfo',
    // Своя граница для второй волны: у тикета с несуществующей транзакцией
    // её может не быть вовсе, и без отдельного срока такой тикет висел бы
    // весь transactionLoadTimeout.
    transactionLoadSecondWaveTimeout: 8000,
    // Нижняя граница от момента ввода — страховка на случай, не учтённый выше
    transactionLoadSettleAfterInput: 5000,
    // И не раньше этого с последнего ответа
    transactionLoadQuietPeriod: 800,
    // Сколько ждать ПЕРВОГО запроса. Не ушёл — значит сайт не увидел ввод
    transactionLoadFirstRequestTimeout: 3000,
    // Жёсткий потолок ожидания догрузки
    transactionLoadTimeout: 20000,
    // Как часто перепроверять журнал, пока ждём
    transactionLoadPollInterval: 150,

    // ── Автопилот: скрипт сам набирает пачки тикетов в фильтр ─────────
    // Ровно столько тикетов умещается на одну страницу выдачи. Больше —
    // и сайт включает пагинацию, а ею пользоваться нельзя: страницы
    // нестабильны, и прогон по ним молча терял бы тикеты.
    autopilotChunkSize: 100,
    // Сколько ждать, пока таблица перестроится после Apply
    autopilotTableTimeout: 40000,
    // Не раньше этого от нажатия Apply. Vue сносит старую таблицу не
    // мгновенно, и без этой паузы мы приняли бы ещё не тронутую выдачу
    // предыдущей пачки за новую.
    autopilotTableSettleMin: 1500,
    // Столько состав таблицы не должен меняться, чтобы считать её готовой
    autopilotTableQuietPeriod: 1000,
    // Пустая выдача — законный исход (в пачке нет ни одного живого тикета),
    // но отличить её от «ещё грузится» можно только временем
    autopilotEmptyConfirm: 8000,
    // Столько пустых пачек подряд — и прогон останавливается. Триста
    // тикетов подряд, которых сайт не показал, — это сломанный фильтр,
    // а не совпадение.
    autopilotMaxEmptyChunks: 3,
    // Пауза между пачками
    autopilotBetweenChunksDelay: 1500,
  };

  // ------------------------------------------------------------------
  // WORKFLOWS — каждый описывает свой вариант массовой обработки:
  // какие тикеты брать (по External Status) и в какой статус их переводить.
  // Кнопка на экране создаётся по одной на каждый workflow.
  // ------------------------------------------------------------------
  // Один и тот же матчер статуса используют два режима — обычный 225 и 225
  // по списку. Держим его в одном месте, чтобы копии не разъехались.
  const MATCH_225 = (text) => {
    const t = text.trim().toLowerCase();
    return t.includes('225') && t.includes('approved by agent');
  };

  const WORKFLOWS = [
    {
      id: '225',
      buttonLabel: 'BETA Bulk Approve (225)',
      buttonColor: '#2ABFCF',
      // Обрабатывать тикет только если его External Status есть в этом списке
      // (без учёта регистра, лишних пробелов и числового кода в начале —
      // см. normalizeExternalStatus). Остальные тикеты пропускаются.
      requiredExternalStatuses: ['Approved (M)'],
      // Перед прогоном спрашиваем список Ticket ID. Он НЕ обязателен: в
      // окне есть «Запустить по экрану» — прежнее поведение этой кнопки.
      // Со списком включается автопилот, и скрипт сам набирает тикеты в
      // фильтр страницы пачками, как в режиме «по списку (225)».
      allowTicketIdList: true,
      // Текст, который печатается в поле поиска статуса (как это делает человек)
      searchTerm: '225',
      // Текст, который должен встречаться в опции статуса (нечувствительно к регистру)
      statusMatch: MATCH_225,
      // Только для текста в диалогах подтверждения/отчёта
      targetStatusLabel: '225 Approved by agent',
    },
    {
      id: '239',
      buttonLabel: 'BETA Bulk Response (239)',
      buttonColor: '#8E6FCE',
      // Пул статусов намеренно широкий: в Response to user закрывают любой
      // вывод, по которому транзакция отклонена, а причина отказа у каждого
      // своя — отсюда и разные External Status. Что именно объединяет эти
      // тикеты, проверяется отдельно, по колонке Transaction Status
      // (см. requiredTransactionStatus).
      requiredExternalStatuses: [
        'The money has not been sent, cancel it (M)',
        'Adjust the payout amount (M)',
        '185 Limit reached on the recipient side (M)',
        "191 Recipient's details are not correct (M)",
        '199 Request statement for payout (M)',
        '203 Sent (M)',
        '238 Revision needed (M)',
      ],
      // Обязательное условие: транзакция должна быть отклонена. Один External
      // Status этого не гарантирует — например «203 Sent (M)» стоит и у
      // нормальных отправок, где закрывать тикет ответом пользователю нельзя.
      // Если колонки Transaction Status на экране нет, прогон не начнётся:
      // проверить условие нечем, а обрабатывать «на авось» тут слишком дорого.
      requiredTransactionStatus: 'rejected',
      searchTerm: '239',
      statusMatch: (text) => {
        const t = text.trim().toLowerCase();
        return t.includes('239') && t.includes('response to user');
      },
      targetStatusLabel: '239 Response to user (M)',
      // У части тикетов 239 в колонке Amount стоит 0. Раньше их просто
      // пропускали, и оператор доделывал руками: копировал сумму из колонки
      // Transaction Amount в поле "Amount by receipt" и менял статус. Теперь
      // скрипт делает это сам, а после Apply проверяет, что сумма реально
      // сохранилась (см. verifyAmountSaved). Если брать нечего (Transaction
      // Amount пуст, не число или тоже 0) — тикет по-прежнему пропускается и
      // уходит в список для ручной проверки.
      fillAmountFromTransaction: true,
    },
    {
      // Тикеты, которые надо закрыть как 225, но у которых не заполнен
      // Transaction ID — сайт без него закрыть не даст. Номера транзакций
      // оператор приносит списком «Ticket ID → Transaction ID» из своей
      // таблицы; скрипт спрашивает этот список перед прогоном.
      //
      // Отбор двойной: тикет должен быть И в списке, И в нужном External
      // Status. Список сам по себе — данные, набранные руками, и опечатка в
      // номере не должна закрывать случайный тикет.
      id: '225-list',
      buttonLabel: 'BETA Bulk Approve по списку (225)',
      buttonColor: '#E0A02C',
      requiredExternalStatuses: ['Approved (M)'],
      searchTerm: '225',
      statusMatch: MATCH_225,
      targetStatusLabel: '225 Approved by agent',
      fillTransactionIdFromList: true,
    },
  ];

  // Общее состояние выполнения (используется кнопкой СТОП)
  const state = {
    isRunning: false,
    stopRequested: false,
  };

  // Причина автоматической остановки прогона (залипшая модалка и т.п.);
  // показывается в финальном alert вместо "Остановлено пользователем"
  let runAbortReason = null;

  // ------------------------------------------------------------------
  // Человеческие формулировки для технических кодов ошибок (reason).
  // Раньше в итоговом окне была только цифра «Ошибок: N», а расшифровка
  // лежала в консоли — оператор не знал ни какие тикеты упали, ни почему.
  // Ключи должны совпадать с reason в результатах processTicket.
  // ------------------------------------------------------------------
  const REASON_LABELS = {
    'row-disappeared': 'строка исчезла из таблицы — тикет даже не открывали',
    'no-edit-link': 'в строке нет кнопки Edit',
    'modal-not-shown': 'окно Edit не открылось',
    'modal-title-unreadable': 'не удалось прочитать номер тикета в заголовке окна — ничего не меняли',
    'modal-ticket-mismatch': 'открылся ДРУГОЙ тикет — ничего не меняли',
    'transaction-not-rejected': 'транзакция не в статусе rejected — тикет не открывали',
    'no-transaction-status-column':
      'не удалось прочитать колонку Transaction Status — не с чем сверять, тикет не открывали',
    // У этой причины есть своя строка в сводке, но формулировка нужна и здесь:
    // в режиме по списку такой тикет попадает в список «посмотреть глазами».
    'wrong-external-status': 'External Status тикета не подходит для этого режима — не трогали',
    'not-in-list': 'тикета нет в поданном списке — не трогали',
    'transaction-id-mismatch':
      'Transaction ID уже заполнен, и не тем номером, что в списке — ничего не меняли, нужна ручная проверка',
    'no-transaction-id-field': 'в окне нет поля Transaction ID — вписать некуда',
    'popup-before-apply':
      'перед Apply на экране висело окно сайта — Apply не нажимали, тикет не тронут',
    'transaction-duplicate':
      'сайт сказал, что эта транзакция уже занята другим обращением — статус НЕ меняли, ' +
      'Apply НЕ нажимали, тикет нужно разобрать руками',
    'unknown-popup':
      'сайт показал незнакомое окно — статус НЕ меняли, Apply НЕ нажимали, прогон остановлен',
    'transaction-id-not-accepted':
      'сайт не принял вписанный Transaction ID (поле сбросилось) — статус не меняли',
    'transaction-load-not-started':
      'сайт не среагировал на вписанный Transaction ID (не ушёл ни один запрос) — статус не меняли',
    'transaction-load-timeout':
      'сайт не закончил догружать данные транзакции — статус не меняли, проверь вручную',
    'no-amount-receipt-field': 'в окне нет поля Amount by receipt — сумму вписать некуда',
    'amount-format-unclear': 'не понял формат суммы в Transaction Amount — не стал рисковать и вписывать',
    'amount-not-accepted': 'сайт не принял вписанную сумму (поле сбросилось) — ничего не меняли, проверь вручную',
    'no-status-field': 'в окне не появилось поле Status (сайт не отрисовал форму)',
    'no-multiselect-tags': 'поле Status непривычной вёрстки — скрипт его не понял',
    'dropdown-not-opened-or-no-match': 'не открылся список статусов или нужного статуса в нём нет',
    'no-apply-button': 'не найдена кнопка Apply',
    'modal-not-closed': 'нажали Apply, но окно не закрылось — ПРОВЕРЬ ВРУЧНУЮ, сохранился ли статус',
    'blocking-popup': 'на экране висело незакрытое окно сайта',
    'stale-modal-before-edit': 'не закрылось окно от предыдущего тикета',
    exception: 'непредвиденная ошибка скрипта (подробности в консоли)',
  };

  // Закрыт ли тикет из списка. Один предикат на живой счётчик в панели и на
  // итоговый отчёт: две копии этого условия однажды разойдутся, и человек
  // увидит в панели одно число, а в отчёте другое.
  //
  // «Вписали, но не проверили» закрытым НЕ считается: непроверенный тикет
  // должен остаться в списке и попасть под следующий прогон.
  function isListTicketClosed(result) {
    return (
      result.status === 'success' &&
      result.txVerified !== 'not-saved' &&
      result.txVerified !== 'unverified'
    );
  }

  function describeReason(reason) {
    return REASON_LABELS[reason] || `неизвестная причина: ${reason}`;
  }

  // Спец. класс ошибки, которым прерываем цепочку await'ов при нажатии СТОП
  class StopSignal extends Error {}

  // ------------------------------------------------------------------
  // ЖУРНАЛ СЕТЕВЫХ ЗАПРОСОВ.
  //
  // Нужен ровно для одного: поймать момент, когда сайт закончил догружать
  // данные после ввода Transaction ID. По DOM это не ловится — между вводом
  // и обновлением полей 3,6 секунды тишины, а само обновление может свестись
  // к паре секунд в поле даты, которых на другом тикете не будет вовсе.
  //
  // Обёртка СТРОГО пассивная: отмечает старт и финиш, возвращает ровно то,
  // что вернул оригинал, не трогает аргументы и не глотает ошибки.
  // ------------------------------------------------------------------
  const requestLog = { seq: 0, entries: [] };
  const MAX_REQUEST_LOG = 200;

  function noteRequestStart(url) {
    const entry = {
      id: ++requestLog.seq,
      url: String(url == null ? '' : url),
      startedAt: Date.now(),
      finishedAt: null,
    };
    requestLog.entries.push(entry);
    if (requestLog.entries.length > MAX_REQUEST_LOG) {
      requestLog.entries.splice(0, requestLog.entries.length - MAX_REQUEST_LOG);
    }
    return entry;
  }

  function installRequestLog() {
    // Флаг-часовой: при повторной инъекции скрипта две обёртки поверх друг
    // друга давали бы двойные записи.
    if (window.__bulkApproveRequestLogInstalled) return;
    window.__bulkApproveRequestLogInstalled = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        this.__bulkApproveUrl = url;
      } catch (e) {
        /* журнал не имеет права мешать запросу */
      }
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      try {
        const entry = noteRequestStart(this.__bulkApproveUrl);
        this.addEventListener('loadend', () => {
          entry.finishedAt = Date.now();
        });
      } catch (e) {
        /* см. выше */
      }
      return origSend.apply(this, args);
    };

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, ...rest) {
        let entry = null;
        try {
          entry = noteRequestStart(input && input.url ? input.url : input);
        } catch (e) {
          /* см. выше */
        }
        const done = () => {
          if (entry) entry.finishedAt = Date.now();
        };
        let result;
        try {
          result = origFetch.call(this, input, ...rest);
        } catch (e) {
          done();
          throw e;
        }
        if (result && typeof result.then === 'function') {
          // Возвращаем ИСХОДНЫЙ промис: цепочка вызывающего не меняется
          result.then(done, done);
        } else {
          done();
        }
        return result;
      };
    }
  }

  // Отметка «сейчас» в журнале: всё, что стартовало позже неё, относится к
  // текущему шагу, а не к тому, что висело на странице раньше.
  function requestLogMark() {
    return requestLog.seq;
  }

  function matchesEndpoint(url, needle) {
    // Пустой адрес — не совпадение ни с чем. В замерах попадался запрос,
    // у которого URL не прочитался; такие просто не считаются отслеживаемыми
    // и не должны ронять ожидание.
    return url !== '' && url.toLowerCase().includes(String(needle).toLowerCase());
  }

  // Сколько запросов, начатых после отметки, ещё не завершились. В отличие
  // от trackedRequestsSince здесь не важно, куда запрос шёл: за выдачей
  // таблицы сайт ходит с пустым URL (проверено на боевой странице), и
  // опознать этот запрос по адресу невозможно — считаем любые.
  function requestsInFlightSince(mark) {
    return requestLog.entries.filter((e) => e.id > mark && e.finishedAt === null).length;
  }

  function trackedRequestsSince(mark) {
    return requestLog.entries.filter(
      (e) =>
        e.id > mark &&
        CONFIG.transactionLoadEndpoints.some((needle) => matchesEndpoint(e.url, needle))
    );
  }

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

  // Известное окно сайта: «Обращение с этим номером транзакции уже создано: N».
  // Иконка question, кнопка подтверждения подписана Copy (копирует номер в
  // буфер обмена), рядом Cancel. Нажимать Copy нельзя: буфер нужен человеку
  // для вставки списков, и затирать его посреди прогона мы не вправе.
  // Безопасное закрытие здесь — именно Cancel, он просто закрывает окно.
  const DUPLICATE_POPUP_PATTERNS = [
    /номером\s+транзакции\s+уже\s+создано/i,
    /транзакци[яю]\s+уже\s+использует/i,
  ];

  function isDuplicateTransactionPopup(info) {
    const text = `${info.title} ${info.content}`;
    return DUPLICATE_POPUP_PATTERNS.some((re) => re.test(text));
  }

  // Номер обращения, которое уже держит эту транзакцию
  function extractOwnerTicketId(info) {
    const match = `${info.title} ${info.content}`.match(/(\d{5,})/);
    return match ? match[1] : null;
  }

  const swalObserver = new MutationObserver(() => {
    const popup = document.querySelector('.swal2-popup');
    if (!popup || popup.dataset.bulkApproveHandled) return;
    popup.dataset.bulkApproveHandled = '1'; // не обрабатываем один и тот же попап дважды

    const info = classifySwalPopup(popup);

    if (info.isKnownSuccessDismiss) {
      info.confirmBtn.click();
      console.log(
        `[BulkApproveBETA] Закрыл попап как безопасный (тикет ${currentTicketId || '—'}): ` +
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
      `[BulkApproveBETA] Поймано окно (тикет ${currentTicketId || '—'}, TXN ${currentTransactionId || '—'}): ` +
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

  // Ждёт, пока сайт закончит догружать данные после ввода Transaction ID.
  //
  // mark    — отметка журнала, снятая ДО ввода
  // inputAt — момент ввода (от него считаются все сроки)
  //
  // Возвращает { ok: true, secondWaveMissing } либо { ok: false, reason }.
  // Вся логика ожидания живёт здесь одна: если тайминги сайта изменятся,
  // править надо только эту функцию и константы в CONFIG.
  async function waitForTransactionDataLoaded(mark, inputAt) {
    const firstEndpoint = CONFIG.transactionLoadEndpoints[0];
    const secondEndpoint = CONFIG.transactionLoadSecondWave;

    // Первая волна обязана уйти. Если её нет — сайт не увидел наш ввод, и
    // это самый опасный исход из возможных: пойти дальше означало бы менять
    // статус тикету, которому мы на самом деле ничего не вписали.
    try {
      await waitFor(
        () => trackedRequestsSince(mark).some((e) => matchesEndpoint(e.url, firstEndpoint)),
        CONFIG.transactionLoadFirstRequestTimeout
      );
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      return { ok: false, reason: 'transaction-load-not-started' };
    }

    const hardDeadline = inputAt + CONFIG.transactionLoadTimeout;
    const secondWaveDeadline = inputAt + CONFIG.transactionLoadSecondWaveTimeout;
    let secondWaveSeen = false;
    let secondWaveMissing = false;

    for (;;) {
      checkStop();

      const now = Date.now();
      const tracked = trackedRequestsSince(mark);
      const inFlight = tracked.filter((e) => e.finishedAt === null);
      const finished = tracked.filter((e) => e.finishedAt !== null);
      const lastFinishedAt = finished.reduce((max, e) => Math.max(max, e.finishedAt), 0);

      if (!secondWaveSeen) {
        secondWaveSeen = finished.some((e) => matchesEndpoint(e.url, secondEndpoint));
      }
      // Второй волны может не быть вовсе — например, если транзакция не
      // найдена. Тогда через свой срок идём дальше, но помечаем результат:
      // молчать об этом нельзя.
      if (!secondWaveSeen && !secondWaveMissing && now >= secondWaveDeadline) {
        secondWaveMissing = true;
      }

      const settled =
        (secondWaveSeen || secondWaveMissing) &&
        now - inputAt >= CONFIG.transactionLoadSettleAfterInput &&
        inFlight.length === 0 &&
        lastFinishedAt > 0 &&
        now - lastFinishedAt >= CONFIG.transactionLoadQuietPeriod;

      if (settled) return { ok: true, secondWaveMissing };
      if (now >= hardDeadline) return { ok: false, reason: 'transaction-load-timeout' };

      await interruptibleSleep(CONFIG.transactionLoadPollInterval);
    }
  }

  function fireClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  // Записывает значение в поле ввода так, чтобы Vue его заметил. Простое
  // input.value = x реактивность не тронет: нужно звать нативный сеттер
  // (иначе перехватчик Vue не сработает) и разослать input + change.
  //
  // Прототип выбирается по тегу не для красоты: сеттер HTMLInputElement,
  // позванный на <textarea>, падает с "Illegal invocation". Поле фильтра
  // «Ticket ID» на странице — именно textarea.
  function setInputValue(input, value) {
    const proto =
      input.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Виден ли элемент. Намеренно НЕ через offsetParent: блок быстрых
  // фильтров прячется через style="display: none" на родителе, и проверять
  // надо именно цепочку родителей.
  function isElementVisible(el) {
    if (!el) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
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

  // Видимое окно SweetAlert2 (в том числе то, которое мы намеренно НЕ закрыли —
  // например, сообщение об ошибке). getOpenModal() про swal2 ничего не знает:
  // это разные сущности, поэтому нужна отдельная проверка.
  function getOpenSwalPopup() {
    const popup = document.querySelector('.swal2-popup');
    if (!popup) return null;
    const style = window.getComputedStyle(popup);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    return popup;
  }

  // Достаёт номер тикета из произвольного текста ("Change ticket no.19983972",
  // содержимое ячейки Ticket ID и т.п.)
  function extractTicketNumber(text) {
    const match = String(text == null ? '' : text).match(/\d{4,}/);
    return match ? match[0] : null;
  }

  // Номер тикета из заголовка открытой модалки ("Change ticket no.19983972").
  // Берём именно div.title: у полей формы заголовки — это span.title.
  function getModalTicketId(modal) {
    const titleEls = modal.querySelectorAll('div.title');
    for (const el of titleEls) {
      const match = el.textContent.match(/(?:no\.?|№)\s*(\d{4,})/i);
      if (match) return match[1];
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Поиск колонок по названию из шапки таблицы (на случай, если у
  // другого пользователя колонки перетащены в другом порядке)
  // ------------------------------------------------------------------
  let columnIndexMap = null; // { 'external status': 8, 'ticket id': 9, ... } (1-based, как в nth-child)

  function refreshColumnIndexMap() {
    const headerCells = document.querySelectorAll('.table-wrapper thead th');
    if (headerCells.length === 0) {
      console.warn('[BulkApproveBETA] Не найдены заголовки таблицы — использую резервные номера колонок.');
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
        `[BulkApproveBETA] Не найдены колонки по названию: ${missing.join(', ')} — для них будут использованы резервные номера.`
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

  // Приводит External Status к сравнимому виду: нижний регистр, схлопнутые
  // пробелы (включая неразрывные) и БЕЗ числового кода в начале. Код
  // отбрасывается намеренно: в фильтре статусы подписаны с номером
  // («203 Sent (M)»), а в колонке таблицы тот же статус может выводиться и
  // без него — сравнение «как есть» тогда молча не находило бы ни одного
  // тикета. Потери точности тут нет: два статуса с одинаковым текстом и
  // разными кодами по этой колонке всё равно не различить.
  function normalizeExternalStatus(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\d+\s+/, '');
  }

  function matchesRequiredExternalStatus(workflow, externalStatus) {
    const actual = normalizeExternalStatus(externalStatus);
    if (actual === '') return false;
    return workflow.requiredExternalStatuses.some(
      (required) => normalizeExternalStatus(required) === actual
    );
  }

  // Номер колонки Transaction Status: точное название, затем поиск по
  // подстроке (на случай «Transaction status (payout)» и подобного) —
  // требуются ОБА слова, чтобы не подхватить External Status. Резервного
  // номера нет намеренно: не прочитать статус безопаснее, чем прочитать не ту
  // ячейку и решить, что транзакция отклонена.
  function getTransactionStatusColumnIndex() {
    const exact = getColumnIndex('transaction status');
    if (exact) return exact;
    if (!columnIndexMap) return null;
    const key = Object.keys(columnIndexMap).find(
      (name) => name.includes('transaction') && name.includes('status')
    );
    return key ? columnIndexMap[key] : null;
  }

  // Текст колонки Transaction Status, либо null, если колонки нет. null и
  // пустая строка — разные вещи: первое значит «сверять не с чем», второе —
  // «в ячейке ничего не написано»; и то и другое не даёт права обрабатывать
  // тикет, но в отчёте это разные строки.
  function getTransactionStatusFromRow(row) {
    const idx = getTransactionStatusColumnIndex();
    if (!idx) return null;
    const cell = row.querySelector(`td:nth-child(${idx})`);
    if (!cell) return null;
    return cell.textContent.trim();
  }

  // Совпадает ли статус транзакции с требуемым. Сверяем по словам, а не
  // строкой целиком: в колонке попадаются варианты с кодом и пометкой
  // («Rejected», «3 Rejected», «Rejected (M)»).
  function matchesTransactionStatus(actual, required) {
    if (actual == null) return false;
    const words = (v) => ` ${String(v).toLowerCase().replace(/[^a-z]+/g, ' ').trim()} `;
    const want = words(required);
    return want !== '  ' && words(actual).includes(want);
  }

  // Номер колонки Processing Date: точное название, затем поиск по подстроке
  // («Processing date (UTC)» и подобное). Резервного номера нет: это
  // статистика, и лучше честно её не показать, чем посчитать по чужой
  // колонке.
  function getProcessingDateColumnIndex() {
    const exact = getColumnIndex('processing date');
    if (exact) return exact;
    if (!columnIndexMap) return null;
    const key = Object.keys(columnIndexMap).find(
      (name) => name.includes('processing') && name.includes('date')
    );
    return key ? columnIndexMap[key] : null;
  }

  // Разбирает содержимое ячейки Processing Date в Date, либо возвращает null.
  //
  // Дата и время в ячейке стоят на разных строках, и в textContent между ними
  // может не оказаться вообще ничего («2026-09-2214:45:59»), поэтому ищем
  // регуляркой по цифрам, а не режем по пробелу. Время необязательно: если в
  // ячейке только дата, считаем её началом суток.
  //
  // ВАЖНО: время считается по часам браузера. Если сайт однажды начнёт
  // показывать эту колонку в другом часовом поясе, граница «24 часа» уедет
  // на величину смещения — статистика останется осмысленной, но у тикетов
  // возле самой границы отнесение может измениться.
  function parseProcessingDate(raw) {
    const m = String(raw == null ? '' : raw).match(
      /(\d{4})-(\d{1,2})-(\d{1,2})(?:\D*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
    );
    if (!m) return null;

    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const [hours, minutes, seconds] = [Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];

    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    // Отсекаем несуществующие даты (13-й месяц, 31 февраля): конструктор Date
    // молча их переносит, и «31.02» превратилось бы в 3 марта.
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hours
    ) {
      return null;
    }

    return date;
  }

  // Возраст тикета в часах на момент вызова, либо null, если колонки нет или
  // дату не удалось разобрать. Возвращает и сырой текст — он попадает в
  // результат прогона, чтобы в консоли было видно, из чего считали.
  function getProcessingAgeFromRow(row) {
    const idx = getProcessingDateColumnIndex();
    if (!idx) return null;
    const cell = row.querySelector(`td:nth-child(${idx})`);
    if (!cell) return null;

    const raw = cell.textContent.trim();
    const date = parseProcessingDate(raw);
    if (!date) return { raw, ageHours: null };

    return { raw, ageHours: (Date.now() - date.getTime()) / 3600000 };
  }

  function getTransactionIdFromRow(row) {
    const idx = getColumnIndex('transaction id', 11);
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.textContent.trim() : '';
  }

  // Номер колонки Transaction ID строго по названию, БЕЗ резервного номера.
  // Отличается от getTransactionIdFromRow намеренно: там резервный индекс 11
  // уместен (привязка пойманных окон к тикету — не критичное решение), а
  // здесь по значению решается, перезаписывать ли номер транзакции. Прочитать
  // не ту колонку и на этом основании что-то решить — недопустимо.
  function getTransactionIdColumnIndex() {
    const exact = getColumnIndex('transaction id');
    if (exact) return exact;
    if (!columnIndexMap) return null;
    const key = Object.keys(columnIndexMap).find(
      (name) => name.includes('transaction') && name.includes('id')
    );
    return key ? columnIndexMap[key] : null;
  }

  // Текст колонки Transaction ID, либо null, если колонку не нашли по имени.
  function getTransactionIdByName(row) {
    const idx = getTransactionIdColumnIndex();
    if (!idx) return null;
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.textContent.trim() : null;
  }

  // Превращает текст денежной ячейки в число: убирает валютные символы,
  // пробелы и разделители тысяч. Возвращает null, если разобрать не вышло
  // (ячейка пустая или там не число).
  // Приводит денежную строку к виду «-1234.56»: убирает валюту и пробелы всех
  // видов (включая неразрывные) и разбирается с разделителями.
  // Возвращает null, если разобрать не вышло.
  //
  // Разделители неоднозначны: «1,234» — это тысяча двести тридцать четыре или
  // одна целая двести тридцать четыре тысячных? Правила:
  //   • есть и точка, и запятая — десятичный тот, что ПОСЛЕДНИЙ, второй убираем
  //     как разделитель тысяч (1.234,56 → 1234.56 и 1,234.56 → 1234.56);
  //   • только запятая — десятичная, если после неё 1-2 цифры (1,50 → 1.50),
  //     иначе разделитель тысяч (1,234 → 1234);
  //   • только точка — трогать не надо, она уже десятичная.
  function normalizeAmountString(raw) {
    let s = String(raw == null ? '' : raw).replace(/[\s\u00A0\u202F\u2009]/g, '');
    const negative = s.includes('-');
    s = s.replace(/[^\d.,]/g, '');
    if (s === '') return null;

    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');

    if (lastDot !== -1 && lastComma !== -1) {
      const decimalSep = lastDot > lastComma ? '.' : ',';
      const thousandsSep = decimalSep === '.' ? ',' : '.';
      s = s.split(thousandsSep).join('');
      s = s.replace(decimalSep, '.');
    } else if (lastComma !== -1) {
      const afterComma = s.length - lastComma - 1;
      s = afterComma > 0 && afterComma <= 2 ? s.replace(',', '.') : s.split(',').join('');
    }

    // На этом месте допустима ровно одна точка
    if ((s.match(/\./g) || []).length > 1) return null;
    if (s === '' || s === '.') return null;
    if (Number.isNaN(Number(s))) return null;

    return (negative ? '-' : '') + s;
  }

  // Число из денежной строки (0, если сумма 0), либо null, если распарсить
  // не удалось (ячейка пустая или там не число).
  function parseAmountText(raw) {
    const normalized = normalizeAmountString(raw);
    return normalized === null ? null : Number(normalized);
  }

  // Совпадают ли две денежные строки ЧИСЛЕННО. Сравнивать строками нельзя:
  // сайт вправе показать «1 500.00» там, где мы записали «1500.00», — это то
  // же самое число, а не расхождение.
  function sameAmount(a, b) {
    const na = parseAmountText(a);
    const nb = parseAmountText(b);
    if (na === null || nb === null) return false;
    return Math.abs(na - nb) < 0.005;
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
    return { raw, value: parseAmountText(raw) };
  }

  // Номер колонки Transaction Amount. Сначала точное совпадение названия,
  // затем запасной поиск по подстроке — на случай, если колонка называется
  // «Transaction amount, USD» и подобное. Подстрока требует ОБА слова, чтобы
  // не перепутать её с простой колонкой Amount. Резервного номера нет
  // намеренно: прочитать не ту денежную ячейку хуже, чем не прочитать ничего.
  function getTransactionAmountColumnIndex() {
    const exact = getColumnIndex('transaction amount');
    if (exact) return exact;
    if (!columnIndexMap) return null;
    const key = Object.keys(columnIndexMap).find(
      (name) => name.includes('transaction') && name.includes('amount')
    );
    return key ? columnIndexMap[key] : null;
  }

  // Возвращает { raw, value } из колонки Transaction Amount, либо null, если
  // колонки нет. raw — текст ячейки как есть (именно он попадёт в поле
  // Amount by receipt), value нужен только чтобы отличить «сумма есть» от
  // «там пусто/ноль/не число».
  function getTransactionAmountFromRow(row) {
    const idx = getTransactionAmountColumnIndex();
    if (!idx) return null;
    const cell = row.querySelector(`td:nth-child(${idx})`);
    if (!cell) return null;
    const raw = cell.textContent.trim();
    return { raw, value: parseAmountText(raw) };
  }

  // Единственное место, где решается, в каком виде сумма попадёт в поле
  // Amount by receipt. Вписываем чистое число: в 2.6 значение вставлялось
  // текстом ячейки как есть (вместе с валютой и пробелом-разделителем), и
  // часть тикетов закрывалась со статусом, но без суммы — сайт такую строку
  // не сохранял, а на непустое поле не ругался.
  //
  // Возвращает строку для вставки либо null, если формат ячейки понять
  // не удалось. Через Number намеренно НЕ гоняем: «1500.00» превратилось бы
  // в «1500», а копейки лучше сохранить как есть.
  function formatAmountForReceipt(raw) {
    return normalizeAmountString(raw);
  }

  function getEditLinkFromRow(row) {
    const idx = getColumnIndex('actions', 3);
    const cell = row.querySelector(`td:nth-child(${idx})`);
    return cell ? cell.querySelector('a') : null;
  }

  // Ищем строку по номеру тикета, а НЕ по позиции в таблице: таблица
  // перерисовывается прямо во время прогона (частое применение фильтров,
  // ответы сервера), строки сдвигаются — и обращение по индексу молча
  // подсунуло бы другой тикет или навсегда пропустило один из них.
  function findRowByTicketId(ticketId) {
    const wanted = extractTicketNumber(ticketId);
    if (!wanted) return null;
    return getTicketRows().find((r) => extractTicketNumber(getTicketIdFromRow(r)) === wanted) || null;
  }

  // Находит .input-group внутри модалки, где <span class="title"> точно равен label
  // ------------------------------------------------------------------
  // АВТОПИЛОТ: скрипт сам подставляет тикеты в фильтр сайта пачками.
  //
  // Раньше режим «по списку» работал только с тем, что оператор уже вывел
  // на экран: вставил сотню номеров в поиск, нажал Apply, запустил прогон,
  // дождался, вставил следующую сотню. На списке в пятьсот тикетов это пять
  // ручных заходов, между которыми прогон стоит и ждёт человека.
  //
  // Здесь тот же цикл делает скрипт. Пачка — ровно autopilotChunkSize: это
  // предел одной страницы выдачи, а пагинацией пользоваться нельзя
  // (страницы нестабильны, прогон по ним терял бы тикеты молча).
  // ------------------------------------------------------------------

  // Поле фильтра «Ticket ID» — textarea, номера в нём разделяются переводом
  // строки. Сначала ищем внутри формы фильтров, потом по всей странице:
  // форма может называться иначе, а плейсхолдер у поля уникален.
  function getTicketIdFilterInput() {
    return (
      document.querySelector('#filter_form textarea[placeholder="Ticket ID"]') ||
      document.querySelector('textarea[placeholder="Ticket ID"]')
    );
  }

  function getFilterApplyButton() {
    return (
      document.querySelector('#filter_form .btn-block button[type="submit"]') ||
      document.querySelector('#filter_form button[type="submit"]')
    );
  }

  // Кнопка, раскрывающая блок быстрых фильтров. Ищем по подписи, а не по
  // порядковому номеру: рядом стоят ещё «Filters» и «Column settings».
  function getQuickFiltersToggle() {
    return Array.from(document.querySelectorAll('button.btn-settings-columns')).find((b) =>
      /quick\s*filters/i.test(b.textContent || '')
    );
  }

  // Чего не хватает для автопилота. Пустой массив — всё на месте.
  function autopilotMissingControls() {
    const missing = [];
    if (!getTicketIdFilterInput()) missing.push('поле фильтра «Ticket ID»');
    if (!getFilterApplyButton()) missing.push('кнопка Apply у фильтров');
    return missing;
  }

  function chunkArray(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  // Состав таблицы одной строкой — по нему видно, перестроилась она или нет.
  // Берём текст ячеек, а не номера тикетов: номер читается через карту
  // колонок, которая на момент перестройки может быть ещё старой.
  function tableSignature() {
    return getTicketRows()
      .map((row) => row.textContent.replace(/\s+/g, ' ').trim())
      .join('§');
  }

  // Ждёт, пока сайт перестроит таблицу после Apply.
  //
  // Ориентируемся на состав таблицы, а не на запросы: запрос за выдачей
  // уходит с пустым URL (проверено на боевой странице), и отличить его от
  // любого другого нечем.
  //
  // Возвращает { ok: true, empty } либо { ok: false, reason }.
  async function waitForTableAfterApply(mark, clickedAt) {
    const hardDeadline = clickedAt + CONFIG.autopilotTableTimeout;
    let lastSignature = null;
    let stableSince = 0;

    for (;;) {
      checkStop();

      const now = Date.now();
      const signature = tableSignature();
      const rowCount = getTicketRows().length;

      if (signature !== lastSignature) {
        lastSignature = signature;
        stableSince = now;
      }

      const settledLongEnough = now - clickedAt >= CONFIG.autopilotTableSettleMin;
      // Пустая таблица и «таблица ещё грузится» выглядят на экране одинаково,
      // поэтому пустой выдаче нужен свой, более длинный срок И отсутствие
      // незакрытых запросов. Ошибиться здесь не страшно — тикеты такой пачки
      // остаются в памяти списка и попадут в следующий прогон, — но обидно,
      // и лишняя проверка стоит дёшево.
      const quietLongEnough =
        now - stableSince >=
        (rowCount === 0 ? CONFIG.autopilotEmptyConfirm : CONFIG.autopilotTableQuietPeriod);
      const nothingPending = rowCount > 0 || requestsInFlightSince(mark) === 0;

      if (settledLongEnough && quietLongEnough && nothingPending) {
        return { ok: true, empty: rowCount === 0 };
      }
      if (now >= hardDeadline) return { ok: false, reason: 'table-timeout' };

      await interruptibleSleep(200);
    }
  }

  // Подставляет пачку номеров в фильтр и дожидается новой выдачи.
  //
  // Возвращает { ok: true, ticketIds } либо { ok: false, reason, detail },
  // где reason — код для сообщения об остановке прогона.
  async function applyTicketIdFilter(ticketIds, workflow) {
    const log = `[BulkApproveBETA/${workflow.id}]`;

    const area = getTicketIdFilterInput();
    if (!area) return { ok: false, reason: 'no-filter-input' };

    const applyBtn = getFilterApplyButton();
    if (!applyBtn) return { ok: false, reason: 'no-apply-button' };

    // Блок быстрых фильтров может быть свёрнут. Поле при этом в DOM есть, но
    // скрыто — писать в скрытое поле сайт, скорее всего, примет, однако
    // проверить это нечем, а разворачивать блок дёшево.
    if (!isElementVisible(area)) {
      const toggle = getQuickFiltersToggle();
      if (!toggle) return { ok: false, reason: 'quick-filters-collapsed' };
      console.log(`${log} Блок быстрых фильтров свёрнут — раскрываю.`);
      fireClick(toggle);
      try {
        await waitFor(() => isElementVisible(getTicketIdFilterInput()), 5000);
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        return { ok: false, reason: 'quick-filters-collapsed' };
      }
    }

    const text = ticketIds.join('\n');
    setInputValue(area, text);

    // Читаем обратно. Это не тавтология из 2.7: там мы проверяли собственную
    // запись в поле, значение которого потом всё равно уходило из Vue-модели.
    // Здесь поле — вход фильтра, и если сайт его подрезал (маска, лимит
    // длины), то в выдачу уедет не тот набор тикетов, а узнать об этом после
    // Apply будет уже неоткуда.
    const readBack = String(area.value == null ? '' : area.value);
    const missing = ticketIds.filter((id) => !readBack.includes(id));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: 'filter-value-rejected',
        detail: `в поле не оказалось ${missing.length} из ${ticketIds.length} номеров`,
      };
    }

    console.log(`${log} Подставил в фильтр ${ticketIds.length} тикетов, жму Apply.`);
    const mark = requestLogMark();
    const clickedAt = Date.now();
    fireClick(applyBtn);

    const waited = await waitForTableAfterApply(mark, clickedAt);
    if (!waited.ok) return { ok: false, reason: waited.reason };

    // Набор колонок после перестройки теоретически тот же, но карта колонок
    // снималась до Apply и с тех пор пережила полное пересоздание таблицы.
    // Перечитать её дешевле, чем однажды прочитать номер тикета из чужой
    // колонки.
    refreshColumnIndexMap();

    if (waited.empty) {
      console.warn(`${log} По этой пачке сайт не показал ни одного тикета.`);
      return { ok: true, ticketIds: [] };
    }

    const shown = getTicketRows().map((row) => getTicketIdFromRow(row));
    const asked = new Set(ticketIds);
    const strangers = shown.filter((id) => !asked.has(id));

    // Главная страховка автопилота. Если в выдаче есть хоть один тикет, о
    // котором мы не спрашивали, значит фильтр не применился — и мы сейчас
    // собираемся обрабатывать чужую выборку. Такое должно останавливать
    // прогон, а не пролезать в отчёт строкой статистики.
    if (strangers.length > 0) {
      return {
        ok: false,
        reason: 'filter-not-applied',
        detail:
          `в выдаче ${strangers.length} тикетов, которых не было в пачке ` +
          `(например ${strangers.slice(0, 3).join(', ')})`,
      };
    }

    console.log(`${log} Сайт показал ${shown.length} тикетов из ${ticketIds.length} запрошенных.`);
    return { ok: true, ticketIds: shown };
  }

  // Формулировки для остановок автопилота. Держим рядом с кодами, которые
  // возвращает applyTicketIdFilter.
  function describeAutopilotFailure(reason, detail) {
    const tail = detail ? ` (${detail})` : '';
    switch (reason) {
      case 'no-filter-input':
        return 'на странице не нашлось поле фильтра «Ticket ID» — подставить пачку некуда';
      case 'no-apply-button':
        return 'на странице не нашлась кнопка Apply у фильтров — применить пачку нечем';
      case 'quick-filters-collapsed':
        return 'блок быстрых фильтров свёрнут, и раскрыть его не удалось';
      case 'filter-value-rejected':
        return `сайт не принял список номеров в поле фильтра${tail}`;
      case 'table-timeout':
        return `таблица не перестроилась за ${CONFIG.autopilotTableTimeout / 1000} с после Apply`;
      case 'filter-not-applied':
        return `фильтр не применился${tail} — обрабатывать эту выдачу нельзя`;
      default:
        return `не удалось подставить пачку (${reason})`;
    }
  }

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
        `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не удалось закрыть модалку после ошибки (${result.reason}) — ` +
        `перед следующим тикетом попробую закрыть её ещё раз; если снова не выйдет, прогон остановится автоматически.`
      );
    }
    return result;
  }

  // ------------------------------------------------------------------
  // ПРОВЕРКА, ЧТО СУММА ДЕЙСТВИТЕЛЬНО СОХРАНИЛАСЬ.
  //
  // Зачем отдельная проверка. До 2.7 скрипт считал доказательством чтение
  // input.value сразу после записи — но это тавтология: читается то же
  // значение, которое сами и записали. На Apply уходит внутренняя модель Vue,
  // и если она значение не подхватила (или бэкенд его не разобрал), тикет
  // закрывался с новым статусом, но без суммы. Окно «Amount on receipt field
  // must be filled in» при этом не появлялось: оно про ПУСТОЕ поле, а здесь
  // поле было непустым — просто негодным.
  //
  // Сначала смотрим колонку Amount в строке: после сохранения там должна
  // появиться сумма, и это не стоит ни одного лишнего окна. Если там всё ещё
  // ноль (или таблица не перечиталась с сервера) — переоткрываем Edit и
  // читаем поле напрямую.
  //
  // Возвращает { verdict, storedAmount, note }:
  //   'saved'      — число совпало;
  //   'not-saved'  — сумма не сохранилась или сохранилась другой;
  //   'unverified' — проверить не удалось (строки нет, окно не открылось и т.п.).
  // ------------------------------------------------------------------
  // Общая проверка «значение действительно сохранилось», одна на все поля.
  //
  // Родилась из verifyAmountSaved (2.7) — там же описана причина её
  // существования: чтение того же input.value, который мы сами и записали,
  // не доказывает ничего, потому что на Apply уходит модель Vue. Настоящая
  // проверка возможна только ПОСЛЕ Apply.
  //
  // Параметры различий между полями всего три: чем читать из строки таблицы,
  // как сравнивать и как называется поле в окне.
  async function verifyFieldSaved(opts) {
    const { ticketId, workflow, fieldLabel, expected, readFromRow, isSame, rowSourceName } = opts;

    let row;
    try {
      // Таблица после Apply обычно перечитывается — даём строке вернуться
      row = await waitFor(() => findRowByTicketId(ticketId), 5000);
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      return { verdict: 'unverified', note: 'строка пропала из таблицы после сохранения' };
    }

    // Быстрый путь: значение уже видно в списке — значит, сервер его принял
    const rowValue = readFromRow(row);
    if (rowValue !== null && rowValue !== '' && isSame(rowValue, expected)) {
      return { verdict: 'saved', stored: rowValue, note: `подтверждено по ${rowSourceName}` };
    }

    // Путь сомнения: в списке по-прежнему не то — но это может быть и просто
    // неперечитанная таблица. Открываем тикет и смотрим само поле.
    const editLink = getEditLinkFromRow(row);
    if (!editLink) {
      return { verdict: 'unverified', note: 'в строке нет кнопки Edit для перепроверки' };
    }

    fireClick(editLink);

    try {
      let modal;
      try {
        modal = await waitFor(() => getOpenModal());
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        return { verdict: 'unverified', note: 'окно не открылось для перепроверки' };
      }

      // Та же паранойя, что и в основном проходе: читать чужое окно нельзя,
      // иначе можно объявить значение сохранённым по данным другого тикета.
      let modalTicketId;
      try {
        modalTicketId = await waitFor(() => getModalTicketId(modal));
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        return { verdict: 'unverified', note: 'не удалось прочитать номер тикета в окне проверки' };
      }
      if (modalTicketId !== extractTicketNumber(ticketId)) {
        return {
          verdict: 'unverified',
          note: `при перепроверке открылся другой тикет (${modalTicketId})`,
        };
      }

      let group;
      try {
        group = await waitFor(() => findFieldGroup(modal, fieldLabel));
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        return { verdict: 'unverified', note: `в окне проверки нет поля ${fieldLabel}` };
      }

      const input = group.querySelector(
        'input.mx-input, input[type="text"]:not(.multiselect__input)'
      );
      const stored = input ? input.value.trim() : '';

      if (stored !== '' && isSame(stored, expected)) {
        return { verdict: 'saved', stored, note: 'подтверждено по полю в окне' };
      }

      return {
        verdict: 'not-saved',
        stored,
        note: stored === '' ? 'поле пустое' : `в поле "${stored}"`,
      };
    } finally {
      // Окно проверки обязано закрыться при ЛЮБОМ исходе: незакрытая модалка
      // роняет следующий тикет каскадом (stale-modal-before-edit), из-за
      // которого транзакция уже уезжала в чужой тикет.
      tryCancelModal();
      try {
        await waitForGone(() => getOpenModal(), 3000);
      } catch (e) {
        if (!(e instanceof StopSignal)) {
          console.warn(
            `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: окно проверки не закрылось — ` +
            `перед следующим тикетом скрипт попробует закрыть его ещё раз.`
          );
        }
      }
    }
  }

  function verifyAmountSaved(ticketId, expectedAmount, workflow) {
    return verifyFieldSaved({
      ticketId,
      workflow,
      fieldLabel: 'Amount by receipt',
      expected: expectedAmount,
      readFromRow: (row) => {
        const amount = getAmountFromRow(row);
        return amount ? amount.raw : null;
      },
      isSame: sameAmount,
      rowSourceName: 'колонке Amount',
    });
  }

  function verifyTransactionIdSaved(ticketId, expected, workflow) {
    return verifyFieldSaved({
      ticketId,
      workflow,
      fieldLabel: 'Transaction ID',
      expected,
      // Только по названию колонки: прочитать чужую и объявить сохранение
      // хуже, чем лишний раз переоткрыть окно.
      readFromRow: getTransactionIdByName,
      // Строгое сравнение: номер транзакции не число, нормализовать нельзя
      isSame: (a, b) => String(a).trim() === String(b).trim(),
      rowSourceName: 'колонке Transaction ID',
    });
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
      // Transaction ID и возраст тикета навешиваем здесь, в одной точке, а не
      // в каждом из полутора десятков return'ов внутри processTicketInner.
      // Первый нужен для окна «скопировать в таблицу», второй — для сводки
      // «свежих / зависших» в конце прогона. Возраст берём до обработки: это
      // сколько тикет реально прождал, а не сколько прошло к концу прогона.
      const processing = getProcessingAgeFromRow(row);
      const result = await processTicketInner(row, ticketId, index, total, workflow);
      if (result && !result.transactionId) result.transactionId = transactionId;
      if (result && processing) {
        result.processingDate = processing.raw;
        result.ageHours = processing.ageHours;
      }
      return result;
    } finally {
      currentTicketId = null;
      currentTransactionId = null;
    }
  }

  async function processTicketInner(row, ticketId, index, total, workflow) {
    const externalStatus = getExternalStatusFromRow(row);

    if (!matchesRequiredExternalStatus(workflow, externalStatus)) {
      console.log(
        `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: External Status = "${externalStatus}" ` +
        `(нужен один из: ${workflow.requiredExternalStatuses.join(' / ')}) — пропускаю.`
      );
      return { ticketId, status: 'skipped', reason: 'wrong-external-status', externalStatus };
    }

    // Статус транзакции — второе обязательное условие, и проверяется оно до
    // открытия Edit: тикет с подходящим External Status, но не отклонённой
    // транзакцией закрывать ответом пользователю нельзя, и трогать его вообще
    // не надо. Не смогли прочитать — тоже не трогаем: «не знаю» здесь должно
    // работать как «нет», иначе широкий пул статусов становится опасным.
    if (workflow.requiredTransactionStatus) {
      const txStatus = getTransactionStatusFromRow(row);

      if (txStatus === null) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: не нашёл колонку ` +
          `Transaction Status — сверить статус транзакции нечем, пропускаю.`
        );
        return {
          ticketId,
          status: 'skipped',
          reason: 'no-transaction-status-column',
          externalStatus,
        };
      }

      if (!matchesTransactionStatus(txStatus, workflow.requiredTransactionStatus)) {
        console.log(
          `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: Transaction Status = ` +
          `"${txStatus}" (нужен "${workflow.requiredTransactionStatus}") — пропускаю.`
        );
        return {
          ticketId,
          status: 'skipped',
          reason: 'transaction-not-rejected',
          externalStatus,
          transactionStatus: txStatus,
        };
      }
    }

    // Отбор по списку. Он работает в обоих режимах со списком — и там, где
    // в списке пары «тикет → транзакция», и там, где одни номера тикетов.
    // Проверка стоит отдельно от подстановки номера специально: список сам
    // по себе решает, БРАТЬ ли тикет, а что в него вписать — вопрос второй.
    //
    // С автопилотом на экране и так только тикеты из пачки, но список — это
    // ещё и защита: если фильтр однажды вернёт не то, тикет не будет тронут
    // даже при подходящем статусе.
    if (currentListPairs && !currentListPairs.has(ticketId)) {
      console.log(
        `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: в списке его нет — пропускаю.`
      );
      return { ticketId, status: 'skipped', reason: 'not-in-list', externalStatus };
    }

    // Номер транзакции приходит не со страницы, а из списка. Решаем здесь,
    // что впишем, но саму запись делаем позже — внутри окна и только после
    // проверки личности тикета.
    let transactionIdToFill = null;
    if (workflow.fillTransactionIdFromList) {
      const wanted = currentListPairs ? currentListPairs.get(ticketId) : null;
      if (!wanted) {
        // Сюда можно попасть только если список есть, тикет в нём есть, а
        // номера у него нет — для этого режима список разбирается парами,
        // так что это означало бы сломанный разбор, а не обычный пропуск.
        console.warn(
          `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: ` +
          `в списке нет номера транзакции — пропускаю.`
        );
        return { ticketId, status: 'skipped', reason: 'not-in-list', externalStatus };
      }
      transactionIdToFill = wanted;

      // Дешёвая отсечка по таблице, если колонка нашлась ПО НАЗВАНИЮ. Тикет
      // с чужим номером транзакции даже не открываем: перезаписывать чужую
      // транзакцию нельзя, а разбираться с этим должен человек.
      const rowTx = getTransactionIdByName(row);
      if (rowTx !== null && rowTx !== '' && rowTx !== wanted) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: в списке стоит ` +
          `"${wanted}", а в тикете уже "${rowTx}" — ничего не меняю, нужна ручная проверка.`
        );
        return {
          ticketId,
          status: 'skipped',
          reason: 'transaction-id-mismatch',
          existingTransactionId: rowTx,
          wantedTransactionId: wanted,
          detectedIn: 'таблица',
          externalStatus,
        };
      }
    }

    // Тикеты с Amount = 0 раньше просто пропускались. Теперь решаем здесь,
    // ЧТО именно впишем в поле Amount by receipt — но саму запись делаем
    // позже, уже внутри открытого окна и только после проверки личности
    // тикета. Если подставить нечего — ведём себя как раньше: не открываем
    // тикет вообще и выносим его в список для ручной проверки.
    let amountToFill = null;
    if (workflow.fillAmountFromTransaction) {
      const amount = getAmountFromRow(row);
      if (amount && amount.value === 0) {
        const txAmount = getTransactionAmountFromRow(row);

        // Брать нечего: колонки нет, ячейка пустая или там ноль.
        if (!txAmount || txAmount.raw === '' || txAmount.value === 0) {
          console.log(
            `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: Amount = 0, ` +
            `и в Transaction Amount нечего взять (${txAmount ? `"${txAmount.raw}"` : 'колонка не найдена'}) — ` +
            `пропускаю, нужна ручная проверка.`
          );
          return { ticketId, status: 'skipped', reason: 'zero-amount', externalStatus };
        }

        amountToFill = formatAmountForReceipt(txAmount.raw);

        // В ячейке что-то есть, но это не разбирается как сумма («12.34.56»,
        // «USD», «—»). Отделяем от «нечего взять» специально: пустая ячейка и
        // нечитаемая — разные поводы, и вторая может означать, что на сайте
        // поменялся формат колонки и скрипт пора чинить.
        //
        // Второе условие — страховка для денег: вписываем не то, что
        // прочитали, а нормализованную строку, и обязаны убедиться, что она
        // осталась тем же числом. Сейчас обе функции считают одинаково, так
        // что сработать оно не должно; но formatAmountForReceipt — это
        // задокументированная точка смены формата, и если её однажды изменят
        // (округление, отбрасывание копеек), лучше не вписать ничего, чем
        // записать не ту сумму.
        if (amountToFill === null || txAmount.value === null || !sameAmount(amountToFill, txAmount.raw)) {
          console.warn(
            `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: не понял формат суммы ` +
            `"${txAmount.raw}" в Transaction Amount — не рискую вписывать, нужна ручная проверка.`
          );
          return {
            ticketId,
            status: 'skipped',
            reason: 'amount-format-unclear',
            transactionAmountRaw: txAmount.raw,
            externalStatus,
          };
        }

        console.log(
          `[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: Amount = 0 — ` +
          `впишу в Amount by receipt сумму из Transaction Amount "${txAmount.raw}" как "${amountToFill}".`
        );
      }
    }

    console.log(`[BulkApproveBETA/${workflow.id}] (${index + 1}/${total}) Тикет ${ticketId}: открываю Edit...`);

    checkStop();

    // ЗАЩИТА ОТ ЧУЖОГО ОКНА: окна с ошибкой мы намеренно не закрываем, чтобы
    // оператор успел прочитать текст. Но работать «сквозь» них нельзя: у
    // SweetAlert2 модальная подложка, живой человек кликнуть бы не смог, а
    // fireClick рассылает события напрямую и подложку обходит — то есть скрипт
    // действовал бы в заблокированном интерфейсе. Даём время закрыть окно
    // вручную, иначе останавливаем прогон.
    if (getOpenSwalPopup()) {
      console.warn(
        `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: на экране открыто окно сайта — жду, пока оно закроется...`
      );
      try {
        await waitForGone(() => getOpenSwalPopup(), CONFIG.blockingPopupTimeout);
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        const popup = getOpenSwalPopup();
        const info = popup ? classifySwalPopup(popup) : null;
        const popupText = info ? (info.content || info.title || info.icon) : '';
        runAbortReason =
          `Тикет ${ticketId}: на экране висит незакрытое окно сайта` +
          (popupText ? ` («${popupText}»)` : '') +
          `. Прогон остановлен — прочитай и закрой это окно, затем запусти заново.`;
        state.stopRequested = true;
        console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
        return { ticketId, status: 'failed', reason: 'blocking-popup' };
      }
    }

    // ЗАЩИТА ОТ ЗАЛИПШЕЙ МОДАЛКИ: если перед кликом Edit на экране всё ещё
    // висит модалка от предыдущего тикета, клик Edit НЕ даст чистую форму —
    // сайт переиспользует/смешивает состояние старой, и статус с Apply могут
    // примениться не к тому тикету (реальный инцидент: транзакция одного
    // тикета сохранилась в другой). Поэтому сначала пробуем закрыть остаток,
    // а если не вышло — останавливаем ВЕСЬ прогон: продолжать небезопасно.
    if (getOpenModal()) {
      console.warn(
        `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: перед открытием Edit висит модалка от предыдущего тикета — пробую закрыть...`
      );
      tryCancelModal();
      try {
        await waitForGone(() => getOpenModal(), 3000);
        console.log(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: залипшая модалка закрыта, продолжаю.`);
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        runAbortReason =
          `Тикет ${ticketId}: на экране висит незакрытая модалка от предыдущего тикета, и закрыть её не удалось. ` +
          `Прогон остановлен, чтобы статус не применился не к тому тикету. ` +
          `Закрой модалку вручную, проверь последние failed-тикеты и запусти прогон заново.`;
        state.stopRequested = true;
        console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
        return { ticketId, status: 'failed', reason: 'stale-modal-before-edit' };
      }
    }

    const editLink = getEditLinkFromRow(row);
    if (!editLink) {
      console.warn(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не найдена кнопка Edit, пропускаю.`);
      return { ticketId, status: 'failed', reason: 'no-edit-link' };
    }

    fireClick(editLink);

    // Ждём появления модалки
    let modal;
    try {
      modal = await waitFor(() => getOpenModal());
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      console.warn(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: модалка не появилась.`);
      return { ticketId, status: 'failed', reason: 'modal-not-shown' };
    }

    // ПРОВЕРКА ЛИЧНОСТИ ТИКЕТА — последний и главный рубеж.
    // Заголовок модалки выглядит как "Change ticket no.19983972". Сверяем его
    // с тикетом, который мы собирались открыть, ДО того как что-либо изменим.
    // Между чтением строки и кликом Edit таблица могла перерисоваться (Vue
    // переиспользует DOM-узлы), либо сайт мог показать старую модалку — тогда
    // статус и Apply ушли бы в чужой тикет. Именно так чужая транзакция
    // дважды попадала не в тот тикет.
    let modalTicketId;
    try {
      modalTicketId = await waitFor(() => getModalTicketId(modal));
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      console.error(
        `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не удалось прочитать номер тикета в заголовке модалки.`
      );
      const failResult = await failTicket(ticketId, workflow, {
        ticketId,
        status: 'failed',
        reason: 'modal-title-unreadable',
      });
      runAbortReason =
        `Тикет ${ticketId}: не удалось прочитать номер тикета в заголовке модалки, поэтому нельзя убедиться, ` +
        `что открыт нужный тикет. Прогон остановлен. Скорее всего, изменилась вёрстка модалки — нужно поправить скрипт.`;
      state.stopRequested = true;
      return failResult;
    }

    if (modalTicketId !== extractTicketNumber(ticketId)) {
      console.error(
        `[BulkApproveBETA/${workflow.id}] ОТКРЫЛСЯ НЕ ТОТ ТИКЕТ: ожидали ${ticketId}, в модалке ${modalTicketId}.`
      );
      const failResult = await failTicket(ticketId, workflow, {
        ticketId,
        status: 'failed',
        reason: 'modal-ticket-mismatch',
        modalTicketId,
      });
      runAbortReason =
        `ОТКРЫЛСЯ НЕ ТОТ ТИКЕТ: кликали Edit у тикета ${ticketId}, а в модалке оказался ${modalTicketId}. ` +
        `Ничего не меняли. Прогон остановлен — обнови страницу и запусти заново.`;
      state.stopRequested = true;
      return failResult;
    }

    await interruptibleSleep(CONFIG.stepDelay);

    // ------------------------------------------------------------------
    // ПОДСТАНОВКА TRANSACTION ID (только режим «по списку»).
    // Как и с суммой: делаем это ДО работы со Status и до Apply — личность
    // тикета уже подтверждена, а если подстановка сорвётся, статус останется
    // нетронутым и тикет не окажется обработан наполовину.
    // ------------------------------------------------------------------
    let transactionIdFilled = null;
    let transactionLoadNote = null;
    if (transactionIdToFill) {
      setProgress({ action: 'вписываю Transaction ID' });

      let txGroup;
      try {
        txGroup = await waitFor(() => findFieldGroup(modal, 'Transaction ID'));
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: в окне нет поля Transaction ID.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'failed',
          reason: 'no-transaction-id-field',
        });
      }

      const txInput = txGroup.querySelector(
        'input.mx-input, input[type="text"]:not(.multiselect__input)'
      );
      if (!txInput) {
        // В Team Helper у чтения Transaction ID есть откат на нередактируемое
        // значение — значит, у части тикетов поля для ввода может не быть.
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: поле Transaction ID найдено, но внутри нет текстового input.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'failed',
          reason: 'no-transaction-id-field',
        });
      }

      const existingTx = txInput.value.trim();
      if (existingTx !== '' && existingTx !== transactionIdToFill) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: в окне уже стоит "${existingTx}", ` +
          `а в списке "${transactionIdToFill}" — ничего не меняю, статус не трогаю.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'skipped',
          reason: 'transaction-id-mismatch',
          existingTransactionId: existingTx,
          wantedTransactionId: transactionIdToFill,
          detectedIn: 'окно',
        });
      }

      if (existingTx === transactionIdToFill) {
        // Номер уже на месте — скорее всего прошлый прогон вписал его, но
        // упал на статусе. Не переписываем, идём сразу к статусу.
        console.log(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: Transaction ID уже стоит правильный — ` +
          `не переписываю, меняю только статус.`
        );
      } else {
        // Отметку журнала снимаем ДО ввода: всё, что уйдёт после неё,
        // относится к нашей вставке, а не к тому, что висело раньше.
        const mark = requestLogMark();
        const inputAt = Date.now();
        setInputValue(txInput, transactionIdToFill);
        txInput.blur();
        txInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        setProgress({ action: 'жду загрузку данных транзакции' });
        const loaded = await waitForTransactionDataLoaded(mark, inputAt);
        if (!loaded.ok) {
          console.warn(
            `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: ${describeReason(loaded.reason)} — статус не меняю.`
          );
          return failTicket(ticketId, workflow, {
            ticketId,
            status: 'failed',
            reason: loaded.reason,
            attemptedTransactionId: transactionIdToFill,
          });
        }
        if (loaded.secondWaveMissing) {
          transactionLoadNote = 'вторая волна запросов не пришла';
          console.warn(
            `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: ${transactionLoadNote} — ` +
            `данные транзакции могли не подтянуться, стоит глянуть глазами.`
          );
        }

        // Читаем обратно только ПОСЛЕ загрузки: сайт мог поправить значение.
        // Сравниваем строго — Transaction ID не число, нормализовать нельзя.
        const written = txInput.value.trim();
        if (written !== transactionIdToFill) {
          console.warn(
            `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: сайт не принял Transaction ID — ` +
            `вписывали "${transactionIdToFill}", в поле оказалось "${written}". Статус не меняю.`
          );
          return failTicket(ticketId, workflow, {
            ticketId,
            status: 'failed',
            reason: 'transaction-id-not-accepted',
            attemptedTransactionId: transactionIdToFill,
            actualTransactionId: written,
          });
        }
        console.log(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: в Transaction ID вписано "${transactionIdToFill}".`
        );

        // ПРОВЕРКА НА ДУБЛЬ ТРАНЗАКЦИИ.
        //
        // Первая волна запросов — это и есть проверка сайта «занята ли
        // транзакция другим обращением». Если занята, сайт показывает окно,
        // и дальше идти нельзя: у SweetAlert2 модальная подложка, живой
        // человек сквозь неё не кликнул бы, а fireClick рассылает события
        // напрямую и подложку обходит. Именно так на боевом прогоне тикет
        // закрылся с чужой транзакцией, пока вопрос сайта висел без ответа.
        //
        // Известное окно о дубле закрываем кнопкой Cancel и едем дальше:
        // тикет пропускается, разбирать его будет человек. Любое ДРУГОЕ окно
        // по-прежнему останавливает прогон — что делают его кнопки, мы не
        // знаем, а гадать там, где на другом конце чей-то вывод, нельзя.
        const blocking = getOpenSwalPopup();
        if (blocking) {
          const info = classifySwalPopup(blocking);
          const popupText = info.title || info.content || info.icon;
          const known = isDuplicateTransactionPopup(info);

          if (known) {
            const owner = extractOwnerTicketId(info);
            console.warn(
              `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: сайт говорит, что транзакция ` +
              `"${transactionIdToFill}" уже занята` + (owner ? ` обращением ${owner}` : '') +
              `. Статус НЕ меняю, Apply НЕ жму, окно закрываю кнопкой Cancel.`
            );
            if (info.cancelBtn) fireClick(info.cancelBtn);
            try {
              await waitForGone(() => getOpenSwalPopup(), CONFIG.blockingPopupTimeout);
            } catch (e) {
              if (e instanceof StopSignal) throw e;
              // Закрыть не вышло — работать сквозь окно нельзя, встаём
              runAbortReason =
                `Тикет ${ticketId}: окно «${popupText}» не закрылось по Cancel. Прогон остановлен — ` +
                `закрой его вручную и запусти заново.`;
              console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
              const stuck = await failTicket(ticketId, workflow, {
                ticketId,
                status: 'skipped',
                reason: 'transaction-duplicate',
                attemptedTransactionId: transactionIdToFill,
                popupText,
                ownerTicketId: owner,
              });
              state.stopRequested = true;
              return stuck;
            }

            return failTicket(ticketId, workflow, {
              ticketId,
              status: 'skipped',
              reason: 'transaction-duplicate',
              attemptedTransactionId: transactionIdToFill,
              popupText,
              ownerTicketId: owner,
            });
          }

          runAbortReason =
            `Тикет ${ticketId}: после ввода Transaction ID "${transactionIdToFill}" сайт показал ` +
            `незнакомое окно «${popupText}». Статус НЕ менялся, Apply НЕ нажимался — тикет остался ` +
            `нетронутым. Прогон остановлен: прочитай окно, реши по этому тикету вручную и запусти заново.`;
          console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
          // Сначала закрываем окно Edit, и только потом просим остановку:
          // waitForGone внутри failTicket бросает StopSignal, если флаг уже
          // поднят, и результат этого тикета не дошёл бы до отчёта.
          const result = await failTicket(ticketId, workflow, {
            ticketId,
            status: 'skipped',
            reason: 'unknown-popup',
            attemptedTransactionId: transactionIdToFill,
            popupText,
          });
          state.stopRequested = true;
          return result;
        }
      }

      transactionIdFilled = transactionIdToFill;
    }

    // ------------------------------------------------------------------
    // ПОДСТАНОВКА СУММЫ (только режим 239, только если Amount = 0).
    // Делаем это ДО работы со Status и до Apply: личность тикета уже
    // подтверждена, а если подстановка сорвётся — статус останется
    // нетронутым, и тикет не окажется обработан наполовину.
    // ------------------------------------------------------------------
    let amountFilled = null;
    if (amountToFill) {
      let amountGroup;
      try {
        amountGroup = await waitFor(() => findFieldGroup(modal, 'Amount by receipt'));
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: в окне нет поля Amount by receipt — вписать сумму некуда.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'failed',
          reason: 'no-amount-receipt-field',
        });
      }

      // .multiselect__input исключаем: это поле поиска выпадающего списка,
      // а не текстовый ввод (та же логика, что и в Team Helper).
      const amountInput = amountGroup.querySelector(
        'input.mx-input, input[type="text"]:not(.multiselect__input)'
      );
      if (!amountInput) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: поле Amount by receipt найдено, но внутри нет текстового input.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'failed',
          reason: 'no-amount-receipt-field',
        });
      }

      // Если сумма там уже стоит — НЕ перезаписываем. Amount = 0 в списке при
      // заполненном Amount by receipt — это расхождение, которое должен
      // посмотреть человек, а не молча затереть скрипт.
      const existingAmount = amountInput.value.trim();
      if (existingAmount !== '') {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: Amount by receipt уже заполнен ("${existingAmount}"), ` +
          `хотя в списке Amount = 0. Ничего не меняю, статус не трогаю — нужна ручная проверка.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'skipped',
          reason: 'amount-already-filled',
          existingAmount,
          transactionAmount: amountToFill,
        });
      }

      setInputValue(amountInput, amountToFill);
      // Маски и валидаторы у полей ввода часто срабатывают именно по blur, а не
      // по input: без него поле может выглядеть заполненным, а нормализоваться
      // (или сброситься) только в момент Apply.
      amountInput.blur();
      amountInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      await interruptibleSleep(CONFIG.stepDelay);

      // Читаем значение обратно: поле могло опустеть или в нём могло оказаться
      // другое число. Сравниваем ЧИСЛЕННО — сайт вправе показать «1 500.00»
      // там, где мы записали «1500.00», это то же самое, а не отказ.
      //
      // ВАЖНО: это НЕ доказательство того, что сумма сохранится. Мы читаем тот
      // же input.value, который сами и записали, а на Apply уходит внутренняя
      // модель Vue. Настоящая проверка — verifyAmountSaved, уже после Apply.
      const written = amountInput.value.trim();
      if (!sameAmount(written, amountToFill)) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: сайт не принял сумму — вписывали "${amountToFill}", ` +
          `в поле оказалось "${written}". Статус не меняю.`
        );
        return failTicket(ticketId, workflow, {
          ticketId,
          status: 'failed',
          reason: 'amount-not-accepted',
          attemptedAmount: amountToFill,
          actualAmount: written,
        });
      }

      amountFilled = amountToFill;
      console.log(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: в Amount by receipt вписано "${amountFilled}".`);
    }

    checkStop();

    // Находим поле Status. Форма внутри модалки может рендериться с задержкой
    // (особенно когда сайт тормозит), поэтому ЖДЁМ её появления, а не
    // проверяем один раз: одиночная проверка давала ложный "no-status-field"
    // на ещё пустой модалке — при этом кнопки Cancel в ней тоже ещё не было,
    // закрыть её failTicket не мог, и с этой залипшей модалки начинался
    // каскад, приводивший к записи транзакции в чужой тикет.
    let statusGroup;
    try {
      statusGroup = await waitFor(() => findFieldGroup(modal, 'Status'));
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      console.warn(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не найдено поле Status (форма не отрендерилась за ${CONFIG.waitTimeout} мс).`);
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'no-status-field' });
    }

    const multiselectTags = statusGroup.querySelector('.multiselect__tags');
    const multiselectInput = statusGroup.querySelector('.multiselect__input');
    if (!multiselectTags) {
      console.warn(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не найден .multiselect__tags внутри Status.`);
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

    setProgress({ action: 'ставлю статус' });

    // Печатаем searchTerm workflow'а в поле поиска — так же, как это делает человек.
    // Это надёжнее, чем искать нужный текст в нераскрытом полном списке.
    if (multiselectInput) {
      setInputValue(multiselectInput, workflow.searchTerm);
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
        `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: фильтрация по "${workflow.searchTerm}" не дала результата, ищу в полном списке...`
      );
      // Fallback: очищаем поиск и ищем по всему нераскрытому списку опций
      if (multiselectInput) {
        setInputValue(multiselectInput, '');
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
        console.warn(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: список опций статуса не раскрылся или вариант не найден.`);
        console.log(`[BulkApproveBETA/${workflow.id}] Debug — HTML поля Status:`, statusGroup.outerHTML);
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
      console.warn(`[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не найдена кнопка Apply.`);
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'no-apply-button' });
    }

    // Последняя проверка перед необратимым действием: не висит ли на экране
    // окно сайта. Подложка SweetAlert2 останавливает человека, но не
    // fireClick, поэтому «нажать Apply сквозь вопрос сайта» технически
    // возможно — и однажды уже случилось. Здесь это стоит одного запроса
    // к DOM, а цена пропуска — закрытый тикет с чужой транзакцией.
    const blockingBeforeApply = getOpenSwalPopup();
    if (blockingBeforeApply) {
      const info = classifySwalPopup(blockingBeforeApply);
      const popupText = info.title || info.content || info.icon;
      runAbortReason =
        `Тикет ${ticketId}: перед нажатием Apply на экране висит окно сайта «${popupText}». ` +
        `Apply НЕ нажимался. Прогон остановлен — разберись с этим тикетом вручную и запусти заново.`;
      console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
      // Порядок важен — см. комментарий у проверки на дубль транзакции
      const result = await failTicket(ticketId, workflow, {
        ticketId,
        status: 'skipped',
        reason: 'popup-before-apply',
        popupText,
      });
      state.stopRequested = true;
      return result;
    }

    setProgress({ action: 'жму Apply' });
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
        `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: модалка не закрылась после Apply — возможно, ошибка сохранения.` +
        (relatedPopups.length > 0 ? ' См. пойманные окна для этого тикета в отчёте.' : '')
      );
      return failTicket(ticketId, workflow, { ticketId, status: 'failed', reason: 'modal-not-closed' });
    }

    console.log(
      `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: готово ✅` +
      (amountFilled ? ` (вписана сумма "${amountFilled}")` : '') +
      (transactionIdFilled ? ` (вписан Transaction ID "${transactionIdFilled}")` : '')
    );

    const success = { ticketId, status: 'success' };
    if (amountFilled) success.amountFilled = amountFilled;
    if (transactionIdFilled) success.transactionIdFilled = transactionIdFilled;
    if (transactionLoadNote) success.transactionLoadNote = transactionLoadNote;
    return success;
  }

  // ------------------------------------------------------------------
  // Запуск по кнопке
  // ------------------------------------------------------------------
  async function runBulkApprove(workflow) {
    refreshColumnIndexMap();

    // Режимы со списком начинаются с вопроса. Для «по списку (225)» список
    // обязателен — без номеров транзакций делать нечего. Для обычного 225 он
    // необязателен: в окне есть «Запустить по экрану».
    currentListPairs = null;
    currentListState = null;
    let autopilot = false;
    let askedInWindow = false;
    if (workflow.fillTransactionIdFromList || workflow.allowTicketIdList) {
      const entered = await showTicketListWindow(workflow);
      if (!entered) return; // отмена — молча выходим, ничего не трогая
      askedInWindow = true;
      currentListPairs = entered.pairs;
      currentListState = entered.state;
      autopilot = entered.autopilot;
    }

    if (workflow.fillAmountFromTransaction) {
      if (!(columnIndexMap && columnIndexMap['amount'])) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Не найдена колонка Amount по названию — проверка на сумму 0 ` +
          `не будет работать в этом прогоне, тикеты с нулевой суммой обработаются как обычно.`
        );
      } else if (!getTransactionAmountColumnIndex()) {
        console.warn(
          `[BulkApproveBETA/${workflow.id}] Не найдена колонка Transaction Amount по названию — подставлять сумму ` +
          `будет неоткуда, тикеты с Amount = 0 в этом прогоне просто пропустятся, как раньше.`
        );
      }
    }

    // Колонка Transaction Status для такого режима обязательна: без неё
    // каждый тикет всё равно будет пропущен, так что честнее не начинать
    // прогон, а сказать, чего не хватает.
    if (workflow.requiredTransactionStatus && !getTransactionStatusColumnIndex()) {
      alert(
        'Не найдена колонка Transaction Status — прогон не начат.\n\n' +
        `Режим «${workflow.buttonLabel}» берёт только тикеты, у которых транзакция в статусе ` +
        `"${workflow.requiredTransactionStatus}", а сверить это без колонки нечем.\n\n` +
        'Включи колонку Transaction Status в настройках таблицы и запусти снова.'
      );
      return;
    }

    // Что именно прогоняем.
    //
    // Автопилот: пачки набираются из списка, и что сейчас на экране —
    // неважно, эту выдачу он всё равно заменит своей.
    // Без автопилота: одна «пачка» — это то, что оператор уже вывел сам;
    // фильтр страницы скрипт не трогает.
    const listDone = new Set(currentListState ? currentListState.done : []);
    let chunks;

    if (autopilot) {
      const missing = autopilotMissingControls();
      if (missing.length > 0) {
        alert(
          'Автопилот включён, но на странице нет того, чем он работает:\n' +
          missing.map((m) => `  • ${m}`).join('\n') +
          '\n\nПрогон не начат. Разверни блок Quick filters и запусти снова, ' +
          'либо сними галочку «Автопилот» и выведи тикеты в поиск сам.'
        );
        return;
      }

      const remaining = [...currentListPairs.keys()].filter((id) => !listDone.has(id));
      if (remaining.length === 0) {
        alert(
          `Из списка (${currentListPairs.size}) уже обработано всё. ` +
          'Если список нужно прогнать заново — нажми «Начать заново» в окне ввода.'
        );
        return;
      }
      chunks = chunkArray(remaining, CONFIG.autopilotChunkSize);
    } else {
      const rows = getTicketRows();
      if (rows.length === 0) {
        alert('Не найдено ни одного тикета на странице.');
        return;
      }
      chunks = [null]; // null — «бери то, что уже на экране»
    }

    const queuedTotal = autopilot
      ? chunks.reduce((sum, c) => sum + c.length, 0)
      : getTicketRows().length;

    // Окно ввода списка уже показало всё то же самое и имеет свои кнопки
    // запуска — второй диалог подряд был бы лишним кликом на каждом прогоне.
    // У режимов без окна (239) confirm остаётся единственной проверкой.
    if (!askedInWindow) {
      const confirmed = confirm(
        `Найдено тикетов на экране: ${queuedTotal}.\n` +
        `Будут обработаны только те, у кого External Status — один из:\n` +
        workflow.requiredExternalStatuses.map((name) => `  • ${name}`).join('\n') + `\n` +
        (workflow.requiredTransactionStatus
          ? `и при этом Transaction Status = "${workflow.requiredTransactionStatus}".\n`
          : '') +
        `Остальные — пропущены.\n` +
        `У подходящих будет выставлен статус "${workflow.targetStatusLabel}" и нажат Apply.` +
        (workflow.fillAmountFromTransaction
          ? `\n\nВ тикетах с Amount = 0 сумма будет подставлена из колонки Transaction Amount\n` +
            `в поле "Amount by receipt". Если брать нечего или поле уже заполнено —\n` +
            `тикет пропускается и попадает в список для ручной проверки.`
          : '') +
        `\n\nПродолжить?`
      );
      if (!confirmed) return;
    }

    capturedPopups.length = 0; // отчёт по попапам — только за этот прогон
    runAbortReason = null;

    state.isRunning = true;
    state.stopRequested = false;
    updateButtonsUI();

    // Все тикеты, которые прогон собирался посмотреть — накапливаются по
    // пачкам. По ним в конце считается, до кого прогон не дошёл.
    const plannedTicketIds = [];

    // Сквозной счётчик по списку: сколько из него закрыто за все прогоны,
    // включая текущий. Обновляется по ходу, чтобы панель показывала живое
    // число, а не то, что было на старте.
    const listClosedIds = new Set(listDone);

    const listLineNow = () =>
      currentListPairs ? `из списка: ${listClosedIds.size} из ${currentListPairs.size}` : '';

    setProgress({
      visible: true,
      title: workflow.buttonLabel,
      index: 0,
      total: 0,
      ticketId: '',
      ok: 0,
      skipped: 0,
      failed: 0,
      action: 'начинаю',
      listLine: listLineNow(),
      chunkLine: autopilot ? `Пачка 0 из ${chunks.length}` : '',
    });

    const results = [];
    let stoppedEarly = false;
    let consecutiveFailures = 0;
    // Отдельный счётчик: тикет обработался успешно, но сумма не сохранилась.
    // Это не «ошибка тикета», поэтому в consecutiveFailures не попадает.
    let consecutiveUnsavedAmounts = 0;

    // Серия ошибок подряд означает, что сайт лёг (например, отвечает 529) или
    // изменилась вёрстка. Гнать в таком состоянии оставшуюся сотню тикетов
    // бессмысленно и вредно для сервера. Возвращает true, если надо остановиться.
    const registerFailure = (reason) => {
      consecutiveFailures++;
      if (consecutiveFailures < CONFIG.maxConsecutiveFailures) return false;
      runAbortReason =
        `Подряд ${consecutiveFailures} тикетов завершились ошибкой (последняя причина: ${describeReason(reason)}). ` +
        `Похоже, сайт недоступен или изменилась вёрстка. Прогон остановлен, чтобы не гонять впустую ` +
        `оставшиеся тикеты. Проверь страницу и запусти заново.`;
      console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
      return true;
    };

    // Пустая выдача сама по себе законна: в пачке может не оказаться ни
    // одного живого тикета. Но три пустых пачки подряд — это триста тикетов,
    // которых сайт не показал, и это уже не совпадение.
    let consecutiveEmptyChunks = 0;
    let emptyChunks = 0;
    let chunksDone = 0;

    for (let chunkNo = 0; chunkNo < chunks.length; chunkNo++) {
      if (state.stopRequested) {
        stoppedEarly = true;
        break;
      }

      if (autopilot) {
        const chunk = chunks[chunkNo];
        setProgress({
          chunkLine: `Пачка ${chunkNo + 1} из ${chunks.length}`,
          index: 0,
          total: chunk.length,
          ticketId: '',
          action: `подставляю ${chunk.length} тикетов в фильтр`,
        });

        let applied;
        try {
          applied = await applyTicketIdFilter(chunk, workflow);
        } catch (e) {
          if (e instanceof StopSignal) {
            stoppedEarly = true;
            break;
          }
          throw e;
        }

        if (!applied.ok) {
          runAbortReason =
            `Пачка ${chunkNo + 1} из ${chunks.length}: ` +
            `${describeAutopilotFailure(applied.reason, applied.detail)}. ` +
            `Прогон остановлен — обработанное до этого момента сохранено, ` +
            `оставшиеся тикеты можно забрать из блока для копирования ниже.`;
          console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
          stoppedEarly = true;
          break;
        }

        chunksDone++;

        if (applied.ticketIds.length === 0) {
          emptyChunks++;
          consecutiveEmptyChunks++;
          if (consecutiveEmptyChunks >= CONFIG.autopilotMaxEmptyChunks) {
            runAbortReason =
              `Подряд ${consecutiveEmptyChunks} пачек по ${CONFIG.autopilotChunkSize} тикетов ` +
              `сайт вернул пустыми. Похоже, фильтр не отбирает тикеты так, как мы рассчитываем ` +
              `(например, на странице стоит ещё один фильтр, под который они не подходят). ` +
              `Прогон остановлен, чтобы не листать остаток списка впустую.`;
            console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
            stoppedEarly = true;
            break;
          }
          continue;
        }
        consecutiveEmptyChunks = 0;
      } else {
        chunksDone++;
      }

      // Состав страницы фиксируем по номерам, а не по позициям строк: таблица
      // перерисовывается прямо во время прогона, и обращение по индексу молча
      // подсовывало бы не тот тикет либо навсегда пропускало один из них.
      const pageTicketIds = getTicketRows().map((r) => getTicketIdFromRow(r));
      plannedTicketIds.push(...pageTicketIds);
      const total = pageTicketIds.length;
      setProgress({ total, action: '' });

      for (let i = 0; i < total; i++) {
        if (state.stopRequested) {
          stoppedEarly = true;
          break;
        }

        const ticketId = pageTicketIds[i];
        setProgress({ index: i + 1, ticketId, action: 'открываю Edit' });

        // Пустая таблица — это НЕ «тикеты кончились», а её перезагрузка. Раньше
        // скрипт в этот момент молча пролистывал весь остаток списка и рапортовал
        // «Готово», хотя не посмотрел почти ни одного тикета.
        if (getTicketRows().length === 0) {
          console.warn(
            `[BulkApproveBETA/${workflow.id}] Таблица пуста (идёт перезагрузка?) — жду, пока она вернётся...`
          );
          try {
            await waitFor(() => getTicketRows().length > 0, CONFIG.tableReloadTimeout);
          } catch (e) {
            if (e instanceof StopSignal) {
              stoppedEarly = true;
              break;
            }
            runAbortReason =
              `Таблица тикетов пропала со страницы и не вернулась за ${CONFIG.tableReloadTimeout / 1000} с. ` +
              `Прогон остановлен: продолжать вслепую нельзя. Обнови страницу и запусти заново.`;
            console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
            stoppedEarly = true;
            break;
          }
        }

        const row = findRowByTicketId(ticketId);
        if (!row) {
          console.warn(
            `[BulkApproveBETA/${workflow.id}] (${i + 1}/${total}) Тикет ${ticketId}: строки больше нет в таблице — НЕ обработан.`
          );
          results.push({ ticketId, status: 'failed', reason: 'row-disappeared' });
          if (registerFailure('row-disappeared')) {
            stoppedEarly = true;
            break;
          }
          continue;
        }

        let result;
        try {
          result = await processTicket(row, i, total, workflow);
          results.push(result);
        } catch (e) {
          if (e instanceof StopSignal) {
            console.log(`[BulkApproveBETA/${workflow.id}] Получен сигнал СТОП — прерываю выполнение.`);
            tryCancelModal();
            stoppedEarly = true;
            break;
          }
          console.error(`[BulkApproveBETA/${workflow.id}] Необработанная ошибка на тикете ${ticketId}:`, e);
          result = { ticketId, status: 'failed', reason: 'exception' };
          results.push(result);
        }

        if (result) {
          setProgress({
            ok: results.filter((r) => r.status === 'success').length,
            skipped: results.filter((r) => r.status === 'skipped').length,
            failed: results.filter((r) => r.status === 'failed').length,
            action: '',
          });
        }

        // Сумму вписали — убеждаемся, что она сохранилась. Делаем это здесь, а
        // не внутри processTicket: цикл уже умеет ждать перезагрузку таблицы и
        // заново находить строку по номеру тикета.
        if (CONFIG.verifyAmountSaved && result.status === 'success' && result.amountFilled) {
          try {
            const check = await verifyAmountSaved(ticketId, result.amountFilled, workflow);
            // result лежит в results по ссылке — отчёт увидит эти поля
            result.amountVerified = check.verdict;
            result.storedAmount = check.stored;
            result.verifyNote = check.note;

            if (check.verdict === 'saved') {
              consecutiveUnsavedAmounts = 0;
              console.log(
                `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: сумма "${result.amountFilled}" сохранилась ` +
                `(${check.note}).`
              );
            } else if (check.verdict === 'not-saved') {
              console.error(
                `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: СУММА НЕ СОХРАНИЛАСЬ — вписывали ` +
                `"${result.amountFilled}", ${check.note}. Статус при этом уже изменён.`
              );
              consecutiveUnsavedAmounts++;
              // Если виноват формат или вёрстка, не сохранится у всех подряд —
              // гнать дальше и трогать деньги впустую вредно.
              if (consecutiveUnsavedAmounts >= CONFIG.maxConsecutiveFailures) {
                runAbortReason =
                  `Подряд у ${consecutiveUnsavedAmounts} тикетов сумма не сохранилась, хотя статус менялся. ` +
                  `Похоже, сайт перестал принимать сумму в том виде, в каком её вписывает скрипт. ` +
                  `Прогон остановлен. Перечисленные ниже тикеты нужно поправить вручную.`;
                console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
                stoppedEarly = true;
                break;
              }
            } else {
              console.warn(
                `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не удалось проверить сумму — ${check.note}.`
              );
            }
          } catch (e) {
            if (e instanceof StopSignal) {
              stoppedEarly = true;
              break;
            }
            console.error(`[BulkApproveBETA/${workflow.id}] Ошибка при проверке суммы у тикета ${ticketId}:`, e);
            result.amountVerified = 'unverified';
            result.verifyNote = 'проверка завершилась ошибкой скрипта';
          }
        }

        // То же самое для номера транзакции. Причина ровно та же, что была у
        // сумм в 2.7: статус может сохраниться, а значение — нет, и без
        // проверки после Apply этого никто не заметит.
        if (CONFIG.verifyAmountSaved && result.status === 'success' && result.transactionIdFilled) {
          setProgress({ action: 'проверяю, сохранился ли Transaction ID' });
          try {
            const check = await verifyTransactionIdSaved(ticketId, result.transactionIdFilled, workflow);
            result.txVerified = check.verdict;
            result.storedTransactionId = check.stored;
            result.txVerifyNote = check.note;

            if (check.verdict === 'saved') {
              consecutiveUnsavedAmounts = 0;
              console.log(
                `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: Transaction ID ` +
                `"${result.transactionIdFilled}" сохранился (${check.note}).`
              );
            } else if (check.verdict === 'not-saved') {
              console.error(
                `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: TRANSACTION ID НЕ СОХРАНИЛСЯ — ` +
                `вписывали "${result.transactionIdFilled}", ${check.note}. Статус при этом уже изменён.`
              );
              consecutiveUnsavedAmounts++;
              if (consecutiveUnsavedAmounts >= CONFIG.maxConsecutiveFailures) {
                runAbortReason =
                  `Подряд у ${consecutiveUnsavedAmounts} тикетов не сохранился Transaction ID, хотя статус менялся. ` +
                  `Похоже, сайт перестал принимать номер в том виде, в каком его вписывает скрипт. ` +
                  `Прогон остановлен. Перечисленные ниже тикеты нужно поправить вручную.`;
                console.error(`[BulkApproveBETA/${workflow.id}] ${runAbortReason}`);
                stoppedEarly = true;
                break;
              }
            } else {
              console.warn(
                `[BulkApproveBETA/${workflow.id}] Тикет ${ticketId}: не удалось проверить Transaction ID — ${check.note}.`
              );
            }
          } catch (e) {
            if (e instanceof StopSignal) {
              stoppedEarly = true;
              break;
            }
            console.error(
              `[BulkApproveBETA/${workflow.id}] Ошибка при проверке Transaction ID у тикета ${ticketId}:`, e
            );
            result.txVerified = 'unverified';
            result.txVerifyNote = 'проверка завершилась ошибкой скрипта';
          }
        }

        if (result.status === 'failed') {
          if (registerFailure(result.reason)) {
            stoppedEarly = true;
            break;
          }
        } else if (result.status === 'success') {
          consecutiveFailures = 0;
        }

        // Прогон мог остановить сам себя изнутри (не тот тикет в модалке,
        // залипшая модалка, чужое окно на экране)
        if (state.stopRequested) {
          stoppedEarly = true;
          break;
        }

        // Живой счётчик по списку. Предикат один на счётчик и на отчёт —
        // иначе панель и итог однажды разойдутся, и верить будет нечему.
        if (currentListPairs && currentListPairs.has(result.ticketId)) {
          if (isListTicketClosed(result)) listClosedIds.add(result.ticketId);
          setProgress({ listLine: listLineNow() });
        }

        const wasSkipped = result.status === 'skipped';

        if (i < total - 1 && !wasSkipped) {
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

      // Прогон мог остановиться внутри пачки — тогда остальные пачки не трогаем
      if (stoppedEarly) break;

      if (autopilot && chunkNo < chunks.length - 1) {
        setProgress({ action: 'перехожу к следующей пачке' });
        try {
          await interruptibleSleep(CONFIG.autopilotBetweenChunksDelay);
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
    hideProgress();

    const successResults = results.filter((r) => r.status === 'success');
    const successCount = successResults.length;
    // Сколько из обработанных тикетов пролежали больше суток. Считаем по
    // успешным: «обработано» — это то, что прогон реально закрыл. Возраст у
    // каждого тикета зафиксирован в момент его обработки (см. processTicket).
    const hasProcessingDateColumn = !!getProcessingDateColumnIndex();
    const agedResults = successResults.filter((r) => typeof r.ageHours === 'number');
    const staleResults = agedResults.filter((r) => r.ageHours >= CONFIG.staleAfterHours);
    const freshCount = agedResults.length - staleResults.length;
    // Дата в ячейке есть, но прочитать её не вышло — таких видно отдельно,
    // иначе смена формата колонки тихо испортила бы статистику.
    const noAgeCount = successResults.length - agedResults.length;
    const wrongStatusSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'wrong-external-status');
    // Транзакция не отклонена — законная и самая частая причина пропуска в
    // широком пуле статусов. Показываем не список тикетов (он был бы во всю
    // страницу), а сводку по значениям колонки: по ней сразу видно, читается
    // ли Transaction Status вообще, или скрипт просто не нашёл ни одного
    // «rejected» и молча ничего не сделал.
    const notRejectedSkips = results.filter(
      (r) => r.status === 'skipped' && r.reason === 'transaction-not-rejected'
    );
    const noTxStatusSkips = results.filter(
      (r) => r.status === 'skipped' && r.reason === 'no-transaction-status-column'
    );
    // Режим «по списку»
    const notInListSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'not-in-list');
    // Сайт сказал, что транзакция уже занята. Самый дорогой исход прогона:
    // именно здесь чужая транзакция однажды уехала не в тот тикет.
    const duplicateSkips = results.filter(
      (r) => r.status === 'skipped' && r.reason === 'transaction-duplicate'
    );
    const txMismatchSkips = results.filter(
      (r) => r.status === 'skipped' && r.reason === 'transaction-id-mismatch'
    );
    const txFilledResults = results.filter((r) => r.status === 'success' && r.transactionIdFilled);
    const txNotSaved = txFilledResults.filter((r) => r.txVerified === 'not-saved');
    const txUnverified = txFilledResults.filter((r) => r.txVerified === 'unverified');
    const txConfirmed = txFilledResults.filter(
      (r) => r.txVerified !== 'not-saved' && r.txVerified !== 'unverified'
    );

    const zeroAmountSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'zero-amount');
    const alreadyFilledSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'amount-already-filled');
    // Тикеты, где скрипт ИЗМЕНИЛ денежное поле. Такое обязано быть в отчёте
    // явно, а не только в консоли: по этому списку сверяют, что сайт принял
    // сумму именно в том виде, в каком её вписали.
    const amountFilledResults = results.filter((r) => r.status === 'success' && r.amountFilled);
    // Статус изменился, а сумма не сохранилась — самое опасное, что может
    // случиться в этом прогоне: тикет выглядит обработанным, но денег в нём нет.
    const amountNotSaved = amountFilledResults.filter((r) => r.amountVerified === 'not-saved');
    const amountUnverified = amountFilledResults.filter((r) => r.amountVerified === 'unverified');
    const amountConfirmed = amountFilledResults.filter((r) => r.amountVerified !== 'not-saved' && r.amountVerified !== 'unverified');
    const formatUnclearSkips = results.filter((r) => r.status === 'skipped' && r.reason === 'amount-format-unclear');
    const failed = results.filter((r) => r.status === 'failed');
    const popupCount = capturedPopups.length;

    // Тикеты, до которых прогон вообще не дошёл (остановился раньше).
    // Без этого отчёт мог показать бодрое «Готово», умолчав, что почти весь
    // список остался нетронутым.
    const seenIds = new Set(results.map((r) => r.ticketId));
    const notReachedIds = plannedTicketIds.filter((id) => !seenIds.has(id));

    // Память по списку: что закрыто и что требует рук. Копится между
    // прогонами — список гоняют пачками по сотне тикетов, и человеку нужен
    // сквозной счёт, а не «за этот прогон».
    let listRemaining = [];
    let listNeedsAttention = [];
    let listNotOnPage = 0;
    let listDoneTotal = 0;
    if (currentListPairs && currentListState) {
      // listClosedIds уже собран по ходу прогона тем же предикатом, которым
      // считалась панель — второй раз то же самое не пересчитываем.
      const done = listClosedIds;
      const attention = new Map(
        currentListState.needsAttention.map((a) => [String(a.ticketId), a])
      );

      results.forEach((r) => {
        // Строки со страницы, которых нет в списке, нас не касаются
        if (!currentListPairs.has(r.ticketId)) return;

        if (isListTicketClosed(r)) {
          attention.delete(r.ticketId);
          return;
        }

        attention.set(r.ticketId, {
          ticketId: r.ticketId,
          reason:
            r.txVerified === 'not-saved'
              ? `Transaction ID не сохранился (${r.txVerifyNote || 'в тикете его нет'})`
              : describeReason(r.reason),
        });
      });

      listRemaining = [...currentListPairs.keys()].filter((id) => !done.has(id));
      listNeedsAttention = [...attention.values()];
      listDoneTotal = done.size;

      const seen = new Set(results.map((r) => r.ticketId));
      listNotOnPage = [...currentListPairs.keys()].filter((id) => !seen.has(id)).length;

      writeListStorage(listStorageKey(workflow), {
        savedAt: Date.now(),
        text: currentListState.text,
        done: [...done],
        needsAttention: listNeedsAttention,
      });
    }

    console.log(`[BulkApproveBETA/${workflow.id}] ИТОГ:`, results);
    // Быстрый доступ из консоли, например:
    // window.__bulkApproveLastResults.find(r => r.ticketId === '19406922')
    window.__bulkApproveLastResults = results;

    if (popupCount > 0) {
      console.log(`[BulkApproveBETA/${workflow.id}] Пойманные всплывающие окна (не "OK!"), требуют ручной проверки:`);
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

    // Сколько тикетов показываем списком в окне, прежде чем отправить
    // за остальными в консоль
    const MAX_LISTED = 40;

    const popupsListText =
      popupCount > 0
        ? `\n\nТребуют ручной проверки на дубликаты (${popupCount}):\n` +
          capturedPopups.map((p) => `${p.ticketId} - ${p.transactionId}`).join('\n')
        : '';

    const notRejectedText =
      notRejectedSkips.length > 0
        ? `\n\nПропущены: транзакция не в статусе rejected (${notRejectedSkips.length}) — что стояло в колонке:\n` +
          [
            ...notRejectedSkips.reduce((acc, r) => {
              const key = r.transactionStatus === '' ? '(пусто)' : r.transactionStatus;
              return acc.set(key, (acc.get(key) || 0) + 1);
            }, new Map()),
          ]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `  • ${name}: ${count}`)
            .join('\n')
        : '';

    const noTxStatusText =
      noTxStatusSkips.length > 0
        ? `\n\n⚠ У ${noTxStatusSkips.length} тикетов не удалось прочитать колонку Transaction Status — ` +
          `они пропущены. Похоже, набор колонок в таблице менялся во время прогона: ` +
          `перезагрузи страницу и запусти заново.`
        : '';

    const txFilledListText =
      txConfirmed.length > 0
        ? `\n\nВписан Transaction ID (${txConfirmed.length}):\n` +
          txConfirmed
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — ${r.transactionIdFilled}` +
              (r.transactionLoadNote ? ` (${r.transactionLoadNote})` : ''))
            .join('\n') +
          (txConfirmed.length > MAX_LISTED
            ? `\n… и ещё ${txConfirmed.length - MAX_LISTED}`
            : '')
        : '';

    const txNotSavedText =
      txNotSaved.length > 0
        ? `\n\n⚠ TRANSACTION ID НЕ СОХРАНИЛСЯ (${txNotSaved.length}) — статус УЖЕ изменён, поправь вручную:\n` +
          txNotSaved
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — вписывали "${r.transactionIdFilled}", ${r.txVerifyNote || 'в тикете его нет'}`)
            .join('\n')
        : '';

    const txUnverifiedText =
      txUnverified.length > 0
        ? `\n\nTransaction ID вписан, но проверить не удалось (${txUnverified.length}):\n` +
          txUnverified
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — вписывали "${r.transactionIdFilled}" (${r.txVerifyNote || 'причина неизвестна'})`)
            .join('\n')
        : '';

    const duplicateText =
      duplicateSkips.length > 0
        ? `\n\n⚠ ТРАНЗАКЦИЯ ЗАНЯТА ДРУГИМ ОБРАЩЕНИЕМ (${duplicateSkips.length}) — ` +
          `статус НЕ меняли, Apply НЕ нажимали, разберись вручную:\n` +
          duplicateSkips
            .slice(0, MAX_LISTED)
            .map((r) =>
              `${r.ticketId} — вписывали "${r.attemptedTransactionId}"` +
              (r.ownerTicketId ? `, транзакция уже у обращения ${r.ownerTicketId}` : '') +
              `. Сайт: «${r.popupText}»`)
            .join('\n')
        : '';

    const txMismatchText =
      txMismatchSkips.length > 0
        ? `\n\nПропущены: в тикете уже стоит ДРУГОЙ Transaction ID (${txMismatchSkips.length}) — статус НЕ меняли:\n` +
          txMismatchSkips
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — в тикете "${r.existingTransactionId}", в списке "${r.wantedTransactionId}" (видно по: ${r.detectedIn})`)
            .join('\n')
        : '';

    const zeroAmountListText =
      zeroAmountSkips.length > 0
        ? `\n\nПропущены: Amount = 0, а в Transaction Amount нечего взять (${zeroAmountSkips.length}):\n` +
          zeroAmountSkips.map((r) => r.ticketId).join('\n')
        : '';

    const alreadyFilledListText =
      alreadyFilledSkips.length > 0
        ? `\n\nПропущены: Amount = 0, но поле Amount by receipt уже заполнено — статус НЕ меняли (${alreadyFilledSkips.length}):\n` +
          alreadyFilledSkips
            .map((r) => `${r.ticketId} — в окне "${r.existingAmount}", в списке "${r.transactionAmount}"`)
            .join('\n')
        : '';

    window.__bulkApproveAmountFilled = amountFilledResults;
    window.__bulkApproveAmountNotSaved = amountNotSaved;

    const amountFilledListText =
      amountConfirmed.length > 0
        ? `\n\nВписана сумма из Transaction Amount (${amountConfirmed.length}):\n` +
          amountConfirmed
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — ${r.amountFilled}`)
            .join('\n') +
          (amountConfirmed.length > MAX_LISTED
            ? `\n… и ещё ${amountConfirmed.length - MAX_LISTED} — полный список в консоли: window.__bulkApproveAmountFilled`
            : '')
        : '';

    const amountNotSavedText =
      amountNotSaved.length > 0
        ? `\n\n⚠ СУММА НЕ СОХРАНИЛАСЬ (${amountNotSaved.length}) — статус УЖЕ изменён, поправь вручную:\n` +
          amountNotSaved
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — вписывали "${r.amountFilled}", ${r.verifyNote || 'в тикете её нет'}`)
            .join('\n') +
          (amountNotSaved.length > MAX_LISTED
            ? `\n… и ещё ${amountNotSaved.length - MAX_LISTED} — полный список в консоли: window.__bulkApproveAmountNotSaved`
            : '') +
          `\nЭти тикеты можно починить повторным прогоном: Amount в списке остался 0, External Status не менялся.`
        : '';

    const amountUnverifiedText =
      amountUnverified.length > 0
        ? `\n\nСумма вписана, но проверить не удалось (${amountUnverified.length}) — статус изменён, сумму стоит глянуть:\n` +
          amountUnverified
            .slice(0, MAX_LISTED)
            .map((r) => `${r.ticketId} — вписывали "${r.amountFilled}" (${r.verifyNote || 'причина неизвестна'})`)
            .join('\n')
        : '';

    const formatUnclearText =
      formatUnclearSkips.length > 0
        ? `\n\nПропущены: не понял формат суммы в Transaction Amount (${formatUnclearSkips.length}):\n` +
          formatUnclearSkips
            .map((r) => `${r.ticketId} — в колонке "${r.transactionAmountRaw}"`)
            .join('\n')
        : '';

    // Разбивка ошибок по причинам, от частых к редким: одна цифра «Ошибок: 7»
    // не говорит, сломался ли сайт целиком или это семь разных мелочей.
    const failureCounts = new Map();
    failed.forEach((r) => {
      failureCounts.set(r.reason, (failureCounts.get(r.reason) || 0) + 1);
    });
    const failureBreakdown = [...failureCounts.entries()].sort((a, b) => b[1] - a[1]);

    const summaryLines = [
      autopilot
        ? `Всего тикетов из списка показал сайт: ${plannedTicketIds.length} (запрошено ${queuedTotal})`
        : `Всего тикетов в списке: ${plannedTicketIds.length}`,
      `Успешно: ${successCount}`,
    ];
    // Строка-уточнение к «Успешно» — должна идти сразу за ним, иначе читается
    // как уточнение к пропущенным.
    if (amountConfirmed.length > 0) {
      summaryLines.push(`  • из них с подставленной суммой: ${amountConfirmed.length}`);
    }
    if (amountNotSaved.length > 0) {
      summaryLines.push(`  • ⚠ статус изменён, но сумма НЕ сохранилась: ${amountNotSaved.length}`);
    }
    if (amountUnverified.length > 0) {
      summaryLines.push(`  • сумма вписана, но не проверена: ${amountUnverified.length}`);
    }
    if (txConfirmed.length > 0) {
      summaryLines.push(`  • из них с вписанным Transaction ID: ${txConfirmed.length}`);
    }
    if (txNotSaved.length > 0) {
      summaryLines.push(`  • ⚠ статус изменён, но Transaction ID НЕ сохранился: ${txNotSaved.length}`);
    }
    if (txUnverified.length > 0) {
      summaryLines.push(`  • Transaction ID вписан, но не проверен: ${txUnverified.length}`);
    }
    if (!hasProcessingDateColumn) {
      if (successCount > 0) {
        summaryLines.push(`  • возраст не считали: на экране нет колонки Processing Date`);
      }
    } else {
      if (agedResults.length > 0) {
        summaryLines.push(`  • из них свежих (меньше ${CONFIG.staleAfterHours} ч): ${freshCount}`);
        summaryLines.push(
          `  • из них зависших (${CONFIG.staleAfterHours} ч и больше): ${staleResults.length}`
        );
      }
      if (noAgeCount > 0) {
        summaryLines.push(`  • из них с нечитаемой Processing Date: ${noAgeCount}`);
      }
    }
    summaryLines.push(`Пропущено (не тот External Status): ${wrongStatusSkips.length}`);
    if (notRejectedSkips.length > 0) {
      summaryLines.push(`Пропущено (транзакция не rejected): ${notRejectedSkips.length}`);
    }
    if (noTxStatusSkips.length > 0) {
      summaryLines.push(`Пропущено (не прочитал Transaction Status): ${noTxStatusSkips.length}`);
    }
    if (notInListSkips.length > 0) {
      summaryLines.push(`Пропущено (нет в списке): ${notInListSkips.length}`);
    }
    if (txMismatchSkips.length > 0) {
      summaryLines.push(
        `Пропущено (Transaction ID уже заполнен и отличается): ${txMismatchSkips.length}`
      );
    }
    if (duplicateSkips.length > 0) {
      summaryLines.push(
        `Пропущено (транзакция занята другим обращением): ${duplicateSkips.length}`
      );
    }
    const unknownPopupSkips = results.filter(
      (r) => r.status === 'skipped' && r.reason === 'unknown-popup'
    );
    if (unknownPopupSkips.length > 0) {
      summaryLines.push(`Пропущено (незнакомое окно сайта): ${unknownPopupSkips.length}`);
    }
    if (zeroAmountSkips.length > 0) {
      summaryLines.push(`Пропущено (Amount = 0, подставить нечего): ${zeroAmountSkips.length}`);
    }
    if (alreadyFilledSkips.length > 0) {
      summaryLines.push(`Пропущено (Amount by receipt уже заполнен): ${alreadyFilledSkips.length}`);
    }
    if (formatUnclearSkips.length > 0) {
      summaryLines.push(`Пропущено (непонятный формат суммы): ${formatUnclearSkips.length}`);
    }
    if (autopilot) {
      summaryLines.push(
        `Пачек по ${CONFIG.autopilotChunkSize}: обработано ${chunksDone} из ${chunks.length}` +
        (emptyChunks > 0 ? `, из них пустых ${emptyChunks}` : '')
      );
    }
    if (currentListPairs) {
      // Формулировка намеренно нейтральная: при работе пачками это норма,
      // а не ошибка, и пугать этой строкой нельзя.
      summaryLines.push(
        autopilot
          ? `Сайт не показал по фильтру: ${listNotOnPage} — ` +
            `обычно это уже закрытые или удалённые тикеты`
          : `Из вашего списка не было на этой странице: ${listNotOnPage} — ` +
            `это нормально, если гоните список по частям`
      );
      summaryLines.push(
        `Обработано из списка всего: ${listDoneTotal} из ${currentListPairs.size}, ` +
        `осталось ${listRemaining.length}`
      );
    }
    // Все причины пропуска, у которых есть своя строка выше. Новая причина,
    // не попавшая сюда, раньше просто исчезала бы из сводки — теперь она
    // выводится общей строкой ниже. Отчёт не должен молчать о том, что скрипт
    // чего-то не сделал.
    const namedSkipReasons = new Set([
      'wrong-external-status', 'transaction-not-rejected', 'no-transaction-status-column',
      'not-in-list', 'transaction-id-mismatch', 'transaction-duplicate', 'unknown-popup',
      'zero-amount', 'amount-already-filled', 'amount-format-unclear',
    ]);
    const otherSkips = results.filter(
      (r) => r.status === 'skipped' && !namedSkipReasons.has(r.reason)
    );
    if (otherSkips.length > 0) {
      const counts = new Map();
      otherSkips.forEach((r) => counts.set(r.reason, (counts.get(r.reason) || 0) + 1));
      summaryLines.push(`Пропущено по другим причинам: ${otherSkips.length}`);
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([reason, count]) => {
          summaryLines.push(`  • ${describeReason(reason)}: ${count}`);
        });
    }
    summaryLines.push(`Ошибок: ${failed.length}`);
    failureBreakdown.forEach(([reason, count]) => {
      summaryLines.push(`  • ${describeReason(reason)}: ${count}`);
    });

    // Поимённый список упавших тикетов с причиной. Без него оператор видел
    // только счётчик и не знал, какие именно тикеты перезапускать.
    const failedList = failed.map((r) => `${r.ticketId} — ${describeReason(r.reason)}`);
    window.__bulkApproveFailed = failed;

    const failedText =
      failedList.length > 0
        ? `\n\n⚠ ТИКЕТЫ С ОШИБКАМИ (${failedList.length}) — не обработаны, прогони заново или проверь вручную:\n` +
          failedList.slice(0, MAX_LISTED).join('\n') +
          (failedList.length > MAX_LISTED
            ? `\n… и ещё ${failedList.length - MAX_LISTED} — полный список в консоли: window.__bulkApproveFailed`
            : '')
        : '';

    const notReachedText =
      notReachedIds.length > 0
        ? `\n\n⚠ ПРОГОН НЕ ДОШЁЛ ДО ТИКЕТОВ (${notReachedIds.length}) — они не тронуты, запусти прогон заново:\n` +
          notReachedIds.slice(0, MAX_LISTED).join('\n') +
          (notReachedIds.length > MAX_LISTED
            ? `\n… и ещё ${notReachedIds.length - MAX_LISTED} — полный список в консоли: window.__bulkApproveUnprocessed`
            : '')
        : '';

    // Всё, что осталось необработанным: и упавшие тикеты, и те, до которых
    // прогон не дошёл. Показываем явно — «Готово» больше не врёт.
    const unprocessed = [
      ...failed.map((r) => `${r.ticketId} (${describeReason(r.reason)})`),
      ...notReachedIds.map((id) => `${id} (прогон до него не дошёл)`),
    ];
    window.__bulkApproveUnprocessed = unprocessed;

    if (unprocessed.length > 0) {
      console.warn(`[BulkApproveBETA/${workflow.id}] НЕ обработаны (${unprocessed.length}):`, unprocessed);
    }

    const header = stoppedEarly
      ? runAbortReason
        ? `ПРОГОН ОСТАНОВЛЕН АВТОМАТИЧЕСКИ.\n${runAbortReason}\n\n`
        : `Остановлено пользователем.\n`
      : unprocessed.length > 0
        ? `Прогон завершён, но НЕ ВСЕ тикеты обработаны.\n`
        : amountNotSaved.length > 0
          ? `Прогон завершён, но У ЧАСТИ ТИКЕТОВ НЕ СОХРАНИЛАСЬ СУММА.\n`
          : txNotSaved.length > 0
            ? `Прогон завершён, но У ЧАСТИ ТИКЕТОВ НЕ СОХРАНИЛСЯ TRANSACTION ID.\n`
            : `Готово.\n`;

    const reportText =
      header +
      summaryLines.join('\n') +
      popupsListText +
      duplicateText +
      txNotSavedText +
      txFilledListText +
      txUnverifiedText +
      txMismatchText +
      amountNotSavedText +
      amountFilledListText +
      amountUnverifiedText +
      noTxStatusText +
      notRejectedText +
      zeroAmountListText +
      alreadyFilledListText +
      formatUnclearText +
      failedText +
      notReachedText +
      (autopilot
        ? `\n\nВ поле фильтра «Ticket ID» осталась последняя пачка — таблица на экране ` +
          `показывает именно её. Очисти поле и нажми Apply, чтобы вернуть обычную выдачу.`
        : '') +
      `\n\nПодробности — в консоли (F12).`;

    // Строки для вставки в таблицу учёта. Берём ТОЛЬКО подтверждённые:
    // в таблицу должно попасть то, что реально лежит в тикетах, а не то,
    // что скрипт пытался вписать. Непроверенные и несохранившиеся суммы
    // остаются в тексте отчёта — их сначала нужно разобрать руками.
    const copyRows = amountConfirmed.map((r) => ({
      ticketId: r.ticketId,
      transactionId: r.transactionId || '(нет данных)',
      amount: r.amountFilled,
    }));

    // Разбор «кто именно завис» — из консоли:
    // window.__bulkApproveStaleTickets.map(r => [r.ticketId, r.processingDate])
    window.__bulkApproveStaleTickets = staleResults;
    window.__bulkApproveCopyRows = copyRows;

    // Блоков для копирования может быть несколько. В режиме по списку первым
    // идёт самый нужный: оставшиеся Ticket ID — их сразу вставляют в поиск
    // сайта, чтобы набрать следующую пачку.
    const copyBlocks = [];

    if (currentListPairs) {
      if (listRemaining.length > 0) {
        copyBlocks.push({
          label: autopilot
            ? `Не закрыты (${listRemaining.length}) — останутся в памяти списка ` +
              `и попадут в следующий прогон:`
            : `Оставшиеся Ticket ID (${listRemaining.length}) — вставить в поиск для следующей пачки:`,
          text: listRemaining.join('\n'),
        });
      }
      if (listNeedsAttention.length > 0) {
        copyBlocks.push({
          label: `Прогнать заново или посмотреть глазами (${listNeedsAttention.length}):`,
          text: listNeedsAttention.map((a) => `${a.ticketId}\t${a.reason}`).join('\n'),
        });
      }
      if (txConfirmed.length > 0) {
        copyBlocks.push({
          label: `Для таблицы (${txConfirmed.length}) — Ticket ID, Transaction ID:`,
          text: txConfirmed.map((r) => `${r.ticketId}\t${r.transactionIdFilled}`).join('\n'),
        });
      }
      window.__bulkApproveListRemaining = listRemaining;
      window.__bulkApproveListNeedsAttention = listNeedsAttention;
    }

    if (copyRows.length > 0) {
      copyBlocks.push({
        label: `Для таблицы (${copyRows.length}) — Ticket ID, Transaction ID, Amount:`,
        text: copyRows.map((r) => `${r.ticketId}\t${r.transactionId}\t${r.amount}`).join('\n'),
      });
    }

    showReportWindow(reportText, copyBlocks);
  }

  // ------------------------------------------------------------------
  // ИТОГОВОЕ ОКНО ОТЧЁТА.
  //
  // Раньше отчёт показывался через alert(): текст в нём нельзя выделить и
  // скопировать, а суммы потом нужно фиксировать в своей таблице. Поэтому
  // рисуем своё окно: сверху тот же текст отчёта (выделяемый), снизу —
  // готовая таблица «Ticket ID / Transaction ID / Amount» через табуляцию,
  // которая вставляется в Excel и Google Sheets по колонкам.
  //
  // Классы намеренно свои: окно не должно попадать ни под .modal_wrap
  // (его ищет getOpenModal), ни под .swal2-popup (за ним следит swalObserver).
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // СПИСОК «Ticket ID → Transaction ID»
  //
  // Оператор приносит его из своей таблицы двумя колонками. Для скрипта это
  // единственный источник номеров транзакций в режиме «по списку».
  // ------------------------------------------------------------------
  // У каждого режима своя память: список пар для «по списку (225)» и список
  // одних Ticket ID для обычного 225 — разные вещи, и путать их счётчики
  // обработанного нельзя.
  const LIST_STORAGE_KEYS = {
    pairs: 'th-bulk-approve:tx-list:v1-beta',
    ids: 'th-bulk-approve:ticket-list:v1-beta',
  };

  function listStorageKey(workflow) {
    return workflow.fillTransactionIdFromList ? LIST_STORAGE_KEYS.pairs : LIST_STORAGE_KEYS.ids;
  }

  // Список текущего прогона: Map «Ticket ID → Transaction ID». В режиме, где
  // номеров транзакций нет, значением стоит null — сам список при этом
  // продолжает работать отбором, и вся остальная механика (память между
  // прогонами, счётчики, остаток) не знает о разнице.
  let currentListPairs = null;
  let currentListState = null;

  // Разбирает вставленный текст. Возвращает пары и ВСЕ найденные претензии:
  // окно ввода покажет их человеку и не даст запуститься, пока они есть.
  //
  // Намеренно НЕ «вытаскиваем два числа регуляркой»: номер вида TXN-123 так
  // молча превратился бы в 123, и в тикет уехало бы не то.
  function parseTicketTransactionList(text) {
    const pairs = new Map();
    const badLines = [];
    const duplicateTickets = [];
    const byTransaction = new Map();

    String(text == null ? '' : text)
      .split(/\r?\n/)
      .forEach((raw, idx) => {
        const lineNo = idx + 1;
        const line = raw.trim();
        if (line === '') return;

        // Основной формат — таб между колонками. Заодно принимаем тире,
        // точку с запятой, запятую и просто пробелы.
        const tokens = line
          .replace(/\s+[-—–]\s+/g, '\t')
          .split(/[\t;,\s]+/)
          .map((t) => t.trim())
          .filter((t) => t !== '');

        if (tokens.length < 2) {
          badLines.push({ line: lineNo, text: line, why: 'нужны два значения' });
          return;
        }

        const ticketId = tokens[0];
        const transactionId = tokens[1];

        if (!/^\d+$/.test(ticketId)) {
          badLines.push({ line: lineNo, text: line, why: 'первое значение не похоже на Ticket ID' });
          return;
        }
        if (!/^[A-Za-z0-9._-]+$/.test(transactionId)) {
          badLines.push({
            line: lineNo,
            text: line,
            why: 'второе значение не похоже на Transaction ID',
          });
          return;
        }

        if (pairs.has(ticketId)) {
          // Один и тот же тикет с одним и тем же номером — просто дубль
          // строки, схлопываем молча. С разными номерами — это уже вопрос.
          if (pairs.get(ticketId) !== transactionId) {
            duplicateTickets.push({
              ticketId,
              values: [pairs.get(ticketId), transactionId],
            });
          }
          return;
        }

        pairs.set(ticketId, transactionId);
        if (!byTransaction.has(transactionId)) byTransaction.set(transactionId, []);
        byTransaction.get(transactionId).push(ticketId);
      });

    // Одна транзакция у разных тикетов — ровно тот случай, из-за которого в
    // этом проекте чужая транзакция уже дважды уезжала не в тот тикет.
    const duplicateTransactions = [...byTransaction.entries()]
      .filter(([, tickets]) => tickets.length > 1)
      .map(([transactionId, tickets]) => ({ transactionId, tickets }));

    return { pairs, badLines, duplicateTickets, duplicateTransactions };
  }

  // Разбирает список ОДНИХ Ticket ID — по номеру в строке. Возвращает то же,
  // что и разбор пар, чтобы окно ввода и прогон не различали эти два случая.
  //
  // Строго один столбец: так решено сознательно. Список сюда попадает из
  // выгрузки, и лишняя колонка обычно значит, что скопировали не тот кусок
  // таблицы, — молча взять из неё первое число было бы худшим из исходов.
  function parseTicketIdList(text) {
    const pairs = new Map();
    const badLines = [];
    let duplicates = 0;

    String(text == null ? '' : text)
      .split(/\r?\n/)
      .forEach((raw, idx) => {
        const lineNo = idx + 1;
        const line = raw.trim();
        if (line === '') return;

        if (/[\t;,]/.test(line) || /\s/.test(line)) {
          badLines.push({
            line: lineNo,
            text: line,
            why: 'в строке больше одного значения — нужен только Ticket ID',
          });
          return;
        }
        if (!/^\d+$/.test(line)) {
          badLines.push({ line: lineNo, text: line, why: 'не похоже на Ticket ID' });
          return;
        }

        if (pairs.has(line)) {
          duplicates++;
          return;
        }
        // null вместо номера транзакции: в этом режиме его просто нет
        pairs.set(line, null);
      });

    return { pairs, badLines, duplicateTickets: [], duplicateTransactions: [], duplicates };
  }

  // Разбор списка для конкретного режима — одна точка выбора на весь скрипт.
  function parseListForWorkflow(workflow, text) {
    return workflow.fillTransactionIdFromList
      ? parseTicketTransactionList(text)
      : parseTicketIdList(text);
  }

  // Отпечаток набора пар: по нему понимаем, тот же это список или новый.
  function listFingerprint(pairs) {
    return [...pairs.entries()]
      .map(([ticketId, transactionId]) => `${ticketId}:${transactionId}`)
      .sort()
      .join('|');
  }

  // localStorage может быть недоступен (приватное окно, запрет на сайте) —
  // любое обращение оборачиваем, память между прогонами это удобство, а не
  // условие работы.
  function readListStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return {
        savedAt: data.savedAt || null,
        text: typeof data.text === 'string' ? data.text : '',
        done: Array.isArray(data.done) ? data.done.map(String) : [],
        needsAttention: Array.isArray(data.needsAttention) ? data.needsAttention : [],
      };
    } catch (e) {
      return null;
    }
  }

  function writeListStorage(key, data) {
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn(
        '[BulkApproveBETA] Не удалось сохранить список — память между прогонами в этом браузере не работает.',
        e
      );
    }
  }

  function clearListStorage(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* см. readListStorage */
    }
  }

  // Окно ввода списка. Возвращает { pairs, state } либо null (отмена).
  // Окно ввода списка. Обслуживает два режима сразу:
  //
  //   • «по списку (225)» — список пар «Ticket ID → Transaction ID», без
  //     него режим бессмысленен, поэтому запуск только по списку;
  //   • обычный 225 — список одних Ticket ID, и он НЕ обязателен: рядом
  //     стоит кнопка «Запустить по экрану», которая даёт прежнее поведение.
  //
  // Это же окно заменяет прежний confirm(): в нём и так написано, сколько
  // тикетов на экране и что с ними будет. Два диалога подряд ради одного и
  // того же вопроса — лишний клик на каждом ежедневном прогоне.
  //
  // Возвращает { pairs, state, autopilot } — запуск по списку,
  //            { pairs: null, state: null, autopilot: false } — по экрану,
  //            null — отмена.
  function showTicketListWindow(workflow) {
    return new Promise((resolve) => {
      let settled = false;
      let onKey = null;
      let overlay = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (onKey) document.removeEventListener('keydown', onKey);
        if (overlay) overlay.remove();
        resolve(value);
      };

      try {
        const needsPairs = !!workflow.fillTransactionIdFromList;
        const canRunByScreen = !needsPairs;
        const storageKey = listStorageKey(workflow);
        const saved = readListStorage(storageKey);
        const rowsOnScreen = getTicketRows().length;

        overlay = document.createElement('div');
        // Классы намеренно НЕ .modal_wrap и НЕ .swal2-popup: иначе скрипт
        // принял бы собственное окно за окно сайта и встал бы на нём.
        overlay.className = 'bulk-approve-beta-list-overlay';
        overlay.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:2147483600',
          'background:rgba(0,0,0,.5)', 'display:flex',
          'align-items:center', 'justify-content:center', 'padding:20px',
        ].join(';');

        const panel = document.createElement('div');
        panel.style.cssText = [
          'background:#fff', 'color:#222', 'border-radius:8px',
          'box-shadow:0 10px 40px rgba(0,0,0,.35)', 'max-width:760px',
          'width:100%', 'max-height:90vh', 'display:flex',
          'flex-direction:column', 'font-family:system-ui,Arial,sans-serif',
          'font-size:14px', 'line-height:1.45',
        ].join(';');

        const body = document.createElement('div');
        body.style.cssText = 'padding:18px 20px;overflow:auto;flex:1';

        const title = document.createElement('div');
        title.textContent = workflow.buttonLabel;
        title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:4px';
        body.appendChild(title);

        // Что вообще произойдёт — раньше это был текст confirm()
        const plan = document.createElement('div');
        plan.style.cssText = 'color:#444;margin-bottom:12px;white-space:pre-wrap';
        plan.textContent = [
          `На экране сейчас тикетов: ${rowsOnScreen}.`,
          'Будут обработаны только те, у кого External Status — один из:',
          ...workflow.requiredExternalStatuses.map((name) => `  • ${name}`),
          `Остальные пропускаются. У подходящих будет выставлен статус ` +
            `"${workflow.targetStatusLabel}" и нажат Apply.`,
        ].join('\n');
        body.appendChild(plan);

        const hint = document.createElement('div');
        hint.textContent = needsPairs
          ? 'Вставь список: Ticket ID и Transaction ID через табуляцию, по паре в строке. ' +
            'Можно вставить весь список целиком — скрипт возьмёт только те тикеты, ' +
            'которые сейчас на странице (или наберёт их сам, если включён автопилот).'
          : 'Вставь список Ticket ID — по одному номеру в строке, без других колонок. ' +
            'Скрипт обработает только эти тикеты. Если список не нужен, нажми ' +
            '«Запустить по экрану» — тогда всё как раньше.';
        hint.style.cssText = 'color:#555;margin-bottom:12px';
        body.appendChild(hint);

        const area = document.createElement('textarea');
        area.value = saved ? saved.text : '';
        area.rows = 12;
        area.placeholder = needsPairs
          ? '22708318\t23658907281\n22707583\t23658797989'
          : '22708318\n22707583';
        area.style.cssText = [
          'width:100%', 'box-sizing:border-box', 'font-family:Consolas,monospace',
          'font-size:13px', 'padding:8px', 'border:1px solid #ccc',
          'border-radius:4px', 'resize:vertical', 'white-space:pre',
        ].join(';');
        body.appendChild(area);

        // Автопилот. Включён по умолчанию: ради него этот режим и делался,
        // а ручная работа пачками остаётся запасным путём — например, если
        // оператору нужно прогнать только то, что он уже отобрал на экране
        // своими фильтрами.
        const missingControls = autopilotMissingControls();

        const autoRow = document.createElement('label');
        autoRow.style.cssText =
          'display:flex;gap:8px;align-items:flex-start;margin-top:12px;cursor:pointer';

        const autoBox = document.createElement('input');
        autoBox.type = 'checkbox';
        autoBox.className = 'bulk-approve-beta-autopilot';
        autoBox.checked = missingControls.length === 0;
        autoBox.disabled = missingControls.length > 0;
        autoBox.style.cssText = 'margin-top:3px;flex-shrink:0';

        const autoText = document.createElement('div');
        autoText.style.cssText = 'color:#333';
        autoText.textContent =
          missingControls.length > 0
            ? `Автопилот недоступен: на странице нет ${missingControls.join(' и ')}. ` +
              'Разверни блок Quick filters и открой это окно заново. Сейчас будут ' +
              'обработаны только тикеты, которые уже на экране.'
            : `Автопилот: подставлять тикеты из списка в фильтр страницы пачками ` +
              `по ${CONFIG.autopilotChunkSize} и нажимать Apply самому. ` +
              `Текущая выдача на экране будет заменена.`;

        autoRow.appendChild(autoBox);
        autoRow.appendChild(autoText);
        body.appendChild(autoRow);

        const status = document.createElement('div');
        status.style.cssText = 'margin-top:10px;white-space:pre-wrap';
        body.appendChild(status);

        const footer = document.createElement('div');
        footer.style.cssText =
          'padding:12px 20px;border-top:1px solid #eee;display:flex;gap:8px;' +
          'justify-content:flex-end;flex-shrink:0;flex-wrap:wrap';

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Начать заново';
        resetBtn.title = 'Забыть сохранённый список и счётчики обработанного';
        resetBtn.style.cssText = [
          'padding:8px 16px', 'border:1px solid #bbb', 'border-radius:4px',
          'background:#f5f5f5', 'font-size:14px', 'cursor:pointer', 'margin-right:auto',
        ].join(';');

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Отмена';
        cancelBtn.style.cssText = [
          'padding:8px 20px', 'border:1px solid #bbb', 'border-radius:4px',
          'background:#f5f5f5', 'font-size:14px', 'cursor:pointer',
        ].join(';');

        // Прежнее поведение обычного 225: взять то, что оператор уже вывел
        // на экран сам. Отдельной кнопкой, а не пустым списком, — чтобы
        // «запустить без списка» нельзя было сделать случайно.
        const screenBtn = document.createElement('button');
        screenBtn.className = 'bulk-approve-beta-run-screen';
        screenBtn.textContent = `Запустить по экрану (${rowsOnScreen})`;
        screenBtn.style.cssText = [
          'padding:8px 20px', 'border:1px solid #2ABFCF', 'border-radius:4px',
          'background:#fff', 'color:#1a8d99', 'font-size:14px', 'cursor:pointer',
        ].join(';');

        const runBtn = document.createElement('button');
        runBtn.textContent = 'Запустить по списку';
        runBtn.style.cssText = [
          'padding:8px 20px', 'border:none', 'border-radius:4px',
          'background:#2ABFCF', 'color:#fff', 'font-size:14px', 'cursor:pointer',
        ].join(';');

        footer.appendChild(resetBtn);
        footer.appendChild(cancelBtn);
        if (canRunByScreen) footer.appendChild(screenBtn);
        footer.appendChild(runBtn);

        let parsed = null;

        // Тот же список, что лежит в памяти? Счётчики обработанного имеют
        // смысл только для него, и от этого же зависит, сколько тикетов
        // реально осталось прогнать.
        const savedFingerprintOf = (p) =>
          saved
            ? listFingerprint(parseListForWorkflow(workflow, saved.text).pairs) ===
              listFingerprint(p)
            : false;

        const refresh = () => {
          parsed = parseListForWorkflow(workflow, area.value);
          const lines = [];
          const sameAsSaved = savedFingerprintOf(parsed.pairs);
          const doneIds = new Set(sameAsSaved ? saved.done : []);
          const remainingCount = [...parsed.pairs.keys()].filter((id) => !doneIds.has(id)).length;

          lines.push(needsPairs
            ? `Распознано пар: ${parsed.pairs.size}`
            : `Распознано номеров: ${parsed.pairs.size}`);

          if (parsed.duplicates > 0) {
            lines.push(`Повторов в списке: ${parsed.duplicates} — схлопнул.`);
          }

          if (saved && saved.done.length > 0) {
            if (sameAsSaved) {
              lines.push(
                `В памяти: обработано ${saved.done.length}, ` +
                `с проблемами ${saved.needsAttention.length}, ` +
                `осталось ${remainingCount}`
              );
            } else {
              lines.push('Список изменился — счётчики обработанного сброшены.');
            }
          }

          if (autoBox.checked && remainingCount > 0) {
            const chunkCount = Math.ceil(remainingCount / CONFIG.autopilotChunkSize);
            lines.push(
              `Автопилот прогонит ${remainingCount} ` +
              `${chunkCount === 1 ? 'тикет(ов) одной пачкой' : `тикетов за ${chunkCount} пачек`}.`
            );
          }

          if (parsed.badLines.length > 0) {
            lines.push('');
            lines.push(`Не разобрал строк: ${parsed.badLines.length}`);
            parsed.badLines.slice(0, 10).forEach((b) => {
              lines.push(`  строка ${b.line}: ${b.why} — «${b.text}»`);
            });
            if (parsed.badLines.length > 10) {
              lines.push(`  … и ещё ${parsed.badLines.length - 10}`);
            }
            lines.push('Если первая строка — заголовок таблицы, её нужно убрать.');
          }

          if (parsed.duplicateTickets.length > 0) {
            lines.push('');
            lines.push('Один тикет с РАЗНЫМИ транзакциями — так нельзя:');
            parsed.duplicateTickets.slice(0, 10).forEach((d) => {
              lines.push(`  ${d.ticketId}: ${d.values.join(' и ')}`);
            });
          }

          if (parsed.duplicateTransactions.length > 0) {
            lines.push('');
            lines.push('Одна транзакция у РАЗНЫХ тикетов — так нельзя:');
            parsed.duplicateTransactions.slice(0, 10).forEach((d) => {
              lines.push(`  ${d.transactionId}: тикеты ${d.tickets.join(', ')}`);
            });
          }

          const blocked =
            parsed.pairs.size === 0 ||
            parsed.badLines.length > 0 ||
            parsed.duplicateTickets.length > 0 ||
            parsed.duplicateTransactions.length > 0;

          status.textContent = lines.join('\n');
          status.style.color = blocked && parsed.pairs.size > 0 ? '#B00020' : '#555';
          runBtn.disabled = blocked;
          runBtn.style.opacity = blocked ? '0.5' : '1';
          runBtn.style.cursor = blocked ? 'default' : 'pointer';

          // По экрану запускать нечего, если экран пуст
          screenBtn.disabled = rowsOnScreen === 0;
          screenBtn.style.opacity = rowsOnScreen === 0 ? '0.5' : '1';
          screenBtn.style.cursor = rowsOnScreen === 0 ? 'default' : 'pointer';
        };

        area.addEventListener('input', refresh);
        autoBox.addEventListener('change', refresh);
        refresh();

        resetBtn.addEventListener('click', () => {
          clearListStorage(storageKey);
          area.value = '';
          refresh();
        });
        cancelBtn.addEventListener('click', () => finish(null));
        screenBtn.addEventListener('click', () => {
          if (screenBtn.disabled) return;
          finish({ pairs: null, state: null, autopilot: false });
        });
        runBtn.addEventListener('click', () => {
          if (runBtn.disabled) return;
          const text = area.value;
          // Счётчики имеют смысл только для того же самого списка
          const keep = savedFingerprintOf(parsed.pairs);
          const state = {
            savedAt: Date.now(),
            text,
            done: keep ? saved.done.slice() : [],
            needsAttention: keep ? saved.needsAttention.slice() : [],
          };
          writeListStorage(storageKey, state);
          finish({
            pairs: parsed.pairs,
            state,
            autopilot: autoBox.checked && !autoBox.disabled,
          });
        });

        onKey = (e) => {
          if (e.key === 'Escape') finish(null);
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) finish(null);
        });

        panel.appendChild(body);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        area.focus();
      } catch (e) {
        console.error('[BulkApproveBETA] Не удалось показать окно ввода списка:', e);
        alert(
          'Не удалось показать окно ввода списка — подробности в консоли (F12). Прогон не начат.'
        );
        finish(null);
      }
    });
  }

  // ------------------------------------------------------------------
  // СЧЁТЧИК ПРОГРЕССА.
  //
  // Прогон сотни тикетов идёт больше десяти минут, и почти всё это время
  // скрипт просто ждёт сайт. Без панели единственный признак жизни — строки
  // в консоли, и отличить «работает» от «завис» невозможно.
  // ------------------------------------------------------------------
  const progressState = {
    visible: false,
    title: '',
    index: 0,
    total: 0,
    ticketId: '',
    ok: 0,
    skipped: 0,
    failed: 0,
    action: '',
    listLine: '',
    chunkLine: '',
  };
  let progressBox = null;

  function setProgress(patch) {
    Object.assign(progressState, patch);
    renderProgress();
  }

  function renderProgress() {
    try {
      if (!progressState.visible) {
        if (progressBox) progressBox.style.display = 'none';
        return;
      }
      if (!progressBox) {
        progressBox = document.createElement('div');
        progressBox.id = 'bulk-approve-beta-progress';
        progressBox.style.cssText = [
          'position:fixed', 'right:20px', 'bottom:70px', 'z-index:999998',
          'background:rgba(28,28,30,.92)', 'color:#fff', 'padding:10px 14px',
          'border-radius:8px', 'font-family:system-ui,Arial,sans-serif',
          'font-size:13px', 'line-height:1.5', 'max-width:340px',
          'box-shadow:0 4px 12px rgba(0,0,0,.25)', 'pointer-events:none',
          'white-space:pre-wrap',
        ].join(';');
        document.body.appendChild(progressBox);
      }
      progressBox.style.display = 'block';

      const lines = [progressState.title];
      if (progressState.chunkLine) lines.push(progressState.chunkLine);
      lines.push(
        `Тикет ${progressState.index} из ${progressState.total}` +
        (progressState.ticketId ? ` · ${progressState.ticketId}` : '')
      );
      lines.push(
        `успешно ${progressState.ok} · пропущено ${progressState.skipped} · ошибок ${progressState.failed}`
      );
      if (progressState.listLine) lines.push(progressState.listLine);
      if (progressState.action) lines.push(`${progressState.action}…`);
      progressBox.textContent = lines.join('\n');
    } catch (e) {
      /* панель — удобство, ронять из-за неё прогон нельзя */
    }
  }

  function hideProgress() {
    progressState.visible = false;
    renderProgress();
  }

  // Одна колодка «подпись + поле + кнопка Скопировать». Блоков в окне может
  // быть несколько: в режиме по списку копировать надо и оставшиеся Ticket ID
  // для следующей пачки, и проблемные тикеты, и таблицу для учёта.
  function appendCopyBlock(body, block) {
    const label = document.createElement('div');
    label.textContent = block.label;
    label.style.cssText = 'margin:18px 0 6px;font-weight:600';
    body.appendChild(label);

    const area = document.createElement('textarea');
    area.className = 'bulk-approve-beta-report-copy';
    area.readOnly = true;
    area.value = block.text;
    area.rows = Math.min(block.text.split('\n').length + 1, 12);
    area.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'font-family:Consolas,monospace',
      'font-size:13px', 'padding:8px', 'border:1px solid #ccc',
      'border-radius:4px', 'resize:vertical', 'white-space:pre',
    ].join(';');
    area.addEventListener('focus', () => area.select());
    body.appendChild(area);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Скопировать';
    copyBtn.style.cssText = [
      'margin-top:8px', 'padding:8px 16px', 'border:none',
      'border-radius:4px', 'background:#2ABFCF', 'color:#fff',
      'font-size:14px', 'cursor:pointer',
    ].join(';');
    copyBtn.addEventListener('click', async () => {
      // Выделяем в любом случае: даже если запись в буфер не пройдёт,
      // человек сможет нажать Ctrl+C сам.
      area.focus();
      area.select();
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(block.text);
          ok = true;
        }
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        try {
          ok = document.execCommand('copy');
        } catch (e) {
          ok = false;
        }
      }
      copyBtn.textContent = ok ? 'Скопировано ✓' : 'Выделено — нажми Ctrl+C';
      copyBtn.style.background = ok ? '#3BA55D' : '#E0A030';
      setTimeout(() => {
        copyBtn.textContent = 'Скопировать';
        copyBtn.style.background = '#2ABFCF';
      }, 2500);
    });
    body.appendChild(copyBtn);
  }

  function showReportWindow(reportText, copyBlocks) {
    // Если что-то пойдёт не так с вёрсткой — отчёт всё равно должен дойти
    // до человека, поэтому любой сбой откатывается на обычный alert.
    try {
      const existing = document.querySelector('.bulk-approve-beta-report-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.className = 'bulk-approve-beta-report-overlay';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483600',
        'background:rgba(0,0,0,.5)', 'display:flex',
        'align-items:center', 'justify-content:center', 'padding:20px',
      ].join(';');

      const panel = document.createElement('div');
      panel.style.cssText = [
        'background:#fff', 'color:#222', 'border-radius:8px',
        'box-shadow:0 10px 40px rgba(0,0,0,.35)', 'max-width:820px',
        'width:100%', 'max-height:90vh', 'display:flex',
        'flex-direction:column', 'font-family:system-ui,Arial,sans-serif',
        'font-size:14px', 'line-height:1.45',
      ].join(';');

      const body = document.createElement('div');
      body.style.cssText = 'padding:18px 20px;overflow:auto;flex:1';

      const report = document.createElement('pre');
      report.className = 'bulk-approve-beta-report-text';
      report.textContent = reportText;
      report.style.cssText = [
        'margin:0', 'white-space:pre-wrap', 'word-break:break-word',
        'font-family:inherit', 'font-size:14px', 'user-select:text',
      ].join(';');
      body.appendChild(report);

      (copyBlocks || [])
        .filter((block) => block && block.text !== '')
        .forEach((block) => appendCopyBlock(body, block));

      const footer = document.createElement('div');
      footer.style.cssText =
        'padding:12px 20px;border-top:1px solid #eee;text-align:right;flex-shrink:0';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Закрыть';
      closeBtn.style.cssText = [
        'padding:8px 20px', 'border:1px solid #bbb', 'border-radius:4px',
        'background:#f5f5f5', 'font-size:14px', 'cursor:pointer',
      ].join(';');
      footer.appendChild(closeBtn);

      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close();
      };
      closeBtn.addEventListener('click', close);
      // Клик мимо панели закрывает, клик по самой панели — нет
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      document.addEventListener('keydown', onKey);

      panel.appendChild(body);
      panel.appendChild(footer);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      closeBtn.focus();
    } catch (e) {
      console.error('[BulkApproveBETA] Не удалось показать окно отчёта, показываю обычный alert:', e);
      alert(reportText);
    }
  }

  function requestStop() {
    if (!state.isRunning) return;
    state.stopRequested = true;
    console.log('[BulkApproveBETA] Запрошена остановка — завершаю текущий шаг и останавливаюсь...');
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
    stopBtn.textContent = state.stopRequested ? 'Останавливаю...' : 'СТОП (BETA)';
  }

  function addTriggerButtons() {
    if (document.getElementById('bulk-approve-beta-btn')) return;

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
      btn.id = idx === 0 ? 'bulk-approve-beta-btn' : `bulk-approve-beta-btn-${workflow.id}`;
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
        runBulkApprove(workflow).catch((e) => console.error(`[BulkApproveBETA/${workflow.id}] Fatal error:`, e));
      });
      container.appendChild(btn);
      return btn;
    });

    stopBtn = document.createElement('button');
    stopBtn.id = 'bulk-approve-beta-stop-btn';
    stopBtn.textContent = 'СТОП (BETA)';
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

    console.log('[BulkApproveBETA] Жду появления таблицы тикетов...');
    let lastLog = Date.now();

    const observer = new MutationObserver(() => {
      if (document.querySelector('.table-wrapper tbody tr[data-table-row]')) {
        observer.disconnect();
        console.log('[BulkApproveBETA] Таблица найдена, добавляю кнопки.');
        addTriggerButtons();
        return;
      }
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        console.log('[BulkApproveBETA] Всё ещё жду таблицу тикетов...');
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  installRequestLog();
  waitForeverAndAddButtons();

})();
