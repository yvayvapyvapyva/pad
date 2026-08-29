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
            position:relative;
        }
        .scrub-row .scrub-timewrap { flex:0 0 100%; display:flex; align-items:center; justify-content:center; gap:8px; padding:4px 0 6px; }
        .scrub-title {
            position:absolute; left:0; right:0; text-align:center; pointer-events:none;
            font-size:13px; font-weight:600; color:rgba(255,255,255,0.9);
        }
        .scrub-close {
            width:30px; height:30px; border-radius:50%; border:0.5px solid rgba(255,255,255,0.12);
            background:rgba(255,255,255,0.06); color:#fff; font-size:15px; cursor:pointer;
            display:flex; align-items:center; justify-content:center; touch-action:manipulation; flex-shrink:0;
            margin-left:auto; /* всегда прижимаем к правому краю шапки */
        }
        .scrub-close:active { background:rgba(255,255,255,0.15); }
        #scrubBody { flex:1; min-height:0; overflow-y:auto; padding:10px 12px 32px; -webkit-overflow-scrolling:touch; }
        .scrub-row {
            display:flex; align-items:center; gap:6px; padding:10px 8px;
            border-bottom:0.5px solid rgba(255,255,255,0.08);
        }
        .scrub-thumb {
            width:26px; height:26px; object-fit:contain; flex-shrink:0; pointer-events:none;
            border-radius:6px; background:rgba(255,255,255,0.08); padding:2px;
        }
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
        .scrub-time { flex-shrink:0; font-size:11px; font-weight:600; font-variant-numeric:tabular-nums; }
        /* Полоса времени в стиле полос поворотников: зелёный отрезок во всю высоту трека */
        .scrub-timetrack { cursor:ew-resize; }
        /* Полоса времени занимает всю ширину строки, как секция поворотников */
        .scrub-timeline { flex:0 0 100%; }
        .scrub-active {
            position:absolute; top:2px; bottom:2px; border-radius:4px;
            background:#30D158; opacity:0.9; pointer-events:none;
        }
        .scrub-empty { padding:24px 12px; font-size:15px; color:rgba(255,255,255,0.55); text-align:center; }
        /* Красная кнопка удаления записи внизу шторки */
        #scrubFooter { padding:8px 12px; flex-shrink:0; }
        #scrubDeleteBtn {
            width:100%; height:44px; border-radius:12px; border:none; flex-shrink:0;
            background:rgba(255,69,58,0.9); color:#fff; font-size:16px; font-weight:600;
            display:flex; align-items:center; justify-content:center; cursor:pointer; touch-action:manipulation;
        }
        #scrubDeleteBtn:active { background:rgba(255,69,58,1); }
        #scrubDeleteBtn.hidden { display:none; }
        /* Круглая REC-кнопка над машинкой (появляется по длительному нажатию, если есть запись) */
        .rec-btn {
            position:absolute; top:-26px; left:50%; transform:translate(-50%,-50%);
            display:none; align-items:center; justify-content:center;
            min-width:34px; height:34px; border-radius:50%; padding:0;
            background:rgba(255,69,58,0.95); border:0.5px solid rgba(255,255,255,0.35);
            color:#fff; font-size:11px; font-weight:700; line-height:1;
            box-shadow:0 4px 14px rgba(0,0,0,0.5); cursor:pointer; pointer-events:auto; z-index:1000;
            touch-action:manipulation; white-space:nowrap;
        }
        .rec-btn.visible { display:flex; }
        .rec-btn:active { transform:translate(-50%,-50%) scale(0.9); }
        .rec-btn .rec-dot { width:8px; height:8px; border-radius:50%; background:#fff; flex-shrink:0; }
        .scrub-row { flex-wrap:wrap; }
        /* Линии поворотников всегда раскрыты */
        .scrub-sigsec { flex:0 0 100%; display:block; padding-top:6px; }
        .scrub-sigline { display:flex; align-items:center; gap:6px; padding:3px 0; }
        .scrub-siglabel { flex-shrink:0; width:16px; text-align:center; font-size:14px; color:#FFCC00; }
        .scrub-siglabel.right { color:#FFCC00; }
        .scrub-sigtrack {
            position:relative; flex:1; min-width:0; height:26px; border-radius:6px;
            background:rgba(255,255,255,0.08); cursor:crosshair; touch-action:none; overflow:hidden;
        }
        .sig-seg { position:absolute; top:2px; bottom:2px; border-radius:4px; opacity:0.9; touch-action:none; }
        .sig-seg.sig-seg-left { background:#FFCC00; }
        .sig-seg.sig-seg-right { background:#FFCC00; }
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
    let _confirmMarker = null;
    let _scrubMarker = null; // машинка, для которой открыта панель записи

    const scrubModal = document.createElement('div');
    scrubModal.id = 'scrubModal';
    const scrubHeader = document.createElement('div');
    scrubHeader.className = 'scrub-header';
    const scrubClose = document.createElement('div');
    scrubClose.className = 'scrub-close';
    scrubClose.textContent = '✕';
    // Заголовок «Запись» + иконка машинки слева от времени в теле шторки
    const scrubTitle = document.createElement('div');
    scrubTitle.className = 'scrub-title';
    scrubTitle.textContent = 'Запись';
    const scrubThumb = document.createElement('img');
    scrubThumb.className = 'scrub-thumb';
    const scrubTime = document.createElement('div');
    scrubTime.className = 'scrub-time';
    scrubHeader.appendChild(scrubTitle);
    scrubHeader.appendChild(scrubClose);
    scrubThumb.style.display = 'none';
    const scrubBody = document.createElement('div');
    scrubBody.id = 'scrubBody';
    const scrubFooter = document.createElement('div');
    scrubFooter.id = 'scrubFooter';
    const scrubDeleteBtn = document.createElement('div');
    scrubDeleteBtn.id = 'scrubDeleteBtn';
    scrubDeleteBtn.textContent = 'Удалить запись';
    scrubDeleteBtn.classList.add('hidden');
    scrubDeleteBtn.addEventListener('click', () => { if (_scrubMarker) showConfirm(_scrubMarker); });
    scrubFooter.appendChild(scrubDeleteBtn);
    scrubModal.appendChild(scrubHeader);
    scrubModal.appendChild(scrubBody);
    scrubModal.appendChild(scrubFooter);
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
        if (m._isTl) return false; // светофоры не двигаются — только лампы
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

    // Есть ли у светофора запись переключений ламп
    function hasTlRec(m) {
        return !!(m._isTl && m._tlRec && m._tlRec.length);
    }

    // Светофоры с записью ламп, ещё не включённые в воспроизведение
    function tlRecMarkers() {
        return placedMarkers.filter(m => !m._playing && hasTlRec(m));
    }

    function startTrim(m) { return m._startTrim || 0; }

    function endTrim(m) {
        if (m._endTrim != null) return m._endTrim;
        return (m._samples && m._samples.length) ? m._samples[m._samples.length - 1].t : 0;
    }

    function endPhase(m) {
        if (m._isTl && m._tlRec && m._tlRec.length) {
            return (m._phaseOffset || 0) + m._tlRec[m._tlRec.length - 1].t;
        }
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
        applySignal(marker, signalAt(marker, e));
    }

    // Применение рассчитанной в sampleAt позиции к маркеру на карте.
    // Вынесено отдельно, чтобы viewport culling мог пропускать дорогой
    // marker.update({coordinates}) для машинок за пределами экрана.
    function applyPosition(marker) {
        marker.update({ coordinates: [marker._lon, marker._lat] });
        if (typeof window.updatePicTransform === 'function') window.updatePicTransform(marker);
        else updatePicMarker(marker);
    }

    // Применить состояние ламп светофора на момент времени elapsed (мс) цикла:
    // стартуем из состояния на момент записи (_tlInit) и проигрываем переключения.
    function applyTlAt(marker, elapsed) {
        const recs = marker._tlRec;
        if (!recs || !recs.length) return;
        const e = elapsed - (marker._phaseOffset || 0);
        const MAIN = ['red', 'yellow', 'green'];
        const st = { red: false, yellow: false, green: false, left: false, right: false };
        const init = marker._tlInit;
        if (init) for (const k in init) st[k] = !!init[k];
        for (const r of recs) {
            if (r.t > e) break;
            st[r.key] = !!r.on;
            if (r.on && MAIN.indexOf(r.key) !== -1) {
                MAIN.forEach(k => { if (k !== r.key) st[k] = false; });
            }
        }
        for (const k in st) {
            if (st[k] !== marker._lampState[k] && window.tlSetLamp) window.tlSetLamp(marker, k, st[k]);
        }
    }


    // ---- Запись ----
    // Частота сэмплов: ~10 кадров/с (100 мс), чтобы уменьшить размер записи.
    // Воспроизведение интерполирует между сэмплами линейно, поэтому плавность не страдает.
    const SAMPLE_INTERVAL_MS = 100;
    // Текущее время записи на шкале машинки. При записи во время воспроизведения это
    // фаза мастер-цикла, сдвинутая на _phaseOffset (с развёрткой через границу цикла);
    // при обычной записи — секунды от начала сессии. Единая шкала для сэмплов движения
    // и поворотников, чтобы они всегда попадали точно в свои места.
    function relTime(marker) {
        if (_playAll) {
            const phase = (performance.now() - _masterStart) % _maxDur;
            let t = phase - (marker._phaseOffset || 0);
            if (marker._lastRel != null && t < marker._lastRel) t += _maxDur;
            marker._lastRel = t;
            return t;
        }
        return performance.now() - _recStart;
    }

    function recFrame() {
        if (!_recOn) { _recRaf = null; return; }
        placedMarkers.forEach(m => {
            if (!m._recActive || m._isTl) return; // светофоры не сэмплируются по движению
            const t = relTime(m);
            if (m._lastSampleT == null || t - m._lastSampleT >= SAMPLE_INTERVAL_MS) {
                m._samples.push({ t: Math.round(t), lat: m._lat, lon: m._lon, heading: m._heading });
                m._lastSampleT = t;
            }
        });
        _recRaf = requestAnimationFrame(recFrame);
    }

    // ---- Запись поворотников ----
    // Пока идёт запись (REC), переключение поворотников (setBlink/setHazard)
    // записывается в marker._signals как отрезки {t0, t1, side} — так же,
    // как их рисуют вручную в редакторе перемотки.
    function recSignalTime(marker) {
        return relTime(marker);
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
        // Поворотники пишем только у машинок, реально записываемых в этой сессии
        // (тронуты после старта REC). У остальных — например, проигрывающихся —
        // состояние сигнала не должно попадать в чужую запись.
        if (!_recOn || !marker || marker._isTl || !marker._recActive) return;
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

    // Запись переключений ламп светофора: пока активен REC, каждое нажатие на лампу
    // фиксируется в marker._tlRec как {t, key, on}. Хук вызывается из setLamp
    // (trafficlights.js), т.е. ловит все пути изменения ламп.
    function recordTlLamp(marker, key, on) {
        if (!_recOn || !marker || !marker._isTl || marker._playing) return;
        if (_playAll && marker._phaseOffset == null) {
            marker._phaseOffset = (performance.now() - _masterStart) % _maxDur;
        }
        if (marker._tlInit == null) {
            marker._tlInit = {};
            ['red', 'yellow', 'green', 'left', 'right'].forEach(k => marker._tlInit[k] = !!marker._lampState[k]);
        }
        marker._tlRec = marker._tlRec || [];
        marker._tlRec.push({ t: Math.round(Math.max(0, recSignalTime(marker))), key: key, on: !!on });
    }
    window.onTlLampChange = recordTlLamp;

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
        placedMarkers.forEach(m => {
            if (!m._recActive) { m._prevSamples = undefined; return; }
            // Конец на собственной шкале машинки (а не _maxDur/времени сессии):
            // при записи во время воспроизведения шкала сдвинута на _phaseOffset.
            const tEnd = Math.round(relTime(m));
            closeAllRecSigs(m, tEnd);
            if (m._prevSamples && !hasMovement(m)) {
                m._samples = m._prevSamples; // тронули, но не сдвинули — вернуть старую запись
            } else if (hasMovement(m)) {
                // Финальная точка с текущим положением — чтобы endTrim/последний t были точными
                m._samples.push({ t: tEnd, lat: m._lat, lon: m._lon, heading: m._heading });
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
            placedMarkers.forEach(m => { m._recActive = false; m._prevSamples = undefined; m._lastRel = 0; m._lastSampleT = undefined; m._recSigOpen = undefined; });
            // Новая сессия записи: у светофоров обнуляем запись ламп (движение не пишется)
            placedMarkers.forEach(m => {
                if (m._isTl && !m._playing) { m._tlRec = []; m._tlInit = null; m._phaseOffset = 0; }
            });
            _recOn = true;
            _recStart = performance.now();
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
        if (marker && !marker._recActive && !marker._isTl) {
            marker._recActive = true;
            marker._prevSamples = marker._samples;
            marker._samples = [];
            marker._signals = [];
            marker._lastRel = 0;
            marker._recSigOpen = { left: null, right: null };
            if (_playAll) {
                marker._phaseOffset = (performance.now() - _masterStart) % _maxDur;
                marker._lastSampleT = 0;
                marker._samples.push({ t: 0, lat: marker._lat, lon: marker._lon, heading: marker._heading });
            } else {
                marker._phaseOffset = 0;
                marker._lastSampleT = performance.now() - _recStart;
                marker._samples.push({ t: marker._lastSampleT, lat: marker._lat, lon: marker._lon, heading: marker._heading });
            }
            // Поворотники, включённые ещё до касания, пишем с начала записи машинки
            recordSignalChange(marker);
        }
    }, true);

    // ---- Воспроизведение всех записей ----
    const MASTER_FRAME_MS = 33; // ~30fps — данные записаны ~10fps, этого достаточно для плавности

    function masterFrame() {
        if (!_playAll) { _masterRaf = null; return; }
        const now = performance.now();
        if (now - _masterLast >= MASTER_FRAME_MS) {
            _masterLast = now;
            const elapsed = (now - _masterStart) % _maxDur;
            const bounds = visibleBounds(); // [[lngMin,latMin],[lngMax,latMax]] или null
            let any = false;
            placedMarkers.forEach(m => {
                if (m._playing && m._isTl && m._tlRec && m._tlRec.length) {
                    applyTlAt(m, elapsed);
                    any = true;
                } else if (m._playing && m._samples && m._samples.length >= 2) {
                    sampleAt(m, elapsed);
                    if (!bounds || inBounds(bounds, m._lon, m._lat)) applyPosition(m);
                    any = true;
                }
            });
            if (!any) { _playAll = false; _masterRaf = null; updatePlayAllBtn(); return; }
        }
        _masterRaf = requestAnimationFrame(masterFrame);
    }

    // Текущие границы видимой области карты [[lngMin,latMin],[lngMax,latMax]] или null.
    // Yandex Maps v3 не даёт готового getBounds(), поэтому вычисляем приблизительно
    // из map.center/map.zoom и размера контейнера (Web Mercator).
    function visibleBounds() {
        try {
            const m = map;
            if (!m || !m.center || !isFinite(m.zoom)) return null;
            const container = document.getElementById('map');
            const wpx = container ? container.clientWidth : window.innerWidth;
            const hpx = container ? container.clientHeight : window.innerHeight;
            const cLat = m.center[1], cLng = m.center[0];
            const latRad = cLat * Math.PI / 180;
            const mpp = 156543.03392 * Math.cos(latRad) / Math.pow(2, m.zoom);
            const halfW = (wpx / 2) * mpp;
            const halfH = (hpx / 2) * mpp;
            const padM = 150; // небольшой запас, чтобы машинка у края не мигала
            const dLng = (halfW + padM) / (111320 * Math.cos(latRad));
            const dLat = (halfH + padM) / 110540;
            return [[cLng - dLng, cLat - dLat], [cLng + dLng, cLat + dLat], m.zoom];
        } catch (e) { /* ignore */ }
        return null;
    }

    // Проверка попадания точки внутри границ (с небольшим запасом).
    function inBounds(bounds, lon, lat) {
        const [[lngMin, latMin], [lngMax, latMax]] = bounds;
        return lon >= lngMin && lon <= lngMax && lat >= latMin && lat <= latMax;
    }


    function startAll() {
        if (_playAll) return;
        if (_recOn) stopRec();
        hideAllRecBtns();
        const targets = playables().concat(tlRecMarkers());
        if (!targets.length) return;
        targets.forEach(m => {
            m._playing = true;
            m._savedBlink = m._blinkSide;
            if (m._isTl && m._lampState) m._savedLamps = Object.assign({}, m._lampState);
            m.update({ draggable: false });
            m._select.style.pointerEvents = 'none';
        });
        _maxDur = maxDurOf(targets);
        _playAll = true;
        _masterStart = performance.now();
        _masterLast = 0;
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
            if (m._isTl) {
                const L = m._savedLamps;
                if (L) for (const k in L) { if (window.tlSetLamp) window.tlSetLamp(m, k, L[k]); }
                m._savedLamps = undefined;
            } else {
                sampleAt(m, m._phaseOffset || 0); // вернуть на отсечённое начало
                applyPosition(m);
                applySignal(m, m._savedBlink);    // вернуть ручной сигнал
            }
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
            } else if (m._isTl && !m._playing && hasTlRec(m)) {
                m._playing = true;
                m._savedBlink = m._blinkSide;
                if (m._lampState) m._savedLamps = Object.assign({}, m._lampState);
                m.update({ draggable: false });
                m._select.style.pointerEvents = 'none';
                changed = true;
            }
        });
        if (changed) {
            _maxDur = maxDurOf(placedMarkers.filter(m =>
                m._playing && (m._isTl ? hasTlRec(m) : (m._samples && m._samples.length >= 2))));
        }
    }

    // ---- Окно перемотки (долгое нажатие на PLAY) ----
    function scrubTo(marker, t) {
        sampleAt(marker, t - startTrim(marker) + (marker._phaseOffset || 0));
        applyPosition(marker);
    }

    function fmtTime(ms) {
        return (ms / 1000).toFixed(1) + 'с';
    }

    function openScrubber(marker) {
        if (_scrubOpen) { if (marker && marker !== _scrubMarker) { buildScrubRows(marker); } return; }
        if (_recOn) stopRec();
        if (_playAll) stopAll();
        _scrubOpen = true;
        _scrubMarker = marker || null;
        playables().forEach(m => { m._savedBlink = m._blinkSide; });
        hideAllRecBtns();
        buildScrubRows(marker);
        scrubModal.classList.add('visible');
    }

    // Отцентрировать камеру на машинке (без подсветки строки).
    function highlightCar(marker, centerView) {
        if (centerView && marker && map) {
            try {
                // Центрируем камеру на машинке, сохраняя текущий азимут: обработка
                // location сбрасывает азимут, поэтому возвращаем его camera-only.
                const az = (map.azimuth != null && isFinite(map.azimuth)) ? map.azimuth : 0;
                const zoom = (map.zoom != null && isFinite(map.zoom)) ? map.zoom : 16;
                map.setLocation({ center: [marker._lon, marker._lat], zoom: zoom, duration: 600 });
                map.update({ camera: { azimuth: az, duration: 600 } });
            } catch (e) {}
        }
    }

    // ---- REC-кнопка над машинкой (по длительному нажатию) ----
    function hasRecording(m) {
        return !!(m._samples && m._samples.length >= 2 && hasMovement(m));
    }

    function ensureRecBtn(marker) {
        if (marker._recBtn) return marker._recBtn;
        const b = document.createElement('div');
        b.className = 'rec-btn';
        b.innerHTML = '<span class="rec-dot"></span>';
        b.title = 'Запись машинки';
        b.setAttribute('aria-label', 'Запись машинки');
        b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
        b.addEventListener('click', e => {
            e.stopPropagation();
            openScrubber(marker);
        });
        if (marker._rotWrap) marker._rotWrap.appendChild(b);
        else if (marker._select) marker._select.appendChild(b);
        marker._recBtn = b;
        return b;
    }

    function hideAllRecBtns() {
        placedMarkers.forEach(m => { if (m._recBtn) m._recBtn.classList.remove('visible'); });
    }

    // Хук из pad.html: длительное нажатие на машинку — показать/скрыть REC-кнопку
    window.onMarkerLongPress = function (marker) {
        if (!marker || marker._isTl || !marker._select) return;
        if (!hasRecording(marker)) return;
        const b = ensureRecBtn(marker);
        const showing = b.classList.contains('visible');
        hideAllRecBtns();
        b.classList.toggle('visible', !showing);
    };

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
        if (_scrubOpen) buildScrubRows(marker);
        updatePlayAllBtn();
    }

    function buildScrubRows(marker) {
        hideConfirm();
        scrubBody.textContent = '';
        if (!marker || !hasRecording(marker)) {
            scrubThumb.style.display = 'none';
            scrubTime.style.display = 'none';
            scrubTime.textContent = '';
            scrubDeleteBtn.classList.add('hidden');
            const empty = document.createElement('div');
            empty.className = 'scrub-empty';
            empty.textContent = 'Нет записи';
            scrubBody.appendChild(empty);
            return;
        }
        scrubThumb.style.display = '';
        scrubTime.style.display = '';
        scrubDeleteBtn.classList.remove('hidden');
        scrubThumb.src = marker._img ? marker._img.src : '';
        {
            const dur = marker._samples[marker._samples.length - 1].t;
            if (marker._startTrim == null) marker._startTrim = 0;
            if (marker._endTrim == null) marker._endTrim = dur;
            const row = document.createElement('div');
            row.className = 'scrub-row';
            row._marker = marker;
            // Клик по строке: центрировать камеру на машинке.
            row.addEventListener('click', e => {
                if (e.target && e.target.closest &&
                    (e.target.closest('.scrub-sigtrack') || e.target.closest('.scrub-sigsec') ||
                     e.target.closest('.scrub-confirm-btn'))) return;
                highlightCar(marker, true);
            });
            const sigsec = document.createElement('div');
            sigsec.className = 'scrub-sigsec';
            const timeWrap = document.createElement('div');
            timeWrap.className = 'scrub-timewrap';
            timeWrap.appendChild(scrubThumb);
            timeWrap.appendChild(scrubTime);
            // Полоса времени в стиле полос поворотников: часовая песочница + трек
            const timeLine = document.createElement('div');
            timeLine.className = 'scrub-sigline scrub-timeline';
            const timeLabel = document.createElement('div');
            timeLabel.className = 'scrub-siglabel';
            timeLabel.textContent = '⏳';
            const timeTrack = document.createElement('div');
            timeTrack.className = 'scrub-sigtrack scrub-timetrack';
            const active = document.createElement('div');
            active.className = 'scrub-active';
            const actH0 = document.createElement('div');
            actH0.className = 'sig-h sig-h-s';
            const actH1 = document.createElement('div');
            actH1.className = 'sig-h sig-h-e';
            active.appendChild(actH0);
            active.appendChild(actH1);
            timeTrack.appendChild(active);
            timeLine.appendChild(timeLabel);
            timeLine.appendChild(timeTrack);
            row.appendChild(timeWrap);
            row.appendChild(timeLine);
            // Перетаскивание краёв/середины зелёного отрезка = подгонка старта/конца
            let tDrag = null;
            const ttT = e => {
                const r = timeTrack.getBoundingClientRect();
                if (!r.width) return dur / 2;
                return Math.max(0, Math.min(dur, (e.clientX - r.left) / r.width * dur));
            };
            const MINTRY = 0.15;
            timeTrack.addEventListener('pointerdown', e => {
                e.stopPropagation();
                const t = ttT(e);
                const s = marker._startTrim, en = marker._endTrim;
                const r = timeTrack.getBoundingClientRect();
                const sx = r.left + (s / dur) * r.width;
                const ex = r.left + (en / dur) * r.width;
                const edge = 14;
                if (Math.abs(e.clientX - sx) <= edge) tDrag = { mode: 's' };
                else if (Math.abs(e.clientX - ex) <= edge) tDrag = { mode: 'e' };
                else tDrag = { mode: 's' };
            });
            timeTrack.addEventListener('pointermove', e => {
                if (!tDrag) return;
                const t = ttT(e);
                if (tDrag.mode === 's') {
                    marker._startTrim = Math.max(0, Math.min(t, marker._endTrim - MINTRY));
                    scrubTo(marker, marker._startTrim);
                } else if (tDrag.mode === 'e') {
                    marker._endTrim = Math.min(dur, Math.max(t, marker._startTrim + MINTRY));
                    scrubTo(marker, marker._endTrim);
                }
                refresh();
            });
            timeTrack.addEventListener('pointerup', () => { tDrag = null; });
            timeTrack.addEventListener('pointercancel', () => { tDrag = null; });

            // ---- редактор поворотников (2 линии, всегда раскрыты) ----
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
                            buildScrubRows(marker);
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
                        if (!onStart && !onEnd) return; // перенос целиком отключён — только края
                        sigDrag = { mode: 'resize', marker, seg, edge: onStart ? 's' : 'e', segEl };
                        scrubTo(marker, onStart ? seg.t0 : seg.t1);
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
                        buildScrubRows(marker);
                        return;
                    }
                    if (d.mode === 'resize') {
                        marker._signals.sort((x, y) => x.t0 - y.t0);
                        buildScrubRows(marker);
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
                scrubTime.textContent = fmtTime(marker._startTrim) + '–' + fmtTime(marker._endTrim);
            };
            scrubTo(marker, marker._startTrim);
            refresh();
        }
        scrubModal.classList.add('visible');
    }

    function closeScrubber() {
        hideConfirm();
        if (!_scrubOpen) return;
        _scrubOpen = false;
        _scrubMarker = null;
        hideAllRecBtns();
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
        const any = playables().length > 0 || placedMarkers.some(hasTlRec);
        const hidden = document.body.classList.contains('controls-hidden');
        if (hidden && any && !_playAll) {
            playAllBtn.style.display = 'flex';
            playAllBtn.style.background = 'rgba(15,15,15,0.3)';
            playAllBtn.style.boxShadow = 'none';
            playAllBtn.classList.remove('active');
            playAllBtn.innerHTML = ICON_PLAY;
        } else {
            playAllBtn.style.background = '';
            playAllBtn.style.boxShadow = '';
            playAllBtn.style.display = any ? 'flex' : 'none';
            playAllBtn.classList.toggle('active', _playAll);
            playAllBtn.innerHTML = _playAll ? ICON_STOP : ICON_PLAY;
        }
    }

    // При переключении режима скрытия элементов управления (controls-hidden)
    // обновляем видимость/прозрачность кнопки PLAY.
    new MutationObserver(() => updatePlayAllBtn())
        .observe(document.body, { attributes: true, attributeFilter: ['class'] });

    recAllBtn.addEventListener('click', toggleRec);
    playAllBtn.addEventListener('click', () => {
        if (_scrubOpen) { closeScrubber(); return; }
        if (_playAll) { if (_recOn) stopRec(); stopAll(); } else startAll();
    });

    // ---- Патч removeMarker: обновляем видимость кнопки PLAY ----
    const origRemove = window.removeMarker;
    window.removeMarker = function (marker) {
        origRemove(marker);
        hideAllRecBtns();
        updatePlayAllBtn();
    };

    // Патч restoreScene: после загрузки/восстановления сцены маркеры получают
    // _samples, поэтому обновляем видимость кнопки PLAY (иначе запись не запустить).
    const origRestoreScene = window.restoreScene;
    window.restoreScene = function (snap) {
        const result = origRestoreScene ? origRestoreScene(snap) : undefined;
        updatePlayAllBtn();
        return result;
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