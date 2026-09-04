'use strict';

global.window = {};
require('../rules-data.js');
const { rankEntries, makeAnswerExtract } = require('../rules-search.js');
const questions = require('./rules-search-questions.js');
const generalQuestions = require('./rules-search-general-questions.js');

const primaryIntents = [
    'member','member','member','member','member','member','member','member','member',null,
    'loan-count','loan-period','loan-count','loan-period','loan-period','reservation','loan','loan-count','loan','loan',
    'return','return','return','overdue','overdue','overdue','lost','lost','lost','return',
    'hours','hours','hours','closed','closed','hours','hours','hours','closed','closed',
    'address','phone','address','parking','parking','parking','address','phone','address',null,
    'facility','facility','facility','print','print','locker','facility','facility',null,'rental',
    'reservation','reservation','reservation','interlibrary','interlibrary','interlibrary','request-book','request-book','request-book','request-book',
    'toy','toy','toy','toy','toy','toy','toy','makebooks','makebooks','music',
    'visit','visit','visit','volunteer','volunteer','class-guide',null,'cancel-class','course','course',
    'hours','lost','donation','discard','rental','course','hours','closed','makebooks','loan-period',
];

const unsupported = new Set([10, 50, 55, 59, 87]);
const titleChecks = new Map([
    [2, /회원가입 대상/], [5, /회원가입|제7조/], [11, /대출 권수/], [16, /대출 권수/],
    [22, /목동이음터.*시설현황/], [25, /연체/], [28, /변상/], [33, /화성동탄중앙.*이용안내/],
    [39, /도서관별 정기 휴관일/], [42, /남양.*찾아오시는길/], [47, /마도.*이용안내/],
    [58, /시설현황/], [60, /제52조.*시설대관/],
    [62, /제19조.*대출예약/], [63, /제19조.*대출예약/], [64, /제22조.*상호대차/],
    [67, /제21조.*희망도서/], [71, /남양.*장난감도서관/], [72, /남양.*장난감도서관/],
    [73, /남양.*장난감도서관/], [74, /장난감회원신청/], [78, /화성동탄중앙.*메이크북스/],
    [80, /목동이음터.*뮤직 라이브러리/], [88, /제31조.*폐강/], [91, /제4조.*이용시간/],
    [86, /도서관 강좌 신청 방법과 수강 유의사항/],
    [92, /변상/], [93, /기증자료처리기준/], [94, /폐기및제적기준/], [95, /제52조.*시설대관/],
    [96, /제33조.*강사료/], [97, /노을빛.*이용안내/], [98, /노을빛.*이용안내/],
    [99, /화성동탄중앙.*메이크북스/], [100, /남양.*이용안내/],
]);

const generalIntents = [
    'member','member','member','member','member','loan-count','loan-count','loan','loan-period','overdue',
    'return','delivery','reservation','reservation','request-book','request-book','lost','hours','closed','closed',
    'address','address','address','print',null,null,'facility','facility','parking','parking',
    'visit','visit','volunteer','volunteer','class-guide','class-guide','class-guide','class-guide','class-guide','class-guide',
    'class-guide','course','cancel-class','course','toy','toy','toy','donation','discard','rental',
];
const generalUnsupported = new Set([25, 26]);
const generalTitleChecks = new Map([
    [1, /회원가입 대상/], [2, /온라인 회원증/], [6, /대출 권수/], [8, /대출 권수/],
    [10, /연체/], [11, /제16조.*반납/], [12, /기관 책배달서비스/], [13, /제19조.*대출예약/],
    [14, /제19조.*대출예약/], [16, /희망도서신청불가/], [18, /제4조.*이용시간/],
    [19, /도서관별 정기 휴관일/], [21, /노을빛.*찾아오시는길/], [22, /화성동탄중앙.*찾아오시는길/],
    [23, /봉담.*찾아오시는길/], [29, /화성동탄중앙.*이용안내/], [35, /도서관 강좌 신청 방법/],
    [36, /도서관 강좌 신청 방법/], [37, /도서관 강좌 신청 방법/], [38, /도서관 강좌 신청 방법/],
    [39, /도서관 강좌 신청 방법/], [40, /도서관 강좌 신청 방법/], [41, /도서관 강좌 신청 방법/],
    [42, /제32조.*수강료/], [43, /제31조.*폐강/], [44, /제33조.*강사료/],
    [45, /장난감도서관/], [46, /장난감회원신청/], [48, /기증자료처리기준/],
    [49, /폐기|제적/], [50, /제52조.*시설대관/],
]);

if (questions.length !== 100 || primaryIntents.length !== 100 || generalQuestions.length !== 50 || generalIntents.length !== 50) {
    throw new Error(`Regression data mismatch: ${questions.length} questions, ${primaryIntents.length} expectations`);
}

const failures = [];
function verifyQuestions(items, intents, unsupportedNumbers, titlePatterns, offset = 0) {
items.forEach((query, index) => {
    const localNumber = index + 1;
    const number = offset + localNumber;
    const { analysis, ranked } = rankEntries(query, 'all', 5);
    const first = ranked[0]?.entry;
    if (unsupportedNumbers.has(localNumber)) {
        if (ranked.length || !analysis.unsupportedReason) failures.push(`${number}: unsupported question was not handled safely`);
        return;
    }
    if (!first) {
        failures.push(`${number}: no result`);
        return;
    }
    const expectedIntent = intents[index];
    if (expectedIntent && !analysis.intents.some(intent => intent.id === expectedIntent)) {
        failures.push(`${number}: expected intent ${expectedIntent}, got ${analysis.intents.map(intent => intent.id).join(',') || 'none'}`);
    }
    const titlePattern = titlePatterns.get(localNumber);
    if (titlePattern && !titlePattern.test(first.title)) failures.push(`${number}: unexpected first result '${first.title}'`);
    if (analysis.intents.length && !makeAnswerExtract(first, analysis, query).trim()) failures.push(`${number}: empty quick answer`);
});
}

verifyQuestions(questions, primaryIntents, unsupported, titleChecks);
verifyQuestions(generalQuestions, generalIntents, generalUnsupported, generalTitleChecks, 100);

if (failures.length) {
    console.error(`FAIL ${150 - failures.length}/150`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exitCode = 1;
} else {
    console.log('PASS 150/150');
}
