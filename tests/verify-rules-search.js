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
const accuracyFirstResult = rankEntries('운영시간', 'all', 3);
if (!/제4조.*이용시간/.test(accuracyFirstResult.ranked[0]?.entry.title || '')) {
    failures.push('강좌 도서관 연동: 선택 도서관이 더 정확한 결과를 앞지름');
}
const preferredLibraryResult = rankEntries('반납 규정', 'all', 10);
const firstGuideResult = preferredLibraryResult.ranked.find(item => item.entry.sourceType === 'guide');
if (!/노을빛도서관.*이용안내/.test(firstGuideResult?.entry.title || '')) {
    failures.push('강좌 도서관 연동: 정확도 동률 결과에서 선택한 노을빛도서관 우선 노출 실패');
}
const explicitLibraryResult = rankEntries('태안도서관 운영시간', 'website', 3);
if (!/태안도서관.*이용안내/.test(explicitLibraryResult.ranked[0]?.entry.title || '')) {
    failures.push('강좌 도서관 연동: 질문에 명시한 태안도서관 우선 적용 실패');
}
delete window.localStorage;

const roomGuideEntries = window.LIBRARY_KNOWLEDGE.filter(entry =>
    entry.sourceType === 'guide' && /도서관이용안내/.test(entry.title) && /열람실/.test(entry.text));
roomGuideEntries.forEach(entry => {
    const libraryName = entry.keywords?.[0] || entry.title.split(' ')[0];
    const analysis = analyzeQuery(`${libraryName} 열람실 이용시간`);
    const facts = getGuideFacts(entry, analysis);
    const roomHours = facts.find(item => /열람실 이용시간/.test(item.label));
    if (!roomHours || !/\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2}/.test(roomHours.value)) {
        failures.push(`공간별 시간: ${libraryName} 열람실 이용시간 추출 실패`);
    }
    if (facts.some(item => item.label.includes('좌석') && /층$/.test(item.value))) {
        failures.push(`공간별 시간: ${libraryName} 층수를 좌석수로 잘못 추출`);
    }
});

const taeanRoomResult = rankEntries('태안도서관 열람실 이용시간 알려줘', 'all', 1);
const taeanRoomFacts = getGuideFacts(taeanRoomResult.ranked[0]?.entry || {}, taeanRoomResult.analysis);
if (!/태안도서관.*이용안내/.test(taeanRoomResult.ranked[0]?.entry.title || '')
    || !taeanRoomFacts.some(item => item.label === '열람실 이용시간' && item.value === '평일/주말 08:00~24:00')) {
    failures.push('공간별 시간: 태안도서관 열람실 빠른 답변 실패');
}

const roomTypoResult = rankEntries('태안도서관 열람싫 이용시간 알려줘', 'all', 1);
if (!roomTypoResult.analysis.corrections.some(item => item.from === '열람싫' && item.to === '열람실')
    || !/태안도서관.*이용안내/.test(roomTypoResult.ranked[0]?.entry.title || '')) {
    failures.push('공간별 시간: 열람실 오타 보정 실패');
}

const taeanSeatResult = rankEntries('태안도서관 열람실 좌석', 'all', 1);
const taeanSeatFacts = getGuideFacts(taeanSeatResult.ranked[0]?.entry || {}, taeanSeatResult.analysis);
if (!taeanSeatFacts.some(item => item.label === '열람실 좌석' && item.value === '85석')
    || taeanSeatFacts.some(item => item.value === '1층')) {
    failures.push('공간별 좌석: 태안도서관 층수 오인 방지 실패');
}

const commonProgramCases = [
    ['북스타트가 뭐예요', 'bookstart', /북스타트 대상/, '대상', /취학 전 영유아/],
    ['아기 책꾸러미 어디서 받아요', 'bookstart', /북스타트 대상/, '수령', /21개관 어린이자료실/],
    ['태안 북스타트 택배 신청', 'bookstart', /북스타트 1단계.*택배/, '2차 신청', /2026\. 8\. 31/],
    ['북스타트 프로그램은 언제 해요', 'bookstart', /북스타트 후속 프로그램/, '2026년 2기', /9~11월/],
    ['책 읽는 50+가 뭐예요', 'reading-50plus', /책 읽는 50\+ 대상/, '안내 기준', /2025년/],
    ['50플러스 책꾸러미 신청 서류', 'reading-50plus', /책 읽는 50\+ 대상/, '신청', /대출회원증.*등본.*추천글/],
    ['50+ 책꾸러미는 누가 받아요', 'reading-50plus', /책 읽는 50\+ 대상/, '대상', /50세 이상/],
    ['남양도서관 책 읽는 50+', 'reading-50plus', /책 읽는 50\+ 대상/, '대상', /50세 이상/],
];
commonProgramCases.forEach(([query, intent, titlePattern, factLabel, factPattern], index) => {
    const { analysis, ranked } = rankEntries(query, 'all', 3);
    const first = ranked[0]?.entry;
    if (!analysis.intents.some(item => item.id === intent)) {
        failures.push(`공통 독서사업 ${index + 1}: '${query}'에서 ${intent} 의도 누락`);
    }
    if (!first || !titlePattern.test(first.title)) {
        failures.push(`공통 독서사업 ${index + 1}: '${query}' 첫 결과 오류 (${first?.title || '없음'})`);
        return;
    }
    const fact = getGuideFacts(first, analysis).find(item => item.label === factLabel);
    if (!fact || !factPattern.test(fact.value)) {
        failures.push(`공통 독서사업 ${index + 1}: '${query}' 핵심 정보 정리 실패`);
    }
});

const gyeonggiDeliveryCases = [
    ['두루두루가 뭐예요', 'duruduru', /두루두루 대상/, '대상', /경기도 거주 등록장애인/],
    ['두루두루 신청 서류', 'duruduru', /두루두루 대상/, '확인서류', /장애인복지카드.*장애인 확인서/],
    ['두루두루 몇 권 며칠', 'duruduru', /두루두루 대상/, '이용', /월 5회.*최대 5권.*14일/],
    ['내 생애 첫 도서관 신청', 'first-library', /내 생애 첫 도서관 대상/, '대상', /임신부.*12개월 이하/],
    ['내첫도 서류', 'first-library', /내 생애 첫 도서관 대상/, '확인서류', /임신확인서.*산모수첩.*등본.*가족관계증명서/],
    ['임산부 책배달', 'first-library', /내 생애 첫 도서관 대상/, '이용', /월 2회.*최대 5권.*14일/],
    ['영유아 도서 택배 몇 권', 'first-library', /내 생애 첫 도서관 대상/, '신청', /경기도서관.*소속도서관.*온라인/],
];
gyeonggiDeliveryCases.forEach(([query, intent, titlePattern, factLabel, factPattern], index) => {
    const { analysis, ranked } = rankEntries(query, 'all', 3);
    const first = ranked[0]?.entry;
    if (!analysis.intents.some(item => item.id === intent)) {
        failures.push(`경기도 도서택배 ${index + 1}: '${query}'에서 ${intent} 의도 누락`);
    }
    if (!first || !titlePattern.test(first.title)) {
        failures.push(`경기도 도서택배 ${index + 1}: '${query}' 첫 결과 오류 (${first?.title || '없음'})`);
        return;
    }
    const fact = getGuideFacts(first, analysis).find(item => item.label === factLabel);
    if (!fact || !factPattern.test(fact.value)) {
        failures.push(`경기도 도서택배 ${index + 1}: '${query}' 핵심 정보 정리 실패`);
    }
});

const gyeonggiServiceEntries = window.LIBRARY_KNOWLEDGE.filter(entry =>
    ['guide-gyeonggi-duruduru', 'guide-gyeonggi-first-library'].includes(entry.id));
if (gyeonggiServiceEntries.length !== 2
    || gyeonggiServiceEntries.some(entry => entry.sourceType !== 'guide' || !/^https:\/\/www\.library\.kr\/ggl\/custom\//.test(entry.url))) {
    failures.push('경기도 도서택배: 공식 안내 링크 또는 홈페이지 출처 분류 오류');
}

const nationalServiceCases = [
    ['책바다가 뭐예요', 'book-sea', /책바다 대상/, '서비스', /전국 협약도서관.*소속도서관/],
    ['다른 지역 도서관 책 빌리기', 'book-sea', /책바다 대상/, '신청', /회원승인.*온라인.*48시간/],
    ['책바다 비용과 기간', 'book-sea', /책바다 대상/, '비용', /5,800원.*지원금/],
    ['책바다 몇 권 며칠', 'book-sea', /책바다 대상/, '이용', /3권.*14일.*7일 연장/],
    ['책이음 이용증 발급', 'book-link', /책이음 가입/, '대상', /모든 국민.*국내 거주 외국인/],
    ['회원증 하나로 전국 도서관', 'book-link', /책이음 가입/, '이용', /이용증 하나.*전국 참여도서관/],
    ['책이음 몇 권까지 빌려요', 'book-link', /책이음 가입/, '대출한도', /전체 최대 30권.*각 도서관 규정/],
    ['책나래 신청 대상', 'book-narae', /책나래 대상/, '대상', /등록장애인.*국가유공상이자.*장기요양대상자/],
    ['국가유공상이자 무료 책배달', 'book-narae', /책나래 대상/, '배송', /우체국 택배.*무료/],
    ['장기요양대상자 도서 택배', 'book-narae', /책나래 대상/, '권수·기간', /제공하는 도서관.*규정/],
];
nationalServiceCases.forEach(([query, intent, titlePattern, factLabel, factPattern], index) => {
    const { analysis, ranked } = rankEntries(query, 'all', 4);
    const first = ranked[0]?.entry;
    if (!analysis.intents.some(item => item.id === intent)) {
        failures.push(`국립도서관 연계 ${index + 1}: '${query}'에서 ${intent} 의도 누락`);
    }
    if (!first || !titlePattern.test(first.title)) {
        failures.push(`국립도서관 연계 ${index + 1}: '${query}' 첫 결과 오류 (${first?.title || '없음'})`);
        return;
    }
    const fact = getGuideFacts(first, analysis).find(item => item.label === factLabel);
    if (!fact || !factPattern.test(fact.value)) {
        failures.push(`국립도서관 연계 ${index + 1}: '${query}' 핵심 정보 정리 실패`);
    }
});

const disabilityDelivery = rankEntries('장애인 도서 택배', 'website', 4);
const disabilityIds = new Set(disabilityDelivery.ranked.map(item => item.entry.id));
if (!disabilityDelivery.analysis.intents.some(item => item.id === 'duruduru')
    || !disabilityDelivery.analysis.intents.some(item => item.id === 'book-narae')
    || !disabilityIds.has('guide-gyeonggi-duruduru') || !disabilityIds.has('guide-national-book-narae')) {
    failures.push('국립도서관 연계: 일반 장애인 도서택배 검색에서 두루두루·책나래 동시 안내 실패');
}
if (rankEntries('두루두루 장애인 도서택배', 'all', 3).ranked.some(item => item.entry.id === 'guide-national-book-narae')
    || rankEntries('책나래 장애인 도서택배', 'all', 3).ranked.some(item => item.entry.id === 'guide-gyeonggi-duruduru')) {
    failures.push('국립도서관 연계: 명시한 장애인 택배 서비스 단일 선택 실패');
}
const nationalServiceEntries = window.LIBRARY_KNOWLEDGE.filter(entry => String(entry.id || '').startsWith('guide-national-'));
if (nationalServiceEntries.length !== 3
    || nationalServiceEntries.some(entry => entry.sourceType !== 'guide'
        || !/^https:\/\/(?:books\.nl\.go\.kr|cn\.nld\.go\.kr)\//.test(entry.url))) {
    failures.push('국립도서관 연계: 공식 안내 링크 또는 홈페이지 출처 분류 오류');
}

const totalRegressionCases = 150 + synonymCases.length + 3 + roomGuideEntries.length + 3
    + commonProgramCases.length + gyeonggiDeliveryCases.length + 1 + nationalServiceCases.length + 3;
if (failures.length) {
    console.error(`FAIL ${totalRegressionCases - failures.length}/${totalRegressionCases}`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exitCode = 1;
} else {
    console.log(`PASS ${totalRegressionCases}/${totalRegressionCases}`);
}
