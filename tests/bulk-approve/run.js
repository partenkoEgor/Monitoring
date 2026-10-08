// Сценарии для режима «по списку (225)». Запуск: npm test (или node run.js).
// ONLY=1,3 node run.js — только названные сценарии. DEBUG=1 — консоль скрипта.
'use strict';

const fs = require('fs');
const { createPage } = require('./harness');

const LIST_BTN = 'BETA Bulk Approve по списку (225)';
const SCREEN_BTN = 'BETA Bulk Approve (225)';

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
          midRun = w.localStorage.getItem('th-bulk-approve:tx-list:v1-beta');
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
    page2.w.localStorage.setItem('th-bulk-approve:tx-list:v1-beta', midRun);
    const r = await page2.run({ button: LIST_BTN, listText });
    check('после перезагрузки закрытые до сбоя не запрашивались',
      page2.site.filterApplies.flat().every((id) => !mem.done.includes(id)), JSON.stringify(page2.site.filterApplies));
    check('итог — по всему списку: успешно 6', /^Успешно: 6$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('прогонов: 2 (упавший тоже считается)', /прогонов: 2\)/.test(r.text), r.text);
  },

  async 4() {
    console.log('\n[4] Память старого формата (до 0.13) — закрытые из неё входят в итог');
    const { tickets, ids, listText } = makeTickets(5);
    tickets[ids[0]].externalStatus = '225 Approved by agent';
    tickets[ids[1]].externalStatus = '225 Approved by agent';
    const page = createPage({ tickets, onScreen: ['19999999'] });
    page.w.localStorage.setItem('th-bulk-approve:tx-list:v1-beta', JSON.stringify({
      savedAt: Date.now(), text: listText, done: [ids[0], ids[1]], needsAttention: [], duplicates: [], dropped: [],
    }));
    const r = await page.run({ button: LIST_BTN, listText });
    check('успешно 5 (2 из старой памяти + 3 сейчас)', /^Успешно: 5$/m.test(r.text), line(r.text, /^Успешно.*$/m));
    check('в этом прогоне +3', /В этом прогоне: закрыто \+3/.test(r.text), r.text);
    check('у восстановленных — своя строка про возраст, а не «нечитаемая дата»',
      /закрыты до версии 0\.13 — возраст не сохранился: 2/.test(r.text) && !/нечитаемой Processing Date/.test(r.text), r.text);
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
    check('6 чисел без пустой строки', block && block.text === '4\n3\n1\n0\n1\n1', block && JSON.stringify(block.text));
  },

  async 11() {
    console.log('\n[11] У Bulk Response (239) столбика нет');
    const { tickets, ids } = makeTickets(1);
    tickets[ids[0]].externalStatus = 'The money has not been sent, cancel it (M)';
    tickets[ids[0]].txStatus = 'rejected';
    tickets[ids[0]].txId = '777';
    const page = createPage({ tickets, onScreen: [...ids] });
    const btn = [...page.d.querySelectorAll('button')].find((b) => b.textContent === 'BETA Bulk Response (239)');
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
