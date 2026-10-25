#!/usr/bin/env python3
"""Build the browser-ready IELTS List data from the supplied PDF."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader


LIST_PATTERN = re.compile(r"雅思词汇真经\s+List\s+(\d+)")
ENTRY_PATTERN = re.compile(r"(?m)^(\d{1,3})\s*(?=[A-Za-z])")
IPA_PATTERN = re.compile(r"\[([^\]]+)\]")
EXPECTED_COUNTS = [237, 126, 165, 74, 398, 118, 79, 65, 171, 151, 111, 167, 126, 133, 147, 169, 114, 211, 120, 259, 412, 52]
PDF_NOISE_PATTERN = re.compile(r"核遭险运重(?:4)?[果壳](?:外)?")


def clean_text(value: str) -> str:
    value = PDF_NOISE_PATTERN.sub("", unicodedata.normalize("NFKC", value))
    value = re.sub(r"炭炭背单词\s*-\s*\d+\s*$", "", value, flags=re.S)
    return re.sub(r"\s+", " ", value).strip()


def is_pronunciation(value: str) -> bool:
    return bool(re.search(r"[ˈˌːɑɒæəɪʊʌθðŋʃʒʧʤɜɔɛɡǝ]", value))


def parse_entry(number: int, block: str, list_number: int) -> dict[str, object]:
    lines = [line.strip() for line in block.splitlines() if line.strip()]
    if not lines:
        raise ValueError(f"List {list_number} item {number} is empty")

    word = clean_text(lines[0])
    body = "\n".join(lines[1:])
    ipa = ""
    match = next((candidate for candidate in IPA_PATTERN.finditer(body) if is_pronunciation(candidate.group(1)) or re.match(r"\s*[；;]?\s*(?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|aux|phr)\.", body[candidate.end():], re.I)), None)
    if match:
        ipa = clean_text(match.group(1))
        body = body[:match.start()] + " " + body[match.end():]
    meaning = clean_text(body)
    if not word or not meaning:
        raise ValueError(f"List {list_number} item {number} is missing word or meaning")
    return {
        "id": f"ielts-{list_number}-{number}",
        "order": number,
        "word": word,
        "ipa": ipa,
        "meaning": meaning,
    }


def extract(pdf_path: Path) -> dict[str, object]:
    by_list: dict[int, list[dict[str, object]]] = defaultdict(list)
    for page in PdfReader(str(pdf_path)).pages:
        text = page.extract_text() or ""
        list_match = LIST_PATTERN.search(text)
        if not list_match:
            continue
        list_number = int(list_match.group(1))
        entries = list(ENTRY_PATTERN.finditer(text))
        for index, entry_match in enumerate(entries):
            next_start = entries[index + 1].start() if index + 1 < len(entries) else len(text)
            by_list[list_number].append(
                parse_entry(int(entry_match.group(1)), text[entry_match.end():next_start], list_number)
            )

    lists = []
    for list_number, expected_count in enumerate(EXPECTED_COUNTS, start=1):
        items = by_list[list_number]
        actual_orders = [item["order"] for item in items]
        expected_orders = list(range(1, expected_count + 1))
        if actual_orders != expected_orders:
            raise ValueError(
                f"List {list_number} must contain orders 1-{expected_count}; got {actual_orders[:3]}...{actual_orders[-3:]}"
            )
        lists.append({"id": f"list-{list_number}", "name": f"List {list_number}", "items": items})

    return {
        "version": "ielts-vocabulary-20261014-v4",
        "title": "雅思词汇真经",
        "lists": lists,
    }


def apply_standard_meanings(data: dict[str, object], index_path: Path) -> None:
    html = index_path.read_text(encoding="utf-8")
    marker = "const BUILTIN_WORDS=/*__BUILTIN_WORDS_START__*/"
    start = html.index(marker) + len(marker)
    end = html.index("/*__BUILTIN_WORDS_END__*/", start)
    rows = json.loads(html[start:end].strip().removesuffix(";"))
    meanings = {word.casefold(): meaning for word, meaning in rows}

    for word_list in data["lists"]:
        for item in word_list["items"]:
            item["meaning"] = meanings[item["word"].casefold()]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_ielts_vocabulary.py INPUT.pdf OUTPUT.js")
    output_path = Path(sys.argv[2])
    data = extract(Path(sys.argv[1]))
    apply_standard_meanings(data, output_path.parent / "index.html")
    output_path.write_text(
        "window.IELTS_WORD_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
