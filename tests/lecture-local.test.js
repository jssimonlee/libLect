const assert = require('node:assert/strict');
const { LOCAL_LECTURES_KEY, normalizeLocalLecture, createLocalLectureStore } = require('../lecture-local');
const memory = new Map();
const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
let sequence = 0;
const makeId = () => `local:00000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`;
const input = {
    institution: '노을빛도서관', name: '도서관 자체 행사', eventType: '행사', scheduleMode: 'once',
    beginDate: '2026-09-30', beginTime: '10:00', endTime: '11:00', status: '접수 없음',
    targetNm: '초등', place: '문화교실', price: '', applyLimitNum: '',
};
const store = createLocalLectureStore(storage, makeId);
const saved = store.save(input);
assert.equal(saved.source, 'local');
assert.equal(saved.endDate, '2026-09-30');
assert.equal(saved.price, null);
assert.equal(saved.applyLimitNum, null);
assert.equal(saved.applyUserNum, '');
assert.equal(createLocalLectureStore(storage).list()[0].name, input.name);
assert.equal(createLocalLectureStore({ getItem: () => null, setItem() {} }).list().length, 0);
assert.throws(() => normalizeLocalLecture({ ...input, beginDate: '2026-02-30' }, saved.lectureIdx));
assert.throws(() => normalizeLocalLecture({ ...input, endTime: '09:00' }, saved.lectureIdx));
assert.throws(() => normalizeLocalLecture({ ...input, scheduleMode: 'weekly', endDate: '2026-10-30', dayOfWeek: '' }, saved.lectureIdx));
assert.throws(() => normalizeLocalLecture({ ...input, scheduleMode: 'weekly', endDate: input.beginDate, dayOfWeek: '1' }, saved.lectureIdx));
const weekly = store.save({ ...input, name: '매주 독서모임', scheduleMode: 'weekly', endDate: '2026-10-31', dayOfWeek: '3,3,5' });
assert.equal(weekly.dayOfWeek, '3,5');
const allDay = store.save({ ...input, allDay: true, beginTime: '', endTime: '' });
assert.equal(allDay.beginTime, '');
assert.equal(allDay.allDay, true);
store.setAssignee(saved.lectureIdx, { masked: '*길*', color: '#ef4444', nameHash: 'hash' });
const withAssignee = store.list().find(item => item.lectureIdx === saved.lectureIdx);
assert.equal(withAssignee.assignee.masked, '*길*');
const updated = store.save({ ...withAssignee, name: '수정한 자체 행사' }, withAssignee);
assert.equal(updated.lectureIdx, saved.lectureIdx);
assert.equal(updated.assignee.masked, '*길*');
assert.throws(() => store.save({ ...input, name: '오래된 창의 수정' }, saved), /다른 창/);
const otherTab = createLocalLectureStore(storage, makeId);
const otherRecord = otherTab.save({ ...input, name: '다른 창의 행사' });
store.save({ ...input, name: '새 행사' });
assert.ok(store.list().some(item => item.lectureIdx === otherRecord.lectureIdx));
store.remove(updated);
assert.ok(!store.list().some(item => item.lectureIdx === updated.lectureIdx));
assert.throws(() => store.save(input, updated), /삭제/);
assert.throws(() => store.setAssignee(updated.lectureIdx, null), /삭제/);
const beforeFailure = storage.getItem(LOCAL_LECTURES_KEY);
const failingStorage = { getItem: storage.getItem, setItem: () => { throw new Error('QuotaExceededError'); } };
const failingStore = createLocalLectureStore(failingStorage, makeId);
const beforeList = failingStore.list();
assert.throws(() => failingStore.save(input), /저장하지 못했습니다/);
assert.deepEqual(failingStore.list(), beforeList);
assert.equal(storage.getItem(LOCAL_LECTURES_KEY), beforeFailure);
const corruptMemory = new Map([[LOCAL_LECTURES_KEY, 'broken json']]);
const corruptStore = createLocalLectureStore({ getItem: key => corruptMemory.get(key), setItem: (key, value) => corruptMemory.set(key, value) });
assert.ok(corruptStore.error());
assert.throws(() => corruptStore.save(input));
assert.equal(corruptMemory.get(LOCAL_LECTURES_KEY), 'broken json');
assert.ok(createLocalLectureStore(null).error());

global.parseDateOnly = value => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null;
global.parseDayCodes = value => value ? value.split(',') : [];
global.getApiDayCode = date => String(date.getUTCDay() || 7);
global.getLectureKey = lecture => lecture.lectureIdx;
global.isCanceledLecture = lecture => lecture.status === '폐강';
global.escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
global.escapeAttr = global.escapeHtml;
global.getSafeLectureDetailUrl = () => '';
global.assigneeData = {};
const { calendarOccurrencesInMonth, calendarExportRows, calendarEventMarkup } = require('../lecture-calendar');
const month = new Date('2026-09-01T00:00:00Z');
assert.equal(calendarOccurrencesInMonth([weekly, allDay], month).get('2026-09-30').length, 2);
const rows = calendarExportRows([weekly, { ...allDay, assignee: { masked: '*길*' } }], month, {});
assert.equal(rows.find(row => row.lectureKey === allDay.lectureIdx).assignee, '*길*');
assert.equal(rows.find(row => row.lectureKey === allDay.lectureIdx).allDay, true);
assert.ok(rows.every(row => row.source === 'local'));
assert.match(calendarEventMarkup({ ...allDay, name: '<입력 이름>', assignee: { masked: '*길*' } }), /&lt;입력 이름>/);
assert.match(calendarEventMarkup(allDay), /data-local-edit=/);
assert.match(calendarEventMarkup(allDay), /종일/);
const { createLectureWorkbook } = require('../lecture-xlsx');
const workbook = Buffer.from(createLectureWorkbook('노을빛도서관', month, rows));
assert.ok(workbook.includes(Buffer.from('직접 입력 · 로컬')));
assert.ok(workbook.includes(Buffer.from('시간: 종일')));
assert.ok(!workbook.includes(Buffer.from('<hyperlink')));
// Exercise the real UI handlers with an unavailable network: local assignees
// must never fall through to the shared server-writing paths.
const fs = require('node:fs');
const vm = require('node:vm');
const appSource = fs.readFileSync(require.resolve('../lecture-app.js'), 'utf8');
const functionSource = (start, end) => appSource.slice(appSource.indexOf(start), appSource.indexOf(end, appSource.indexOf(start)));
const overlay = { dataset: { lectureKey: allDay.lectureIdx } };
const saveButton = { disabled: false };
const calls = [];
const context = vm.createContext({
    document: {
        getElementById: id => id === 'assigneePopoverOverlay' ? overlay : id === 'assigneeNameInput' ? { value: '홍길동' } : saveButton,
        querySelector: () => ({}),
    },
    selectedMask: '*길*', selectedColor: '#ef4444',
    saveLocalLectureAssignee: async (...args) => calls.push(['save', ...args]),
    deleteLocalLectureAssignee: key => calls.push(['delete', key]),
    closeAssigneePopover: () => calls.push(['close']),
    fetch: () => { throw new Error('Local schedules must not write to the server'); },
    alert: message => { throw new Error(message); },
});
vm.runInContext(functionSource('async function saveAssignee()', 'async function deleteAssignee()'), context);
vm.runInContext(functionSource('async function deleteAssignee()', 'function closeAssigneePopover()'), context);
const allDayBadge = { dataset: { allDay: 'true', beginTime: '', endTime: '', activity: '행사' }, className: 'today-sub-badge ongoing', textContent: '⚡ 행사중' };
const timedBadge = { dataset: { beginTime: '00:00', endTime: '23:59:59', activity: '행사' }, className: 'today-sub-badge upcoming' };
const badgeContext = vm.createContext({ document: { querySelectorAll: () => [allDayBadge, timedBadge] } });
vm.runInContext(functionSource('function updateTodayLectureBadges()', '// 30초마다'), badgeContext);
vm.runInContext('updateTodayLectureBadges()', badgeContext);
assert.equal(allDayBadge.textContent, '⚡ 행사중');
assert.equal(timedBadge.textContent, '⚡ 행사중');
(async () => {
    await vm.runInContext('saveAssignee()', context);
    await vm.runInContext('deleteAssignee()', context);
    assert.deepEqual(calls.map(call => call[0]), ['save', 'close', 'delete', 'close']);
    assert.equal(calls[0][1], allDay.lectureIdx);
    console.log('PASS local schedules: persistence, recurrence, isolated storage, conflicts, failure handling, calendar, Excel and local-only assignee handlers');
})().catch(error => { console.error(error); process.exitCode = 1; });
