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
        #recAllBtn { right:12px; top:calc(140px + env(safe-area-inset-top)); background:rgba(255,69,58,0.9); }
        #recAllBtn.active { animation:recPulse 1s ease-in-out infinite; }
        #playAllBtn { right:12px; top:calc(204px + env(safe-area-inset-top)); background:rgba(48,209,88,0.9); display:none; }
        #playAllBtn.active { background:rgba(255,69,58,0.9); animation:recPulse 1s ease-in-out infinite; }
        #recAllBtn:active, #playAllBtn:active { transform:scale(0.92); }
        @keyframes recPulse { 50% { opacity:0.5; } }
    `;
    document.head.appendChild(style);

    const recAllBtn = document.createElement('div');
    recAllBtn.id = 'recAllBtn';
    recAllBtn.innerHTML = 'REC';
    document.body.appendChild(recAllBtn);

    const playAllBtn = document.createElement('div');
    playAllBtn.id = 'playAllBtn';
    playAllBtn.innerHTML = '&#9654;';
    document.body.appendChild(playAllBtn);

    // ---- Состояние ----
    let _recOn = false;          // глобальная запись активна
    let _recRaf = null;          // rAF сэмплирования
    let _recStart = 0;           // старт сессии записи (обычный режим)
    let _playAll = false;        // глобальное воспроизведение активно
    let _masterRaf = null;
    let _masterStart = 0;
    let _maxDur = 1;

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

    function endPhase(m) {
        if (!m._samples || m._samples.length < 2) return 0;
        return (m._phaseOffset || 0) + m._samples[m._samples.length - 1].t;
    }

    function maxDurOf(cars) {
        return Math.max.apply(null, cars.map(endPhase).concat(1)) || 1;
    }

    // Применить состояние машинки на момент времени elapsed (мс) цикла.
    // Время отсчитывается от фазы (phaseOffset) начала записи машинки; вне
    // диапазона записи — держим ближайший крайний сэмпл.
    function sampleAt(marker, elapsed) {
        const s = marker._samples;
        if (!s || s.length < 2) return;
        let e = elapsed - (marker._phaseOffset || 0);
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

    function stopRec() {
        if (!_recOn) return;
        _recOn = false;
        if (_recRaf) cancelAnimationFrame(_recRaf);
        _recRaf = null;
        placedMarkers.forEach(m => {
            if (m._prevSamples && !hasMovement(m)) {
                m._samples = m._prevSamples; // тронули, но не сдвинули — вернуть старую запись
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
            const p = m._samples && m._samples[0];
            if (p) {
                m._lat = p.lat; m._lon = p.lon; m._heading = p.heading;
                m.update({ coordinates: [m._lon, m._lat] });
                updatePicMarker(m);
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
                m.update({ draggable: false });
                m._select.style.pointerEvents = 'none';
                changed = true;
            }
        });
        if (changed) {
            _maxDur = maxDurOf(placedMarkers.filter(m => m._playing && m._samples && m._samples.length >= 2));
        }
    }

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
        playAllBtn.innerHTML = _playAll ? '&#9632;' : '&#9654;';
    }

    recAllBtn.addEventListener('click', toggleRec);
    playAllBtn.addEventListener('click', () => { if (_playAll) { if (_recOn) stopRec(); stopAll(); } else startAll(); });

    // ---- Патч removeMarker: обновляем видимость кнопки PLAY ----
    const origRemove = window.removeMarker;
    window.removeMarker = function (marker) {
        origRemove(marker);
        updatePlayAllBtn();
    };
})();