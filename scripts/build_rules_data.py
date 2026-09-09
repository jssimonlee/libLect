"""Build the browser-side library guidance/regulation search index.

Usage:
    python scripts/build_rules_data.py
    python scripts/build_rules_data.py --pdf C:\\path\\to\\rules.pdf

The generated rules-data.js is intentionally static. The production browser never
contacts an AI service and the lecture feature does not depend on this index.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import tempfile
import urllib.request
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "rules-data.js"
LIBRARY_SITES_DATA_PATH = ROOT / "library-sites-data.json"
GUIDE_URL = "https://www.hscitylib.or.kr/intro/menu/12714/contents/40271/contents.do"
SMART_LIBRARY_URL = "https://www.hscitylib.or.kr/intro/menu/10004/contents/40001/contents.do"
LIBROPIA_URL = "https://www.hscitylib.or.kr/intro/menu/10042/contents/40010/contents.do"
BOOKSTART_URL = "https://www.hscitylib.or.kr/intro/menu/12645/contents/40009/contents.do"
READING_50_PLUS_URL = "https://www.hscitylib.or.kr/nylib/menu/13270/contents/40267/contents.do"
DURUDURU_URL = "https://www.library.kr/ggl/custom/duruduru"
FIRST_LIBRARY_URL = "https://www.library.kr/ggl/custom/firstlib"
BOOK_SEA_URL = "https://books.nl.go.kr/nill/main/index.do"
BOOK_LINK_URL = "https://books.nl.go.kr/one/main/index.do"
BOOK_NARAE_URL = "https://cn.nld.go.kr/booknarae/useGuide.do"
REGULATION_PAGE_URL = "https://www.hscitylib.or.kr/intro/menu/12736/contents/40295/contents.do"
PDF_URL = (
    "https://www.hscitylib.or.kr/contents/fileDownload.do"
    "?fileSaveNm=20295.pdf&fileNm=%ED%99%94%EC%84%B1%EC%8B%9C%EB%A6%BD%EB%8F%84%EC%84%9C%EA%B4%80%20%EC%9A%B4%EC%98%81%EA%B7%9C%EC%A0%95.pdf"
)


def guide_entries(checked_on: str) -> list[dict]:
    common = {
        "sourceType": "guide",
        "sourceTitle": "화성시립도서관 도서관 이용안내",
        "url": GUIDE_URL,
        "version": f"{checked_on} 확인",
    }
    return [
        {
            **common,
            "id": "guide-closed-days",
            "section": "휴관안내",
            "title": "도서관별 정기 휴관일",
            "keywords": ["휴관", "정기휴관", "법정공휴일", "쉬는 날", "운영일"],
            "text": (
                "정기 휴관일과 법정공휴일(일요일 제외)은 휴관합니다.\n"
                "매월 첫 번째·세 번째 월요일: 병점, 봉담, 송산, 정남, 중앙이음터, 목동이음터, "
                "둥지나래어린이, 노을빛, 서연이음터, 달빛나래어린이도서관.\n"
                "매월 두 번째·네 번째 월요일: 화성동탄중앙, 남양, 태안, 삼괴, 진안, 왕배푸른숲, "
                "다원이음터, 송린이음터, 두빛나래어린이, 향남복합문화센터, 봉담와우도서관.\n"
                "매주 일·월요일: 샘내, 기아행복마루, 비봉, 늘봄이음터, 호연이음터작은도서관.\n"
                "매주 토·일요일: 양감, 마도, 팔탄, 봉담커피앤북, 서신, 가족만세센터작은도서관."
            ),
        },
        {
            **common,
            "id": "guide-membership",
            "section": "회원가입안내",
            "title": "회원가입 대상과 구비서류",
            "keywords": ["회원", "회원증", "가입", "신분증", "등본", "재직증명서", "재학증명서", "외국인"],
            "text": (
                "가입 대상은 경기도 거주자와, 타 지역 거주자 중 경기도 소재 직장 재직자 또는 학생입니다.\n"
                "만 14세 이상 경기도민은 신분증이 필요하며 기재사항이 미비하면 주민등록등본도 필요합니다. "
                "만 14세 미만은 법정대리인 신분증과 아동과의 관계·주소지를 증명할 서류가 필요합니다. "
                "경기도 소재 직장 재직자는 신분증과 재직증명서, 재학생은 신분증과 재학증명서가 필요합니다. "
                "주민등록등본 등 서류는 3개월 이내 발급본이어야 하며 캡처본이나 사진은 인정되지 않습니다."
            ),
        },
        {
            **common,
            "id": "guide-online-card",
            "section": "회원가입안내",
            "title": "온라인 회원증 발급",
            "keywords": ["온라인 회원증", "회원증 비밀번호", "생일", "내서재"],
            "text": (
                "홈페이지에서 온라인 회원가입 및 로그인 후 내서재의 나의 정보에서 온라인 회원증 발급을 선택하고 "
                "주민등록번호 인증을 진행합니다. 온라인 회원증 발급 시 대출 비밀번호 4자리는 본인의 생일로 자동 설정됩니다."
            ),
        },
        {
            **common,
            "id": "guide-loan",
            "section": "도서대출안내",
            "title": "대출 권수와 대출 기간",
            "keywords": ["대출", "권수", "기간", "연장", "예약도서", "DVD"],
            "text": (
                "1인당 1관 7권, 통합 42권까지 대출할 수 있습니다. 대출 기간은 14일이며 1회에 한해 7일 연장할 수 있지만 "
                "예약도서는 연장할 수 없습니다. DVD를 대출하는 도서관은 도서를 포함하여 1관당 7종까지 가능하며, "
                "대출카드는 본인만 사용할 수 있습니다."
            ),
        },
        {
            **common,
            "id": "guide-overdue",
            "section": "도서대출안내",
            "title": "연체 시 대출 정지",
            "keywords": ["연체", "미반납", "반납 지연", "대출 정지", "90일", "6개월"],
            "text": "연체일수만큼 대출이 정지됩니다. 90일 이상 연체한 경우에는 6개월 동안 대출이 정지됩니다.",
        },
        {
            **common,
            "id": "guide-lost-book",
            "section": "도서대출안내",
            "title": "도서 분실 시 변상",
            "keywords": ["분실", "훼손", "변상", "절판", "품절", "대체도서"],
            "text": "도서를 분실하면 동일한 도서를 구입하여 반납해야 합니다. 품절 또는 절판된 경우에는 도서관이 지정한 도서로 대체 변상합니다.",
        },
        {
            "sourceType": "guide",
            "sourceTitle": "화성시립도서관 스마트도서관 안내",
            "url": SMART_LIBRARY_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-smart-library",
            "section": "화성시립도서관 공통 서비스 · 무인도서관",
            "title": "스마트도서관 위치·시간·대출 안내",
            "keywords": [
                "스마트도서관", "무인도서관", "무인 대출반납", "동탄SRT역", "병점역",
                "3권", "14일", "운영시간", "도서검색", "회원증", "1544-6502",
            ],
            "text": (
                "스마트도서관은 도서관 방문이 어려운 이용자가 접근성이 높은 전철역에서 편리하게 책을 대출·반납하는 무인 시스템입니다.\n"
                "동탄SRT역 스마트도서관은 지하 4층에서 05:00~01:10 운영하고, 병점역 스마트도서관은 1호선 병점역 2층에서 05:00~00:10 운영합니다. "
                "역 운영시간에 따른 안내이므로 현장 사정에 따라 달라질 수 있습니다.\n"
                "화성시 시립도서관 회원이 1인 3권을 14일간 이용할 수 있습니다. "
                "기기에서 대출 버튼, 도서검색, 도서선택, 회원증 인식, 비밀번호 입력 순서로 대출하며 반납도 스마트도서관 기기에서 처리합니다.\n"
                "기기 장애 문의는 1544-6502, 기타 문의는 SRT동탄역 031-378-7344, 병점역 031-223-4764입니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "화성시립도서관 리브로피아(모바일) 안내",
            "url": LIBROPIA_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-libropia",
            "section": "화성시립도서관 공통 서비스 · 모바일 앱",
            "title": "리브로피아 설치·기능·문의 안내",
            "keywords": [
                "리브로피아", "리브로피아2.0", "모바일 도서관", "도서관 앱", "모바일회원증",
                "도서검색", "도서예약", "대출현황", "열람실 좌석현황", "전자책", "구글 플레이", "앱스토어",
            ],
            "text": (
                "리브로피아는 스마트폰에서 화성시립도서관 서비스를 이용할 수 있는 모바일 도서관 앱입니다. "
                "도서검색, 도서예약, 대출현황 조회, 열람실 좌석현황, 전자책 연계, 모바일회원증 기능을 제공합니다.\n"
                "안드로이드는 구글 플레이, 아이폰은 앱스토어에서 리브로피아를 설치합니다. "
                "상세 이용법은 공식 페이지의 리브로피아 2.0 매뉴얼에서 확인할 수 있습니다.\n"
                "이용 문의는 리브로피아 고객센터 02-2024-9999 내선 2번, 기타 문의는 각 도서관 사무실로 하면 됩니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "화성시립도서관 북스타트 안내",
            "url": BOOKSTART_URL,
            "version": f"{checked_on} 확인 · 2026년 안내",
            "id": "guide-bookstart-package",
            "section": "북스타트 · 책꾸러미",
            "title": "북스타트 대상·책꾸러미·방문 수령 안내",
            "keywords": [
                "북스타트", "북 스타트", "아기 책꾸러미", "영유아 책꾸러미", "그림책 꾸러미",
                "0~18개월", "19~35개월", "36개월", "주민등록등본", "어린이자료실",
            ],
            "text": (
                "북스타트는 화성시에 거주하는 취학 전 영유아에게 성장 단계에 맞는 그림책 꾸러미를 제공하는 사업입니다.\n"
                "신청은 연중 가능하며 꾸러미가 소진될 때까지 선착순으로 배부합니다. "
                "꾸러미에는 단계별 그림책 2권, 북스타트 가방, 가이드북, 아이성장보드가 들어가며 구성품은 달라질 수 있습니다.\n"
                "1단계는 0~18개월, 2단계는 19~35개월, 3단계는 36개월부터 취학 전까지입니다. "
                "1단계는 보호자의 도서관 대출회원증 또는 신분증으로 신청할 수 있고, 2·3단계는 아이 명의 도서관 회원가입이 필요합니다.\n"
                "화성시 거주 여부와 보호자·아이의 관계를 확인할 수 있는 3개월 이내 주민등록등본을 지참해 "
                "화성시 시립도서관 21개관 어린이자료실에서 신청서를 작성하고 수령합니다. "
                "아이 한 명당 각 단계별로 한 번만 받을 수 있으며 중복 수령은 불가합니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "화성시립도서관 북스타트 안내",
            "url": BOOKSTART_URL,
            "version": f"{checked_on} 확인 · 2026년 안내",
            "id": "guide-bookstart-delivery",
            "section": "북스타트 · 택배",
            "title": "2026 북스타트 1단계 책꾸러미 택배 신청",
            "keywords": [
                "북스타트 택배", "북스타트 배달", "책꾸러미 택배", "아기 책꾸러미 배송",
                "1단계", "0~18개월", "온라인 신청", "주민등록등본",
            ],
            "text": (
                "2026년 북스타트 책꾸러미 택배는 화성시 거주 0~18개월 영유아인 1단계를 대상으로 합니다. "
                "1차 신청은 마감되었고, 2차는 2026년 8월 31일 오전 10시부터 수량 소진 시까지 선착순 접수합니다.\n"
                "도서관 홈페이지에 로그인한 뒤 북스타트 택배 신청 메뉴에서 신청하고, 발급 3개월 이내 주민등록등본을 첨부합니다. "
                "접수된 꾸러미는 월 1회 순차 발송합니다. 방문 수령과 마찬가지로 단계별 중복 수령은 불가합니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "화성시립도서관 북스타트 안내",
            "url": BOOKSTART_URL,
            "version": f"{checked_on} 확인 · 2026년 안내",
            "id": "guide-bookstart-programs",
            "section": "북스타트 · 후속 프로그램",
            "title": "2026 북스타트 후속 프로그램 안내",
            "keywords": ["북스타트 프로그램", "북스타트 수업", "영유아 독서", "부모 교육", "육아 프로그램"],
            "text": (
                "북스타트 후속 프로그램은 영유아와 보호자가 함께 참여하는 책놀이·독서·육아 프로그램입니다. "
                "2026년 1기는 5~7월 11개관, 2기는 9~11월 10개관에서 운영하며 도서관별 일정과 내용은 달라질 수 있습니다. "
                "참여하려는 도서관 홈페이지의 문화행사 또는 강좌 공지를 확인해 신청해야 합니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "화성시립도서관 책 읽는 50+ 안내",
            "url": READING_50_PLUS_URL,
            "version": f"{checked_on} 확인 · 공식 페이지 내용은 2025년 기준",
            "id": "guide-reading-50plus",
            "section": "책 읽는 50+",
            "title": "책 읽는 50+ 대상·책꾸러미·신청 방법",
            "keywords": [
                "책 읽는 50+", "책읽는 50+", "책읽는50+", "50플러스", "오십플러스",
                "신중년 독서", "50세 이상", "책꾸러미", "독서 챌린지", "추천글",
            ],
            "text": (
                "책 읽는 50+는 50세 이상 화성시민의 독서 활동과 지역 독서 공동체 참여를 돕는 사업입니다.\n"
                "현재 공식 페이지에 게시된 내용은 2025년 사업 기준입니다. 대상은 1975년 12월 31일 이전 출생한 "
                "화성시 거주 50세 이상 시민이며, 이전에 꾸러미를 받은 사람은 제외됩니다. "
                "2025년 5월 7일부터 물품 소진 시까지 선착순으로 운영했습니다.\n"
                "꾸러미는 책 1권, 추천도서 목록과 독서집게, 접이식 가방으로 구성됩니다. "
                "도서관 회원가입과 대출회원증 발급 후 '내가 추천하는 이 책' 독서 챌린지 작성지를 제출하면 받을 수 있습니다. "
                "대출회원증과 나이·화성시 거주 여부를 확인할 수 있는 3개월 이내 주민등록등본이 필요하며 중복 수령은 불가합니다. "
                "2026년 모집 여부와 일정은 공식 페이지 또는 이용하려는 도서관의 새 공지를 확인해야 합니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "경기도서관 두루두루 안내",
            "url": DURUDURU_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-gyeonggi-duruduru",
            "section": "경기도서관 연계 · 무료 도서택배",
            "title": "두루두루 대상·신청·대출 안내",
            "keywords": [
                "두루두루", "두루 두루", "장애인 도서택배", "장애인 책배달", "무료 택배",
                "등록장애인", "장애인복지카드", "장애인 확인서", "월 5회", "5권", "14일",
            ],
            "text": (
                "두루두루는 경기도에 거주하는 등록장애인에게 거주 시·군 공공도서관의 책을 집으로 무료 배송하는 경기도서관 연계 서비스입니다.\n"
                "이용자는 현재 경기도민이면서 거주 시·군 공공도서관의 관외대출회원이어야 하며, "
                "장애인복지카드 또는 장애인 확인서로 등록장애인임을 확인해야 합니다.\n"
                "경기도서관에서 회원가입과 두루두루 서비스 신청을 하고 소속도서관을 선택한 뒤, "
                "소속도서관이 대상 서류를 확인하여 승인하면 온라인으로 도서를 신청할 수 있습니다. "
                "이후 제공도서관이 책을 발송하고 이용자는 홈페이지에서 반납을 접수합니다.\n"
                "택배 신청은 월 5회, 동시에 대출 가능한 최대 권수는 5권입니다. "
                "대출기간은 책이 집에 도착한 뒤부터 14일이며 배송기간은 포함하지 않습니다. 연장과 딸림자료는 제공도서관에 문의합니다.\n"
                "서류상 시·군, 실제 거주 시·군, 대출하려는 공공도서관의 시·군이 모두 같아야 합니다. "
                "홈페이지를 통하지 않고 개별 택배를 접수하거나 잘못된 주소·전화번호로 반송되면 이용자가 비용을 부담할 수 있습니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "경기도서관 내 생애 첫 도서관 안내",
            "url": FIRST_LIBRARY_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-gyeonggi-first-library",
            "section": "경기도서관 연계 · 무료 도서택배",
            "title": "내 생애 첫 도서관 대상·신청·대출 안내",
            "keywords": [
                "내 생애 첫 도서관", "내생애첫도서관", "내첫도", "임신부 도서택배", "임산부 책배달",
                "영유아 도서택배", "12개월 이하", "임신확인서", "산모수첩", "가족관계증명서", "월 2회", "5권", "14일",
            ],
            "text": (
                "내 생애 첫 도서관은 경기도의 임신부와 12개월 이하 영유아 가족에게 거주 시·군 공공도서관의 책을 집으로 무료 배송하는 경기도서관 연계 서비스입니다.\n"
                "이용자는 현재 경기도민이면서 거주 시·군 공공도서관의 관외대출회원이어야 합니다. "
                "임신부는 임신 개월 수 제한이 없고, 영유아는 12개월 이하 아이를 둔 가족 중 1명이 신청할 수 있습니다. "
                "임신부는 임신확인서 또는 산모수첩, 영유아 가족은 주민등록등본 또는 가족관계증명서가 필요합니다.\n"
                "경기도서관에서 회원가입과 내 생애 첫 도서관 서비스 신청을 하고 소속도서관을 선택한 뒤, "
                "소속도서관이 대상 서류를 확인하여 승인하면 온라인으로 도서를 신청할 수 있습니다. "
                "이후 제공도서관이 책을 발송하고 이용자는 홈페이지에서 반납을 접수합니다.\n"
                "택배 신청은 월 2회, 동시에 대출 가능한 최대 권수는 5권입니다. "
                "대출기간은 책이 집에 도착한 뒤부터 14일이며 배송기간은 포함하지 않습니다. 연장과 딸림자료는 제공도서관에 문의합니다.\n"
                "서류상 시·군, 실제 거주 시·군, 대출하려는 공공도서관의 시·군이 모두 같아야 합니다. "
                "홈페이지를 통하지 않고 개별 택배를 접수하거나 잘못된 주소·전화번호로 반송되면 이용자가 비용을 부담할 수 있습니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "국립중앙도서관 책바다 안내",
            "url": BOOK_SEA_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-national-book-sea",
            "section": "국립중앙도서관 연계 · 전국 상호대차",
            "title": "책바다 대상·신청·대출·비용 안내",
            "keywords": [
                "책바다", "국가상호대차", "전국 상호대차", "다른 지역 도서관 책", "타지역 도서관",
                "3권", "14일", "7일 연장", "5800원", "묶음배송", "소속도서관",
            ],
            "text": (
                "책바다는 가까운 도서관에 없는 자료를 전국 책바다 협약 도서관에서 빌려 소속도서관에서 대출·반납하는 "
                "국립중앙도서관의 전국 도서관자료 공동 활용 서비스입니다.\n"
                "책바다 참여 공공도서관과 국립중앙도서관 통합회원으로 가입한 뒤 소속도서관의 회원 승인을 받아야 합니다. "
                "책바다 홈페이지에서 자료를 신청하면 소속도서관 승인과 제공도서관 확정 후 결제 요청을 받으며, 48시간 안에 결제해야 합니다. "
                "자료가 도착하면 소속도서관에서 대출하고 같은 소속도서관에 반납합니다.\n"
                "한 사람당 3책 이하, 소속도서관 도착일부터 14일간 이용할 수 있습니다. 1회에 한해 7일 연장할 수 있으나 "
                "대학도서관 자료는 연장할 수 없고 연체료가 발생할 수 있습니다. 일반 자료 연체 시 연체일수만큼 책바다 이용이 제한됩니다.\n"
                "기본 비용은 5,800원이며 신용카드, 휴대폰, 실시간 계좌이체로 결제할 수 있습니다. "
                "지역별 지원금에 따라 실제 결제금액은 달라질 수 있습니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "국립중앙도서관 책이음 안내",
            "url": BOOK_LINK_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-national-book-link",
            "section": "국립중앙도서관 연계 · 통합이용증",
            "title": "책이음 가입·이용·대출한도 안내",
            "keywords": [
                "책이음", "책 이음", "책이음 이용증", "통합이용증", "통합회원증", "전국 도서관 회원증",
                "회원정보 반입", "모바일 이용증", "30권", "참여도서관",
            ],
            "text": (
                "책이음은 하나의 책이음 이용증으로 전국 책이음 참여 공공도서관을 별도 회원가입 없이 이용하는 국립중앙도서관 연계 서비스입니다. "
                "가입 대상은 모든 국민과 국내 거주 외국인입니다.\n"
                "처음 가입할 때는 참여도서관을 방문하여 신청서와 신분증으로 본인확인 후 이용증을 발급받거나, "
                "책이음 홈페이지에서 온라인 회원가입한 뒤 참여도서관을 방문하여 회원정보 반입을 요청합니다. "
                "기존 도서관 회원은 자관 회원증 또는 신분증을 가지고 책이음 회원 전환을 신청할 수 있습니다.\n"
                "다른 참여도서관을 처음 이용할 때는 안내데스크에 책이음 이용증을 제시하고 회원정보 반입을 완료해야 합니다. "
                "회원정보 반입 전에는 안내데스크와 자동화장비에서 대출 서비스를 이용할 수 없습니다.\n"
                "책이음 전체 대출한도는 1인당 30권이며, 개별 도서관의 대출 가능 권수와 기간은 해당 도서관 규정을 따릅니다. "
                "타관대출·타관반납은 일부 지역 서비스에서만 가능하므로 이용 도서관에 확인해야 합니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "국립장애인도서관 책나래 안내",
            "url": BOOK_NARAE_URL,
            "version": f"{checked_on} 확인",
            "id": "guide-national-book-narae",
            "section": "국립장애인도서관 연계 · 무료 도서택배",
            "title": "책나래 대상·가입·무료택배 안내",
            "keywords": [
                "책나래", "책 나래", "장애인 무료택배", "우체국 도서택배", "국립장애인도서관",
                "등록장애인", "국가유공상이자", "장기요양대상자", "장기요양인정서", "나의 도서관",
            ],
            "text": (
                "책나래는 도서관 방문이 어려운 장애인 등에게 도서관 자료를 우체국 택배로 집까지 무료 제공하는 국립장애인도서관 서비스입니다.\n"
                "대상은 보건복지부 등록장애인, 국가보훈부 등록 국가유공상이자, 국민건강보험공단 인정 장기요양대상자입니다. "
                "등록장애인은 통합회원 가입 중 장애인정보 사실 여부를 조회·인증하면 별도 증명서를 제출하지 않아도 됩니다. "
                "국가유공상이자는 관련 유공자증 또는 확인원, 장기요양대상자는 장기요양인정서를 운영도서관에서 확인받아야 합니다.\n"
                "먼저 거주지역의 책나래 운영도서관 회원으로 가입하고, 책나래 홈페이지 회원가입 후 '나의 도서관'을 등록합니다. "
                "소속도서관 담당자의 승인이 끝나면 홈페이지에서 자료를 검색해 대출·반납을 신청할 수 있습니다.\n"
                "일반도서, 비도서, 장애인 대체자료 등 제공도서관에서 관외대출 가능한 자료를 이용할 수 있으며, "
                "대출 권수와 기간은 자료를 제공하는 도서관의 관외대출 규정을 따릅니다. "
                "반납도 책나래 홈페이지에서 요청하면 우체국이 방문 수거합니다."
            ),
        },
        {
            "sourceType": "guide",
            "sourceTitle": "도서관 강좌 공통 안내",
            "url": "https://yeyak.hscity.go.kr/",
            "version": f"{checked_on} 등록",
            "id": "guide-library-class-application",
            "section": "강좌 신청 · 수강 유의사항",
            "title": "도서관 강좌 신청 방법과 수강 유의사항",
            "keywords": [
                "도서관 강좌", "문화강좌", "프로그램", "강좌 신청", "통합예약시스템",
                "수강생", "본인 아이디", "모집마감", "문자메시지", "주차", "대중교통",
                "당일 불참", "신청 불이익", "강사 사정", "내용 변경", "수업 사진", "홍보",
            ],
            "text": (
                "도서관 강좌는 화성특례시 통합예약시스템에서 신청합니다.\n"
                "1. 수강생 본인 아이디로 신청하여 주시길 바랍니다.\n"
                "2. 모집마감 후 관련내용을 문자메시지로 전송해드리오니 확인 부탁드립니다.\n"
                "3. 주차장이 혼잡하오니 가급적 대중교통 혹은 도보 이동을 부탁드립니다.\n"
                "4. 당일 불참 시 향후 다른 프로그램 신청에 불이익이 있을 수 있으니 신중한 신청 부탁드립니다.\n"
                "5. 강사 및 도서관 사정에 따라 세부 내용이 변경될 수 있습니다.\n"
                "6. 수업 진행 사진은 결과보고 및 도서관 홍보 목적으로 사용될 수 있습니다."
            ),
        },
    ]


def library_entries(checked_on: str) -> list[dict]:
    """Stable, library-specific guidance that is not covered by the common guide."""
    if LIBRARY_SITES_DATA_PATH.exists():
        records = json.loads(LIBRARY_SITES_DATA_PATH.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise ValueError(f"{LIBRARY_SITES_DATA_PATH.name} must contain a JSON array")
        return records

    version = f"{checked_on} 확인"
    dt_guide_url = "https://www.hscitylib.or.kr/dtlib/menu/10806/contents/40090/contents.do"
    dt_facility_url = "https://www.hscitylib.or.kr/dtlib/menu/10809/contents/40091/contents.do"
    dt_toy_url = "https://www.hscitylib.or.kr/dtlib/menu/10877/contents/40098/contents.do"
    dt_makebooks_url = "https://www.hscitylib.or.kr/dtlib/menu/12821/contents/40297/contents.do"
    dt_original_db_url = "https://www.hscitylib.or.kr/dtlib/menu/10857/contents/40256/contents.do"
    neblib_guide_url = "https://www.hscitylib.or.kr/neblib/menu/12378/contents/40234/contents.do"
    neblib_facility_url = "https://www.hscitylib.or.kr/neblib/menu/12381/contents/40235/contents.do"

    return [
        {
            "id": "dtlib-hours-contact",
            "sourceType": "guide",
            "sourceTitle": "화성동탄중앙도서관 이용안내",
            "section": "운영시간 · 휴관 · 연락처",
            "title": "화성동탄중앙도서관 운영시간과 휴관일",
            "keywords": ["동탄중앙", "화성동탄중앙", "운영시간", "이용시간", "휴관일", "전화번호", "주소"],
            "text": (
                "일반자료실·멀티미디어자료실·어린이/유아자료실은 평일 09:00~22:00, 주말 09:00~18:00 운영합니다. "
                "문화교실·제작실·다목적실은 평일과 주말 모두 09:00~18:00입니다. "
                "정기휴관일은 매월 두 번째·네 번째 월요일과 법정공휴일이며, 장서점검 등 특별한 사유로 임시휴관할 수 있습니다. "
                "주소는 경기도 화성시 동탄구 동탄중앙로 120입니다. 자료실 031-5189-5859, 사무실 031-5189-5873."
            ),
            "url": dt_guide_url,
            "version": version,
        },
        {
            "id": "dtlib-parking-print",
            "sourceType": "guide",
            "sourceTitle": "화성동탄중앙도서관 이용안내",
            "section": "주차 · 복사 · 출력",
            "title": "화성동탄중앙도서관 주차요금과 복사·출력 요금",
            "keywords": ["동탄중앙", "주차", "주차장", "주차요금", "복사", "복사기", "프린터", "출력", "인쇄", "멀티미디어자료실"],
            "text": (
                "주차는 최초 3시간 무료이며, 3시간을 초과하면 10분당 500원입니다. 일일권·월정기권은 없고, "
                "운영시간은 평일 09:00~22:00, 주말 09:00~18:00이며 휴관일에는 무료 개방합니다. "
                "멀티미디어자료실 복사는 A4 흑백 40원·컬러 300원, B4 흑백 50원·컬러 1,000원입니다. "
                "출력은 A4 흑백 50원·컬러 300원, B4 흑백 50원·컬러 1,000원입니다."
            ),
            "url": dt_guide_url,
            "version": version,
        },
        {
            "id": "dtlib-facilities",
            "sourceType": "guide",
            "sourceTitle": "화성동탄중앙도서관 시설현황",
            "section": "시설현황",
            "title": "화성동탄중앙도서관 층별 시설",
            "keywords": ["동탄중앙", "시설", "일반자료실", "멀티미디어자료실", "어린이자료실", "유아자료실", "문화교실", "제작실", "다목적실", "동화구연실", "수유실"],
            "text": (
                "1층에는 일반자료실과 멀티미디어자료실, 2층에는 어린이/유아자료실과 유아자료실 안 수유실, "
                "3층에는 문화교실·제작실·다목적실·동화구연실이 있습니다. 멀티미디어자료실에서는 인터넷 검색, "
                "문서편집, 스캔, 출력, 노트북 코너, 전자책과 VOD 서비스를 이용할 수 있습니다. 주차면은 79면입니다."
            ),
            "url": dt_facility_url,
            "version": version,
        },
        {
            "id": "dtlib-toy-library",
            "sourceType": "guide",
            "sourceTitle": "화성동탄중앙도서관 장난감도서관",
            "section": "장난감도서관",
            "title": "장난감도서관 가입·대여·반납 안내",
            "keywords": ["동탄중앙", "장난감도서관", "장난감", "회원신청", "연회비", "대여", "반납", "연체", "점심시간"],
            "text": (
                "18세 미만 아동의 보호자인 화성시민 또는 화성시 직장인 중 화성시립도서관 회원이 신청할 수 있으며, 1세대당 1명만 가입할 수 있습니다. "
                "일반회원 연회비는 2만원이고 이용기간은 1년이며, 면제회원은 연회비 없이 1년간 이용합니다. "
                "1세대당 한 번에 장난감 2개를 14일간 빌릴 수 있고 연장은 불가합니다. 연체일수만큼 대여가 제한되며, "
                "1년 동안 누적 연체 30일 이상이면 회원자격이 상실됩니다. 운영시간은 화~금 10:00~19:00, 토요일 09:00~18:00이고 "
                "13:00~14:00에는 운영하지 않습니다. 일·월요일과 법정공휴일은 쉽니다. 문의 031-5189-5870."
            ),
            "url": dt_toy_url,
            "version": version,
        },
        {
            "id": "dtlib-makebooks",
            "sourceType": "guide",
            "sourceTitle": "화성동탄중앙도서관 메이크북스",
            "section": "메이크북스",
            "title": "메이크북스 예약과 이용 안내",
            "keywords": ["동탄중앙", "메이크북스", "메이크 북스", "메이커스페이스", "독립출판", "책 만들기", "예약", "제본"],
            "text": (
                "메이크북스는 독립출판물 제작과 창작·편집 작업을 지원하는 공간입니다. 도서관 회원증을 가진 중학생 이상이 홈페이지에서 좌석을 예약한 뒤 이용할 수 있습니다. "
                "화~금요일 09:00~17:00 운영하고 토~월요일은 장비 점검일입니다. 오전 09:00~12:00와 오후 14:00~17:00, 하루 2회차로 운영하며 총 5명까지 이용합니다. "
                "매월 1일 10시부터 당월 예약이 가능하고, 개인당 월 최대 4회이며 이용일 1일 전까지 신청해야 합니다. 현장예약과 시간 연장은 불가합니다. "
                "무단 불참 3회 누적 시 1개월간 신청이 제한됩니다. 제본 재료와 개인 저장장치는 이용자가 준비해야 합니다. 문의 031-5189-5874."
            ),
            "url": dt_makebooks_url,
            "version": version,
        },
        {
            "id": "dtlib-original-db",
            "sourceType": "guide",
            "sourceTitle": "화성동탄중앙도서관 원문DB 서비스",
            "section": "디지털자료 · 원문DB",
            "title": "국회·국립중앙도서관 원문DB 이용",
            "keywords": ["동탄중앙", "원문DB", "원문 DB", "국회전자도서관", "국립중앙도서관", "학위논문", "학술잡지", "정부간행물"],
            "text": (
                "국회전자도서관과 국립중앙도서관의 원문DB는 화성동탄중앙도서관 멀티미디어자료실의 지정 PC에서 이용합니다. "
                "단행본 목록, 사회과학 분야 석·박사 학위논문, 국내외 학술잡지, 세미나 자료, 정부간행물과 비도서자료 목록 등을 제공합니다. "
                "문의는 1층 안내데스크 031-5189-5860입니다."
            ),
            "url": dt_original_db_url,
            "version": version,
        },
        {
            "id": "neblib-hours-contact",
            "sourceType": "guide",
            "sourceTitle": "노을빛도서관 이용안내",
            "section": "운영시간 · 휴관 · 연락처",
            "title": "노을빛도서관 운영시간과 휴관일",
            "keywords": ["노을빛", "운영시간", "이용시간", "휴관일", "전화번호", "주소", "새봄초등학교"],
            "text": (
                "자료실은 평일 09:30~22:00, 주말 09:30~18:00 운영합니다. 정기휴관일은 매월 첫 번째·세 번째 월요일과 법정공휴일입니다. "
                "재단 창립기념일과 장서점검 등 특별한 사유로 관장이 정하는 날에는 임시휴관할 수 있습니다. "
                "주소는 경기도 화성시 병점구 병점노을로 19 새봄초등학교 2층이며, 전화번호는 031-226-3301입니다."
            ),
            "url": neblib_guide_url,
            "version": version,
        },
        {
            "id": "neblib-facilities",
            "sourceType": "guide",
            "sourceTitle": "노을빛도서관 시설현황",
            "section": "시설현황 · 이용약자 편의시설",
            "title": "노을빛도서관 시설과 편의시설",
            "keywords": ["노을빛", "시설", "자료실", "문화교실", "휴게실", "장애인", "장애인 열람석", "장애인 화장실", "수유실"],
            "text": (
                "노을빛도서관은 새봄초등학교 2층에 있으며 자료실 1실, 문화교실 1실, 휴게실 1실, 사무실 1실로 구성됩니다. "
                "자료실에는 좌석 76석과 무인도서대출반납기 3대가 있고, 문화교실은 30석과 빔프로젝터를 갖추고 있습니다. "
                "자료실 안에 장애인 열람석 1석이 있고 남·여 장애인용 화장실이 각 1개 있습니다. 별도 수유실은 없습니다."
            ),
            "url": neblib_facility_url,
            "version": version,
        },
    ]


def law_entries() -> list[dict]:
    laws = [
        ("도서관법", "https://www.law.go.kr/법령/도서관법"),
        ("도서관법 시행령", "https://www.law.go.kr/법령/도서관법시행령"),
        ("도서관법 시행규칙", "https://www.law.go.kr/법령/도서관법시행규칙"),
        ("독서문화진흥법", "https://www.law.go.kr/법령/독서문화진흥법"),
        ("독서문화진흥법 시행령", "https://www.law.go.kr/법령/독서문화진흥법시행령"),
        ("화성시립도서관의 설립 및 운영에 관한 조례", "https://www.law.go.kr/자치법규/화성시립도서관의설립및운영에관한조례"),
        ("화성시 시립도서관 관리운영 조례 시행규칙", "https://www.law.go.kr/자치법규/화성시시립도서관관리운영조례시행규칙"),
        ("화성시 작은도서관 설치 및 운영 지원에 관한 조례", "https://www.law.go.kr/자치법규/화성시작은도서관설치및운영지원에관한조례"),
        ("화성시 독서문화진흥 조례", "https://www.law.go.kr/자치법규/화성시독서문화진흥조례"),
        ("화성시 지역서점 활성화 및 지원에 관한 조례", "https://www.law.go.kr/자치법규/화성시지역서점활성화및지원에관한조례"),
        ("화성시 도서관 도서 기증 활성화 조례", "https://www.law.go.kr/자치법규/화성시도서관도서기증활성화조례"),
    ]
    return [
        {
            "id": f"law-{index}",
            "sourceType": "law",
            "sourceTitle": "국가법령정보센터",
            "section": "도서관 관련 법령",
            "title": title,
            "text": f"{title}의 최신 원문은 국가법령정보센터에서 확인할 수 있습니다.",
            "keywords": ["법", "법령", "조례", "시행령", "시행규칙", title],
            "url": url,
            "version": "최신 원문 링크",
        }
        for index, (title, url) in enumerate(laws, start=1)
    ]


def section_for_article(number: int) -> str:
    if number <= 6:
        return "제1장 도서관 운영 · 제1절 총칙"
    if number <= 13:
        return "제1장 도서관 운영 · 제2절 회원관리"
    if number <= 25:
        return "제1장 도서관 운영 · 제3절 자료이용"
    if number <= 35:
        return "제1장 도서관 운영 · 제4절 문화교실 운영"
    if number <= 44:
        return "제2장 자료 수집 및 관리"
    return "제3장 시설 운영 및 관리"


def clean_page(text: str) -> str:
    text = text.replace("\x00", "").replace("\u2024", "·")
    text = re.sub(r"(?m)^\s*화성시 시립도서관\s+운영규정\s*$", "", text)
    text = re.sub(r"(?m)^\s*-\s*\d+\s*-\s*$", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def regulation_entries(pdf_path: Path) -> list[dict]:
    reader = PdfReader(str(pdf_path))
    page_texts = [clean_page(page.extract_text(extraction_mode="layout") or "") for page in reader.pages]
    heading_re = re.compile(r"(?m)^제\s*(\d+)\s*조(?:의\s*(\d+))?\s*\(([^)\n]+)\)")
    entries: list[dict] = []
    current: dict | None = None

    # Cover and contents occupy the first two physical PDF pages.
    for page_index, page_text in enumerate(page_texts[2:], start=3):
        matches = list(heading_re.finditer(page_text))
        if current and matches:
            continuation = page_text[: matches[0].start()].strip()
            if continuation:
                current["text"] += "\n" + continuation

        for match_index, match in enumerate(matches):
            if current:
                entries.append(current)
            end = matches[match_index + 1].start() if match_index + 1 < len(matches) else len(page_text)
            article_number = int(match.group(1))
            sub_number = match.group(2)
            article_label = f"제{article_number}조" + (f"의{sub_number}" if sub_number else "")
            subject = match.group(3).strip()
            body = page_text[match.start() : end].strip()
            current = {
                "id": f"regulation-{page_index}-{match_index}-{article_number}-{sub_number or 0}",
                "sourceType": "regulation",
                "sourceTitle": "화성시 시립도서관 운영규정",
                "section": section_for_article(article_number),
                "title": f"{article_label} ({subject})",
                "text": body,
                "keywords": [article_label, subject],
                "url": PDF_URL,
                "page": page_index,
                "version": "2022. 4. 1.",
            }

        if current and not matches:
            appendix_match = re.search(r"\[별(?:표|지)\s*제?\s*\d+[^\]]*\]", page_text)
            if appendix_match:
                entries.append(current)
                current = None
            elif page_text:
                current["text"] += "\n" + page_text

    if current:
        entries.append(current)

    # Index every appendix/form page separately so staff can find operational forms.
    for page_index, page_text in enumerate(page_texts[2:], start=3):
        appendix = re.search(r"\[별(표|지)\s*제?\s*(\d+)[^\]]*\]\s*([^\n]{0,80})", page_text)
        if not appendix:
            continue
        kind = appendix.group(1)
        number = appendix.group(2)
        trailing_title = appendix.group(3).strip(" -")
        title = f"별{kind} 제{number}호"
        if trailing_title:
            title += f" {trailing_title}"
        entries.append(
            {
                "id": f"regulation-appendix-{page_index}-{kind}-{number}",
                "sourceType": "regulation",
                "sourceTitle": "화성시 시립도서관 운영규정",
                "section": "별표·별지 서식",
                "title": title,
                "text": page_text,
                "keywords": [f"별{kind}", "서식", trailing_title],
                "url": PDF_URL,
                "page": page_index,
                "version": "2022. 4. 1.",
            }
        )

    return entries


def download_pdf() -> Path:
    request = urllib.request.Request(PDF_URL, headers={"User-Agent": "libLect-rules-index/1.0"})
    temp_path = Path(tempfile.gettempdir()) / "hscitylib-rules.pdf"
    with urllib.request.urlopen(request, timeout=60) as response:
        temp_path.write_bytes(response.read())
    return temp_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, help="Use an already downloaded official regulation PDF")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    pdf_path = args.pdf.resolve() if args.pdf else download_pdf()
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)

    # Build the display date directly because Windows strftime does not support '-' modifiers.
    today = dt.date.today()
    checked_on = f"{today.year}. {today.month}. {today.day}."
    entries = guide_entries(checked_on) + library_entries(checked_on) + regulation_entries(pdf_path) + law_entries()
    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    output = (
        "// Generated by scripts/build_rules_data.py. Do not edit this file by hand.\n"
        f"// Official source page: {REGULATION_PAGE_URL}\n"
        f"window.LIBRARY_KNOWLEDGE = {payload};\n"
    )
    args.output.write_text(output, encoding="utf-8")
    print(f"Wrote {len(entries)} search entries to {args.output}")


if __name__ == "__main__":
    main()
