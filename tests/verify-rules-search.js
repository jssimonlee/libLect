'use strict';

global.window = {};
require('../rules-data.js');
const { analyzeQuery, rankEntries, makeAnswerExtract, cleanGuideText, getGuideFacts, getRegulationFacts, displayTitle } = require('../rules-search.js');
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

const phoneResult = rankEntries('\ub178\uc744\ube5b \uc804\ud654\ubc88\ud638', 'all', 1);
const phoneFacts = getGuideFacts(phoneResult.ranked[0]?.entry || {}, phoneResult.analysis);
if (!phoneFacts.some(item => item.label === '\uc804\ud654' && item.value === '031-226-3301')) {
    failures.push('\uad6c\uc870\ud654 \uac80\uc0c9: \ub178\uc744\ube5b\ub3c4\uc11c\uad00 \uc804\ud654\ubc88\ud638 \ucd94\ucd9c \uc2e4\ud328');
}

const busResult = rankEntries('\ub178\uc744\ube5b \ub3c4\uc11c\uad00 \ubc84\uc2a4 \uc815\ubcf4', 'all', 1);
const busFacts = getGuideFacts(busResult.ranked[0]?.entry || {}, busResult.analysis);
if (!busFacts.some(item => item.label === '\ubc84\uc2a4' && /81.*H65.*35-1/.test(item.value))) {
    failures.push('\uad6c\uc870\ud654 \uac80\uc0c9: \ub178\uc744\ube5b\ub3c4\uc11c\uad00 \ubc84\uc2a4 \ub178\uc120 \ucd94\ucd9c \uc2e4\ud328');
}

const hoursResult = rankEntries('\ub178\uc744\ube5b \ub3c4\uc11c\uad00 \uc6b4\uc601\uc2dc\uac04', 'all', 1);
const hoursFacts = getGuideFacts(hoursResult.ranked[0]?.entry || {}, hoursResult.analysis);
if (!hoursFacts.some(item => item.label === '\uc774\uc6a9\uc2dc\uac04' && /\ud3c9\uc77c 09:30~22:00/.test(item.value))) {
    failures.push('\uad6c\uc870\ud654 \uac80\uc0c9: \ub178\uc744\ube5b\ub3c4\uc11c\uad00 \uc6b4\uc601\uc2dc\uac04 \ucd94\ucd9c \uc2e4\ud328');
}

if (/\uad50\ud1b5\ud3b8\(\ubc84\uc2a4 \uc774\uc6a9 \uc2dc\)\s+\uad50\ud1b5\ud3b8\(\ubc84\uc2a4 \uc774\uc6a9 \uc2dc\)/.test(cleanGuideText(busResult.ranked[0]?.entry?.text))) {
    failures.push('\uad6c\uc870\ud654 \uac80\uc0c9: \uc5f0\uc18d\ub41c \uad50\ud1b5\ud3b8 \uba38\ub9ac\ub9d0 \uc81c\uac70 \uc2e4\ud328');
}

if (!/\uacac\ud559 \uc2e0\uccad/.test(displayTitle({ sourceType: 'guide', title: '\ub178\uc744\ube5b\ub3c4\uc11c\uad00 \ub3c4\uc11c\uad00\uacac\ud559\uc2e0\uccad' }))) {
    failures.push('\uad6c\uc870\ud654 \uac80\uc0c9: \uacb0\uacfc \uc81c\ubaa9 \uc815\ub9ac \uc2e4\ud328');
}

if (rankEntries('\ud68c\uc6d0\uac00\uc785', 'website', 1).ranked[0]?.entry.sourceType !== 'guide') {
    failures.push('\ucd9c\ucc98 \ubd84\ub958: \ub3c4\uc11c\uad00 \ud648\ud398\uc774\uc9c0 \ud544\ud130 \uc2e4\ud328');
}
if (rankEntries('\ub300\ucd9c \uae30\uac04', 'regulation', 1).ranked[0]?.entry.sourceType !== 'regulation') {
    failures.push('\ucd9c\ucc98 \ubd84\ub958: \uc6b4\uc601\uaddc\uc815 \ud544\ud130 \uc2e4\ud328');
}
if (rankEntries('\ub3c4\uc11c\uad00\ubc95', 'other', 1).ranked[0]?.entry.sourceType !== 'law') {
    failures.push('\ucd9c\ucc98 \ubd84\ub958: \uae30\ud0c0 \ud544\ud130 \uc2e4\ud328');
}

const returnResult = rankEntries('반납 규정', 'all', 1);
const returnFacts = getRegulationFacts(returnResult.ranked[0]?.entry || {}, returnResult.analysis);
if (!/제16조/.test(returnResult.ranked[0]?.entry.title || '') || returnFacts.length !== 4
    || !returnFacts.some(item => /모든 화성시 시립도서관/.test(item.value))) {
    failures.push('반납 규정: 제16조 핵심 항목 정리 실패');
}

const ambiguousCentral = analyzeQuery('중앙도서관 운영시간');
const ambiguousNames = new Set(ambiguousCentral.libraries.map(item => item.name));
if (!ambiguousCentral.ambiguousLibrary || ambiguousNames.size !== 2
    || !ambiguousNames.has('화성동탄중앙도서관') || !ambiguousNames.has('중앙이음터도서관')) {
    failures.push('도서관 식별: 중앙도서관 모호 별칭 처리 실패');
}

const centralRanked = rankEntries('중앙도서관 운영시간', 'website', 4).ranked;
if (!centralRanked.some(item => /화성동탄중앙도서관.*이용안내/.test(item.entry.title))
    || !centralRanked.some(item => /중앙이음터도서관.*이용안내/.test(item.entry.title))) {
    failures.push('도서관 식별: 중앙도서관 검색에서 두 이용안내 노출 실패');
}

if (analyzeQuery('화성동탄중앙도서관 운영시간').libraries.length !== 1
    || analyzeQuery('중앙이음터도서관 운영시간').libraries.length !== 1) {
    failures.push('도서관 식별: 정확한 중앙 도서관명 단일 선택 실패');
}

const synonymCases = [
    ['책 대여', ['loan'], [], /대출 권수|자료의대출/],
    ['자료 빌리기', ['loan'], [], /대출 권수|자료의대출/],
    ['관외대출은 몇 권이에요', ['loan', 'loan-count'], [], /대출 권수/],
    ['도서 반환은 어디에서 하나요', ['return'], [], /제16조.*반납/],
    ['책 돌려주기', ['return'], [], /제16조.*반납/],
    ['책을 가져다주려면', ['return'], [], /제16조.*반납/],
    ['타관반납 가능한가요', ['return'], [], /제16조.*반납/],
    ['대출 기한이 언제예요', ['loan-period'], [], /대출 권수/],
    ['반납예정일을 연기하고 싶어요', ['loan-period'], [], /대출 권수/],
    ['재대출 가능한가요', ['loan-period'], [], /대출 권수/],
    ['책을 더 빌리고 싶어요', ['loan', 'loan-period'], [], /대출 권수/],
    ['대출 기한을 넘겼어요', ['overdue'], [], /연체|제16조.*반납/],
    ['책 반납이 늦었어요', ['overdue'], [], /연체|제16조.*반납/],
    ['놀잇감 빌리기', ['toy'], ['loan'], /장난감도서관/],
    ['장난감 몇 점 빌려요', ['toy', 'loan-count'], ['loan'], /장난감도서관/],
    ['회의실 대여', ['rental'], ['loan', 'toy'], /제52조.*시설대관/],
    ['강당 사용 신청', ['rental'], ['loan'], /제52조.*시설대관|시설현황/],
    ['공간 대여 가능한가요', ['rental'], ['loan', 'toy'], /제52조.*시설대관/],
    ['복합기 사용 방법', ['print'], [], /이용안내|시설현황/],
    ['스캐너를 사용할 수 있나요', ['print'], [], /이용안내|시설현황/],
    ['원문 출력 가능한가요', ['print'], [], /원문|이용안내|시설현황/],
    ['도서관 카드를 잃어버렸어요', ['member'], ['lost'], /회원가입|제7조|이용안내/],
    ['도서관에서 개인 물건을 잃어버렸어요', ['found-item'], ['lost'], /습득물|분실물/],
    ['습득물은 어디에 맡겨요', ['found-item'], ['lost'], /습득물|분실물/],
    ['회원 등록에 필요한 서류', ['member'], [], /회원가입 대상|제7조/],
    ['대출증 재발급', ['member'], ['lost'], /회원가입|제7조|이용안내|대출 권수/],
    ['자료 구입 신청', ['request-book'], [], /희망도서/],
    ['신간 신청하고 싶어요', ['request-book'], [], /희망도서/],
    ['다른 도서관 책 빌리기', ['interlibrary'], [], /제22조.*상호대차/],
    ['기관 방문을 신청하려면', ['visit'], [], /견학/],
    ['봉사 시간 확인', ['volunteer'], [], /자원봉사/],
    ['책 기부 방법', ['donation'], [], /기증/],
    ['불용 처리 기준', ['discard'], [], /폐기|제적/],
    ['강의 접수 마감', ['class-guide'], [], /도서관 강좌 신청 방법/],
    ['특강 신청 방법', ['class-guide'], [], /도서관 강좌 신청 방법/],
    ['문 닫는 시간이 몇 시예요', ['hours'], ['closed'], /제4조.*이용시간|이용안내/],
    ['문 닫는 날이 언제예요', ['closed'], [], /정기 휴관일|이용안내/],
    ['도서관 소재지', ['address'], [], /찾아오시는길/],
    ['대표번호 알려줘', ['phone'], [], /찾아오시는길/],
    ['물품 보관함 신청', ['locker'], [], /사물함/],
];

synonymCases.forEach(([query, required, forbidden, titlePattern], index) => {
    const { analysis, ranked } = rankEntries(query, 'all', 3);
    const intentIds = new Set(analysis.intents.map(intent => intent.id));
    required.forEach(intent => {
        if (!intentIds.has(intent)) failures.push(`유사어 ${index + 1}: '${query}'에서 ${intent} 의도 누락`);
    });
    forbidden.forEach(intent => {
        if (intentIds.has(intent)) failures.push(`유사어 ${index + 1}: '${query}'에서 잘못된 ${intent} 의도 감지`);
    });
    if (!ranked[0]) failures.push(`유사어 ${index + 1}: '${query}' 검색 결과 없음`);
    else if (titlePattern && !titlePattern.test(ranked[0].entry.title)) {
        failures.push(`유사어 ${index + 1}: '${query}' 첫 결과가 '${ranked[0].entry.title}'`);
    }
});

window.localStorage = {
    getItem(key) {
        return key === 'selectedInstitution' ? '노을빛도서관' : null;
    },
};
const preferredLibraryResult = rankEntries('운영시간', 'website', 3);
if (!/노을빛도서관.*이용안내/.test(preferredLibraryResult.ranked[0]?.entry.title || '')) {
    failures.push('강좌 도서관 연동: 선택한 노을빛도서관 우선 노출 실패');
}
const explicitLibraryResult = rankEntries('태안도서관 운영시간', 'website', 3);
if (!/태안도서관.*이용안내/.test(explicitLibraryResult.ranked[0]?.entry.title || '')) {
    failures.push('강좌 도서관 연동: 질문에 명시한 태안도서관 우선 적용 실패');
}
delete window.localStorage;

const totalRegressionCases = 150 + synonymCases.length + 2;
if (failures.length) {
    console.error(`FAIL ${totalRegressionCases - failures.length}/${totalRegressionCases}`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exitCode = 1;
} else {
    console.log(`PASS ${totalRegressionCases}/${totalRegressionCases}`);
}
