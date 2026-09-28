const assert = require('node:assert/strict');

global.parseDateOnly = value => {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};
global.parseDayCodes = value => value ? String(value).split(',').map(day => day.trim()) : [];
global.getApiDayCode = date => date.getUTCDay() === 0 ? '7' : String(date.getUTCDay());

const {
    calendarDateKey, calendarOccursOn, calendarBounds, calendarOccurrencesInMonth,
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

const workbook = createLectureWorkbook('샘내작은도서관', [
    {
        date: '2026-09-28', beginTime: '10:00', endTime: '11:30',
        name: '책 & 글쓰기', target: '초등 / 1~2학년', place: '문화교실',
        status: '접수중', url: 'https://yeyak.hscity.go.kr/lectureDetail.do?lectureIdx=1',
    },
]);
const files = zipContents(workbook);
assert.ok(files.has('[Content_Types].xml'));
assert.ok(files.has('xl/workbook.xml'));
assert.ok(files.has('xl/worksheets/sheet1.xml'));
const sheet = files.get('xl/worksheets/sheet1.xml');
assert.match(sheet, /<dimension ref="A1:H2"/);
assert.match(sheet, /책 &amp; 글쓰기/);
assert.match(sheet, /<c r="A2" s="2"><v>46293<\/v><\/c>/);
assert.match(sheet, /<c r="B2" s="3"><v>0\.4166666666666667<\/v><\/c>/);
assert.match(sheet, /<hyperlink ref="H2" r:id="rId1"/);
assert.match(files.get('xl/worksheets/_rels/sheet1.xml.rels'), /lectureDetail\.do\?lectureIdx=1/);
console.log('PASS lecture calendar and Excel export');
