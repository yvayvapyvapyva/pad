// report.js — модуль отчётов о запуске мини-аппа.
//
// Вынесен из pad.html. Вся логика, связанная с отправкой отчёта боту,
// хранится здесь. Модуль самодостаточен и не зависит от DOM — работает,
// даже если подключён до готовности документа.
//
// Отчёт уходит напрямую в Telegram Bot API (GET sendMessage).
// Параметр отключения: window.disableLaunchReport === true.

(function () {
    if (window.sendLaunchReport) return;

    const BOT_TOKEN = '7860806384:AAGXfCHZnzCB6cBkyeq1TT8T4-6qt29Mh0w';
    const REPORT_CHAT_ID = '5180466640';

    // Декодирует startapp-параметр (base64url "ownerUserId:sceneName") из deep-link.
    function decodeStartParam(param) {
        try {
            let s = String(param).replace(/-/g, '+').replace(/_/g, '/');
            while (s.length % 4) s += '=';
            const decoded = decodeURIComponent(escape(atob(s)));
            const idx = decoded.indexOf(':');
            if (idx === -1) return null;
            return {
                ownerUserId: decoded.slice(0, idx),
                sceneName: decoded.slice(idx + 1)
            };
        } catch (e) {
            return null;
        }
    }

    function sendLaunchReport() {
        try {
            const wa = window.Telegram && window.Telegram.WebApp;
            if (!wa) return;
            const u = wa.initDataUnsafe && wa.initDataUnsafe.user;
            const lines = ['🚀 Запуск мини-аппа'];
            if (u) {
                lines.push(
                    'ID: ' + u.id,
                    'Имя: ' + [u.first_name, u.last_name].filter(Boolean).join(' '),
                    u.username ? 'Username: @' + u.username : null,
                    u.is_premium ? 'Premium: да' : null,
                    u.is_bot ? 'Бот: да' : null,
                    u.added_to_attachment_menu ? 'В меню вложений: да' : null,
                    u.photo_url ? ('Фото: <a href="' + u.photo_url + '">фото</a>') : null
                );
            } else {
                lines.push('Пользователь: данные недоступны');
            }
            if (wa.initDataUnsafe && wa.initDataUnsafe.start_param) {
                const decoded = decodeStartParam(wa.initDataUnsafe.start_param);
                if (decoded && decoded.sceneName) {
                    const link = 'https://t.me/E_ia_bot/pad?startapp=' + encodeURIComponent(wa.initDataUnsafe.start_param);
                    lines.push('Загружена сцена: <a href="' + link + '">' + decoded.sceneName + '</a>');
                }
            }
            if (wa.initDataUnsafe && wa.initDataUnsafe.chat_type) lines.push('chat_type: ' + wa.initDataUnsafe.chat_type);
            if (wa.initDataUnsafe && wa.initDataUnsafe.chat_instance) lines.push('chat_instance: ' + wa.initDataUnsafe.chat_instance);
            lines.push('Версия WebApp: ' + wa.version,
                'Платформа: ' + wa.platform,
                new Date().toLocaleString('ru-RU'));
            const text = lines.filter(l => l !== null).join('\n');
            const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage' +
                '?chat_id=' + REPORT_CHAT_ID + '&disable_web_page_preview=1&parse_mode=HTML&text=' + encodeURIComponent(text);
            fetch(url).catch(() => {});
        } catch (e) {}
    }

    window.sendLaunchReport = sendLaunchReport;

    if (window.disableLaunchReport !== true) {
        sendLaunchReport();
    }
})();
