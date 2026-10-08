// Стенд для Bulk Approve: поднимает в jsdom упрощённую страницу TH Management
// (таблица тикетов, фильтр Ticket ID, окно Edit, окна SweetAlert2) и грузит в
// неё НАСТОЯЩИЙ файл скрипта. Подменяются только тайминги в CONFIG, чтобы
// прогон шёл за секунды. Логика скрипта не трогается.
//
// Страница живёт между прогонами (одно и то же окно и localStorage), поэтому
// можно запускать прогон, закрывать отчёт и запускать снова — как оператор.
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { TextEncoder } = require('util');

const SCRIPTS = {
  beta: path.join(__dirname, '../../scripts/th-bulk-approve-beta.user.js'),
  main: path.join(__dirname, '../../scripts/th-bulk-approve.user.js'),
};

// Тайминги, под которые написан стенд. Значения выбраны так, чтобы сохранить
// порядок событий настоящего сайта (две волны запросов после ввода номера,
// перестройка таблицы после Apply), но сжать паузы в десятки раз.
const FAST_CONFIG = {
  stepDelay: 5,
  waitTimeout: 600,
  betweenTicketsDelay: 5,
  tableReloadTimeout: 600,
  blockingPopupTimeout: 300,
  transactionLoadSecondWaveTimeout: 300,
  transactionLoadSettleAfterInput: 80,
  transactionLoadQuietPeriod: 30,
  transactionLoadFirstRequestTimeout: 200,
  transactionLoadTimeout: 800,
  transactionLoadPollInterval: 10,
  autopilotTableTimeout: 1000,
  autopilotTableSettleMin: 40,
  autopilotTableQuietPeriod: 30,
  autopilotEmptyConfirm: 120,
  autopilotBetweenChunksDelay: 5,
};

function loadScript(which, overrides) {
  // BULK_SCRIPT=путь — прогнать сценарии на другом файле (например, на
  // предыдущей версии, чтобы убедиться, что тест ловит старое поведение)
  let src = fs.readFileSync(process.env.BULK_SCRIPT || SCRIPTS[which], 'utf8');
  const config = { ...FAST_CONFIG, ...(overrides || {}) };
  for (const [key, value] of Object.entries(config)) {
    const re = new RegExp(`(\\n\\s+${key}:\\s*)[^,\\n]+,`);
    if (!re.test(src)) throw new Error(`В CONFIG нет ключа ${key}`);
    src = src.replace(re, `$1${value},`);
  }
  // Пара функций наружу — для точечных проверок окна отчёта и Excel
  const tail = src.lastIndexOf('})();');
  src = src.slice(0, tail) +
    'window.__t = { showReportWindow, buildDuplicatesXlsx };\n' + src.slice(tail);
  return src;
}

const COLUMNS = [
  'Ticket history', 'Actions', 'External Status', 'Ticket ID', 'Amount',
  'Transaction ID', 'Transaction Amount', 'Transaction Status', 'Processing Date',
];

const STATUS_OPTIONS = ['225 Approved by agent', '239 Response to user (M)', '238 Revision needed (M)'];

const pad = (n) => String(n).padStart(2, '0');
function processingDate(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// site — модель сайта:
//   tickets: Map ticketId → { externalStatus, txId, txStatus, hoursAgo }
//   onScreen: массив Ticket ID, видимых в таблице
//   behaviour: поведение, которое сценарий может менять между прогонами
function createPage({ which = 'beta', tickets, onScreen, behaviour = {}, configOverrides } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <form id="filter_form">
      <button type="button" class="btn-settings-columns">Quick filters</button>
      <div class="quick"><textarea placeholder="Ticket ID"></textarea></div>
      <div class="btn-block"><button type="submit">Apply</button></div>
    </form>
    <div class="table-wrapper"><table><thead><tr></tr></thead><tbody></tbody></table></div>
  </body></html>`, {
    url: 'https://th-managment.com/en/admin/backoffice/paymentsupport',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const d = w.document;
  w.TextEncoder = TextEncoder;
  // Консоль скрипта молчит, кроме DEBUG=1 — тогда видно всё, что он пишет
  const debug = !!process.env.DEBUG;
  w.console = {
    log: (...a) => debug && console.log(...a),
    warn: (...a) => debug && console.warn(...a),
    error: (...a) => debug && console.error(...a),
    table() {}, info() {},
  };

  const site = {
    tickets: new Map(Object.entries(tickets).map(([id, t]) => [id, { ...t }])),
    onScreen: [...onScreen],
    behaviour,
    applied: [],          // успешные Apply в окне Edit
    modalOpens: [],       // какие тикеты открывались
    filterApplies: [],    // какие пачки подставлялись в фильтр
    alerts: [],
    confirms: [],
    downloads: [],
    blobs: [],
    storageTrace: [],     // снимки памяти списка после каждого Apply в окне Edit
  };

  w.alert = (t) => site.alerts.push(String(t));
  w.confirm = (t) => { site.confirms.push(String(t)); return true; };
  w.URL.createObjectURL = (b) => { site.blobs.push(b); return 'blob:test/' + site.blobs.length; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { site.downloads.push(this.download); };

  // Фальшивый XHR: завершается сам через duration мс и шлёт loadend.
  class FakeXHR extends w.EventTarget {
    open(method, url) { this.url = url; }
    send() {
      const duration = this.__duration || 5;
      setTimeout(() => {
        this.readyState = 4;
        this.dispatchEvent(new w.Event('load'));
        this.dispatchEvent(new w.Event('loadend'));
      }, duration);
    }
    setRequestHeader() {}
  }
  w.XMLHttpRequest = FakeXHR;
  const fire = (url, duration) => {
    const x = new w.XMLHttpRequest();
    x.open('POST', url);
    x.__duration = duration;
    x.send();
  };

  // ---------- таблица ----------
  const headRow = d.querySelector('thead tr');
  COLUMNS.forEach((c) => { const th = d.createElement('th'); th.textContent = c; headRow.appendChild(th); });

  function renderTable() {
    const tbody = d.querySelector('tbody');
    tbody.innerHTML = '';
    site.onScreen.forEach((id) => {
      const t = site.tickets.get(id);
      if (!t) return;
      const tr = d.createElement('tr');
      tr.setAttribute('data-table-row', '');
      const cells = {
        'Ticket history': '',
        Actions: '<a href="#">Edit</a>',
        'External Status': t.externalStatus,
        'Ticket ID': id,
        Amount: '100',
        'Transaction ID': t.txId || '',
        'Transaction Amount': '100',
        'Transaction Status': t.txStatus || '',
        'Processing Date': processingDate(t.hoursAgo == null ? 2 : t.hoursAgo),
      };
      COLUMNS.forEach((c) => {
        const td = d.createElement('td');
        td.innerHTML = cells[c];
        tr.appendChild(td);
      });
      tr.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); openEdit(id); });
      tbody.appendChild(tr);
    });
  }

  // ---------- фильтр Ticket ID ----------
  d.querySelector('#filter_form').addEventListener('submit', (e) => e.preventDefault());
  d.querySelector('#filter_form button[type="submit"]').addEventListener('click', (e) => {
    e.preventDefault();
    const ids = d.querySelector('textarea[placeholder="Ticket ID"]').value
      .split(/\s+/).filter(Boolean);
    site.filterApplies.push(ids);
    fire('', 30); // выдача таблицы — у настоящего сайта запрос без адреса
    setTimeout(() => {
      site.onScreen = ids.filter((id) => site.tickets.has(id) && !(site.behaviour.hiddenFromFilter || []).includes(id));
      renderTable();
    }, 20);
  });

  // ---------- окно Edit ----------
  function openEdit(id) {
    site.modalOpens.push(id);
    if (site.behaviour.editBroken && site.behaviour.editBroken(id)) return; // сайт «залагал»
    const t = site.tickets.get(id);
    const wrap = d.createElement('div');
    wrap.className = 'modal_wrap';
    wrap.setAttribute('role', 'dialog');
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="modal_content">
        <div class="title">Change ticket no.${id}</div>
        <div class="form-add">
          <div class="input-group"><span class="title">Transaction ID</span>
            <input type="text" class="tx-id" value="${t.txId || ''}"></div>
          <div class="input-group"><span class="title">Status</span>
            <div class="multiselect">
              <div class="multiselect__tags"><input class="multiselect__input" type="text"></div>
              <div class="multiselect__content-wrapper" style="display:none"></div>
            </div></div>
        </div>
        <div class="filter btn-block">
          <div class="input-group"><button class="btn btn-success">Apply</button></div>
          <div class="input-group"><button class="btn btn-default">Cancel</button></div>
        </div>
      </div>`;
    d.body.appendChild(wrap);

    let chosen = null;
    const txInput = wrap.querySelector('.tx-id');
    let waves = false;
    txInput.addEventListener('input', () => {
      if (waves) return;
      waves = true;
      setTimeout(() => {
        fire('/admin/paymentconsultant/checkPaymentSupportRequestByTrxId', 5);
        const owner = site.behaviour.duplicateOwner && site.behaviour.duplicateOwner(id, txInput.value);
        if (owner) setTimeout(() => showDuplicatePopup(owner), 5);
      }, 10);
      setTimeout(() => {
        fire('/admin/paymentconsultant/getTransactionInfo', 5);
        fire('/admin/finance/GetSubAgentInfo', 10);
      }, 40);
    });

    const msInput = wrap.querySelector('.multiselect__input');
    const content = wrap.querySelector('.multiselect__content-wrapper');
    const renderOptions = () => {
      const q = msInput.value.trim().toLowerCase();
      content.innerHTML = '';
      STATUS_OPTIONS.filter((o) => !q || o.toLowerCase().includes(q)).forEach((o) => {
        const opt = d.createElement('span');
        opt.className = 'multiselect__option';
        opt.textContent = o;
        opt.addEventListener('click', () => { chosen = o; });
        content.appendChild(opt);
      });
      content.style.display = 'block';
    };
    msInput.addEventListener('focus', renderOptions);
    msInput.addEventListener('input', renderOptions);

    wrap.querySelector('.btn-success').addEventListener('click', () => {
      const tx = txInput.value.trim();
      site.applied.push({ ticketId: id, status: chosen, transactionId: tx });
      t.externalStatus = chosen || t.externalStatus;
      if (!(site.behaviour.dropsTransactionId && site.behaviour.dropsTransactionId(id))) t.txId = tx;
      setTimeout(() => {
        wrap.remove();
        renderTable();
        if (site.behaviour.onApplied) site.behaviour.onApplied(site, w);
        // Окно сайта после сохранения (например, предупреждение о дубле в
        // обычном 225). Само закрывается чуть позже — как его закрыл бы человек.
        const popupText = site.behaviour.popupOnApply && site.behaviour.popupOnApply(id);
        if (popupText) {
          const p = d.createElement('div');
          p.className = 'swal2-popup swal2-icon-warning';
          p.innerHTML = `<h2 class="swal2-title"></h2><div class="swal2-html-container">${popupText}</div>` +
            '<button class="swal2-confirm">OK</button><button class="swal2-cancel">Cancel</button>';
          d.body.appendChild(p);
          setTimeout(() => p.remove(), 40);
        }
      }, 10);
    });
    wrap.querySelector('.btn-default').addEventListener('click', () => wrap.remove());
  }

  function showDuplicatePopup(owner) {
    const p = d.createElement('div');
    p.className = 'swal2-popup swal2-icon-warning';
    p.innerHTML = `<h2 class="swal2-title"></h2>
      <div class="swal2-html-container">Обращение с этим номером транзакции уже создано: ${owner}</div>
      <button class="swal2-confirm">Copy</button><button class="swal2-cancel">Cancel</button>`;
    p.querySelector('.swal2-cancel').addEventListener('click', () => p.remove());
    p.querySelector('.swal2-confirm').addEventListener('click', () => p.remove());
    d.body.appendChild(p);
  }

  renderTable();
  w.eval(loadScript(which, configOverrides));

  const prefix = which === 'beta' ? 'bulk-approve-beta' : 'bulk-approve';
  const storageKey = (mode) =>
    `th-bulk-approve:${mode === 'pairs' ? 'tx-list' : 'ticket-list'}:v1${which === 'beta' ? '-beta' : ''}`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, timeout = 20000) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error('таймаут ожидания в стенде');
      await sleep(10);
    }
  }

  // Один прогон, как его делает оператор: кнопка → окно списка → запуск →
  // отчёт. Возвращает текст отчёта, блоки для копирования и память после.
  async function run({ button, listText, autopilot = true, byScreen = false, closeReport = true }) {
    const btn = [...d.querySelectorAll('button')].find((b) => b.textContent === button);
    if (!btn) throw new Error('нет кнопки ' + button);
    btn.click();
    const overlay = await until(() => d.querySelector(`.${prefix}-list-overlay`));
    const area = overlay.querySelector('textarea');
    if (listText !== undefined) {
      area.value = listText;
      area.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    const auto = overlay.querySelector(`.${prefix}-autopilot`);
    if (auto && auto.checked !== autopilot) {
      auto.checked = autopilot;
      auto.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    const windowText = overlay.textContent;
    const start = [...overlay.querySelectorAll('button')].find((b) =>
      byScreen ? /Запустить по экрану/.test(b.textContent) : b.textContent === 'Запустить по списку');
    if (start.disabled) throw new Error('кнопка запуска заблокирована: ' + windowText);
    start.click();
    const report = await until(() => d.querySelector(`.${prefix}-report-overlay`), 60000);
    const text = report.querySelector(`.${prefix}-report-text`).textContent;
    // Подпись блока — div прямо перед полем
    const copyBlocks = [...report.querySelectorAll(`.${prefix}-report-copy`)].map((a) => ({
      label: a.previousElementSibling ? a.previousElementSibling.textContent : '',
      text: a.value,
    }));
    const download = report.querySelector(`.${prefix}-report-download`);
    if (closeReport) {
      [...report.querySelectorAll('button')].find((b) => b.textContent === 'Закрыть').click();
    }
    return { text, copyBlocks, windowText, hasDownload: !!download, memory: readMemory('pairs') };
  }

  function readMemory(mode) {
    const raw = w.localStorage.getItem(storageKey(mode));
    return raw ? JSON.parse(raw) : null;
  }

  return { w, d, site, run, readMemory, storageKey, renderTable, prefix };
}

module.exports = { createPage };
