(function () {
    'use strict';

    const SOURCE_LABELS = {
        guide: '도서관 홈페이지',
        regulation: '운영규정',
        law: '기타',
    };

    // These are safe, context-independent expressions. Ambiguous words such as
    // "대여", "반환", "예약" are expanded later only after the object and
    // action in the question have been identified.
    const SYNONYM_GROUPS = [
        ['연체', '미반납', '반납지연', '기한초과', '장기연체', '대출정지', '이용정지'],
        ['대출', '빌리기', '빌려가기', '빌려', '빌릴', '관외대출', '도서대출'],
        ['반납', '돌려주기', '돌려줘', '책돌려주기'],
        ['무인반납함', '무인반납기', '무인도서대출반납기'],
        ['휴관', '휴관일', '휴관일자', '휴일', '공휴일', '법정공휴일', '대체공휴일', '대체휴일', '국경일', '빨간날',
            '쉬는날', '쉬는날짜', '문닫는날', '닫는날', '안여는날', '개관안하는날', '비개관일',
            '휴무', '휴무일', '정기휴무', '정기휴무일', '임시휴무', '정기휴관', '정기휴관일', '임시휴관', '임시휴관일'],
        ['이용시간', '운영시간', '여는시간', '닫는시간', '몇시', '개관시간', '폐관시간', '마감시간'],
        ['회원가입', '회원등록', '신규가입', '정회원가입'],
        ['회원증', '도서관카드', '대출증', '이용증', '모바일회원증', '온라인회원증'],
        ['분실', '잃어버림', '잃어버렸', '변상', '배상'],
        ['희망도서', '신청도서', '구입희망도서', '자료구입신청', '신간신청'],
        ['상호대차', '책두레', '타관대출', '도서관간대출'],
        ['문화강좌', '강좌', '강의', '수업', '문화교실', '프로그램', '특강'],
        ['폐강', '강좌취소', '수업취소'],
        ['강사', '강사료'],
        ['기증', '도서기증', '자료기증', '책기부', '기부'],
        ['폐기', '제적', '장서폐기', '불용처리'],
        ['대관', '시설대관', '공간대여', '시설사용', '공간사용', '사용허가'],
        ['사물함', '락커', '보관함', '물품보관함'],
        ['노트북', '전자기기', '태블릿', '컴퓨터', 'pc'],
        ['출력', '프린트', '프린터', '인쇄', '복사', '복합기', '스캔', '스캐너', '원문출력'],
        ['주차', '주차장', '주차비', '주차요금', '무료주차', '차량', '입차', '출차'],
        ['전화', '전화번호', '연락처', '문의번호', '대표번호', '내선번호'],
        ['주소', '위치', '소재지', '오시는길', '찾아가는길', '길찾기', '교통편'],
        ['견학', '도서관견학', '현장학습', '단체방문', '기관방문'],
        ['자원봉사', '봉사활동', '봉사신청', '봉사시간', '1365', '봉사확인서'],
        ['장난감도서관', '장난감대여', '놀잇감', '장난감'],
        ['북스타트', '북 스타트', '아기책꾸러미', '영유아책꾸러미', '그림책꾸러미'],
        ['책읽는50플러스', '책읽는 50플러스', '책 읽는 50플러스', '오십플러스', '신중년독서'],
        ['두루두루', '두루 두루', '장애인도서택배', '장애인책배달'],
        ['내생애첫도서관', '내 생애 첫 도서관', '내첫도', '생애첫도서관', '임신부도서택배', '임산부도서택배', '영유아도서택배'],
        ['책바다', '책 바다', '국가상호대차', '전국상호대차', '타지역도서관책', '다른지역도서관책'],
        ['책이음', '책 이음', '통합이용증', '통합회원증', '전국도서관회원증'],
        ['책나래', '책 나래', '장애인무료택배', '장애인우체국택배', '국가유공상이자', '장기요양대상자'],
        ['메이크북스', '메이크북', '메이커스페이스', '책만들기', '독립출판', '제본', '제작실'],
        ['원문db', '원문검색', '학술db', '논문검색', '국회전자도서관', '국립중앙도서관'],
    ];

    const CONTEXTUAL_SYNONYM_GROUPS = [
        { intents: ['loan'], terms: ['대출', '대여', '빌리기', '빌려가기', '빌려', '빌릴', '관외대출', '반출'] },
        { intents: ['return'], terms: ['반납', '반환', '돌려주기', '돌려줘', '가져다주기', '타관반납', '교차반납'] },
        { intents: ['loan-period'], terms: ['대출기간', '대출기한', '반납기한', '반납예정일', '이용기간', '대여기간', '며칠', '몇일'] },
        { intents: ['loan-period'], terms: ['연장', '기간연장', '대출연장', '반납일연기', '연기', '연기하고', '더빌리기', '재대출'] },
        { intents: ['reservation'], terms: ['도서예약', '대출예약', '예약도서', '예약걸기', '예약순번', '대기순번'] },
        { intents: ['rental'], terms: ['대관', '시설대관', '공간대여', '장소대여', '시설사용', '공간사용', '사용신청', '사용허가'] },
        { intents: ['found-item'], terms: ['분실물', '습득물', '유실물', '주운물건', '놓고간물건', '소지품분실'] },
    ];

    const INTENT_RULES = [
        { id: 'member', label: '회원가입·회원증', cues: ['회원가입', '회원등록', '신규가입', '정회원', '회원증', '도서관카드', '대출증', '이용증', '모바일회원증', '온라인회원증', '재발급', '외국인', '구비서류', '회원정보'], anchors: ['회원가입안내', '회원가입', '회원증 재발급', '온라인 회원증', '구비서류'] },
        { id: 'loan', label: '도서대출', cues: ['도서대출', '관외대출', '대출규정', '대출기간', '대출권수'], anchors: ['도서대출안내', '대출규정', '자료의대출', '대출 권수'] },
        { id: 'return', label: '반납', cues: ['반납', '무인반납함', '미반납', '타관반납', '교차반납'], anchors: ['자료의반납', '반납규정', '무인반납', '반납'] },
        { id: 'reservation', label: '도서예약', cues: ['도서예약', '대출예약', '예약자', '예약한책', '예약도서'], anchors: ['대출예약', '예약도서', '예약'] },
        { id: 'interlibrary', label: '상호대차', cues: ['상호대차', '책두레', '타관대출', '도서관간대출', '다른도서관책'], anchors: ['상호대차신청', '상호대차', '신청방법'] },
        { id: 'delivery', label: '책배달', cues: ['책배달', '기관책배달', '택배대출', '택배반납', '책나래', '묶음배송'], anchors: ['기관책배달서비스', '신청자격', '신청방법'] },
        { id: 'request-book', label: '희망도서', cues: ['희망도서', '신청도서', '구입희망도서', '자료구입신청', '신간신청'], anchors: ['희망도서신청', '신청불가자료', '희망도서'] },
        { id: 'hours', label: '운영시간', cues: ['몇시', '언제열', '언제닫', '운영시간', '이용시간', '개관시간', '폐관시간'], anchors: ['운영시간', '이용시간', '개관시간'] },
        { id: 'closed', label: '휴관일', cues: ['휴관', '휴관일자', '휴일', '쉬는날', '쉬는날짜', '문닫는날', '닫는날', '안여는날', '개관안하는날', '비개관일', '휴무', '휴무일', '쉬나요', '정기휴무', '임시휴무', '정기휴관', '임시휴관', '월요일', '일요일', '공휴일', '법정공휴일', '대체공휴일', '대체휴일', '국경일', '빨간날', '창립기념일', '장서점검'], anchors: ['정기휴관', '휴관일', '휴관안내'] },
        { id: 'phone', label: '전화·문의', cues: ['전화', '연락처', '문의번호', '대표번호', '내선번호', '문의하고', '연락하고'], anchors: ['전화번호', '문의전화', '문의', '연락처'] },
        { id: 'address', label: '주소·교통', cues: ['주소', '소재지', '위치', '오시는길', '찾아가는길', '길찾기', '교통편', '버스', '어느건물', '몇층'], anchors: ['주소', '교통편', '찾아오시는길'] },
        { id: 'parking', label: '주차', cues: ['주차', '차가져', '차량', '주차비'], anchors: ['주차요금', '주차', '주차장'] },
        { id: 'loan-count', label: '대출수량', cues: ['몇권', '몇점', '권수', '수량', '대출권수', '대여수량', '대여개수'], anchors: ['대출권수', '대여수량', '대여개수', '1인'] },
        { id: 'loan-period', label: '대출기간', cues: ['며칠', '몇일', '대출기간', '대출기한', '반납기한', '반납예정일', '이용기간', '대여기간', '언제반납', '연장', '재대출', '더빌리'], anchors: ['대출기간', '대여기간', '연장', '14일'] },
        { id: 'overdue', label: '연체', cues: ['연체', '늦게반납', '미반납', '반납지연', '기한초과', '장기연체', '대출정지', '이용정지'], anchors: ['연체규정', '연체', '대출정지'] },
        { id: 'lost', label: '분실·변상', cues: ['도서분실', '책분실', '잃어버린책', '훼손', '파손', '오손', '변상', '배상'], anchors: ['도서분실', '분실', '변상'] },
        { id: 'found-item', label: '분실물·습득물', cues: ['분실물', '습득물', '유실물', '주운물건', '놓고간물건', '소지품분실'], anchors: ['습득물처리', '습득물', '분실물'] },
        { id: 'fees', label: '요금', cues: ['얼마', '요금', '비용', '가격', '연회비', '사용료'], anchors: ['요금', '연회비', '사용료', '비용'] },
        { id: 'print', label: '복사·출력', cues: ['복사', '출력', '프린터', '프린트', '인쇄', '복합기', '스캔', '스캐너', '팩스', '원문출력'], anchors: ['복사기', '프린터', '출력', '스캔', '팩스', '복사'] },
        { id: 'facility', label: '시설', cues: ['시설', '공간', '좌석', '자리', '열람석', '수유실', '화장실', '노트북', '태블릿', '컴퓨터', '노트북실', '열람실', '자료실', '디지털자료실', '전자정보실'], anchors: ['시설현황', '주요시설', '좌석수', '실별'] },
        { id: 'locker', label: '사물함', cues: ['사물함', '락커', '보관함', '물품보관함'], anchors: ['사물함운영', '사물함'] },
        { id: 'rental', label: '시설대관', cues: ['대관', '시설대관', '공간대여', '장소대여', '시설사용', '공간사용', '사용허가', '개인모임'], anchors: ['시설대관', '사용허가', '대관'] },
        { id: 'class-guide', label: '강좌 신청 안내', cues: ['통합예약시스템', '본인아이디', '모집마감', '문자메시지', '당일불참', '신청불이익', '수업사진', '결과보고', '도서관홍보'], answerCues: ['신청', '아이디', '모집마감', '문자', '주차', '대중교통', '불참', '불이익', '사정', '변경', '바뀔', '사진', '홍보'], anchors: ['통합예약시스템', '수강생 본인 아이디', '모집마감', '주차장이 혼잡', '당일 불참', '세부 내용이 변경', '수업 진행 사진'] },
        { id: 'bookstart', label: '북스타트', cues: ['북스타트', '북 스타트', '아기책꾸러미', '영유아책꾸러미', '그림책꾸러미'], anchors: ['북스타트 대상', '북스타트 1단계', '북스타트 후속'] },
        { id: 'reading-50plus', label: '책 읽는 50+', cues: ['책읽는50+', '책읽는 50+', '책 읽는 50+', '책읽는50플러스', '책 읽는 50플러스', '오십플러스', '신중년독서'], anchors: ['책 읽는 50+', '50세 이상', '독서 챌린지'] },
        { id: 'duruduru', label: '두루두루', cues: ['두루두루', '두루 두루', '장애인도서택배', '장애인책배달'], anchors: ['두루두루 대상', '등록장애인', '월 5회'] },
        { id: 'first-library', label: '내 생애 첫 도서관', cues: ['내생애첫도서관', '내 생애 첫 도서관', '내첫도', '생애첫도서관', '임신부도서택배', '임산부도서택배', '영유아도서택배'], anchors: ['내 생애 첫 도서관 대상', '12개월 이하', '월 2회'] },
        { id: 'book-sea', label: '책바다', cues: ['책바다', '책 바다', '국가상호대차', '전국상호대차', '타지역도서관책', '다른지역도서관책'], anchors: ['책바다 대상', '전국 상호대차', '5,800원'] },
        { id: 'book-link', label: '책이음', cues: ['책이음', '책 이음', '책이음이용증', '통합이용증', '통합회원증', '전국도서관회원증'], anchors: ['책이음 가입', '통합이용증', '전체 대출한도'] },
        { id: 'book-narae', label: '책나래', cues: ['책나래', '책 나래', '장애인무료택배', '장애인우체국택배', '국가유공상이자', '상이유공자', '장기요양대상자'], anchors: ['책나래 대상', '국립장애인도서관', '우체국 택배'] },
        { id: 'accessibility', label: '장애인·이용약자 편의시설', cues: ['장애인서비스', '장애인이용', '장애인편의시설', '이용약자편의시설', '장애인화장실', '장애인용화장실', '장애인열람석', '시각장애인', '휠체어', '독서확대기', '음성지원pc', '보청기'], anchors: ['이용약자 편의시설 현황', '장애인용 화장실', '장애인 열람석'] },
        { id: 'course', label: '문화강좌', cues: ['문화강좌', '문화교실', '강의', '수업', '특강', '수강료', '참가비', '재료비', '강사료', '강사가', '강좌신청', '강좌취소'], anchors: ['강좌개설', '수강료', '강사료', '강사준칙', '문화교실'] },
        { id: 'donation', label: '기증자료', cues: ['기증', '기증도서', '자료기증', '책기부'], anchors: ['기증자료처리기준', '기증자료', '도서 기증'] },
        { id: 'discard', label: '폐기·제적', cues: ['제적', '폐기', '장서폐기', '불용처리', '오래된도서'], anchors: ['자료의폐기또는제적', '폐기및제적기준', '제적'] },
        { id: 'visit', label: '견학', cues: ['견학', '현장학습', '단체방문', '기관방문'], anchors: ['견학신청', '신청방법', '운영대상'] },
        { id: 'volunteer', label: '자원봉사', cues: ['자원봉사', '봉사활동', '봉사신청', '봉사시간', '봉사확인서', '1365', '봉사'], anchors: ['자원봉사', '봉사시간', '신청방법'] },
        { id: 'toy', label: '장난감도서관', cues: ['장난감도서관', '장난감대여', '장난감'], anchors: ['장난감도서관', '대여수량', '대여기간'] },
        { id: 'makebooks', label: '메이크북스', cues: ['메이크북스', '메이크북', '책만들기', '메이커스페이스'], anchors: ['메이크북스', '운영안내', '이용방법'] },
        { id: 'music', label: '뮤직 라이브러리', cues: ['뮤직라이브러리', '낙소스', '음악특화'], anchors: ['뮤직 라이브러리', '낙소스', '이용'] },
        { id: 'original-db', label: '원문DB', cues: ['원문db', '원문검색', '국회전자도서관', '국립중앙도서관'], anchors: ['원문DB', '이용장소', '이용방법'] },
        { id: 'cancel-class', label: '폐강', cues: ['폐강', '강좌취소', '수업취소'], anchors: ['폐강', '모집정원'] },
    ];

    const QUESTION_STOP_WORDS = new Set([
        '어떻게', '언제', '어디', '어디서', '무엇', '뭐가', '뭔가', '알려줘', '알려주세요',
        '가능한가요', '가능하나요', '있나요', '되나요', '하나요', '해야하나요',
        '다시', '관련', '대한', '경우', '기준이', '내용이',
        '몇개', '몇권', '몇시', '며칠', '몇일', '얼마', '까지', '싶어', '싶어요', '해요', '좀', '언제야',
    ]);

    const INTENT_TITLE_PATTERNS = {
        member: ['회원가입', '회원증', '가입절차'],
        loan: ['대출 권수', '자료의대출'],
        'loan-count': ['대출 권수', '대여수량', '대여개수'],
        'loan-period': ['대출 권수', '대여기간', '대출기간'],
        return: ['반납', '도서관이용안내'],
        reservation: ['대출예약'],
        interlibrary: ['상호대차'],
        delivery: ['기관 책배달서비스'],
        'request-book': ['희망도서'],
        hours: ['도서관이용안내', '이용시간'],
        closed: ['도서관별 정기 휴관일', '도서관이용안내', '개관및휴관'],
        phone: ['찾아오시는길'],
        address: ['찾아오시는길'],
        parking: ['도서관이용안내'],
        overdue: ['연체'],
        lost: ['변상', '도서 분실'],
        'found-item': ['습득물처리', '분실물'],
        print: ['도서관이용안내', '시설현황'],
        facility: ['시설현황'],
        locker: ['사물함운영'],
        rental: ['시설대관'],
        'class-guide': ['도서관 강좌 신청 방법'],
        bookstart: ['북스타트 대상', '북스타트 1단계', '북스타트 후속'],
        'reading-50plus': ['책 읽는 50+ 대상'],
        duruduru: ['두루두루 대상'],
        'first-library': ['내 생애 첫 도서관 대상'],
        'book-sea': ['책바다 대상'],
        'book-link': ['책이음 가입'],
        'book-narae': ['책나래 대상'],
        accessibility: ['시설현황'],
        course: ['강좌', '수강료', '강사료', '강사준칙'],
        donation: ['기증자료', '도서 기증'],
        discard: ['폐기', '제적'],
        visit: ['도서관견학'],
        volunteer: ['자원봉사'],
        toy: ['장난감도서관', '장난감회원'],
        makebooks: ['메이크북스'],
        music: ['뮤직 라이브러리'],
        'original-db': ['원문'],
        'cancel-class': ['폐강'],
    };

    const ANSWER_INTENT_PRIORITY = {
        'loan-count': 12,
        'loan-period': 12,
        overdue: 12,
        lost: 12,
        'found-item': 12,
        phone: 12,
        address: 12,
        parking: 12,
        print: 12,
        facility: 11,
        locker: 11,
        rental: 11,
        'class-guide': 13,
        bookstart: 13,
        'reading-50plus': 13,
        duruduru: 14,
        'first-library': 14,
        'book-sea': 15,
        'book-link': 15,
        'book-narae': 15,
        accessibility: 14,
        reservation: 11,
        interlibrary: 11,
        delivery: 11,
        'request-book': 11,
        donation: 11,
        discard: 11,
        'cancel-class': 11,
        hours: 10,
        closed: 10,
        visit: 10,
        volunteer: 10,
        makebooks: 10,
        music: 10,
        'original-db': 10,
        course: 9,
        member: 8,
        toy: 7,
        return: 6,
        loan: 5,
        fees: 2,
    };

    let currentSource = 'all';
    let currentQuery = '';
    let entries = [];
    let libraryCatalog = [];
    let correctionVocabulary = [];
    let correctionBuckets = new Map();
    const correctionCache = new Map();
    let searchableCorpus = '';

    function normalize(value) {
        return String(value || '')
            .normalize('NFC')
            .toLocaleLowerCase('ko-KR')
            .replace(/[^0-9a-z가-힣ㄱ-ㅎ]/g, '');
    }

    function getInitials(value) {
        const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
        return Array.from(String(value || '')).map(char => {
            const code = char.charCodeAt(0) - 0xac00;
            return code >= 0 && code <= 11171 ? initials[Math.floor(code / 588)] : char;
        }).join('');
    }

    function stripKoreanEnding(term) {
        let cleaned = normalize(term);
        const endings = ['알려주세요', '알려줘', '가능한가요', '가능하나요', '해야하나요', '인가요', '이에요', '예요', '하나요', '되나요', '나요', '어요', '아요', '에서', '으로', '에게', '부터', '까지', '은', '는', '이', '가', '을', '를', '의', '와', '과', '도', '만', '요'];
        const ending = endings.find(item => cleaned.length > normalize(item).length + 1 && cleaned.endsWith(normalize(item)));
        if (ending) cleaned = cleaned.slice(0, -normalize(ending).length);
        return cleaned;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function editDistance(left, right) {
        const a = Array.from(left);
        const b = Array.from(right);
        const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
        for (let column = 0; column <= b.length; column += 1) rows[0][column] = column;
        for (let row = 1; row <= a.length; row += 1) {
            for (let column = 1; column <= b.length; column += 1) {
                const cost = a[row - 1] === b[column - 1] ? 0 : 1;
                rows[row][column] = Math.min(
                    rows[row - 1][column] + 1,
                    rows[row][column - 1] + 1,
                    rows[row - 1][column - 1] + cost,
                );
                if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
                    rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
                }
            }
        }
        return rows[a.length][b.length];
    }

    function findCorrection(term) {
        if (!term || term.length < 3 || searchableCorpus.includes(term) || /^[ㄱ-ㅎ]+$/.test(term)) return '';
        const commonCorrections = {
            열람싫: '열람실',
        };
        if (commonCorrections[term]) return commonCorrections[term];
        if (correctionCache.has(term)) return correctionCache.get(term);
        let best = '';
        const distanceLimit = term.length >= 6 ? 2 : 1;
        let bestDistance = distanceLimit;
        const candidates = [];
        for (let length = Math.max(1, term.length - distanceLimit); length <= term.length + distanceLimit; length += 1) {
            candidates.push(...(correctionBuckets.get(`${term[0]}:${length}`) || []));
        }
        candidates.forEach(candidate => {
            if (Math.abs(candidate.length - term.length) > bestDistance || candidate[0] !== term[0]) return;
            const distance = editDistance(term, candidate);
            if (distance <= bestDistance && (!best || distance < bestDistance || candidate.length < best.length)) {
                best = candidate;
                bestDistance = distance;
            }
        });
        correctionCache.set(term, best);
        return best;
    }

    function libraryAliases(name) {
        const aliases = new Set([normalize(name)]);
        let stem = normalize(name)
            .replace(/^화성시립/, '')
            .replace(/^화성시/, '')
            .replace(/^화성/, '')
            .replace(/작은도서관$/, '')
            .replace(/어린이도서관$/, '')
            .replace(/도서관$/, '');
        if (stem && stem !== '중앙') aliases.add(stem);
        if (stem.endsWith('이음터') && stem.slice(0, -3) !== '중앙') aliases.add(stem.slice(0, -3));
        if (stem.endsWith('나래') && stem.length > 2) aliases.add(stem);
        if (name === '화성동탄중앙도서관') {
            aliases.add('동탄중앙');
            aliases.add('중앙도서관');
        }
        if (name === '중앙이음터도서관') {
            aliases.add('동탄중앙이음터');
            aliases.add('중앙도서관');
        }
        return [...aliases].filter(alias => alias.length >= 2);
    }

    function buildLibraryCatalog(sourceEntries) {
        const names = new Set();
        sourceEntries.forEach(entry => {
            const firstKeyword = Array.isArray(entry.keywords) ? String(entry.keywords[0] || '') : '';
            if (firstKeyword.endsWith('도서관') && String(entry.sourceTitle || '').includes('공식 홈페이지')) {
                names.add(firstKeyword);
            }
        });
        libraryCatalog = [...names].map(name => {
            const aliases = libraryAliases(name);
            return {
                name,
                normalizedName: normalize(name),
                aliases,
                initialAliases: [...new Set(aliases.map(getInitials).filter(Boolean))],
            };
        });
    }

    function getPreferredLibrary() {
        try {
            const selected = normalize(window.localStorage?.getItem('selectedInstitution'));
            if (!selected || selected === 'favorite') return null;
            return libraryCatalog
                .filter(library => library.normalizedName === selected
                    || library.aliases.some(alias => alias !== '중앙도서관'
                        && (selected.includes(alias) || alias.includes(selected))))
                .sort((left, right) => right.normalizedName.length - left.normalizedName.length)[0] || null;
        } catch (_) {
            return null;
        }
    }

    function isPreferredLibraryEntry(entry, analysis) {
        const preferred = analysis?.preferredLibrary;
        if (!preferred || entry.sourceType !== 'guide') return false;
        return entry._libraryIdentity.includes(preferred.normalizedName)
            || preferred.aliases.some(alias => alias !== '중앙도서관' && entry._libraryIdentity.includes(alias));
    }

    function analyzeQuery(query) {
        const normalizedQuery = normalize(query);
        const rawTerms = String(query || '').trim().split(/\s+/).map(stripKoreanEnding).filter(term => term.length >= 2);
        const corrections = rawTerms
            .filter(term => !QUESTION_STOP_WORDS.has(term))
            .map(term => ({ from: term, to: findCorrection(term) }))
            .filter(item => item.to && item.to !== item.from);
        const interpretedQuery = normalizedQuery + corrections.map(item => item.to).join('');
        const interpretedTerms = [...rawTerms, ...corrections.map(item => item.to)];
        const initialTerms = String(query || '')
            .trim()
            .split(/\s+/)
            .map(normalize)
            .filter(term => /^[ㄱ-ㅎ]{3,}$/.test(term));
        const ambiguousCentralLibrary = interpretedQuery.includes('중앙도서관')
            && !interpretedQuery.includes('화성동탄중앙')
            && !interpretedQuery.includes('동탄중앙도서관')
            && !interpretedQuery.includes('중앙이음터');
        let libraryMatches = libraryCatalog
            .map(library => {
                const textMatch = library.aliases
                    .filter(alias => alias.length <= 3
                        ? interpretedTerms.some(term => term.includes(alias))
                        : interpretedQuery.includes(alias))
                    .sort((a, b) => b.length - a.length)[0] || '';
                const initialMatch = initialTerms
                    .filter(term => library.initialAliases.some(alias => alias === term || alias.startsWith(term)))
                    .sort((a, b) => b.length - a.length)[0] || '';
                return { ...library, matchedAlias: textMatch || initialMatch, matchedByInitial: !textMatch && Boolean(initialMatch) };
            })
            .filter(library => library.matchedAlias)
            .sort((a, b) => b.matchedAlias.length - a.matchedAlias.length);
        if (!ambiguousCentralLibrary && libraryMatches.some(item => item.matchedAlias !== '중앙도서관')) {
            libraryMatches = libraryMatches.filter(item => item.matchedAlias !== '중앙도서관');
        }
        if (ambiguousCentralLibrary) {
            const centralNames = new Set(['화성동탄중앙도서관', '중앙이음터도서관']);
            libraryMatches = libraryMatches.filter(item => centralNames.has(item.name));
        }
        const library = libraryMatches[0] || null;
        const preferredLibrary = libraryMatches.length ? null : getPreferredLibrary();
        let intents = INTENT_RULES.filter(intent => intent.cues.some(cue => interpretedQuery.includes(normalize(cue))));
        const addIntent = id => {
            const intent = INTENT_RULES.find(item => item.id === id);
            if (intent && !intents.some(item => item.id === id)) intents.push(intent);
        };

        const objects = {
            book: /(책|도서(?!관)|자료|장서|인쇄자료|비도서|dvd|cd|전자책|이북|오디오북|잡지|신문|정기간행물|딸림자료|부록)/.test(interpretedQuery),
            toy: /(장난감|놀잇감|교구)/.test(interpretedQuery),
            facility: /(시설|공간|장소|회의실|강당|대강당|프로그램실)/.test(interpretedQuery),
            class: /(강좌|강의|수업|프로그램|문화교실|특강|행사|체험)/.test(interpretedQuery),
            memberCard: /(회원증|도서관카드|대출증|이용증|책이음카드|모바일회원증|온라인회원증)/.test(interpretedQuery),
            personalItem: /(분실물|습득물|유실물|소지품|주운물건|놓고간물건|개인물건)/.test(interpretedQuery),
        };
        const actions = {
            borrow: /(대출|대여|빌리|빌려|빌릴|반출)/.test(interpretedQuery),
            return: /(반납|반환|돌려주|가져다주|타관반납|교차반납)/.test(interpretedQuery),
            renew: /(연장|기간연장|반납일연기|연기|더빌리|재대출)/.test(interpretedQuery),
            overdue: /(연체|미반납|반납지연|기한(?:을)?(?:넘|초과)|늦게반납|반납(?:이)?늦|장기연체|대출정지|이용정지)/.test(interpretedQuery),
            lost: /(분실|잃어버|잃어버림)/.test(interpretedQuery),
            damaged: /(훼손|파손|오손|찢어|젖었|망가)/.test(interpretedQuery),
        };

        if (actions.borrow) {
            if (objects.toy) addIntent('toy');
            else if (objects.facility) addIntent('rental');
            else if (objects.book) addIntent('loan');
        }
        if (actions.return) {
            if (objects.toy) addIntent('toy');
            else if (objects.book) addIntent('return');
        }
        if (actions.renew) {
            if (objects.class) addIntent('course');
            else {
                addIntent('loan-period');
                if (objects.toy) addIntent('toy');
                else addIntent('loan');
            }
        }
        if (actions.overdue) {
            addIntent('overdue');
            if (objects.book) addIntent('loan');
        }
        if (actions.lost || actions.damaged) {
            if (objects.memberCard) addIntent('member');
            else if (objects.personalItem) addIntent('found-item');
            else addIntent('lost');
        }
        if (/(책바다|다른도서관책|도서관간대출)/.test(interpretedQuery)) addIntent('interlibrary');
        if (/(책나래|택배대출|택배반납|묶음배송)/.test(interpretedQuery)) addIntent('delivery');
        if (/북스타트|(?:아기|영유아|그림책).*책꾸러미/.test(interpretedQuery)) addIntent('bookstart');
        if (/책읽는50|50플러스|오십플러스|신중년독서/.test(interpretedQuery)
            || /50\s*\+/.test(String(query || ''))) addIntent('reading-50plus');
        if (/두루두루|장애인(?:도서|책)?(?:택배|배송|배달)/.test(interpretedQuery)) addIntent('duruduru');
        if (/내생애첫도서관|내첫도|생애첫도서관|(?:임신부|임산부|산모|영유아|12개월이하|돌전).*(?:도서|책).*(?:택배|배송|배달)/.test(interpretedQuery)) addIntent('first-library');
        if (/책바다|국가상호대차|전국상호대차|(?:타|다른)지역도서관책/.test(interpretedQuery)) addIntent('book-sea');
        if (/책이음|통합이용증|통합회원증|전국도서관회원증|회원증하나로전국/.test(interpretedQuery)) addIntent('book-link');
        if (/책나래|장애인(?:무료|우체국)?(?:도서|책)?(?:택배|배송|배달)|국립장애인도서관.*(?:택배|배송|배달)|국가유공상이자|상이유공자|장기요양대상자/.test(interpretedQuery)) addIntent('book-narae');
        if (/장애인.*(?:서비스|지원|혜택)|(?:서비스|지원|혜택).*장애인/.test(interpretedQuery)) {
            addIntent('duruduru');
            addIntent('book-narae');
            addIntent('accessibility');
        }
        if (/장애인(?:용)?(?:화장실|열람석|좌석|주차)|이용약자편의시설|시각장애인|휠체어|독서확대기|음성(?:지원|안내)pc|보청기/.test(interpretedQuery)) addIntent('accessibility');
        if (/두루두루/.test(interpretedQuery)) intents = intents.filter(intent => intent.id !== 'book-narae');
        if (/책나래/.test(interpretedQuery)) intents = intents.filter(intent => intent.id !== 'duruduru');
        if (objects.facility && /(예약|신청|빌리|대여|대관|사용허가)/.test(interpretedQuery)) addIntent('rental');
        if (objects.class && /(접수|등록|신청|모집|마감|선착순|추첨|대기자)/.test(interpretedQuery)) addIntent('class-guide');
        if (/(문닫|닫는|마감).*(시간|몇시)|(시간|몇시).*(문닫|닫는|마감)/.test(interpretedQuery)) addIntent('hours');
        if (/(회원|가입)/.test(interpretedQuery)) addIntent('member');
        if (/대출/.test(interpretedQuery)) addIntent('loan');
        if (/(책|도서|자료)/.test(interpretedQuery) && /(빌|대출)/.test(interpretedQuery)) addIntent('loan');
        if (/예약/.test(interpretedQuery) && /(책|도서|대출)/.test(interpretedQuery)) addIntent('reservation');
        if (/(운영|문을열|문을여)/.test(interpretedQuery) && /(요일|오늘|평일|주말|몇시)/.test(interpretedQuery)) addIntent('hours');
        if (/강좌/.test(interpretedQuery)) addIntent('course');
        if (/(강좌|프로그램)/.test(interpretedQuery) && /(신청|본인아이디|모집마감|문자|주차|대중교통|불참|사진|홍보|내용변경)/.test(interpretedQuery)) addIntent('class-guide');
        if (/강사/.test(interpretedQuery) && /(사정|변경|바뀔)/.test(interpretedQuery)) addIntent('class-guide');
        if (/(강좌|수강)/.test(interpretedQuery) && /(취소|인원.*적)/.test(interpretedQuery)) addIntent('cancel-class');
        if (/(강당|회의실|프로그램실|시설)/.test(interpretedQuery) && /(빌리|대관|신청)/.test(interpretedQuery)) addIntent('rental');
        if (intents.some(intent => intent.id === 'toy') && /몇개/.test(interpretedQuery)) addIntent('loan-count');
        if (intents.some(intent => intent.id === 'loan-count') && /(책|도서|권수)/.test(interpretedQuery)) addIntent('loan');
        if (intents.some(intent => intent.id === 'member') && /회원증/.test(interpretedQuery)) {
            intents = intents.filter(intent => intent.id !== 'lost');
        }
        if (objects.memberCard) intents = intents.filter(intent => intent.id !== 'lost');
        if (objects.personalItem) intents = intents.filter(intent => intent.id !== 'lost');
        if (objects.toy && actions.borrow) intents = intents.filter(intent => intent.id !== 'loan');
        if (objects.facility && actions.borrow) intents = intents.filter(intent => !['loan', 'toy'].includes(intent.id));
        if (intents.some(intent => intent.id === 'hours') && /(문닫|닫는|마감).*(시간|몇시)|(시간|몇시).*(문닫|닫는|마감)/.test(interpretedQuery)) {
            intents = intents.filter(intent => intent.id !== 'closed');
        }
        if (intents.some(intent => intent.id === 'member') && /회원정보/.test(interpretedQuery)) {
            intents = intents.filter(intent => !['phone', 'address'].includes(intent.id));
        }
        if (intents.some(intent => intent.id === 'discard')) {
            intents = intents.filter(intent => intent.id !== 'lost');
        }
        if (intents.some(intent => intent.id === 'rental')) {
            intents = intents.filter(intent => intent.id !== 'facility');
        }
        if (intents.some(intent => intent.id === 'hours') && /몇시/.test(interpretedQuery)) {
            intents = intents.filter(intent => intent.id !== 'facility');
        }
        const unsupportedReason = interpretedQuery.includes('가장가까운')
            ? '현재 위치를 사용하지 않으므로 가장 가까운 도서관은 자동으로 판단할 수 없습니다. 도서관명이나 지역명을 함께 입력해 주세요.'
            : interpretedQuery.includes('와이파이')
                ? '수집된 공식 이용안내에서 와이파이 이용 기준을 확인하지 못했습니다. 해당 도서관에 직접 확인해 주세요.'
                : /회원정보.*(변경|수정)/.test(interpretedQuery)
                    ? '수집된 공식 자료에서 회원정보 변경 절차를 확인하지 못했습니다. 홈페이지 내서재 또는 담당 도서관에 확인해 주세요.'
                    : /(강좌신청.*취소|강좌.*신청.*취소)/.test(interpretedQuery)
                        ? '강좌 신청과 취소는 상단의 강좌 찾기에서 해당 강좌 상세 안내를 확인해 주세요.'
                        : intents.some(intent => intent.id === 'print') && !library && /(요금|얼마|무료)/.test(interpretedQuery)
                            ? '복사·출력·스캔 요금은 도서관별로 다를 수 있습니다. 확인할 도서관명을 함께 입력해 주세요.'
                : '';
        return {
            normalizedQuery,
            interpretedQuery,
            library,
            libraries: libraryMatches,
            ambiguousLibrary: ambiguousCentralLibrary && libraryMatches.length > 1,
            preferredLibrary,
            intents,
            objects,
            actions,
            corrections,
            unsupportedReason,
        };
    }

    function getTermVariants(term, analysis) {
        const normalizedTerm = normalize(term);
        const group = SYNONYM_GROUPS.find(items => items.some(item => {
            const normalizedItem = normalize(item);
            return normalizedTerm === normalizedItem
                || (normalizedItem.length >= 2 && normalizedTerm.startsWith(normalizedItem));
        }));
        const variants = group ? group.map(normalize) : [normalizedTerm];
        const activeIntentIds = new Set((analysis?.intents || []).map(intent => intent.id));
        CONTEXTUAL_SYNONYM_GROUPS.forEach(contextGroup => {
            if (!contextGroup.intents.some(id => activeIntentIds.has(id))) return;
            if (!contextGroup.terms.some(item => {
                const normalizedItem = normalize(item);
                return normalizedTerm === normalizedItem
                    || (normalizedItem.length >= 2 && normalizedTerm.startsWith(normalizedItem));
            })) return;
            variants.push(...contextGroup.terms.map(normalize));
        });
        const correction = analysis?.corrections.find(item => item.from === normalizedTerm)?.to;
        if (correction) variants.push(correction);
        return [...new Set(variants)];
    }

    function getQueryTerms(query, analysis) {
        const terms = String(query || '')
            .trim()
            .split(/\s+/)
            .map(stripKoreanEnding)
            .filter(term => term.length >= 2 && !QUESTION_STOP_WORDS.has(term));
        analysis?.corrections.forEach(item => {
            const index = terms.indexOf(item.from);
            if (index >= 0) terms[index] = item.to;
        });
        const onlyLibraryNamed = analysis?.library && terms.length === 1
            && analysis.library.aliases.some(alias => alias.includes(terms[0]) || terms[0].includes(alias));
        if (!terms.length || onlyLibraryNamed) {
            analysis?.intents.forEach(intent => terms.push(normalize(intent.anchors[0])));
        }
        return [...new Set(terms)];
    }

    function prepareEntries() {
        const sourceEntries = Array.isArray(window.LIBRARY_KNOWLEDGE) ? window.LIBRARY_KNOWLEDGE : [];
        buildLibraryCatalog(sourceEntries);
        entries = sourceEntries.map(entry => {
            const fields = {
                title: normalize(entry.title),
                section: normalize(entry.section),
                keywords: normalize((entry.keywords || []).join(' ')),
                text: normalize(entry.text),
            };
            return {
                ...entry,
                _fields: fields,
                _searchText: Object.values(fields).join(''),
                _libraryIdentity: [fields.title, fields.section, fields.keywords, normalize(entry.sourceTitle)].join(''),
                _initialFields: {
                    title: getInitials(fields.title),
                    section: getInitials(fields.section),
                    keywords: getInitials(fields.keywords),
                    text: getInitials(fields.text),
                },
            };
        });
        searchableCorpus = entries.map(entry => entry._searchText).join('');
        const vocabulary = new Set();
        SYNONYM_GROUPS.flat().forEach(term => vocabulary.add(normalize(term)));
        CONTEXTUAL_SYNONYM_GROUPS.flatMap(group => group.terms).forEach(term => vocabulary.add(normalize(term)));
        INTENT_RULES.flatMap(intent => [...intent.cues, ...intent.anchors]).forEach(term => vocabulary.add(normalize(term)));
        libraryCatalog.forEach(library => library.aliases.forEach(alias => vocabulary.add(alias)));
        sourceEntries.forEach(entry => (entry.keywords || []).forEach(keyword => {
            const normalized = normalize(keyword);
            if (normalized.length >= 3 && normalized.length <= 20) vocabulary.add(normalized);
        }));
        correctionVocabulary = [...vocabulary];
        correctionBuckets = new Map();
        correctionVocabulary.forEach(candidate => {
            const key = `${candidate[0]}:${candidate.length}`;
            if (!correctionBuckets.has(key)) correctionBuckets.set(key, []);
            correctionBuckets.get(key).push(candidate);
        });
        correctionCache.clear();
    }

    function scoreEntry(entry, query, analysis) {
        const terms = getQueryTerms(query, analysis);
        if (!terms.length) return null;
        const focusedEntryIds = {
            bookstart: ['guide-bookstart-package', 'guide-bookstart-delivery', 'guide-bookstart-programs'],
            'reading-50plus': ['guide-reading-50plus'],
            duruduru: ['guide-gyeonggi-duruduru'],
            'first-library': ['guide-gyeonggi-first-library'],
            'book-sea': ['guide-national-book-sea'],
            'book-link': ['guide-national-book-link'],
            'book-narae': ['guide-national-book-narae'],
        };
        const allowedFocusedIds = [...new Set((analysis?.intents || [])
            .flatMap(intent => focusedEntryIds[intent.id] || []))];
        const hasAccessibilityIntent = analysis?.intents.some(intent => intent.id === 'accessibility');
        const isAccessibilityEntry = hasAccessibilityIntent
            && /(이용약자편의시설|장애인용?화장실|장애인열람석|시각장애인용?pc|독서확대기|음성(?:지원|안내)pc|보청기|휠체어)/.test(entry._searchText);
        if (allowedFocusedIds.length && !allowedFocusedIds.includes(entry.id) && !isAccessibilityEntry) return null;
        if (hasAccessibilityIntent && !allowedFocusedIds.includes(entry.id) && !isAccessibilityEntry) return null;

        // A quantity, period, or fee is an answer qualifier, not the subject of a
        // question. Do not accept a page merely because it contains a generic
        // word such as "1인" or "수량"; the actual subject must be present.
        const qualifierIntentIds = new Set(['loan-count', 'loan-period', 'fees']);
        const subjectIntents = (analysis?.intents || [])
            .filter(intent => !qualifierIntentIds.has(intent.id))
            .sort((left, right) => (ANSWER_INTENT_PRIORITY[right.id] || 0) - (ANSWER_INTENT_PRIORITY[left.id] || 0));
        let primaryIntent = subjectIntents[0];
        if (analysis?.intents.some(intent => intent.id === 'loan')
            && (analysis.actions?.renew || /(?:부모|가족|대신).*대출/.test(analysis.interpretedQuery))) {
            primaryIntent = analysis.intents.find(intent => intent.id === 'loan');
        }
        const evidencePositions = values => {
            const positions = [];
            [...new Set(values.map(normalize).filter(value => value.length >= 2))].forEach(value => {
                let at = entry._searchText.indexOf(value);
                while (at >= 0) {
                    positions.push(at);
                    at = entry._searchText.indexOf(value, at + Math.max(1, value.length));
                }
            });
            return positions;
        };
        if (primaryIntent && allowedFocusedIds.length <= 1 && !hasAccessibilityIntent) {
            const subjectPositions = evidencePositions(primaryIntent.cues);
            if (!subjectPositions.length) return null;
        }

        let score = 0;
        let matchedTerms = 0;
        const fullPhrase = normalize(query);

        terms.forEach(term => {
            const variants = getTermVariants(term, analysis);
            let best = 0;
            variants.forEach(variant => {
                if (!variant) return;
                if (/^[ㄱ-ㅎ]+$/.test(variant)) {
                    if (entry._initialFields.title.includes(variant)) best = Math.max(best, 15);
                    if (entry._initialFields.section.includes(variant)) best = Math.max(best, 11);
                    if (entry._initialFields.keywords.includes(variant)) best = Math.max(best, 9);
                    if (entry._initialFields.text.includes(variant)) best = Math.max(best, 3);
                    return;
                }
                if (entry._fields.title.includes(variant)) best = Math.max(best, 15);
                if (entry._fields.section.includes(variant)) best = Math.max(best, 11);
                if (entry._fields.keywords.includes(variant)) best = Math.max(best, 9);
                if (entry._fields.text.includes(variant)) best = Math.max(best, 4);
            });
            if (best > 0) {
                matchedTerms += 1;
                score += best;
            }
        });

        const hasIntentAnchor = analysis?.intents.some(intent =>
            [...(intent.answerCues || []), ...intent.anchors].some(anchor => entry._searchText.includes(normalize(anchor))));
        if (!matchedTerms && !hasIntentAnchor) return null;
        if (!matchedTerms) {
            matchedTerms = 1;
            score = 2;
        }
        if (fullPhrase && entry._searchText.includes(fullPhrase)) score += 25;
        score += matchedTerms * matchedTerms * 3;
        if (analysis?.libraries?.length) {
            const matchingLibrary = analysis.libraries.find(library =>
                entry._libraryIdentity.includes(library.normalizedName)
                || library.aliases.some(alias => alias !== '중앙도서관' && entry._libraryIdentity.includes(alias)));
            if (matchingLibrary && entry._libraryIdentity.includes(matchingLibrary.normalizedName)) score += 70;
            else if (matchingLibrary) score += 45;
            else if (analysis.libraries.some(library => entry._searchText.includes(library.normalizedName))) score += 8;
        }
        analysis?.intents.forEach(intent => {
            if (intent.anchors.some(anchor => entry._searchText.includes(normalize(anchor)))) score += 14;
            const preferredTitles = INTENT_TITLE_PATTERNS[intent.id] || [];
            if (preferredTitles.some(title => entry._fields.title.includes(normalize(title)))) score += 55;
            if (intent.anchors[0] && entry._fields.title.includes(normalize(intent.anchors[0]))) score += 30;
        });
        if (analysis?.intents.some(intent => intent.id === 'toy') && entry._searchText.includes('장난감')) score += 45;
        if (analysis?.intents.some(intent => intent.id === 'bookstart')) {
            const normalizedQuestion = normalize(query);
            if (/(택배|배송|배달)/.test(normalizedQuestion) && entry.id === 'guide-bookstart-delivery') score += 180;
            if (/(후속|프로그램|수업|책놀이|부모교육)/.test(normalizedQuestion) && entry.id === 'guide-bookstart-programs') score += 180;
        }
        if (analysis?.intents.some(intent => intent.id === 'found-item') && /습득물|분실물/.test(entry._fields.title)) score += 110;
        if (analysis?.objects?.memberCard && analysis?.actions?.lost && entry._searchText.includes('회원증재발급')) score += 100;
        if (analysis?.objects?.memberCard && /재발급/.test(analysis.interpretedQuery)
            && entry._searchText.includes('회원증재발급')) score += 160;
        if (analysis?.intents.some(intent => intent.id === 'overdue') && /연체|자료의반납및연체/.test(entry._fields.title)) score += 100;
        if (analysis?.library && !analysis.intents.some(intent => intent.id === 'toy')
            && analysis.intents.some(intent => ['loan-count', 'loan-period'].includes(intent.id))
            && entry.sourceType === 'guide' && entry._fields.title.includes('도서관이용안내')) score += 110;
        if (analysis?.intents.some(intent => intent.id === 'return') && /무인/.test(normalize(query)) && entry._searchText.includes('운영시간외')) score += 180;
        if (analysis?.intents.some(intent => intent.id === 'return') && analysis.libraries?.length > 1 && entry._fields.title.includes('자료의반납')) score += 220;
        if (analysis?.intents.some(intent => intent.id === 'loan') && /(부모|가족|대신)/.test(normalize(query)) && entry._searchText.includes('대출카드는본인만')) score += 100;
        if (analysis?.intents.some(intent => intent.id === 'closed') && !analysis.library && entry._fields.title.includes('도서관별정기휴관일')) score += 80;
        if (analysis?.intents.some(intent => intent.id === 'hours') && !analysis.library && entry._fields.title.includes('이용시간')) score += 100;
        if (analysis?.intents.some(intent => intent.id === 'hours')
            && analysis.library
            && /(열람실|노트북실|자료실|장난감도서관|뮤직스테이)/.test(analysis.interpretedQuery)
            && entry.sourceType === 'guide' && entry._fields.title.includes('도서관이용안내')) score += 120;
        if (analysis?.intents.some(intent => intent.id === 'course') && /강좌|수강료|강사료|강사준칙/.test(entry._fields.title)) score += 45;
        if (analysis?.intents.some(intent => intent.id === 'toy') && analysis.intents.some(intent => intent.id === 'member') && entry._fields.title.includes('장난감회원')) score += 70;
        if (analysis?.intents.some(intent => intent.id === 'cancel-class') && entry._fields.title.includes('폐강')) score += 70;
        if (analysis?.intents.some(intent => intent.id === 'discard') && /기준/.test(normalize(query)) && entry._fields.title.includes('폐기및제적기준')) score += 70;
        if (analysis?.intents.some(intent => intent.id === 'course') && /(무료|수강료)/.test(normalize(query)) && entry._fields.title.includes('수강료')) score += 100;
        if (analysis?.intents.some(intent => intent.id === 'reservation')) {
            const normalizedTitle = entry._fields.title;
            if (analysis.intents.some(intent => intent.id === 'loan-count') && normalizedTitle.includes('대출예약')) score += 180;
            if (analysis.intents.some(intent => intent.id === 'loan-period') && /찾아|수령|보관/.test(normalize(query)) && normalizedTitle.includes('대출예약')) score += 80;
            if (/연장/.test(normalize(query)) && entry._searchText.includes('예약도서연장불가')) score += 80;
            if (/연장/.test(normalize(query)) && normalizedTitle.includes('대출권수')) score += 100;
        }
        if (analysis?.intents.some(intent => intent.id === 'request-book')
            && analysis.intents.some(intent => intent.id === 'loan-count')
            && entry._fields.title.includes('희망도서')) score += 150;
        if (entry.sourceType === 'guide') score += analysis?.library ? 6 : 1;
        if (entry.sourceType === 'regulation' && /규정|조문|제\d+조/.test(query)) score += 12;

        return { score, matchedTerms, totalTerms: terms.length };
    }

    function findRawMatch(text, query, analysis, exact = false) {
        const terms = getQueryTerms(query, analysis);
        if (!terms.length) return null;

        const raw = String(text || '');
        let normalizedText = '';
        const indexMap = [];
        Array.from(raw).forEach((char, rawIndex) => {
            const normalizedChar = normalize(char);
            Array.from(normalizedChar).forEach(nextChar => {
                normalizedText += nextChar;
                indexMap.push(rawIndex);
            });
        });

        let best = null;
        terms.forEach(term => {
            const variants = exact ? [normalize(term)] : getTermVariants(term, analysis);
            variants.forEach(variant => {
                const at = normalizedText.indexOf(variant);
                if (at >= 0 && (!best || at < best.at)) {
                    best = { at, length: variant.length };
                }
            });
        });

        if (!best) return null;
        return {
            start: indexMap[best.at] || 0,
            end: (indexMap[best.at + best.length - 1] || indexMap[best.at] || 0) + 1,
        };
    }

    const GUIDE_NOISE_LINES = new Set([
        '목록', '다운로드', '신청조회', '신청하기', '더보기', '바로가기',
        '※ 좌우 화면이동으로 내용 확인이 가능합니다.',
    ].map(normalize));

    function cleanGuideLines(value) {
        const result = [];
        String(value || '').split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.replace(/\s+/g, ' ').trim();
            const normalizedLine = normalize(line);
            if (!line || GUIDE_NOISE_LINES.has(normalizedLine)) return;
            const previous = result[result.length - 1] || '';
            if (normalizedLine && normalize(previous) === normalizedLine) return;
            if (line === ':' && result.length) return;
            result.push(line.replace(/^:\s*/, ''));
        });
        return result;
    }

    function cleanGuideText(value) {
        return cleanGuideLines(value).join(' ')
            .replace(/(\uc774\uc6a9\uc2dc\uac04\uc548\ub0b4|\ud734\uad00\uc548\ub0b4|\ud68c\uc6d0\uac00\uc785\uc548\ub0b4|\uc8fc\ucc28\uc548\ub0b4)(?:\s+\1)+/g, '$1')
            .replace(/\uc2e0\uccad\uc2dc \uc720\uc758\uc0ac\ud56d\s+\uc2e0\uccad\uc2dc \uc8fc\uc758\uc0ac\ud56d/g, '\uc2e0\uccad \uc720\uc758\uc0ac\ud56d')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function findLabeledValue(lines, labels, validator = value => value.length >= 2) {
        const normalizedLabels = labels.map(normalize);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const normalizedLine = normalize(line);
            const labelIndex = normalizedLabels.findIndex(label => normalizedLine === label || normalizedLine.startsWith(label));
            if (labelIndex < 0) continue;
            const label = labels[labelIndex];
            const inline = line.replace(new RegExp(`^${escapeRegex(label)}\\s*:?\\s*`, 'i'), '').trim();
            if (validator(inline)) return inline;
            for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
                const candidate = lines[index + offset].replace(/^:\s*/, '').trim();
                if (validator(candidate)) return candidate;
            }
        }
        return '';
    }

    function extractBusRoutes(lines) {
        const start = lines.findIndex(line => /\uad50\ud1b5\ud3b8.*\ubc84\uc2a4|\ubc84\uc2a4.*\uc774\uc6a9/.test(normalize(line)));
        if (start < 0) return '';
        const routes = [];
        const routePattern = /^(?:[A-Z]\d{1,3}(?:-\d{1,2})?|\d{1,4}(?:-\d{1,2})?)(?:\s*,\s*(?:[A-Z]\d{1,3}(?:-\d{1,2})?|\d{1,4}(?:-\d{1,2})?))*$/i;
        lines.slice(start + 1, start + 80).some(line => {
            if (/\uc2b9\uc6a9\ucc28|\uc790\uac00\uc6a9|\uc8fc\ucc28/.test(normalize(line))) return true;
            const candidate = line.replace(/^(?:\uc77c\ubc18|\ub9c8\uc744|\uc9c1\ud589)\s*:\s*/, '').trim();
            if (!routePattern.test(candidate)) return false;
            candidate.split(/\s*,\s*/).forEach(route => {
                if (!routes.includes(route) && routes.length < 10) routes.push(route);
            });
            return false;
        });
        return routes.join(', ');
    }

    function extractHours(lines) {
        const flat = lines.join(' ');
        const matches = [...flat.matchAll(/(\ud3c9\uc77c(?:\s*[\/·]\s*|\s+)\uc8fc\ub9d0|\ud3c9\uc77c|\uc8fc\ub9d0|\ud1a0\s*~\s*\uc77c|\uc6d4\s*~\s*\uae08|\ud654\s*~\s*\uae08|\ud654\s*~\s*\ud1a0|\ud1a0)\s*:?\s*(\d{1,2}:\d{2}\s*[~\-–]\s*\d{1,2}:\d{2})/g)];
        matches.forEach(match => {
            if (/^평일\s*(?:[\/·]\s*|\s+)주말$/.test(match[1])) match[1] = '평일/주말';
        });
        return [...new Set(matches.map(match => `${match[1].replace(/\s/g, '')} ${match[2].replace(/\s/g, '')}`))].slice(0, 3).join(' · ');
    }

    const ROOM_DEFINITIONS = [
        { label: '노트북실', query: /노트북(?:열람)?실|노트북공간/, line: /노트북(?:열람)?실/ },
        { label: '장난감도서관', query: /장난감도서관|장난감실/, line: /장난감도서관/ },
        { label: '어린이자료실', query: /어린이자료실|아동자료실|유아어린이자료실/, line: /어린이자료실|아동자료실|유아어린이자료실/ },
        { label: '유아자료실', query: /유아자료실/, line: /유아자료실/ },
        { label: '전자정보자료실', query: /전자정보자료실|전자정보실|디지털자료실|미디어존/, line: /전자정보자료실|전자정보실|디지털자료실|미디어존/ },
        { label: '종합자료실', query: /종합자료실/, line: /종합자료실/ },
        { label: '일반자료실', query: /일반자료실/, line: /일반자료실/ },
        { label: '통합자료실', query: /통합자료실/, line: /통합자료실/ },
        { label: '열람실', query: /열람실|자율학습실/, line: /일반열람실|열람실|자율학습실/ },
        { label: '뮤직스테이', query: /뮤직스테이/, line: /뮤직스테이/ },
    ];

    function getRequestedRoom(analysis) {
        const query = analysis?.interpretedQuery || analysis?.normalizedQuery || '';
        return ROOM_DEFINITIONS.find(room => room.query.test(query)) || null;
    }

    function extractRoomHours(lines, room) {
        if (!room) return '';
        const sectionEnd = lines.findIndex(line => /휴관안내|회원가입안내/.test(normalize(line)));
        const end = sectionEnd >= 0 ? sectionEnd : lines.length;
        const matches = [];
        for (let index = 0; index < end; index += 1) {
            if (room.line.test(normalize(lines[index]))) matches.push(index);
        }
        for (const index of matches) {
            let nextRoom = end;
            for (let next = index + 1; next < end; next += 1) {
                const normalizedLine = normalize(lines[next]);
                if (!room.line.test(normalizedLine)
                    && ROOM_DEFINITIONS.some(definition => definition.line.test(normalizedLine))) {
                    nextRoom = next;
                    break;
                }
            }
            const segment = lines.slice(index + 1, nextRoom);
            let forward = extractHours(segment);
            const normalizedSegment = segment.map(normalize);
            const hasWeekdayAndWeekend = normalizedSegment.includes('평일') && normalizedSegment.includes('주말');
            if (forward && !forward.includes('·') && hasWeekdayAndWeekend) {
                forward = forward.replace(/^(?:평일|주말)\s+/, '평일/주말 ');
            }
            if (forward) return forward;
            const backward = extractHours(lines.slice(Math.max(0, index - 5), index));
            if (backward) return backward;
        }
        return '';
    }

    function extractRoomSeat(lines, room) {
        if (!room) return '';
        const sectionStart = lines.findIndex(line => normalize(line) === '실별안내');
        for (let index = Math.max(0, sectionStart + 1); index < lines.length; index += 1) {
            if (!room.line.test(normalize(lines[index]))) continue;
            for (let offset = 1; offset <= 12 && index + offset < lines.length; offset += 1) {
                const candidate = lines[index + offset].trim();
                if (/^\d[\d,]*(?:\.\d+)?석$/.test(candidate)) return candidate;
            }
        }
        return '';
    }

    function getGuideFacts(entry, analysis) {
        if (entry.sourceType !== 'guide') return [];
        if (entry.id === 'guide-bookstart-package') {
            return [
                { label: '대상', value: '화성시 거주 취학 전 영유아' },
                { label: '신청', value: '연중 · 소진 시까지 선착순' },
                { label: '구성', value: '단계별 그림책 2권 · 가방 · 가이드북 · 아이성장보드' },
                { label: '수령', value: '21개관 어린이자료실 · 아이 1명당 단계별 1회' },
            ];
        }
        if (entry.id === 'guide-bookstart-delivery') {
            return [
                { label: '대상', value: '1단계(0~18개월) 화성시 거주 영유아' },
                { label: '2차 신청', value: '2026. 8. 31. 10:00부터 소진 시까지' },
                { label: '서류', value: '발급 3개월 이내 주민등록등본 첨부' },
                { label: '발송', value: '월 1회 순차 발송' },
            ];
        }
        if (entry.id === 'guide-bookstart-programs') {
            return [
                { label: '내용', value: '영유아·보호자 책놀이·독서·육아 프로그램' },
                { label: '2026년 1기', value: '5~7월 · 11개관' },
                { label: '2026년 2기', value: '9~11월 · 10개관' },
                { label: '신청', value: '도서관별 문화행사·강좌 공지 확인' },
            ];
        }
        if (entry.id === 'guide-reading-50plus') {
            return [
                { label: '안내 기준', value: '공식 페이지의 2025년 사업 내용' },
                { label: '대상', value: '화성시 거주 50세 이상(1975. 12. 31. 이전 출생) · 기존 수령자 제외' },
                { label: '구성', value: '책 1권 · 추천목록/독서집게 · 접이식 가방' },
                { label: '신청', value: '대출회원증·3개월 이내 등본 지참 후 추천글 제출' },
            ];
        }
        if (entry.id === 'guide-gyeonggi-duruduru') {
            return [
                { label: '대상', value: '경기도 거주 등록장애인 · 거주 시·군 공공도서관 관외대출회원' },
                { label: '확인서류', value: '장애인복지카드 또는 장애인 확인서' },
                { label: '이용', value: '월 5회 · 동시에 최대 5권 · 도착 후 14일' },
                { label: '신청', value: '경기도서관에서 신청 → 소속도서관 확인·승인 → 온라인 도서신청' },
            ];
        }
        if (entry.id === 'guide-gyeonggi-first-library') {
            return [
                { label: '대상', value: '임신부(개월 수 제한 없음) 또는 12개월 이하 아이를 둔 경기도민 가족 1명' },
                { label: '확인서류', value: '임신확인서·산모수첩 또는 등본·가족관계증명서' },
                { label: '이용', value: '월 2회 · 동시에 최대 5권 · 도착 후 14일' },
                { label: '신청', value: '경기도서관에서 신청 → 소속도서관 확인·승인 → 온라인 도서신청' },
            ];
        }
        if (entry.id === 'guide-national-book-sea') {
            return [
                { label: '서비스', value: '가까운 도서관에 없는 전국 협약도서관 자료를 소속도서관에서 대출·반납' },
                { label: '이용', value: '최대 3권 · 도착일부터 14일 · 1회 7일 연장' },
                { label: '비용', value: '기본 5,800원 · 지역별 지원금에 따라 달라질 수 있음' },
                { label: '신청', value: '회원승인 → 온라인 자료신청 → 제공도서관 확정 → 48시간 내 결제' },
            ];
        }
        if (entry.id === 'guide-national-book-link') {
            return [
                { label: '대상', value: '모든 국민과 국내 거주 외국인' },
                { label: '이용', value: '책이음 이용증 하나로 전국 참여도서관 이용' },
                { label: '대출한도', value: '전체 최대 30권 · 도서관별 권수·기간은 각 도서관 규정 적용' },
                { label: '처음 방문', value: '안내데스크에 이용증 제시 → 회원정보 반입 후 이용' },
            ];
        }
        if (entry.id === 'guide-national-book-narae') {
            return [
                { label: '대상', value: '등록장애인 · 국가유공상이자 · 장기요양대상자' },
                { label: '배송', value: '우체국 택배로 무료 대출·반납' },
                { label: '권수·기간', value: '자료를 제공하는 도서관의 관외대출 규정 적용' },
                { label: '신청', value: '거주지역 도서관 가입 → 책나래 가입·나의 도서관 등록 → 승인 후 온라인 신청' },
            ];
        }
        const lines = cleanGuideLines(entry.text);
        const flat = lines.join(' ');
        const intentIds = new Set((analysis?.intents || []).map(intent => intent.id));
        if (intentIds.has('accessibility')) {
            const sectionIndex = lines.findIndex(line => normalize(line).includes('이용약자편의시설현황'));
            const sectionLines = sectionIndex >= 0 ? lines.slice(sectionIndex + 1) : lines;
            const rows = sectionLines.filter(line =>
                !/^(?:이용약자 편의시설 현황(?: 안내)?|시설명|위치|수량)$/.test(line));
            const seatStart = rows.findIndex(line => /장애인\s*열람석|시각장애인용\s*PC/i.test(line));
            const nursingStart = rows.findIndex(line => /수유실/.test(line));
            const toiletStart = rows.findIndex(line => /장애인용?\s*화장실/.test(line));
            const facts = [];
            const addAccessibilityFact = (label, values) => {
                const value = values.filter(item => item && item !== '-').join(' · ').replace(/\s+/g, ' ').trim();
                if (value) facts.push({ label, value });
            };
            if (seatStart >= 0) {
                const candidates = [nursingStart, toiletStart].filter(index => index > seatStart);
                const seatEnd = candidates.length ? Math.min(...candidates) : rows.length;
                addAccessibilityFact('열람석·보조기기', rows.slice(seatStart, seatEnd));
            }
            if (toiletStart >= 0) {
                addAccessibilityFact('장애인용 화장실', rows.slice(toiletStart + 1));
            }
            if (facts.length) {
                const asksToilet = /장애인(?:용)?\s*화장실/.test(analysis?.interpretedQuery || '');
                return asksToilet
                    ? facts.sort((left, right) => Number(right.label === '장애인용 화장실') - Number(left.label === '장애인용 화장실'))
                    : facts;
            }
        }
        const facts = [];
        const addFact = (label, value) => {
            const cleaned = String(value || '').replace(/\s+/g, ' ').trim().replace(/[\s,;·]+$/, '');
            if (cleaned && !facts.some(item => normalize(item.label) === normalize(label))) facts.push({ label, value: cleaned });
        };
        const phoneMatch = flat.match(/(?:\uc804\ud654\ubc88\ud638|\ubb38\uc758(?:\uc804\ud654)?)\s*:?\s*(0\d{1,2}-\d{3,4}-\d{4})/);
        const faxMatch = flat.match(/\ud329\uc2a4\ubc88\ud638\s*:?\s*(0\d{1,2}-\d{3,4}-\d{4})/);
        const address = findLabeledValue(lines, ['\uc8fc\uc18c'], value => /(?:\uacbd\uae30|\ud654\uc131\uc2dc|\ub85c\s|\uae38\s|\uc74d|\uba74|\ub3d9)/.test(value) && value.length >= 8);
        const hours = extractHours(lines) || findLabeledValue(lines, ['\uc774\uc6a9\uc2dc\uac04', '\uc6b4\uc601\uc2dc\uac04'], value => /\d{1,2}:\d{2}/.test(value));
        const closed = findLabeledValue(lines, ['\uc815\uae30\ud734\uad00', '\ud734\uad00\uc77c'], value => value.length >= 4 && !/^(?:\uad6c\ubd84|\ub0b4\uc6a9)$/.test(value));
        const buses = extractBusRoutes(lines);
        const requestedRoom = getRequestedRoom(analysis);
        const roomHours = extractRoomHours(lines, requestedRoom);

        if (intentIds.has('phone')) {
            addFact('\uc804\ud654', phoneMatch?.[1]);
            addFact('\ud329\uc2a4', faxMatch?.[1]);
            addFact('\uc8fc\uc18c', address);
        }
        if (intentIds.has('address')) {
            addFact('\uc8fc\uc18c', address);
            addFact('\ubc84\uc2a4', buses ? `${buses} \ubc88` : '');
            addFact('\uc804\ud654', phoneMatch?.[1]);
        }
        if (intentIds.has('hours')) {
            addFact(requestedRoom && roomHours ? requestedRoom.label + ' 이용시간' : '\uc774\uc6a9\uc2dc\uac04', roomHours || hours);
            addFact('\ud734\uad00', closed);
        }
        if (intentIds.has('closed')) {
            addFact('\ud734\uad00', closed);
            addFact('\uc774\uc6a9\uc2dc\uac04', hours);
        }
        if (intentIds.has('facility')) {
            addFact('\uc8fc\uc694\uc2dc\uc124', findLabeledValue(lines, ['\uc8fc\uc694\uc2dc\uc124'], value => value.length >= 3));
            addFact(requestedRoom ? requestedRoom.label + ' 좌석' : '\uc88c\uc11d', requestedRoom
                ? extractRoomSeat(lines, requestedRoom)
                : findLabeledValue(lines, ['\uc88c\uc11d\uc218'], value => /^\d[\d,]*(?:\.\d+)?석$/.test(value)));
        }
        if (intentIds.has('interlibrary')) addFact('\uc0c1\ud638\ub300\ucc28', findLabeledValue(lines, ['\uc0c1\ud638\ub300\ucc28'], value => value.length >= 3));
        return facts.slice(0, 4);
    }

    function getRegulationFacts(entry, analysis) {
        if (entry.sourceType !== 'regulation') return [];
        const intentIds = new Set((analysis?.intents || []).map(intent => intent.id));
        if (!intentIds.has('return') || !normalize(entry.title).includes('자료의반납및연체')) return [];
        return [
            { label: '일반자료 반납', value: '모든 화성시 시립도서관에서 가능' },
            { label: '책배달 자료', value: '대출한 해당 사립작은도서관에 반납' },
            { label: '연체', value: '연체일수만큼 관외대출 정지 (반납 다음 날부터 계산)' },
            { label: '90일 초과 연체', value: '반납일로부터 6개월간 관외대출 정지' },
        ];
    }

    function getResultFacts(entry, analysis) {
        return getGuideFacts(entry, analysis).concat(getRegulationFacts(entry, analysis)).slice(0, 4);
    }

    function renderFacts(facts, query) {
        if (!facts.length) return '';
        return `<dl class="rules-facts">${facts.map(fact => `
            <div><dt>${escapeHtml(fact.label)}</dt><dd>${highlight(fact.value, query)}</dd></div>`).join('')}</dl>`;
    }

    function displayTitle(entry) {
        if (entry.sourceType !== 'guide') return entry.title;
        return String(entry.title || '')
            .replace(/\ub3c4\uc11c\uad00\s+\ub3c4\uc11c\uad00(?=\uc774\uc6a9\uc548\ub0b4|\uacac\ud559\uc2e0\uccad|SNS)/g, '\ub3c4\uc11c\uad00 ')
            .replace(/\ub3c4\uc11c\uad00\s*\uacac\ud559\uc2e0\uccad/g, '\ub3c4\uc11c\uad00 \uacac\ud559 \uc2e0\uccad')
            .replace(/\ub3c4\uc11c\uad00\uc774\uc6a9\uc548\ub0b4/g, '\uc774\uc6a9\uc548\ub0b4')
            .replace(/\ub3c4\uc11c\uad00SNS/g, 'SNS')
            .replace(/\uc790\uc6d0\ubd09\uc0ac\uc2e0\uccad/g, '\uc790\uc6d0\ubd09\uc0ac \uc2e0\uccad');
    }

    function makeSnippet(entry, query, analysis) {
        const text = entry.sourceType === 'guide'
            ? cleanGuideText(entry.text)
            : String(entry.text || '').replace(/\n{3,}/g, '\n\n').trim();
        const maxLength = entry.sourceType === 'guide' ? 260 : 440;
        if (text.length <= maxLength) return text;
        const match = findRawMatch(text, query, analysis);
        const center = match ? match.start : 0;
        const start = Math.max(0, center - (entry.sourceType === 'guide' ? 30 : 110));
        const end = Math.min(text.length, Math.max(center + maxLength - 30, start + maxLength));
        return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
    }

    function highlight(text, query) {
        let html = escapeHtml(text);
        const rawTerms = String(query || '').trim().split(/\s+/).filter(term => term.length > 1);
        rawTerms.sort((a, b) => b.length - a.length).forEach(term => {
            const safeTerm = escapeRegex(escapeHtml(term));
            if (safeTerm) html = html.replace(new RegExp(`(${safeTerm})`, 'gi'), '<mark>$1</mark>');
        });
        return html;
    }

    function sourceLink(entry) {
        if (!entry.url) return '';
        if (entry.sourceType === 'regulation') {
            const page = Math.max(1, Number(entry.page) || 1);
            const viewerUrl = `regulation-viewer.html?page=${page}&title=${encodeURIComponent(entry.title || '운영규정')}`;
            return `<a href="${escapeHtml(viewerUrl)}" target="_blank" rel="noopener noreferrer">해당 쪽 보기 ↗</a>`;
        }
        const label = String(entry.id || '').startsWith('guide-gyeonggi-')
            ? '경기도서관 신청 안내'
            : String(entry.id || '').startsWith('guide-national-')
                ? '국립도서관 서비스 안내'
            : entry.sourceType === 'guide' ? '홈페이지 보기' : '원문 보기';
        return `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
    }

    function sourceCategory(entry) {
        if (entry.sourceType === 'guide') return 'website';
        if (entry.sourceType === 'regulation') return 'regulation';
        return 'other';
    }

    function updateSourceFilters(counts) {
        document.querySelectorAll('[data-rules-source]').forEach(button => {
            const source = button.dataset.rulesSource || 'all';
            const count = counts[source] || 0;
            const countNode = button.querySelector('[data-rules-count]');
            if (countNode) countNode.textContent = `(${count})`;
            const disabled = source !== 'all' && count === 0;
            button.disabled = disabled;
            button.setAttribute('aria-disabled', String(disabled));
        });
    }

    function renderCard(entry, query, analysis) {
        const location = [entry.section, entry.page ? `PDF ${entry.page}쪽` : ''].filter(Boolean).join(' · ');
        const version = entry.version ? `기준 ${entry.version}` : '';
        const snippet = makeSnippet(entry, query, analysis);
        const facts = getResultFacts(entry, analysis);
        return `
            <article class="rules-result-card">
                <div class="rules-card-topline">
                    <span class="rules-source-badge ${escapeHtml(entry.sourceType)}">${escapeHtml(SOURCE_LABELS[entry.sourceType] || '자료')}</span>
                    <span class="rules-card-location">${escapeHtml(location)}</span>
                </div>
                <h2>${highlight(displayTitle(entry), query)}</h2>
                ${renderFacts(facts, query)}
                ${facts.length ? '' : `<p>${highlight(snippet, query)}</p>`}
                <div class="rules-card-footer">
                    <span class="rules-card-meta">${escapeHtml(entry.sourceTitle || '')}${version ? ` · ${escapeHtml(version)}` : ''}</span>
                    <span class="rules-card-actions">${sourceLink(entry)}</span>
                </div>
            </article>`;
    }

    function makeAnswerExtract(entry, analysis, query) {
        const text = entry.sourceType === 'guide'
            ? cleanGuideText(entry.text)
            : String(entry.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        let focus = null;
        const normalizedQuery = normalize(query);
        const orderedIntents = [...analysis.intents].sort((left, right) =>
            (ANSWER_INTENT_PRIORITY[right.id] || 0) - (ANSWER_INTENT_PRIORITY[left.id] || 0));
        for (const intent of orderedIntents) {
            const matchedCues = (intent.answerCues || intent.cues).filter(cue => normalizedQuery.includes(normalize(cue)));
            const cueMatches = matchedCues
                .map(anchor => findRawMatch(text, anchor, null, true))
                .filter(Boolean)
                .sort((left, right) => left.start - right.start);
            if (cueMatches.length) {
                focus = cueMatches[0];
                break;
            }
            const anchorMatches = intent.anchors
                .map(anchor => findRawMatch(text, anchor, null, true))
                .filter(Boolean)
                .sort((left, right) => left.start - right.start);
            if (anchorMatches.length) {
                focus = anchorMatches[0];
                break;
            }
        }
        if (!focus) {
            const matches = getQueryTerms(query, analysis)
                .map(term => findRawMatch(text, term, null, true))
                .filter(Boolean)
                .sort((left, right) => left.start - right.start);
            focus = matches[0] || null;
        }
        const center = focus ? focus.start : 0;
        let start = Math.max(0, center - 35);
        const previousStop = Math.max(text.lastIndexOf('.', start), text.lastIndexOf('。', start));
        if (previousStop >= Math.max(0, start - 90)) start = previousStop + 1;
        let end = Math.min(text.length, start + 360);
        const intentIds = new Set(analysis.intents.map(intent => intent.id));
        const stopMarkers = [];
        if (intentIds.has('hours')) stopMarkers.push('휴관안내', '회원가입안내');
        if (intentIds.has('closed')) stopMarkers.push('회원가입안내', '도서대출안내');
        if (intentIds.has('loan-count') || intentIds.has('loan-period')) stopMarkers.push('반납규정', '연체규정', '문의전화');
        if (intentIds.has('address') && !intentIds.has('parking')) stopMarkers.push('주차안내');
        const markerPositions = stopMarkers
            .map(marker => text.indexOf(marker, start + 20))
            .filter(index => index > start + 35);
        if (markerPositions.length) end = Math.min(end, Math.min(...markerPositions));
        const punctuationStart = focus ? focus.end : Math.max(start, end - 70);
        const nextStops = [text.indexOf('.', punctuationStart), text.indexOf('。', punctuationStart)].filter(index => index >= punctuationStart + 50);
        if (nextStops.length) end = Math.min(end, Math.min(...nextStops) + 1);
        return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
    }

    function renderQuickAnswer(item, analysis, query) {
        if (!item || !analysis.intents.length || item.entry.sourceType === 'law' || analysis.ambiguousLibrary) return '';
        const interpretation = [
            analysis.library?.name,
            ...analysis.intents.map(intent => intent.label),
        ].filter(Boolean);
        const correctionText = analysis.corrections.length
            ? `<div class="rules-query-correction">검색어 보정: ${analysis.corrections.map(item => `${escapeHtml(item.from)} → ${escapeHtml(item.to)}`).join(', ')}</div>`
            : '';
        const version = item.entry.version ? ` · 기준 ${escapeHtml(item.entry.version)}` : '';
        const facts = getResultFacts(item.entry, analysis);
        return `
            <section class="rules-quick-answer" aria-label="빠른 답변">
                <div class="rules-answer-heading">
                    <span>빠른 답변</span>
                    <small>공식 문서에서 관련 부분을 발췌했습니다</small>
                </div>
                ${interpretation.length ? `<div class="rules-interpretation">${interpretation.map(label => `<span>${escapeHtml(label)}</span>`).join('')}</div>` : ''}
                ${correctionText}
                ${facts.length ? renderFacts(facts, query) : `<p>${highlight(makeAnswerExtract(item.entry, analysis, query), query)}</p>`}
                <div class="rules-answer-source">
                    <span>${escapeHtml(item.entry.sourceTitle || '')}${version}</span>
                    ${sourceLink(item.entry)}
                </div>
            </section>`;
    }

    function renderRegulationNotice() {
        return `
            <aside class="rules-notice" role="note">
                <strong>자료 적용 시 유의사항</strong>
                <span>위 검색 결과에 포함된 운영규정 PDF는 2022. 4. 1. 기준입니다. 현재 홈페이지 안내와 다른 경우 최신 공문 및 담당 부서 확인이 필요합니다.</span>
            </aside>`;
    }

    function renderSearchSuggestions(analysis) {
        const prefix = analysis.library?.name || '';
        const intentSuggestions = analysis.intents.map(intent => `${prefix} ${intent.label}`.trim());
        const defaults = prefix
            ? [`${prefix} 운영시간`, `${prefix} 시설`, `${prefix} 전화번호`]
            : ['도서관 운영시간', '대출 연체', '시설 주차'];
        const suggestions = [...new Set([...intentSuggestions, ...defaults])].slice(0, 3);
        return `<div class="rules-suggestions">${suggestions.map(value => `<button type="button" data-rules-suggestion="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('')}</div>`;
    }

    function rankEntries(query, source = 'all', limit = 15) {
        const analysis = analyzeQuery(query);
        if (analysis.unsupportedReason) return { analysis, ranked: [] };
        const ranked = entries
            .filter(entry => source === 'all' || sourceCategory(entry) === source)
            .filter(entry => {
                if (!analysis.libraries?.length || entry.sourceType !== 'guide') return true;
                if (analysis.libraries.some(library => entry._libraryIdentity.includes(library.normalizedName))) return true;
                if (analysis.libraries.some(library => library.aliases.some(alias =>
                    alias !== '중앙도서관' && entry._libraryIdentity.includes(alias)))) return true;
                const belongsToAnotherLibrary = libraryCatalog.some(library =>
                    !analysis.libraries.some(selected => selected.normalizedName === library.normalizedName)
                    && entry._libraryIdentity.includes(library.normalizedName));
                return !belongsToAnotherLibrary;
            })
            .map(entry => ({ entry, match: scoreEntry(entry, query, analysis) }))
            .filter(item => item.match)
            .sort((a, b) => {
                if (b.match.score !== a.match.score) return b.match.score - a.match.score;
                if (b.match.matchedTerms !== a.match.matchedTerms) return b.match.matchedTerms - a.match.matchedTerms;
                const preferredA = isPreferredLibraryEntry(a.entry, analysis);
                const preferredB = isPreferredLibraryEntry(b.entry, analysis);
                if (preferredA !== preferredB) return preferredA ? -1 : 1;
                return 0;
            });
        const confidenceFloor = ranked.length ? ranked[0].match.score * 0.4 : 0;
        return {
            analysis,
            ranked: ranked.filter((item, index) => index === 0 || item.match.score >= confidenceFloor).slice(0, limit),
        };
    }

    function searchRules(query) {
        currentQuery = String(query || '').trim();
        const resultsNode = document.getElementById('rulesSearchResults');
        const summaryNode = document.getElementById('rulesResultSummary');
        if (!resultsNode || !summaryNode) return;

        if (!currentQuery) {
            updateSourceFilters({ all: 0, website: 0, regulation: 0, other: 0 });
            summaryNode.textContent = '주제를 선택하거나 검색어를 입력해 보세요.';
            resultsNode.innerHTML = `
                <div class="rules-welcome">
                    <div class="rules-welcome-icon" aria-hidden="true">🔎</div>
                    <strong>업무 중 필요한 내용을 바로 찾아보세요</strong>
                    자연스러운 문장이나 핵심 단어 여러 개를 입력할 수 있습니다.
                </div>`;
            return;
        }

        const allResult = rankEntries(currentQuery, 'all', entries.length);
        const analysis = allResult.analysis;
        let meaningfulRanked = allResult.ranked;
        if (analysis.library && analysis.intents.length && meaningfulRanked.length > 1) {
            const minimumScore = meaningfulRanked[0].match.score * 0.74;
            meaningfulRanked = meaningfulRanked.filter((item, index) => index === 0 || item.match.score >= minimumScore);
        }
        const counts = meaningfulRanked.reduce((result, item) => {
            const category = sourceCategory(item.entry);
            result[category] += 1;
            result.all += 1;
            return result;
        }, { all: 0, website: 0, regulation: 0, other: 0 });
        updateSourceFilters(counts);
        if (currentSource !== 'all' && counts[currentSource] === 0) currentSource = 'all';
        document.querySelectorAll('[data-rules-source]').forEach(button => {
            button.classList.toggle('active', button.dataset.rulesSource === currentSource);
        });
        const ranked = meaningfulRanked
            .filter(item => currentSource === 'all' || sourceCategory(item.entry) === currentSource)
            .slice(0, 10);

        const selectedCount = currentSource === 'all' ? counts.all : counts[currentSource];
        summaryNode.textContent = selectedCount > ranked.length
            ? `“${currentQuery}” 검색 결과 ${selectedCount}건 · 관련도 높은 ${ranked.length}건 표시`
            : `“${currentQuery}” 검색 결과 ${selectedCount}건`;
        if (!ranked.length) {
            resultsNode.innerHTML = `
                <div class="rules-empty">
                    <strong>${analysis.unsupportedReason ? '자동으로 확인할 수 없는 질문입니다' : '일치하는 내용을 찾지 못했습니다'}</strong>
                    ${escapeHtml(analysis.unsupportedReason || '검색어를 짧게 줄이거나 아래 추천 검색어를 선택해 보세요.')}
                    ${renderSearchSuggestions(analysis)}
                </div>`;
            return;
        }
        const quickAnswer = renderQuickAnswer(ranked[0], analysis, currentQuery);
        const cardItems = quickAnswer ? ranked.slice(1) : ranked;
        const cards = cardItems.map(item => renderCard(item.entry, currentQuery, analysis)).join('');
        const hasRegulationResult = ranked.some(item => item.entry.sourceType === 'regulation');
        resultsNode.innerHTML = quickAnswer + cards + (hasRegulationResult ? renderRegulationNotice() : '');
    }

    function switchMode(mode, updateHash) {
        const isRules = mode === 'rules';
        const lectureHero = document.querySelector('.hero-combined-container');
        const lectureContent = document.querySelector('.main-content');
        const rulesPanel = document.getElementById('rulesModePanel');
        const lectureTab = document.getElementById('lectureModeTab');
        const rulesTab = document.getElementById('rulesModeTab');

        [lectureHero, lectureContent].forEach(node => node && node.classList.toggle('app-mode-hidden', isRules));
        if (rulesPanel) {
            rulesPanel.classList.toggle('app-mode-hidden', !isRules);
            rulesPanel.setAttribute('aria-hidden', String(!isRules));
        }
        if (lectureTab) {
            lectureTab.classList.toggle('active', !isRules);
            lectureTab.setAttribute('aria-selected', String(!isRules));
        }
        if (rulesTab) {
            rulesTab.classList.toggle('active', isRules);
            rulesTab.setAttribute('aria-selected', String(isRules));
        }

        if (updateHash) {
            history.replaceState(null, '', isRules ? '#rules' : '#lectures');
        }
        document.title = isRules ? '화성시립도서관 규정·이용안내 검색' : '화성시 도서관 강좌 검색';
        if (isRules) {
            window.setTimeout(() => document.getElementById('rulesSearchInput')?.focus(), 0);
        }
    }

    function initialize() {
        prepareEntries();

        document.querySelectorAll('[data-app-mode]').forEach(button => {
            button.addEventListener('click', () => switchMode(button.dataset.appMode, true));
        });

        document.getElementById('rulesSearchForm')?.addEventListener('submit', event => {
            event.preventDefault();
            searchRules(document.getElementById('rulesSearchInput')?.value || '');
        });

        document.querySelectorAll('[data-rules-query]').forEach(button => {
            button.addEventListener('click', () => {
                const input = document.getElementById('rulesSearchInput');
                if (input) input.value = button.dataset.rulesQuery || '';
                searchRules(button.dataset.rulesQuery || '');
            });
        });

        document.querySelectorAll('[data-rules-source]').forEach(button => {
            button.addEventListener('click', () => {
                currentSource = button.dataset.rulesSource || 'all';
                document.querySelectorAll('[data-rules-source]').forEach(item => item.classList.toggle('active', item === button));
                searchRules(currentQuery);
            });
        });

        document.getElementById('rulesSearchResults')?.addEventListener('click', event => {
            const button = event.target.closest('[data-rules-suggestion]');
            if (!button) return;
            const value = button.dataset.rulesSuggestion || '';
            const input = document.getElementById('rulesSearchInput');
            if (input) input.value = value;
            searchRules(value);
        });

        window.addEventListener('hashchange', () => switchMode(location.hash === '#rules' ? 'rules' : 'lectures', false));
        switchMode(location.hash === '#rules' ? 'rules' : 'lectures', false);

        if (!entries.length) {
            const resultsNode = document.getElementById('rulesSearchResults');
            if (resultsNode) {
                resultsNode.innerHTML = '<div class="rules-load-error"><strong>규정 자료를 불러오지 못했습니다</strong>강좌 검색 기능은 정상적으로 계속 사용할 수 있습니다.</div>';
            }
        } else {
            searchRules('');
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        prepareEntries();
        module.exports = { analyzeQuery, rankEntries, makeAnswerExtract, cleanGuideText, getGuideFacts, getRegulationFacts, displayTitle };
        return;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
