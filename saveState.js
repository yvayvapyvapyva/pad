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

    // Имя активной (загруженной на карту) сцены. null — активной сцены нет.
    let activeSceneName = null;

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
            setTimeout(() => el.remove(), 200);
        }
    }

    function closeM(el) {
        el.classList.remove('visible');
        setTimeout(() => el.remove(), 200);
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

    // ---- Сохранение (интерактив: ввод имени) ----
    function saveWithName({ prefill, callback }) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-io-modal scene-io-modal-save';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const title = document.createElement('div');
        title.className = 'scene-io-title';
        title.textContent = 'Сохранить сцену';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'scene-io-input';
        nameInput.value = prefill || '';
        nameInput.placeholder = 'Имя сцены';
        nameInput.spellcheck = false;
        nameInput.autocomplete = 'off';

        const confirm = document.createElement('button');
        confirm.className = 'scene-io-opt';
        confirm.innerHTML = '<span class="scene-io-opt-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Сохранить</span>';

        const cancel = document.createElement('button');
        cancel.className = 'scene-io-cancel';
        cancel.textContent = 'Отмена';

        const status = document.createElement('div');
        status.className = 'scene-io-status';

        box.appendChild(title);
        box.appendChild(nameInput);
        box.appendChild(confirm);
        box.appendChild(status);
        box.appendChild(cancel);
        wrap.appendChild(box);
        wrap.addEventListener('click', e => { if (e.target === wrap) { closeM(wrap); } });
        document.body.appendChild(wrap);
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
        cancel.addEventListener('click', () => closeM(wrap));
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
                if (managerEl) {
                    const rows = managerEl.querySelectorAll('.scene-io-item');
                    rows.forEach(r => r.classList.toggle('active', r.querySelector('.scene-io-item-name').textContent === name));
                    refreshManager();
                }
            }
        });
    }

    // ---- Простой prompt-модалка (для переименования) ----
    function promptBox({ title, label, value, placeholder, okText, onSubmit }) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-io-modal scene-io-modal-save';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const t = document.createElement('div');
        t.className = 'scene-io-title';
        t.textContent = title;

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

        const cancel = document.createElement('button');
        cancel.className = 'scene-io-cancel';
        cancel.textContent = 'Отмена';

        const status = document.createElement('div');
        status.className = 'scene-io-status';

        box.appendChild(t);
        box.appendChild(input);
        box.appendChild(ok);
        box.appendChild(status);
        box.appendChild(cancel);
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
        cancel.addEventListener('click', () => closeM(wrap));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
    }

    // ---- Конфирм (для удаления) ----
    function confirmBox({ title, message, okText, onOk }) {
        const wrap = document.createElement('div');
        wrap.className = 'scene-io-modal scene-io-modal-save';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const t = document.createElement('div');
        t.className = 'scene-io-title';
        t.textContent = title;

        const msg = document.createElement('div');
        msg.className = 'scene-io-confirm-msg';
        msg.textContent = message;

        const ok = document.createElement('button');
        ok.className = 'scene-io-opt scene-io-danger';
        ok.textContent = okText || 'Удалить';

        const cancel = document.createElement('button');
        cancel.className = 'scene-io-cancel';
        cancel.textContent = 'Отмена';

        box.appendChild(t);
        box.appendChild(msg);
        box.appendChild(ok);
        box.appendChild(cancel);
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
        cancel.addEventListener('click', () => closeM(wrap));
    }

    // ---- Менеджер сцен ----
    function openManager() {
        if (managerEl) { managerEl.classList.add('visible'); return; }

        const modal = document.createElement('div');
        modal.className = 'scene-io-modal';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const title = document.createElement('div');
        title.className = 'scene-io-title';
        title.textContent = 'Сцены';

        // Кнопка сохранения
        const saveBtn = document.createElement('button');
        saveBtn.className = 'scene-io-opt';
        saveBtn.innerHTML = '<span class="scene-io-opt-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Сохранить сцену</span>';
        saveBtn.addEventListener('click', saveActive);

        const listBody = document.createElement('div');
        listBody.className = 'scene-io-list';

        const status = document.createElement('div');
        status.className = 'scene-io-status busy';
        status.textContent = 'Загрузка списка…';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'scene-io-cancel';
        cancelBtn.textContent = 'Закрыть';
        cancelBtn.addEventListener('click', closeManager);

        box.appendChild(title);
        box.appendChild(saveBtn);
        box.appendChild(listBody);
        box.appendChild(status);
        box.appendChild(cancelBtn);
        modal.appendChild(box);
        modal.addEventListener('click', e => { if (e.target === modal) closeManager(); });
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('visible'));
        managerEl = modal;

        (async () => {
            try {
                const json = await api('GET', {});
                const scenes = (json.scenes || [])
                    .slice()
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
                status.classList.remove('busy');
                status.textContent = scenes.length ? '' : 'Нет ни одной сцены';
                scenes.forEach(s => {
                    listBody.appendChild(buildSceneRow(s, status, listBody));
                });
            } catch (e) {
                status.classList.remove('busy');
                status.textContent = 'Ошибка: ' + e.message;
            }
        })();

        function buildSceneRow(scene, statusEl, listEl) {
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

            const renameBtn = mkBtn('Переименовать',
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="#FFD60A"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
                () => renameScene(scene, statusEl));
            const delBtn = mkBtn('Удалить',
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="#FF453A"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM8 9h8v10H8V9zm.5-5l1-1h5l1 1H20v2H4V4h4.5z"/></svg>',
                () => deleteScene(scene, statusEl));

            btns.appendChild(renameBtn);
            btns.appendChild(delBtn);
            main.appendChild(btns);
            row.appendChild(main);
            return row;
        }
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
                refreshManager();
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
                refreshManager();
            }
        });
    }

    // Обновить список в менеджере без пересоздания окна
    async function refreshManager() {
        if (!managerEl) return;
        const listBody = managerEl.querySelector('.scene-io-list');
        const status = managerEl.querySelector('.scene-io-status');
        listBody.innerHTML = '';
        status.classList.add('busy');
        status.textContent = 'Обновление…';
        try {
            const json = await api('GET', {});
            const scenes = (json.scenes || [])
                .slice()
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));
            status.classList.remove('busy');
            status.textContent = scenes.length ? '' : 'Нет ни одной сцены';
            scenes.forEach(s => listBody.appendChild(buildRow(s)));
        } catch (e) {
            status.classList.remove('busy');
            status.textContent = 'Ошибка: ' + e.message;
        }

        // Перемещаем buildRow сюда, чтобы использовать в refreshManager
        function buildRow(scene) {
            const row = document.createElement('div');
            row.className = 'scene-io-item' + (activeSceneName === scene.name ? ' active' : '');
            row.addEventListener('click', () => loadScene(scene, status));
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
                () => renameScene(scene, status)));
            btns.appendChild(mkBtn('Удалить',
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="#FF453A"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM8 9h8v10H8V9zm.5-5l1-1h5l1 1H20v2H4V4h4.5z"/></svg>',
                () => deleteScene(scene, status)));
            main.appendChild(btns);
            row.appendChild(main);
            return row;
        }
    }

    // ---- Кнопка ----
    function init() {
        const btn = document.createElement('button');
        btn.id = 'saveBtn';
        btn.className = 'fab';
        btn.title = 'Сцены';
        btn.setAttribute('aria-label', 'Сцены');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v5h12V4H6zm3 0v3h6V4H9zM6 13v5h12v-5H6z"/></svg>';
        btn.addEventListener('click', openManager);
        document.body.appendChild(btn);

        const css = document.createElement('style');
        css.textContent = '#saveBtn { bottom:calc(76px + env(safe-area-inset-bottom)); right:12px; }'
            + '.scene-io-modal{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s;-webkit-tap-highlight-color:transparent;}'
            + '.scene-io-modal.visible{opacity:1;visibility:visible;}'
            + '.scene-io-box{width:100%;max-width:380px;background:rgba(24,24,24,0.98);border-radius:16px;border:0.5px solid rgba(255,255,255,0.12);padding:16px;display:flex;flex-direction:column;gap:8px;transform:scale(0.95);transition:transform .2s ease;max-height:85vh;overflow:hidden;}'
            + '.scene-io-modal.visible .scene-io-box{transform:scale(1);}'
            + '.scene-io-title{font-size:15px;font-weight:700;color:#fff;text-align:center;padding:6px 0 8px;}'
            + '.scene-io-opt{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background .15s ease;}'
            + '.scene-io-opt:active{background:rgba(255,255,255,0.12);transform:scale(0.98);}'
            + '.scene-io-opt:disabled{opacity:0.6;}'
            + '.scene-io-opt-icon{width:26px;height:26px;flex-shrink:0;}'
            + '.scene-io-cancel{padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;width:100%;transition:background .15s ease;}'
            + '.scene-io-cancel:active{background:rgba(255,255,255,0.12);transform:scale(0.98);}'
            + '.scene-io-input{width:100%;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.06);color:#fff;font-size:16px;outline:none;margin-bottom:8px;user-select:text;-webkit-user-select:text;-webkit-tap-highlight-color:transparent;}'
            + '.scene-io-input:focus{border-color:#30D158;}'
            + '.scene-io-status{min-height:18px;font-size:13px;color:#8E8E93;text-align:center;padding:2px 0;}'
            + '.scene-io-status.busy{color:#FFD60A;}'
            + '.scene-io-status.ok{color:#30D158;}'
            + '.scene-io-list{display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1 1 auto;min-height:0;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;}'
            + '.scene-io-list::-webkit-scrollbar{display:none;}'
            + '.scene-io-item{display:flex;flex-direction:column;gap:2px;padding:12px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;min-height:58px;transition:background .15s ease;}'
            + '.scene-io-item:active{background:rgba(255,255,255,0.12);}'
            + '.scene-io-item.active{background:rgba(48,209,88,0.15);border:0.5px solid rgba(48,209,88,0.6);}'
            + '.scene-io-item.active:active{background:rgba(48,209,88,0.22);}'
            + '.scene-io-item-main{display:flex;align-items:center;justify-content:space-between;gap:10px;}'
            + '.scene-io-item-left{flex:1;min-width:0;}'
            + '.scene-io-item-name{font-size:15px;font-weight:600;word-break:break-all;}'
            + '.scene-io-item-meta{font-size:12px;color:#8E8E93;margin-top:3px;}'
            + '.scene-io-item.active .scene-io-item-meta{color:rgba(48,209,88,0.8);}'
            + '.scene-io-item-btns{display:flex;gap:8px;flex-shrink:0;}'
            + '.scene-io-item-btn{width:44px;height:44px;border:none;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;padding:0;user-select:none;-webkit-user-select:none;transition:background .15s ease;}'
            + '.scene-io-item-btn:active{background:rgba(255,255,255,0.2);transform:scale(0.92);}'
            + '.scene-io-modal-save{z-index:9600;}'
            + '.scene-io-confirm-msg{font-size:14px;color:#fff;text-align:center;padding:4px 8px 12px;line-height:1.4;user-select:none;-webkit-user-select:none;}'
            + '.scene-io-opt.scene-io-danger{background:rgba(255,69,58,0.2);color:#FF453A;}'
            + '.scene-io-opt.scene-io-danger:active{background:rgba(255,69,58,0.3);}';
        document.head.appendChild(css);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
