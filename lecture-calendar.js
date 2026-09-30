// The source API describes recurring classes with a date range and weekday codes.
// Keep occurrence calculation independent from the search filters and pagination.
function calendarMonthStart(date, offset = 0) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function calendarDateKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function calendarOccursOn(lecture, date) {
    const begin = parseDateOnly(lecture.beginDate);
    const end = parseDateOnly(lecture.endDate);
    if (!begin || !end || date < begin || date > end) return false;
    const weekdays = parseDayCodes(lecture.dayOfWeek);
    if (weekdays.length === 0) {
        return begin.getTime() === end.getTime() && date.getTime() === begin.getTime();
    }
    return weekdays.includes(getApiDayCode(date));
}

function calendarLastOccurrence(lecture, latestAllowed) {
    const begin = parseDateOnly(lecture.beginDate);
    const end = parseDateOnly(lecture.endDate);
    if (!begin || !end) return null;
    const candidate = new Date(Math.min(end.getTime(), latestAllowed.getTime()));
    // A weekly recurrence can only move back six days before matching a weekday.
    for (let i = 0; i < 7 && candidate >= begin; i++) {
        if (calendarOccursOn(lecture, candidate)) return new Date(candidate);
        candidate.setUTCDate(candidate.getUTCDate() - 1);
    }
    return null;
}

function calendarBounds(today, lectures) {
    const first = calendarMonthStart(today, -6);
    const policyLast = calendarMonthStart(today, 12);
    policyLast.setUTCDate(0); // End of month 11 ahead.
    let last = calendarMonthStart(today);
    for (const lecture of lectures) {
        const occurrence = calendarLastOccurrence(lecture, policyLast);
        if (occurrence && occurrence > last) last = occurrence;
    }
    return { first, last: calendarMonthStart(last) };
}

function calendarOccurrencesInMonth(lectures, month) {
    const year = month.getUTCFullYear();
    const monthNumber = month.getUTCMonth();
    const days = new Date(Date.UTC(year, monthNumber + 1, 0)).getUTCDate();
    const output = new Map();
    for (let day = 1; day <= days; day++) {
        const date = new Date(Date.UTC(year, monthNumber, day));
        const entries = lectures
            .filter(lecture => calendarOccursOn(lecture, date))
            .sort((a, b) => (a.beginTime || '').localeCompare(b.beginTime || '') || (a.name || '').localeCompare(b.name || '', 'ko'));
        if (entries.length) output.set(calendarDateKey(date), entries);
    }
    return output;
}

let activeCalendar = null;
let calendarReturnFocus = null;

function calendarSelectedLibrary() {
    const name = institutionSelect.value;
    return name && name !== 'favorite' && name.endsWith('도서관') ? name : '';
}

function calendarEntryNotice(message) {
    const notice = document.getElementById('calendarEntryNotice');
    if (notice) notice.textContent = message || (calendarSelectedLibrary() ? '' : '⚠️ 도서관 한 곳을 선택하면 달력을 볼 수 있습니다.');
}

async function calendarEnsureCompleteData() {
    if (datasetMeta && datasetMeta.limit === null) return;
    const response = await fetch(LIBRARY_DATA_API);
    if (!response.ok) throw new Error(`강좌 데이터 응답 오류: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.lectures) || !payload.meta || payload.meta.limit !== null) {
        throw new Error('전체 강좌 데이터를 확인하지 못했습니다.');
    }
    libraryData = payload.lectures.filter(lecture => !isWholeSetLoan(lecture));
    libraryData.forEach(updateLectureState);
    datasetMeta = payload.meta;
    if (Array.isArray(payload.institutions)) {
        payload.institutions.forEach(name => institutionNames.add(name));
    }
    saveCacheToLocalStorage(libraryData, datasetMeta, institutionNames, Date.now());
    allData = getSearchBaseData();
    renderResults();
}

async function openLectureCalendar() {
    const name = calendarSelectedLibrary();
    if (!name) {
        calendarEntryNotice('도서관 한 곳을 선택해야 강좌 달력을 볼 수 있습니다.');
        return;
    }
    calendarEntryNotice('강좌 달력을 준비하는 중입니다…');
    const opener = document.activeElement;
    try {
        await calendarEnsureCompleteData();
        if (calendarSelectedLibrary() !== name) {
            calendarEntryNotice('선택한 도서관이 바뀌었습니다. 다시 열어 주세요.');
            return;
        }
        const lectures = libraryData.filter(lecture => lecture.institution === name);
        const today = getKoreaTodayDateOnly();
        activeCalendar = { name, lectures, today, month: calendarMonthStart(today), bounds: calendarBounds(today, lectures) };
        calendarEntryNotice('');
        calendarReturnFocus = opener.isConnected ? opener : document.querySelector('.calendar-entry-button');
        renderLectureCalendar();
        const dialog = document.getElementById('lectureCalendarDialog');
        dialog.showModal();
        document.getElementById('lectureCalendarClose').focus();
    } catch (error) {
        console.error('강좌 달력 준비 실패:', error);
        calendarEntryNotice('전체 강좌 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
}

function calendarStatusClass(lecture) {
    return isCanceledLecture(lecture) ? 'inactive' :
        lecture.status === '접수중' ? 'open' :
        lecture.status === '접수예정' ? 'upcoming' : 'inactive';
}

function calendarEventMarkup(lecture) {
    const title = escapeHtml(lecture.name || '이름 없는 강좌');
    const time = [lecture.beginTime, lecture.endTime].filter(Boolean).join('–') || '시간 미정';
    const target = [lecture.targetNm, lecture.targetDetail].filter(Boolean).join(' / ') || '대상 미정';
    const place = lecture.place || '장소 미정';
    const status = isCanceledLecture(lecture) ? '폐강' : (lecture.status || '상태 미정');
    const assignee = assigneeData[getLectureKey(lecture)]?.masked;
    const statusLabel = assignee ? `${status} · 담당: ${assignee}` : status;
    const content = `
        <span class="calendar-event-time">${escapeHtml(time)}</span>
        <strong class="calendar-event-title">${title}</strong>
        <span class="calendar-event-meta">대상: ${escapeHtml(target)}</span>
        <span class="calendar-event-meta">장소: ${escapeHtml(place)}</span>
        <span class="calendar-event-status">${escapeHtml(statusLabel)}</span>`;
    const link = getSafeLectureDetailUrl(lecture.detailUrl);
    const className = `calendar-event ${calendarStatusClass(lecture)}`;
    return link
        ? `<a class="${className}" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(`${lecture.name}, ${time}, ${target}, ${place}, ${statusLabel}, 상세 페이지 열기`)}">${content}</a>`
        : `<div class="${className}" title="상세 페이지 링크 없음">${content}</div>`;
}

function renderLectureCalendar() {
    if (!activeCalendar) return;
    const { name, month, lectures, today } = activeCalendar;
    const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const leading = month.getUTCDay(); // Sunday is column 1.
    const occurrences = calendarOccurrencesInMonth(lectures, month);
    document.getElementById('lectureCalendarTitle').textContent = `${name} 강좌 달력`;
    document.getElementById('lectureCalendarMonth').textContent = `${month.getUTCFullYear()}년 ${month.getUTCMonth() + 1}월`;
    document.getElementById('lectureCalendarExport').textContent = `${month.getUTCMonth() + 1}월 엑셀 다운로드`;
    document.getElementById('lectureCalendarDescription').textContent =
        '수업 날짜를 기준으로 표시합니다. 강좌를 누르면 상세 페이지가 열립니다.';
    const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
    let html = weekdayNames.map((day, index) =>
        `<div class="lecture-calendar-weekday ${index === 0 ? 'sunday' : index === 6 ? 'saturday' : ''}">${day}</div>`
    ).join('');
    for (let i = 0; i < leading; i++) html += '<div class="lecture-calendar-day outside" aria-hidden="true"></div>';
    for (let day = 1; day <= days; day++) {
        const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day));
        const key = calendarDateKey(date);
        const weekday = date.getUTCDay();
        const events = occurrences.get(key) || [];
        const classes = ['lecture-calendar-day'];
        if (weekday === 0) classes.push('sunday');
        if (weekday === 6) classes.push('saturday');
        if (key === calendarDateKey(today)) classes.push('today');
        html += `<div class="${classes.join(' ')}" aria-label="${key}, 강좌 ${events.length}건">
            <div class="lecture-calendar-day-head"><span class="lecture-calendar-day-number">${day}</span>${events.length ? `<span class="lecture-calendar-day-count">${events.length}건</span>` : ''}</div>
            <div class="lecture-calendar-events">${events.map(calendarEventMarkup).join('')}</div>
        </div>`;
    }
    const remainder = (leading + days) % 7;
    if (remainder) {
        for (let i = remainder; i < 7; i++) html += '<div class="lecture-calendar-day outside" aria-hidden="true"></div>';
    }
    document.getElementById('lectureCalendarGrid').innerHTML = html;
    const entries = [...occurrences.values()].flat();
    const courseCount = new Set(entries.map(getLectureKey)).size;
    calendarModalNotice(entries.length ? `이 달 강좌 ${courseCount}개 · 수업 ${entries.length}회` : '이 달에 확인된 강좌가 없습니다.');
}

function calendarModalNotice(message) {
    document.getElementById('lectureCalendarNotice').textContent = message;
}

function moveLectureCalendar(offset) {
    if (!activeCalendar) return;
    const requested = calendarMonthStart(activeCalendar.month, offset);
    if (requested < activeCalendar.bounds.first) {
        calendarModalNotice('최근 6개월 범위를 벗어났습니다.');
        return;
    }
    if (requested > activeCalendar.bounds.last) {
        calendarModalNotice('이후 일정은 아직 등록되지 않았습니다.');
        return;
    }
    activeCalendar.month = requested;
    renderLectureCalendar();
}

function calendarExportRows(lectures, month, assignees) {
    const rows = [];
    const occurrences = calendarOccurrencesInMonth(lectures, month);
    for (const [date, dailyLectures] of occurrences) {
        for (const lecture of dailyLectures) {
            rows.push({
                date,
                lectureKey: getLectureKey(lecture),
                beginTime: lecture.beginTime || '',
                endTime: lecture.endTime || '',
                name: lecture.name || '',
                target: [lecture.targetNm, lecture.targetDetail].filter(Boolean).join(' / '),
                place: lecture.place || '',
                status: isCanceledLecture(lecture) ? '폐강' : (lecture.status || ''),
                assignee: assignees[getLectureKey(lecture)]?.masked || '',
                url: getSafeLectureDetailUrl(lecture.detailUrl),
            });
        }
    }
    return rows;
}

function downloadLectureCalendar() {
    if (!activeCalendar) return;
    const rows = calendarExportRows(activeCalendar.lectures, activeCalendar.month, assigneeData);
    const month = activeCalendar.month;
    const bytes = createLectureWorkbook(activeCalendar.name, month, rows);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const monthLabel = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
    link.download = `${activeCalendar.name.replace(/[\\/:*?"<>|]/g, '_')}_강좌_달력_${monthLabel}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    calendarModalNotice(`${month.getUTCFullYear()}년 ${month.getUTCMonth() + 1}월 달력을 엑셀로 저장했습니다.`);
}

if (typeof document !== 'undefined') {
    const dialog = document.getElementById('lectureCalendarDialog');
    document.getElementById('lectureCalendarClose').addEventListener('click', () => dialog.close());
    document.getElementById('lectureCalendarPrev').addEventListener('click', () => moveLectureCalendar(-1));
    document.getElementById('lectureCalendarNext').addEventListener('click', () => moveLectureCalendar(1));
    document.getElementById('lectureCalendarExport').addEventListener('click', downloadLectureCalendar);
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
        activeCalendar = null;
        if (calendarReturnFocus && calendarReturnFocus.isConnected) calendarReturnFocus.focus();
        calendarReturnFocus = null;
    });
    institutionSelect.addEventListener('change', () => calendarEntryNotice(''));
}

if (typeof module !== 'undefined') {
    module.exports = {
        calendarMonthStart, calendarDateKey, calendarOccursOn, calendarLastOccurrence,
        calendarBounds, calendarOccurrencesInMonth, calendarEventMarkup, calendarExportRows,
    };
}
