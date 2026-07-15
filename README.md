# Monitoring

Tampermonkey-скрипты с автообновлением.

## Установка

Открыть в браузере (с установленным Tampermonkey) и подтвердить установку:

- [TH Management — Bulk Approve Tickets (225)](https://raw.githubusercontent.com/partenkoEgor/Monitoring/main/scripts/th-bulk-approve.user.js)

## Обновление скриптов

1. Внести изменения в файл в `scripts/`.
2. Увеличить `@version` в шапке скрипта — без этого Tampermonkey не увидит обновление.
3. Запушить в ветку `main`.

Tampermonkey периодически (или по кнопке "Check for updates") сверяет `@version` по ссылке из `@updateURL` и подтягивает новый код с `@downloadURL`.