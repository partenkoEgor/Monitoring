// Сценарии для режима «по списку (225)». Запуск: npm test (или node run.js).
// ONLY=1,3 node run.js — только названные сценарии. DEBUG=1 — консоль скрипта.
// TARGET=main node run.js — те же сценарии на основном скрипте (по умолчанию бета).
'use strict';

const fs = require('fs');
const { createPage } = require('./harness');

const IS_BETA = (process.env.TARGET || 'beta') === 'beta';
const LABEL = IS_BETA ? 'BETA ' : '';
const LIST_BTN = `${LABEL}Bulk Approve по списку (225)`;
const SCREEN_BTN = `${LABEL}Bulk Approve (225)`;
const TX_LIST_KEY = `th-bulk-approve:tx-list:v1${IS_BETA ? '-beta' : ''}`;

let passed = 0;
let failed = 0;
function check(name, cond, dump) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
    if (dump !== undefined) console.log(String(dump).split('\n').map((l) => '     ' + l).join('\n'));
  }
}

// n тикетов в Approved (M) с пустым Transaction ID + один посторонний на экране,
// чтобы у скрипта появились кнопки
function makeTickets(n, base = 22700000) {
  const tickets = { 19999999: { externalStatus: 'Closed (M)', txId: '1' } };
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const id = String(base + i);
    ids.push(id);
    tickets[id] = { externalStatus: 'Approved (M)', txId: '', hoursAgo: i % 4 === 0 ? 30 : 2 };
  }
  const listText = ids.map((id, i) => `${id}\t2385${String(i).padStart(7, '0')}`).join('\n');
  return { tickets, ids, listText };
}

const line = (text, re) => (text.match(re) || [])[0] || '(нет строки)';

// Файлы из zip без сжатия (так собирает xlsx скрипт): имя → текст
function readStoredZip(buf) {
  const files = {};
  for (let i = 0; i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50;) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    files[name] = buf.slice(start, start + size).toString('utf8');
    i = start + size;
  }
  return files;
}

const scenarios = {
  async 1() {
    console.log('\n[1] Сбой посреди списка, затем догоняем: отчёт — итог по всему списку');
    const { tickets, ids, listText } = makeTickets(12);
    const behaviour = { editBroken: null };
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour, configOverrides: { autopilotChunkSize: 5 } });

    // Первый прогон: после 4 закрытых тикетов сайт «залагал» — окна Edit не открываются
    behaviour.editBroken = (id) => ids.indexOf(id) >= 4;
    const r1 = await page.run({ button: LIST_BTN, listText });
    check('1-й прогон остановился сам после серии ошибок', /ПРОГОН ОСТАНОВЛЕН АВТОМАТИЧЕСКИ/.test(r1.text), r1.text);
    check('1-й: итог по списку, прогон 1', /ИТОГ ПО ВСЕМУ СПИСКУ \(12 тикетов, прогонов: 1\)/.test(r1.text), r1.text);
    check('1-й: успешно 4', /^Успешно: 4$/m.test(r1.text), line(r1.text, /^Успешно.*$/m));
    check('1-й: ошибок 3', /^Ошибок: 3$/m.test(r1.text), line(r1.text, /^Ошибок.*$/m));

    // Второй прогон: сайт ожил
    behaviour.editBroken = null;
    const r2 = await page.run({ button: LIST_BTN, listText });
    check('2-й: итог по списку, прогонов 2', /ИТОГ ПО ВСЕМУ СПИСКУ \(12 тикетов, прогонов: 2\)/.test(r2.text), r2.text);
    check('2-й: «Успешно» — по всему списку, 12', /^Успешно: 12$/m.test(r2.text), line(r2.text, /^Успешно.*$/m));
    check('2-й: старые ошибки ушли — тикеты закрыты', /^Ошибок: 0$/m.test(r2.text), line(r2.text, /^Ошибок.*$/m));
    check('2-й: свежие + зависшие = 12',
      /из них свежих \(меньше 24 ч\): 9/.test(r2.text) && /из них зависших \(24 ч и больше\): 3/.test(r2.text), r2.text);
    check('2-й: осталось 0', /Обработано из списка всего: 12 из 12, осталось 0/.test(r2.text), r2.text);
    check('2-й: строка про этот прогон — закрыто +8', /В этом прогоне: закрыто \+8, пропущено 0, ошибок 0/.test(r2.text), r2.text);
    check('2-й прогон не трогал закрытые в 1-м', page.site.applied.length === 12, page.site.applied.length);
    check('нет перечня успешно вписанных', !/Вписан Transaction ID \(/.test(r2.text), r2.text);
    check('нет блока со списком закрытых «Для таблицы (N) — Ticket ID, Transaction ID»',
      !r2.copyBlocks.some((b) => /Для таблицы \(\d+\) — Ticket ID/.test(b.label)), JSON.stringify(r2.copyBlocks.map((b) => b.label)));
  },

  async 2() {
    console.log('\n[2] Дубли и выбывшие считаются по всему списку, а не за прогон');
    const { tickets, ids, listText } = makeTickets(8);
    tickets[ids[5]].externalStatus = '225 Approved by agent'; // кто-то уже закрыл
    const behaviour = { duplicateOwner: (id) => (id === ids[1] ? '22600000' : null), editBroken: null };
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour, configOverrides: { autopilotChunkSize: 4 } });

    behaviour.editBroken = (id) => ids.indexOf(id) >= 6;
    const r1 = await page.run({ button: LIST_BTN, listText });
    check('1-й: дубль посчитан', /Пропущено \(транзакция занята другим обращением\): 1/.test(r1.text), r1.text);

    behaviour.editBroken = null;
    const r2 = await page.run({ button: LIST_BTN, listText });
    check('2-й: дубль из прошлого прогона по-прежнему в сводке',
      /Пропущено \(транзакция занята другим обращением\): 1/.test(r2.text), r2.text);
    check('2-й: выбывший по-прежнему в сводке со статусом',
      /Пропущено \(не тот External Status\): 1/.test(r2.text) && /• 225 Approved by agent: 1/.test(r2.text), r2.text);
    check('2-й: успешно 6 (8 минус дубль и выбывший)', /^Успешно: 6$/m.test(r2.text), line(r2.text, /^Успешно.*$/m));
    check('2-й: раздел дублей и кнопка Excel на месте',
      /ТРАНЗАКЦИЯ ЗАНЯТА ДРУГИМ ОБРАЩЕНИЕМ \(1/.test(r2.text) && r2.hasDownload, r2.text);
    check('2-й: дубль заново не открывали', page.site.modalOpens.filter((id) => id === ids[1]).length === 1,
      JSON.stringify(page.site.modalOpens));
  },

  async 3() {
    console.log('\n[3] Память пишется по ходу: вкладка «упала» посреди прогона — сделанное не потеряно');
    const { tickets, ids, listText } = makeTickets(6);
    let midRun = null;
    const behaviour = {
      // После третьего Apply снимаем копию памяти — как будто вкладку закрыли здесь
      onApplied: (site, w) => {
        if (site.applied.length === 3 && !midRun) {
          midRun = w.localStorage.getItem(TX_LIST_KEY);
        }
      },
    };
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour });
    await page.run({ button: LIST_BTN, listText });
    const mem = midRun ? JSON.parse(midRun) : null;
    check('посреди прогона память уже записана', !!mem, midRun);
    check('в ней закрытые до «падения» тикеты', mem && mem.done.length >= 2, mem && JSON.stringify(mem.done));
    check('и их результаты для итогового отчёта', mem && Object.keys(mem.results).length >= 2, mem && Object.keys(mem.results));

    // Новая вкладка с той же памятью — как после перезагрузки
    const fresh = makeTickets(6);
    Object.entries(fresh.tickets).forEach(([id, t]) => {
      if (mem.done.includes(id)) t.externalStatus = '225 Approved by agent';
    });
    const page2 = createPage({ tickets: fresh.tickets, onScreen: ['19999999'] });
    page2.w.localStorage.setItem(TX_LIST_KEY, midRun);
    const r = await page2.run({ button: LIST_BTN, listText });
    check('после перезагрузки закрытые до сбоя не запрашивались',
      page2.site.filterApplies.flat().every((id) => !mem.done.includes(id)), JSON.stringify(page2.site.filterApplies));
    check('итог — по всему списку: успешно 6', /^Успешно: 6$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('прогонов: 2 (упавший тоже считается)', /прогонов: 2\)/.test(r.text), r.text);
  },

  async 4() {
    console.log('\n[4] Память старого формата (до 0.13 в бете, до 3.2 в основном) — закрытые из неё входят в итог');
    const { tickets, ids, listText } = makeTickets(5);
    tickets[ids[0]].externalStatus = '225 Approved by agent';
    tickets[ids[1]].externalStatus = '225 Approved by agent';
    const page = createPage({ tickets, onScreen: ['19999999'] });
    page.w.localStorage.setItem(TX_LIST_KEY, JSON.stringify({
      savedAt: Date.now(), text: listText, done: [ids[0], ids[1]], needsAttention: [], duplicates: [], dropped: [],
    }));
    const r = await page.run({ button: LIST_BTN, listText });
    check('успешно 5 (2 из старой памяти + 3 сейчас)', /^Успешно: 5$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('в этом прогоне +3', /В этом прогоне: закрыто \+3/.test(r.text), r.text);
    check('у восстановленных — своя строка про возраст, а не «нечитаемая дата»',
      /закрыты до версии (0\.13|3\.2) — возраст не сохранился: 2/.test(r.text) && !/нечитаемой Processing Date/.test(r.text), r.text);
    check('старые закрытые не запрашивались', page.site.filterApplies.flat().every((id) => id !== ids[0] && id !== ids[1]),
      JSON.stringify(page.site.filterApplies));
  },

  async 5() {
    console.log('\n[5] Без автопилота: закрытый ранее тикет снова на экране не превращается в «выбывший»');
    const { tickets, ids, listText } = makeTickets(3);
    const page = createPage({ tickets, onScreen: ['19999999'] });
    await page.run({ button: LIST_BTN, listText });
    // Те же тикеты на экране (уже в 225 Approved by agent), прогон без автопилота
    page.site.onScreen = [...ids];
    page.renderTable();
    const r = await page.run({ button: LIST_BTN, listText, autopilot: false });
    check('успешно 3 — закрытые не откатились', /^Успешно: 3$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('выбывших нет', /Пропущено \(не тот External Status\): 0/.test(r.text) && !/выбыло/.test(r.text), r.text);
  },

  async 6() {
    console.log('\n[6] Режим по экрану без списка — отчёт как раньше, за этот прогон');
    const { tickets, ids } = makeTickets(3);
    ids.forEach((id) => { tickets[id].txId = '555' + id; });
    const page = createPage({ tickets, onScreen: [...ids] });
    const r = await page.run({ button: SCREEN_BTN, byScreen: true });
    check('нет строки «ИТОГ ПО ВСЕМУ СПИСКУ»', !/ИТОГ ПО ВСЕМУ СПИСКУ/.test(r.text), r.text);
    check('успешно 3', /^Успешно: 3$/m.test(r.text), line(r.text, /^Успешно.*$/m));
  },

  async 7() {
    console.log('\n[7] «Начать заново» стирает и накопленные результаты');
    const { tickets, ids, listText } = makeTickets(3);
    const page = createPage({ tickets, onScreen: ['19999999'] });
    await page.run({ button: LIST_BTN, listText });
    check('после прогона результаты в памяти', Object.keys(page.readMemory('pairs').results).length === 3);
    const btn = [...page.d.querySelectorAll('button')].find((b) => b.textContent === LIST_BTN);
    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    const overlay = page.d.querySelector(`.${page.prefix}-list-overlay`);
    [...overlay.querySelectorAll('button')].find((b) => b.textContent === 'Начать заново').click();
    check('память стёрта', page.readMemory('pairs') === null, JSON.stringify(page.readMemory('pairs')));
    [...overlay.querySelectorAll('button')].find((b) => b.textContent === 'Отмена').click();
  },
  async 8() {
    console.log('\n[8] Окно отчёта: Excel с дублями, закрытие только кнопкой с подтверждением');
    const { tickets } = makeTickets(1);
    const page = createPage({ tickets, onScreen: ['19999999'] });
    const { w, d, site, prefix } = page;
    const dups = [
      { ticketId: '23236860', transactionId: '23855421409', ownerTicketId: '23254490' },
      { ticketId: '23300001', transactionId: 'TXN-77', ownerTicketId: null },
    ];
    w.__t.showReportWindow('Готово.', [], { duplicates: dups });
    const overlay = d.querySelector(`.${prefix}-report-overlay`);
    const dl = d.querySelector(`.${prefix}-report-download`);
    check('кнопка «Скачать отчёт» есть', dl && dl.textContent === 'Скачать отчёт (2 дублей, Excel)', dl && dl.textContent);
    dl.click();
    check('файл .xlsx отдан на скачивание',
      site.downloads.length === 1 && /^dubli-tranzakcij_.*\.xlsx$/.test(site.downloads[0]), JSON.stringify(site.downloads));
    const buf = await new Promise((res) => {
      const fr = new w.FileReader();
      fr.onload = () => res(Buffer.from(fr.result));
      fr.readAsArrayBuffer(site.blobs[0]);
    });
    fs.writeFileSync(`${__dirname}/last-duplicates.xlsx`, buf);
    check('это zip (подпись PK)', buf[0] === 0x50 && buf[1] === 0x4b, buf.slice(0, 4));
    const xml = buf.toString('latin1');
    check('в листе объединения B2:B3 и B4:B5', xml.includes('<mergeCell ref="B2:B3"/>') && xml.includes('<mergeCell ref="B4:B5"/>'));

    overlay.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('клик мимо и Esc не закрывают', !!d.querySelector(`.${prefix}-report-overlay`));
    w.confirm = (t) => { site.confirms.push(t); return false; };
    const close = [...overlay.querySelectorAll('button')].find((b) => b.textContent === 'Закрыть');
    close.click();
    check('«Закрыть» спрашивает, отказ — окно остаётся',
      site.confirms.at(-1) === 'Точно хотите закрыть отчёт?' && !!d.querySelector(`.${prefix}-report-overlay`));
    w.confirm = () => true;
    close.click();
    check('согласие — окно закрыто', !d.querySelector(`.${prefix}-report-overlay`));
    w.__t.showReportWindow('Готово.', []);
    check('без дублей кнопки нет', !d.querySelector(`.${prefix}-report-download`));
  },

  async 9() {
    console.log('\n[9] Столбик для таблицы отчёта — «по списку (225)» (Inside comment)');
    const { tickets, ids, listText } = makeTickets(8);
    tickets[ids[5]].externalStatus = '225 Approved by agent'; // сменил статус в процессе
    const behaviour = {
      duplicateOwner: (id) => (id === ids[1] ? '22600000' : null),
      editBroken: (id) => id === ids[6], // одна ошибка
    };
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour });
    const r = await page.run({ button: LIST_BTN, listText });
    const block = r.copyBlocks.find((b) => /Для таблицы отчёта/.test(b.label));
    check('блок есть и подписан под Inside comment', block && /Inside comment/.test(block.label), JSON.stringify(r.copyBlocks.map((b) => b.label)));
    // успешно 5 (из них <24 ч — 3, >24 ч — 2), пустая строка, ошибок 1, сменили статус 1, дубликаты 1
    check('числа в порядке строк таблицы, с пустой строкой', block && block.text === '5\n3\n2\n\n1\n1\n1', block && JSON.stringify(block.text));
    check('блок — первый среди блоков для копирования', r.copyBlocks[0] === block);

    // Второй прогон: ошибка ушла — столбик по всему списку
    behaviour.editBroken = null;
    const r2 = await page.run({ button: LIST_BTN, listText });
    const block2 = r2.copyBlocks.find((b) => /Для таблицы отчёта/.test(b.label));
    check('после догона — итог по всему списку', block2 && block2.text === '6\n4\n2\n\n0\n1\n1', block2 && JSON.stringify(block2.text));
  },

  async 10() {
    console.log('\n[10] Столбик для таблицы отчёта — обычный «Bulk Approve (225)» (Transaction ID)');
    const { tickets, ids } = makeTickets(5);
    ids.forEach((id) => { tickets[id].txId = '555' + id; });
    tickets[ids[2]].externalStatus = 'Closed (M)'; // сменил статус
    const behaviour = { popupOnApply: (id) => (id === ids[0] ? 'Транзакция уже использует обращение 22600000' : null) };
    const page = createPage({ tickets, onScreen: [...ids], behaviour });
    const r = await page.run({ button: SCREEN_BTN, byScreen: true });
    const block = r.copyBlocks.find((b) => /Для таблицы отчёта/.test(b.label));
    check('блок есть и подписан под Transaction ID', block && /Transaction ID/.test(block.label), JSON.stringify(r.copyBlocks.map((b) => b.label)));
    // успешно 4 (<24 ч — 3, >24 ч — 1: тикет №4), ошибок 0, сменили статус 1, дубликаты 1 (пойманное окно)
    check('числа в порядке строк таблицы, с пустой строкой', block && block.text === '4\n3\n1\n\n0\n1\n1', block && JSON.stringify(block.text));
  },

  async 11() {
    console.log('\n[11] У Bulk Response (239) столбика нет');
    const { tickets, ids } = makeTickets(1);
    tickets[ids[0]].externalStatus = 'The money has not been sent, cancel it (M)';
    tickets[ids[0]].txStatus = 'rejected';
    tickets[ids[0]].txId = '777';
    const page = createPage({ tickets, onScreen: [...ids] });
    const btn = [...page.d.querySelectorAll('button')].find((b) => b.textContent === `${LABEL}Bulk Response (239)`);
    btn.click();
    const end = Date.now() + 20000;
    let report;
    while (!(report = page.d.querySelector(`.${page.prefix}-report-overlay`)) && Date.now() < end) {
      await new Promise((res) => setTimeout(res, 20));
    }
    const labels = report ? [...report.querySelectorAll(`.${page.prefix}-report-copy`)].map((a) => a.previousElementSibling.textContent) : null;
    check('отчёт 239 показан', !!report);
    check('блока «Для таблицы отчёта» нет', labels && !labels.some((l) => /Для таблицы отчёта/.test(l)), JSON.stringify(labels));
  },

  // ---------- с 0.16 / 3.3: проверка списка на сайте и сессия ----------

  async 12() {
    console.log('\n[12] Проверка списка на сайте до прогона — «по списку (225)»');
    const { tickets, ids, listText } = makeTickets(10);
    tickets[ids[1]].externalStatus = '225 Approved by agent'; // уже закрыт кем-то
    tickets[ids[2]].externalStatus = 'Closed (M)';
    const wantedTx = (i) => `2385${String(i).padStart(7, '0')}`;
    tickets[ids[4]].txId = wantedTx(4); // номер уже стоит, тот же
    tickets[ids[5]].txId = '999';       // стоит чужой номер
    const behaviour = { listApi: true, hiddenFromFilter: [ids[3]] };
    const fast = { autopilotChunkSize: 4, precheckChunkSize: 4, precheckBetweenRequestsDelay: 1 };
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour, configOverrides: fast });

    const win = await page.run({ button: LIST_BTN, listText, onlyWindow: true });
    const t = win.precheckText;
    check('окно: проверено 10', /Проверено на сайте: 10/.test(t), t);
    check('окно: к прогону 7', /к прогону \(статус Approved \(M\)\): 7/.test(t), t);
    check('окно: другой статус 2 с разбивкой',
      /другой статус — пропущу, не открывая: 2/.test(t) && /225 Approved by agent: 1/.test(t) && /Closed \(M\): 1/.test(t), t);
    check('окно: сайт не нашёл 1, с номером', /сайт не нашёл по фильтру: 1/.test(t) && t.includes(ids[3]), t);
    check('окно: Transaction ID — пусто 5, тот же 1, другой 1',
      /Transaction ID у тикетов к прогону: пусто 5, тот же 1, другой 1/.test(t), t);
    check('окно: чужой номер назван', t.includes(`${ids[5]}: в тикете 999, в списке ${wantedTx(5)}`), t);
    check('запуск не заблокирован', !win.startDisabled);
    check('запрос страницы подхвачен одним нажатием Apply', page.site.filterApplies.length === 1,
      JSON.stringify(page.site.filterApplies));
    check('проверка шла пачками по 4 (3 запроса)', page.site.listQueries.length === 3,
      JSON.stringify(page.site.listQueries.map((q) => q.ids.length)));
    check('заголовки страницы ушли с запросом (токен)',
      page.site.listQueries.every((q) => q.headers && q.headers['X-CSRF-TOKEN'] === 'test-token'),
      JSON.stringify(page.site.listQueries[0].headers));

    const r = await page.run({ button: LIST_BTN, listText });
    const opened = new Set(page.site.modalOpens);
    const requested = new Set(page.site.filterApplies.flat());
    check('чужой статус и ненайденный не открывались', ![ids[1], ids[2], ids[3]].some((id) => opened.has(id)),
      JSON.stringify(page.site.modalOpens));
    check('и в фильтр не подставлялись', ![ids[1], ids[2], ids[3]].some((id) => requested.has(id)),
      JSON.stringify(page.site.filterApplies));
    check('успешно 6 (7 к прогону минус чужой номер без галочки)', /^Успешно: 6$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('пропуски по статусу посчитаны как обычно', /^Пропущено \(не тот External Status\): 2$/m.test(r.text), r.text);
    check('строка проверки в отчёте',
      /Проверка списка на сайте до прогона: проверено 10 — к прогону 7, другой статус 2 \(пропущены без открытия\), сайт не нашёл 1, транзакция занята 0 \(не открывались\); в тикете уже другой Transaction ID: 1/.test(r.text), r.text);
    check('память: чужой статус — выбыли', [ids[1], ids[2]].every((id) => r.memory.dropped.some((d) => d.ticketId === id)),
      JSON.stringify(r.memory.dropped));
    check('память: ненайденный — «сайт не показал»', r.memory.notShown.includes(ids[3]), JSON.stringify(r.memory.notShown));

    // Повтор того же списка: в работе остались ненайденный и тикет с чужим номером
    const queriesBefore = page.site.listQueries.length;
    const win2 = await page.run({ button: LIST_BTN, listText, onlyWindow: true });
    check('повтор: проверяются только оставшиеся 2', /Проверено на сайте: 2/.test(win2.precheckText), win2.precheckText);
    check('повтор: запрос страницы уже был — без нового Apply', page.site.filterApplies.length === 1 + 2,
      JSON.stringify(page.site.filterApplies));
    check('повтор: один запрос проверки', page.site.listQueries.length === queriesBefore + 1);
  },

  async 13() {
    console.log('\n[13] Проверка списка — обычный «Bulk Approve (225)» со списком Ticket ID');
    const { tickets, ids } = makeTickets(3);
    ids.forEach((id) => { tickets[id].txId = '555' + id; });
    tickets[ids[1]].externalStatus = 'Closed (M)';
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour: { listApi: true } });
    const r = await page.run({ button: SCREEN_BTN, listText: ids.join('\n') });
    check('окно: к прогону 2, другой статус 1',
      /к прогону \(статус Approved \(M\)\): 2/.test(r.precheckText) && /другой статус — пропущу, не открывая: 1/.test(r.precheckText),
      r.precheckText);
    check('окно: про Transaction ID ни слова — в этом режиме его не вписывают', !/Transaction ID/.test(r.precheckText), r.precheckText);
    check('отчёт: успешно 2', /^Успешно: 2$/m.test(r.text), r.text);
    check('тикет в чужом статусе не открывался', !page.site.modalOpens.includes(ids[1]), JSON.stringify(page.site.modalOpens));
  },

  async 14() {
    console.log('\n[14] Сессия истекла до прогона — запуск закрыт, причина в окне');
    const { tickets, listText } = makeTickets(3);
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour: { listApi: true, sessionExpired: true } });
    const win = await page.run({ button: LIST_BTN, listText, onlyWindow: true });
    check('окно: СЕССИЯ ИСТЕКЛА', /СЕССИЯ ИСТЕКЛА/.test(win.precheckText), win.precheckText);
    check('кнопка запуска заблокирована', win.startDisabled === true);
    check('ни одного окна Edit', page.site.modalOpens.length === 0);
  },

  async 15() {
    console.log('\n[15] Сессия истекла посреди прогона — остановка с понятной причиной');
    const { tickets, ids, listText } = makeTickets(10);
    const behaviour = {
      listApi: true,
      onApplied: (site) => { if (site.applied.length === 2) site.behaviour.sessionExpired = true; },
    };
    const page = createPage({
      tickets, onScreen: ['19999999'], behaviour,
      configOverrides: { keepaliveInterval: 20, sessionRecheckDelay: 10 },
    });
    const r = await page.run({ button: LIST_BTN, listText });
    check('остановлен автоматически из-за сессии',
      /ПРОГОН ОСТАНОВЛЕН АВТОМАТИЧЕСКИ\.\nСЕССИЯ ИСТЕКЛА/.test(r.text), r.text.slice(0, 400));
    check('остановился рано, а не дошёл до конца', page.site.applied.length < 10, page.site.applied.length);
    check('сделанное сохранено в памяти списка', r.memory && r.memory.done.length === page.site.applied.length,
      JSON.stringify(r.memory && r.memory.done));
    check('остановился после тикета в работе, а не посреди него', /Прогон остановлен после тикета, который был в работе/.test(r.text), r.text.slice(0, 400));
    check('подсказка: войти заново и запустить тот же список', /войди заново и запусти тот же список/.test(r.text), r.text.slice(0, 400));
  },

  async 16() {
    console.log('\n[16] Сайт не ответил на проверку — прогон идёт как раньше, без ложной остановки');
    const { tickets, listText } = makeTickets(4);
    const page = createPage({
      tickets, onScreen: ['19999999'], behaviour: { listApi: true, listApiStatus: 503 },
      configOverrides: { precheckRetries: 1, precheckRetryDelay: 5, keepaliveInterval: 20, sessionRecheckDelay: 10 },
    });
    const r = await page.run({ button: LIST_BTN, listText });
    check('окно: проверка не удалась, с кодом', /Проверка списка на сайте не удалась: сайт ответил 503/.test(r.precheckText), r.precheckText);
    check('прогон прошёл весь список', /^Успешно: 4$/m.test(r.text), r.text);
    check('503 при продлении сессии не остановил прогон', !/СЕССИЯ ИСТЕКЛА/.test(r.text) && /^Готово\./.test(r.text), r.text.slice(0, 300));
    check('строки проверки в отчёте нет — проверки не было', !/Проверка списка на сайте до прогона/.test(r.text), r.text);
  },

  async 17() {
    console.log('\n[17] Дубли находятся до прогона и не открываются (0.17)');
    const { tickets, ids, listText } = makeTickets(6);
    const wantedTx = (i) => `2385${String(i).padStart(7, '0')}`;
    const behaviour = {
      listApi: true,
      duplicateOwner: (id) => (id === ids[1] ? '22600001' : id === ids[4] ? '22600004' : null),
      dupCheckOwnId: new Set([ids[2]]), // сайт назвал сам тикет — это не дубль
    };
    tickets[ids[3]].txId = wantedTx(3); // номер уже стоит — спрашивать не о чем
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour });
    const r = await page.run({ button: LIST_BTN, listText, closeReport: false });
    const t = r.precheckText;
    check('окно: занято 2, с номерами владельцев',
      /транзакция уже занята другим обращением: 2/.test(t) &&
      t.includes(`${ids[1]} → ${wantedTx(1)} уже у обращения 22600001`) &&
      t.includes(`${ids[4]} → ${wantedTx(4)} уже у обращения 22600004`), t);
    check('окно: к прогону 4', /к прогону \(статус Approved \(M\)\): 4/.test(t), t);
    check('окно: строка автопилота — по итогам проверки',
      /Автопилот прогонит 4 тикета одной пачкой \(по итогам проверки на сайте\)\./.test(r.windowText), r.windowText);
    check('проверка дублей: тот, где номер уже стоит, не спрашивался',
      page.site.dupChecks.length === 5 && !page.site.dupChecks.some((c) => String(c.requestId) === ids[3]),
      JSON.stringify(page.site.dupChecks.map((c) => c.requestId)));
    const c0 = page.site.dupChecks[0];
    check('проверка дублей: поля как у сайта (trxId строкой, paymentTypeId и requestId числами)',
      typeof c0.trxId === 'string' && c0.paymentTypeId === 1 && typeof c0.requestId === 'number', JSON.stringify(c0));
    check('дубли не открывались', ![ids[1], ids[4]].some((id) => page.site.modalOpens.includes(id)),
      JSON.stringify(page.site.modalOpens));
    check('успешно 4', /^Успешно: 4$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('раздел дублей: оба, «по списку», с владельцами',
      /ТРАНЗАКЦИЯ ЗАНЯТА ДРУГИМ ОБРАЩЕНИЕМ \(2\)/.test(r.text) &&
      r.text.includes(`${ids[1]} — по списку "${wantedTx(1)}", транзакция уже у обращения 22600001`), r.text);
    check('строка проверки: занята 2', /транзакция занята 2 \(не открывались\)/.test(r.text), r.text);
    check('кнопка Excel есть', r.hasDownload);
    const block = r.copyBlocks.find((b) => /Для таблицы отчёта/.test(b.label));
    check('столбик для таблицы: дубликаты 2', block && block.text.split('\n')[6] === '2', block && JSON.stringify(block.text));
    check('память: дубли отложены', r.memory.duplicates.length === 2 && r.memory.duplicates.every((d) => d.fromPrecheck),
      JSON.stringify(r.memory.duplicates));
  },

  async 18() {
    console.log('\n[18] Проверка дублей не ответила — тикеты идут в прогон, дубль ловит окно Edit');
    const { tickets, ids, listText } = makeTickets(3);
    const behaviour = {
      listApi: true, dupCheckStatus: 503,
      duplicateOwner: (id) => (id === ids[0] ? '22600001' : null),
    };
    const page = createPage({
      tickets, onScreen: ['19999999'], behaviour,
      configOverrides: { precheckRetries: 1, precheckRetryDelay: 5 },
    });
    const r = await page.run({ button: LIST_BTN, listText });
    check('окно: проверить не удалось 3', /дубли проверить не удалось: 3/.test(r.precheckText), r.precheckText);
    check('окно: к прогону все 3', /к прогону \(статус Approved \(M\)\): 3/.test(r.precheckText), r.precheckText);
    check('дубль пойман окном сайта, как раньше', page.site.modalOpens.includes(ids[0]) &&
      r.text.includes(`${ids[0]} — вписывали`), r.text);
    check('успешно 2', /^Успешно: 2$/m.test(r.text), line(r.text, /^Успешно.*$/m));
  },

  async 19() {
    console.log('\n[19] Проверка дублей бережёт сайт: не больше 2 запросов, при 529 пауза у всех (0.18)');
    const { tickets, listText } = makeTickets(10);
    const behaviour = { listApi: true, dupCheck529At: new Set([3]) };
    const page = createPage({
      tickets, onScreen: ['19999999'], behaviour,
      configOverrides: { precheckRetryDelay: 120, duplicateCheckDelay: 5 },
    });
    const win = await page.run({ button: LIST_BTN, listText, onlyWindow: true });
    const checks = page.site.dupChecks;
    check('одновременно не больше 2 запросов', page.site.dupMaxInFlight <= 2, page.site.dupMaxInFlight);
    const failed = checks.find((c) => c.status === 529);
    const failedAt = failed ? failed.answeredAt : Infinity;
    const after = checks.filter((c) => c.at > failedAt);
    check('после 529 следующий запрос — не раньше общей паузы',
      after.length > 0 && after.every((c) => c.at - failedAt >= 100),
      JSON.stringify(after.map((c) => c.at - failedAt)));
    check('отбитый запрос повторён: все 10 проверены', checks.length === 11 && !/проверить не удалось/.test(win.precheckText),
      `${checks.length}\n${win.precheckText}`);
  },

  // ---------- с 0.19 / 3.3: проверка запроса сохранения ----------

  async 20() {
    console.log('\n[20] Сохранение подтверждает сервер — 225 по списку и 239 (0.19)');
    const { tickets, listText } = makeTickets(3);
    const page = createPage({ tickets, onScreen: ['19999999'] });
    const r = await page.run({ button: LIST_BTN, listText });
    check('225: все сохранения дошли до сервера', page.site.saves.length === 3 && page.site.applied.length === 3,
      `${page.site.saves.length} / ${page.site.applied.length}`);
    check('225: в сохранении статус id 212', page.site.saves.every((x) => String(x.externalStatusId) === '212'),
      JSON.stringify(page.site.saves));
    check('225: строка «подтвердил сервер 3 из 3»', /Сохранение подтвердил сервер \(этот прогон\): 3 из 3/.test(r.text), r.text);

    const t2 = makeTickets(1);
    const id239 = t2.ids[0];
    t2.tickets[id239].externalStatus = 'The money has not been sent, cancel it (M)';
    t2.tickets[id239].txStatus = 'rejected';
    t2.tickets[id239].txId = '777';
    const page2 = createPage({ tickets: t2.tickets, onScreen: [id239] });
    [...page2.d.querySelectorAll('button')].find((b) => b.textContent === `${LABEL}Bulk Response (239)`).click();
    const end = Date.now() + 20000;
    let report;
    while (!(report = page2.d.querySelector(`.${page2.prefix}-report-overlay`)) && Date.now() < end) {
      await new Promise((res) => setTimeout(res, 20));
    }
    const text239 = report ? report.querySelector(`.${page2.prefix}-report-text`).textContent : '';
    check('239: сохранение со статусом id 219 пропущено и подтверждено',
      page2.site.saves.length === 1 && String(page2.site.saves[0].externalStatusId) === '219' &&
      /Сохранение подтвердил сервер \(этот прогон\): 1 из 1/.test(text239), text239);
  },

  async 21() {
    console.log('\n[21] Страница отправила сохранение ДРУГОГО тикета — запрос не уходит, прогон стоп');
    const { tickets, ids, listText } = makeTickets(4);
    const behaviour = { saveTamper: (id, f) => { if (id === ids[1]) f.requestId = '22600099'; } };
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour });
    const r = await page.run({ button: LIST_BTN, listText });
    check('остановлен защитой сохранения, с номерами обоих тикетов',
      /ПРОГОН ОСТАНОВЛЕН АВТОМАТИЧЕСКИ\.\nЗАЩИТА СОХРАНЕНИЯ: уходило сохранение тикета 22600099, а в работе тикет 22700002/.test(r.text),
      r.text.slice(0, 500));
    check('подменённый запрос до сервера не дошёл', !page.site.saves.some((x) => x.requestId === '22600099'),
      JSON.stringify(page.site.saves));
    check('тикет не изменён', page.site.tickets.get(ids[1]).externalStatus === 'Approved (M)');
    check('дальше прогон не пошёл', !page.site.modalOpens.includes(ids[2]), JSON.stringify(page.site.modalOpens));
    check('окно Edit закрыто', !page.d.querySelector('.modal_wrap'));
    check('в отчёте тикет с причиной', r.text.includes(`${ids[1]} — защита сохранения не пропустила запрос`), r.text);
  },

  async 22() {
    console.log('\n[22] В сохранении не тот Transaction ID или не тот статус — запрос не уходит');
    const a = makeTickets(2);
    const pageA = createPage({
      tickets: a.tickets, onScreen: ['19999999'],
      behaviour: { saveTamper: (id, f) => { if (id === a.ids[0]) f.transactionId = '999'; } },
    });
    const rA = await pageA.run({ button: LIST_BTN, listText: a.listText });
    check('чужой Transaction ID: стоп с обоими номерами',
      /ЗАЩИТА СОХРАНЕНИЯ: тикет 22700001: уходил Transaction ID "999", а по списку должен быть "23850000000"/.test(rA.text),
      rA.text.slice(0, 400));
    check('чужой Transaction ID: до сервера не дошло', pageA.site.saves.length === 0, JSON.stringify(pageA.site.saves));

    const b = makeTickets(2);
    const pageB = createPage({
      tickets: b.tickets, onScreen: ['19999999'],
      behaviour: { saveTamper: (id, f) => { f.externalStatusId = '388'; } }, // «212 Another project (M)»
    });
    const rB = await pageB.run({ button: LIST_BTN, listText: b.listText });
    check('не тот статус: стоп с id', /ЗАЩИТА СОХРАНЕНИЯ: тикет 22700001: уходил статус с id 388, а нужен id 212/.test(rB.text),
      rB.text.slice(0, 400));
    check('не тот статус: до сервера не дошло', pageB.site.saves.length === 0);
  },

  async 23() {
    console.log('\n[23] Сервер не принял сохранение — тикет в ошибках с текстом сайта');
    const { tickets, ids, listText } = makeTickets(3);
    const page = createPage({ tickets, onScreen: ['19999999'], behaviour: { saveRejected: (id) => id === ids[1] } });
    const r = await page.run({ button: LIST_BTN, listText });
    check('ошибок 1, успешно 2', /^Ошибок: 1$/m.test(r.text) && /^Успешно: 2$/m.test(r.text), r.text);
    check('причина и текст сайта в отчёте',
      r.text.includes(`${ids[1]} — сервер ответил, что сохранение не прошло — ПРОВЕРЬ ВРУЧНУЮ («Ошибка сохранения»)`), r.text);
    check('подтверждено 2 из 2 закрытых', /Сохранение подтвердил сервер \(этот прогон\): 2 из 2/.test(r.text), r.text);
  },

  async 24() {
    console.log('\n[24] Вне прогона сохранение не трогается — человек работает руками');
    const { tickets, ids } = makeTickets(1);
    const page = createPage({ tickets, onScreen: [ids[0]] });
    // click() у ссылок стенд подменяет ради скачивания Excel — шлём событие
    page.d.querySelector('tbody tr a').dispatchEvent(new page.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    page.d.querySelector('.modal_wrap .btn-success').click();
    await new Promise((res) => setTimeout(res, 60));
    check('сохранение ушло на сервер', page.site.saves.length === 1, JSON.stringify(page.site.saves));
  },

  async 25() {
    console.log("\n[25] Проверка Agent's files — только читает, делит на пусто/заполнено (0.20)");
    if (!IS_BETA) return console.log('  — только бета');
    const { tickets, ids } = makeTickets(6);
    tickets[ids[1]].agentFiles = ['BTDocuments/1/PaymentReferences/a1.png'];
    tickets[ids[1]].country = 'Egypt';
    tickets[ids[1]].txId = '24085716901';
    tickets[ids[1]].txStatusName = 'Approved';
    tickets[ids[1]].insideComment = '24085716901';
    // Комментарий со служебным символом и переносом строки — файл должен открыться
    tickets[ids[0]].insideComment = 'проверить\u0007 вручную\nвторая строка';
    tickets[ids[3]].country = 'Iraq/Kurdistan';
    tickets[ids[2]].subagent = 'Vodafone XC40';
    tickets[ids[5]].country = 'Egypt';
    tickets[ids[3]].agentFiles = ['BTDocuments/1/x/b1.png', 'BTDocuments/1/x/b2.pdf'];
    tickets[ids[2]].userType = 'VIP-Casino';
    tickets[ids[1]].userType = 'Loss-making player (inexperienced)';
    const behaviour = { listApi: true, hiddenFromFilter: [ids[4]], omitAgentFiles: new Set([ids[5]]), omitUserType: new Set([ids[5]]) };
    const page = createPage({ tickets, onScreen: ['19999999', ids[0], ids[1]], behaviour });
    const { d, w, site, prefix } = page;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn) => { for (let i = 0; i < 500; i++) { const v = fn(); if (v) return v; await sleep(10); } return null; };
    const openReport = async (clickWhat, text) => {
      [...d.querySelectorAll('button')].find((b) => b.textContent === "BETA Проверка Agent's files").click();
      const ov = await waitFor(() => d.querySelector(`.${prefix}-check-overlay`));
      if (text !== undefined) ov.querySelector('textarea').value = text;
      ov.querySelector(`.${prefix}-check-${clickWhat}`).click();
      const rep = await waitFor(() => d.querySelector(`.${prefix}-report-overlay`));
      if (!rep) throw new Error('нет отчёта; окно проверки: ' + (d.querySelector(`.${prefix}-check-overlay`) || { textContent: '(закрыто)' }).textContent);
      // Обе кнопки Excel: «все» и «без файлов»
      const files = {};
      for (const kind of ['all', 'empty']) {
        const btn = rep.querySelector(`.${prefix}-report-download-${kind}`);
        if (!btn) continue;
        btn.click();
        const buf = await new Promise((res) => {
          const fr = new w.FileReader();
          fr.onload = () => res(Buffer.from(fr.result));
          fr.readAsArrayBuffer(site.blobs.at(-1));
        });
        fs.writeFileSync(`${__dirname}/last-agent-files-${kind}.xlsx`, buf);
        files[kind] = { label: btn.textContent, fileName: site.downloads.at(-1), xlsx: readStoredZip(buf) };
      }
      const dl = files.all ? { textContent: files.all.label } : null;
      const xlsx = files.all ? files.all.xlsx : null;
      const out = {
        text: rep.querySelector(`.${prefix}-report-text`).textContent,
        blocks: [...rep.querySelectorAll(`.${prefix}-report-copy`)].map((a) => ({ label: a.previousElementSibling.textContent, text: a.value })),
        downloadLabel: dl ? dl.textContent : null,
        fileName: files.all ? files.all.fileName : null,
        xlsx,
        files,
      };
      w.confirm = () => true;
      [...rep.querySelectorAll('button')].find((b) => b.textContent === 'Закрыть').click();
      return out;
    };

    const r = await openReport('list', ids.join('\n'));
    check('сводка: пусто 2, заполнено 2', /Agent's files пусто: 2/.test(r.text) && /Agent's files заполнено: 2/.test(r.text), r.text);
    check('сводка: сайт не нашёл 1', /сайт не нашёл по фильтру: 1/.test(r.text), r.text);
    check('сводка: нет колонки — не «пусто», а отдельно', /колонки Agent's files нет в ответе сайта: 1/.test(r.text), r.text);
    const emptyBlock = r.blocks.find((b) => /ПУСТО/.test(b.label));
    // пусто: ids[0], ids[2] (в ids[4] сайт не нашёл, у ids[5] нет колонки) — плюс ничего лишнего
    check('блок «пусто» — только тикеты с пустой колонкой', emptyBlock && emptyBlock.text === `${ids[0]}\n${ids[2]}`,
      emptyBlock && emptyBlock.text);
    const filledBlock = r.blocks.find((b) => /заполнено/.test(b.label));
    check('блок «заполнено» — число и имена файлов',
      filledBlock && filledBlock.text === `${ids[1]}\t1\ta1.png\n${ids[3]}\t2\tb1.png, b2.pdf`, filledBlock && filledBlock.text);
    check('ничего не открывалось и не сохранялось', site.modalOpens.length === 0 && site.saves.length === 0);

    // Excel: 5 найденных тикетов, по листу на страну (страны по алфавиту)
    check('кнопка Excel «все»: 5 тикетов, 3 страны', r.downloadLabel === 'Excel: все (5 тикетов, 3 страны)', r.downloadLabel);
    check('имя файла «все»', /^agents-files_vse_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx$/.test(r.fileName || ''), r.fileName);
    const wb = r.xlsx && r.xlsx['xl/workbook.xml'];
    check('листы: Algeria, Egypt, Iraq Kurdistan (без «/»)',
      wb && /<sheet name="Algeria" sheetId="1"/.test(wb) && /<sheet name="Egypt" sheetId="2"/.test(wb) && /<sheet name="Iraq Kurdistan" sheetId="3"/.test(wb), wb);
    const sh = (n) => (r.xlsx && r.xlsx[`xl/worksheets/sheet${n}.xml`]) || '';
    // Строки основной таблицы — по ячейкам колонки A (сводка справа может быть длиннее)
    const rowsOf = (xml) => (xml.match(/<c r="A\d+"/g) || []).length - 1;
    check('строк по листам: 2, 2, 1', rowsOf(sh(1)) === 2 && rowsOf(sh(2)) === 2 && rowsOf(sh(3)) === 1,
      [rowsOf(sh(1)), rowsOf(sh(2)), rowsOf(sh(3))].join(','));
    check('шапка', sh(1).includes('<t>Субагент</t>') && sh(1).includes('<t>Статус транзакции</t>') && sh(1).includes('<t>Кошелёк пользователя</t>'), sh(1).slice(0, 600));
    check('шапка: External Status после Ticket ID, Inside comment перед Transaction ID',
      /<t>Ticket ID<\/t>.*<t>External Status<\/t>.*<t>User ID<\/t>.*<t>VIP<\/t><\/is><\/c><c r="E1" s="1" t="inlineStr"><is><t>Субагент<\/t>.*<t>Inside comment<\/t>.*<t>Transaction ID<\/t>/.test(sh(1)), sh(1).slice(0, 900));
    check('External Status тикета в строке', sh(1).includes('<t>Approved (M)</t>'), sh(1));
    check('Inside comment: номер — числом', sh(2).includes('<v>24085716901</v><') && (sh(2).match(/<v>24085716901<\/v>/g) || []).length === 2, sh(2));
    check('Inside comment: служебный символ выкинут, перенос строки сохранён',
      sh(1).includes('<t xml:space="preserve">проверить вручную\nвторая строка</t>') && !sh(1).includes('\u0007'), sh(1));
    check('транзакция и её статус есть только у тикета с транзакцией',
      sh(2).includes('<v>24085716901</v>') && sh(2).includes('<t>Approved</t>') && !sh(1).includes('<t>OK</t>'), sh(2));
    check('кошелёк с ведущим нулём — текстом, ноль на месте', sh(1).includes('<t>01080969968</t>') && !sh(1).includes('<v>1080969968</v>'), sh(1));
    check('Agent\'s files в файле: «пусто» и «1 файл»', sh(1).includes('<t>пусто</t>') && sh(2).includes('<t>1 файл</t>'), sh(2));

    const cell = (ref, text) => `<c r="${ref}" s="3" t="inlineStr"><is><t>${text}</t></is></c>`;
    check('VIP: по колонке Type — «VIP», у не VIP ячейка пустая, колонки Type нет',
      sh(1).includes(cell('D3', 'VIP') + cell('E3', 'Vodafone XC40')) &&
      sh(1).includes('<c r="D2" s="3"/>' + cell('E2', 'Miruca BaridiMob Algeria')) &&
      sh(2).includes('<c r="D2" s="3"/>' + cell('E2', 'Miruca BaridiMob Algeria')) &&
      !sh(1).includes('<t>Type</t>') && !sh(1).includes('New player') && !sh(2).includes('Loss-making') &&
      !sh(1).includes('не VIP') && !sh(2).includes('не VIP'), sh(1) + '\n' + sh(2));
    check('VIP: поля Type нет в ответе — «нет данных», а не пусто',
      sh(2).includes(cell('D3', 'нет данных') + cell('E3', 'Miruca BaridiMob Algeria')), sh(2));

    // Сводка по субагентам справа, через один пустой столбец (N)
    const s1 = sh(1); // Algeria: ids[0] — Miruca, ids[2] — Vodafone
    check('сводка: шапка в N1:P1 жирная, столбец M пустой',
      /<c r="N1" s="1" t="inlineStr"><is><t>Субагент<\/t><\/is><\/c><c r="O1" s="1" t="inlineStr"><is><t>Тикетов<\/t><\/is><\/c><c r="P1" s="1" t="inlineStr"><is><t>из них VIP<\/t>/.test(s1) &&
      !/<c r="M\d+"/.test(s1), s1.slice(0, 1500));
    check('сводка: субагенты с формулами точного совпадения по колонке E',
      s1.includes('<c r="N2" s="3" t="inlineStr"><is><t>Miruca BaridiMob Algeria</t></is></c><c r="O2" s="2"><f>SUMPRODUCT(--($E$2:$E$3=N2))</f><v>1</v></c>') &&
      s1.includes('<c r="P2" s="2"><f>SUMPRODUCT(($E$2:$E$3=N2)*($D$2:$D$3=&quot;VIP&quot;))</f><v>0</v></c>') &&
      s1.includes('<c r="P3" s="2"><f>SUMPRODUCT(($E$2:$E$3=N3)*($D$2:$D$3=&quot;VIP&quot;))</f><v>1</v></c>') &&
      s1.includes('<t>Vodafone XC40</t></is></c><c r="O3" s="2"><f>SUMPRODUCT(--($E$2:$E$3=N3))</f><v>1</v></c>'), s1);
    check('сводка: «Итого» жирным и суммой, VIP по гео — 1', /<c r="N4" s="1" t="inlineStr"><is><t>Итого<\/t><\/is><\/c><c r="O4" s="2"><f>SUM\(O2:O3\)<\/f><v>2<\/v><\/c><c r="P4" s="2"><f>SUM\(P2:P3\)<\/f><v>1<\/v>/.test(s1), s1);
    check('автофильтр — только на основной таблице', s1.includes('<autoFilter ref="A1:L3"/>'), s1.slice(-300));
    check('сводка Egypt: один субагент, 2 тикета, сортировка по убыванию',
      sh(2).includes('<f>SUMPRODUCT(--($E$2:$E$3=N2))</f><v>2</v>') && /<t>Итого<\/t>.*<v>2<\/v>/.test(sh(2)), sh(2));

    // Второй файл — только «пусто» (ids[0], ids[2] — оба Algeria); без колонки (ids[5]) сюда не идёт
    const e = r.files.empty;
    check('кнопка «без файлов»: 2 тикета, 1 страна', e && e.label === 'Excel: без файлов (2 тикета, 1 страна)', e && e.label);
    check('имя файла «без файлов»', e && /^agents-files_bez-faylov_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx$/.test(e.fileName), e && e.fileName);
    const eb = e && e.xlsx;
    const ewb = (eb && eb['xl/workbook.xml']) || '';
    const esh = (eb && eb['xl/worksheets/sheet1.xml']) || '';
    check('без файлов: один лист Algeria, 2 строки, та же шапка',
      /<sheet name="Algeria" sheetId="1"/.test(ewb) && !/sheetId="2"/.test(ewb) && rowsOf(esh) === 2 &&
      esh.includes('<t>External Status</t>') && esh.includes('<t>Inside comment</t>'), ewb + '\n' + esh.slice(0, 500));
    check('без файлов: только «пусто», без чужих тикетов',
      (esh.match(/<t>пусто<\/t>/g) || []).length === 2 && !esh.includes('файл</t>') && !esh.includes('нет данных') &&
      esh.includes(`<v>${ids[0]}</v>`) && esh.includes(`<v>${ids[2]}</v>`), esh);
    check('без файлов: та же сводка по субагентам', esh.includes('<t>Субагент</t>') && /<t>Итого<\/t>.*<v>2<\/v>/.test(esh), esh);

    // Первая проверка сама нажала Apply у фильтров (подхватить запрос) — стенд при
    // пустом поле Ticket ID очищает таблицу; оператор вывел тикеты на экран снова
    site.onScreen = ['19999999', ids[0], ids[1]];
    page.renderTable();
    const r2 = await openReport('screen');
    check('по экрану: проверены 3 тикета экрана', /Проверено: 3 \(тикеты на экране\)/.test(r2.text) && /Agent's files заполнено: 1/.test(r2.text), r2.text);
  },
};

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((x) => x.trim())) : null;

(async () => {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.has(name)) continue;
    try {
      await fn();
    } catch (e) {
      failed++;
      console.log(`  ❌ сценарий упал: ${e.stack || e}`);
    }
  }
  console.log(`\n${'='.repeat(50)}\nПройдено: ${passed}, провалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
