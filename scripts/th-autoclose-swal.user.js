// ==UserScript==
// @name         Auto-close SweetAlert2 success popups
// @namespace    th-management-autoclose
// @version      1.7
// @description  Закрывает только swal2-окна: иконка успеха + текст "OK!" в содержимом + кнопка "OK", без кнопки отмены
// @match        https://th-managment.com/en/admin/backoffice/*
// @match        https://managment.io/en/admin/backoffice/*
// @match        https://my-managment.com/en/admin/backoffice/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-autoclose-swal.user.js
// @downloadURL  https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-autoclose-swal.user.js
// ==/UserScript==

// Изменения в 1.7:
// - Лог автозакрытия теперь включает title попапа, а не только тело и кнопку.
//   Это нужно для диагностики: если сайт когда-либо покажет реальный текст
//   ошибки в title при том же наборе (иконка success + тело "OK!" + кнопка
//   "OK" + без отмены), это будет видно в консоли, а не потеряется молча.

(function () {
    'use strict';

    function normalize(text) {
        return text
            .replace(/О/g, 'O')
            .replace(/о/g, 'o')
            .replace(/К/g, 'K')
            .replace(/к/g, 'k');
    }

    const observer = new MutationObserver(() => {
        const popup = document.querySelector('.swal2-popup');
        if (!popup) return;

        const isSuccess = popup.classList.contains('swal2-icon-success');

        const cancelBtn = popup.querySelector('.swal2-cancel');
        const hasCancel = cancelBtn && cancelBtn.style.display !== 'none';

        const titleEl = popup.querySelector('.swal2-title');
        const titleText = titleEl ? titleEl.textContent.trim() : '';

        const contentEl = popup.querySelector('.swal2-html-container');
        const contentText = contentEl ? normalize(contentEl.textContent.trim()) : '';
        const hasOkContent = /^ok!?$/i.test(contentText);

        const confirmBtn = popup.querySelector('.swal2-confirm');
        const confirmText = confirmBtn ? normalize(confirmBtn.textContent.trim()) : '';
        const hasOkButton = /^ok$/i.test(confirmText);

        if (isSuccess && !hasCancel && hasOkContent && hasOkButton) {
            confirmBtn.click();
            console.log(
                '[AutoClose] Закрыл попап: title "%s", содержимое "%s", кнопка "%s"',
                titleText,
                contentText,
                confirmText
            );
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
