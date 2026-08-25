// Модуль глобальной записи и циклического воспроизведения движения машинок.
// Подключается ПОСЛЕ основного inline-скрипта pad.html (перед </body>).
// Не меняет основной код.
// Как работает:
//  - кнопка REC (справа внизу): включает режим записи; пока она активна, движение
//    ЛЮБОЙ перетаскиваемой машинки записывается в её собственные сэмплы. Повторное
//    нажатие останавливает запись. Записи машинок НЕ стираются при новом включении
//    REC — можно последовательно записать несколько машинок, а затем запустить все
//    записи одновременно. Тронутая, но не сдвинутая машинка сохраняет старую запись;
//  - кнопка PLAY (справа от REC): запускает все существующие записи синхронно.
//    Внутри одной сессии машинка, начавшая движение позже, «держит» стартовую
//    позицию до момента своего старта; короткие записи держат финальную позицию до
//    конца самой длинной, после чего сценарий повторяется;
//  - запись ВО ВРЕМЯ воспроизведения: если нажать REC, пока PLAY идёт, воспроизведение
//    НЕ останавливается — можно взять новую (не играющую) машинку и записать её
//    движение, подстроившись под цикл. Запись привязывается к фазе цикла, в которой
//    она началась: при запуске всех записей такая машинка «ждёт» своей фазы, а затем
//    движется синхронно с остальными. По окончании записи новая машинка сразу
//    включается в текущее воспроизведение.

(function () {
    if (window.__recPlayLoaded) return;
    window.__recPlayLoaded = true;

    // ---- CSS ----
    const style = document.createElement('style');
    style.textContent = `
        #recAllBtn, #playAllBtn {
            position:fixed; z-index:9005; width:52px; height:52px; border-radius:50%;
            border:0.5px solid rgba(255,255,255,0.12); color:#fff;
            display:flex; align-items:center; justify-content:center; cursor:pointer;
            box-shadow:0 8px 32px rgba(0,0,0,0.3); font-size:13px; font-weight:700; letter-spacing:0.5px; line-height:1; touch-action:manipulation;
        }
        #recAllBtn { right:12px; top:calc(140px + env(safe-area-inset-top) + var(--tg-top, 0px)); background:rgba(255,69,58,0.75); }
        #recAllBtn.active { animation:recPulse 1s ease-in-out infinite; }
        #playAllBtn { right:12px; top:calc(204px + env(safe-area-inset-top) + var(--tg-top, 0px)); background:rgba(48,209,88,0.75); display:none; }
        #playAllBtn.active { background:rgba(255,69,58,0.75); animation:recPulse 1s ease-in-out infinite; }
        #recAllBtn:active, #playAllBtn:active { transform:scale(0.92); }
        @keyframes recPulse { 50% { opacity:0.5; } }
        #scrubModal {
            position:fixed; left:0; right:0; bottom:0; max-height:85vh; z-index:9100;
            background:rgba(15,15,15,0.97); color:#fff;
            display:flex; flex-direction:column;
            border-radius:16px 16px 0 0; border-top:0.5px solid rgba(255,255,255,0.12);
            box-shadow:0 -8px 32px rgba(0,0,0,0.4);
            padding-bottom:env(safe-area-inset-bottom);
            transform:translateY(105%); visibility:hidden;
            transition:transform .3s ease, visibility .3s;
        }
        #scrubModal.visible { transform:translateY(0); visibility:visible; }
        .scrub-header {
            display:flex; align-items:center; gap:8px;
            padding:8px 10px; border-bottom:0.5px solid rgba(255,255,255,0.12); flex-shrink:0;
        }
        #scrubTitle { font-size:15px; font-weight:600; flex:1; text-align:center; }
        .scrub-close {
            width:30px; height:30px; border-radius:50%; border:0.5px solid rgba(255,255,255,0.12);
            background:rgba(255,255,255,0.06); color:#fff; font-size:15px; cursor:pointer;
            display:flex; align-items:center; justify-content:center; touch-action:manipulation; flex-shrink:0;
        }
        .scrub-close:active { background:rgba(255,255,255,0.15); }
        #scrubBody { flex:1; min-height:0; overflow-y:auto; padding:10px 12px 32px; -webkit-overflow-scrolling:touch; }
        .scrub-row {
            display:flex; align-items:center; gap:6px; padding:10px 8px;
            border-bottom:0.5px solid rgba(255,255,255,0.08);
        }
        .scrub-thumb {
            width:36px; height:36px; object-fit:contain; flex-shrink:0; pointer-events:none;
        }
        .scrub-del-btn {
            width:26px; height:26px; border-radius:50%; flex-shrink:0;
            background:rgba(255,69,58,0.9); border:0.5px solid rgba(255,255,255,0.2);
            color:#fff; font-size:14px; line-height:1;
            display:flex; align-items:center; justify-content:center; cursor:pointer; touch-action:manipulation;
        }
        .scrub-del-btn:active { background:rgba(255,69,58,1); }
        #scrubConfirm {
            position:fixed; inset:0; z-index:9300; display:flex; align-items:center; justify-content:center;
            background:rgba(0,0,0,0.45); opacity:0; visibility:hidden; transition:opacity .2s ease, visibility .2s;
        }
        #scrubConfirm.visible { opacity:1; visibility:visible; }
        .scrub-confirm-box {
            width:min(300px, 80vw); background:rgba(15,15,15,0.98); border:0.5px solid rgba(255,255,255,0.12);
            border-radius:16px; padding:16px; text-align:center;
            box-shadow:0 16px 48px rgba(0,0,0,0.5);
        }
        .scrub-confirm-btns { display:flex; flex-direction:column; gap:8px; }
        .scrub-confirm-btns .scrub-confirm-btn {
            height:44px; border-radius:12px; border:0.5px solid rgba(255,255,255,0.12);
            background:rgba(255,255,255,0.08); color:#fff; font-size:16px; font-weight:600;
            cursor:pointer; display:flex; align-items:center; justify-content:center; touch-action:manipulation;
        }
        .scrub-confirm-btns .scrub-confirm-btn:active { background:rgba(255,255,255,0.15); }
        .scrub-confirm-btns .scrub-confirm-yes { background:rgba(255,69,58,0.9); border-color:transparent; }
        .scrub-time { flex-shrink:0; width:64px; font-size:11px; font-weight:600; font-variant-numeric:tabular-nums; }
        .scrub-dual { position:relative; flex:1; min-width:0; height:22px; touch-action:manipulation; }
        .scrub-dual::before {
            content:''; position:absolute; left:0; right:0; top:50%; height:5px; transform:translateY(-50%);
            border-radius:3px; background:rgba(255,255,255,0.18);
        }
        .scrub-active {
            position:absolute; top:50%; height:5px; transform:translateY(-50%);
            background:#30D158; border-radius:3px; pointer-events:none;
        }
        .scrub-dual .scrub-range {
            position:absolute; inset:0; width:100%; margin:0; flex:none;
            -webkit-appearance:none; appearance:none; background:transparent; pointer-events:none;
        }
        .scrub-dual .scrub-range::-webkit-slider-runnable-track { background:transparent; height:5px; }
        .scrub-dual .scrub-range::-webkit-slider-thumb {
            -webkit-appearance:none; appearance:none; width:16px; height:16px; border-radius:50%;
            border:none; margin-top:-5.5px; box-shadow:0 2px 6px rgba(0,0,0,0.5); pointer-events:auto;
        }
        .scrub-start::-webkit-slider-thumb { background:#FF453A; }
        .scrub-end::-webkit-slider-thumb { background:#FFD60A; }
        .scrub-dual .scrub-range::-moz-range-track { background:transparent; height:5px; }
        .scrub-dual .scrub-range::-moz-range-thumb {
            pointer-events:auto; width:16px; height:16px; border:none; border-radius:50%; box-shadow:0 2px 6px rgba(0,0,0,0.5);
        }
        .scrub-start::-moz-range-thumb { background:#FF453A; }
        .scrub-end::-moz-range-thumb { background:#FFD60A; }
        .scrub-empty { padding:24px 12px; font-size:15px; color:rgba(255,255,255,0.55); text-align:center; }
        .scrub-row { flex-wrap:wrap; }
        .scrub-arrow {
            width:22px; height:22px; border-radius:50%; flex-shrink:0;
            background:rgba(255,255,255,0.1); border:0.5px solid rgba(255,255,255,0.15);
            color:rgba(255,255,255,0.8); font-size:11px; line-height:1;
            display:flex; align-items:center; justify-content:center; cursor:pointer; touch-action:manipulation;
            transition:transform .2s ease;
        }
        .scrub-arrow.open { transform:rotate(180deg); background:rgba(255,204,0,0.22); border-color:#FFCC00; color:#FFCC00; }
        .scrub-sigsec { flex:0 0 100%; display:none; padding-top:6px; }
        .scrub-sigsec.open { display:block; }
        .scrub-sigline { display:flex; align-items:center; gap:6px; padding:3px 0; }
        .scrub-siglabel { flex-shrink:0; width:16px; text-align:center; font-size:14px; color:#FFCC00; }
        .scrub-siglabel.right { color:#0A84FF; }
        .scrub-sigtrack {
            position:relative; flex:1; min-width:0; height:26px; border-radius:6px;
            background:rgba(255,255,255,0.08); cursor:crosshair; touch-action:none; overflow:hidden;
        }
        .sig-seg { position:absolute; top:2px; bottom:2px; border-radius:4px; opacity:0.9; touch-action:none; }
        .sig-seg.sig-seg-left { background:#FFCC00; }
        .sig-seg.sig-seg-right { background:#0A84FF; }
        .sig-seg.sig-draw { opacity:0.45; }
        .sig-h {
            position:absolute; top:0; bottom:0; width:10px; background:rgba(255,255,255,0.9);
            cursor:ew-resize; touch-action:none; z-index:1;
        }
        .sig-h.sig-h-s { left:0; border-radius:4px 0 0 4px; }
        .sig-h.sig-h-e { right:0; border-radius:0 4px 4px 0; }
        .sig-del {
            position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:14px; height:14px;
            border-radius:50%; background:rgba(255,69,58,0.95); color:#fff; font-size:9px; line-height:1;
            display:flex; align-items:center; justify-content:center; cursor:pointer; touch-action:none; z-index:2;
        }
    `;
    document.head.appendChild(style);

    // SVG-иконки кнопки PLAY/STOP
    const ICON_PLAY = '<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M7.5 4.2v15.6L20.5 12z"/></svg>';
    const ICON_STOP = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';

    const recAllBtn = document.createElement('div');
    recAllBtn.id = 'recAllBtn';
    recAllBtn.innerHTML = 'REC';
    document.body.appendChild(recAllBtn);

    const playAllBtn = document.createElement('div');
    playAllBtn.id = 'playAllBtn';
    playAllBtn.innerHTML = ICON_PLAY;
    document.body.appendChild(playAllBtn);

    // ---- Состояние ----
    let _recOn = false;          // глобальная запись активна
    let _recRaf = null;          // rAF сэмплирования
    let _recStart = 0;           // старт сессии записи (обычный режим)
    let _playAll = false;        // глобальное воспроизведение активно
    let _masterRaf = null;
    let _masterStart = 0;
    let _maxDur = 1;
    let _scrubOpen = false;
    let _scrubTimer = null;
    let _suppressClick = false;
    let _confirmMarker = null;

    const scrubModal = document.createElement('div');
    scrubModal.id = 'scrubModal';
    const scrubHeader = document.createElement('div');
    scrubHeader.className = 'scrub-header';
    const scrubTitle = document.createElement('div');
    scrubTitle.id = 'scrubTitle';
    scrubTitle.textContent = 'Записи';
    const scrubClose = document.createElement('div');
    scrubClose.className = 'scrub-close';
    scrubClose.textContent = '✕';
    scrubHeader.appendChild(scrubTitle);
    scrubHeader.appendChild(scrubClose);
    const scrubBody = document.createElement('div');
    scrubBody.id = 'scrubBody';
    scrubModal.appendChild(scrubHeader);
    scrubModal.appendChild(scrubBody);
    document.body.appendChild(scrubModal);
    const confirmModal = document.createElement('div');
    confirmModal.id = 'scrubConfirm';
    const confirmBox = document.createElement('div');
    confirmBox.className = 'scrub-confirm-box';
    const confirmBtns = document.createElement('div');
    confirmBtns.className = 'scrub-confirm-btns';
    const confirmYes = document.createElement('div');
    confirmYes.className = 'scrub-confirm-btn scrub-confirm-yes';
    confirmYes.textContent = 'Удалить';
    const confirmNo = document.createElement('div');
    confirmNo.className = 'scrub-confirm-btn';
    confirmNo.textContent = 'Отмена';
    confirmBtns.appendChild(confirmYes);
    confirmBtns.appendChild(confirmNo);
    confirmBox.appendChild(confirmBtns);
    confirmModal.appendChild(confirmBox);
    document.body.appendChild(confirmModal);

    // ---- Утилиты ----
    function lerpAngle(a, b, t) {
        let d = ((b - a + 180) % 360 + 360) % 360 - 180;
        return a + d * t;
    }

    function hasMovement(m) {
        const s = m._samples;
        if (!s || s.length < 2) return false;
        const p = s[0];
        return s.some(x =>
            Math.abs(x.lat - p.lat) > 1e-9 ||
            Math.abs(x.lon - p.lon) > 1e-9 ||
            Math.abs(x.heading - p.heading) > 1e-6
        );
    }

    function playables() {
        return placedMarkers.filter(hasMovement);
    }

    function startTrim(m) { return m._startTrim || 0; }

    function endTrim(m) {
        if (m._endTrim != null) return m._endTrim;
        return (m._samples && m._samples.length) ? m._samples[m._samples.length - 1].t : 0;
    }

    function endPhase(m) {
        if (!m._samples || m._samples.length < 2) return 0;
        return (m._phaseOffset || 0) + (endTrim(m) - startTrim(m));
    }

    function signalAt(marker, t) {
        const s = marker._signals;
        if (!s) return [];
        const out = [];
        for (const seg of s) {
            if (t >= seg.t0 && t <= seg.t1 && out.indexOf(seg.side) === -1) out.push(seg.side);
        }
        return out;
    }

    function applySignal(marker, sides) {
        let L = false, R = false;
        if (Array.isArray(sides)) { L = sides.indexOf('left') !== -1; R = sides.indexOf('right') !== -1; }
        else if (sides === 'left') L = true;
        else if (sides === 'right') R = true;
        const newSide = (L && R) ? 'both' : L ? 'left' : R ? 'right' : null;
        if (newSide !== marker._blinkSide) marker._blinkSince = performance.now();
        marker._blinkSide = newSide;
        if (!marker._rotWrap) return;
        const both = L && R;
        if (!L && !R) marker._rotWrap.classList.remove('blink-on');
        marker._rotWrap.classList.toggle('signal-both', both);
        marker._rotWrap.classList.toggle('signal-left', L && !both);
        marker._rotWrap.classList.toggle('signal-right', R && !both);
        if (marker._leftBtn) marker._leftBtn.classList.toggle('active', L);
        if (marker._rightBtn) marker._rightBtn.classList.toggle('active', R);
    }

    function maxDurOf(cars) {
        return Math.max.apply(null, cars.map(endPhase).concat(1)) || 1;
    }

    // Применить состояние машинки на момент времени elapsed (мс) цикла.
    // Отрезок записи [startTrim, endTrim] заполняет собой весь цикл машинки:
    // на elapsed=0 машинка находится в точке startTrim и движется к endTrim к концу
    // своего отрезка, затем цикл повторяется — без паузы перед перезапуском.
    // Для машинок, записанных во время воспроизведения (phaseOffset > 0), движение
    // начинается с фазы phaseOffset и до неё машинка держит позицию startTrim.
    function sampleAt(marker, elapsed) {
        const s = marker._samples;
        if (!s || s.length < 2) return;
        const st = startTrim(marker);
        const et = endTrim(marker);
        let e = st + (elapsed - (marker._phaseOffset || 0));
        if (e < st) e = st;
        else if (e > et) e = et;
        const t0 = s[0].t;
        const t1 = s[s.length - 1].t;
        if (e < t0) e = t0;
        else if (e > t1) e = t1;
        let i = 1;
        while (i < s.length - 1 && s[i].t < e) i++;
        const a = s[i - 1], b = s[i];
        const seg = (b.t - a.t) || 1;
        const t = Math.max(0, Math.min(1, (e - a.t) / seg));
        marker._lat = a.lat + (b.lat - a.lat) * t;
        marker._lon = a.lon + (b.lon - a.lon) * t;
        marker._heading = lerpAngle(a.heading, b.heading, t);
        marker.update({ coordinates: [marker._lon, marker._lat] });
        updatePicMarker(marker);
        applySignal(marker, signalAt(marker, e));
    }

    // ---- Запись ----
    function recFrame() {
        if (!_recOn) { _recRaf = null; return; }
        const now = performance.now();
        placedMarkers.forEach(m => {
            if (!m._recActive) return;
            let t;
            if (_playAll) {
                const phase = (now - _masterStart) % _maxDur;
                t = phase - (m._phaseOffset || 0);
                if (t < m._lastRel) t += _maxDur; // развёртка через границу цикла
                m._lastRel = t;
            } else {
                t = now - _recStart;
            }
            m._samples.push({ t, lat: m._lat, lon: m._lon, heading: m._heading });
        });
        _recRaf = requestAnimationFrame(recFrame);
    }

    // ---- Запись поворотников ----
    // Пока идёт запись (REC), переключение поворотников (setBlink/setHazard)
    // записывается в marker._signals как отрезки {t0, t1, side} — так же,
    // как их рисуют вручную в редакторе перемотки.
    function recSignalTime(marker) {
        if (_playAll) {
            const phase = (performance.now() - _masterStart) % _maxDur;
            let t = phase - (marker._phaseOffset || 0);
            if (t < 0) t += _maxDur;
            return t;
        }
        return performance.now() - _recStart;
    }

    function closeRecSig(marker, side, tEnd) {
        const open = marker._recSigOpen;
        if (!open || open[side] == null) return;
        const t0 = open[side];
        open[side] = null;
        marker._signals = marker._signals || [];
        marker._signals.push({ t0: t0, t1: Math.max(t0 + 50, tEnd), side: side });
        marker._signals.sort((a, b) => a.t0 - b.t0);
    }

    function recordSignalChange(marker) {
        if (!_recOn || !marker || marker._isTl) return;
        const L = marker._blinkSide === 'left' || marker._blinkSide === 'both';
        const R = marker._blinkSide === 'right' || marker._blinkSide === 'both';
        const t = Math.max(0, recSignalTime(marker));
        const open = marker._recSigOpen || (marker._recSigOpen = { left: null, right: null });
        [['left', L], ['right', R]].forEach(p => {
            const side = p[0], want = p[1];
            if (want && open[side] == null) open[side] = t;
            else if (!want && open[side] != null) closeRecSig(marker, side, t);
        });
    }

    function closeAllRecSigs(marker, tEnd) {
        if (!marker._recSigOpen) return;
        closeRecSig(marker, 'left', tEnd);
        closeRecSig(marker, 'right', tEnd);
        marker._recSigOpen = undefined;
    }

    // Оборачиваем переключение поворотников
    const origSetBlink = window.setBlink;
    const origSetHazard = window.setHazard;
    window.setBlink = function (marker, side) {
        origSetBlink(marker, side);
        recordSignalChange(marker);
    };
    window.setHazard = function (marker) {
        origSetHazard(marker);
        recordSignalChange(marker);
    };

    function stopRec() {
        if (!_recOn) return;
        _recOn = false;
        if (_recRaf) cancelAnimationFrame(_recRaf);
        _recRaf = null;
        const tEnd = _playAll ? _maxDur : (performance.now() - _recStart);
        placedMarkers.forEach(m => {
            closeAllRecSigs(m, tEnd);
            if (m._prevSamples && !hasMovement(m)) {
                m._samples = m._prevSamples; // тронули, но не сдвинули — вернуть старую запись
            } else if (m._recActive && hasMovement(m)) {
                m._startTrim = 0;      // свежая запись — диапазон целиком
                m._endTrim = undefined;
            }
            m._prevSamples = undefined;
        });
        if (_playAll) joinRecordedToPlay();
        updateRecBtn();
        updatePlayAllBtn();
    }

    function toggleRec() {
        if (_recOn) {
            stopRec();
        } else {
            placedMarkers.forEach(m => { m._recActive = false; m._prevSamples = undefined; m._lastRel = 0; });
            _recOn = true;
            _recStart = performance.now();
            // Поворотники, уже включённые до старта записи, пишем с начала сессии
            placedMarkers.forEach(m => {
                if (m._blinkSide) recordSignalChange(m);
            });
            _recRaf = requestAnimationFrame(recFrame);
            updateRecBtn();
            updatePlayAllBtn();
        }
    }

    // Активируем машинку в текущей сессии при касании её (кроме кнопок панели)
    window.addEventListener('pointerdown', e => {
        if (!_recOn) return;
        const t = e.target;
        if (!t || !t.closest) return;
        const markerEl = t.closest('.pic-marker');
        if (!markerEl) return;
        if (t.closest('.blink-btn') || t.closest('.delete-btn')) return;
        const marker = placedMarkers.find(m => m._select === markerEl);
        if (marker && !marker._recActive) {
            marker._recActive = true;
            marker._prevSamples = marker._samples;
            marker._samples = [];
            marker._signals = [];
            marker._lastRel = 0;
            if (_playAll) {
                marker._phaseOffset = (performance.now() - _masterStart) % _maxDur;
                marker._samples.push({ t: 0, lat: marker._lat, lon: marker._lon, heading: marker._heading });
            } else {
                marker._phaseOffset = 0;
                marker._samples.push({ t: performance.now() - _recStart, lat: marker._lat, lon: marker._lon, heading: marker._heading });
            }
        }
    }, true);

    // ---- Воспроизведение всех записей ----
    function masterFrame() {
        if (!_playAll) { _masterRaf = null; return; }
        const elapsed = (performance.now() - _masterStart) % _maxDur;
        let any = false;
        placedMarkers.forEach(m => {
            if (m._playing && m._samples && m._samples.length >= 2) { sampleAt(m, elapsed); any = true; }
        });
        if (!any) { _playAll = false; _masterRaf = null; updatePlayAllBtn(); return; }
        _masterRaf = requestAnimationFrame(masterFrame);
    }

    function startAll() {
        if (_playAll) return;
        if (_recOn) stopRec();
        const targets = playables();
        if (!targets.length) return;
        targets.forEach(m => {
            m._playing = true;
            m._savedBlink = m._blinkSide;
            m.update({ draggable: false });
            m._select.style.pointerEvents = 'none';
        });
        _maxDur = maxDurOf(targets);
        _playAll = true;
        _masterStart = performance.now();
        _masterRaf = requestAnimationFrame(masterFrame);
        updatePlayAllBtn();
    }

    function stopAll() {
        if (!_playAll) return;
        _playAll = false;
        if (_masterRaf) cancelAnimationFrame(_masterRaf);
        _masterRaf = null;
        placedMarkers.forEach(m => {
            if (!m._playing) return;
            m._playing = false;
            sampleAt(m, m._phaseOffset || 0); // вернуть на отсечённое начало
            applySignal(m, m._savedBlink);    // вернуть ручной сигнал
            m._select.style.pointerEvents = '';
            m.update({ draggable: !(m._panelOpen || drawMode || eraserMode) });
        });
        updatePlayAllBtn();
    }

    // Включить только что записанные машинки в текущее воспроизведение
    function joinRecordedToPlay() {
        let changed = false;
        placedMarkers.forEach(m => {
            if (m._recActive && hasMovement(m) && !m._playing) {
                m._playing = true;
                m._savedBlink = m._blinkSide;
                m.update({ draggable: false });
                m._select.style.pointerEvents = 'none';
                changed = true;
            }
        });
        if (changed) {
            _maxDur = maxDurOf(placedMarkers.filter(m => m._playing && m._samples && m._samples.length >= 2));
        }
    }

    // ---- Окно перемотки (долгое нажатие на PLAY) ----
    function scrubTo(marker, t) {
        sampleAt(marker, t - startTrim(marker) + (marker._phaseOffset || 0));
    }

    function fmtTime(ms) {
        return (ms / 1000).toFixed(1) + 'с';
    }

    function openScrubber() {
        if (_scrubOpen) return;
        if (_recOn) stopRec();
        if (_playAll) stopAll();
        _scrubOpen = true;
        playables().forEach(m => { m._savedBlink = m._blinkSide; });
        buildScrubRows();
        scrubModal.classList.add('visible');
    }

    function showConfirm(marker) {
        _confirmMarker = marker;
        confirmModal.classList.add('visible');
    }

    function hideConfirm() {
        _confirmMarker = null;
        confirmModal.classList.remove('visible');
    }

    function deleteRecording(marker) {
        marker._samples = [];
        marker._startTrim = 0;
        marker._endTrim = undefined;
        marker._phaseOffset = 0;
        marker._signals = [];
        if (_scrubOpen) buildScrubRows();
        updatePlayAllBtn();
    }

    function buildScrubRows() {
        hideConfirm();
        scrubBody.textContent = '';
        const cars = playables();
        if (!cars.length) {
            const empty = document.createElement('div');
            empty.className = 'scrub-empty';
            empty.textContent = 'Нет записей';
            scrubBody.appendChild(empty);
            return;
        }
        cars.forEach(marker => {
            const dur = marker._samples[marker._samples.length - 1].t;
            if (marker._startTrim == null) marker._startTrim = 0;
            if (marker._endTrim == null) marker._endTrim = dur;
            const row = document.createElement('div');
            row.className = 'scrub-row';
            const thumb = document.createElement('img');
            thumb.className = 'scrub-thumb';
            thumb.src = marker._img ? marker._img.src : '';
            const arrowBtn = document.createElement('div');
            arrowBtn.className = 'scrub-arrow';
            arrowBtn.textContent = '▼';
            const sigsec = document.createElement('div');
            sigsec.className = 'scrub-sigsec' + (marker._sigOpen ? ' open' : '');
            arrowBtn.addEventListener('click', e => {
                e.stopPropagation();
                marker._sigOpen = !marker._sigOpen;
                sigsec.classList.toggle('open', marker._sigOpen);
                arrowBtn.classList.toggle('open', marker._sigOpen);
            });
            const delBtn = document.createElement('div');
            delBtn.className = 'scrub-del-btn';
            delBtn.textContent = '✕';
            delBtn.addEventListener('click', e => {
                e.stopPropagation();
                showConfirm(marker);
            });
            const time = document.createElement('div');
            time.className = 'scrub-time';
            const dual = document.createElement('div');
            dual.className = 'scrub-dual';
            const active = document.createElement('div');
            active.className = 'scrub-active';
            dual.appendChild(active);
            const start = document.createElement('input');
            start.type = 'range';
            start.className = 'scrub-range scrub-start';
            const end = document.createElement('input');
            end.type = 'range';
            end.className = 'scrub-range scrub-end';
            dual.appendChild(start);
            dual.appendChild(end);
            row.appendChild(thumb);
            row.appendChild(arrowBtn);
            row.appendChild(delBtn);
            row.appendChild(time);
            row.appendChild(dual);

            // ---- редактор поворотников (2 линии, сворачиваемый) ----
            const attachSigTrack = side => {
                const line = document.createElement('div');
                line.className = 'scrub-sigline';
                const label = document.createElement('div');
                label.className = 'scrub-siglabel' + (side === 'right' ? ' right' : '');
                label.textContent = side === 'left' ? '←' : '→';
                const track = document.createElement('div');
                track.className = 'scrub-sigtrack';
                line.appendChild(label);
                line.appendChild(track);
                sigsec.appendChild(line);
                const renderSegs = () => {
                    track.textContent = '';
                    (marker._signals || []).filter(s => s.side === side).forEach(seg => {
                        const d = document.createElement('div');
                        d.className = 'sig-seg sig-seg-' + seg.side;
                        d._seg = seg;
                        const hs = document.createElement('div');
                        hs.className = 'sig-h sig-h-s';
                        const he = document.createElement('div');
                        he.className = 'sig-h sig-h-e';
                        const del = document.createElement('div');
                        del.className = 'sig-del';
                        del.textContent = '✕';
                        del.addEventListener('click', e => {
                            e.stopPropagation();
                            marker._signals = marker._signals.filter(s => s !== seg);
                            buildScrubRows();
                        });
                        d.appendChild(hs);
                        d.appendChild(he);
                        d.appendChild(del);
                        track.appendChild(d);
                        placeSeg(d, seg);
                    });
                };
                const placeSeg = (el, seg) => {
                    el.style.left = (seg.t0 / dur * 100) + '%';
                    el.style.width = Math.max(0.5, (seg.t1 - seg.t0) / dur * 100) + '%';
                };
                const tFromEvent = e => {
                    const rect = track.getBoundingClientRect ? track.getBoundingClientRect() : track._rect;
                    if (rect && rect.width) return Math.max(0, Math.min(dur, (e.clientX - rect.left) / rect.width * dur));
                    return dur / 2;
                };
                const MINLEN = 0.15;
                let sigDrag = null;
                track.addEventListener('pointerdown', e => {
                    e.stopPropagation();
                    const t = tFromEvent(e);
                    const segEl = e.target && e.target.closest ? e.target.closest('.sig-seg') : null;
                    if (segEl && segEl._seg) {
                        const seg = segEl._seg;
                        if (e.target.closest('.sig-del')) return; // удаление — через click крестика
                        const onStart = e.target.closest('.sig-h-s');
                        const onEnd = e.target.closest('.sig-h-e');
                        if (onStart || onEnd) {
                            sigDrag = { mode: 'resize', marker, seg, edge: onStart ? 's' : 'e', segEl };
                            scrubTo(marker, onStart ? seg.t0 : seg.t1);
                        } else {
                            sigDrag = { mode: 'move', marker, seg, segEl, startT: t, origT0: seg.t0 };
                            scrubTo(marker, seg.t0);
                        }
                        return;
                    }
                    sigDrag = { mode: 'draw', marker, side, t0: t, t1: t };
                    scrubTo(marker, t);
                    const d = document.createElement('div');
                    d.className = 'sig-seg sig-seg-' + side + ' sig-draw';
                    track.appendChild(d);
                    sigDrag.segEl = d;
                    const upd = () => {
                        const a = Math.min(sigDrag.t0, sigDrag.t1), b = Math.max(sigDrag.t0, sigDrag.t1);
                        placeSeg(sigDrag.segEl, { t0: a, t1: b });
                    };
                    sigDrag.update = upd;
                    upd();
                });
                track.addEventListener('pointermove', e => {
                    if (!sigDrag) return;
                    const t = tFromEvent(e);
                    if (sigDrag.mode === 'draw') {
                        sigDrag.t1 = t;
                        sigDrag.update();
                        scrubTo(marker, t);
                    } else if (sigDrag.mode === 'resize') {
                        const seg = sigDrag.seg;
                        if (sigDrag.edge === 's') seg.t0 = Math.max(0, Math.min(t, seg.t1 - MINLEN));
                        else seg.t1 = Math.min(dur, Math.max(t, seg.t0 + MINLEN));
                        placeSeg(sigDrag.segEl, seg);
                        scrubTo(marker, sigDrag.edge === 's' ? seg.t0 : seg.t1);
                    } else if (sigDrag.mode === 'move') {
                        const seg = sigDrag.seg;
                        const len = seg.t1 - seg.t0;
                        seg.t0 = Math.max(0, Math.min(sigDrag.origT0 + (t - sigDrag.startT), dur - len));
                        seg.t1 = seg.t0 + len;
                        placeSeg(sigDrag.segEl, seg);
                        scrubTo(marker, seg.t0);
                    }
                });
                track.addEventListener('pointerup', e => {
                    if (!sigDrag) return;
                    const d = sigDrag;
                    sigDrag = null;
                    if (d.mode === 'draw') {
                        let a = Math.min(d.t0, d.t1), b = Math.max(d.t0, d.t1);
                        if (b - a < 0.15) { const c = (a + b) / 2; a = Math.max(0, c - 0.35); b = Math.min(dur, c + 0.35); }
                        marker._signals = marker._signals || [];
                        marker._signals.push({ t0: a, t1: b, side: d.side });
                        marker._signals.sort((x, y) => x.t0 - y.t0);
                        buildScrubRows();
                        return;
                    }
                    if (d.mode === 'resize' || d.mode === 'move') {
                        marker._signals.sort((x, y) => x.t0 - y.t0);
                        buildScrubRows();
                    }
                });
                track.addEventListener('pointercancel', () => { sigDrag = null; renderSegs(); });
                renderSegs();
            };
            attachSigTrack('left');
            attachSigTrack('right');
            row.appendChild(sigsec);
            scrubBody.appendChild(row);

            const refresh = () => {
                const p1 = (marker._startTrim / dur) * 100;
                const p2 = (marker._endTrim / dur) * 100;
                active.style.left = p1 + '%';
                active.style.width = (p2 - p1) + '%';
                time.textContent = fmtTime(marker._startTrim) + '–' + fmtTime(marker._endTrim);
            };
            const sync = isStart => {
                if (isStart) {
                    marker._startTrim = (start.value / 1000) * dur;
                    if (marker._startTrim > marker._endTrim) {
                        marker._startTrim = marker._endTrim;
                        start.value = (marker._endTrim / dur) * 1000;
                    }
                    scrubTo(marker, marker._startTrim);
                } else {
                    marker._endTrim = (end.value / 1000) * dur;
                    if (marker._endTrim < marker._startTrim) {
                        marker._endTrim = marker._startTrim;
                        end.value = (marker._startTrim / dur) * 1000;
                    }
                    scrubTo(marker, marker._endTrim);
                }
                refresh();
            };
            start.min = 0; start.max = 1000;
            end.min = 0; end.max = 1000;
            start.value = (marker._startTrim / dur) * 1000;
            end.value = (marker._endTrim / dur) * 1000;
            start.addEventListener('input', () => sync(true));
            end.addEventListener('input', () => sync(false));
            scrubTo(marker, marker._startTrim);
            refresh();
        });
        scrubModal.classList.add('visible');
    }

    function closeScrubber() {
        hideConfirm();
        if (!_scrubOpen) return;
        _scrubOpen = false;
        scrubModal.classList.remove('visible');
        playables().forEach(m => applySignal(m, m._savedBlink));
    }

    scrubClose.addEventListener('click', closeScrubber);
    confirmYes.addEventListener('click', () => { const m = _confirmMarker; hideConfirm(); if (m) deleteRecording(m); });
    confirmNo.addEventListener('click', hideConfirm);
    confirmModal.addEventListener('click', e => { if (e.target === confirmModal) hideConfirm(); });

    // ---- Кнопки ----
    function updateRecBtn() {
        if (!recAllBtn) return;
        recAllBtn.classList.toggle('active', _recOn);
        recAllBtn.innerHTML = _recOn ? 'СТОП' : 'REC';
    }

    function updatePlayAllBtn() {
        if (!playAllBtn) return;
        const any = playables().length > 0;
        playAllBtn.style.display = any ? 'flex' : 'none';
        playAllBtn.classList.toggle('active', _playAll);
        playAllBtn.innerHTML = _playAll ? ICON_STOP : ICON_PLAY;
    }

    recAllBtn.addEventListener('click', toggleRec);
    playAllBtn.addEventListener('click', () => {
        if (_suppressClick) { _suppressClick = false; return; }
        if (_scrubOpen) { closeScrubber(); return; }
        if (_playAll) { if (_recOn) stopRec(); stopAll(); } else startAll();
    });
    playAllBtn.addEventListener('pointerdown', e => {
        clearTimeout(_scrubTimer);
        _suppressClick = false;
        _scrubTimer = setTimeout(() => {
            _suppressClick = true;
            openScrubber();
        }, 450);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
        playAllBtn.addEventListener(ev, () => clearTimeout(_scrubTimer)));

    // ---- Патч removeMarker: обновляем видимость кнопки PLAY ----
    const origRemove = window.removeMarker;
    window.removeMarker = function (marker) {
        origRemove(marker);
        updatePlayAllBtn();
    };

    // ---- Индивидуальные фазы мигания поворотников ----
    // Каждая машинка хранит момент включения (_blinkSince) и мигает в своём ритме.
    let _blinkOn = false;
    setInterval(() => {
        const now = performance.now();
        placedMarkers.forEach(m => {
            if (!m._rotWrap) return;
            if (m._blinkSide) {
                if (!m._blinkSince) m._blinkSince = now;
                m._rotWrap.classList.toggle('blink-on', ((now - m._blinkSince) / 450) % 2 < 1);
            } else {
                m._blinkSince = 0;
                m._rotWrap.classList.remove('blink-on');
            }
        });
    }, 100);
})();