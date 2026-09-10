// ── 프록시 설정 ──────────────────────────────────────────────
// Cloudflare Worker URL을 배포한 뒤 아래 값을 교체하세요.
// 예) 'https://liblect-proxy.YOUR-SUBDOMAIN.workers.dev'
// 비워두면 로컬 서버(/api/)로 폴백합니다.
const WORKER_BASE = 'https://liblect-proxy.jssimonlee.workers.dev/';

const LIBRARY_DATA_API = WORKER_BASE
    ? WORKER_BASE.replace(/\/$/, '') + '/api/libraryLectures'
    : '/api/libraryLectures';

const ASSIGNEES_API = WORKER_BASE
    ? WORKER_BASE.replace(/\/$/, '') + '/api/assignees'
    : '/api/assignees';

const ASSIGNEE_API = WORKER_BASE
    ? WORKER_BASE.replace(/\/$/, '') + '/api/assignee'
    : '/api/assignee';

const SEARCH_LOG_API = WORKER_BASE
    ? WORKER_BASE.replace(/\/$/, '') + '/api/search-log'
    : '/api/search-log';
// ────────────────────────────────────────────────────────────

function recordAnonymousSearch(searchType, query, resultCount) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return;
    fetch(SEARCH_LOG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchType, query: cleanQuery, resultCount }),
        keepalive: true,
    }).catch(() => {
        // 통계 저장 실패가 실제 검색을 방해하지 않도록 조용히 무시합니다.
    });
}

const CARDS_PER_PAGE = 12;   // 화면에 보여주는 카드 수

// 상태 관리
let libraryData = [];         // 최근 6개월 안의 도서관 데이터
let allData = [];             // 현재 검색어에 매칭된 데이터
let currentFilter = 'all';
let displayPage = 1;          // 현재 보고 있는 표시 페이지
let searchDone = true;        // 현재 데이터셋 안에서 검색이 끝났는지
let dataLoadDone = false;     // 최근 도서관 데이터셋을 만들었는지
let isLoading = false;
let isBackgroundSyncing = false; // 2단계 백그라운드 전체 동기화 실행 여부

let myLibraryFavorite = [];
try {
    const savedFav = localStorage.getItem('myLibraryFavorite');
    if (savedFav) {
        myLibraryFavorite = JSON.parse(savedFav);
    }
} catch (e) {
    console.error('Failed to load myLibraryFavorite:', e);
}

// ── 담당자 등록 기능 ──────────────────────────────────
let isIncognito = false;
let assigneeData = {}; // { lectureKey: { name: '홍길동', masked: '*길*' } }

// 시크릿(프라이빗) 모드 감지
function detectIncognito() {
    return new Promise(resolve => {
        try {
            // Storage estimate 기반 탐지 (Chrome)
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then(est => {
                    // 시크릿 모드에서는 quota가 매우 작음 (약 120MB 이하)
                    if (est.quota && est.quota < 130 * 1024 * 1024) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }).catch(() => resolve(false));
            } else {
                resolve(false);
            }
        } catch (e) {
            resolve(false);
        }
    });
}

// 강좌 고유 키 생성
function getLectureKey(d) {
    // lectureIdx가 가장 신뢰할 수 있는 ID, 없으면 institution+name 조합
    if (d.lectureIdx) return d.lectureIdx;
    return (d.institution || '') + '::' + (d.name || '');
}

// 담당자 데이터 로드 (D1 DB 비동기 호출)
async function loadAssigneeData() {
    try {
        const response = await fetch(ASSIGNEES_API);
        if (response.ok) {
            assigneeData = await response.json();
        } else {
            console.error('Failed to load assignee data from server:', response.status);
        }
    } catch (e) {
        console.error('Failed to fetch assignee data:', e);
    }
}

// 이름 마스킹 옵션 생성 (2글자, 3글자, 4글자 이상 대응)
function generateMaskOptions(fullName) {
    const name = fullName.trim();
    if (name.length < 2) return [];
    const stars = (n) => '*'.repeat(n);
    const options = [];
    if (name.length === 2) {
        // 2글자: 홍* , *동
        options.push(name[0] + stars(1));
        options.push(stars(1) + name[1]);
    } else if (name.length === 3) {
        // 3글자: 홍**, *길*, **동
        options.push(name[0] + stars(2));
        options.push(stars(1) + name[1] + stars(1));
        options.push(stars(2) + name[2]);
    } else {
        // 4글자 이상: 첫글자만, 중간글자만, 끝글자만
        const len = name.length;
        options.push(name[0] + stars(len - 1));
        const mid = Math.floor(len / 2);
        options.push(stars(mid) + name[mid] + stars(len - mid - 1));
        options.push(stars(len - 1) + name[len - 1]);
    }
    return options;
}

// 속성용 이스케이프 (따옴표 포함)
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const ASSIGNEE_COLORS = [
    '#ef4444', // Red (선명한 빨간색)
    '#3b82f6', // Blue (선명한 파란색)
    '#10b981', // Green (선명한 초록색)
    '#eab308', // Yellow (선명한 노란색)
    '#a7f3d0', // Mint (선명한 민트색)
    '#1f2937'  // Black (선명한 검은색)
];
const SAFE_ASSIGNEE_COLORS = new Set([...ASSIGNEE_COLORS, '#8b5a2b']);

let selectedColor = '#ef4444';

function renderColorPalette(activeColor) {
    selectedColor = activeColor;
    const palette = document.getElementById('assigneeColorPalette');
    if (!palette) return;

    palette.innerHTML = ASSIGNEE_COLORS.map(c => {
        const isLightColor = c === '#eab308' || c === '#a7f3d0';
        const checkColor = isLightColor ? '#1f2937' : '#ffffff';
        const textShadow = isLightColor ? 'none' : '0 1px 3px rgba(0,0,0,0.5)';
        return `<button type="button" class="assignee-color-btn ${c === activeColor ? 'selected' : ''}" style="background-color: ${c}; position: relative;" onclick="selectColor('${c}')" title="${getColorName(c)}">
            ${c === activeColor ? `<span style="color:${checkColor}; font-size:16px; font-weight:900; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); pointer-events:none; text-shadow: ${textShadow};">✓</span>` : ''}
        </button>`;
    }).join('');
}

window.selectColor = function(color) {
    renderColorPalette(color);
};

function getColorName(c) {
    const names = {
        '#ef4444': '빨간색',
        '#3b82f6': '파란색',
        '#10b981': '초록색',
        '#eab308': '노란색',
        '#a7f3d0': '민트색',
        '#1f2937': '검은색'
    };
    return names[c] || '기본 색상';
}

async function hashAssigneeName(name) {
    const normalized = String(name || '').trim().normalize('NFC');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function findPreviousColorForAssignee(currentInstitution, currentName) {
    if (!currentInstitution || !currentName) return '';
    const nameHash = await hashAssigneeName(currentName);
    for (const [key, value] of Object.entries(assigneeData)) {
        const item = libraryData.find(l => String(l.lectureIdx) === String(key) || `${l.institution}::${l.name}` === String(key));
        if (item && item.institution === currentInstitution && value.nameHash === nameHash) {
            if (value.color && value.color !== 'default') {
                return value.color;
            }
        }
    }
    return '';
}

// 3버튼 커스텀 다이얼로그를 동적으로 띄우는 함수
function showColorChoiceDialog(oldColor, newColor, onChoice) {
    const oldName = getColorName(oldColor);
    const newName = getColorName(newColor);

    const overlay = document.createElement('div');
    overlay.className = 'color-choice-overlay';
    overlay.id = 'colorChoiceOverlay';

    overlay.innerHTML = `
        <div class="color-choice-dialog">
            <h4>⚠️ 담당자 색상 변경 설정</h4>
            <div class="dialog-body">
                이 도서관에 동일한 이름의 담당자에게 이미 다른 색상(<strong>[${oldName}]</strong>)이 지정되어 있었습니다.<br><br>
                원하시는 저장 방식을 선택해 주세요:
            </div>
            <div class="color-choice-btn-group">
                <button type="button" class="color-choice-btn choice-all" onclick="handleChoice('all')">이 담당자의 전체 강좌 색상 일괄 변경</button>
                <button type="button" class="color-choice-btn choice-only" onclick="handleChoice('only')">이 강좌만 개별 색상 변경</button>
                <button type="button" class="color-choice-btn choice-cancel" onclick="handleChoice('cancel')">취소</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    window.handleChoice = function(choice) {
        document.body.removeChild(overlay);
        onChoice(choice);
    };
}

// 담당자 버튼 HTML 렌더링
function renderAssigneeButton(d) {
    const key = getLectureKey(d);
    const info = assigneeData[key];
    const safeKey = escapeAttr(key);
    if (info && info.masked) {
        const color = SAFE_ASSIGNEE_COLORS.has(info.color) ? info.color : '#ef4444';
        return `<button class="assignee-btn set" data-lecture-key="${safeKey}" data-edit="1" title="담당자 수정" style="--assignee-color: ${color};">
            <span class="assignee-left-bar"></span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="assignee-svg-icon"><path fill-rule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clip-rule="evenodd" /></svg>
            담당: ${escapeHtml(info.masked)}
        </button>`;
    }
    return `<button class="assignee-btn unset" data-lecture-key="${safeKey}" data-edit="0" title="담당자 등록"><span class="assignee-icon">✏️</span>담당자등록</button>`;
}

// 이벤트 위임: 카드 영역의 담당자 버튼 클릭 처리
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.assignee-btn');
    if (!btn) return;
    e.stopPropagation();
    const key = btn.dataset.lectureKey;
    const isEdit = btn.dataset.edit === '1';
    if (key) openAssigneePopover(key, isEdit);
});

// 담당자 팝오버 열기
function openAssigneePopover(lectureKey, isEdit) {
    // 기존 팝오버 제거
    closeAssigneePopover();

    const existing = assigneeData[lectureKey];
    const existingName = existing ? existing.name : '';
    const existingMasked = existing ? existing.masked : '';
    const existingColor = existing ? existing.color : '#ef4444';

    // 개인정보 보호: 기존 이름/마스킹 표시 안 함 (새로 입력하도록 초기화)
    selectedMask = '';

    const overlay = document.createElement('div');
    overlay.className = 'assignee-popover-overlay';
    overlay.id = 'assigneePopoverOverlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeAssigneePopover(); };

    const pop = document.createElement('div');
    pop.className = 'assignee-popover';

    let html = `
        <h4>${isEdit ? '👤 담당자 수정' : '✏️ 담당자 등록'}</h4>
        <div class="pop-subtitle">이름을 입력하면 보호된 표시 옵션을 선택할 수 있습니다</div>
        <div class="pop-input-wrap">
            <input type="text" id="assigneeNameInput" placeholder="이름을 입력하세요 (예: 홍길동)" value="" maxlength="10" autocomplete="off" />
        </div>
        <div class="assignee-mask-options" id="assigneeMaskOptions"></div>
        <div class="pop-subtitle" style="margin-top: 1.25rem; font-weight:600; color:#5c4033;">🎨 담당자 고유 색상 선택</div>
        <div class="assignee-color-palette" id="assigneeColorPalette"></div>
        <div class="assignee-pop-actions">
            ${isEdit ? '<button class="pop-delete" onclick="deleteAssignee()">삭제</button>' : ''}
            <button class="pop-cancel" onclick="closeAssigneePopover()">취소</button>
            <button class="pop-save" id="assigneeSaveBtn" disabled onclick="saveAssignee()">저장</button>
        </div>
    `;

    pop.innerHTML = html;
    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    // 현재 편집중인 키를 저장
    overlay.dataset.lectureKey = lectureKey;

    const nameInput = document.getElementById('assigneeNameInput');
    nameInput.addEventListener('input', async () => {
        const val = nameInput.value.trim();
        updateMaskOptions(nameInput.value);

        // 동일 도서관 내의 동일 이름이 등록된 적이 있는지 자동 추적하여 추천 선택
        const d = libraryData.find(item => String(item.lectureIdx) === String(lectureKey) || `${item.institution}::${item.name}` === String(lectureKey));
        const currentInst = d ? d.institution : '';
        const prevColor = val.length >= 2 ? await findPreviousColorForAssignee(currentInst, val) : '';
        if (nameInput.value.trim() === val && prevColor) {
            renderColorPalette(prevColor);
        }
    });

    // 기존 색상 또는 기본 색상 팔레트 렌더링
    setTimeout(() => {
        renderColorPalette(existingColor);
    }, 20);

    // 개인정보 보호: 기존 이름을 표시하지 않으므로 마스크 옵션도 빈 상태로 시작

    // 포커스
    setTimeout(() => nameInput.focus(), 100);
}

// 마스크 옵션 업데이트
function updateMaskOptions(name) {
    const container = document.getElementById('assigneeMaskOptions');
    if (!container) return;

    const options = generateMaskOptions(name);
    if (options.length === 0) {
        container.innerHTML = '<span style="font-size:0.78rem; color:#a0aec0;">2글자 이상 입력해 주세요</span>';
        document.getElementById('assigneeSaveBtn').disabled = true;
        return;
    }

    container.innerHTML = options.map(opt =>
        `<button type="button" class="assignee-mask-btn" data-mask="${escapeAttr(opt)}">${escapeHtml(opt)}</button>`
    ).join('');
    container.querySelectorAll('.assignee-mask-btn').forEach(button => {
        button.addEventListener('click', () => selectMask(button, button.dataset.mask || ''));
    });
    document.getElementById('assigneeSaveBtn').disabled = true;
}

// 마스크 선택
let selectedMask = '';
function selectMask(btn, mask) {
    document.querySelectorAll('.assignee-mask-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedMask = mask;
    document.getElementById('assigneeSaveBtn').disabled = false;
}

// 저장 (D1 DB 비동기 호출)
async function saveAssignee() {
    const overlay = document.getElementById('assigneePopoverOverlay');
    if (!overlay) return;
    const lectureKey = overlay.dataset.lectureKey;
    const nameInput = document.getElementById('assigneeNameInput');
    const fullName = nameInput.value.trim();

    if (!fullName || !selectedMask) return;

    const saveBtn = document.getElementById('assigneeSaveBtn');

    // 기존 동일 도서관에 동일 이름으로 등록된 적이 있던 색상 추적 검증
    const d = libraryData.find(item => String(item.lectureIdx) === String(lectureKey) || `${item.institution}::${item.name}` === String(lectureKey));
    const currentInst = d ? d.institution : '';
    const fullNameHash = await hashAssigneeName(fullName);
    const previousColor = await findPreviousColorForAssignee(currentInst, fullName);

    // 동일 도서관 내에 이 담당자명으로 등록된 강좌 수 계산
    let relatedCount = 0;
    for (const [key, value] of Object.entries(assigneeData)) {
        const item = libraryData.find(l => String(l.lectureIdx) === String(key) || `${l.institution}::${l.name}` === String(key));
        if (item && item.institution === currentInst && value.nameHash === fullNameHash) {
            relatedCount++;
        }
    }

    // 다른 강좌도 존재하는 경우에만 3버튼 경고 모달을 띄우고, 이 담당자의 유일한 강좌인 경우 묻지 않고 바로 저장
    if (previousColor && selectedColor !== previousColor && relatedCount > 1) {
        showColorChoiceDialog(previousColor, selectedColor, async (choice) => {
            if (choice === 'cancel') {
                return; // 그냥 취소 후 복귀
            }

            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = '저장 중...';
            }

            if (choice === 'all') {
                // 옵션 1: 도서관 내 동일 풀네임을 가진 모든 강좌들의 색상을 일괄 변경 저장
                const allRelatedKeys = [];
                for (const [key, value] of Object.entries(assigneeData)) {
                    const item = libraryData.find(l => String(l.lectureIdx) === String(key) || `${l.institution}::${l.name}` === String(key));
                    if (item && item.institution === currentInst && value.nameHash === fullNameHash) {
                        allRelatedKeys.push(key);
                    }
                }

                if (!allRelatedKeys.includes(lectureKey)) {
                    allRelatedKeys.push(lectureKey);
                }

                try {
                    await Promise.all(allRelatedKeys.map(key =>
                        fetch(ASSIGNEE_API, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                lectureKey: key,
                                name: fullName,
                                masked: key === lectureKey ? selectedMask : (assigneeData[key] ? assigneeData[key].masked : selectedMask),
                                color: selectedColor
                            })
                        })
                    ));

                    allRelatedKeys.forEach(key => {
                        assigneeData[key] = {
                            name: fullName,
                            masked: key === lectureKey ? selectedMask : (assigneeData[key] ? assigneeData[key].masked : selectedMask),
                            color: selectedColor,
                            updated_at: Date.now()
                        };
                    });
                } catch (e) {
                    console.error('Failed to batch update assignee colors:', e);
                    alert('일괄 저장 도중 오류가 발생했습니다.');
                }
            } else if (choice === 'only') {
                // 옵션 2: 오직 현재 수정한 이 강좌에만 새로운 색상을 개별 적용 저장
                try {
                    const response = await fetch(ASSIGNEE_API, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            lectureKey: lectureKey,
                            name: fullName,
                            masked: selectedMask,
                            color: selectedColor
                        })
                    });

                    if (response.ok) {
                        assigneeData[lectureKey] = {
                            name: fullName,
                            masked: selectedMask,
                            color: selectedColor,
                            updated_at: Date.now()
                        };
                    }
                } catch (e) {
                    console.error('Failed to save single assignee color:', e);
                    alert('저장 도중 오류가 발생했습니다.');
                }
            }

            selectedMask = '';
            closeAssigneePopover();
            renderResults();
        });
    } else {
        // 이전 지정 색상과 동일하거나 신규 배정 시
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = '저장 중...';
        }

        try {
            const response = await fetch(ASSIGNEE_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    lectureKey: lectureKey,
                    name: fullName,
                    masked: selectedMask,
                    color: selectedColor
                })
            });

            if (response.ok) {
                assigneeData[lectureKey] = {
                    name: fullName,
                    masked: selectedMask,
                    color: selectedColor,
                    updated_at: Date.now()
                };
            } else {
                alert('담당자 정보를 저장하지 못했습니다.');
            }
        } catch (err) {
            console.error('Failed to save assignee:', err);
            alert('네트워크 오류로 담당자 저장에 실패했습니다.');
        }

        selectedMask = '';
        closeAssigneePopover();
        renderResults();
    }
}

// 삭제 (D1 DB 비동기 호출)
async function deleteAssignee() {
    const overlay = document.getElementById('assigneePopoverOverlay');
    if (!overlay) return;
    const lectureKey = overlay.dataset.lectureKey;

    const deleteBtn = document.querySelector('.pop-delete');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.textContent = '삭제 중...';
    }

    try {
        const response = await fetch(ASSIGNEE_API, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                lectureKey: lectureKey
            })
        });

        if (response.ok) {
            delete assigneeData[lectureKey];
        } else {
            alert('담당자 정보를 삭제하지 못했습니다.');
        }
    } catch (err) {
        console.error('Failed to delete assignee:', err);
        alert('네트워크 오류로 담당자 삭제에 실패했습니다.');
    }

    selectedMask = '';
    closeAssigneePopover();
    renderResults();
}

// 팝오버 닫기
function closeAssigneePopover() {
    const overlay = document.getElementById('assigneePopoverOverlay');
    if (overlay) overlay.remove();
    selectedMask = '';
}

// 초기화: 시크릿 모드 감지 & 담당자 데이터 로드
detectIncognito().then(result => {
    isIncognito = result;
});
loadAssigneeData().then(() => {
    if (dataLoadDone) renderResults();
});
// ────────────────────────────────────────────────────────

let currentKeyword = '';
const BASELINE_INSTITUTIONS = [
    '가족만세센터작은도서관', '기아행복마루작은도서관', '남양도서관', '노을빛도서관',
    '다원이음터도서관', '달빛나래어린이도서관', '동탄중앙이음터도서관', '두빛나래어린이도서관',
    '둥지나래어린이도서관', '마도작은도서관', '목동이음터도서관', '병점도서관',
    '봉담도서관', '봉담와우도서관', '봉담커피앤북작은도서관', '비봉작은도서관',
    '삼괴도서관', '샘내작은도서관', '서신작은도서관', '서연이음터도서관',
    '송린이음터도서관', '송산도서관', '양감작은도서관', '왕배푸른숲도서관',
    '정남도서관', '진안도서관', '태안도서관', '팔탄작은도서관',
    '향남복합문화센터도서관', '화성동탄중앙도서관'
];
let institutionNames = new Set(BASELINE_INSTITUTIONS);
let datasetMeta = null;
let abortController = null;

const searchInput = document.getElementById('searchInput');
const institutionSelect = document.getElementById('institutionSelect');

// 최초 진입 시 도서관 선택 상자 즉시 렌더링 (시크릿 모드에서도 0초 대기)
populateInstitutionSelect();

// Enter key
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
});

institutionSelect.addEventListener('change', () => {
    const val = institutionSelect.value;
    if (val) {
        localStorage.setItem('selectedInstitution', val);
    } else {
        localStorage.removeItem('selectedInstitution');
    }
    // Reset search input and keyword
    searchInput.value = '';
    currentKeyword = '';

    doSearch(false);
});

const keyToChosung = {
    'r': 'ㄱ', 's': 'ㄴ', 'e': 'ㄷ', 'f': 'ㄹ', 'a': 'ㅁ', 'q': 'ㅂ', 't': 'ㅅ',
    'd': 'ㅇ', 'w': 'ㅈ', 'c': 'ㅊ', 'z': 'ㅋ', 'x': 'ㅌ', 'v': 'ㅍ', 'g': 'ㅎ',
    'ㄱ': 'ㄱ', 'ㄴ': 'ㄴ', 'ㄷ': 'ㄷ', 'ㄹ': 'ㄹ', 'ㅁ': 'ㅁ', 'ㅂ': 'ㅂ', 'ㅅ': 'ㅅ',
    'ㅇ': 'ㅇ', 'ㅈ': 'ㅈ', 'ㅊ': 'ㅊ', 'ㅋ': 'ㅋ', 'ㅌ': 'ㅌ', 'ㅍ': 'ㅍ', 'ㅎ': 'ㅎ'
};

function getChosung(str) {
    if (!str) return '';
    const char = str.charAt(0);
    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
        const chosungList = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
        return chosungList[Math.floor((code - 0xAC00) / 588)];
    }
    const singleConsonants = {
        0x3131: 'ㄱ', 0x3132: 'ㄲ', 0x3134: 'ㄴ', 0x3137: 'ㄷ', 0x3138: 'ㄸ',
        0x3139: 'ㄹ', 0x3141: 'ㅁ', 0x3142: 'ㅂ', 0x3143: 'ㅃ', 0x3145: 'ㅅ',
        0x3146: 'ㅆ', 0x3147: 'ㅇ', 0x3148: 'ㅈ', 0x3149: 'ㅉ', 0x314a: 'ㅊ',
        0x314b: 'ㅋ', 0x314c: 'ㅌ', 0x314d: 'ㅍ', 0x314e: 'ㅎ'
    };
    if (singleConsonants[code]) return singleConsonants[code];
    return char.toLowerCase();
}

institutionSelect.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    let pressedKey = e.key;
    if (!pressedKey) return;

    const mapped = keyToChosung[pressedKey.toLowerCase()];
    const searchChar = mapped || pressedKey.toLowerCase();

    const options = Array.from(institutionSelect.options);
    for (let i = 0; i < options.length; i++) {
        const optText = options[i].text;
        if (!optText || optText === '전체 도서관') continue;

        const optChosung = getChosung(optText);
        const firstChar = optText.charAt(0).toLowerCase();

        if (optChosung === searchChar || firstChar === searchChar || optText.toLowerCase().startsWith(searchChar)) {
            institutionSelect.selectedIndex = i;
            institutionSelect.dispatchEvent(new Event('change'));
            e.preventDefault();
            break;
        }
    }
});

// ── 날짜 및 오늘/내일 강좌 판단 헬퍼 함수 ──
function getKoreaTodayDateOnly() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

function getKoreaTomorrowDateOnly() {
    const today = getKoreaTodayDateOnly();
    return new Date(today.getTime() + 24 * 60 * 60 * 1000);
}

function parseDateOnly(value) {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 8) return null;
    const year = parseInt(digits.slice(0, 4), 10);
    const month = parseInt(digits.slice(4, 6), 10) - 1;
    const day = parseInt(digits.slice(6, 8), 10);
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    return date;
}

function updateLectureState(d) {
    d.isToday = isTodayLecture(d);
    d.isTomorrow = isTomorrowLecture(d);

    const today = getKoreaTodayDateOnly();
    const end = parseDateOnly(d.endDate);
    if (end && today > end) {
        d.status = '강좌종료';
    }
}

function getApiDayCode(date) {
    const jsDay = date.getUTCDay();
    return jsDay === 0 ? '7' : String(jsDay);
}

function parseDayCodes(dayStr) {
    if (!dayStr) return [];
    const koreanMap = { '월': '1', '화': '2', '수': '3', '목': '4', '금': '5', '토': '6', '일': '7' };
    return String(dayStr)
        .split(/[,/|·\s]+/)
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => v.replace(/요일$/, ''))
        .map(v => koreanMap[v] || v)
        .filter(v => /^[1-7]$/.test(v));
}

function isTodayLecture(d) {
    if (isCanceledLecture(d)) {
        return false;
    }
    const today = getKoreaTodayDateOnly();
    const begin = parseDateOnly(d.beginDate);
    const end = parseDateOnly(d.endDate);
    if (!today || !begin || !end) return false;
    if (today < begin || today > end) return false;

    const dayCodes = parseDayCodes(d.dayOfWeek);
    if (dayCodes.length === 0) {
        return begin.getTime() === end.getTime() && today.getTime() === begin.getTime();
    }

    return dayCodes.includes(getApiDayCode(today));
}

// 오늘 수업의 시간대별 상태(진행중, 예정, 종료) 판정
function getTodayLectureTimeStatus(d) {
    if (!d.isToday) return null;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentSec = now.getSeconds();
    const currentTimeInSeconds = (currentHour * 3600) + (currentMin * 60) + currentSec;

    // HH:MM 또는 HH:MM:SS 형식을 초 단위로 변환
    const parseTimeToSeconds = (timeStr) => {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        const hrs = parts[0] || 0;
        const mins = parts[1] || 0;
        const secs = parts[2] || 0;
        return (hrs * 3600) + (mins * 60) + secs;
    };

    const beginSecs = parseTimeToSeconds(d.beginTime);
    const endSecs = parseTimeToSeconds(d.endTime);

    if (currentTimeInSeconds < beginSecs) {
        return 'upcoming';  // 오늘 중 시작 전 (예정)
    } else if (currentTimeInSeconds >= beginSecs && currentTimeInSeconds <= endSecs) {
        return 'ongoing';   // 수업 진행 중
    } else {
        return 'completed'; // 수업 종료
    }
}

function isTomorrowLecture(d) {
    if (isCanceledLecture(d)) {
        return false;
    }
    const tomorrow = getKoreaTomorrowDateOnly();
    const begin = parseDateOnly(d.beginDate);
    const end = parseDateOnly(d.endDate);
    if (!tomorrow || !begin || !end) return false;
    if (tomorrow < begin || tomorrow > end) return false;

    const dayCodes = parseDayCodes(d.dayOfWeek);
    if (dayCodes.length === 0) {
        return begin.getTime() === end.getTime() && tomorrow.getTime() === begin.getTime();
    }

    return dayCodes.includes(getApiDayCode(tomorrow));
}

// ── 특정 선택 날짜 강좌/접수 여부 판단 및 핸들러 ──
let selectedDateString = ''; // YYYY-MM-DD 포맷
let selectedDateObj = null;  // Date 객체

function isLectureOnDate(d, dateObj) {
    const begin = parseDateOnly(d.beginDate);
    const end = parseDateOnly(d.endDate);
    if (!dateObj || !begin || !end) return false;
    if (dateObj < begin || dateObj > end) return false;

    const dayCodes = parseDayCodes(d.dayOfWeek);
    if (dayCodes.length === 0) {
        return begin.getTime() === end.getTime() && dateObj.getTime() === begin.getTime();
    }

    return dayCodes.includes(getApiDayCode(dateObj));
}

function isApplyingOnDate(d, dateObj) {
    const begin = parseDateOnly(d.applyBegin);
    const end = parseDateOnly(d.applyEnd);
    if (!dateObj || !begin || !end) return false;
    return dateObj >= begin && dateObj <= end;
}

function openDatePicker(btn) {
    const picker = document.getElementById('filterDatePicker');
    if (typeof picker.showPicker === 'function') {
        picker.showPicker();
    } else {
        picker.click();
    }
}

function handleDateSelected(val) {
    if (!val) return;
    selectedDateString = val;
    const [year, month, day] = val.split('-').map(Number);
    selectedDateObj = new Date(Date.UTC(year, month - 1, day));

    currentFilter = 'date';
    displayPage = 1;

    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const dateBtn = document.querySelector('.filter-btn.date-select');
    if (dateBtn) dateBtn.classList.add('active');

    renderResults();
}

function clearDateStateSilent() {
    selectedDateString = '';
    selectedDateObj = null;
    const picker = document.getElementById('filterDatePicker');
    if (picker) picker.value = '';
}

function clearDateFilter(e) {
    if (e) e.stopPropagation();
    clearDateStateSilent();

    if (currentFilter === 'date') {
        currentFilter = 'all';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
    }
    renderResults();
}

// ── 로컬 스토리지 캐시 및 동기화 최적화 ──
const CACHE_KEYS = {
    lectures: 'liblect_cached_lectures',
    meta: 'liblect_cached_meta',
    institutions: 'liblect_cached_institutions',
    lastSync: 'liblect_last_sync_time'
};

const SYNC_GRACE_PERIOD_MS = 30 * 60 * 1000; // 30분 그레이스 피리어드 (이후에는 백그라운드 갱신 자동 기동)
const SYNC_TIER_1_MS = 24 * 60 * 60 * 1000;    // 24시간 이내: 최신 100개 동기화
const SYNC_TIER_2_MS = 7 * 24 * 60 * 60 * 1000; // 7일 이내: 최신 500개 동기화

function getLectureKey(d) {
    return d.lectureIdx || `${d.institution}_${d.name}_${d.beginDate}`;
}

function mergeLectures(existing, newItems) {
    const mergedMap = new Map();
    // 1. 기존 캐시 데이터 맵에 채우기
    existing.forEach(item => {
        const key = getLectureKey(item);
        if (key) mergedMap.set(key, item);
    });
    // 2. 신규 데이터 덮어쓰기 (실시간 인원 수, 상태 갱신 반영)
    newItems.forEach(item => {
        const key = getLectureKey(item);
        if (key) mergedMap.set(key, item);
    });
    // 3. 배열로 반환 및 beginDate 내림차순(최신순) 정렬
    return Array.from(mergedMap.values()).sort((a, b) => {
        return (b.beginDate || '').localeCompare(a.beginDate || '');
    });
}

function saveCacheToLocalStorage(lectures, meta, institutions, timestamp) {
    try {
        localStorage.setItem(CACHE_KEYS.lectures, JSON.stringify(lectures));
        localStorage.setItem(CACHE_KEYS.meta, JSON.stringify(meta));
        localStorage.setItem(CACHE_KEYS.institutions, JSON.stringify(Array.from(institutions)));
        localStorage.setItem(CACHE_KEYS.lastSync, String(timestamp));
    } catch (e) {
        console.error('로컬 스토리지 저장 실패:', e);
    }
}

function loadCacheFromLocalStorage() {
    try {
        const cachedLectures = localStorage.getItem(CACHE_KEYS.lectures);
        const cachedMeta = localStorage.getItem(CACHE_KEYS.meta);
        const cachedInst = localStorage.getItem(CACHE_KEYS.institutions);
        const lastSync = localStorage.getItem(CACHE_KEYS.lastSync);

        if (cachedLectures && cachedMeta) {
            const lectures = JSON.parse(cachedLectures);
            const meta = JSON.parse(cachedMeta);
            const institutions = new Set(JSON.parse(cachedInst || '[]'));
            const lastSyncTime = lastSync ? parseInt(lastSync, 10) : 0;

            return { lectures, meta, institutions, lastSyncTime };
        }
    } catch (e) {
        console.error('로컬 스토리지 로드 실패:', e);
    }
    return null;
}

function showSyncBadge(message, status = 'loading') {
    const badge = document.getElementById('syncBadge');
    const text = document.getElementById('syncBadgeText');
    if (!badge || !text) return;

    text.textContent = message;
    badge.className = `sync-badge show ${status}`;

    const spinner = badge.querySelector('.spinner-mini');
    if (spinner) {
        spinner.style.display = (status === 'loading') ? 'block' : 'none';
    }

    if (status === 'success' || status === 'error') {
        if (badge._timeout) clearTimeout(badge._timeout);
        badge._timeout = setTimeout(() => {
            badge.classList.remove('show');
        }, status === 'success' ? 2500 : 3500);
    }
}

function hideSyncBadge() {
    const badge = document.getElementById('syncBadge');
    if (badge) {
        badge.classList.remove('show');
        if (badge._timeout) clearTimeout(badge._timeout);
    }
}

// ── 데이터 신선도 표시 ──
function getRelativeTimeText(timestampMs) {
    if (!timestampMs) return '알 수 없음';
    const diffMs = Date.now() - timestampMs;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return '방금 전 데이터';
    if (diffMin < 60) return `${diffMin}분 전 데이터`;
    if (diffHour < 24) return `${diffHour}시간 전 데이터`;
    return `${diffDay}일 전 데이터`;
}

function updateFreshnessBar() {
    const bar = document.getElementById('dataFreshnessBar');
    const textEl = document.getElementById('freshnessText');
    if (!bar || !textEl) return;

    const lastSync = localStorage.getItem(CACHE_KEYS.lastSync);
    let ts = 0;
    if (lastSync) {
        if (/^\d+$/.test(lastSync)) {
            ts = parseInt(lastSync, 10);
        } else {
            ts = Date.parse(lastSync) || 0;
        }
    }

    if (ts > 0) {
        textEl.innerHTML = `<span class="freshness-time">${getRelativeTimeText(ts)}</span>`;
        bar.classList.add('visible');
    } else {
        bar.classList.remove('visible');
    }
}

// 1분마다 신선도 텍스트 자동 갱신
setInterval(updateFreshnessBar, 60 * 1000);

// ── 오늘수업 상태 배지(수업중/예정/종료) 실시간 자동 갱신 ──
function updateTodayLectureBadges() {
    const badges = document.querySelectorAll('.today-sub-badge[data-begin-time][data-end-time]');
    if (badges.length === 0) return;

    const now = new Date();
    const currentTimeInSeconds = (now.getHours() * 3600) + (now.getMinutes() * 60) + now.getSeconds();

    const parseTimeToSeconds = (timeStr) => {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        return ((parts[0] || 0) * 3600) + ((parts[1] || 0) * 60) + (parts[2] || 0);
    };

    badges.forEach(badge => {
        const beginSecs = parseTimeToSeconds(badge.dataset.beginTime);
        const endSecs = parseTimeToSeconds(badge.dataset.endTime);

        let newStatus, newClass, newLabel;
        if (currentTimeInSeconds < beginSecs) {
            newStatus = 'upcoming';
            newClass = 'today-sub-badge upcoming';
            newLabel = '⏰ 예정';
        } else if (currentTimeInSeconds >= beginSecs && currentTimeInSeconds <= endSecs) {
            newStatus = 'ongoing';
            newClass = 'today-sub-badge ongoing';
            newLabel = '⚡ 수업중';
        } else {
            newStatus = 'completed';
            newClass = 'today-sub-badge completed';
            newLabel = '✓ 종료';
        }

        // 상태가 바뀌었을 때만 DOM 업데이트 (불필요한 리플로우 방지)
        if (badge.className !== newClass) {
            badge.className = newClass;
            badge.textContent = newLabel;
        }
    });
}

// 30초마다 오늘수업 상태 배지 자동 갱신
setInterval(updateTodayLectureBadges, 30 * 1000);

// ── 브라우저 정기 백그라운드 자동 동기화 (Smart Silent Sync) ──
async function silentBackgroundSync() {
    if (isLoading || isBackgroundSyncing) return;
    isBackgroundSyncing = true;

    try {
        const lastSync = localStorage.getItem(CACHE_KEYS.lastSync);
        let localTs = 0;
        if (lastSync) {
            localTs = /^\d+$/.test(lastSync) ? parseInt(lastSync, 10) : (Date.parse(lastSync) || 0);
        }

        const localAge = Date.now() - localTs;
        // 로컬 캐시가 30분 이상 지났으면 캐시 바이패스(_t 파라미터)로 서버에 직접 요청
        const needsFresh = localAge > SYNC_GRACE_PERIOD_MS;
        const fetchUrl = needsFresh
            ? `${LIBRARY_DATA_API}?_t=${Date.now()}`
            : LIBRARY_DATA_API;

        const res = await fetch(fetchUrl);
        if (!res.ok) return;

        const payload = await res.json();
        const remoteGenerated = payload.meta && payload.meta.generatedA
            ? (isNaN(payload.meta.generatedAt) ? Date.parse(payload.meta.generatedAt) : Number(payload.meta.generatedAt))
            : 0;

        // 서버 데이터의 generatedAt가 로컬보다 새로운 경우 → 실질적으로 데이터가 갱신됨
        if (remoteGenerated > localTs || needsFresh) {
            const rawFetched = Array.isArray(payload.lectures) ? payload.lectures : [];
            const fetchedLectures = rawFetched.filter(d => !isWholeSetLoan(d));

            if (fetchedLectures.length > 0) {
                libraryData = fetchedLectures;

                libraryData.forEach(d => {
                    updateLectureState(d);
                });

                datasetMeta = payload.meta || datasetMeta;

                const newInsts = Array.isArray(payload.institutions)
                    ? payload.institutions
                    : fetchedLectures.map(d => d.institution).filter(Boolean);

                newInsts.forEach(inst => institutionNames.add(inst));

                const currentSelected = institutionSelect.value;
                populateInstitutionSelect();
                if (currentSelected && [...institutionNames].includes(currentSelected)) {
                    institutionSelect.value = currentSelected;
                }

                // lastSync에는 현재 브라우저 시간(Date.now())을 저장하여 신선도를 정확히 표시
                saveCacheToLocalStorage(libraryData, datasetMeta, institutionNames, Date.now());

                allData = getSearchBaseData();
                updateFilterButtons(getFilterCounts(allData));
                renderResults();

                showSyncBadge('✨ 최신 강좌 정보 자동 업데이트 완료!', 'success');
                updateFreshnessBar();
            }
        }
    } catch (err) {
        console.error('Silent background sync failed:', err);
    } finally {
        isBackgroundSyncing = false;
    }
}

// 30분마다 정기 백그라운드 자동 동기화 실행 (사이트가 켜져 있는 동안)
setInterval(silentBackgroundSync, 30 * 60 * 1000);

// 사용자가 다른 탭/작업을 하다가 브라우저 탭으로 돌아왔을 때
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // 탭 복귀 시 즉시 신선도 텍스트 갱신 (경과 시간 정확히 표시)
        updateFreshnessBar();
        // 탭 복귀 시 오늘수업 상태 배지도 즉시 갱신
        updateTodayLectureBadges();

        const lastSync = localStorage.getItem(CACHE_KEYS.lastSync);
        let localTs = 0;
        if (lastSync) {
            localTs = /^\d+$/.test(lastSync) ? parseInt(lastSync, 10) : (Date.parse(lastSync) || 0);
        }
        const timeDiff = Date.now() - localTs;
        // 마지막 동기화 후 30분이 넘었다면 백그라운드 갱신 자동 기동
        if (timeDiff > 30 * 60 * 1000) {
            silentBackgroundSync();
        }
    }
});

// ── 수동 강제 새로고침 ──
async function forceRefreshData() {
    const btn = document.getElementById('freshnessRefreshBtn');
    if (!btn) return;
    if (btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="refresh-spin">🔄</span> 불러오는 중...';

    showSyncBadge('🔄 최신 데이터를 서버에서 직접 불러오는 중...', 'loading');

    try {
        // 캐시 바이패스를 위한 고유 타임스탬프 파라미터 추가
        const freshUrl = `${LIBRARY_DATA_API}?_t=${Date.now()}`;
        const res = await fetch(freshUrl);
        if (!res.ok) throw new Error(`서버 응답 오류: ${res.status}`);

        const payload = await res.json();
        const rawFetched = Array.isArray(payload.lectures) ? payload.lectures : [];
        const fetchedLectures = rawFetched.filter(d => !isWholeSetLoan(d));

        if (fetchedLectures.length > 0) {
            libraryData = fetchedLectures;

            libraryData.forEach(d => { updateLectureState(d); });

            datasetMeta = payload.meta || datasetMeta;

            const newInsts = Array.isArray(payload.institutions)
                ? payload.institutions
                : fetchedLectures.map(d => d.institution).filter(Boolean);

            institutionNames.clear();
            newInsts.forEach(inst => institutionNames.add(inst));

            const currentSelected = institutionSelect.value;
            populateInstitutionSelect();
            if (currentSelected && [...institutionNames].includes(currentSelected)) {
                institutionSelect.value = currentSelected;
            }

            // lastSync에는 브라우저 현재 시간을 저장하여 신선도를 정확히 표시
            saveCacheToLocalStorage(libraryData, datasetMeta, institutionNames, Date.now());

            allData = getSearchBaseData();
            updateFilterButtons(getFilterCounts(allData));
            renderResults();

            showSyncBadge('✅ 최신 데이터 불러오기 완료!', 'success');
        } else {
            showSyncBadge('⚠️ 서버에서 데이터를 받지 못했습니다', 'error');
        }
    } catch (err) {
        console.error('강제 새로고침 실패:', err);
        showSyncBadge('⚠️ 최신 데이터 불러오기 실패', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '🔄 최신 데이터 불러오기';
        updateFreshnessBar();
    }
}

// ── Worker 캐시에서 최근 도서관 데이터셋 가져오기 ──
async function ensureLibraryDataLoaded() {
    if (dataLoadDone) return;
    if (isLoading) return;

    // 실시간 담당자 정보 동시 조회
    await loadAssigneeData();

    // 1단계: 동기적으로 localStorage 캐시 우선 로드 (즉각적인 화면 복구)
    const cached = loadCacheFromLocalStorage();
    let hasCache = false;

    if (cached && Array.isArray(cached.lectures) && cached.lectures.length > 0) {
        // 기존 캐시에 있는 전질 대출 / 전질대출 강좌 사전 배제
        libraryData = cached.lectures.filter(d => !isWholeSetLoan(d));
        datasetMeta = cached.meta;
        cached.institutions.forEach(inst => institutionNames.add(inst));

        // 오늘/내일 여부 실시간 업데이트
        libraryData.forEach(d => {
            updateLectureState(d);
        });

        populateInstitutionSelect();
        hasCache = true;
    }

    const now = Date.now();
    const lastSyncTime = cached ? cached.lastSyncTime : 0;
    const timeDiff = now - lastSyncTime;

    // 2단계: 캐시 유효기간(12시간) 확인 및 동기화 필요 여부 결정
    if (hasCache && timeDiff < SYNC_GRACE_PERIOD_MS) {
        dataLoadDone = true;
        updateFreshnessBar();
        return;
    }

    // 동기화 모드 결정
    let syncMode = 'full';
    let fetchUrl = LIBRARY_DATA_API;
    let syncMessage = '🔄 전체 강좌 데이터 실시간 동기화 중...';

    if (hasCache) {
        if (timeDiff < SYNC_TIER_1_MS) {
            syncMode = 'tier1';
            fetchUrl = `${LIBRARY_DATA_API}?limit=100`;
            syncMessage = '🔄 실시간 신청 인원 정보 갱신 중...';
        } else if (timeDiff < SYNC_TIER_2_MS) {
            syncMode = 'tier2';
            fetchUrl = `${LIBRARY_DATA_API}?limit=500`;
            syncMessage = '🔄 최근 강좌 정보 실시간 동기화 중...';
        }
    } else {
        // [시크릿 모드/신규 기기 대책] 캐시가 완전히 없는 최초 접속 시에는
        // 전체 데이터 대신, 극단적으로 빠른 1단계 최근 100개 데이터 선로드 수행 (0.3~0.5초 완료)
        syncMode = 'firstPhase';
        fetchUrl = `${LIBRARY_DATA_API}?limit=100`;
        syncMessage = '🏛️ 최근 강좌 데이터 고속 로드 중...';
    }

    isLoading = true;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    const contentEl = document.getElementById('content');

    // 캐시가 없는 최초 진입일 때는 화면 차단 로딩바와 멋진 스켈레톤 카드 사용
    if (!hasCache) {
        const savedInst = localStorage.getItem('selectedInstitution') || '';
        const loadingText = savedIns
            ? `🏛️ <strong>${escapeHtml(savedInst)}</strong> 강좌 목록을 신속하게 불러오는 중입니다...`
            : '🏛️ 최근 화성시 도서관 강좌 목록을 가져오는 중입니다...';

        let skeletonCardsHtml = '';
        for (let i = 0; i < 6; i++) {
            skeletonCardsHtml += `
                <div class="skeleton-card">
                    <div>
                        <div class="skeleton-line badge"></div>
                        <div class="skeleton-line inst"></div>
                        <div class="skeleton-line title"></div>
                        <div class="skeleton-line desc"></div>
                        <div class="skeleton-line desc-short"></div>
                    </div>
                    <div class="skeleton-line footer"></div>
                </div>`;
        }

        contentEl.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p style="margin-bottom: 2rem;">${loadingText}</p>
                <div class="skeleton-grid">
                    ${skeletonCardsHtml}
                </div>
            </div>`;
    } else {
        // 기존 캐시가 있을 때는 백그라운드로 실행하고 고급 플로팅 배지 노출
        showSyncBadge(syncMessage, 'loading');
    }

    try {
        const res = await fetch(fetchUrl, { signal: abortController.signal });
        if (!res.ok) {
            throw new Error(`동기화 API 응답 오류: ${res.status}`);
        }
        const payload = await res.json();
        const rawFetched = Array.isArray(payload.lectures) ? payload.lectures : [];
        const fetchedLectures = rawFetched.filter(d => !isWholeSetLoan(d));

        if (syncMode === 'full' || syncMode === 'firstPhase') {
            libraryData = fetchedLectures;
        } else {
            libraryData = mergeLectures(libraryData, fetchedLectures);
        }

        // 오늘/내일 강좌 상태 갱신
        libraryData.forEach(d => {
            updateLectureState(d);
        });

        datasetMeta = payload.meta || datasetMeta;

        const newInsts = Array.isArray(payload.institutions)
            ? payload.institutions
            : fetchedLectures.map(d => d.institution).filter(Boolean);

        // 새 도서관이 동적으로 추가될 수 있으므로 기존 베이스라인에 안전하게 누적 병합
        newInsts.forEach(inst => institutionNames.add(inst));

        populateInstitutionSelect();

        // 3단계: 캐시 보존 및 타임스탬프 갱신
        // 1단계 고속 선로드일 때는 타임스탬프를 0으로 캐싱하여 2단계 전체 로드가 완전히 채워지기 전 브라우저를 새로고침하면 다시 선로드를 하도록 조절
        // lastSync에는 브라우저 현재 시간을 저장하여 신선도를 정확히 표시
        saveCacheToLocalStorage(libraryData, datasetMeta, institutionNames, syncMode === 'firstPhase' ? 0 : Date.now());

        if (hasCache) {
            showSyncBadge('✅ 강좌 데이터 동기화 완료!', 'success');
            // 현재 검색 및 필터 조건 갱신 및 리렌더링
            allData = getSearchBaseData();
            updateFilterButtons(getFilterCounts(allData));
            renderResults();
        }

        dataLoadDone = true;
        updateFreshnessBar();

        // 1단계 고속 선로딩이 끝나면 화면을 차단하지 않고, 백그라운드에서 2단계 전체 데이터 동기화 실행
        if (syncMode === 'firstPhase') {
            isBackgroundSyncing = true;
            setTimeout(() => {
                isBackgroundSyncing = false;
                triggerFullSyncBackground();
            }, 300);
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            isLoading = false;
            return;
        }

        console.error('동기화 실패:', e);

        if (hasCache) {
            // 캐시가 존재할 때 통신 에러가 나면, 캐시 데이터로 백오프 작동 (오프라인 모드 배지 팝업)
            showSyncBadge('⚠️ 업데이트 실패 (기존 캐시 사용)', 'error');
            dataLoadDone = true;
            updateFreshnessBar();
        } else {
            contentEl.innerHTML = `<div class="error-msg"><h3>데이터를 불러오지 못했습니다</h3><p>${escapeHtml(e.message)}</p></div>`;
            isLoading = false;
            throw e;
        }
    }

    isLoading = false;
}

// ── 2단계 백그라운드 전체 데이터 동기화 ──
async function triggerFullSyncBackground() {
    if (isBackgroundSyncing) return;
    isBackgroundSyncing = true;

    showSyncBadge('🔄 전체 강좌 데이터 실시간 동기화 중...', 'loading');

    try {
        const res = await fetch(LIBRARY_DATA_API);
        if (!res.ok) {
            throw new Error(`백그라운드 동기화 API 응답 오류: ${res.status}`);
        }
        const payload = await res.json();
        const rawFetched = Array.isArray(payload.lectures) ? payload.lectures : [];
        const fetchedLectures = rawFetched.filter(d => !isWholeSetLoan(d));

        if (fetchedLectures.length > 0) {
            libraryData = fetchedLectures;

            // 오늘/내일 강좌 상태 갱신
            libraryData.forEach(d => {
                updateLectureState(d);
            });

            datasetMeta = payload.meta || datasetMeta;

            const newInsts = Array.isArray(payload.institutions)
                ? payload.institutions
                : fetchedLectures.map(d => d.institution).filter(Boolean);

            // 새 도서관이 동적으로 추가될 수 있으므로 베이스라인에 누적 병합
            newInsts.forEach(inst => institutionNames.add(inst));

            // 사용자가 선택해놓은 도서관 옵션을 기억하고 Select 박스를 온전히 최신화
            const currentSelected = institutionSelect.value;
            populateInstitutionSelect();
            if (currentSelected && [...institutionNames].includes(currentSelected)) {
                institutionSelect.value = currentSelected;
            }

            // lastSync에는 브라우저 현재 시간을 저장하여 신선도를 정확히 표시
            saveCacheToLocalStorage(libraryData, datasetMeta, institutionNames, Date.now());

            // 사용자가 이미 검색 버튼을 눌렀거나, 도서관 필터가 선택되어 있는 경우 물 흐르듯 화면을 갱신
            if (searchDone || institutionSelect.value) {
                allData = getSearchBaseData();
                updateFilterButtons(getFilterCounts(allData));
                renderResults();
            } else {
                allData = getSearchBaseData();
            }

            showSyncBadge('✅ 전체 강좌 동기화 완료!', 'success');
            updateFreshnessBar();
        }
    } catch (err) {
        console.error('백그라운드 전체 동기화 실패:', err);
        showSyncBadge('⚠️ 전체 강좌 동기화 실패 (1단계 데이터 유지)', 'error');
    } finally {
        isBackgroundSyncing = false;
    }
}

// ── 검색 시작 ──
async function doSearch(trackSearch = true) {
    const keyword = searchInput.value.trim();
    if (isLoading) return;

    // 상태 초기화
    clearDateStateSilent();
    currentKeyword = keyword;
    allData = [];
    displayPage = 1;
    searchDone = true;
    currentFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');

    document.getElementById('searchBtn').disabled = true;

    try {
        await ensureLibraryDataLoaded();
        allData = getSearchBaseData();
    } catch (e) {
        const contentEl = document.getElementById('content');
        contentEl.innerHTML = `<div class="error-msg"><h3>데이터를 불러오지 못했습니다</h3><p>${escapeHtml(e.message)}</p></div>`;
        document.getElementById('searchBtn').disabled = false;
        return;
    }

    document.getElementById('searchBtn').disabled = false;

    updateFilterButtons(getFilterCounts(allData));
    if (trackSearch && keyword) {
        recordAnonymousSearch('lecture', keyword, allData.length);
    }

    if (allData.length === 0) {
        const contentEl = document.getElementById('content');
        if (isBackgroundSyncing) {
            // 백그라운드 전체 동기화가 진행 중일 때는 검색 결과 없음 대신 멋진 스피너와 로딩 상태 표시
            contentEl.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p style="margin-top: 1.5rem; color: #718096; font-size: 0.93rem; font-weight: 500; line-height: 1.6;">
                        🔄 전체 강좌 데이터를 실시간으로 가져오는 중입니다...<br>
                        <span style="font-size: 0.82rem; color: #a0aec0; font-weight: 400; margin-top: 0.5rem; display: inline-block;">
                            선택하신 도서관의 전체 강좌 목록을 빠르게 준비하고 있습니다. 잠시만 기다려 주세요!
                        </span>
                    </p>
                </div>`;
            return;
        }

        contentEl.innerHTML = `
            <div class="empty-state">
                <div class="icon">&#128533;</div>
                <h3>검색 결과가 없습니다</h3>
                <p>도서관 선택이나 검색어를 바꿔 보세요</p>
            </div>`;
        return;
    }

    renderResults();
}

// ── "다음" 버튼: 다음 12개 불러오기 ──
async function loadNextPage() {
    const filtered = getFilteredData();
    const maxPage = Math.ceil(filtered.length / CARDS_PER_PAGE);
    if (displayPage < maxPage) {
        displayPage++;
    }

    renderResults();
    window.scrollTo({ top: 300, behavior: 'smooth' });
}

// ── "전체" 버튼 ──
async function loadAll() {
    displayPage = 1;
    renderResults();
}

// ── 필터 ──
async function setFilter(filter, btn) {
    if (filter !== 'date') {
        clearDateStateSilent();
    }
    currentFilter = filter;
    displayPage = 1;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    renderResults();
}

function getStatusPriority(d) {
    const isCanceled = isCanceledLecture(d);
    if (isCanceled) return 6;
    if (d.isToday) return 0;
    if (d.isTomorrow) return 1;
    if (d.status === '접수중') return 2;
    if (d.status === '접수예정') return 3;
    if (d.status === '접수마감') return 4;
    if (d.status === '강좌종료') return 5;
    return 7;
}

function getFilteredData() {
    let data = [...allData];
    if (currentFilter === 'today') {
        data = data.filter(d => d.isToday && !isCanceledLecture(d));
    } else if (currentFilter === 'tomorrow') {
        data = data.filter(d => d.isTomorrow && !isCanceledLecture(d));
    } else if (currentFilter === 'date') {
        if (selectedDateObj) {
            data = data.filter(d => !isCanceledLecture(d) && (isLectureOnDate(d, selectedDateObj) || isApplyingOnDate(d, selectedDateObj)));
        } else {
            data = [];
        }
    } else if (currentFilter === '폐강') {
        data = data.filter(d => isCanceledLecture(d));
    } else if (currentFilter !== 'all') {
        data = data.filter(d => d.status === currentFilter && !isCanceledLecture(d));
    }
    data.sort((a, b) => {
        const prioA = getStatusPriority(a);
        const prioB = getStatusPriority(b);
        if (prioA !== prioB) {
            return prioA - prioB;
        }
        if (a.isToday || a.isTomorrow) {
            return (a.beginTime || '').localeCompare(b.beginTime || '');
        }
        return (b.beginDate || '').localeCompare(a.beginDate || '');
    });
    return data;
}

// ── 렌더링 ──
function renderResults() {
    const contentEl = document.getElementById('content');
    const filtered = getFilteredData();
    const totalFiltered = filtered.length;
    const totalPages = Math.ceil(totalFiltered / CARDS_PER_PAGE);
    const start = (displayPage - 1) * CARDS_PER_PAGE;
    const pageData = filtered.slice(start, start + CARDS_PER_PAGE);

    const hasNextPageData = displayPage < totalPages;

    const counts = getFilterCounts(allData);
    updateFilterButtons(counts);

    let html = `
        <div class="status-bar">
            <div class="result-count">
                <span class="count-segment total">전체 <strong>${allData.length}</strong>건 발견</span>
                ${currentFilter !== 'all' ? `
                    <span class="count-divider"></span>
                    <span class="count-segment filter">"${getFilterLabel(currentFilter)}" <strong>${totalFiltered}</strong>건</span>
                ` : ''}
                ${institutionSelect.value ? `
                    <span class="count-divider"></span>
                    <span class="count-segment inst">🏛️ ${escapeHtml(institutionSelect.value)}</span>
                ` : ''}
                ${currentKeyword ? `
                    <span class="count-divider"></span>
                    <span class="count-segment keyword">🔍 "${escapeHtml(currentKeyword)}"</span>
                ` : ''}
            </div>
            <div class="data-freshness-bar" id="dataFreshnessBar">
                <span>📊 <span id="freshnessText">데이터 확인 중...</span></span>
                <button class="freshness-refresh-btn" id="freshnessRefreshBtn" onclick="forceRefreshData()" title="최신 데이터를 서버에서 새로 불러옵니다">🔄 최신 데이터 불러오기</button>
            </div>
        </div>
        <div class="card-grid">`;

    pageData.forEach(d => {
        html += renderCard(d);
    });

    html += '</div>';

    // ── 하단: 페이지 번호 + 다음 + 전체 버튼 ──
    if (totalPages > 1) {
        html += '<div class="pagination">';

        // 현재 페이지가 속한 10개 단위 페이지 블록 계산
        const startP = Math.floor((displayPage - 1) / 10) * 10 + 1;
        const endP = Math.min(totalPages, startP + 9);

        // 이전 버튼: 현재 페이지 블록의 시작 번호가 1보다 클 때만 노출 (클릭 시 이전 블록의 마지막 페이지인 startP - 1로 스킵)
        if (startP > 1) {
            html += `<button class="page-btn btn-prev" onclick="goPage(${startP - 1})" title="이전 10페이지 단위로 이동">이전</button>`;
        }

        // 페이지 번호들: 현재 블록 범위(startP ~ endP)의 번호들만 노출
        for (let i = startP; i <= endP; i++) {
            html += `<button class="page-btn ${i === displayPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
        }

        // 다음 버튼: 현재 페이지 블록의 끝 번호보다 전체 페이지가 더 많을 때만 노출 (클릭 시 다음 블록의 첫 페이지인 endP + 1로 스킵)
        if (endP < totalPages) {
            html += `<button class="page-btn btn-next" onclick="goPage(${endP + 1})" title="다음 10페이지 단위로 이동">다음 ></button>`;
        }

        // 전체 버튼: 백그라운드 전체 로드가 완료되지 않았고 페이지가 10페이지를 초과할 때만 노출
        if (!searchDone && totalPages > 10) {
            html += `<button class="page-btn btn-all" onclick="loadAll()">전체</button>`;
        }

        html += '</div>';
    }

    contentEl.innerHTML = html;
    updateFreshnessBar();
}

function renderCard(d) {
    const isCanceled = isCanceledLecture(d);
    const isToday = d.isToday && !isCanceled;
    const isTomorrow = d.isTomorrow && !isCanceled;
    const cardClasses = ['card', `status-${isCanceled ? 'canceled' : getStatusClass(d.status)}`];
    const detailUrl = getSafeLectureDetailUrl(d.detailUrl);
    if (isCanceled) cardClasses.push('canceled-card');
    else if (isToday) cardClasses.push('today-card');
    else if (isTomorrow) cardClasses.push('tomorrow-card');

    const classYear = d.beginDate ? d.beginDate.substring(0, 4) : '';

    const formatApplyDateTime = (str) => {
        if (!str) return '';
        const cleanStr = String(str).replace(/:\d{2}$/, '').trim();
        // 접수의 년도가 강좌 시작 년도와 같다면 년도를 생략하여 "월-일 시:분" 포맷으로 노출
        if (classYear && (cleanStr.startsWith(classYear + '-') || cleanStr.startsWith(classYear + '.'))) {
            return cleanStr.substring(5);
        }
        return cleanStr;
    };

    let todayBadgeHtml = '';
    if (isToday) {
        const timeStatus = getTodayLectureTimeStatus(d);
        let subBadgeHtml = '';
        const badgeAttrs = `data-begin-time="${escapeAttr(d.beginTime || '')}" data-end-time="${escapeAttr(d.endTime || '')}"`;
        if (timeStatus === 'ongoing') {
            subBadgeHtml = `<span class="today-sub-badge ongoing" ${badgeAttrs}>⚡ 수업중</span>`;
        } else if (timeStatus === 'upcoming') {
            subBadgeHtml = `<span class="today-sub-badge upcoming" ${badgeAttrs}>⏰ 예정</span>`;
        } else if (timeStatus === 'completed') {
            subBadgeHtml = `<span class="today-sub-badge completed" ${badgeAttrs}>✓ 종료</span>`;
        }
        todayBadgeHtml = `
            <div class="today-badge-group">
                <span class="today-badge">오늘수업</span>
                ${subBadgeHtml}
            </div>
        `;
    }

    return `
        <div class="${cardClasses.join(' ')}">
            ${todayBadgeHtml}
            ${isTomorrow ? '<div class="tomorrow-badge">내일수업</div>' : ''}
            <div class="card-status ${isCanceled ? 'canceled' : getStatusClass(d.status)}">${isCanceled ? '폐강' : escapeHtml(d.status)}</div>
            <div class="card-institution-row">
                <a href="${escapeAttr(getInstitutionUrl(d.institution))}" target="_blank" rel="noopener noreferrer" class="card-institution" title="${escapeAttr(d.institution)} 홈페이지로 이동">
                    ${escapeHtml(d.institution)}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 10px; height: 10px; margin-left: 1px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                ${renderAssigneeButton(d)}
            </div>
            <div class="card-title">${escapeHtml(d.name)}</div>
            <div class="card-info">
                <div class="card-info-item">
                    <span class="label">기간</span>
                    <span>${escapeHtml(d.beginDate)} ~ ${escapeHtml(d.endDate)}</span>
                </div>
                <div class="card-info-item">
                    <span class="label">시간</span>
                    <span class="info-time">${escapeHtml(d.beginTime)} ~ ${escapeHtml(d.endTime)} (${escapeHtml(getDayNames(d.dayOfWeek))})</span>
                </div>
                <div class="card-info-item">
                    <span class="label">장소</span>
                    <span class="info-place">${escapeHtml(d.place)}</span>
                </div>
                ${d.applyBegin ? `<div class="card-info-item">
                    <span class="label">접수</span>
                    <span class="info-apply">${escapeHtml(formatApplyDateTime(d.applyBegin))} ~ ${escapeHtml(formatApplyDateTime(d.applyEnd))}</span>
                </div>` : ''}
            </div>
            <div class="card-tags">
                ${d.targetNm ? `<span class="tag tag-target">${escapeHtml(d.targetNm)}${d.targetDetail ? ' / ' + escapeHtml(d.targetDetail) : ''}</span>` : ''}
                <span class="tag ${d.price === 0 ? 'tag-free' : 'tag-paid'}">${escapeHtml(d.freeNm || (d.price === 0 ? '무료' : d.price.toLocaleString() + '원'))}</span>
                ${d.classNm ? `<span class="tag tag-class">${escapeHtml(d.classNm)}</span>` : ''}
            </div>
            <div class="card-footer">
                <div class="card-apply">
                    신청 <strong class="apply-count">${escapeHtml(d.applyUserNum)}</strong>/${escapeHtml(d.applyLimitNum)}명
                    ${parseInt(d.waitLimitNum) > 0 ? ` &middot; 대기 <strong class="wait-count">${escapeHtml(d.waitUserNum)}</strong>/${escapeHtml(d.waitLimitNum)}명` : ''}
                </div>
                ${detailUrl ? `<a class="card-link" href="${escapeAttr(detailUrl)}" target="_blank" rel="noopener noreferrer">상세보기</a>` : ''}
            </div>
        </div>`;
}

function goPage(page) {
    displayPage = page;
    renderResults();
    window.scrollTo({ top: 300, behavior: 'smooth' });
}

function getDayNames(dayStr) {
    const map = { '1': '월', '2': '화', '3': '수', '4': '목', '5': '금', '6': '토', '7': '일' };
    if (!dayStr) return '';
    return dayStr.split(',').map(d => map[d.trim()] || d.trim()).join(', ');
}

function getFilterLabel(filter) {
    if (filter === 'today') return '오늘수업';
    if (filter === 'tomorrow') return '내일수업';
    if (filter === 'date') {
        if (selectedDateObj) {
            const m = String(selectedDateObj.getUTCMonth() + 1).padStart(2, '0');
            const d = String(selectedDateObj.getUTCDate()).padStart(2, '0');
            return `${m}월 ${d}일 수업/접수`;
        }
        return '선택된 날짜';
    }
    return filter;
}

function populateInstitutionSelect() {
    const saved = localStorage.getItem('selectedInstitution');
    const selected = institutionSelect.value || saved;

    // "화성시문화관광재단 도서관사업팀"을 제외한 일반 도서관 목록 (가나다 순 정렬)
    const selectableNames = [...institutionNames]
        .filter(name => name.includes('도서관') && name !== '화성시문화관광재단 도서관사업팀')
        .sort((a, b) => a.localeCompare(b, 'ko'));

    const options = ['<option value="">전체 도서관</option>'];

    // 즐겨찾기 탭 추가
    if (myLibraryFavorite && myLibraryFavorite.length > 0) {
        const shortNames = myLibraryFavorite.map(name => name.replace('도서관', ''));
        const favText = `즐겨찾기 (${shortNames.join(' · ')})`;
        const favTitle = `즐겨찾기 (${shortNames.join(' · ')})`;
        options.push(`<option value="favorite" title="${escapeHtml(favTitle)}">⭐ ${escapeHtml(favText)}</option>`);
        options.push('<option disabled>────────────────────</option>');
    }

    selectableNames.forEach(name => {
        options.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    });

    // "화성시문화관광재단 도서관사업팀"이 institutionNames에 있을 때만 구분선 및 항목 추가
    const hasLibraryTeam = institutionNames.has('화성시문화관광재단 도서관사업팀');
    if (hasLibraryTeam) {
        options.push('<option disabled>────────────────────</option>');
        options.push(`<option value="화성시문화관광재단 도서관사업팀">화성시문화관광재단 도서관사업팀</option>`);
    }

    institutionSelect.innerHTML = options.join('');

    const allSelectable = [...selectableNames];
    if (hasLibraryTeam) {
        allSelectable.push('화성시문화관광재단 도서관사업팀');
    }
    if (myLibraryFavorite && myLibraryFavorite.length > 0) {
        allSelectable.push('favorite');
    }

    if (allSelectable.includes(selected)) {
        institutionSelect.value = selected;
    }
}

function isWholeSetLoan(d) {
    if (!d) return false;
    const blob = getSearchBlob(d);
    return blob.includes('전질 대출') || blob.includes('전질대출');
}

function getSearchBaseData() {
    const selectedInstitution = institutionSelect.value;
    const keyword = currentKeyword.toLowerCase();

    const isFavorite = selectedInstitution === 'favorite';

    return libraryData.filter(d => {
        if (isFavorite) {
            if (!myLibraryFavorite.includes(d.institution)) return false;
        } else {
            // 전체도서관 검색일 때는 "화성시문화관광재단 도서관사업팀" 강좌 제외
            if (!selectedInstitution && d.institution === '화성시문화관광재단 도서관사업팀') return false;
            if (selectedInstitution && d.institution !== selectedInstitution) return false;
        }

        // 전질 대출 / 전질대출 2차 방어
        if (isWholeSetLoan(d)) return false;

        if (!keyword) return true;
        return getSearchBlob(d).includes(keyword);
    });
}

function getSearchBlob(d) {
    if (!d) return '';
    // 검색에 유용한 실제 사용자 노출 텍스트 필드만 엄선하여 검색 뭉치(Blob)를 생성
    const searchableFields = [
        d.name,            // 강좌명
        d.targetNm,        // 대상명 (예: 초등, 성인)
        d.targetDetail,    // 대상 상세 (예: 1~3학년)
        d.place,           // 장소 (예: 배움터, 온라인)
        d.freeNm,          // 무료 여부 (예: 무료)
        d.institution,     // 도서관 기관명
        d.classNm,         // 강좌 분류명 (예: 인문학)
        d.status,          // 접수 상태 (예: 접수중, 폐강)
        d.receiptMethod,   // 접수 방법 (예: 인터넷)
        d.reference        // 비고/설명
    ];

    return searchableFields
        .filter(value => value !== null && value !== undefined)
        .map(value => String(value))
        .join(' ')
        .toLowerCase();
}

function isCanceledLecture(d) {
    if (!d) return false;
    return getSearchBlob(d).includes('폐강');
}

function getFilterCounts(data) {
    const counts = {
        all: data.length,
        today: 0,
        tomorrow: 0,
        '접수중': 0,
        '접수예정': 0,
        '접수마감': 0,
        '강좌종료': 0,
        '폐강': 0,
        date: 0,
    };
    data.forEach(d => {
        const isCanceled = isCanceledLecture(d);
        if (isCanceled) {
            counts['폐강']++;
            return;
        }

        if (d.isToday) counts.today++;
        if (d.isTomorrow) counts.tomorrow++;
        if (selectedDateObj && (isLectureOnDate(d, selectedDateObj) || isApplyingOnDate(d, selectedDateObj))) {
            counts.date++;
        }
        if (Object.prototype.hasOwnProperty.call(counts, d.status)) {
            counts[d.status]++;
        }
    });
    return counts;
}

function updateFilterButtons(counts) {
    const labels = {
        all: '전체',
        today: '오늘수업',
        tomorrow: '내일수업',
        '접수중': '접수중',
        '접수예정': '접수예정',
        '접수마감': '접수마감',
        '강좌종료': '강좌종료',
        '폐강': '폐강',
    };
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const filter = btn.dataset.filter;
        if (filter === 'date') {
            if (selectedDateObj) {
                const m = String(selectedDateObj.getUTCMonth() + 1).padStart(2, '0');
                const d = String(selectedDateObj.getUTCDate()).padStart(2, '0');
                btn.innerHTML = `📅 달력선택: ${m}.${d}(${counts.date || 0}) <span class="clear-date-btn" onclick="clearDateFilter(event)" title="선택 해제">✖</span>`;
            } else {
                btn.innerHTML = `📅 달력선택`;
            }
        } else {
            btn.textContent = `${labels[filter] || filter}(${counts[filter] || 0})`;
        }
    });
}

function getSearchSummary() {
    const parts = [];
    if (institutionSelect.value) parts.push(`기관: ${escapeHtml(institutionSelect.value)}`);
    if (currentKeyword) parts.push(`검색어: ${escapeHtml(currentKeyword)}`);
    return parts.length ? ` &middot; ${parts.join(' · ')}` : '';
}

async function initializeApp() {
    document.getElementById('searchBtn').disabled = true;
    try {
        // API 데이터가 완전히 채워지기 전, 저장된 도서관명이 있다면 Select 박스에 선 반영하여 로딩 UX 향상
        const savedInst = localStorage.getItem('selectedInstitution');
        if (savedInst) {
            let displayName = savedInst;
            let displayTitle = '';
            if (savedInst === 'favorite') {
                if (myLibraryFavorite && myLibraryFavorite.length > 0) {
                    const shortNames = myLibraryFavorite.map(name => name.replace('도서관', ''));
                    displayName = `⭐ 즐겨찾기 (${shortNames.join(' · ')})`;
                    displayTitle = `즐겨찾기 (${shortNames.join(' · ')})`;
                } else {
                    displayName = '⭐ 즐겨찾기';
                    displayTitle = '즐겨찾기';
                }
            }
            institutionSelect.innerHTML = `
                <option value="">전체 도서관</option>
                <option value="${escapeHtml(savedInst)}" title="${escapeHtml(displayTitle)}" selected>${escapeHtml(displayName)}</option>
            `;
        }

        await ensureLibraryDataLoaded();
        if (institutionSelect.value) {
            doSearch(false);
        } else {
            allData = getSearchBaseData();
            updateFilterButtons(getFilterCounts(allData));
            document.getElementById('content').innerHTML = `
                <div class="empty-state">
                    <div class="icon">&#128218;</div>
                    <h3>도서관을 선택하거나 검색어를 입력해 보세요</h3>
                    <p>강좌명, 대상, 장소, 무료 여부까지 한 번에 검색할 수 있습니다</p>
                </div>`;
        }
    } catch (e) {
        // ensureLibraryDataLoaded에서 오류 화면을 표시합니다.
    }
    document.getElementById('searchBtn').disabled = false;
}

function getStatusClass(status) {
    if (status === '접수중') return 'open';
    if (status === '접수예정') return 'upcoming';
    if (status === '접수마감') return 'closed';
    return 'ended';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getInstitutionUrl(name) {
    if (!name) return 'https://www.hscitylib.or.kr';

    const mapping = {
        '남양도서관': 'https://www.hscitylib.or.kr/nylib/',
        '병점도서관': 'https://www.hscitylib.or.kr/bjlib/',
        '봉담도서관': 'https://www.hscitylib.or.kr/bdlib/',
        '삼괴도서관': 'https://www.hscitylib.or.kr/sglib/',
        '송산도서관': 'https://www.hscitylib.or.kr/sslib/',
        '진안도서관': 'https://www.hscitylib.or.kr/jalib/',
        '태안도서관': 'https://www.hscitylib.or.kr/talib/',
        '정남도서관': 'https://www.hscitylib.or.kr/jnlib/index.do',
        '동탄복합문화센터도서관': 'https://www.hscitylib.or.kr/dtlib/',
        '화성동탄중앙도서관': 'https://www.hscitylib.or.kr/dtlib/',
        '노을빛도서관': 'https://www.hscitylib.or.kr/neblib/',
        '향남복합문화센터도서관': 'https://www.hscitylib.or.kr/hnlib/index.do',
        '두빛나래어린이도서관': 'https://www.hscitylib.or.kr/dbnarae/',
        '둥지나래어린이도서관': 'https://www.hscitylib.or.kr/djnarae/',
        '달빛나래어린이도서관': 'https://www.hscitylib.or.kr/mlnarae/index.do',
        '다원이음터도서관': 'https://www.hscitylib.or.kr/dwlib/',
        '동탄다원이음터도서관': 'https://www.hscitylib.or.kr/dwlib/',
        '서연이음터도서관': 'https://www.hscitylib.or.kr/sylib/',
        '동탄서연이음터도서관': 'https://www.hscitylib.or.kr/sylib/',
        '왕배푸른숲도서관': 'https://www.hscitylib.or.kr/wblib/',
        '동탄목동이음터도서관': 'https://www.hscitylib.or.kr/mdlib/',
        '목동이음터도서관': 'https://www.hscitylib.or.kr/mdlib/',
        '동탄중앙이음터도서관': 'https://www.hscitylib.or.kr/iutlib/index.do',
        '송린이음터도서관': 'https://www.hscitylib.or.kr/srlib/',
    };

    if (mapping[name]) return mapping[name];

    for (const key in mapping) {
        if (name.includes(key) || key.includes(name)) {
            return mapping[key];
        }
    }

    return 'https://www.hscitylib.or.kr';
}

function getSafeLectureDetailUrl(value) {
    if (!value) return '';
    try {
        const parsed = new URL(String(value), 'https://yeyak.hscity.go.kr');
        return parsed.protocol === 'https:' && parsed.hostname === 'yeyak.hscity.go.kr' ? parsed.href : '';
    } catch (_) {
        return '';
    }
}

initializeApp();

// ── 도서관 즐겨찾기 설정 모달 이벤트 핸들러 ──
function openFavoriteModal() {
    const modal = document.getElementById('groupModal');
    if (modal) {
        renderModalCheckboxGrid();
        modal.style.display = 'flex';
    }
}

function closeFavoriteModal() {
    const modal = document.getElementById('groupModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 도서관 즐겨찾기 개수 표시 배지 갱신
function updateFavoriteCountBadge() {
    const badge = document.getElementById('favoriteCountBadge');
    if (!badge) return;

    const count = document.querySelectorAll('.favorite-library-check:checked').length;
    if (count < 2) {
        badge.style.background = 'rgba(239, 68, 68, 0.12)';
        badge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        badge.style.color = '#f87171';
        badge.innerHTML = `⚠️ 현재 ${count}개 선택됨 (최소 2개 선택 필요)`;
    } else {
        badge.style.background = 'rgba(16, 185, 129, 0.12)';
        badge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        badge.style.color = '#34d399';
        badge.innerHTML = `✅ 현재 ${count}개 선택됨 (저장 가능)`;
    }
}

// 도서관 체크박스 리스트 생성 (현재 즐겨찾기 포함 여부에 따라 자동 체크)
function renderModalCheckboxGrid() {
    const grid = document.getElementById('modalLibraryCheckboxGrid');
    if (!grid) return;

    // selectableNames 추출
    const selectableNames = [...institutionNames]
        .filter(name => name.includes('도서관') && name !== '화성시문화관광재단 도서관사업팀')
        .sort((a, b) => a.localeCompare(b, 'ko'));

    grid.innerHTML = selectableNames.map(name => {
        const isChecked = myLibraryFavorite.includes(name) ? 'checked' : '';
        return `
            <label class="modal-checkbox-item">
                <input type="checkbox" value="${escapeHtml(name)}" class="favorite-library-check" ${isChecked} onchange="updateFavoriteCountBadge()">
                <span>${escapeHtml(name.replace('도서관', ''))}</span>
            </label>
        `;
    }).join('');

    // 초기 카운트 배지 상태 반영
    updateFavoriteCountBadge();
}

// 즐겨찾기 저장 및 반영
function saveFavoriteLibraries() {
    const checkedBoxes = document.querySelectorAll('.favorite-library-check:checked');
    if (checkedBoxes.length < 2) {
        alert('자주 이용하는 도서관을 2개 이상 선택해 주세요. (현재 ' + checkedBoxes.length + '개 선택됨)');
        return;
    }

    const selectedLibs = Array.from(checkedBoxes).map(cb => cb.value);

    myLibraryFavorite = selectedLibs;
    localStorage.setItem('myLibraryFavorite', JSON.stringify(myLibraryFavorite));

    // Select 박스 갱신
    populateInstitutionSelect();

    // 저장과 동시에 즐겨찾기 조회 탭으로 바로 이동하여 즉각 피드백 제공
    institutionSelect.value = 'favorite';
    localStorage.setItem('selectedInstitution', 'favorite');
    doSearch(false);

    closeFavoriteModal();
    alert('도서관 즐겨찾기가 정상적으로 저장되었습니다!');
}

// 즐겨찾기 전체 해제 및 데이터 삭제
function clearFavoriteLibraries() {
    if (!myLibraryFavorite || myLibraryFavorite.length === 0) {
        alert('등록된 즐겨찾기 도서관이 없습니다.');
        return;
    }

    if (!confirm('등록된 즐겨찾기 도서관을 모두 해제(삭제)하시겠습니까?')) {
        return;
    }

    // 모든 체크박스 해제 비주얼 반영
    const checkBoxes = document.querySelectorAll('.favorite-library-check');
    checkBoxes.forEach(cb => cb.checked = false);

    // 카운트 배지 비주얼 즉시 갱신
    updateFavoriteCountBadge();

    myLibraryFavorite = [];
    localStorage.removeItem('myLibraryFavorite');

    // 셀렉트 박스 갱신 (즐겨찾기 탭 자동 제거됨)
    populateInstitutionSelect();

    // 만약 현재 즐겨찾기 탭을 조회 중이었다면 '전체 도서관'으로 이동
    if (institutionSelect.value === 'favorite') {
        institutionSelect.value = '';
        localStorage.setItem('selectedInstitution', '');
        doSearch(false);
    }

    closeFavoriteModal();
    alert('즐겨찾기가 완전히 삭제되었습니다.');
}

// DOM 로드 완료 후 버튼에 이벤트 리스너 바인딩 (버그 원천 차단)
document.addEventListener('DOMContentLoaded', () => {
    const favoriteConfigBtn = document.getElementById('favoriteConfigBtn');
    if (favoriteConfigBtn) {
        favoriteConfigBtn.addEventListener('click', openFavoriteModal);
    }
});

// 즉시 바인딩도 병행 수행
const favoriteConfigBtn = document.getElementById('favoriteConfigBtn');
if (favoriteConfigBtn) {
    favoriteConfigBtn.addEventListener('click', openFavoriteModal);
}
