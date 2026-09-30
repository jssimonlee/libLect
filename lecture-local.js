const LOCAL_LECTURES_KEY = 'liblect.localLectures.v1';
const LOCAL_LECTURE_NOTICE = '이 일정은 현재 컴퓨터의 이 브라우저에만 저장됩니다. 다른 컴퓨터·브라우저·사용자와 공유되지 않으며, 사이트 데이터를 삭제하면 사라질 수 있습니다. 시크릿 창에서는 창을 닫으면 삭제될 수 있습니다.';
const LOCAL_LECTURE_COLORS = new Set(['#ef4444', '#3b82f6', '#10b981', '#eab308', '#a7f3d0', '#1f2937', '#8b5a2b']);

function localDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function normalizeLocalLecture(input, id, previous = null) {
    const text = (key, max, required = false) => {
        const value = String(input[key] ?? '').trim();
        if ((required && !value) || value.length > max) throw new Error(`${key === 'name' ? '제목' : key === 'institution' ? '도서관' : '입력 내용'}을 확인해 주세요.`);
        return value;
    };
    if (!/^local:[a-f0-9-]{36}$/i.test(id || '')) throw new Error('일정 식별자를 확인하지 못했습니다.');
    const institution = text('institution', 100, true);
    const name = text('name', 120, true);
    const eventType = input.eventType === '행사' ? '행사' : '강좌';
    const scheduleMode = input.scheduleMode === 'weekly' ? 'weekly' : 'once';
    const beginDate = text('beginDate', 10, true);
    const endDate = scheduleMode === 'once' ? beginDate : text('endDate', 10, true);
    if (!localDate(beginDate) || !localDate(endDate) || endDate < beginDate) throw new Error('시작일과 종료일을 확인해 주세요.');
    const dayOfWeek = scheduleMode === 'weekly'
        ? [...new Set(String(input.dayOfWeek || '').split(',').filter(day => /^[1-7]$/.test(day)))].sort().join(',') : '';
    if (scheduleMode === 'weekly') {
        if (!dayOfWeek) throw new Error('반복할 요일을 한 개 이상 선택해 주세요.');
        const first = localDate(beginDate);
        const last = localDate(endDate);
        let hasDate = false;
        for (let i = 0; i < 7 && first <= last; i++, first.setUTCDate(first.getUTCDate() + 1)) {
            if (dayOfWeek.split(',').includes(String(first.getUTCDay() || 7))) hasDate = true;
        }
        if (!hasDate) throw new Error('선택한 기간에 해당 요일이 없습니다.');
    }
    const allDay = input.allDay === true;
    const beginTime = allDay ? '' : text('beginTime', 5, true);
    const endTime = allDay ? '' : text('endTime', 5, true);
    const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!allDay && (!validTime(beginTime) || !validTime(endTime) || endTime <= beginTime)) {
        throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
    }
    const status = String(input.status || '접수 없음');
    if (!['접수 없음', '접수예정', '접수중', '접수마감', '강좌종료', '폐강'].includes(status)) throw new Error('접수 상태를 확인해 주세요.');
    const applyBegin = status === '접수 없음' ? '' : text('applyBegin', 10);
    const applyEnd = status === '접수 없음' ? '' : text('applyEnd', 10);
    if ((applyBegin || applyEnd) && (!localDate(applyBegin) || !localDate(applyEnd) || applyEnd < applyBegin)) {
        throw new Error('접수 시작일과 종료일을 함께 입력하고 날짜 순서를 확인해 주세요.');
    }
    const number = (key, max) => {
        if (input[key] === '' || input[key] === null || input[key] === undefined) return null;
        const value = Number(input[key]);
        if (!Number.isInteger(value) || value < 0 || value > max) throw new Error('비용과 정원은 0 이상의 정수로 입력해 주세요.');
        return value;
    };
    const price = number('price', 10000000);
    const capacity = number('applyLimitNum', 100000);
    const assignee = previous?.assignee || input.assignee;
    return {
        lectureIdx: id, source: 'local', institution, name, eventType, scheduleMode,
        beginDate, endDate, dayOfWeek, allDay, beginTime, endTime, status, applyBegin, applyEnd,
        targetNm: text('targetNm', 100), targetDetail: text('targetDetail', 100), place: text('place', 150),
        note: text('note', 1000), price, freeNm: price === null ? '비용 미정' : price === 0 ? '무료' : `${price.toLocaleString('ko-KR')}원`,
        classNm: eventType, applyLimitNum: capacity, applyUserNum: '', waitLimitNum: 0, waitUserNum: '', detailUrl: '',
        assignee: assignee && typeof assignee.masked === 'string' && assignee.masked.length <= 10 && LOCAL_LECTURE_COLORS.has(assignee.color)
            ? { masked: assignee.masked, color: assignee.color, nameHash: String(assignee.nameHash || '').slice(0, 64) } : null,
        created_at: previous?.created_at || Number(input.created_at) || Date.now(),
        updated_at: Number(input.updated_at) || Date.now(),
    };
}

function createLocalLectureStore(storage, makeId = () => `local:${crypto.randomUUID()}`) {
    let records = [];
    let loadError = '';
    const read = () => {
        if (!storage) throw new Error('이 브라우저에서 로컬 저장소를 사용할 수 없습니다.');
        const raw = storage.getItem(LOCAL_LECTURES_KEY);
        if (!raw) return [];
        const payload = JSON.parse(raw);
        if (payload.version !== 1 || !Array.isArray(payload.lectures)) throw new Error('직접 입력 일정의 저장 형식을 확인하지 못했습니다.');
        const list = payload.lectures.map(item => normalizeLocalLecture(item, item.lectureIdx));
        if (new Set(list.map(item => item.lectureIdx)).size !== list.length) throw new Error('저장된 일정 식별자가 중복되었습니다.');
        return list;
    };
    const reload = () => {
        try { records = read(); loadError = ''; }
        catch (_) { loadError = '직접 입력 일정을 읽지 못했습니다. 저장소 접근 또는 저장된 데이터를 확인해 주세요. 기존 데이터는 덮어쓰지 않습니다.'; }
        return !loadError;
    };
    const commit = list => {
        try { storage.setItem(LOCAL_LECTURES_KEY, JSON.stringify({ version: 1, lectures: list })); }
        catch (_) { throw new Error('이 브라우저에 저장하지 못했습니다. 저장 공간이나 브라우저 설정을 확인해 주세요.'); }
        records = list;
        loadError = '';
    };
    reload();
    return {
        list: () => records.map(record => ({ ...record, assignee: record.assignee ? { ...record.assignee } : null })),
        error: () => loadError,
        reload,
        save(input, previous = null) {
            const list = read(); // Read again to preserve changes made in another tab.
            const current = previous && list.find(item => item.lectureIdx === previous.lectureIdx);
            if (previous && (!current || current.updated_at !== previous.updated_at)) throw new Error('다른 창에서 이 일정이 변경되었거나 삭제되었습니다. 창을 닫고 다시 열어 주세요.');
            const record = normalizeLocalLecture(input, previous?.lectureIdx || makeId(), current);
            record.updated_at = Math.max(Date.now(), (current?.updated_at || 0) + 1);
            commit([...list.filter(item => item.lectureIdx !== record.lectureIdx), record]);
            return record;
        },
        remove(previous) {
            const list = read();
            const current = list.find(item => item.lectureIdx === previous.lectureIdx);
            if (!current || current.updated_at !== previous.updated_at) throw new Error('다른 창에서 일정이 변경되었습니다. 창을 닫고 다시 열어 주세요.');
            commit(list.filter(item => item.lectureIdx !== previous.lectureIdx));
        },
        setAssignee(id, assignee) {
            const list = read();
            const current = list.find(item => item.lectureIdx === id);
            if (!current) throw new Error('이 일정은 삭제되었습니다.');
            current.assignee = assignee;
            current.updated_at = Math.max(Date.now(), current.updated_at + 1);
            commit(list);
        },
    };
}

let localLectureStore;
if (typeof window !== 'undefined') {
    let storage = null;
    try { storage = window.localStorage; } catch (_) { /* The editor reports unavailable storage. */ }
    localLectureStore = createLocalLectureStore(storage);
}
function getLocalLectures() { return localLectureStore?.list() || []; }
function isLocalLecture(lecture) { return lecture?.source === 'local'; }
function getLocalLecture(key) { return getLocalLectures().find(item => item.lectureIdx === key); }

function localLectureFeedback(message) {
    let notice = document.getElementById('localLectureFeedback');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'localLectureFeedback';
        notice.className = 'local-lecture-feedback';
        notice.setAttribute('role', 'status');
        document.body.appendChild(notice);
    }
    notice.textContent = message;
    clearTimeout(localLectureFeedback.timer);
    localLectureFeedback.timer = setTimeout(() => notice.remove(), 9000);
    if (typeof activeCalendar !== 'undefined' && activeCalendar) calendarModalNotice(message);
}

function refreshLocalLectureViews(month = null) {
    allData = getSearchBaseData();
    updateFilterButtons(getFilterCounts(allData));
    renderResults();
    if (typeof activeCalendar !== 'undefined' && activeCalendar) {
        activeCalendar.lectures = getAllLectures().filter(item => item.institution === activeCalendar.name);
        activeCalendar.bounds = calendarBounds(activeCalendar.today, activeCalendar.lectures);
        if (month && month >= activeCalendar.bounds.first && month <= activeCalendar.bounds.last) activeCalendar.month = month;
        if (activeCalendar.month > activeCalendar.bounds.last) activeCalendar.month = activeCalendar.bounds.last;
        renderLectureCalendar();
    }
}

function openLocalLectureEditor(key = '') {
    if (document.getElementById('localLectureDialog')?.open) return;
    localLectureStore.reload();
    let previous = key ? getLocalLecture(key) : null;
    if (key && !previous) { localLectureFeedback('이 일정을 찾지 못했습니다. 달력을 다시 확인해 주세요.'); return; }
    const calendar = typeof activeCalendar !== 'undefined' ? activeCalendar : null;
    const institution = previous?.institution || calendar?.name;
    if (!institution) return;
    const today = getKoreaTodayDateOnly();
    const month = calendar?.month || calendarMonthStart(today);
    const initialDate = calendarDateKey(month.getTime() === calendarMonthStart(today).getTime() ? today : month);
    const value = previous || { institution, eventType: '강좌', scheduleMode: 'once', beginDate: initialDate, endDate: initialDate, status: '접수 없음', allDay: false };
    const dialog = document.createElement('dialog');
    dialog.id = 'localLectureDialog';
    dialog.className = 'local-lecture-dialog';
    dialog.setAttribute('aria-labelledby', 'localLectureTitle');
    dialog.innerHTML = `
        <div class="local-lecture-heading"><div><p class="lecture-calendar-eyebrow">${escapeHtml(institution)}</p>
            <h2 id="localLectureTitle">${previous ? '직접 입력 일정 수정' : '도서관 자체 일정 추가'}</h2></div>
            <button type="button" class="lecture-calendar-close" data-local-close aria-label="입력창 닫기">×</button></div>
        <p class="local-lecture-purpose">통합예약시스템에 없는 도서관 자체 강좌·행사를 추가합니다.</p>
        <p class="local-storage-notice">${LOCAL_LECTURE_NOTICE}</p>
        <form id="localLectureForm">
            <div class="local-form-grid">
                <label>구분<select name="eventType"><option>강좌</option><option>행사</option></select></label>
                <label>일정 방식<select name="scheduleMode"><option value="once">하루 일정</option><option value="weekly">매주 반복</option></select></label>
                <label class="local-field-wide"><span>제목 <span class="local-required">필수</span></span><input name="name" required maxlength="120" placeholder="예: 도서관 어린이 독서모임"></label>
                <label><span data-start-label>날짜</span><input name="beginDate" type="date" required></label>
                <label data-weekly>종료일<input name="endDate" type="date"></label>
                <fieldset class="local-field-wide local-weekdays" data-weekly><legend>반복 요일</legend>
                    ${['월', '화', '수', '목', '금', '토', '일'].map((day, index) => `<label><input type="checkbox" name="weekday" value="${index + 1}">${day}</label>`).join('')}
                    <small>선택한 요일에 같은 일정이 반복됩니다. 수정·삭제는 전체 반복 일정에 적용됩니다.</small></fieldset>
                <label class="local-field-wide local-check"><input name="allDay" type="checkbox">종일 일정</label>
                <label>시작 시간<input name="beginTime" type="time" required></label>
                <label>종료 시간<input name="endTime" type="time" required></label>
                <label>대상<input name="targetNm" maxlength="100" placeholder="예: 초등학생, 누구나"></label>
                <label>대상 상세<input name="targetDetail" maxlength="100" placeholder="예: 1~2학년"></label>
                <label class="local-field-wide">장소<input name="place" maxlength="150" placeholder="예: 2층 문화교실"></label>
            </div>
            <details class="local-extra-fields"><summary>접수·비용·정원·메모</summary><div class="local-form-grid">
                <label class="local-field-wide">접수 상태<select name="status">${['접수 없음', '접수예정', '접수중', '접수마감', '강좌종료', '폐강'].map(status => `<option>${status}</option>`).join('')}</select></label>
                <label data-registration>접수 시작일<input name="applyBegin" type="date"></label>
                <label data-registration>접수 종료일<input name="applyEnd" type="date"></label>
                <label>비용 (원)<input name="price" type="number" min="0" max="10000000" step="1" placeholder="무료는 0, 미정은 비워두기"></label>
                <label>정원 (명)<input name="applyLimitNum" type="number" min="0" max="100000" step="1" placeholder="미정은 비워두기"></label>
                <label class="local-field-wide">메모<textarea name="note" maxlength="1000" rows="3" placeholder="참여 방법이나 준비물"></textarea></label>
            </div></details>
            <div class="local-assignee-area">${previous ? renderAssigneeButton(previous) : '<span>담당자는 저장 후 일정의 수정창에서 등록할 수 있습니다.</span>'}</div>
            <p id="localLectureError" class="local-form-error" role="alert"></p>
            <div class="local-form-actions">${previous ? '<button type="button" class="local-delete-button" data-local-delete>일정 삭제</button>' : ''}
                <button type="button" data-local-close>취소</button><button type="submit" class="local-save-button">이 브라우저에 저장</button></div>
        </form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector('form');
    for (const name of ['eventType', 'scheduleMode', 'name', 'beginDate', 'endDate', 'beginTime', 'endTime', 'targetNm', 'targetDetail', 'place', 'status', 'applyBegin', 'applyEnd', 'price', 'applyLimitNum', 'note']) {
        form.elements[name].value = value[name] ?? '';
    }
    form.elements.allDay.checked = value.allDay;
    form.querySelectorAll('[name="weekday"]').forEach(input => { input.checked = (value.dayOfWeek || '').split(',').includes(input.value); });
    const updateFields = () => {
        const weekly = form.elements.scheduleMode.value === 'weekly';
        form.querySelector('[data-start-label]').textContent = weekly ? '시작일' : '날짜';
        form.querySelectorAll('[data-weekly]').forEach(element => { element.hidden = !weekly; });
        form.elements.endDate.required = weekly;
        form.elements.endDate.disabled = !weekly;
        for (const name of ['beginTime', 'endTime']) {
            form.elements[name].disabled = form.elements.allDay.checked;
            form.elements[name].required = !form.elements.allDay.checked;
        }
        const registration = form.elements.status.value !== '접수 없음';
        form.querySelectorAll('[data-registration]').forEach(element => { element.hidden = !registration; });
        form.elements.applyBegin.disabled = !registration;
        form.elements.applyEnd.disabled = !registration;
    };
    form.addEventListener('change', updateFields);
    updateFields();
    const error = dialog.querySelector('#localLectureError');
    error.textContent = localLectureStore.error();
    const returnFocus = document.activeElement;
    dialog.querySelectorAll('[data-local-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => { dialog.remove(); if (returnFocus?.isConnected) returnFocus.focus(); });
    dialog.querySelector('[data-local-delete]')?.addEventListener('click', () => {
        if (!confirm('이 브라우저에 저장된 일정을 삭제할까요? 반복 일정은 모두 삭제됩니다.')) return;
        try {
            localLectureStore.remove(previous);
            dialog.close();
            refreshLocalLectureViews();
            localLectureFeedback('이 브라우저에서 직접 입력 일정을 삭제했습니다.');
        } catch (failure) { error.textContent = failure.message; }
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const input = Object.fromEntries(new FormData(form));
        input.institution = institution;
        input.allDay = form.elements.allDay.checked;
        input.dayOfWeek = [...form.querySelectorAll('[name="weekday"]:checked')].map(day => day.value).join(',');
        try {
            const next = normalizeLocalLecture(input, previous?.lectureIdx || 'local:00000000-0000-0000-0000-000000000000');
            const first = calendarMonthStart(today, -6);
            const last = calendarMonthStart(today, 12); last.setUTCDate(0);
            if ((!previous || previous.beginDate !== next.beginDate || previous.endDate !== next.endDate)
                && (localDate(next.beginDate) < first || localDate(next.endDate) > last)) {
                throw new Error('새 일정의 날짜는 현재 달 기준 6개월 전부터 11개월 뒤의 말일까지 입력해 주세요.');
            }
            const saved = localLectureStore.save(input, previous);
            dialog.close();
            refreshLocalLectureViews(calendarMonthStart(localDate(saved.beginDate)));
            localLectureFeedback('이 브라우저에 저장했습니다. 다른 컴퓨터·브라우저·사용자에게는 표시되지 않습니다.');
        } catch (failure) { error.textContent = failure.message; }
    });
    // Assignee saves change the record revision, so keep this open editor current.
    dialog.addEventListener('local-assignee-updated', () => {
        previous = getLocalLecture(key);
        if (!previous) { dialog.close(); return; }
        dialog.querySelector('.local-assignee-area').innerHTML = `${renderAssigneeButton(previous)}<p>담당자도 이 브라우저에만 저장되며 다른 컴퓨터·사용자와 공유되지 않습니다.</p>`;
    });
    dialog.showModal();
    form.elements.name.focus();
}

function mountLocalAssigneePopover(overlay) {
    const dialog = document.createElement('dialog');
    dialog.id = 'localAssigneeDialog';
    dialog.className = 'local-assignee-dialog';
    dialog.setAttribute('aria-label', '직접 입력 일정 담당자 등록');
    dialog.appendChild(overlay);
    document.body.appendChild(dialog);
    overlay.querySelector('.pop-subtitle').textContent = '담당자도 이 브라우저에만 저장되며 다른 컴퓨터·사용자와 공유되지 않습니다.';
    overlay.querySelector('.pop-save').textContent = '이 브라우저에 저장';
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeAssigneePopover(); });
    dialog.showModal();
}

async function saveLocalLectureAssignee(key, name, masked, color) {
    if (!generateMaskOptions(name).includes(masked) || !LOCAL_LECTURE_COLORS.has(color)) throw new Error('담당자 표시와 색상을 확인해 주세요.');
    const nameHash = await hashAssigneeName(name);
    localLectureStore.setAssignee(key, { nameHash, masked, color });
    refreshLocalLectureViews();
    document.getElementById('localLectureDialog')?.dispatchEvent(new Event('local-assignee-updated'));
    localLectureFeedback('담당자를 이 브라우저에 저장했습니다. 다른 컴퓨터·사용자와 공유되지 않습니다.');
}

function deleteLocalLectureAssignee(key) {
    localLectureStore.setAssignee(key, null);
    refreshLocalLectureViews();
    document.getElementById('localLectureDialog')?.dispatchEvent(new Event('local-assignee-updated'));
    localLectureFeedback('이 브라우저에서 담당자를 삭제했습니다.');
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-local-edit]');
        if (button) openLocalLectureEditor(button.dataset.localEdit);
    });
    window.addEventListener('storage', event => {
        if (event.key !== LOCAL_LECTURES_KEY && event.key !== null) return;
        if (localLectureStore.reload()) refreshLocalLectureViews();
        else localLectureFeedback(localLectureStore.error());
    });
}
if (typeof module !== 'undefined') module.exports = { LOCAL_LECTURES_KEY, normalizeLocalLecture, createLocalLectureStore, isLocalLecture };
