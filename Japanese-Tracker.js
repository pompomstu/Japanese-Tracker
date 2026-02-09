// ==UserScript==
// @name         Japanese-Tracker Lite
// @namespace    http://tampermonkey.net/
// @version      3.8
// @description  Daily % + time-to-goal; stopwatch fully hidden when minimized; stopwatch moved to bottom; fixed rolling save to keep last 5; bugfixes & minor perf tweaks
// @match        *://www.netflix.com/watch/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---------- Config ----------
    const EPISODES_PER_DAY = 12;
    const ROLLING_DEFAULT = 5;  // minimum enforced
    const KEYS = {
        SETTINGS:   'netflixAnimeSettings',
        MARKED:     'netflixAnimeEpisodesWatched',
        POSITION:   'netflixHudPosition',
        COLLAPSED:  'netflixHudCollapsed',
        DURATIONS:  'netflixEpisodeDurationsByLabel', // { [label]: Array<{s:number, ts:number}> }
        SW_MIN:     'netflixStopwatchMinimized'
    };

    // ---------- Storage helpers ----------
    const load = (k, fb = {}) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
    const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

    // ---------- Helpers ----------
    const getTodayLocal = () => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now.toISOString().split('T')[0];
    };

    function normalizeDurations(obj) {
        const out = {};
        for (const [label, arr] of Object.entries(obj)) {
            out[label] = (arr || []).map(it => {
                if (typeof it === 'number') return { s: Math.max(1, Math.floor(it)), ts: Date.now() };
                const s = Math.max(1, Math.floor(Number(it?.s) || 0));
                const ts = Number(it?.ts) || Date.now();
                return { s, ts };
            }).filter(x => x.s > 0);
        }
        return out;
    }

    function fmtHMSsec(totalSeconds) {
        const t = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(t / 3600).toString().padStart(2, '0');
        const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
        const s = (t % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function clamp(v, min, max, fallback) {
        const x = Number.isFinite(v) ? v : fallback;
        return Math.max(min, Math.min(max, x));
    }

    function parseHms(str) {
        if (!str) return null;
        const t = String(str).trim();
        if (/^\d+$/.test(t)) return Math.max(0, parseInt(t, 10));
        const parts = t.split(':').map(p => p.trim());
        if (parts.some(p => p === '' || isNaN(p))) return null;
        let h = 0, m = 0, s = 0;
        if (parts.length === 3) [h, m, s] = parts.map(Number);
        else if (parts.length === 2) { [m, s] = parts.map(Number); }
        else return null;
        if (m < 0 || m > 59 || s < 0 || s > 59 || h < 0) return null;
        return h * 3600 + m * 60 + s;
    }

    // ---------- State ----------
    let settings = load(KEYS.SETTINGS, {
        opacity: 0.7,
        episodeColor: '#0f0',
        dailyColor:   '#0f0',
        episodeMinutes: 25,
        showLabel: 'default',
        rollingWindow: ROLLING_DEFAULT
    });
    // Enforce minimum rolling window of 5 on load
    settings.rollingWindow = Math.max(ROLLING_DEFAULT, Math.round(settings.rollingWindow || ROLLING_DEFAULT));
    save(KEYS.SETTINGS, settings);

    let durationsByLabel = normalizeDurations(load(KEYS.DURATIONS, {}));
    let markedEpisodes   = load(KEYS.MARKED, {});
    let position         = load(KEYS.POSITION, null);
    let isCollapsed      = !!load(KEYS.COLLAPSED, false);
    let swMinimized      = !!load(KEYS.SW_MIN, false);
    let currentEpisodePercent = 0;

    const MIN_WIN = () => Math.max(ROLLING_DEFAULT, Math.round(settings.rollingWindow || ROLLING_DEFAULT));

    function getDurations(label) {
        return (durationsByLabel[label] || []).slice().sort((a, b) => a.ts - b.ts);
    }
    function setDurations(label, arr) {
        durationsByLabel[label] = arr;
        save(KEYS.DURATIONS, durationsByLabel);
    }
    function pushDuration(label, seconds) {
        const arr = getDurations(label);
        arr.push({ s: Math.max(1, Math.floor(seconds)), ts: Date.now() });
        const limit = MIN_WIN();
        while (arr.length > limit) arr.shift(); // keep last N
        setDurations(label, arr);
    }
    function avgSecondsPerEpisode(label) {
        const arr = getDurations(label);
        if (!arr.length) return Math.max(1, settings.episodeMinutes) * 60;
        const sum = arr.reduce((a, b) => a + b.s, 0);
        return Math.max(1, Math.round(sum / arr.length));
    }
    function recent5(label) {
        return getDurations(label).slice(-5);
    }

    // ---------- UI Root ----------
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        background: `rgba(0,0,0,${settings.opacity})`,
        color: 'white',
        borderRadius: '10px',
        zIndex: 9999,
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        minWidth: '200px',
        userSelect: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
    });
    if (position) {
        overlay.style.left = position.left;
        overlay.style.top  = position.top;
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
    } else {
        overlay.style.right = '20px';
        overlay.style.bottom = '60px';
    }

    // Header (drag + gear)
    const header = document.createElement('div');
    Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 8px',
        cursor: 'move'
    });
    const title = document.createElement('div');
    title.textContent = 'Tracker';
    Object.assign(title.style, {
        flex: '1',
        fontWeight: 'bold',
        cursor: 'inherit'
    });

    const gearBtn = document.createElement('button');
    gearBtn.textContent = '⚙';
    Object.assign(gearBtn.style, {
        cursor: 'pointer',
        background: 'transparent',
        color: 'white',
        border: 'none',
        fontSize: '12px',
        lineHeight: '1',
        padding: '2px',
        width: '18px',
        height: '18px',
        display: 'grid',
        placeItems: 'center',
        opacity: 0.9
    });
    gearBtn.addEventListener('mousedown', e => e.stopPropagation());
    header.append(title, gearBtn);
    overlay.appendChild(header);

    const content = document.createElement('div');
    Object.assign(content.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '0 10px 10px 10px',
        cursor: 'default'
    });
    overlay.appendChild(content);

    // ---------- Small UI helpers ----------
    function styleBtn(b) {
        Object.assign(b.style, {
            background: '#333',
            color: 'white',
            border: '1px solid #666',
            borderRadius: '6px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '12px'
        });
    }

    function createBoxRow(count, filled, onClick, color = '#0f0') {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '4px';
        for (let i = 0; i < count; i++) {
            const box = document.createElement('div');
            Object.assign(box.style, {
                width: '12px',
                height: '12px',
                border: '1px solid white',
                borderRadius: '2px',
                backgroundColor: i < filled ? color : 'transparent',
                cursor: onClick ? 'pointer' : 'default'
            });
            if (onClick) box.addEventListener('click', () => onClick(i));
            row.appendChild(box);
        }
        return row;
    }

    function buildDayBoxContainer() {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '4px';

        for (let row = 0; row < 2; row++) {
            const rowContainer = document.createElement('div');
            rowContainer.style.display = 'flex';
            rowContainer.style.gap = '8px';
            for (let pair = 0; pair < 3; pair++) {
                const startIndex = row * 6 + pair * 2;
                const todayKey = getTodayLocal();
                const filledCount = Math.max(
                    0,
                    Math.min(2, (markedEpisodes[todayKey] || 0) - startIndex)
                );
                const boxPair = createBoxRow(2, filledCount, i => {
                    const clickedIndex = startIndex + i;
                    const count = markedEpisodes[todayKey] || 0;
                    markedEpisodes[todayKey] = clickedIndex < count ? count - 1 : count + 1;
                    markedEpisodes[todayKey] = Math.max(0, Math.min(EPISODES_PER_DAY, markedEpisodes[todayKey]));
                    save(KEYS.MARKED, markedEpisodes);
                    updateUI();
                }, settings.dailyColor);
                rowContainer.appendChild(boxPair);
            }
            container.appendChild(rowContainer);
        }
        return container;
    }

    // ===== DAILY ROW =====
    const dailyRow = document.createElement('div');
    Object.assign(dailyRow.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
    });

    const dailyLine = document.createElement('div'); // "Daily: XX.X% • hh:mm:ss"
    dailyLine.style.fontVariantNumeric = 'tabular-nums';
    dailyLine.style.flex = '1';

    // Tiny chip that appears ONLY when stopwatch is minimized (and HUD expanded)
    const swChip = document.createElement('button');
    swChip.textContent = '⏱';
    Object.assign(swChip.style, {
        display: 'none',
        cursor: 'pointer',
        background: 'transparent',
        color: 'white',
        border: '1px solid #666',
        borderRadius: '4px',
        fontSize: '12px',
        padding: '0 6px',
        lineHeight: '18px',
        height: '20px'
    });

    const collapseBtn = document.createElement('button'); // collapse/expand HUD
    collapseBtn.textContent = isCollapsed ? '▼' : '▲';
    Object.assign(collapseBtn.style, {
        cursor: 'pointer',
        background: 'transparent',
        color: 'white',
        border: '1px solid #666',
        borderRadius: '4px',
        fontSize: '12px',
        padding: '0 6px',
        lineHeight: '18px',
        height: '20px'
    });
    [swChip, collapseBtn].forEach(btn =>
        btn.addEventListener('mousedown', e => e.stopPropagation())
    );

    dailyRow.append(dailyLine, swChip, collapseBtn);
    content.appendChild(dailyRow);

    // ===== COLLAPSIBLE BLOCK (everything except daily row) =====
    const collapsibleBlock = document.createElement('div');
    Object.assign(collapsibleBlock.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
    });
    content.appendChild(collapsibleBlock);

    // Current episode progress (text + bar)
    const episodeText = document.createElement('div');
    episodeText.style.fontVariantNumeric = 'tabular-nums';
    const episodeBar = createBoxRow(10, 0, null, settings.episodeColor);
    collapsibleBlock.append(episodeText, episodeBar);

    // Day boxes (with lazy refresh)
    let dayBoxContainer = buildDayBoxContainer();
    let lastDayBoxKey = getTodayLocal();
    let lastMarkedCount = markedEpisodes[lastDayBoxKey] || 0;
    collapsibleBlock.appendChild(dayBoxContainer);

    function refreshDayBoxesIfNeeded() {
        const todayKey = getTodayLocal();
        const count = markedEpisodes[todayKey] || 0;
        if (dayBoxContainer && todayKey === lastDayBoxKey && count === lastMarkedCount) return;

        lastDayBoxKey = todayKey;
        lastMarkedCount = count;

        if (dayBoxContainer && dayBoxContainer.parentNode === collapsibleBlock) {
            collapsibleBlock.removeChild(dayBoxContainer);
        }
        dayBoxContainer = buildDayBoxContainer();
        collapsibleBlock.appendChild(dayBoxContainer);
    }

    // ===== STOPWATCH BLOCK (AT VERY BOTTOM) =====
    const swBlock = document.createElement('div');
    Object.assign(swBlock.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    });

    const swHeader = document.createElement('div');
    Object.assign(swHeader.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: '4px'
    });

    const swToggle = document.createElement('button');
    swToggle.textContent = swMinimized ? '▲' : '▼'; // ▼ open, ▲ minimize
    Object.assign(swToggle.style, {
        cursor: 'pointer',
        background: 'transparent',
        color: 'white',
        border: '1px solid #666',
        borderRadius: '4px',
        fontSize: '12px',
        padding: '0 4px',
        lineHeight: '18px',
        height: '20px'
    });

    const swTitle = document.createElement('div');
    swTitle.textContent = 'Stopwatch';
    Object.assign(swTitle.style, {
        fontWeight: 'bold'
    });

    const swAvg = document.createElement('div');
    Object.assign(swAvg.style, {
        marginLeft: 'auto',
        fontVariantNumeric: 'tabular-nums',
        opacity: 0.9
    });

    const swPanel = document.createElement('div');
    Object.assign(swPanel.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '4px'
    });

    const swClock = document.createElement('div');
    swClock.textContent = '⏱ 00:00:00';
    swClock.style.fontVariantNumeric = 'tabular-nums';

    const swStartPause = document.createElement('button');
    swStartPause.textContent = 'Start';
    styleBtn(swStartPause);
    const swStop = document.createElement('button');
    swStop.textContent = 'Stop';
    styleBtn(swStop);
    const swReset = document.createElement('button');
    swReset.textContent = 'Reset';
    styleBtn(swReset);

    swPanel.append(swClock, swStartPause, swStop, swReset);
    swHeader.append(swToggle, swTitle, swAvg);
    swBlock.append(swHeader, swPanel);
    collapsibleBlock.appendChild(swBlock);

    // ---------- Visibility handling ----------
    function applyVisibility() {
        // HUD body
        collapsibleBlock.style.display = isCollapsed ? 'none' : 'flex';

        // Stopwatch header/panel
        const shouldShowStopwatch = !isCollapsed && !swMinimized;
        swHeader.style.display = shouldShowStopwatch ? 'flex' : 'none';
        swPanel.style.display  = shouldShowStopwatch ? 'flex' : 'none';

        // Chip visible only when HUD expanded + stopwatch minimized
        swChip.style.display = (!isCollapsed && swMinimized) ? '' : 'none';

        collapseBtn.textContent = isCollapsed ? '▼' : '▲';
        swToggle.textContent    = swMinimized ? '▲' : '▼';
    }

    function setStopwatchMinimized(min) {
        swMinimized = !!min;
        save(KEYS.SW_MIN, swMinimized);
        applyVisibility();
    }

    function setCollapsed(next) {
        isCollapsed = !!next;
        save(KEYS.COLLAPSED, isCollapsed);
        applyVisibility();
    }

    swToggle.onclick = () => setStopwatchMinimized(!swMinimized);
    swChip.onclick   = () => setStopwatchMinimized(false);
    collapseBtn.onclick = () => setCollapsed(!isCollapsed);

    // ---------- Stopwatch logic ----------
    let swRunning = false;
    let swAccumMs = 0;
    let swStartTs = 0;
    let swTimerId = null;

    function fmtHMSms(ms) {
        return fmtHMSsec(Math.floor(ms / 1000));
    }

    function swUpdateClock() {
        const now = Date.now();
        const elapsed = swAccumMs + (swRunning ? (now - swStartTs) : 0);
        swClock.textContent = `⏱ ${fmtHMSms(elapsed)}`;
    }

    function swStart() {
        if (swRunning) return;
        swRunning = true;
        swStartTs = Date.now();
        swStartPause.textContent = 'Pause';
        if (swTimerId) clearInterval(swTimerId);
        swTimerId = setInterval(swUpdateClock, 250);
    }

    function swPause() {
        if (!swRunning) return;
        swRunning = false;
        swAccumMs += Date.now() - swStartTs;
        swStartPause.textContent = 'Start';
        swUpdateClock();
        if (swTimerId) {
            clearInterval(swTimerId);
            swTimerId = null;
        }
    }

    function swStopAndRecord() {
        if (swRunning) {
            swRunning = false;
            swAccumMs += Date.now() - swStartTs;
        }
        if (swTimerId) {
            clearInterval(swTimerId);
            swTimerId = null;
        }
        const seconds = Math.floor(swAccumMs / 1000);
        if (seconds > 0) {
            pushDuration(settings.showLabel, seconds); // keeps last MIN_WIN() (>=5)
            updateAvgLabel();
            swAccumMs = 0;
            swStartPause.textContent = 'Start';
            swUpdateClock();
            updateUI(); // recalc time-to-goal using updated average
        }
    }

    function swResetAll() {
        swRunning = false;
        swAccumMs = 0;
        swStartPause.textContent = 'Start';
        if (swTimerId) {
            clearInterval(swTimerId);
            swTimerId = null;
        }
        swUpdateClock();
    }

    swStartPause.onclick = () => (swRunning ? swPause() : swStart());
    swStop.onclick = swStopAndRecord;
    swReset.onclick = swResetAll;

    // ---------- Drag behavior ----------
    let isDraggingHud = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', e => {
        isDraggingHud = true;
        const rect = overlay.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
        if (!isDraggingHud) return;
        isDraggingHud = false;
        save(KEYS.POSITION, { left: overlay.style.left, top: overlay.style.top });
    });

    window.addEventListener('mousemove', e => {
        if (!isDraggingHud) return;
        overlay.style.left = `${e.clientX - offsetX}px`;
        overlay.style.top  = `${e.clientY - offsetY}px`;
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
    });

    // ---------- Settings dialog ----------
    gearBtn.onclick = () => openSettings();

    function openSettings() {
        const menu = document.createElement('div');
        Object.assign(menu.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#111',
            padding: '16px',
            borderRadius: '10px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            zIndex: 10000,
            width: '380px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)'
        });

        const title = document.createElement('div');
        title.textContent = 'Settings';
        Object.assign(title.style, {
            fontSize: '16px',
            fontWeight: 'bold',
            marginBottom: '10px'
        });

        const [opacityRow, opacityInput] = mkNum('HUD Opacity', settings.opacity, 0, 1, 0.1);
        const [epColorRow, epColorInput] = mkColor('Episode Box', settings.episodeColor);
        const [dayColorRow, dayColorInput] = mkColor('Daily Box', settings.dailyColor);
        const [epLenRow, epLenInput] = mkNum('Fallback ep length (min)', settings.episodeMinutes, 1, 300, 1);
        const [labelRow, labelInput] = mkText('Show label', settings.showLabel);
        const [rollRow, rollInput] = mkNum('Rolling window (min 5)', settings.rollingWindow, 5, 50, 1, '70px');

        const editsTitle = document.createElement('div');
        editsTitle.textContent = `Last 5 durations for "${settings.showLabel}"`;
        Object.assign(editsTitle.style, {
            marginTop: '12px',
            fontWeight: 'bold'
        });

        const editsWrap = document.createElement('div');
        Object.assign(editsWrap.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginTop: '6px'
        });

        const rows = [];
        const recent = recent5(settings.showLabel);
        if (!recent.length) {
            const empty = document.createElement('div');
            empty.textContent = 'No samples yet.';
            empty.style.opacity = '0.8';
            editsWrap.appendChild(empty);
        } else {
            recent.forEach((item, idx) => {
                const row = document.createElement('div');
                Object.assign(row.style, {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                });

                const lbl = document.createElement('div');
                lbl.textContent = `#${recent.length - idx}`;
                lbl.style.width = '32px';
                lbl.style.textAlign = 'right';

                const input = document.createElement('input');
                input.type = 'text';
                input.value = fmtHMSsec(item.s);
                Object.assign(input.style, {
                    background: '#222',
                    color: 'white',
                    border: '1px solid #666',
                    borderRadius: '4px',
                    padding: '4px',
                    width: '100px',
                    fontVariantNumeric: 'tabular-nums'
                });

                const del = document.createElement('button');
                del.textContent = 'Delete';
                styleBtn(del);
                del.style.padding = '3px 8px';

                row.append(lbl, input, del);
                editsWrap.appendChild(row);
                rows.push({ item, input, del });
            });
        }

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.justifyContent = 'space-between';
        buttons.style.gap = '8px';
        buttons.style.marginTop = '12px';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.gap = '8px';

        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        styleBtn(cancel);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        Object.assign(saveBtn.style, {
            background: '#4a4',
            color: 'white',
            border: '1px solid #3a3',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: 'pointer',
            fontWeight: 'bold'
        });

        const applyEditsBtn = document.createElement('button');
        applyEditsBtn.textContent = 'Save edits';
        Object.assign(applyEditsBtn.style, {
            background: '#286090',
            color: 'white',
            border: '1px solid #204d74',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: 'pointer',
            fontWeight: 'bold'
        });

        left.append(applyEditsBtn, cancel);
        buttons.append(left, saveBtn);

        cancel.onclick = () => document.body.removeChild(menu);

        saveBtn.onclick = () => {
            settings.opacity        = clamp(parseFloat(opacityInput.value), 0, 1, 0.7);
            settings.episodeColor   = epColorInput.value;
            settings.dailyColor     = dayColorInput.value;
            settings.episodeMinutes = Math.max(
                1,
                Math.min(300, Math.round(parseFloat(epLenInput.value) || settings.episodeMinutes))
            );
            settings.showLabel      = (labelInput.value || 'default').trim();
            // enforce min 5
            settings.rollingWindow  = Math.max(
                ROLLING_DEFAULT,
                Math.min(50, Math.round(parseFloat(rollInput.value) || settings.rollingWindow))
            );

            save(KEYS.SETTINGS, settings);
            overlay.style.background = `rgba(0,0,0,${settings.opacity})`;
            updateAvgLabel();
            document.body.removeChild(menu);
            updateUI();
        };

        applyEditsBtn.onclick = () => {
            const all = getDurations(settings.showLabel);
            const last5 = all.slice(-5);
            rows.forEach(({ item, input, del }) => {
                const idx = last5.findIndex(x => x.ts === item.ts && x.s === item.s);
                const deleted = del.dataset._deleted === '1';
                if (idx >= 0) {
                    if (deleted) {
                        last5.splice(idx, 1);
                    } else {
                        const parsed = parseHms(input.value);
                        if (parsed != null && parsed > 0) last5[idx].s = parsed;
                    }
                }
            });
            const older = all.slice(0, Math.max(0, all.length - 5));
            setDurations(settings.showLabel, older.concat(last5));
            updateAvgLabel();
            updateUI();
            document.body.removeChild(menu);
            openSettings(); // reopen refreshed
        };

        rows.forEach(({ del }) => {
            del.onclick = () => {
                if (del.dataset._deleted === '1') {
                    del.dataset._deleted = '0';
                    del.textContent = 'Delete';
                    del.style.background = '#333';
                } else {
                    del.dataset._deleted = '1';
                    del.textContent = 'Undelete';
                    del.style.background = '#a33';
                }
            };
        });

        menu.append(
            title,
            opacityRow,
            epColorRow,
            dayColorRow,
            epLenRow,
            labelRow,
            rollRow,
            editsTitle,
            editsWrap,
            buttons
        );
        document.body.appendChild(menu);

        // small builders (local to settings)
        function mkNum(label, value, min, max, step, width = '80px') {
            const wrap = document.createElement('label');
            wrap.style.display = 'flex';
            wrap.style.justifyContent = 'space-between';
            wrap.style.alignItems = 'center';
            wrap.style.margin = '8px 0';
            const span = document.createElement('span');
            span.textContent = label;
            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.min = min;
            input.max = max;
            input.step = step;
            Object.assign(input.style, {
                background: '#222',
                color: 'white',
                border: '1px solid #666',
                borderRadius: '4px',
                width,
                padding: '4px',
                marginLeft: '10px'
            });
            wrap.append(span, input);
            return [wrap, input];
        }

        function mkColor(label, value) {
            const wrap = document.createElement('label');
            wrap.style.display = 'flex';
            wrap.style.justifyContent = 'space-between';
            wrap.style.alignItems = 'center';
            wrap.style.margin = '8px 0';
            const span = document.createElement('span');
            span.textContent = label;
            const input = document.createElement('input');
            input.type = 'color';
            input.value = value;
            input.style.marginLeft = '10px';
            wrap.append(span, input);
            return [wrap, input];
        }

        function mkText(label, value, width = '180px') {
            const wrap = document.createElement('label');
            wrap.style.display = 'flex';
            wrap.style.justifyContent = 'space-between';
            wrap.style.alignItems = 'center';
            wrap.style.margin = '8px 0';
            const span = document.createElement('span');
            span.textContent = label;
            const input = document.createElement('input');
            input.type = 'text';
            input.value = value;
            Object.assign(input.style, {
                background: '#222',
                color: 'white',
                border: '1px solid #666',
                borderRadius: '4px',
                width,
                padding: '4px',
                marginLeft: '10px'
            });
            wrap.append(span, input);
            return [wrap, input];
        }
    }

    function updateAvgLabel() {
        const windowSize = MIN_WIN();
        const arr = getDurations(settings.showLabel);
        const text = arr.length ? fmtHMSsec(avgSecondsPerEpisode(settings.showLabel)) : '--:--:--';
        swAvg.textContent = `Avg/${windowSize}: ${text}`;
    }

    // ----- UI refresh -----
    function secondsLeftToGoal(watchedWhole, currentPercent) {
        const projected = watchedWhole + currentPercent / 100;
        const remainingEpisodes = Math.max(0, EPISODES_PER_DAY - projected);
        const secPerEpisode = avgSecondsPerEpisode(settings.showLabel);
        return Math.ceil(remainingEpisodes * secPerEpisode);
    }

    function updateUI() {
        const today = getTodayLocal();
        const watched = markedEpisodes[today] || 0;
        const projected = watched + currentEpisodePercent / 100;
        const percent = Math.min(100, (projected / EPISODES_PER_DAY) * 100);

        const secsLeft = secondsLeftToGoal(watched, currentEpisodePercent);
        const timeLabel = secsLeft <= 0 ? 'done 🎉' : `${fmtHMSsec(secsLeft)} left`;
        dailyLine.textContent = `Daily: ${percent.toFixed(1)}% • ${timeLabel}`;

        episodeText.textContent = `Episode: ${currentEpisodePercent.toFixed(1)}%`;
        Array.from(episodeBar.children).forEach((box, i) => {
            box.style.backgroundColor =
                i < Math.floor(currentEpisodePercent / 10) ? settings.episodeColor : 'transparent';
        });

        updateAvgLabel();
        refreshDayBoxesIfNeeded();
        applyVisibility();
    }

    // Progress loop
    function updateProgress() {
        const video = document.querySelector('video');
        currentEpisodePercent =
            video && video.duration ? (video.currentTime / video.duration) * 100 : 0;
        updateUI();
    }

    // Mount
    document.body.appendChild(overlay);
    swUpdateClock();
    updateUI();
    setInterval(updateProgress, 1000);
})();
