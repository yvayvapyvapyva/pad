// Сохранение и загрузка состояния сцены в JSON-файл.
//
// Модуль использует глобальные структуры местного редактора (placedMarkers,
// drawnLines, map и т.п.) и переиспользует serializeScene()/restoreScene()
// из pad.html, чтобы не дублировать логику сериализации линий, объектов
// и записанных движений машинок.

(function () {
    if (window.sceneIoInit) return;
    window.sceneIoInit = true;

    // Отдельные карточки машинок могут иметь записанные движения
    // (recplay.js: _samples/_startTrim/_endTrim/_phaseOffset/_signals).
    // serializeScene() уже кладёт их в поле "rec" каждого маркера.

    function collectState() {
        const snap = window.serializeScene ? window.serializeScene() : { lines: [], markers: [] };

        const state = {
            app: 'scene-save',
            version: 1,
            savedAt: new Date().toISOString(),
            camera: {
                center: map ? map.center : null,
                zoom: map ? map.zoom : null,
                azimuth: (map && map.azimuth != null) ? map.azimuth : (typeof mapRot === 'number' ? mapRot : null)
            },
            lines: snap.lines || [],
            markers: snap.markers || []
        };
        return state;
    }

    function downloadJson(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    function saveScene() {
        const state = collectState();
        const stamp = new Date().toISOString().replace(/[:\-T]/g, '').slice(0, 14);
        downloadJson(state, 'scene-' + stamp + '.json');
        closeModal();
    }

    // ---- Загрузка ----
    function parseAndApply(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            alert('Не удалось прочитать файл: некорректный JSON');
            return;
        }
        const lines = Array.isArray(data.lines) ? data.lines : [];
        const markers = Array.isArray(data.markers) ? data.markers : [];
        if (!lines.length && !markers.length) {
            alert('Файл не содержит данных сцены');
            return;
        }

        // Собираем снимок в формате, который понимает restoreScene()
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
        } else {
            alert('Функция загрузки сцены недоступна');
        }

        // Восстанавливаем камеру, если она сохранена
        if (map && data.camera && data.camera.center && data.camera.zoom != null) {
            try {
                const cam = { center: data.camera.center, zoom: data.camera.zoom };
                if (data.camera.azimuth != null) cam.azimuth = data.camera.azimuth;
                map.update({ camera: cam });
            } catch (e) {}
        }
        closeModal();
    }

    function openFilePicker() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) { closeModal(); return; }
            const reader = new FileReader();
            reader.onload = () => parseAndApply(String(reader.result));
            reader.onerror = () => alert('Не удалось прочитать файл');
            reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
        setTimeout(() => { if (input.parentNode) input.parentNode.removeChild(input); }, 1000);
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
        saveBtn.addEventListener('click', saveScene);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'scene-io-opt';
        loadBtn.innerHTML = '<span class="scene-io-opt-icon scene-io-load-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 3h14v2H5v-2z"/></svg></span><span>Загрузить сцену</span>';
        loadBtn.addEventListener('click', openFilePicker);

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
            + '.scene-io-box{width:100%;max-width:340px;background:rgba(24,24,24,0.98);border-radius:16px;border:0.5px solid rgba(255,255,255,0.12);padding:16px;display:flex;flex-direction:column;gap:8px;transform:scale(0.95);transition:transform .2s ease;}'
            + '.scene-io-modal.visible .scene-io-box{transform:scale(1);}'
            + '.scene-io-title{font-size:15px;font-weight:700;color:#fff;text-align:center;padding:6px 0 12px;}'
            + '.scene-io-opt{display:flex;align-items:center;gap:12px;width:100%;padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;}'
            + '.scene-io-opt:active{background:rgba(255,255,255,0.14);}'
            + '.scene-io-opt-icon{width:30px;height:30px;flex-shrink:0;}'
            + '.scene-io-opt-icon.scene-io-load-ico svg{transform:rotate(180deg);}'
            + '.scene-io-cancel{padding:14px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-size:15px;cursor:pointer;touch-action:manipulation;width:100%;}'
            + '.scene-io-cancel:active{background:rgba(255,255,255,0.14);}';
        document.head.appendChild(css);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
