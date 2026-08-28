// Сохранение и загрузка сцен через Яндекс.Облако функцию (YDB, таблица "scene").
//
// Модуль переиспользует serializeScene()/restoreScene() из pad.html, чтобы не
// дублировать логику сериализации линий, объектов и записанных движений машинок.

(function () {
    if (window.sceneIoInit) return;
    window.sceneIoInit = true;

    const API_URL = 'https://functions.yandexcloud.net/d4eurq94s2t0svq2jpu4';

    // Отдельные карточки машинок могут иметь записанные движения
    // (recplay.js: _samples/_startTrim/_endTrim/_phaseOffset/_signals).
    // serializeScene() уже кладёт их в поле "rec" каждого маркера.

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
        let url = API_URL;
        if (query && Object.keys(query).length) {
            const qs = Object.keys(query)
                .filter(k => query[k] != null && query[k] !== '')
                .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
                .join('&');
            if (qs) url += '?' + qs;
        }
        const opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const resp = await fetch(url, opts);
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || json.ok === false) throw new Error(json.error || ('Ошибка ' + resp.status));
        return json;
    }

    // ---- Окно с вариантами ----
    let modal = null;
    function openModal() {
        if (modal) { modal.classList.add('visible'); return; }

        modal = document.createElement('div');
        modal.className = 'scene-io-modal';
        const box = document.createElement('div');
        box.className = 'scene-io-box';

        const title = document.createElement('div');
        title.className = 'scene-io-title';
        title.textContent = 'Сцена';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'scene-io-opt';
        saveBtn.innerHTML = '<span class="scene-io-opt-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Сохранить сцену</span>';
        saveBtn.addEventListener('click', openSaveModal);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'scene-io-opt';
        loadBtn.innerHTML = '<span class="scene-io-opt-icon scene-io-load-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Загрузить сцену</span>';
        loadBtn.addEventListener('click', openLoadList);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'scene-io-cancel';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('click', closeModal);

        box.appendChild(title);
        box.appendChild(saveBtn);
        box.appendChild(loadBtn);
        box.appendChild(cancelBtn);
        modal.appendChild(box);
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
        document.body.appendChild(modal);
        modal.classList.add('visible');
    }

    function closeModal() {
        if (modal) modal.classList.remove('visible');
    }

    function closeM(el) {
        el.classList.remove('visible');
        setTimeout(() => el.remove(), 200);
    }

    // ---- Сохранение ----
    function openSaveModal() {
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'scene-io-input';
        nameInput.value = defaultName();
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

        const subModal = document.createElement('div');
        subModal.className = 'scene-io-modal scene-io-modal-save';
        const subBox = document.createElement('div');
        subBox.className = 'scene-io-box';
        const subTitle = document.createElement('div');
        subTitle.className = 'scene-io-title';
        subTitle.textContent = 'Сохранить сцену';
        subBox.appendChild(subTitle);
        subBox.appendChild(nameInput);
        subBox.appendChild(confirm);
        subBox.appendChild(status);
        subBox.appendChild(cancel);
        subModal.appendChild(subBox);
        subModal.addEventListener('click', e => { if (e.target === subModal) closeM(subModal); });
        document.body.appendChild(subModal);
        requestAnimationFrame(() => {
            subModal.classList.add('visible');
            nameInput.focus();
            nameInput.select();
        });

        confirm.addEventListener('click', async () => {
            const base = sanitizeName(nameInput.value) || defaultName();
            confirm.disabled = true;
            status.textContent = 'Сохранение…';
            status.classList.add('busy');
            try {
                await api('POST', { body: { name: base, data: collectState() } });
                status.textContent = 'Сохранено ✓';
                status.classList.remove('busy');
                status.classList.add('ok');
                closeModal();
                setTimeout(() => closeM(subModal), 500);
            } catch (e) {
                status.textContent = 'Ошибка: ' + e.message;
                status.classList.remove('busy');
                confirm.disabled = false;
            }
        });
        cancel.addEventListener('click', () => closeM(subModal));
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirm.click(); }
        });
    }

    // ---- Загрузка ----
    function applyScene(data) {
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
                    // Центр/масштаб задаются через location, поворот — через camera
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
    }

    function openLoadList() {
        const listModal = document.createElement('div');
        listModal.className = 'scene-io-modal scene-io-modal-save';
        const listBox = document.createElement('div');
        listBox.className = 'scene-io-box';
        const listTitle = document.createElement('div');
        listTitle.className = 'scene-io-title';
        listTitle.textContent = 'Загрузить сцену';

        const listBody = document.createElement('div');
        listBody.className = 'scene-io-list';

        const status = document.createElement('div');
        status.className = 'scene-io-status busy';
        status.textContent = 'Загрузка списка…';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'scene-io-cancel';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('click', () => closeM(listModal));

        listBox.appendChild(listTitle);
        listBox.appendChild(listBody);
        listBox.appendChild(status);
        listBox.appendChild(cancelBtn);
        listModal.appendChild(listBox);
        listModal.addEventListener('click', e => { if (e.target === listModal) closeM(listModal); });
        document.body.appendChild(listModal);
        requestAnimationFrame(() => listModal.classList.add('visible'));

        (async () => {
            try {
                const json = await api('GET', {});
                const scenes = (json.scenes || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
                status.classList.remove('busy');
                status.textContent = scenes.length ? '' : 'Сохранённых сцен нет';
                scenes.forEach(s => {
                    const row = document.createElement('button');
                    row.className = 'scene-io-item';
                    const nm = document.createElement('div');
                    nm.className = 'scene-io-item-name';
                    nm.textContent = s.name;
                    row.appendChild(nm);
                    if (s.savedAt) {
                        const dt = document.createElement('div');
                        dt.className = 'scene-io-item-date';
                        dt.textContent = new Date(s.savedAt).toLocaleString();
                        row.appendChild(dt);
                    }
                    row.addEventListener('click', async () => {
                        status.textContent = 'Загрузка…';
                        status.classList.add('busy');
                        try {
                            const got = await api('GET', { query: { name: s.name } });
                            let data = got.data;
                            if (typeof data === 'string') data = JSON.parse(data);
                            status.classList.remove('busy');
                            status.textContent = '';
                            applyScene(data || got);
                            closeModal();
                            closeM(listModal);
                        } catch (e) {
                            status.classList.remove('busy');
                            status.textContent = 'Ошибка: ' + e.message;
                        }
                    });
                    listBody.appendChild(row);
                });
            } catch (e) {
                status.classList.remove('busy');
                status.textContent = 'Ошибка: ' + e.message;
            }
        })();
    }

    // ---- Кнопка ----
    function init() {
        const btn = document.createElement('button');
        btn.id = 'saveBtn';
        btn.className = 'fab';
        btn.title = 'Сцена: сохранить / загрузить';
        btn.setAttribute('aria-label', 'Сцена: сохранить / загрузить');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v5h12V4H6zm3 0v3h6V4H9zM6 13v5h12v-5H6z"/></svg>';
        btn.addEventListener('click', openModal);
        document.body.appendChild(btn);

        const css = document.createElement('style');
        css.textContent = '#saveBtn { bottom:calc(76px + env(safe-area-inset-bottom)); right:12px; }'
            + '.scene-io-modal{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s;}'
            + '.scene-io-modal.visible{opacity:1;visibility:visible;}'
            + '.scene-io-box{width:100%;max-width:340px;background:rgba(24,24,24,0.98);border-radius:16px;border:0.5px solid rgba(255,255,255,0.12);padding:16px;display:flex;flex-direction:column;gap:8px;transform:scale(0.95);transition:transform .2s ease;max-height:80vh;}'
            + '.scene-io-modal.visible .scene-io-box{transform:scale(1);}'
            + '.scene-io-title{font-size:15px;font-weight:700;color:#fff;text-align:center;padding:6px 0 12px;}'
            + '.scene-io-opt{display:flex;align-items:center;gap:12px;width:100%;padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;}'
            + '.scene-io-opt:active{background:rgba(255,255,255,0.14);}'
            + '.scene-io-opt:disabled{opacity:0.6;}'
            + '.scene-io-opt-icon{width:30px;height:30px;flex-shrink:0;}'
            + '.scene-io-opt-icon.scene-io-load-ico svg{transform:rotate(180deg);}'
            + '.scene-io-cancel{padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;width:100%;}'
            + '.scene-io-cancel:active{background:rgba(255,255,255,0.14);}'
            + '.scene-io-input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.06);color:#fff;font-size:15px;outline:none;margin-bottom:8px;user-select:text;-webkit-user-select:text;}'
            + '.scene-io-input:focus{border-color:#30D158;}'
            + '.scene-io-status{min-height:18px;font-size:13px;color:#8E8E93;text-align:center;padding:2px 0;}'
            + '.scene-io-status.busy{color:#FFD60A;}'
            + '.scene-io-status.ok{color:#30D158;}'
            + '.scene-io-list{display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:50vh;}'
            + '.scene-io-item{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;padding:12px 14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;touch-action:manipulation;}'
            + '.scene-io-item:active{background:rgba(255,255,255,0.14);}'
            + '.scene-io-item-name{font-size:14px;font-weight:600;word-break:break-all;}'
            + '.scene-io-item-date{font-size:12px;color:#8E8E93;}'
            + '.scene-io-modal-save{z-index:9600;}';
        document.head.appendChild(css);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
