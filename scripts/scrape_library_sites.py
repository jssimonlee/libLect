"""Create a static search corpus from every official Hwaseong library site.

The production browser never runs this scraper. Run it only when the official
library guidance changes, then rebuild rules-data.js with build_rules_data.py.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "library-sites-data.json"
STATE_PATH = ROOT / "library-update-state.json"
BASE_URL = "https://www.hscitylib.or.kr"

LIBRARIES = [
    ("dtlib", "화성동탄중앙도서관"),
    ("nylib", "남양도서관"),
    ("talib", "태안도서관"),
    ("sglib", "삼괴도서관"),
    ("bjlib", "병점도서관"),
    ("bdlib", "봉담도서관"),
    ("sslib", "송산도서관"),
    ("jnlib", "정남도서관"),
    ("jalib", "진안도서관"),
    ("wblib", "왕배푸른숲도서관"),
    ("neblib", "노을빛도서관"),
    ("hnlib", "향남복합문화센터도서관"),
    ("bwlib", "봉담와우도서관"),
    ("iutlib", "중앙이음터도서관"),
    ("dwlib", "다원이음터도서관"),
    ("srlib", "송린이음터도서관"),
    ("mdlib", "목동이음터도서관"),
    ("sylib", "서연이음터도서관"),
    ("dbnarae", "두빛나래어린이도서관"),
    ("djnarae", "둥지나래어린이도서관"),
    ("mlnarae", "달빛나래어린이도서관"),
    ("small", "화성시 공립작은도서관"),
]

# These pages are shared system-wide and are represented by curated common
# entries in build_rules_data.py or by the regulation corpus. A library-specific
# copy would only add the same content under every library name.
COMMON_CONTENT_IDS = {
    "40002",  # 희망도서
    "40003",  # 책이음
    "40004",  # 책바다
    "40005",  # 책나래
    "40006",  # 두루두루
    "40007",  # 내 생애 첫 도서관
    "40008",  # 상호대차
    "40009",  # 북스타트
    "40012",  # 사서에게 물어보세요
    "40013",  # 오디오북
    "40014",  # 전자책
    "40015",  # DBpia
    "40020",  # 이용약관
    "40021",  # 이메일 수집 거부
    "40267",  # 책읽는 50+
    "40268",  # 사립작은도서관 책배달
    "40270",  # 전자잡지
    "40292",  # 작은도서관 영상정보처리기기 방침
    "40293",  # 작은도서관 영상정보처리기기 방침
    "40294",  # 작은도서관 영상정보처리기기 방침
    "40295",  # 운영규정
    "40319",  # 신간도서 미리보기
    "40332",  # 도서관 SNS
}

CORE_LABELS = (
    "도서관소개",
    "도서관이용안내",
    "시설현황",
    "찾아오시는길",
    "이용시간",
    "휴관",
)

EXCLUDED_LABELS = (
    "운영규정",
    "개인정보",
    "영상정보처리기기",
    "이용약관",
    "이메일무단수집거부",
    "사이트맵",
    "홈페이지 이용안내",
    "한 책 읽기",
)


def fetch(url: str, retries: int = 3) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; libLect guidance index updater)",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.0 + attempt)
    raise RuntimeError("unreachable")


def clean_text(value: str) -> str:
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    boilerplate = {
        "페이지타이틀",
        "SNS 공유하기",
        "트위터",
        "페이스북",
        "네이버 블로그",
        "현재화면 프린트",
        "탭메뉴",
    }
    lines = [line for line in value.splitlines() if line.strip() not in boilerplate]
    return "\n".join(lines).strip()


def write_json_atomic(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def content_id(url: str) -> str:
    match = re.search(r"/contents/(\d+)/contents\.do", url)
    return match.group(1) if match else ""


def discover_pages(code: str, name: str) -> list[dict]:
    index_url = f"{BASE_URL}/{code}/index.do"
    soup = BeautifulSoup(fetch(index_url), "html.parser")
    grouped: dict[str, set[str]] = defaultdict(set)

    menu = soup.select_one("#gnb") or soup
    for anchor in menu.select("a[href]"):
        href = anchor.get("href", "").strip()
        if "/contents/" not in href or not href.endswith("contents.do"):
            continue
        absolute = urllib.parse.urljoin(index_url, href)
        if urllib.parse.urlparse(absolute).netloc != "www.hscitylib.or.kr":
            continue
        label = clean_text(anchor.get_text(" ", strip=True))
        if label:
            grouped[absolute].add(label)

    selected = []
    for url, labels in grouped.items():
        joined = " · ".join(sorted(labels, key=len, reverse=True))
        cid = content_id(url)
        is_core = any(token in joined for token in CORE_LABELS)
        is_excluded = any(token in joined for token in EXCLUDED_LABELS)
        is_library_specific = cid and cid not in COMMON_CONTENT_IDS
        if not is_excluded and (is_core or is_library_specific):
            selected.append({"libraryCode": code, "libraryName": name, "url": url, "labels": sorted(labels)})

    return selected


def extract_page(page: dict, checked_on: str) -> dict | None:
    soup = BeautifulSoup(fetch(page["url"]), "html.parser")
    content = soup.select_one("#contentcore .contents") or soup.select_one("#contentcore")
    if content is None:
        return None

    for element in content.select("script, style, noscript, form, nav, .location, .snsGroup, .tabMenu"):
        element.decompose()

    image_alts = [clean_text(image.get("alt", "")) for image in content.select("img[alt]")]
    image_alts = [alt for alt in image_alts if alt and len(alt) > 2]
    text = clean_text(content.get_text("\n", strip=True))
    if image_alts:
        text = clean_text(text + "\n" + "\n".join(dict.fromkeys(image_alts)))
    if len(text) < 25:
        return None

    heading = soup.select_one("#contentcore h3") or soup.select_one("#contentcore h2")
    page_title = clean_text(heading.get_text(" ", strip=True)) if heading else ""
    if page_title in {"페이지타이틀", "페이지 타이틀"}:
        page_title = ""
    labels = page["labels"]
    descriptive_labels = [label for label in labels if label not in {"안내", "이용안내", "신청안내"}]
    section = " · ".join(descriptive_labels or labels)
    title = page_title or section
    if title in {"이용안내", "안내", "시설현황"} and section:
        title = section

    cid = content_id(page["url"])
    return {
        "id": f"site-{page['libraryCode']}-{cid}",
        "sourceType": "guide",
        "sourceTitle": f"{page['libraryName']} 공식 홈페이지",
        "section": section or "도서관별 안내",
        "title": f"{page['libraryName']} {title}",
        "text": text,
        "keywords": list(dict.fromkeys([page["libraryName"], page["libraryCode"], *labels, page_title])),
        "url": page["url"],
        "version": f"{checked_on} 확인",
    }


def extract_small_libraries(checked_on: str) -> list[dict]:
    """Extract all 11 public small libraries exposed as cards on /small/."""
    index_url = f"{BASE_URL}/small/index.do"
    soup = BeautifulSoup(fetch(index_url), "html.parser")
    cards = soup.select(".smallLibInfo .libInfoArea")
    records = []
    for card in cards:
        heading = card.select_one("h5")
        detail_link = card.select_one("a.btnView[href]")
        if heading is None or detail_link is None:
            continue
        name = clean_text(heading.get_text(" ", strip=True)).replace(" 커피앤북", "커피앤북")
        url = urllib.parse.urljoin(index_url, detail_link.get("href", ""))
        detail_soup = BeautifulSoup(fetch(url), "html.parser")
        content = detail_soup.select_one("#contentcore .contents") or detail_soup.select_one("#contentcore")
        if content is None:
            content = card
        for element in content.select("script, style, noscript, form, nav, .location, .snsGroup"):
            element.decompose()
        text = clean_text(content.get_text("\n", strip=True))
        if len(text) < 25:
            text = clean_text(card.get_text("\n", strip=True))
        idx_match = re.search(r"smallLibIdx=(\d+)", url)
        idx = idx_match.group(1) if idx_match else str(len(records) + 1)
        records.append(
            {
                "id": f"site-small-library-{idx}",
                "sourceType": "guide",
                "sourceTitle": f"{name} 공식 홈페이지",
                "section": "운영시간 · 휴관 · 시설 · 교통",
                "title": f"{name} 이용안내",
                "text": text,
                "keywords": [name, name.replace(" ", ""), "공립작은도서관", "작은도서관", "이용시간", "휴관일", "시설", "교통"],
                "url": url,
                "version": f"{checked_on} 확인",
            }
        )
    if len(records) != 11:
        raise RuntimeError(f"Expected 11 public small libraries, extracted {len(records)}")
    return records


def validate(records: list[dict]) -> None:
    required_fields = {"id", "sourceType", "sourceTitle", "section", "title", "text", "keywords", "url", "version"}
    malformed = [record.get("id", "<missing id>") for record in records if not required_fields.issubset(record)]
    if malformed:
        raise RuntimeError("Malformed search records: " + ", ".join(malformed[:10]))
    covered = {record["keywords"][0] for record in records}
    missing = [
        name for code, name in LIBRARIES
        if not (code == "small" and any(record["id"].startswith("site-small-library-") for record in records))
        and name not in covered
    ]
    if missing:
        raise RuntimeError("No searchable guidance extracted for: " + ", ".join(missing))
    duplicate_ids = [item for item, count in __import__("collections").Counter(r["id"] for r in records).items() if count > 1]
    if duplicate_ids:
        raise RuntimeError("Duplicate record IDs: " + ", ".join(duplicate_ids))


def belongs_to_library(record: dict, code: str) -> bool:
    if code == "small":
        return record.get("id", "").startswith("site-small-library-")
    return record.get("id", "").startswith(f"site-{code}-")


def choose_oldest_library(state_path: Path) -> tuple[str, str]:
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    order = {code: index for index, (code, _) in enumerate(LIBRARIES)}
    return min(LIBRARIES, key=lambda item: (state.get(item[0], ""), order[item[0]]))


def refresh_one_library(code: str, name: str, checked_on: str, workers: int, delay: float) -> list[dict]:
    if code == "small":
        return extract_small_libraries(checked_on)

    discovered = discover_pages(code, name)
    records = []
    if workers <= 1:
        for index, page in enumerate(discovered):
            if index and delay:
                time.sleep(delay)
            record = extract_page(page, checked_on)
            if record:
                records.append(record)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            jobs = [pool.submit(extract_page, page, checked_on) for page in discovered]
            for job in concurrent.futures.as_completed(jobs):
                record = job.result()
                if record:
                    records.append(record)
    return records


def merge_refreshed_library(
    existing: list[dict], code: str, name: str, checked_on: str, workers: int, delay: float
) -> tuple[list[dict], int, int]:
    previous = [record for record in existing if belongs_to_library(record, code)]
    refreshed = refresh_one_library(code, name, checked_on, workers, delay)
    if not refreshed:
        raise RuntimeError(f"No records extracted for {name}; existing data was preserved")
    if previous:
        ratio = len(refreshed) / len(previous)
        if ratio < 0.6 or ratio > 1.7:
            raise RuntimeError(
                f"Unsafe record-count change for {name}: {len(previous)} -> {len(refreshed)}; existing data was preserved"
            )

    previous_by_id = {record["id"]: record for record in previous}
    refreshed_by_id = {record["id"]: record for record in refreshed}
    for record_id in previous_by_id.keys() & refreshed_by_id.keys():
        old_length = max(1, len(previous_by_id[record_id].get("text", "")))
        new_length = len(refreshed_by_id[record_id].get("text", ""))
        length_ratio = new_length / old_length
        if length_ratio < 0.5 or length_ratio > 2.0:
            raise RuntimeError(
                f"Unsafe content-size change in {record_id}: {old_length} -> {new_length}; existing data was preserved"
            )

    # A temporarily missing menu or failed detail page must not silently delete
    # searchable guidance. New pages are added automatically; missing old pages
    # remain at their previous version for later review.
    preserved_missing = [record for record in previous if record["id"] not in refreshed_by_id]
    merged = [record for record in existing if not belongs_to_library(record, code)] + refreshed + preserved_missing
    merged.sort(key=lambda record: (record["keywords"][0], record["section"], record["id"]))
    validate(merged)
    return merged, len(previous), len(refreshed)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--workers", type=int, default=6)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--library-code", choices=[code for code, _ in LIBRARIES])
    selection.add_argument("--one", action="store_true", help="Refresh only the least recently checked library site")
    selection.add_argument(
        "--all-sequential",
        action="store_true",
        help="Refresh every library site in order and write only after every site succeeds",
    )
    parser.add_argument("--state", type=Path, default=STATE_PATH)
    parser.add_argument("--delay", type=float, default=0.0, help="Seconds between page requests in single-worker mode")
    args = parser.parse_args()
    checked_on = dt.date.today().strftime("%Y. %-m. %-d.") if __import__("os").name != "nt" else f"{dt.date.today().year}. {dt.date.today().month}. {dt.date.today().day}."

    if args.all_sequential:
        if not args.output.exists():
            raise FileNotFoundError(f"Sequential update requires existing {args.output}")
        records = json.loads(args.output.read_text(encoding="utf-8"))
        state = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {}
        completed: list[tuple[str, int, int]] = []
        for index, (code, name) in enumerate(LIBRARIES):
            if index and args.delay:
                time.sleep(args.delay)
            print(f"[{index + 1}/{len(LIBRARIES)}] Refreshing {name}...", flush=True)
            records, previous_count, refreshed_count = merge_refreshed_library(
                records, code, name, checked_on, args.workers, args.delay
            )
            state[code] = dt.date.today().isoformat()
            completed.append((name, previous_count, refreshed_count))

        # The live files are replaced atomically only after every site passes.
        write_json_atomic(args.output, records)
        write_json_atomic(args.state, state)
        for name, previous_count, refreshed_count in completed:
            print(f"Refreshed {name}: {previous_count} -> {refreshed_count} entries")
        return

    if args.one or args.library_code:
        if not args.output.exists():
            raise FileNotFoundError(f"Incremental update requires existing {args.output}")
        code, name = choose_oldest_library(args.state) if args.one else next(
            item for item in LIBRARIES if item[0] == args.library_code
        )
        existing = json.loads(args.output.read_text(encoding="utf-8"))
        records, previous_count, refreshed_count = merge_refreshed_library(
            existing, code, name, checked_on, args.workers, args.delay
        )
        state = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {}
        state[code] = dt.date.today().isoformat()
        write_json_atomic(args.output, records)
        write_json_atomic(args.state, state)
        print(f"Refreshed {name}: {previous_count} -> {refreshed_count} entries")
        return

    discovered: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = [pool.submit(discover_pages, code, name) for code, name in LIBRARIES]
        for job in concurrent.futures.as_completed(jobs):
            discovered.extend(job.result())

    records: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = [pool.submit(extract_page, page, checked_on) for page in discovered]
        for job in concurrent.futures.as_completed(jobs):
            record = job.result()
            if record:
                records.append(record)

    records.extend(extract_small_libraries(checked_on))

    records.sort(key=lambda record: (record["keywords"][0], record["section"], record["id"]))
    validate(records)
    write_json_atomic(args.output, records)

    per_library = defaultdict(int)
    for record in records:
        per_library[record["keywords"][0]] += 1
    print(f"Wrote {len(records)} library-site entries to {args.output}")
    for _, name in LIBRARIES:
        print(f"  {name}: {per_library[name]}")


if __name__ == "__main__":
    main()
