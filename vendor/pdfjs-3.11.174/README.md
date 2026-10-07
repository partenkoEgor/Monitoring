# pdf.js 3.11.174

Без изменений взято из npm-пакета [`pdfjs-dist@3.11.174`](https://www.npmjs.com/package/pdfjs-dist/v/3.11.174)
(Mozilla, лицензия Apache-2.0 — см. `LICENSE`). Целостность архива сверена с `dist.integrity` из реестра npm:
`sha512-TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA==`.

Используется Team Helper для превью PDF (`@require` в шапке `scripts/th-team-helper.user.js`, с проверкой `sha256`).
Лежит в репозитории, а не подключается с CDN, чтобы Tampermonkey брал её с того же `raw.githubusercontent.com`,
откуда приходят обновления скрипта.

Версия 3.11.174 — последняя, у которой есть сборка не-ESM (`build/pdf.min.js`), подключаемая через `@require`.
В ней есть уязвимость CVE-2024-4367 (выполнение кода через специально собранный шрифт), которая закрывается опцией
`isEvalSupported: false` — скрипт всегда открывает документы с ней.
