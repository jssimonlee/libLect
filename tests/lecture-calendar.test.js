const assert = require('node:assert/strict');

global.parseDateOnly = value => {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};
global.parseDayCodes = value => value ? String(value).split(',').map(day => day.trim()) : [];
global.getApiDayCode = date => date.getUTCDay() === 0 ? '7' : String(date.getUTCDay());
global.getLectureKey = lecture => lecture.lectureIdx;
global.isCanceledLecture = lecture => lecture.status === '폐강';
global.getSafeLectureDetailUrl = url => url;
global.escapeHtml = value => String(value).replace(/&/g, '&amp;');
global.escapeAttr = value => String(value);
global.assigneeData = { 1: { masked: '*길*' } };

const {
    calendarDateKey, calendarOccursOn, calendarBounds, calendarOccurrencesInMonth,
    calendarEventMarkup, calendarExportRows,
} = require('../lecture-calendar.js');
const { createLectureWorkbook } = require('../lecture-xlsx.js');

const mondayClass = {
    name: '월요일 수업', beginDate: '2026-09-07', endDate: '2026-11-30',
    dayOfWeek: '1', beginTime: '10:00', endTime: '11:30',
};
const oneDayClass = {
    name: '하루 수업', beginDate: '2026-09-12', endDate: '2026-09-12',
    dayOfWeek: '', beginTime: '14:00', endTime: '16:00',
};
const today = new Date(Date.UTC(2026, 8, 28));
assert.equal(calendarOccursOn(mondayClass, today), true);
assert.equal(calendarOccursOn(mondayClass, new Date(Date.UTC(2026, 8, 29))), false);
assert.equal(calendarOccursOn(oneDayClass, new Date(Date.UTC(2026, 8, 12))), true);
assert.equal(calendarOccursOn(oneDayClass, today), false);
const september = calendarOccurrencesInMonth([mondayClass, oneDayClass], today);
assert.equal(september.get('2026-09-07').length, 1);
assert.equal(september.get('2026-09-12').length, 1);
assert.equal(september.has('2026-09-13'), false);

const futureClass = {
    name: '내년 수업', beginDate: '2027-02-03', endDate: '2027-02-03',
    dayOfWeek: '',
};
const bounds = calendarBounds(today, [mondayClass, futureClass]);
assert.equal(calendarDateKey(bounds.first), '2026-03-01');
assert.equal(calendarDateKey(bounds.last), '2027-02-01');
const emptyBounds = calendarBounds(today, []);
assert.equal(calendarDateKey(emptyBounds.last), '2026-09-01');
const tooFarClass = {
    name: '범위 밖', beginDate: '2027-10-01', endDate: '2027-10-01',
    dayOfWeek: '',
};
assert.equal(calendarDateKey(calendarBounds(today, [tooFarClass]).last), '2026-09-01');

function zipContents(bytes) {
    const zip = Buffer.from(bytes);
    const output = new Map();
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
        const size = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
        const start = offset + 30 + nameLength + extraLength;
        output.set(name, zip.subarray(start, start + size).toString('utf8'));
        offset = start + size;
    }
    return output;
}

const exportRows = calendarExportRows([
    { ...oneDayClass, lectureIdx: '1', status: '접수마감', targetNm: '초등', targetDetail: '1~2학년',
      place: '문화교실', detailUrl: 'https://example.com/1' },
    { ...oneDayClass, lectureIdx: '2', name: '두 번째 강좌', status: '접수중', detailUrl: 'https://example.com/2' },
    { ...futureClass, lectureIdx: '3', status: '접수예정' },
], today, { 1: { masked: '*길*' } });
assert.equal(exportRows.length, 2);
assert.equal(exportRows.find(row => row.url.endsWith('/1')).assignee, '*길*');
assert.equal(exportRows.find(row => row.url.endsWith('/2')).assignee, '');
assert.match(calendarEventMarkup({ lectureIdx: '1', name: '책 수업', status: '접수마감', detailUrl: 'https://example.com/1' }), /접수마감 · 담당: \*길\*/);
assert.doesNotMatch(calendarEventMarkup({ lectureIdx: '2', name: '책 수업', status: '접수마감', detailUrl: 'https://example.com/2' }), /담당:/);

const workbook = createLectureWorkbook('샘내작은도서관', today, [
    {
        lectureKey: 'lecture-1',
        date: '2026-09-28', beginTime: '10:00', endTime: '11:30',
        name: '책 & 글쓰기', target: '초등 / 1~2학년', place: '문화교실',
        status: '접수마감', assignee: '*길*', url: 'https://yeyak.hscity.go.kr/lectureDetail.do?lectureIdx=1',
    },
    { lectureKey: 'lecture-2', date: '2026-09-28', beginTime: '13:00', name: '두 번째 강좌', status: '접수중', url: '' },
    { lectureKey: 'lecture-1', date: '2026-09-29', beginTime: '10:00', name: '책 & 글쓰기', status: '접수마감', url: '' },
    { date: '2026-10-01', name: '다른 달 강좌', status: '접수예정', url: '' },
]);
const files = zipContents(workbook);
assert.ok(files.has('[Content_Types].xml'));
assert.ok(files.has('xl/workbook.xml'));
assert.ok(files.has('xl/worksheets/sheet1.xml'));
const sheet = files.get('xl/worksheets/sheet1.xml');
assert.match(sheet, /<dimension ref="A1:G\d+"/);
assert.match(sheet, /<mergeCell ref="A1:G1"/);
assert.match(sheet, /<c r="A4"[^>]*>.*?<t[^>]*>일<\/t>/);
assert.match(sheet, /책 &amp; 글쓰기/);
assert.match(sheet, /담당: \*길\*/);
assert.match(sheet, /시간: 10:00–11:30/);
assert.match(sheet, /대상: 초등 \/ 1~2학년/);
assert.match(sheet, /장소: 문화교실/);
assert.match(sheet, /상태: 접수마감/);
assert.match(sheet, /강좌 2개 · 수업 3회/);
assert.doesNotMatch(sheet, /다른 달 강좌/);
assert.match(sheet, /<c r="B\d+" s="6"><v>46293<\/v><\/c>/);
assert.doesNotMatch(sheet, /<hyperlinks?\b/);
assert.equal(files.has('xl/worksheets/_rels/sheet1.xml.rels'), false);
assert.doesNotMatch(sheet, /lectureDetail\.do\?lectureIdx=1/);
assert.match(files.get('xl/workbook.xml'), /2026-09/);
assert.match(sheet, /<c r="B14" t="inlineStr" s="14">/);
assert.match(sheet, /<c r="B15" t="inlineStr" s="18">/);
for (const column of ['A', 'C', 'D', 'E', 'F', 'G']) {
    const outsideMonth = ['E', 'F', 'G'].includes(column);
    const firstStyle = outsideMonth ? 23 : column === 'C' ? 14 : 24;
    const secondStyle = outsideMonth ? 25 : 26;
    assert.match(sheet, new RegExp(`<c r="${column}14" t="inlineStr" s="${firstStyle}">`));
    assert.match(sheet, new RegExp(`<c r="${column}15" t="inlineStr" s="${secondStyle}">`));
}
const styles = files.get('xl/styles.xml');
assert.match(styles, /<borders count="5">/);
assert.match(styles, /<bottom style="dotted">/);
assert.match(styles, /<top style="dotted">/);
assert.match(styles, /<left style="medium">/);
assert.match(styles, /<fonts count="9">/);
assert.match(styles, /<name val="Malgun Gothic"\/>/);
assert.doesNotMatch(styles, /Apple SD Gothic Neo/);
assert.match(styles, /<xf numFmtId="164" fontId="6"[^>]*><alignment horizontal="center" vertical="center"\/><\/xf>/);
assert.match(sheet, /<row r="4" ht="32" customHeight="1">/);
assert.match(sheet, /<row r="13" ht="32" customHeight="1">/);
assert.match(styles, /<cellXfs count="29">/);
const threeEventsSheet = zipContents(createLectureWorkbook('봉담도서관', today, [
    { lectureKey: '1', date: '2026-09-28', name: '첫 수업', status: '접수마감' },
    { lectureKey: '2', date: '2026-09-28', name: '둘째 수업', status: '접수마감' },
    { lectureKey: '3', date: '2026-09-28', name: '셋째 수업', status: '접수마감' },
])).get('xl/worksheets/sheet1.xml');
for (const column of ['A', 'C', 'D', 'E', 'F', 'G']) {
    const middleStyle = ['E', 'F', 'G'].includes(column) ? 27 : 28;
    assert.match(threeEventsSheet, new RegExp(`<c r="${column}15" t="inlineStr" s="${middleStyle}">`));
}
assert.match(threeEventsSheet, /<c r="B15" t="inlineStr" s="20">/);
const emptyCalendar = zipContents(createLectureWorkbook('봉담도서관', new Date(Date.UTC(2026, 1, 1)), []));
assert.match(emptyCalendar.get('xl/worksheets/sheet1.xml'), /강좌 0개 · 수업 0회/);
assert.match(emptyCalendar.get('xl/worksheets/sheet1.xml'), /<dimension ref="A1:G\d+"/);
console.log('PASS lecture calendar and Excel export');
