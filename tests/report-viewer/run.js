// Сценарии для tools/report-viewer.html. Запуск: npm test (или node run.js).
// Собирает маленькую выгрузку в том же формате, что приходит из системы
// (inlineStr без адресов ячеек, пустые <c/>, сущности, дата через стиль),
// открывает страницу в Chromium через Playwright и проверяет фильтры, поиск и выгрузку.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.resolve(__dirname, '../../tools/report-viewer.html');

let passed = 0;
let failed = 0;
function check(name, cond, dump) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); if (dump !== undefined) console.log('     ' + String(dump)); }
}

// ───── фикстура .xlsx ─────
const HEADER = ['Ticket ID', 'Date created', 'Ticket type', 'Agent', 'Country', 'Status', 'User wallet', "Agent's wallet",
  'Check amount', 'Provider ID', 'Topic', 'Additional parameters', 'Estimated closing date Q80'];
// число → числовая ячейка, { date } → дата через стиль, '' → пустая ячейка <c/>
const ROWS = [
  [1001, '2026-11-18 10:00:00', 'SMP M', 'SendMePay', 'Egypt', 'New', '01121797231', 'TR96 0006 2001 2050 0006 6043 91 ', 500, '', "I didn't receive my withdrawal", '{"wallet_owner": "Ali Hassan"}', { date: 46347.5 }],
  [1002, '2026-11-17 09:00:00', 'SMP M', '', 'Egypt', 'In progress', '01000000001', '32275242', 700, '', 'Unsuccessful deposit', '', ''],
  [1003, '2026-11-16 08:00:00', 'SMP M', 'BankTransfer Agents', 'Morocco', 'New', '0612345678', '32275242', 300, '', 'Unsuccessful deposit', '{"bank_name": "Kbank", "wallet_owner": "KYI SOE"}', { date: 46000.25 }],
  [1004, '2026-11-15 07:00:00', 'BT M', 'SendMePay', 'Turkey', 'New', 'TR040001500158007311198233', '', 900, '2097734376057331712', 'Deposit error', '', ''],
  [1005, '2026-11-14 06:00:00', 'BT M', 'BankTransfer Agents', 'Egypt', 'New', '01229219903', '43242043', 12000, '', 'Unsuccessful deposit', '', ''],
  [1006, '2026-11-13 05:00:00', 'API', 'Repay', 'Morocco', 'Information request', '01229219904', '', 50.5, '', 'R&D <test>', '', ''],
];
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function cell(v, s) {
  if (v === '' || v == null) return `<c s="${s}"/>`;
  if (typeof v === 'number') return `<c s="${s}"><v>${v}</v></c>`;
  if (typeof v === 'object') return `<c s="1"><v>${v.date}</v></c>`;
  return `<c t="inlineStr" s="${s}"><is><t>${xe(v)}</t></is></c>`;
}
function sheetXml() {
  let x = '<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  x += '<row r="1">' + HEADER.map((h) => cell(h, 2)).join('') + '</row>';
  ROWS.forEach((r, i) => { x += `<row r="${i + 2}">` + r.map((v) => cell(v, 0)).join('') + '</row>'; });
  return x + '</sheetData></worksheet>';
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = []; const central = []; let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'); const comp = zlib.deflateRawSync(data); const nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, comp); central.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central); const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(files.length, 8); eo.writeUInt16LE(files.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eo]);
}
function fixture() {
  return zip([
    ['xl/worksheets/sheet1.xml', sheetXml()],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="R1"/></Relationships>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1" /></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1" /></sheets></workbook>'],
    ['xl/styles.xml', '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="0"/></cellXfs></styleSheet>'],
  ]);
}

// ───── сценарии ─────
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-viewer-'));
  const file = path.join(dir, 'report.xlsx');
  fs.writeFileSync(file, fixture());

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const open = async (f = file) => {
    await page.setInputFiles('#fileInput', f);
    await page.waitForSelector('#drop', { state: 'hidden' });
    await page.waitForSelector('#busy', { state: 'hidden' });
  };
  const count = async () => +(await page.textContent('#count')).split(' из ')[0].replace(/\s/g, '');
  const ids = () => page.evaluate(() => Array.from(rows, (r) => D.vals[colIdx('Ticket ID')][r]));
  const facetBox = (name, value) => `.facet:has(.fn:text-is("${name}")) .fi:has(.fv:text-is("${value}")) input`;

  try {
    await page.goto(PAGE);
    await open();

    console.log('\nЧтение файла');
    check('все строки на месте', (await count()) === ROWS.length, await count());
    const cells = await page.evaluate(() => ({
      tid: D.vals[colIdx('Ticket ID')][0], kindTid: D.cols[colIdx('Ticket ID')].kind,
      wallet: D.vals[colIdx('User wallet')][0], prov: D.vals[colIdx('Provider ID')][3],
      topic: D.vals[colIdx('Topic')][0], rd: D.vals[colIdx('Topic')][5], agentEmpty: D.vals[colIdx('Agent')][1],
      q80: D.vals[colIdx('Estimated closing date Q80')][0], q80b: D.vals[colIdx('Estimated closing date Q80')][2],
      owner: D.vals[colIdx('Wallet owner')][2], bank: D.vals[colIdx('Bank name')][2],
      amountKind: D.cols[colIdx('Check amount')].kind, dateKind: D.cols[colIdx('Date created')].kind,
    }));
    check('Ticket ID прочитан как текст-ID', cells.tid === '1001' && cells.kindTid === 'id', JSON.stringify(cells));
    check('ведущий ноль в кошельке сохранён', cells.wallet === '01121797231', cells.wallet);
    check('19-значный Provider ID не округлён', cells.prov === '2097734376057331712', cells.prov);
    check('сущности раскрыты (&apos; &amp; &lt;)', cells.topic === "I didn't receive my withdrawal" && cells.rd === 'R&D <test>', cells.topic + ' | ' + cells.rd);
    check('пустая ячейка <c/> не сдвигает колонки', cells.agentEmpty === '' && (await page.evaluate(() => D.vals[colIdx('Country')][1])) === 'Egypt');
    check('дата из стиля превращена в текст', cells.q80 === '2026-11-21 12:00:00' && cells.q80b === '2025-12-09 06:00:00', cells.q80 + ' | ' + cells.q80b);
    check('Wallet owner и Bank name вынесены из JSON', cells.owner === 'KYI SOE' && cells.bank === 'Kbank', cells.owner + ' | ' + cells.bank);
    check('типы колонок: сумма — число, дата — дата', cells.amountKind === 'num' && cells.dateKind === 'date');

    console.log('\nВстроенный набор «SMP — агент не SendMePay»');
    await page.click('#presets .pr:first-child .pa');
    check('2 тикета: с пустым агентом и с другим агентом', JSON.stringify(await ids()) === '["1002","1003"]', JSON.stringify(await ids()));
    check('набор подсвечен как активный', await page.isVisible('#presets .pr.active'));
    await page.click(facetBox('Agent', '(пусто)'));
    check('отметка «(пусто)» в режиме ≠ убирает пустых агентов', JSON.stringify(await ids()) === '["1003"]', JSON.stringify(await ids()));
    check('набор больше не подсвечен', !(await page.isVisible('#presets .pr.active')));

    console.log('\nСтраны + статус, сохранение набора');
    await page.evaluate(() => resetAll());
    await page.click(facetBox('Country', 'Egypt'));
    await page.click(facetBox('Country', 'Morocco'));
    await page.click(facetBox('Status', 'New'));
    check('Egypt или Morocco и статус New — 3 тикета', JSON.stringify(await ids()) === '["1001","1003","1005"]', JSON.stringify(await ids()));
    const cnt = await page.textContent(`.facet:has(.fn:text-is("Status")) .fi:has(.fv:text-is("In progress")) .fc`);
    check('счётчик соседнего значения учитывает другие фильтры', cnt.trim() === '1', cnt);
    await page.click('#presetSaveBtn');
    await page.fill('#presetName', 'Египет и Марокко — New');
    await page.click('#presetSaveOk');
    check('набор сохранён', (await page.textContent('#presets')).includes('Египет и Марокко — New'));

    console.log('\nПоиск');
    await page.evaluate(() => resetAll());
    await page.fill('#q', 'TR96 0006 2001');
    await page.waitForTimeout(400);
    check('IBAN с пробелами находится по кускам', JSON.stringify(await ids()) === '["1001"]', JSON.stringify(await ids()));
    await page.fill('#q', 'kyi soe');
    await page.waitForTimeout(400);
    check('поиск по имени владельца кошелька', JSON.stringify(await ids()) === '["1003"]', JSON.stringify(await ids()));
    await page.fill('#q', '');
    await page.waitForTimeout(400);

    console.log('\nПоиск по списку');
    await page.click('#listBtn');
    await page.fill('#listText', '01121797231\n9999\n1004\n32275242');
    await page.click('.modal .btn.primary');
    check('нашлись тикеты по кошельку, ID и кошельку агента', JSON.stringify(await ids()) === '["1001","1002","1003","1004"]', JSON.stringify(await ids()));
    check('ненайденное значение показано', (await page.evaluate(() => JSON.stringify(F.list.notFound))) === '["9999"]');
    await page.evaluate(() => resetAll());

    console.log('\nДиапазон и сортировка');
    await page.selectOption('#rangeAdd', 'Check amount');
    await page.fill('.rg input[data-b="min"]', '600');
    await page.fill('.rg input[data-b="max"]', '1000');
    await page.waitForTimeout(500);
    check('Check amount от 600 до 1000', JSON.stringify(await ids()) === '["1002","1004"]', JSON.stringify(await ids()));
    await page.evaluate(() => resetAll());
    await page.click('.th:has-text("Check amount")');
    await page.click('.th:has-text("Check amount")');
    check('сортировка по сумме по убыванию — числовая', (await ids())[0] === '1005' && (await ids())[5] === '1006', JSON.stringify(await ids()));

    console.log('\nКарточка');
    await page.click('#gbody .tr >> nth=0');
    check('карточка открылась', (await page.textContent('#cardTitle')) === 'Тикет 1005');
    await page.click('#cardBody .kv:has(.k:text-is("Agent\'s wallet")) .fx');
    check('⌕ у кошелька агента — все тикеты с ним', JSON.stringify(await ids()) === '["1005"]', JSON.stringify(await ids()));
    await page.evaluate(() => { sortSpec = []; resetAll(); });

    console.log('\nВыгрузка в .xlsx');
    await page.click('#exportBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-exp="all"]')]);
    const out = path.join(dir, 'out.xlsx');
    await dl.saveAs(out);
    check('имя файла латиницей', dl.suggestedFilename() === 'report_filtered_6.xlsx', dl.suggestedFilename());
    const before = await page.evaluate(() => JSON.stringify({ n: D.cols.map((c) => c.name), v: D.vals }));
    await open(out);
    const after = await page.evaluate(() => JSON.stringify({ n: D.cols.map((c) => c.name), v: D.vals }));
    check('выгруженный файл читается обратно без потерь', before === after);

    console.log('\nПамять между сессиями');
    await page.click(facetBox('Agent', 'SendMePay'));
    await page.click('.facet:has(.fn:text-is("Agent")) .seg button[data-mode="out"]');
    await page.reload();
    await open();
    check('фильтр «Agent ≠ SendMePay» восстановлен после перезапуска', (await page.textContent('#chips')).includes('Agent ≠ SendMePay') && (await count()) === 4, await page.textContent('#chips'));
    check('сохранённый набор на месте', (await page.textContent('#presets')).includes('Египет и Марокко — New'));

    check('ошибок на странице нет', errors.length === 0, errors.join('\n'));
  } catch (e) {
    failed++;
    console.log(`  ❌ сценарий упал: ${e.stack || e}`);
  }
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${'='.repeat(50)}\nПройдено: ${passed}, провалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
