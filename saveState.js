// Менеджер сцен через Яндекс.Облако функцию (YDB, таблица "scene").
//
// Модуль переиспользует serializeScene()/restoreScene() из pad.html, чтобы не
// дублировать логику сериализации линий, объектов и записанных движений машинок.
//
// Кнопка сразу открывает менеджер со списком всех сцен пользователя. Из него:
//   - Сохранить   — открывает окно с именем: если ввести существующее имя,
//                   сцена перезаписывается, новое имя — создаётся новая сцена;
//   - Клик по строке сцены — применяет сцену на карту и делает её активной;
//   - Переименовать (иконка) — меняет имя сцены;
//   - Удалить (иконка)       — удаляет сцену.

(function () {
    if (window.sceneIoInit) return;
    window.sceneIoInit = true;

    const API_URL = 'https://functions.yandexcloud.net/d4eurq94s2t0svq2jpu4';
    const BOT_LINK = 'https://t.me/E_ia_bot/pad2';

    // Имя активной (загруженной на карту) сцены. null — активной сцены нет.
    let activeSceneName = null;

    // Кэш списка сцен. Загружается при запуске приложения и обновляется
    // после сохранения, переименования или удаления сцен.
    let scenesCache = [];

    // ---- Base64URL кодирование/декодирование для startapp параметра ----
    function b64urlEncode(str) {
        return btoa(unescape(encodeURIComponent(str)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64urlDecode(s) {
        s = s.replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        return decodeURIComponent(escape(atob(s)));
    }

    // Telegram-контекст: user_id и init_data (подписанные данные для проверки на сервере)
    function tgCreds() {
        const wa = window.Telegram && window.Telegram.WebApp;
        const user = wa && wa.initDataUnsafe && wa.initDataUnsafe.user;
        return {
            user_id: user ? String(user.id) : '',
            init_data: wa ? (wa.initData || '') : ''
        };
    }

    function collectState() {
        const snap = window.serializeScene ? window.serializeScene() : { lines: [], markers: [] };

        const center = map && map.center ? [map.center[0], map.center[1]] : null;

        return {
            app: 'scene-save',
            version: 1,
            savedAt: new Date().toISOString(),
            camera: {
                center: center,
                zoom: map ? map.zoom : null,
                azimuth: (map && map.azimuth != null) ? map.azimuth : (typeof mapRot === 'number' ? mapRot : null)
            },
            lines: snap.lines || [],
            markers: snap.markers || []
        };
    }

    function defaultName() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return 'scene-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function sanitizeName(name) {
        return String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
    }

    async function api(method, { body, query } = {}) {
        const creds = tgCreds();
        // Для GET/DELETE/PUT передаём user_id и init_data в query-строке
        query = Object.assign({}, query || {});
        if (creds.user_id && query.user_id == null) query.user_id = creds.user_id;
        if (creds.init_data && query.initData == null) query.initData = creds.init_data;
        let url = API_URL;
        if (query && Object.keys(query).length) {
            const qs = Object.keys(query)
                .filter(k => query[k] != null && query[k] !== '')
                .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
                .join('&');
            if (qs) url += '?' + qs;
        }
        const opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body !== undefined) {
            const full = Object.assign({}, body);
            if (creds.user_id) full.user_id = creds.user_id;
            if (creds.init_data) full.init_data = creds.init_data;
            opts.body = JSON.stringify(full);
        }
        const resp = await fetch(url, opts);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || json.ok === false) throw new Error(json.error || ('Ошибка ' + resp.status));
        return json;
    }

    // ---- Размер в килобайтах ----
    function formatSize(bytes) {
        if (!bytes || bytes <= 0) return '';
        return (bytes / 1024).toFixed(1) + ' КБ';
    }

    // ---- Открыть/закрыть менеджер ----
    let managerEl = null;

    function closeManager() {
        if (managerEl) {
            const el = managerEl;
            managerEl = null;
            el.classList.remove('visible');
            const btn = document.getElementById('saveBtn');
            if (btn) btn.classList.remove('active');
            setTimeout(() => el.remove(), 200);
        }
    }

    function closeM(el) {
        el.classList.remove('visible');
        setTimeout(() => el.remove(), 200);
    }

    // ---- Растягивание шторки за заголовок (как у ПДД) ----
    function attachSheetDrag(modal) {
        const box = modal.querySelector('.scene-io-box');
        const header = modal.querySelector('.scene-io-header');
        if (!box || !header) return;
        let drag = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.scene-io-close') || e.target.closest('button')) return;
            modal.classList.add('scene-io-dragging');
            drag = { startY: e.clientY, startH: box.offsetHeight };
            header.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const h = drag.startH + (drag.startY - e.clientY);
            const vh = window.innerHeight;
            box.style.height = Math.min(vh, Math.max(vh * 0.12, h)) + 'px';
        });
        const endDrag = () => { drag = null; modal.classList.remove('scene-io-dragging'); };
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);
    }

    // ---- Применение сцены на карту ----
    function applyScene(data, name) {
        const lines = Array.isArray(data.lines) ? data.lines : [];
        const markers = Array.isArray(data.markers) ? data.markers : [];

        const snap = {
            lines: lines.map(l => ({
                coords: Array.isArray(l.coords) ? l.coords.map(c => (Array.isArray(c) ? c.slice() : c)) : [],
                color: l.color || '#000000',
                width: l.width || 5
            })),
            markers: markers.map(m => ({
                kind: m.kind || 'pic',
                file: m.file,
                lat: m.lat,
                lon: m.lon,
                heading: m.heading || 0,
                leg: !!m.leg,
                rec: m.rec || null
            }))
        };

        if (window.restoreScene) {
            window.restoreScene(snap);
            if (window.commit) window.commit();
        }

        if (map && data.camera) {
            try {
                if (Array.isArray(data.camera.center) && data.camera.center.length >= 2 && data.camera.zoom != null) {
                    const loc = {
                        center: [data.camera.center[0], data.camera.center[1]],
                        zoom: data.camera.zoom
                    };
                    loc.duration = 0;
                    map.update({ location: loc });
                }
                if (data.camera.azimuth != null && map.setCamera) {
                    map.setCamera({ azimuth: data.camera.azimuth });
                } else if (data.camera.azimuth != null) {
                    map.update({ camera: { azimuth: data.camera.azimuth } });
                }
            } catch (e) {}
        }

        activeSceneName = name || null;
    }

    // ---- Toast-уведомление ----
    function showToast(text, duration) {
        duration = duration || 2000;
        const t = document.createElement('div');
        t.textContent = text;
        t.style.cssText = 'position:fixed;bottom:calc(100px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);'
            + 'z-index:9999;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;'
            + 'background:rgba(48,209,88,0.95);color:#fff;pointer-events:none;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity .3s;white-space:nowrap;';
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; }, duration);
        setTimeout(() => t.remove(), duration + 300);
    }

    // ---- Загрузка чужой сцены (shared) ----
    window.loadSharedScene = async function (ownerUserId, sceneName) {
        try {
            const got = await api('GET', { query: { owner_user_id: ownerUserId, name: sceneName } });
            let data = got.data;
            if (typeof data === 'string') data = JSON.parse(data);
            if (!data) { showToast('Сцена не найдена'); return; }
            applyScene(data, null);
            activeSceneName = null;
        } catch (e) {
            showToast('Ошибка загрузки: ' + e.message);
        }
    };

    // ---- Кодирование deep-link ссылки ----
    window.makeShareLink = function (ownerUserId, sceneName) {
        const payload = b64urlEncode(ownerUserId + ':' + sceneName);
        return BOT_LINK + '?startapp=' + encodeURIComponent(payload);
    };

    // ---- Копирование в буфер + тост ----
    function copyShareLink(ownerUserId, sceneName) {
        const link = window.makeShareLink(ownerUserId, sceneName);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(
                () => showToast('Ссылка скопирована в буфер обмена'),
                () => fallbackCopy(link)
            );
        } else {
            fallbackCopy(link);
        }
    }
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('Ссылка скопирована в буфер обмена'); }
        catch (e) { showToast('Не удалось скопировать'); }
        ta.remove();
    }

    // ---- Сохранение (интерактив: ввод имени) ----
    function saveWithName({ prefill, callback }) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-io-modal scene-io-modal-save scene-io-center';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const header = document.createElement('div');
        header.className = 'scene-io-header';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'scene-io-close';
        closeBtn.innerHTML = '&#10005;';
        closeBtn.addEventListener('click', () => closeM(wrap));
        const headerTitle = document.createElement('div');
        headerTitle.className = 'scene-io-header-title';
        headerTitle.textContent = 'Сохранить сцену';
        header.appendChild(closeBtn);
        header.appendChild(headerTitle);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'scene-io-input';
        nameInput.value = prefill || '';
        nameInput.placeholder = 'Имя сцены';
        nameInput.spellcheck = false;
        nameInput.autocomplete = 'off';

        const confirm = document.createElement('button');
        confirm.className = 'scene-io-opt scene-io-primary';
        confirm.innerHTML = '<span class="scene-io-opt-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Сохранить</span>';

        const status = document.createElement('div');
        status.className = 'scene-io-status';

        box.appendChild(header);
        box.appendChild(nameInput);
        box.appendChild(confirm);
        box.appendChild(status);
        wrap.appendChild(box);
        wrap.addEventListener('click', e => { if (e.target === wrap) { closeM(wrap); } });
        document.body.appendChild(wrap);
        attachSheetDrag(wrap);
        requestAnimationFrame(() => {
            wrap.classList.add('visible');
            nameInput.focus();
            if (nameInput.value) nameInput.select();
        });

        confirm.addEventListener('click', async () => {
            const name = sanitizeName(nameInput.value);
            if (!name) { status.textContent = 'Введите имя сцены'; return; }
            confirm.disabled = true;
            status.textContent = 'Сохранение…';
            status.classList.add('busy');
            try {
                await api('POST', { body: { name: name, data: collectState() } });
                status.textContent = 'Сохранено ✓';
                status.classList.remove('busy');
                status.classList.add('ok');
                closeM(wrap);
                if (callback) callback(name);
            } catch (e) {
                status.textContent = 'Ошибка: ' + e.message;
                status.classList.remove('busy');
                confirm.disabled = false;
            }
        });
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirm.click(); }
        });
    }

    // Сохранить в активную сцену (перезапись) или создать новую
    function saveActive() {
        const prefill = activeSceneName || defaultName();
        saveWithName({
            prefill: prefill,
            callback: (name) => {
                activeSceneName = name;
                reloadScenes();
            }
        });
    }

    // ---- Простой prompt-модалка (для переименования) ----
    function promptBox({ title, label, value, placeholder, okText, onSubmit }) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-io-modal scene-io-modal-save scene-io-center';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const header = document.createElement('div');
        header.className = 'scene-io-header';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'scene-io-close';
        closeBtn.innerHTML = '&#10005;';
        closeBtn.addEventListener('click', () => closeM(wrap));
        const headerTitle = document.createElement('div');
        headerTitle.className = 'scene-io-header-title';
        headerTitle.textContent = title;
        header.appendChild(closeBtn);
        header.appendChild(headerTitle);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'scene-io-input';
        input.value = value || '';
        input.placeholder = placeholder || label || '';
        input.spellcheck = false;
        input.autocomplete = 'off';

        const ok = document.createElement('button');
        ok.className = 'scene-io-opt';
        ok.textContent = okText || 'ОК';

        const status = document.createElement('div');
        status.className = 'scene-io-status';

        box.appendChild(header);
        box.appendChild(input);
        box.appendChild(ok);
        box.appendChild(status);
        wrap.appendChild(box);
        wrap.addEventListener('click', e => { if (e.target === wrap) closeM(wrap); });
        document.body.appendChild(wrap);
        requestAnimationFrame(() => {
            wrap.classList.add('visible');
            input.focus();
            input.select();
        });

        const submit = () => {
            const val = sanitizeName(input.value);
            if (!val) { status.textContent = 'Введите имя'; return; }
            ok.disabled = true;
            onSubmit(val, wrap).catch(e => {
                status.textContent = 'Ошибка: ' + e.message;
                ok.disabled = false;
            });
        };

        ok.addEventListener('click', submit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
    }

    // ---- Конфирм (для удаления) ----
    function confirmBox({ title, message, okText, onOk }) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-io-modal scene-io-modal-save scene-io-center';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const header = document.createElement('div');
        header.className = 'scene-io-header';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'scene-io-close';
        closeBtn.innerHTML = '&#10005;';
        closeBtn.addEventListener('click', () => closeM(wrap));
        const headerTitle = document.createElement('div');
        headerTitle.className = 'scene-io-header-title';
        headerTitle.textContent = title;
        header.appendChild(closeBtn);
        header.appendChild(headerTitle);

        const msg = document.createElement('div');
        msg.className = 'scene-io-confirm-msg';
        msg.textContent = message;

        const ok = document.createElement('button');
        ok.className = 'scene-io-opt scene-io-danger';
        ok.textContent = okText || 'Удалить';

        box.appendChild(header);
        box.appendChild(msg);
        box.appendChild(ok);
        wrap.appendChild(box);
        wrap.addEventListener('click', e => { if (e.target === wrap) closeM(wrap); });
        document.body.appendChild(wrap);
        requestAnimationFrame(() => wrap.classList.add('visible'));

        ok.addEventListener('click', async () => {
            ok.disabled = true;
            try {
                await onOk();
                closeM(wrap);
            } catch (e) {
                ok.disabled = false;
                msg.textContent = 'Ошибка: ' + e.message;
            }
        });
    }

    // ---- Менеджер сцен ----

    // Загрузка списка сцен в кэш. Возвращает отсортированный список.
    async function loadScenes() {
        try {
            const json = await api('GET', {});
            scenesCache = (json.scenes || [])
                .slice()
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        } catch (e) {
            scenesCache = [];
        }
        return scenesCache;
    }

    // Общий конструктор строки списка
    function makeRow(scene, statusEl) {
        const row = document.createElement('div');
        row.className = 'scene-io-item' + (activeSceneName === scene.name ? ' active' : '');
        row.addEventListener('click', () => loadScene(scene, statusEl));
        const main = document.createElement('div');
        main.className = 'scene-io-item-main';
        const left = document.createElement('div');
        left.className = 'scene-io-item-left';
        const nm = document.createElement('div');
        nm.className = 'scene-io-item-name';
        nm.textContent = scene.name;
        left.appendChild(nm);
        const meta = document.createElement('div');
        meta.className = 'scene-io-item-meta';
        const parts = [];
        if (scene.sizeBytes) parts.push(formatSize(scene.sizeBytes));
        if (scene.savedAt) parts.push(new Date(scene.savedAt).toLocaleString());
        meta.textContent = parts.join(' · ');
        left.appendChild(meta);
        main.appendChild(left);
        const btns = document.createElement('div');
        btns.className = 'scene-io-item-btns';
        const mkBtn = (title, svg, onClick) => {
            const b = document.createElement('button');
            b.className = 'scene-io-item-btn';
            b.title = title;
            b.setAttribute('aria-label', title);
            b.innerHTML = svg;
            b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
            return b;
        };
        btns.appendChild(mkBtn('Переименовать',
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="#FFD60A"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
            () => renameScene(scene, statusEl)));
        btns.appendChild(mkBtn('Поделиться',
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="#0A84FF"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
            () => copyShareLink(tgCreds().user_id, scene.name)));
        btns.appendChild(mkBtn('Удалить',
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="#FF453A"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM8 9h8v10H8V9zm.5-5l1-1h5l1 1H20v2H4V4h4.5z"/></svg>',
            () => deleteScene(scene, statusEl)));
        main.appendChild(btns);
        row.appendChild(main);
        return row;
    }

    function openManager() {
        if (managerEl) { managerEl.classList.add('visible'); return; }

        const modal = document.createElement('div');
        modal.className = 'scene-io-modal';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const header = document.createElement('div');
        header.className = 'scene-io-header';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'scene-io-close';
        closeBtn.innerHTML = '&#10005;';
        closeBtn.addEventListener('click', closeManager);
        const headerTitle = document.createElement('div');
        headerTitle.className = 'scene-io-header-title';
        headerTitle.textContent = 'Сцены';
        header.appendChild(closeBtn);
        header.appendChild(headerTitle);

        // Кнопка сохранения
        const saveBtn = document.createElement('button');
        saveBtn.className = 'scene-io-opt scene-io-primary';
        saveBtn.innerHTML = '<span class="scene-io-opt-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Сохранить текущую сцену</span>';
        saveBtn.addEventListener('click', saveActive);

        const listBody = document.createElement('div');
        listBody.className = 'scene-io-list';

        const status = document.createElement('div');
        status.className = 'scene-io-status busy';
        status.textContent = 'Загрузка списка…';

        box.appendChild(header);
        box.appendChild(listBody);
        box.appendChild(status);
        box.appendChild(saveBtn);
        modal.appendChild(box);
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('visible'));
        managerEl = modal;
        attachSheetDrag(modal);
        const btn = document.getElementById('saveBtn');
        if (btn) btn.classList.add('active');

        (async () => {
            status.classList.remove('busy');
            status.textContent = scenesCache.length ? '' : 'Нет ни одной сцены';
            scenesCache.forEach(s => {
                listBody.appendChild(makeRow(s, status));
            });
        })();
    }

    async function loadScene(scene, statusEl) {
        try {
            const got = await api('GET', { query: { name: scene.name } });
            let data = got.data;
            if (typeof data === 'string') data = JSON.parse(data);
            applyScene(data || got, scene.name);
            if (managerEl) {
                const rows = managerEl.querySelectorAll('.scene-io-item');
                rows.forEach(r => r.classList.toggle('active', r.querySelector('.scene-io-item-name').textContent === scene.name));
            }
            statusEl.classList.remove('busy');
            statusEl.textContent = 'Загружено: ' + scene.name;
        } catch (e) {
            statusEl.classList.remove('busy');
            statusEl.textContent = 'Ошибка: ' + e.message;
        }
    }

    async function renameScene(scene, statusEl) {
        promptBox({
            title: 'Переименовать сцену',
            label: 'Новое имя',
            value: scene.name,
            placeholder: 'Новое имя сцены',
            okText: 'Переименовать',
            onSubmit: async (newName, wrap) => {
                await api('PUT', { body: { name: newName, from: scene.name } });
                if (activeSceneName === scene.name) activeSceneName = newName;
                closeM(wrap);
                reloadScenes();
            }
        });
    }

    async function deleteScene(scene, statusEl) {
        confirmBox({
            title: 'Удалить сцену',
            message: 'Удалить сцену «' + scene.name + '» без возможности восстановления?',
            okText: 'Удалить',
            onOk: async () => {
                await api('DELETE', { query: { name: scene.name } });
                if (activeSceneName === scene.name) activeSceneName = null;
                reloadScenes();
            }
        });
    }

    // Обновить список в менеджере из кэша без пересоздания окна
    function refreshManager() {
        if (!managerEl) return;
        const listBody = managerEl.querySelector('.scene-io-list');
        const status = managerEl.querySelector('.scene-io-status');
        listBody.innerHTML = '';
        status.classList.remove('busy');
        status.textContent = scenesCache.length ? '' : 'Нет ни одной сцены';
        scenesCache.forEach(s => listBody.appendChild(makeRow(s, status)));
    }

    // Обновить кэш сцен и, если шторка открыта, перерисовать список.
    // Вызывается после сохранения, переименования или удаления.
    async function reloadScenes() {
        await loadScenes();
        refreshManager();
    }

    // ---- Кнопка ----
    function init() {
        const group = document.createElement('div');
        group.id = 'savePddGroup';
        const pddBtn = document.getElementById('pddBtn');
        if (pddBtn) group.appendChild(pddBtn);
        document.body.appendChild(group);

        const btn = document.createElement('button');
        btn.id = 'saveBtn';
        btn.className = 'fab';
        btn.title = 'Сцены';
        btn.setAttribute('aria-label', 'Сцены');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M5,3A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5.5L18.5,3H17V9A1,1 0 0,1 16,10H8A1,1 0 0,1 7,9V3H5M12,4V9H15V4H12M7,12H17A1,1 0 0,1 18,13V19H6V13A1,1 0 0,1 7,12Z"/></svg>';
        btn.addEventListener('click', () => {
            if (managerEl && managerEl.classList.contains('visible')) closeManager();
            else openManager();
        });
        group.appendChild(btn);

        const css = document.createElement('style');
        css.textContent = '#savePddGroup{position:fixed;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;z-index:9006;pointer-events:none;touch-action:manipulation;}'
            + '#savePddGroup > *{pointer-events:auto;}'
            + '#savePddGroup #pddBtn{position:static;left:auto;transform:none;height:44px;}'
            + '#savePddGroup #pddBtn:active{transform:scale(0.92);}'
            + '#saveBtn { top:auto; right:auto; position:static; height:44px; width:44px; border-radius:22px; }'
            + '#saveBtn.active { background:rgba(48,209,88,0.5); border-color:#30D158; }'
            + '@keyframes sceneIoSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}'
            + '.scene-io-modal{position:fixed;inset:0;z-index:9500;background:transparent;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding:0;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s;-webkit-tap-highlight-color:transparent;}'
            + '.scene-io-modal.visible{opacity:1;visibility:visible;}'
            + '.scene-io-box{pointer-events:auto;width:100%;max-width:100%;background:linear-gradient(180deg,rgba(30,30,30,0.98) 0%,rgba(18,18,18,1) 100%);border-radius:20px 20px 0 0;border-top:0.5px solid rgba(255,255,255,0.1);padding:0 0 env(safe-area-inset-bottom) 0;display:flex;flex-direction:column;gap:0;transform:translateY(100%);transition:transform .35s cubic-bezier(.32,.72,0,1);max-height:88vh;overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,0.5);}'
            + '.scene-io-modal.visible .scene-io-box{transform:translateY(0);}'
            + '.scene-io-modal.scene-io-center{background:rgba(0,0,0,0.6);pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:24px;}'
            + '.scene-io-modal.scene-io-center .scene-io-box{width:100%;max-width:320px;border-radius:16px;border:0.5px solid rgba(255,255,255,0.12);padding:12px 16px 16px;gap:12px;transform:translateY(0) scale(0.95);transition:transform .2s ease;max-height:85vh;box-shadow:0 20px 60px rgba(0,0,0,0.5);}'
            + '.scene-io-modal.scene-io-center.visible .scene-io-box{transform:translateY(0) scale(1);}'
            + '.scene-io-modal.scene-io-center .scene-io-input{margin:0;}'
            + '.scene-io-modal.scene-io-center .scene-io-header{padding:0 0 6px;}'
            + '.scene-io-modal.scene-io-center .scene-io-opt{width:100%;margin:0;}'
            + '.scene-io-modal.scene-io-center .scene-io-cancel{width:100%;margin:0;border-radius:12px;}'
            + '.scene-io-modal.scene-io-center .scene-io-confirm-msg{padding:0 4px 4px;}'
            + '.scene-io-status:empty{display:none;}'
            + '.scene-io-header{display:flex;align-items:center;gap:8px;padding:10px 10px 8px;border-bottom:0.5px solid rgba(255,255,255,0.1);flex-shrink:0;touch-action:none;user-select:none;-webkit-user-select:none;}'
            + '.scene-io-header-title{font-size:16px;font-weight:700;flex:1;text-align:center;color:#fff;letter-spacing:-0.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
            + '.scene-io-close{width:30px;height:30px;border-radius:50%;border:0.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;flex-shrink:0;margin-left:auto;order:2;}'
            + '.scene-io-header-title{order:1;}'
            + '.scene-io-close:active{background:rgba(255,255,255,0.15);}'
            + '.scene-io-title{font-size:17px;font-weight:700;color:#fff;text-align:center;padding:14px 16px 10px;letter-spacing:-0.3px;flex-shrink:0;}'
            + '.scene-io-header{padding:10px 10px 8px;}'
            + '.scene-io-opt{display:flex;align-items:center;justify-content:center;gap:8px;width:calc(100% - 32px);margin:0 16px;padding:15px;border:none;border-radius:14px;background:rgba(255,255,255,0.07);color:#fff;font-size:15px;font-weight:500;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:all .2s ease;letter-spacing:-0.2px;flex-shrink:0;}'
            + '.scene-io-opt:active{background:rgba(255,255,255,0.14);transform:scale(0.98);}'
            + '.scene-io-opt:disabled{opacity:0.5;}'
            + '.scene-io-opt-icon{width:22px;height:22px;flex-shrink:0;}'
            + '.scene-io-cancel{padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);font-size:15px;font-weight:500;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;width:calc(100% - 32px);margin:0 16px;transition:all .2s ease;letter-spacing:-0.2px;flex-shrink:0;}'
            + '.scene-io-cancel:active{background:rgba(255,255,255,0.12);transform:scale(0.98);}'
            + '.scene-io-input{width:100%;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#fff;font-size:16px;outline:none;margin:10px 0;user-select:text;-webkit-user-select:text;-webkit-tap-highlight-color:transparent;transition:border-color .2s ease;flex-shrink:0;}'
            + '.scene-io-input:focus{border-color:rgba(48,209,88,0.6);background:rgba(255,255,255,0.08);}'
            + '.scene-io-status{min-height:20px;font-size:13px;color:rgba(255,255,255,0.4);text-align:center;padding:4px 16px;flex-shrink:0;}'
            + '.scene-io-status.busy{color:#FFD60A;}'
            + '.scene-io-status.ok{color:#30D158;}'
            + '.scene-io-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;flex:1 1 auto;min-height:0;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:8px 16px;}'
            + '.scene-io-list::-webkit-scrollbar{display:none;}'
            + '.scene-io-item{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border:none;border-radius:14px;background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;min-height:56px;transition:background .15s ease,transform .12s ease,border-color .2s ease;border:1px solid transparent;}'
            + '.scene-io-item:active{background:rgba(255,255,255,0.18);transform:scale(0.98);}'
            + '.scene-io-item.active{background:rgba(48,209,88,0.12);border-color:rgba(48,209,88,0.5);}'
            + '.scene-io-item.active:active{background:rgba(48,209,88,0.22);transform:scale(0.98);}'
            + '.scene-io-item-main{display:flex;align-items:center;justify-content:space-between;gap:10px;}'
            + '.scene-io-item-left{flex:1;min-width:0;}'
            + '.scene-io-item-name{font-size:15px;font-weight:600;word-break:break-all;letter-spacing:-0.2px;}'
            + '.scene-io-item-meta{font-size:12px;color:rgba(255,255,255,0.35);margin-top:3px;}'
            + '.scene-io-item.active .scene-io-item-meta{color:rgba(48,209,88,0.7);}'
            + '.scene-io-item-btns{display:flex;gap:6px;flex-shrink:0;}'
            + '.scene-io-item-btn{width:40px;height:40px;border:none;border-radius:10px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;padding:0;user-select:none;-webkit-user-select:none;transition:all .15s ease;}'
            + '.scene-io-item-btn:active{background:rgba(255,255,255,0.15);transform:scale(0.9);}'
            + '.scene-io-modal-save{z-index:9600;}'
            + '.scene-io-modal.scene-io-dragging .scene-io-box{transition:none;}'
            + '.scene-io-confirm-msg{font-size:15px;color:rgba(255,255,255,0.75);text-align:center;padding:14px 24px 16px;line-height:1.5;user-select:none;-webkit-user-select:none;}'
            + '.scene-io-opt.scene-io-danger{background:rgba(255,69,58,0.15);color:#FF453A;}'
            + '.scene-io-opt.scene-io-danger:active{background:rgba(255,69,58,0.25);}'
            + '.scene-io-opt.scene-io-primary{background:rgba(48,209,88,0.9);color:#000;margin:12px 16px calc(12px + env(safe-area-inset-bottom));}'
            + '.scene-io-opt.scene-io-primary:active{background:rgba(48,209,88,1);}'
            + '.scene-io-opt.scene-io-primary:disabled{background:rgba(48,209,88,0.5);}'
            + '.scene-io-opt.scene-io-primary .scene-io-opt-icon svg{fill:#000;}';
        document.head.appendChild(css);

        loadScenes();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
