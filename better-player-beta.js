/*
 * Lampa Better Player
 * v1.1.0-beta.1
 *
 * Features:
 * 1) Hold LEFT/RIGHT to scrub backward/forward.
 * 2) Netflix-like automatic next episode countdown.
 *
 * Designed for Lampa's internal player.
 */

(function () {
    'use strict';

    if (window.lampa_better_player_ready) return;
    window.lampa_better_player_ready = true;

    var VERSION = '1.1.0-beta.1';
    var COMPONENT = 'better_player';

    var playerActive = false;
    var initialized = false;
    var consumedKeyUp = 0;
    var session = null;
    var generation = 0;
    var monitor = null;
    var switching = false;
    var previewRequest = null;
    var previewBox = null;
    var previewImage = null;
    var diagnostics = { mode: 'Ещё не запускался', starts: 0, keys: 0, times: 0, switches: 0, previews: 0 };

    var hold = {
        active: false,
        long: false,
        direction: 0,
        keyCode: 0,
        timer: null,
        interval: null,
        target: 0,
        startPosition: 0,
        startedAt: 0,
        wasPaused: false,
        repeatCount: 0,
        lastEventAt: 0,
        releaseTimer: null
    };

    var next = {
        visible: false,
        cancelled: false,
        fired: false,
        lastSecond: -1,
        item: null
    };

    var overlay = null;
    var overlayMain = null;
    var overlaySub = null;

    function setting(name, fallback) {
        try {
            var value = Lampa.Storage.field(name);
            return typeof value === 'undefined' || value === null ? fallback : value;
        }
        catch (e) {
            return fallback;
        }
    }

    function boolSetting(name, fallback) {
        var value = setting(name, fallback);

        if (value === true || value === false) return value;
        if (value === 'true' || value === '1' || value === 1) return true;
        if (value === 'false' || value === '0' || value === 0) return false;

        return Boolean(value);
    }

    function numberSetting(name, fallback) {
        var value = parseFloat(setting(name, fallback));
        return isNaN(value) ? fallback : value;
    }

    function formatTime(seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0));

        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;

        if (h > 0) {
            return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }

        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function getVideo() {
        try {
            return Lampa.PlayerVideo && Lampa.PlayerVideo.video ? Lampa.PlayerVideo.video() : null;
        }
        catch (e) {
            return null;
        }
    }

    function isSelectOpened() {
        try {
            return Boolean(Lampa.Select && Lampa.Select.opened && Lampa.Select.opened());
        }
        catch (e) {
            return false;
        }
    }

    function nativeEvent(e) {
        return e && e.event ? e.event : e;
    }

    function eventCode(e) {
        if (!e) return 0;
        if (typeof e.code === 'number') return e.code;

        var ev = nativeEvent(e) || {};
        return ev.keyCode || ev.which || ({ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27})[ev.key || ev.code] || 0;
    }

    function stopEvent(e) {
        var ev = nativeEvent(e);
        if (!ev) return;

        /*
         * With Lampa.Keypad, preventDefault() is enough to make
         * keydownTrigger() stop before Controller.move('left/right').
         */
        try { ev.preventDefault(); } catch (err) {}
        try { ev.stopPropagation(); } catch (err) {}
    }

    function isLeft(code) {
        return code === 37 || code === 4;
    }

    function isRight(code) {
        return code === 39 || code === 5;
    }

    function isEnter(code) {
        return code === 13 || code === 29443 || code === 117 || code === 65385;
    }

    function isBack(code) {
        return code === 8 || code === 27 || code === 461 || code === 10009 || code === 88;
    }

    function isAppleTV() {
        try {
            return Boolean(Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('apple_tv'));
        }
        catch (e) {
            return false;
        }
    }

    function createOverlay() {
        if (overlay) return;

        var style = document.createElement('style');
        style.id = 'better-player-style';
        style.textContent =
            '#better-player-overlay{' +
                'position:fixed;' +
                'left:50%;' +
                'bottom:11%;' +
                'transform:translateX(-50%);' +
                'z-index:999999;' +
                'min-width:360px;' +
                'max-width:72vw;' +
                'padding:18px 26px;' +
                'border-radius:14px;' +
                'background:rgba(10,10,10,.88);' +
                'box-shadow:0 10px 40px rgba(0,0,0,.45);' +
                'color:#fff;' +
                'font-family:Arial,sans-serif;' +
                'text-align:center;' +
                'pointer-events:none;' +
                'opacity:0;' +
                'transition:opacity .15s ease;' +
            '}' +
            '#better-player-overlay.show{opacity:1;}' +
            '#better-player-overlay .bp-main{' +
                'font-size:28px;' +
                'font-weight:700;' +
                'line-height:1.25;' +
            '}' +
            '#better-player-overlay .bp-sub{' +
                'margin-top:8px;' +
                'font-size:18px;' +
                'line-height:1.35;' +
                'opacity:.78;' +
            '}' +
            '@media(max-width:700px){' +
                '#better-player-overlay{' +
                    'min-width:0;' +
                    'width:78vw;' +
                    'padding:14px 18px;' +
                '}' +
                '#better-player-overlay .bp-main{font-size:22px;}' +
                '#better-player-overlay .bp-sub{font-size:15px;}' +
            '}';

        style.textContent += '.bp-setting .settings-param__name{white-space:normal;overflow-wrap:break-word;line-height:1.35}' +
            '.bp-setting .settings-param__descr{white-space:normal;overflow-wrap:break-word;line-height:1.45;margin-top:.5em;font-size:.9em}' +
            '.bp-setting .settings-param__value{line-height:1.35}';
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'better-player-overlay';

        overlayMain = document.createElement('div');
        overlayMain.className = 'bp-main';

        overlaySub = document.createElement('div');
        overlaySub.className = 'bp-sub';

        previewBox = document.createElement('div');
        previewBox.style.cssText = 'position:relative;overflow:hidden;margin:0 auto 12px;display:none;';
        previewImage = document.createElement('img');
        previewImage.style.cssText = 'position:absolute;max-width:none;left:0;top:0;';
        previewImage.onerror = function () { previewBox.style.display = 'none'; };
        previewBox.appendChild(previewImage);
        overlay.appendChild(previewBox);
        overlay.appendChild(overlayMain);
        overlay.appendChild(overlaySub);
        document.body.appendChild(overlay);
    }

    function showOverlay(main, sub) {
        createOverlay();

        if (previewBox) previewBox.style.display = 'none';
        overlayMain.textContent = main || '';
        overlaySub.textContent = sub || '';
        overlay.classList.add('show');
    }

    function hideOverlay() {
        if (overlay) overlay.classList.remove('show');
    }

    function holdRate(elapsedMs) {
        if (elapsedMs < 1400) return 12;
        if (elapsedMs < 3000) return 30;
        if (elapsedMs < 5000) return 60;
        return 120;
    }

    function updateHoldOverlay(video) {
        var diff = hold.target - hold.startPosition;
        var sign = diff >= 0 ? '+' : '-';
        var icon = hold.direction > 0 ? '▶▶' : '◀◀';

        showOverlay(
            icon + '  ' + sign + formatTime(Math.abs(diff)),
            formatTime(hold.target) + ' / ' + formatTime(video.duration)
        );
        showPreview(hold.target);
    }

    function beginLongHold() {
        if (!hold.active || hold.long || !playerActive) return;

        var video = getVideo();

        if (!video || !video.duration || isNaN(video.duration) || !isFinite(video.duration)) {
            resetHold(false);
            return;
        }

        hold.long = true;
        hold.wasPaused = Boolean(video.paused);
        hold.startPosition = video.currentTime || 0;
        hold.target = hold.startPosition;
        hold.startedAt = Date.now();

        try {
            if (!hold.wasPaused && Lampa.PlayerVideo && Lampa.PlayerVideo.pause) {
                Lampa.PlayerVideo.pause();
            }
            else if (!hold.wasPaused) {
                video.pause();
            }
        }
        catch (e) {}

        updateHoldOverlay(video);

        var lastTick = Date.now();

        hold.interval = setInterval(function () {
            if (!hold.active || !playerActive) {
                resetHold(false);
                return;
            }

            var now = Date.now();
            var deltaSeconds = Math.max(0.05, (now - lastTick) / 1000);
            var elapsed = now - hold.startedAt;
            var rate = holdRate(elapsed);

            lastTick = now;

            hold.target += hold.direction * rate * deltaSeconds;
            hold.target = Math.max(0, Math.min(hold.target, video.duration));

            updateHoldOverlay(video);
        }, 100);
    }

    function finishLongHold() {
        var video = getVideo();

        if (video && video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
            try {
                video.currentTime = Math.max(0, Math.min(hold.target, video.duration));
            }
            catch (e) {}

            if (!hold.wasPaused) {
                try {
                    if (Lampa.PlayerVideo && Lampa.PlayerVideo.play) Lampa.PlayerVideo.play();
                    else video.play();
                }
                catch (e2) {}
            }
        }

        hideOverlay();
    }

    function resetHold(commit) {
        clearTimeout(hold.timer);
        clearTimeout(hold.releaseTimer);
        clearInterval(hold.interval);

        if (commit && hold.long) finishLongHold();
        else if (hold.long) {
            hideOverlay();
            if (playerActive && !hold.wasPaused) {
                try { Lampa.PlayerVideo.play(); } catch (e) {}
            }
        }

        hold.active = false;
        hold.long = false;
        hold.direction = 0;
        hold.keyCode = 0;
        hold.timer = null;
        hold.interval = null;
        hold.target = 0;
        hold.startPosition = 0;
        hold.startedAt = 0;
        hold.wasPaused = false;
        hold.repeatCount = 0;
        hold.lastEventAt = 0;
        hold.releaseTimer = null;
    }

    function startHold(e, direction) {
        if (hold.active) return;

        var video = getVideo();

        if (!video || !video.duration || isNaN(video.duration) || !isFinite(video.duration)) return;

        hold.active = true;
        hold.long = false;
        hold.direction = direction;
        hold.keyCode = eventCode(e);
        hold.repeatCount = 1;
        hold.lastEventAt = Date.now();

        var threshold = numberSetting('better_player_hold_delay', 450);

        hold.timer = setTimeout(function () {
            /*
             * Normal remotes expose a real press duration.
             * Apple TV may not, so Apple TV primarily uses repeated
             * directional events below.
             */
            if (!isAppleTV()) beginLongHold();
        }, threshold);

        if (isAppleTV()) scheduleAppleTVRelease();
    }

    function scheduleAppleTVRelease() {
        clearTimeout(hold.releaseTimer);

        /*
         * Siri Remote / tvOS wrappers may not deliver a reliable keyup.
         * Treat a short gap after the last repeated direction event as release.
         */
        hold.releaseTimer = setTimeout(function () {
            if (!hold.active) return;

            if (hold.long) {
                resetHold(true);
            }
            else {
                var direction = hold.direction;
                resetHold(false);
                shortSeek(direction);
            }
        }, 520);
    }

    function repeatHold(direction) {
        if (!hold.active) return;

        var now = Date.now();

        if (direction !== hold.direction) {
            if (hold.long) resetHold(true);
            else resetHold(false);
            return;
        }

        hold.repeatCount += 1;
        hold.lastEventAt = now;

        if (isAppleTV()) {
            scheduleAppleTVRelease();

            /*
             * Two or more rapidly repeated direction events means the
             * Siri Remote is being held/swiped continuously.
             */
            if (!hold.long && hold.repeatCount >= 2) {
                clearTimeout(hold.timer);
                beginLongHold();
            }
        }
    }

    function shortSeek(direction) {
        var step = numberSetting('better_player_seek_step', 10);

        try {
            if (Lampa.PlayerVideo && Lampa.PlayerVideo.rewind) {
                Lampa.PlayerVideo.rewind(direction > 0, step);
            }
            else {
                var video = getVideo();

                if (video) {
                    video.currentTime = Math.max(
                        0,
                        Math.min(video.currentTime + direction * step, video.duration || Infinity)
                    );
                }
            }
        }
        catch (e) {}
    }

    function nextItemInfo() {
        try {
            if (!Lampa.PlayerPlaylist) return null;
            if (!Lampa.PlayerPlaylist.canNext || !Lampa.PlayerPlaylist.canNext()) return null;

            var list = Lampa.PlayerPlaylist.get ? Lampa.PlayerPlaylist.get() : [];
            var pos = Lampa.PlayerPlaylist.position ? Lampa.PlayerPlaylist.position() : -1;

            if (!list || pos < 0 || !list[pos + 1]) return null;

            return list[pos + 1];
        }
        catch (e) {
            return null;
        }
    }

    function nextTitle(item) {
        if (!item) return 'Следующая серия';

        return item.title ||
               item.name ||
               item.label ||
               (
                   (typeof item.season !== 'undefined' ? 'S' + item.season : '') +
                   (typeof item.episode !== 'undefined' ? 'E' + item.episode : '')
               ) ||
               'Следующая серия';
    }

    function hideNext() {
        next.visible = false;
        next.lastSecond = -1;
        next.item = null;
        hideOverlay();
    }

    function cancelNext() {
        next.cancelled = true;
        hideNext();
    }

    function playNextNow() {
        if (next.fired) return;

        try {
            if (!Lampa.PlayerPlaylist || !Lampa.PlayerPlaylist.canNext || !Lampa.PlayerPlaylist.canNext()) {
                hideNext();
                return;
            }

            next.fired = true;
            hideNext();
            Lampa.PlayerPlaylist.next();
        }
        catch (e) {
            next.fired = false;
            hideNext();
        }
    }

    function updateAutoNext(e) {
        if (!playerActive) return;
        if (!boolSetting('better_player_auto_next', true)) {
            if (next.visible) hideNext();
            return;
        }

        if (next.cancelled || next.fired || hold.long) return;

        var duration = e && typeof e.duration === 'number' ? e.duration : 0;
        var current = e && typeof e.current === 'number' ? e.current : 0;

        if (!duration || duration <= 0 || isNaN(duration) || !isFinite(duration)) return;

        var item = nextItemInfo();

        if (!item) {
            if (next.visible) hideNext();
            return;
        }

        var countdown = numberSetting('better_player_next_countdown', 10);
        var remaining = Math.max(0, duration - current);

        if (remaining > countdown) {
            if (next.visible) hideNext();
            return;
        }

        var seconds = Math.max(0, Math.ceil(remaining));

        next.visible = true;
        next.item = item;

        if (seconds !== next.lastSecond) {
            next.lastSecond = seconds;

            showOverlay(
                'Следующая серия через ' + seconds + ' сек',
                nextTitle(item) + '  •  OK — сейчас  •  Назад — скрыть'
            );
        }

        if (remaining <= 0.35) {
            playNextNow();
        }
    }

    function onKeyDown(e) {
        if (!playerActive) return;
        diagnostics.keys += 1;
        if (!seekContext()) {
            if (hold.active) resetHold(false);
            return;
        }
        var code = eventCode(e);

        if (next.visible) {
            if (isEnter(code)) {
                stopEvent(e);
                consumedKeyUp = code;
                playNextNow();
                return;
            }

            if (isBack(code)) {
                stopEvent(e);
                cancelNext();
                return;
            }
        }

        if (!boolSetting('better_player_hold_seek', true)) return;
        if (isSelectOpened()) return;

        var direction = isRight(code) ? 1 : (isLeft(code) ? -1 : 0);

        if (!direction) {
            if (hold.active) {
                if (isBack(code)) { stopEvent(e); resetHold(false); }
                else resetHold(true);
            }
            return;
        }
        if (!getVideo() || !isFinite(getVideo().duration) || getVideo().duration <= 0) return;
        stopEvent(e);

        if (hold.active) {
            if (direction !== hold.direction) {
                resetHold(true);
                startHold(e, direction);
            }
            else repeatHold(direction);
            return;
        }

        startHold(e, direction);
    }

    function onKeyUp(e) {
        if (consumedKeyUp && eventCode(e) === consumedKeyUp) {
            consumedKeyUp = 0;
            stopEvent(e);
            return;
        }
        if (!playerActive || !hold.active) return;

        var code = eventCode(e);

        if (code !== hold.keyCode && !(isLeft(code) || isRight(code))) return;

        stopEvent(e);

        clearTimeout(hold.timer);
        clearTimeout(hold.releaseTimer);

        if (hold.long) {
            resetHold(true);
        }
        else {
            var direction = hold.direction;
            resetHold(false);
            shortSeek(direction);
        }
    }

    function resetEpisodeState() {
        resetHold(false);

        next.visible = false;
        next.cancelled = false;
        next.fired = false;
        next.lastSecond = -1;
        next.item = null;

        hideOverlay();
    }

    function onEnded() {
        var started = diagnostics.starts;
        setTimeout(function () {
            // Lampa's own playlist handler may already have opened the next item.
            if (playerActive && started === diagnostics.starts && !next.cancelled &&
                boolSetting('better_player_auto_next', true)) playNextNow();
        }, 0);
    }

    function seekContext() {
        if (isSelectOpened()) return false;
        try {
            var name = Lampa.Controller.enabled().name;
            return name === 'player' || name === 'player_rewind';
        } catch (e) { return false; }
    }

    function onPlayerStart(data) {
        stopSession();
        playerActive = true;
        resetEpisodeState();
        diagnostics.mode = 'Внутренний плеер Lampa';
        diagnostics.starts += 1;
        diagnostics.times = 0;
        diagnostics.keys = 0;
        diagnostics.previews = 0;
        var video = getVideo();
        session = {
            id: ++generation, data: data || {}, qualities: qualityList(data && data.quality),
            attempted: {}, lastTime: 0, lastProgress: Date.now(), position: 0,
            manual: false, restore: null, cues: [], failed: false
        };
        if (session.data.url) session.attempted[session.data.url] = true;
        loadPreviews(session);
        applyTheme();
        monitor = setInterval(checkPlayback, 1000);
    }

    function stopSession() {
        clearInterval(monitor);
        monitor = null;
        generation += 1;
        if (previewRequest) { previewRequest.abort(); previewRequest = null; }
        session = null;
    }

    function onPlayerDestroy() {
        playerActive = false;
        resetEpisodeState();
        stopSession();
        applyTheme();
    }

    function onExternal() {
        onPlayerDestroy();
        diagnostics.mode = 'Внешний / нативный плеер — управление Better Player недоступно';
        saveDiagnostics();
    }

    function onTimeUpdate(e) {
        if (!playerActive) return;
        diagnostics.times += 1;
        if (session && e && isFinite(e.current)) {
            if (Math.abs(e.current - session.lastTime) > 0.05) session.lastProgress = Date.now();
            session.lastTime = e.current;
            if (!session.restore) session.position = e.current;
        }
        updateAutoNext(e);
    }

    function safeURL(value, base) {
        try {
            var url = new URL(value, base || window.location.href);
            return /^https?:$/.test(url.protocol) ? url.href : '';
        } catch (e) { return ''; }
    }

    function qualityList(quality) {
        if (!quality || typeof quality !== 'object' || Array.isArray(quality)) return [];
        return Object.keys(quality).map(function (name) {
            var item = quality[name];
            return {name: name, height: parseInt(name, 10), url: safeURL(typeof item === 'string' ? item : item && item.url)};
        }).filter(function (item) { return item.height > 0 && item.url; })
            .sort(function (a, b) { return b.height - a.height; });
    }

    function switchQuality(item) {
        if (!session || !playerActive || !Lampa.PlayerPanel || !Lampa.PlayerPanel.listener) return false;
        var video = getVideo();
        var current = session;
        if (!video || current.restore || current.attempted[item.url]) return false;
        current.attempted[item.url] = true;
        current.restore = {time: current.position, paused: Boolean(video.paused), since: Date.now()};
        current.lastProgress = Date.now();
        current.failed = false;
        switching = true;
        try {
            Lampa.PlayerPanel.listener.send('quality', {name: item.name, url: item.url});
            current.data.url = item.url;
            diagnostics.switches += 1;
            return true;
        } finally { switching = false; }
    }

    function restorePosition() {
        if (!session || !session.restore || !playerActive) return;
        var video = getVideo();
        var restore = session.restore;
        if (!video || !isFinite(video.duration) || video.duration <= 0) return;
        try { video.currentTime = Math.min(restore.time, Math.max(0, video.duration - 0.5)); }
        catch (e) { return; }
        if (restore.paused) Lampa.PlayerVideo.pause();
        session.lastProgress = Date.now();
        session.lastTime = restore.time;
        session.position = restore.time;
        session.restore = null;
    }

    function onPlayerReady() {
        if (!session || !boolSetting('better_player_auto_quality', false)) return;
        var limit = numberSetting('better_player_quality_cap', 1080);
        var selected = session.qualities.filter(function (q) { return q.url === session.data.url; })[0];
        var target = session.qualities.filter(function (q) { return q.height <= limit; })[0];
        // Only enforce a cap on a known discrete rendition, never replace a master manifest.
        if (selected && target && selected.height > limit) {
            var initial = session;
            var id = initial.id;
            setTimeout(function () {
                if (session && session.id === id) switchQuality(target);
            }, 1000);
        }
    }

    function recoverPlayback(reason) {
        if (!session || !playerActive || session.manual || hold.active) return;
        if (reason === 'stall' && !boolSetting('better_player_auto_quality', false)) return;
        if (reason === 'error' && !boolSetting('better_player_fallback', false)) return;
        var current = session;
        if (current.failed) return;
        // If a replacement failed, keep the original position and pause intent.
        var saved = current.restore;
        current.restore = null;
        var selected = current.qualities.filter(function (q) { return q.url === current.data.url; })[0];
        var target = current.qualities.filter(function (q) {
            return !current.attempted[q.url] && selected && q.height < selected.height;
        })[0];
        if (target && switchQuality(target)) {
            if (saved) current.restore = {time: saved.time, paused: saved.paused, since: Date.now()};
        } else {
            current.restore = saved;
            current.failed = true;
        }
    }

    function checkPlayback() {
        if (!session || !playerActive) return;
        var video = getVideo();
        if (!video) return;
        if (session.restore) {
            if (Date.now() - session.restore.since > 15000) recoverPlayback('error');
            return;
        }
        if (hold.active || video.paused || video.seeking || video.ended || !isFinite(video.duration) ||
            video.duration <= 0 || isSelectOpened() || !seekContext()) {
            session.lastProgress = Date.now();
            return;
        }
        if (Math.abs(video.currentTime - session.lastTime) > 0.05) {
            session.lastTime = video.currentTime;
            session.position = video.currentTime;
            session.lastProgress = Date.now();
        }
        if (video.readyState < 3 && Date.now() - session.lastProgress > 15000) recoverPlayback('stall');
    }

    function parseStamp(value) {
        if (!/^(?:\d+:)?\d{2}:\d{2}\.\d{3}$/.test(value)) return NaN;
        return value.split(':').reduce(function (a, b) { return a * 60 + Number(b); }, 0);
    }

    function parseVTT(text, base) {
        if (typeof text !== 'string' || text.length > 1048576 || !/^\uFEFF?WEBVTT/.test(text)) return [];
        var cues = [];
        text.replace(/\r/g, '').split(/\n\s*\n/).forEach(function (block) {
            var lines = block.split('\n');
            for (var i = 0; i < lines.length - 1; i++) {
                var match = lines[i].match(/^(\S+)\s+-->\s+(\S+)/);
                if (!match) continue;
                var start = parseStamp(match[1]), end = parseStamp(match[2]);
                var raw = lines[i + 1].trim();
                var crop = raw.match(/#xywh=(\d+),(\d+),(\d+),(\d+)$/);
                var url = safeURL(raw.replace(/#xywh=.*$/, ''), base);
                if (!url || !isFinite(start) || !isFinite(end) || start < 0 || end <= start) continue;
                var cue = {start: start, end: end, url: url, x: 0, y: 0, w: 320, h: 180, crop: false};
                if (crop) {
                    cue.x = Number(crop[1]); cue.y = Number(crop[2]);
                    cue.w = Number(crop[3]); cue.h = Number(crop[4]); cue.crop = true;
                    if (!cue.w || !cue.h || cue.w > 8192 || cue.h > 8192 || cue.x > 65536 || cue.y > 65536) continue;
                }
                if (cues.length < 10000) cues.push(cue);
            }
        });
        return cues.sort(function (a, b) { return a.start - b.start; });
    }

    function loadPreviews(current) {
        var meta = current.data.better_player;
        if (!boolSetting('better_player_thumbnails', true) || !meta || !meta.thumbnail_vtt) return;
        var url = safeURL(meta.thumbnail_vtt);
        if (!url) return;
        var request = new XMLHttpRequest();
        previewRequest = request;
        request.open('GET', url, true);
        request.timeout = 8000;
        request.onload = function () {
            if (session !== current || request.status < 200 || request.status >= 300) return;
            current.cues = parseVTT(request.responseText, url);
            diagnostics.previews = current.cues.length;
            if (previewRequest === request) previewRequest = null;
        };
        request.onerror = request.ontimeout = function () {};
        request.onprogress = function (e) { if (e.loaded > 1048576) request.abort(); };
        request.send();
    }

    function showPreview(time) {
        if (!session || !previewBox || !boolSetting('better_player_thumbnails', true)) return;
        var cue = session.cues.filter(function (c) { return time >= c.start && time < c.end; })[0];
        if (!cue) return;
        var scale = Math.min(320 / cue.w, 180 / cue.h);
        previewBox.style.width = Math.round(cue.w * scale) + 'px';
        previewBox.style.height = Math.round(cue.h * scale) + 'px';
        previewImage.style.width = cue.crop ? 'auto' : '320px';
        previewImage.style.height = cue.crop ? 'auto' : '180px';
        previewImage.style.transformOrigin = '0 0';
        previewImage.style.transform = 'scale(' + scale + ')';
        previewImage.style.left = (-cue.x * scale) + 'px';
        previewImage.style.top = (-cue.y * scale) + 'px';
        if (previewImage.getAttribute('src') !== cue.url) previewImage.src = cue.url;
        previewBox.style.display = 'block';
    }

    function applyTheme() {
        document.body.classList.toggle('bp-cinema', playerActive && boolSetting('better_player_cinema_ui', false));
    }

    function diagnosticReport() {
        return {
            version: VERSION, mode: diagnostics.mode,
            appleTV: isAppleTV(), starts: diagnostics.starts,
            keyEvents: diagnostics.keys, timeEvents: diagnostics.times,
            qualitySwitches: diagnostics.switches,
            availableQualities: session ? session.qualities.length : 0,
            thumbnailCues: diagnostics.previews,
            recommendations: Boolean(Lampa.ContentRows && Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb)
        };
    }

    function saveDiagnostics() {
        try { Lampa.Storage.set('better_player_last_diagnostics', diagnosticReport()); } catch (e) {}
    }

    function addExtendedSettings() {
        function trigger(name, title, description, initial) {
            addParam({component: COMPONENT,
                param: {name: name, type: 'trigger', default: initial},
                field: {name: title, description: description}, onChange: applyTheme});
        }
        trigger('better_player_auto_quality', 'Автоснижение качества (бета)', 'Внутренний плеер: ниже качество после 15 секунд буферизации. Ручной выбор отключает автоматику до следующего запуска.', false);
        trigger('better_player_fallback', 'Запасное качество при ошибке (бета)', 'Пробует меньшие качества того же видео. Другие провайдеры Mando пока не подключены.', false);
        trigger('better_player_cinema_ui', 'Кинооформление плеера', 'Тёмная панель и красная шкала. Только внутренний плеер Lampa.', false);
        trigger('better_player_thumbnails', 'Кадры при перемотке', 'Работает, когда источник передаёт Better Player VTT-файл с кадрами.', true);
        trigger('better_player_recommendations', 'Подборка по моим лайкам', 'Берёт до четырёх любимых фильмов/сериалов и запрашивает кандидатов через настроенный TMDB. Сортирует на устройстве; сервер Better Player не используется.', false);
        addParam({component: COMPONENT,
            param: {name: 'better_player_quality_cap', type: 'select', values: {'720':'720p', '1080':'1080p', '1440':'1440p', '2160':'2160p'}, default: '1080'},
            field: {name: 'Потолок автоматического качества', description: 'Действует при включённом автоснижении. Не управляет адаптацией HLS master-потока.'}});
        addParam({component: COMPONENT, param: {name: 'better_player_diagnostics', type: 'static'},
            field: {name: 'Диагностика Better Player ' + VERSION, description: 'Сначала запусти фильм, затем вернись сюда.'},
            onRender: function (item) {
                var d = diagnosticReport();
                item.find('.settings-param__descr').text(d.mode + ' · события времени: ' + d.timeEvents +
                    ' · кнопки: ' + d.keyEvents + ' · переключения: ' + d.qualitySwitches + ' · кадры: ' + d.thumbnailCues);
            }});
        var style = document.createElement('style');
        style.textContent = '.bp-cinema .player-panel{background:linear-gradient(transparent,rgba(0,0,0,.96));padding-bottom:2em}' +
            '.bp-cinema .player-panel__position > div{background:#e50914}' +
            '.bp-cinema #better-player-overlay{border-radius:6px;border-bottom:3px solid #e50914;background:rgba(15,15,15,.96)}';
        document.head.appendChild(style);
    }

    function mediaType(card) {
        return card && (card.media_type === 'tv' || card.first_air_date || card.name && !card.title) ? 'tv' : 'movie';
    }
    function cardKey(card) { return mediaType(card) + ':' + card.id; }
    function validCard(card) { return card && /^\d+$/.test(String(card.id)) && (!card.source || card.source === 'tmdb'); }
    function genres(card) {
        return card.genre_ids || (card.genres || []).map(function (g) { return g.id; });
    }
    function tokens(card) {
        return (card.overview || '').toLowerCase().split(/[^a-zа-яёіїєґ0-9]+/).filter(function (t) { return t.length > 4; });
    }
    function overlap(a, b) {
        var set = {};
        a.forEach(function (x) { set[x] = true; });
        var common = 0, seen = {};
        b.forEach(function (x) { if (!seen[x] && set[x]) common++; seen[x] = true; });
        return common / Math.max(1, Object.keys(set).length + Object.keys(seen).length - common);
    }
    function rankCandidates(candidates, seeds, excluded) {
        var seen = {}, pool = [];
        candidates.forEach(function (card) {
            if (!validCard(card) || card.adult || excluded[cardKey(card)] || seen[cardKey(card)]) return;
            seen[cardKey(card)] = true;
            var best = 0, reason = '';
            seeds.forEach(function (seed) {
                var score = 3 * overlap(genres(card), genres(seed)) + 2 * overlap(tokens(card), tokens(seed)) +
                    (card.original_language && card.original_language === seed.original_language ? 0.15 : 0);
                if (score > best) { best = score; reason = seed.title || seed.name || ''; }
            });
            pool.push({card: card, score: best, reason: reason});
        });
        var picked = [];
        // Greedy diversity penalty avoids a whole row of near-identical genre combinations.
        while (pool.length && picked.length < 20) {
            pool.sort(function (a, b) {
                function adjusted(item) {
                    var redundancy = 0;
                    picked.forEach(function (p) { redundancy = Math.max(redundancy, overlap(genres(item.card), genres(p.card))); });
                    return item.score - 0.7 * redundancy;
                }
                return adjusted(b) - adjusted(a) || cardKey(a.card).localeCompare(cardKey(b.card));
            });
            picked.push(pool.shift());
        }
        return picked.map(function (item) {
            var copy = Object.assign({}, item.card);
            copy.media_type = mediaType(copy);
            copy.source = 'tmdb';
            return copy;
        });
    }

    function favorites(type) {
        try { return Lampa.Favorite.get({type: type}).filter(validCard); } catch (e) { return []; }
    }

    function addRecommendations() {
        if (!Lampa.ContentRows || !Lampa.Api || !Lampa.Api.sources || !Lampa.Api.sources.tmdb) return;
        Lampa.ContentRows.add({name: 'better_player_for_you', title: 'По твоим лайкам · Better Player', index: 2, screen: ['main'],
            call: function () {
                if (!boolSetting('better_player_recommendations', true)) return;
                var seeds = favorites('like').slice(0, 4);
                if (!seeds.length) return;
                var excluded = {};
                ['like', 'history', 'look', 'viewed', 'thrown'].forEach(function (type) {
                    favorites(type).forEach(function (card) { excluded[cardKey(card)] = true; });
                });
                return function (done) {
                    var remaining = seeds.length, all = [], finished = false;
                    var timer = setTimeout(finish, 12000);
                    function finish() {
                        if (finished) return;
                        finished = true;
                        clearTimeout(timer);
                        done({title: 'По твоим лайкам · Better Player', results: rankCandidates(all, seeds, excluded)});
                    }
                    seeds.forEach(function (seed) {
                        var settled = false;
                        function accept(result) {
                            if (finished || settled) return;
                            settled = true;
                            (result && result.results || []).forEach(function (card) {
                                all.push(Object.assign({}, card, {media_type: mediaType(seed), source: 'tmdb'}));
                            });
                            remaining--;
                            if (!remaining) finish();
                        }
                        try {
                            Lampa.Api.sources.tmdb.get(mediaType(seed) + '/' + seed.id + '/recommendations', {page: 1}, accept, function () { accept(null); });
                        } catch (e) { accept(null); }
                    });
                };
            }});
    }

    function addParam(config) {
        if (config.param.type === 'select') {
            var saved = setting(config.param.name, config.param.default);
            if (!Object.prototype.hasOwnProperty.call(config.param.values, String(saved))) {
                Lampa.Storage.set(config.param.name, config.param.default);
            }
        }
        var originalRender = config.onRender;
        config.onRender = function (item) {
            item.addClass('bp-setting');
            if (originalRender) originalRender(item);
        };
        Lampa.SettingsApi.addParam(config);
    }

    function addSettings() {
        try {
            Lampa.SettingsApi.addComponent({
                component: COMPONENT,
                name: 'Better Player',
                icon:
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                    '<path fill="currentColor" d="M8 5v14l11-7zM3 5h2v14H3z"/>' +
                    '</svg>'
            });

            addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_hold_seek',
                    type: 'trigger',
                    default: true
                },
                field: {
                    name: 'Перемотка удержанием',
                    description: 'Удерживай ← или → для быстрой непрерывной перемотки'
                }
            });

            addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_seek_step',
                    type: 'select',
                    values: {'5':'5 сек', '10':'10 сек', '15':'15 сек', '30':'30 сек'},
                    default: '10'
                },
                field: {
                    name: 'Шаг перемотки',
                    description: 'На сколько секунд перематывать обычным нажатием ← или →'
                }
            });

            addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_hold_delay',
                    type: 'select',
                    values: {'350':'350 мс', '450':'450 мс', '600':'600 мс', '800':'800 мс'},
                    default: '450'
                },
                field: {
                    name: 'Задержка удержания',
                    description: 'Через сколько миллисекунд включать быструю перемотку'
                }
            });

            addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_auto_next',
                    type: 'trigger',
                    default: true
                },
                field: {
                    name: 'Следующая серия',
                    description: 'Показывать отсчёт и автоматически запускать следующую серию'
                }
            });

            addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_next_countdown',
                    type: 'select',
                    values: {'5':'5 сек', '10':'10 сек', '15':'15 сек', '20':'20 сек', '30':'30 сек'},
                    default: '10'
                },
                field: {
                    name: 'Отсчёт перед серией',
                    description: 'За сколько секунд до конца показывать окно перехода'
                }
            });
        }
        catch (e) {
            console.log('[Better Player] settings error:', e);
        }
    }

    function init() {
        if (initialized) return;
        initialized = true;
        createOverlay();
        addSettings();

        /*
         * TV fix: listen through Lampa.Keypad instead of document.
         * On a number of Smart TV browsers keyboard events are handled
         * at window level and never reach document capture listeners.
         * Keypad also normalizes remote-control key codes.
         */
        try {
            if (Lampa.Keypad && Lampa.Keypad.listener) {
                Lampa.Keypad.listener.follow('keydown', onKeyDown);
                Lampa.Keypad.listener.follow('keyup', onKeyUp);
            }
            else {
                window.addEventListener('keydown', onKeyDown, true);
                window.addEventListener('keyup', onKeyUp, true);
            }
        }
        catch (e) {
            window.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('keyup', onKeyUp, true);
        }

        try {
            Lampa.Player.listener.follow('start', onPlayerStart);
            Lampa.Player.listener.follow('destroy', function () { saveDiagnostics(); onPlayerDestroy(); });
            Lampa.Player.listener.follow('external', onExternal);
            Lampa.Player.listener.follow('ready', onPlayerReady);
            Lampa.PlayerVideo.listener.follow('timeupdate', onTimeUpdate);
            Lampa.PlayerVideo.listener.follow('ended', onEnded);
            Lampa.PlayerVideo.listener.follow('loadeddata', restorePosition);
            Lampa.PlayerVideo.listener.follow('error', function (e) {
                if (e && e.fatal) recoverPlayback('error');
            });
            if (Lampa.PlayerPanel && Lampa.PlayerPanel.listener) {
                Lampa.PlayerPanel.listener.follow('quality', function () {
                    if (session && !switching) { session.manual = true; session.restore = null; }
                });
            }
        }
        catch (e) {
            console.log('[Better Player] player listener error:', e);
        }

        window.LampaBetterPlayer = {
            version: VERSION,
            reset: resetEpisodeState,
            diagnostics: diagnosticReport,
            rank: rankCandidates,
            parseVTT: parseVTT
        };

        addExtendedSettings();
        addRecommendations();
        console.log('[Better Player] loaded v' + VERSION + (isAppleTV() ? ' [Apple TV mode]' : ''));
    }

    if (window.appready) {
        init();
    }
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
