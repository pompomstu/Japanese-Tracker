// ==UserScript==
// @name         Japanese-Tracker
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Tracks episodes watched with calendar, graph, streak, HUD position, and color settings
// @match        *://www.netflix.com/watch/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function () {
    'use strict';

    const EPISODES_PER_DAY = 12;
    const KEYS = {
        CALENDAR: 'netflixAnimeCalendar',
        SETTINGS: 'netflixAnimeSettings',
        MARKED: 'netflixAnimeEpisodesWatched',
        POSITION: 'netflixHudPosition'
    };

    const getTodayLocal = () => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now.toISOString().split('T')[0];
    };

    const getKey = (d) => {
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0];
    };

    const load = (key, fallback = {}) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

    let settings = load(KEYS.SETTINGS, {
        opacity: 0.7,
        episodeColor: "#0f0",
        dailyColor: "#0f0"
    });

    let calendarData = load(KEYS.CALENDAR, {});
    let markedEpisodes = load(KEYS.MARKED, {});
    let position = load(KEYS.POSITION, null);
    let currentEpisodePercent = 0;
    let viewMode = 'weekly'; // persist across calendar reloads


    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        background: `rgba(0,0,0,${settings.opacity})`,
        color: 'white',
        padding: '12px',
        borderRadius: '10px',
        zIndex: 9999,
        fontFamily: 'Arial',
        fontSize: '14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: '180px',
        cursor: 'move'
    });

    if (position) {
        overlay.style.left = position.left;
        overlay.style.top = position.top;
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
    } else {
        overlay.style.bottom = '60px';
        overlay.style.right = '20px';
    }

    document.body.appendChild(overlay);

    let isDragging = false, offsetX = 0, offsetY = 0;
    overlay.addEventListener('mousedown', e => {
        isDragging = true;
        offsetX = e.offsetX;
        offsetY = e.offsetY;
    });
    window.addEventListener('mouseup', () => {
        isDragging = false;
        save(KEYS.POSITION, {
            left: overlay.style.left,
            top: overlay.style.top
        });
    });
    window.addEventListener('mousemove', e => {
        if (isDragging) {
            overlay.style.left = `${e.clientX - offsetX}px`;
            overlay.style.top = `${e.clientY - offsetY}px`;
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
        }
    });
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

function buildHUD() {
    const episodeText = document.createElement('div');
    const episodeBar = createBoxRow(10, 0, null, settings.episodeColor);
    const dailyText = document.createElement('div');

    let dayBoxContainer = buildDayBoxContainer();

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
                const filledCount = Math.max(0, Math.min(2, (markedEpisodes[getTodayLocal()] || 0) - startIndex));
                const boxPair = createBoxRow(2, filledCount, i => {
                    let count = markedEpisodes[getTodayLocal()] || 0;
                    const clickedIndex = startIndex + i;
                    markedEpisodes[getTodayLocal()] = clickedIndex < count ? count - 1 : count + 1;
                    save(KEYS.MARKED, markedEpisodes);
                    updateUI();
                }, settings.dailyColor);
                rowContainer.appendChild(boxPair);
            }

            container.appendChild(rowContainer);
        }

        return container;
    }

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '10px';
    buttonRow.style.marginTop = '10px';

    const settingsBtn = document.createElement('button');
    const calendarBtn = document.createElement('button');

    [settingsBtn, calendarBtn].forEach(btn => {
        Object.assign(btn.style, {
            backgroundColor: '#333',
            color: 'white',
            border: '1px solid #888',
            borderRadius: '6px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '16px'
        });
    });

    settingsBtn.textContent = '⚙️';
    calendarBtn.textContent = '📅';

    buttonRow.append(settingsBtn, calendarBtn);
    overlay.append(episodeText, episodeBar, dailyText, dayBoxContainer, buttonRow);

    return {
        episodeText,
        episodeBar,
        dailyText,
        calendarBtn,
        settingsBtn,
        refreshDayBoxes: () => {
            overlay.removeChild(dayBoxContainer);
            dayBoxContainer = buildDayBoxContainer();
            overlay.insertBefore(dayBoxContainer, buttonRow);
        }
    };
}
const parts = buildHUD();


    parts.settingsBtn.onclick = () => {
        const menu = document.createElement('div');
        Object.assign(menu.style, {
            position: 'fixed',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#111',
            padding: '20px',
            borderRadius: '10px',
            color: 'white',
            fontFamily: 'Arial',
            zIndex: 10000
        });

        const title = document.createElement('div');
        title.textContent = 'Settings';
        title.style.fontSize = '16px';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '10px';

        const opacityInput = document.createElement('input');
        opacityInput.type = 'number';
        opacityInput.step = '0.1';
        opacityInput.min = '0';
        opacityInput.max = '1';
        opacityInput.value = settings.opacity;
        Object.assign(opacityInput.style, {
            backgroundColor: '#222',
            color: 'white',
            border: '1px solid #888',
            borderRadius: '4px',
            padding: '4px',
            width: '60px',
            marginLeft: '10px'
        });

        const episodeColor = document.createElement('input');
        episodeColor.type = 'color';
        episodeColor.value = settings.episodeColor || '#0f0';

        const dailyColor = document.createElement('input');
        dailyColor.type = 'color';
        dailyColor.value = settings.dailyColor || '#0f0';

        const label = (text, input) => {
            const l = document.createElement('label');
            l.textContent = text;
            l.appendChild(input);
            l.style.display = 'block';
            l.style.margin = '8px 0';
            return l;
        };

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save & Close';
        Object.assign(saveBtn.style, {
            marginTop: '10px',
            padding: '6px 10px',
            backgroundColor: '#333',
            color: 'white',
            border: '1px solid #888',
            borderRadius: '4px',
            cursor: 'pointer'
        });

        saveBtn.onclick = () => {
            settings.opacity = parseFloat(opacityInput.value);
            settings.episodeColor = episodeColor.value;
            settings.dailyColor = dailyColor.value;
            save(KEYS.SETTINGS, settings);
            overlay.style.background = `rgba(0,0,0,${settings.opacity})`;
            document.body.removeChild(menu);
            updateUI();
        };

        menu.append(
            title,
            label('HUD Opacity: ', opacityInput),
            label('Episode Box Color: ', episodeColor),
            label('Daily Box Color: ', dailyColor),
            saveBtn
        );

        document.body.appendChild(menu);
    };
    // ===== Playback Progress Loop =====
    function updateProgress() {
        const video = document.querySelector('video');
        if (video && video.duration) {
            currentEpisodePercent = (video.currentTime / video.duration) * 100;
        }
        updateUI();
    }

    // ===== UI Refresh Based on Settings =====
    function updateUI() {
        const watched = markedEpisodes[getTodayLocal()] || 0;
        const projected = watched + currentEpisodePercent / 100;
        const percent = (projected / EPISODES_PER_DAY) * 100;

        parts.episodeText.textContent = `Episode: ${currentEpisodePercent.toFixed(1)}%`;
        parts.dailyText.textContent = `Daily: ${Math.min(percent, 100).toFixed(1)}%`;

        Array.from(parts.episodeBar.children).forEach((box, i) => {
            box.style.backgroundColor = i < Math.floor(currentEpisodePercent / 10)
                ? settings.episodeColor
                : 'transparent';
        });

        parts.refreshDayBoxes();
    }

    setInterval(updateProgress, 1000);

    // ===== Calendar & Graph Activation =====
    parts.calendarBtn.onclick = () => showCalendarPopup?.();
    function showCalendarPopup() {
        const popup = document.createElement('div');
        Object.assign(popup.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#222',
            color: 'white',
            padding: '20px',
            borderRadius: '10px',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            maxHeight: '90vh',
            overflowY: 'auto'
        });

        const today = new Date();
        if (!window.calendarOffset) {
            window.calendarOffset = { year: today.getFullYear(), month: today.getMonth() };
        }

        const { year, month } = window.calendarOffset;

        const closeBtn = document.createElement('div');
        closeBtn.textContent = '✖';
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '10px',
            right: '15px',
            cursor: 'pointer',
            fontSize: '16px'
        });
        closeBtn.onclick = () => popup.remove();
        popup.appendChild(closeBtn);

        // ==== Header Nav Row ====
        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.alignItems = 'center';
        headerRow.style.gap = '5px';

        const navBtnStyle = {
            backgroundColor: '#333',
            color: 'white',
            border: '1px solid #888',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: '14px'
        };

        const navLeftYear = document.createElement('button');
        navLeftYear.textContent = '«';
        navLeftYear.onclick = () => { calendarOffset.year--; popup.remove(); showCalendarPopup(); };

        const navLeft = document.createElement('button');
        navLeft.textContent = '←';
        navLeft.onclick = () => {
            if (calendarOffset.month === 0) {
                calendarOffset.month = 11;
                calendarOffset.year--;
            } else {
                calendarOffset.month--;
            }
            popup.remove();
            showCalendarPopup();
        };

        const navRight = document.createElement('button');
        navRight.textContent = '→';
        navRight.onclick = () => {
            if (calendarOffset.month === 11) {
                calendarOffset.month = 0;
                calendarOffset.year++;
            } else {
                calendarOffset.month++;
            }
            popup.remove();
            showCalendarPopup();
        };

        const navRightYear = document.createElement('button');
        navRightYear.textContent = '»';
        navRightYear.onclick = () => { calendarOffset.year++; popup.remove(); showCalendarPopup(); };

        [navLeftYear, navLeft, navRight, navRightYear].forEach(btn => Object.assign(btn.style, navBtnStyle));

        const monthLabel = document.createElement('div');
        monthLabel.style.fontWeight = 'bold';
        monthLabel.style.fontSize = '16px';
        monthLabel.style.flex = '1';
        monthLabel.style.textAlign = 'center';
        monthLabel.textContent = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });

        headerRow.append(navLeftYear, navLeft, monthLabel, navRight, navRightYear);
        popup.appendChild(headerRow);
        const calendarGrid = document.createElement('div');
        calendarGrid.style.display = 'grid';
        calendarGrid.style.gridTemplateColumns = 'repeat(7, 40px)';
        calendarGrid.style.gap = '4px';

        const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        weekdays.forEach(day => {
            const label = document.createElement('div');
            label.textContent = day;
            label.style.fontWeight = 'bold';
            label.style.textAlign = 'center';
            calendarGrid.appendChild(label);
        });

        const firstDay = new Date(year, month, 1);
        let startWeekday = firstDay.getDay();
        startWeekday = startWeekday === 0 ? 6 : startWeekday - 1;

        for (let i = 0; i < startWeekday; i++) {
            calendarGrid.appendChild(document.createElement('div'));
        }

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayKey = getTodayLocal();

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            const key = getKey(date);
            const cell = document.createElement('div');
            cell.textContent = d;
            cell.style.textAlign = 'center';
            cell.style.cursor = 'pointer';
            cell.style.border = '1px solid white';
            cell.style.height = '30px';

            const val = markedEpisodes[key];
            if (calendarData[key] === 'skip') {
                cell.style.backgroundColor = '#6c6';
            } else if (val >= EPISODES_PER_DAY) {
                cell.style.backgroundColor = '#0c0';
            } else if (val > 0) {
                cell.style.backgroundColor = '#c00';
            }

            if (key === todayKey) {
                cell.style.outline = '2px solid yellow';
            }

            cell.onclick = () => {
                const input = prompt(
                    `Set day ${key}\n- Type 0–12 to mark episodes\n- "skip" to skip\n- "clear" to reset:`,
                    markedEpisodes[key] ?? (calendarData[key] === 'skip' ? 'skip' : '')
                );
                if (input === null) return;
                const trimmed = input.trim().toLowerCase();
                if (trimmed === 'skip') {
                    calendarData[key] = 'skip';
                    delete markedEpisodes[key];
                } else if (trimmed === 'clear') {
                    delete calendarData[key];
                    delete markedEpisodes[key];
                } else {
                    const num = parseInt(trimmed);
                    if (!isNaN(num) && num >= 0 && num <= 12) {
                        markedEpisodes[key] = num;
                        delete calendarData[key];
                    } else {
                        alert('Invalid input. Enter 0–12, "skip", or "clear".');
                        return;
                    }
                }
                save(KEYS.CALENDAR, calendarData);
                save(KEYS.MARKED, markedEpisodes);
                popup.remove();
                showCalendarPopup();
            };

            calendarGrid.appendChild(cell);
        }

        // ===== Streak Display (based on current month) =====
        function calculateStreak() {
            let validDays = 0, failedDays = 0;
            for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(year, month, d);
                const key = getKey(date);
                if (key >= todayKey) continue;
                if (calendarData[key] === 'skip') continue;
                if (!markedEpisodes.hasOwnProperty(key)) continue;
                validDays++;
                if (markedEpisodes[key] < EPISODES_PER_DAY) failedDays++;
            }
            return validDays ? Math.round(((validDays - failedDays) / validDays) * 100) : 100;
        }

        const streakBox = document.createElement('div');
        streakBox.style.alignSelf = 'flex-end';
        streakBox.style.marginRight = '10px';
        streakBox.style.fontWeight = 'bold';
        streakBox.textContent = `Streak: ${calculateStreak()}%`;

        // ===== Chart Section =====
        const canvas = document.createElement('canvas');
        canvas.width = 340;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');

        let chart;


        function renderWeekly() {
            const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const weekData = [0, 0, 0, 0, 0, 0, 0];
            const now = new Date();
            const offset = (now.getDay() + 6) % 7;
            now.setDate(now.getDate() - offset);
            for (let i = 0; i < 7; i++) {
                const d = new Date(now);
                d.setDate(d.getDate() + i);
                const key = getKey(d);
                weekData[i] = markedEpisodes[key] || 0;
            }
            return {
                labels,
                datasets: [{
                    label: 'Episodes (Week)',
                    data: weekData,
                    backgroundColor: '#4caf50'
                }]
            };
        }

        function renderMonthly() {
            const labels = [], data = [];
            for (let i = 1; i <= daysInMonth; i++) {
                const d = new Date(year, month, i);
                const key = getKey(d);
                labels.push(i.toString());
                data.push(markedEpisodes[key] || 0);
            }
            return {
                labels,
                datasets: [{
                    label: 'Episodes (Month)',
                    data,
                    borderColor: '#2196f3',
                    backgroundColor: '#2196f3',
                    fill: false,
                    tension: 0.2
                }]
            };
        }

        function renderChart() {
            if (chart) chart.destroy();
            chart = new Chart(ctx, {
                type: viewMode === 'weekly' ? 'bar' : 'line',
                data: viewMode === 'weekly' ? renderWeekly() : renderMonthly(),
                options: {
                    responsive: false,
                    scales: {
                        y: { beginAtZero: true, max: EPISODES_PER_DAY }
                    }
                }
            });
        }

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = 'Switch to Monthly View';
        Object.assign(toggleBtn.style, {
            backgroundColor: '#333',
            color: 'white',
            border: '1px solid #888',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '6px 12px',
            fontSize: '13px'
        });

        toggleBtn.onclick = () => {
            viewMode = viewMode === 'weekly' ? 'monthly' : 'weekly';
            toggleBtn.textContent = viewMode === 'weekly' ? 'Switch to Monthly View' : 'Switch to Weekly View';
            renderChart();
        };

        popup.append(calendarGrid, streakBox, canvas, toggleBtn);
        renderChart();
        document.body.appendChild(popup);
    }
})();
