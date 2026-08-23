// Модуль светофоров. Подключается ПОСЛЕ inline-скрипта pad.html (перед </body>).
// Создаёт кнопку над кнопкой знаков, галерею светофоров (стандартный, с боковыми
// секциями стрелками влево/вправо), размещение на карте и управление сигналами
// по долгому нажатию. Лампочки изначально не горят; боковую секцию можно включать
// одновременно с любым основным сигналом.
// Использует глобальные функции/переменные pad.html: startPicDrag, placePic,
// updatePicMarker, removeMarker, setPanel, anyPanelOpen, map, placedMarkers,
// mapRot, appBehaviors, drawMode, eraserMode.

(function () {
    if (window.__trafficLightsLoaded) return;
    window.__trafficLightsLoaded = true;

    // Размер светофора по умолчанию в пикселях (fallback до первого расчёта масштаба)
    window.TL_PX_SIZE = 100;

    // Высота светофора на карте в метрах — масштабируется вместе с картой
    const TL_HEIGHT_M = 10;

    // Типы светофоров в галерее
    const TL_FILES = ['standart', 'arrow-left', 'arrow-right'];
    const TL_LABELS = { 'standart': 'Обычный', 'arrow-left': 'Стрелка влево', 'arrow-right': 'Стрелка вправо' };

    // Базовая высота .tl в CSS (px) — на карте масштабируется к TL_PX_SIZE
    const TL_BASE_H = 64;

    // ---- CSS ----
    const style = document.createElement('style');
    style.textContent = `
        #addTlBtn {
            bottom:calc(140px + env(safe-area-inset-bottom)); left:12px;
            box-sizing:border-box; padding:0; margin:0; -webkit-appearance:none; appearance:none;
            border-radius:12px; overflow:hidden;
            transition:bottom .25s ease;
        }
        #tlPanel {
            position:fixed; bottom:calc(12px + env(safe-area-inset-bottom)); left:76px;
            z-index:9005; width:max-content; max-width:calc(100vw - 88px);
            background:rgba(15,15,15,0.82); border:0.5px solid rgba(255,255,255,0.12); border-radius:16px;
            padding:10px; height:auto; max-height:210px; overflow-y:auto; overflow-x:hidden; display:none;
            box-shadow:0 20px 60px rgba(0,0,0,0.4); transition:bottom .25s ease;
        }
        #tlPanel.visible { display:block; }
        #tlGrid { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
        #tlGrid .pic-item { min-width:70px; flex-direction:column; gap:4px; }
        .tl-caption { font-size:10px; color:rgba(255,255,255,0.6); text-align:center; line-height:1.1; }

        .tl { position:relative; width:22px; height:64px; }
        .tl-body {
            position:absolute; inset:0; background:#202020; border:1.5px solid #4a4a4a;
            border-radius:6px; display:flex; flex-direction:column; align-items:center;
            box-shadow:inset 0 0 6px rgba(0,0,0,0.6);
        }
        .tl-lamp { position:absolute; left:50%; transform:translateX(-50%); width:14px; height:14px; border-radius:50%; background:#111; outline:1px solid #4a4a4a; outline-offset:0; }
        .tl-lamp.tl-red { top:6px; }
        .tl-lamp.tl-yellow { top:25px; }
        .tl-lamp.tl-green { top:44px; }
        .tl-lamp.on.tl-red { background:#ff3b30; box-shadow:0 0 8px 3px rgba(255,59,48,0.85); }
        .tl-lamp.on.tl-yellow { background:#ffcc00; box-shadow:0 0 8px 3px rgba(255,204,0,0.85); }
        .tl-lamp.on.tl-green { background:#30d158; box-shadow:0 0 8px 3px rgba(48,209,88,0.85); }
        .tl-side {
            position:absolute; bottom:0;
            width:22px; height:22px; background:#202020; border:1.5px solid #4a4a4a;
            border-radius:6px; display:flex; align-items:center; justify-content:center;
        }
        .tl-side-left { right:100%; }
        .tl-side-right { left:100%; }
        .tl-arrow { display:block; color:#111; }
        .tl-arrow.on { color:#30d158; filter:drop-shadow(0 0 3px rgba(48,209,88,0.9)); }
        .panel-open .tl-lamp, .panel-open .tl-side {
            outline:1px solid rgba(255,255,255,0.4); outline-offset:0; cursor:pointer;
        }

        .tl-ctrl {
            position:absolute; top:calc(100% + ${(window.TL_PX_SIZE - TL_BASE_H) / 2 + 8}px); left:50%; transform:translateX(-50%);
            display:none; flex-direction:row; gap:6px; padding:6px; z-index:6;
            background:rgba(15,15,15,0.95); border:0.5px solid rgba(255,255,255,0.15);
            border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.55); white-space:nowrap;
        }
        .panel-open .tl-ctrl { display:flex; }
        .tl-btn {
            min-width:40px; height:38px; padding:0 8px; border-radius:8px;
            border:0.5px solid rgba(255,255,255,0.18);
            background:rgba(255,255,255,0.08); color:#fff; font-size:11px; font-weight:600;
            display:flex; align-items:center; justify-content:center; cursor:pointer;
            touch-action:manipulation;
        }
        .tl-btn:active { background:rgba(255,255,255,0.2); }
        .tl-btn[data-color=red].on { background:rgba(255,59,48,0.95); border-color:#ff3b30; }
        .tl-btn[data-color=yellow].on { background:rgba(255,204,0,0.95); border-color:#ffcc00; color:#000; }
        .tl-btn[data-color=green].on, .tl-btn[data-color=arrow].on { background:rgba(48,209,88,0.95); border-color:#30d158; }
        .tl-btn-del { background:rgba(255,69,58,0.9); }
    `;
    document.head.appendChild(style);

    // ---- Кнопка ----
    const addTlBtn = document.createElement('button');
    addTlBtn.id = 'addTlBtn';
    addTlBtn.className = 'fab';
    addTlBtn.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40"><rect x="8.5" y="1.5" width="7" height="21" rx="2" fill="#333" stroke="#fff" stroke-width="1.2"/><circle cx="12" cy="6" r="2" fill="#ff3b30"/><circle cx="12" cy="12" r="2" fill="#ffcc00"/><circle cx="12" cy="18" r="2" fill="#30d158"/></svg>';
    document.body.appendChild(addTlBtn);

    // ---- Панель галереи ----
    const tlPanel = document.createElement('div');
    tlPanel.id = 'tlPanel';
    tlPanel.innerHTML = '<div id="tlGrid"></div>';
    document.body.appendChild(tlPanel);

    // ---- Построение светофора ----
    function makeSide(side) {
        const s = document.createElement('div');
        s.className = 'tl-side tl-side-' + side;
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 22 10');
        svg.setAttribute('width', '22');
        svg.setAttribute('height', '10');
        svg.setAttribute('class', 'tl-arrow tl-arrow-' + side);
        const shaft = document.createElementNS(ns, 'rect');
        const head = document.createElementNS(ns, 'polygon');
        if (side === 'left') {
            shaft.setAttribute('x', '11'); shaft.setAttribute('y', '3');
            shaft.setAttribute('width', '7'); shaft.setAttribute('height', '4');
            head.setAttribute('points', '11,1 4,5 11,9');
        } else {
            shaft.setAttribute('x', '4'); shaft.setAttribute('y', '3');
            shaft.setAttribute('width', '7'); shaft.setAttribute('height', '4');
            head.setAttribute('points', '11,1 18,5 11,9');
        }
        shaft.setAttribute('fill', 'currentColor');
        head.setAttribute('fill', 'currentColor');
        svg.appendChild(shaft);
        svg.appendChild(head);
        s.appendChild(svg);
        return s;
    }

    function createTlDom(type) {
        const tl = document.createElement('div');
        tl.className = 'tl';
        const body = document.createElement('div');
        body.className = 'tl-body';
        ['red', 'yellow', 'green'].forEach(c => {
            const l = document.createElement('div');
            l.className = 'tl-lamp tl-' + c;
            body.appendChild(l);
        });
        tl.appendChild(body);
        if (type === 'arrow-left') tl.appendChild(makeSide('left'));
        else if (type === 'arrow-right') tl.appendChild(makeSide('right'));
        return tl;
    }

    // ---- Галерея ----
    window.buildTlGrid = function () {
        const grid = document.getElementById('tlGrid');
        if (!grid) return;
        grid.innerHTML = '';
        TL_FILES.forEach(file => {
            const cell = document.createElement('div');
            cell.className = 'pic-item';
            cell.dataset.file = file;
            cell.dataset.type = 'tl';
            cell.appendChild(createTlDom(file));
            // в галерее светофор показан с включённым зелёным
            cell.querySelector('.tl-lamp.tl-green').classList.add('on');
            const cap = document.createElement('div');
            cap.className = 'tl-caption';
            cap.textContent = TL_LABELS[file] || file;
            cell.appendChild(cap);
            cell.addEventListener('pointerdown', e => startPicDrag(cell, e));
            cell.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
            grid.appendChild(cell);
        });
    };

    // ---- Призрак при перетаскивании ----
    window.tlGhostSrc = function (type) {
        const hasL = type === 'arrow-left';
        const hasR = type === 'arrow-right';
        const W = (hasL || hasR) ? 66 : 22;
        const bodyX = hasL ? 22 : (hasR ? 22 : 0);
        const sideX = hasL ? 0 : 44;
        const p = [];
        p.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' 64">');
        p.push('<rect x="' + bodyX + '" y="0" width="22" height="64" rx="6" fill="#202020" stroke="#4a4a4a" stroke-width="1.5"/>');
        const lampX = bodyX + 11;
        // лампы: красный/жёлтый не горят, зелёный включён — как в галерее
        [[lampX, 13, '#111'], [lampX, 32, '#111'], [lampX, 51, '#30d158']].forEach(c => {
            p.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="7.5" fill="none" stroke="#4a4a4a" stroke-width="1"/>');
            p.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="7" fill="' + c[2] + '"/>');
        });
        if (hasL) {
            p.push('<rect x="' + sideX + '" y="42" width="22" height="22" rx="6" fill="#202020" stroke="#4a4a4a" stroke-width="1.5"/>');
            p.push('<rect x="' + (sideX + 11) + '" y="51" width="7" height="4" fill="#111"/>');
            p.push('<polygon points="' + (sideX + 11) + ',49 ' + (sideX + 4) + ',53 ' + (sideX + 11) + ',57" fill="#111"/>');
        }
        if (hasR) {
            p.push('<rect x="' + sideX + '" y="42" width="22" height="22" rx="6" fill="#202020" stroke="#4a4a4a" stroke-width="1.5"/>');
            p.push('<rect x="' + (sideX + 4) + '" y="51" width="7" height="4" fill="#111"/>');
            p.push('<polygon points="' + (sideX + 11) + ',49 ' + (sideX + 18) + ',53 ' + (sideX + 11) + ',57" fill="#111"/>');
        }
        p.push('</svg>');
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p.join(''));
    };

    // ---- Управление сигналами ----
    function applyLamp(marker, key, on) {
        marker._lampState[key] = on;
        const lamp = marker._tlRoot.querySelector('.tl-lamp.tl-' + key);
        if (lamp) lamp.classList.toggle('on', on);
        const arrow = marker._tlRoot.querySelector('.tl-arrow.tl-arrow-' + key);
        if (arrow) arrow.classList.toggle('on', on);
        const btn = marker._ctrl ? marker._ctrl.querySelector('.tl-btn[data-key="' + key + '"]') : null;
        if (btn) btn.classList.toggle('on', on);
    }

    // Основной сигнал может гореть только один: включение гасит остальные
    function setLamp(marker, key, on) {
        const MAIN = ['red', 'yellow', 'green'];
        if (on && MAIN.indexOf(key) !== -1) {
            MAIN.forEach(k => { if (k !== key && marker._lampState[k]) applyLamp(marker, k, false); });
        }
        applyLamp(marker, key, on);
    }
    // Доступ из pad.html: мини-светофор в панели активного светофора
    window.tlSetLamp = setLamp;

    function makeCtrl(marker) {
        const ctrl = document.createElement('div');
        ctrl.className = 'tl-ctrl';
        const del = document.createElement('button');
        del.className = 'tl-btn tl-btn-del';
        del.textContent = '✕';
        del.dataset.key = 'del';
        del.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            removeMarker(marker);
        });
        ctrl.appendChild(del);
        marker._ctrl = ctrl;
        return ctrl;
    }

    window.setTlPanel = function (marker, open) {
        marker._panelOpen = open;
        if (!marker._ctrl) {
            marker._rotWrap.appendChild(makeCtrl(marker));
            if (marker._tlPx) marker._ctrl.style.top = 'calc(100% + ' + ((marker._tlPx - TL_BASE_H) / 2 + 8) + 'px)';
        }
        marker._rotWrap.classList.toggle('panel-open', open);
        marker.update({ draggable: !(open || drawMode || eraserMode) });
        map.update({ behaviors: anyPanelOpen() ? [] : appBehaviors });
    };

    function setupTlLongPress(marker) {
        const el = marker._select;
        el.addEventListener('pointerdown', e => {
            if (drawMode || eraserMode) return;
            if (e.target.closest && e.target.closest('.tl-ctrl')) return;
            const lpId = e.pointerId;
            const sx = e.clientX, sy = e.clientY;
            let timer = null;
            const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
            const onMove = ev => {
                if (ev.pointerId !== lpId) return;
                if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) clearTimer();
            };
            const end = ev => {
                if (ev.pointerId !== lpId) return;
                clearTimer();
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', end);
                window.removeEventListener('pointercancel', end);
            };
            timer = setTimeout(() => { timer = null; window.setTlPanel(marker, !marker._panelOpen); }, 500);
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
        });
    }

    // Включение сигналов нажатием на лампы (работает в режиме управления)
    function setupLampTaps(marker) {
        marker._tlRoot.querySelectorAll('.tl-lamp, .tl-side').forEach(el => {
            el.addEventListener('pointerdown', e => {
                if (!marker._panelOpen) return;
                e.preventDefault();
                e.stopPropagation();
                let key;
                if (el.classList.contains('tl-lamp')) {
                    key = el.classList.contains('tl-red') ? 'red'
                        : el.classList.contains('tl-yellow') ? 'yellow' : 'green';
                } else {
                    key = el.classList.contains('tl-side-left') ? 'left' : 'right';
                }
                setLamp(marker, key, !marker._lampState[key]);
            });
        });
    }

    // ---- Размещение на карте ----
    window.placeTlMarker = function (lat, lon, moveAngle, file) {
        const type = file || 'standart';
        const el = document.createElement('div');
        el.className = 'pic-marker';
        el.style.cssText = 'transform:translate(-50%,-50%);cursor:grab;';
        const wrap = document.createElement('div');
        wrap.className = 'rot-wrap';
        wrap.style.transform = 'translate(-50%,-50%)';
        const tl = createTlDom(type);
        wrap.appendChild(tl);
        el.appendChild(wrap);
        const marker = new ymaps3.YMapMarker({
            coordinates: [lon, lat],
            draggable: true,
        onDragMove: (coords) => {
            marker._lat = coords[1];
            marker._lon = coords[0];
            updatePicMarker(marker);
        },
        onDragEnd: () => { if (window.commit) window.commit(); }
        }, el);
        marker._isTl = true;
        marker._tlRoot = tl;
        marker._rotWrap = wrap;
        marker._select = el;
        marker._tlType = type;
        marker._lampState = { red: false, yellow: false, green: true, left: false, right: false };
        tl.querySelector('.tl-lamp.tl-green').classList.add('on'); // зелёный включён по умолчанию
        marker._heading = (moveAngle != null) ? moveAngle * 180 / Math.PI + 90 - mapRot : -mapRot;
        marker._lat = lat;
        marker._lon = lon;
        if (window.setupTopDrag) setupTopDrag(marker);
        setupTlLongPress(marker);
        setupLampTaps(marker);
        updatePicMarker(marker);
        map.addChild(marker);
        placedMarkers.push(marker);
        if (window.commit) window.commit();
    };

    // ---- Обновление на карте (вызывается из updatePicMarker) ----
    window.updateTlMarker = function (marker) {
        if (!marker || !marker._tlRoot) return;
        marker._rotWrap.style.transform = 'translate(-50%,-50%) rotate(' + (marker._heading + mapRot) + 'deg)';
        // Динамический размер: высота светофора = TL_HEIGHT_M метров на местности,
        // но не мельче 20px (иначе не ухватить) и не крупнее 100px
        let pxH = window.TL_PX_SIZE;
        if (window.metersPerPixel && marker._lat != null && isFinite(marker._lat)) {
            const mpp = window.metersPerPixel(marker._lat);
            if (mpp > 0) pxH = Math.min(100, Math.max(20, TL_HEIGHT_M / mpp));
        }
        marker._tlPx = pxH;
        marker._tlScale = pxH / TL_BASE_H; // для расчёта границы в setupTopDrag
        marker._tlRoot.style.transform = 'scale(' + marker._tlScale + ')';
        // Панель управления привязана к низу видимого корпуса
        if (marker._ctrl) marker._ctrl.style.top = 'calc(100% + ' + ((pxH - TL_BASE_H) / 2 + 8) + 'px)';
    };

    // ---- Инициализация ----
    window.buildTlGrid();
})();
