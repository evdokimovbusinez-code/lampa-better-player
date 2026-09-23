/*
 * Lampa Better Player
 * v1.0.2
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

    var VERSION = '1.0.2';
    var COMPONENT = 'better_player';

    var playerActive = false;
    var playerDestroyBound = false;

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
        if (typeof e.code !== 'undefined') return e.code;

        var ev = nativeEvent(e) || {};
        return ev.keyCode || ev.which || 0;
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

        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'better-player-overlay';

        overlayMain = document.createElement('div');
        overlayMain.className = 'bp-main';

        overlaySub = document.createElement('div');
        overlaySub.className = 'bp-sub';

        overlay.appendChild(overlayMain);
        overlay.appendChild(overlaySub);
        document.body.appendChild(overlay);
    }

    function showOverlay(main, sub) {
        createOverlay();

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
        else if (hold.long) hideOverlay();

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
                nextTitle(item) + '  •  OK — сейчас  •  Назад — отмена'
            );
        }

        if (remaining <= 0.35) {
            playNextNow();
        }
    }

    function onKeyDown(e) {
        if (!playerActive) return;

        var code = eventCode(e);

        if (next.visible) {
            if (isEnter(code)) {
                stopEvent(e);
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

        if (!direction) return;

        stopEvent(e);

        if (hold.active) {
            repeatHold(direction);
            return;
        }

        startHold(e, direction);
    }

    function onKeyUp(e) {
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

    function onPlayerStart() {
        playerActive = true;
        resetEpisodeState();

        function onTimeUpdate(e) {
            updateAutoNext(e);
        }

        function onDestroy() {
            playerActive = false;
            resetEpisodeState();

            try {
                Lampa.PlayerVideo.listener.remove('timeupdate', onTimeUpdate);
            }
            catch (e) {}

            try {
                Lampa.Player.listener.remove('destroy', onDestroy);
            }
            catch (e2) {}
        }

        try {
            Lampa.PlayerVideo.listener.follow('timeupdate', onTimeUpdate);
            Lampa.Player.listener.follow('destroy', onDestroy);
        }
        catch (e) {}
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

            Lampa.SettingsApi.addParam({
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

            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_seek_step',
                    type: 'select',
                    values: '5,10,15,30',
                    default: '10'
                },
                field: {
                    name: 'Шаг короткого нажатия, сек',
                    description: 'На сколько секунд перематывать обычным нажатием ← или →'
                }
            });

            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_hold_delay',
                    type: 'select',
                    values: '350,450,600,800',
                    default: '450'
                },
                field: {
                    name: 'Задержка удержания, мс',
                    description: 'Через сколько миллисекунд включать быструю перемотку'
                }
            });

            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_auto_next',
                    type: 'trigger',
                    default: true
                },
                field: {
                    name: 'Автозапуск следующей серии',
                    description: 'Показывать отсчёт и автоматически запускать следующую серию'
                }
            });

            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: {
                    name: 'better_player_next_countdown',
                    type: 'select',
                    values: '5,10,15,20,30',
                    default: '10'
                },
                field: {
                    name: 'Отсчёт до следующей серии, сек',
                    description: 'За сколько секунд до конца показывать окно перехода'
                }
            });
        }
        catch (e) {
            console.log('[Better Player] settings error:', e);
        }
    }

    function init() {
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
        }
        catch (e) {
            console.log('[Better Player] player listener error:', e);
        }

        window.LampaBetterPlayer = {
            version: VERSION,
            reset: resetEpisodeState
        };

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
