// ==UserScript==
// @name         TH Management — Dark Theme Recolor
// @namespace    th-management-dark-theme
// @version      1.0
// @description  Перекрашивает встроенную тёмную тему сайта в более тёмную и контрастную версию — таблицы, кнопки, тултипы, пагинация, скроллбар
// @match        https://th-managment.com/*
// @match        https://my-managment.com/*
// @match        https://managment.io/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-dark-theme.user.js
// @downloadURL  https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-dark-theme.user.js
// ==/UserScript==

// Работает на всём сайте (не только на страницах тикетов), поэтому оформлен
// отдельным скриптом, а не функцией Team Helper — у Team Helper @match
// ограничен двумя страницами (paymentsupport, ExtendedPaymentRequestList),
// расширять его на весь сайт ради одной функции не стали.

(function () {
  'use strict';

  if (window._THEME !== 'dark') return;

  const style = document.createElement('style');
  style.id = 'th-dark-theme-recolor';
  style.textContent = `
    :root {
      /* Базовые поверхности. Ни фон, ни текст не берутся из крайних #000/#fff —
         чистый белый на чистом чёрном даёт ореол (halation) и утомляет глаза ночью. */
      --dark-theme-color-1: #12161c !important;
      --dark-theme-color-2: #232830 !important;
      --dark-theme-color-3: #1a1f27 !important;
      --dark-theme-color-5: #1a1f27 !important;

      /* Двойное назначение (фон/иконка + текст-алиас) — компромиссный тон,
         подобранный так, чтобы одновременно оставаться читаемым текстом
         и не превращаться в светящуюся рамку на тёмной поверхности. */
      --dark-theme-color-4: #7b8591 !important;
      --dark-theme-color-6: #5b6470 !important;

      /* Текст */
      --dark-theme-text-color-1: #e6edf3 !important;
      --dark-theme-text-color-2: #c9d1d9 !important;
      --dark-theme-text-color-4: #8b949e !important;

      /* Тултипы/дропдауны (popper) */
      --popper-theme-background-color: #232830 !important;
      --popper-theme-background-color-hover: #2c333c !important;
      --popper-theme-border-color: #363d47 !important;
    }

    /* Тёмно-зелёный статусный текст (#028217) не читается на тёмном фоне —
       заменяем на цвет, сохраняющий контраст ночью. */
    :root, .table-vertical, .table-horizontal {
      --color-success-text: #3fb950 !important;
    }

    /* Бирюзовые кнопки и зелёные теги фильтров захардкожены в CSS сайта
       (.btn-success, дефолтный зелёный vue-multiselect) — приглушаем тот же
       оттенок, не меняя цвет, чтобы он не «кричал» на тёмном фоне. */
    .btn-success {
      background-color: #327680 !important;
    }
    .btn-success:hover {
      background-color: #2a636c !important;
    }
    .multiselect__tag {
      background: #3c7a5f !important;
    }
    .multiselect__tag-icon:after {
      color: #1f4a38 !important;
    }

    /* Шапка таблицы — заметно светлее самой светлой полосы зебры,
       иначе шапка сливается со строками и таблица выглядит без рамок */
    .table-vertical table tr th,
    .table-horizontal table tr th {
      background-color: #333a44 !important;
    }

    /* Рамка вокруг самой таблицы — иначе она визуально не отделена от фона */
    .table-vertical,
    .table-horizontal {
      border: 1px solid #3a414b !important;
      border-radius: 4px !important;
    }

    /* Зебра-строки таблиц — захардкожены в CSS сайта, переменными не задеть */
    .table-vertical table tr:nth-of-type(2n):not(.selected-row):not(.report-row-danger):not(.table-error-row):not(.table-success-row) {
      background-color: #262c35 !important;
    }
    .table-vertical table tr:nth-of-type(odd):not(.table-error-row):not(.table-success-row):not(.table-head):not(.selected-row):not(.report-row-danger),
    .table-horizontal table tr:nth-of-type(odd) {
      background-color: #12161c !important;
    }
    .table-horizontal table tr:nth-of-type(odd) td:nth-of-type(odd) {
      background-color: #262c35 !important;
    }
    .table-horizontal table tr:nth-of-type(2n) {
      background-color: #262c35 !important;
    }
    .table-horizontal table tr:nth-of-type(2n) td:nth-of-type(odd) {
      background-color: #12161c !important;
    }

    /* Строки без тёмного варианта в CSS сайта */
    .table-vertical table tr.selected-row {
      background-color: rgba(50, 118, 128, .22) !important;
    }
    .table-vertical table tr.total-row td {
      background-color: #232830 !important;
    }

    /* Бордеры строк/ячеек — были #fff (незаметно на светлом фоне, светится на тёмном) */
    .table-vertical table tr,
    .table-vertical table th,
    .table-vertical table td {
      border-color: #3a414b !important;
    }

    /* Пагинация — хардкод в CSS сайта. Активную/наведённую страницу нужно
       перекрашивать отдельно: у сайта эти состояния заданы без !important,
       и наш !important на базовом классе иначе перебивает их тоже. */
    .column-pagen__item {
      background-color: #232830 !important;
    }
    .column-pagen__item:hover,
    .column-pagen__item.active {
      background-color: #327680 !important;
      color: #fff !important;
    }
    .multiselect__short-multiselect-tag--close {
      background: #454d59 !important;
    }

    /* Кастомный скроллбар (не нативный) */
    .scrollbar,
    .multiselect .multiselect__content-wrapper,
    body > .multiselect__content-wrapper .multiselect__content-wrapper {
      scrollbar-color: #363d47 transparent !important;
    }
    .scrollbar::-webkit-scrollbar-thumb {
      background-color: #363d47 !important;
    }
    .scrollbar::-webkit-scrollbar-thumb:hover {
      background-color: #454d59 !important;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
})();
