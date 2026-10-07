#!/usr/bin/env python3
"""Number and check wiki body headings. Python 3.9+, standard library only.

check: report numbering/structure and recognizable heading-link errors.
apply --input unnumbered: retain the entire original title and add numbers.
apply --input numbered: replace an existing leading number; also number new
unnumbered headings. Use --literal-line for a new title beginning with a number.

Only standalone ATX headings are managed. Frontmatter, fenced/indented code,
quoted/list-contained headings, raw HTML, and inline-code examples are preserved.
Monthly logs are excluded by folder or top-level `type: log` metadata.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib.parse import unquote, urlsplit


ATX = re.compile(r"^( {0,3})(#{1,6})(?:[ \t]+(.*)|$)")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
NUMBER = re.compile(r"^(\(\d+\)|\d+(?:\.\d+)*[.)]?)[ \t]+(.*)$")
LOG_TYPE = re.compile(r'''^type:[ \t]*(?:log|"log"|'log')[ \t]*(?:#.*)?$''')
IGNORED_DIRS = {"node_modules", "__pycache__"}
HTML_BLOCK = re.compile(r"^ {0,3}</?(?:div|table|section|article|details|summary|p|ul|ol|li|blockquote|h[1-6])(?:[ >]|$)", re.I)


@dataclass
class Issue:
    line: int
    code: str
    message: str


@dataclass
class Heading:
    line: int
    level: int
    text: str
    indent: str
    suffix: str
    ending: str
    chain: tuple[str, ...]


@dataclass
class Document:
    path: Path
    text: str
    lines: list[str]
    headings: list[Heading]
    issues: list[Issue]
    visible: list[tuple[int, str]]
    is_log: bool
    front_end: int


def parse(path: Path, text: str, root: Path) -> Document:
    lines = text.splitlines(keepends=True)
    issues: list[Issue] = []
    start = 0
    if lines and lines[0].lstrip("\ufeff").strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() in {"---", "..."}:
                start = index + 1
                break
        else:
            issues.append(Issue(1, "FRONTMATTER", "프론트매터의 끝을 찾을 수 없습니다."))
            start = len(lines)
    relative = path.relative_to(root).parts
    is_log = relative[:2] == ("00_System", "02_Logs") or any(
        LOG_TYPE.fullmatch(line.rstrip("\r\n")) for line in lines[1:start - 1]
    )
    headings: list[Heading] = []
    visible: list[tuple[int, str]] = []
    ancestors: dict[int, str] = {}
    fence: tuple[str, int, int] | None = None
    comment = False
    raw_tag = ""
    html = False
    list_block = False
    previous_text = False
    for index in range(start, len(lines)):
        full = lines[index]
        line = full.rstrip("\r\n")
        ending = full[len(line):]
        if fence:
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) + "{" + str(fence[1]) + r",}[ \t]*", line):
                fence = None
            continue
        found = FENCE.match(line)
        if found and not (found[1][0] == "`" and "`" in found[2]):
            fence = (found[1][0], len(found[1]), index + 1)
            previous_text = False
            continue
        if comment:
            if "-->" in line:
                comment = False
            continue
        if line.lstrip().startswith("<!--"):
            comment = "-->" not in line
            previous_text = False
            continue
        if raw_tag:
            if re.search(r"</" + raw_tag + r"\s*>", line, re.I):
                raw_tag = ""
            continue
        tag = re.match(r"^ {0,3}<(pre|script|style|textarea)(?:[ >]|$)", line, re.I)
        if tag:
            raw_tag = tag[1].lower() if not re.search(r"</" + tag[1] + r"\s*>", line, re.I) else ""
            previous_text = False
            continue
        if html:
            if not line.strip():
                html = False
            continue
        if HTML_BLOCK.match(line):
            html = True
            previous_text = False
            continue
        if re.match(r"^ {0,3}>|^ {0,3}(?:[-+*]|\d+[.)])[ \t]+", line):
            list_block = not line.lstrip().startswith(">")
            previous_text = False
            continue
        if line.startswith("    ") or line.startswith("\t"):
            continue
        if list_block and line.startswith(" "):
            continue
        if line and not line.startswith(" "):
            list_block = False
        match = ATX.fullmatch(line)
        if match:
            level = len(match[2])
            content = match[3] or ""
            closing = re.search(r"[ \t]+#+[ \t]*$", content)
            if re.fullmatch(r"#+[ \t]*", content):
                text_content, suffix = "", " " + content
            elif closing:
                text_content, suffix = content[:closing.start()].strip(), content[closing.start():]
            else:
                text_content = content.strip()
                suffix = content[len(content.rstrip(" \t")):]
            if not text_content:
                issues.append(Issue(index + 1, "EMPTY", "헤더 제목이 비어 있습니다."))
            if level > 5:
                issues.append(Issue(index + 1, "LEVEL", "H6은 현재 번호 규칙의 적용 범위 밖입니다."))
            if level > max(ancestors, default=0) + 1:
                issues.append(Issue(index + 1, "HIERARCHY", "부모 헤더 없이 계층을 건너뛰었습니다. 작성자 또는 Codex가 구조를 검토해야 합니다."))
            ancestors = {key: value for key, value in ancestors.items() if key < level}
            ancestors[level] = text_content
            headings.append(Heading(index + 1, level, text_content, match[1], suffix, ending, tuple(ancestors.values())))
            previous_text = False
        else:
            if previous_text and re.fullmatch(r" {0,3}(?:=+|-+)[ \t]*", line):
                issues.append(Issue(index + 1, "SETEXT", "밑줄형 헤더는 자동 수정하지 않습니다. # 형식의 헤더로 정리하세요."))
            previous_text = bool(line.strip()) and not line.lstrip().startswith("|")
        visible.append((index + 1, line))
    if fence:
        issues.append(Issue(fence[2], "FENCE", "코드 블록이 닫히지 않았습니다. 뒤의 본문을 번호 대상에서 제외했습니다."))
    if comment or raw_tag:
        issues.append(Issue(len(lines), "HTML", "주석 또는 원시 HTML 블록이 닫히지 않았습니다."))
    return Document(path, text, lines, headings, issues, visible, is_log, start)


def numbered(doc: Document, mode: str, literal_lines: set[int] | None = None) -> tuple[str, list[Issue]]:
    if doc.is_log:
        return doc.text, []
    issues = list(doc.issues)
    if issues:
        return doc.text, issues
    lines = doc.lines.copy()
    counts = [0] * 5
    for heading in doc.headings:
        level = heading.level
        counts[level - 1] += 1
        counts[level:] = [0] * (5 - level)
        prefix = ".".join(map(str, counts[:level])) if level <= 3 else (
            str(counts[3]) + ")" if level == 4 else "(" + str(counts[4]) + ")"
        )
        title = heading.text
        if mode == "numbered" and heading.line not in (literal_lines or set()):
            existing = NUMBER.fullmatch(title)
            if existing:
                title = existing[2]
        desired = prefix + " " + title
        if mode == "check":
            existing = NUMBER.fullmatch(heading.text)
            if not existing or existing[1] != prefix or not heading.text.startswith(prefix + " "):
                issues.append(Issue(heading.line, "NUMBER", "필요한 번호: " + prefix))
        else:
            lines[heading.line - 1] = heading.indent + "#" * level + " " + desired + heading.suffix + heading.ending
    return "".join(lines), issues


def remove_inline_code(line: str) -> str:
    # Keep offsets stable; backtick runs must have equal lengths to close a span.
    chars = list(line)
    runs = list(re.finditer(r"`+", line))
    cursor = 0
    while cursor < len(runs):
        opener = runs[cursor]
        end = next((n for n in range(cursor + 1, len(runs)) if len(runs[n][0]) == len(opener[0])), None)
        if end is None:
            cursor += 1
            continue
        chars[opener.start():runs[end].end()] = " " * (runs[end].end() - opener.start())
        cursor = end + 1
    return "".join(chars)


def links(line: str) -> list[str]:
    line = remove_inline_code(line)
    result = [match[1].split("|", 1)[0] for match in re.finditer(r"(?<!\\)\[\[([^\]\r\n]+)\]\]", line)]
    for match in re.finditer(r"(?<![\\\[])\[[^\]\r\n]*\]\(", line):
        start = match.end()
        depth = 1
        escaped = False
        angle = False
        for end in range(start, len(line)):
            char = line[end]
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == "<":
                angle = True
            elif char == ">" and angle:
                angle = False
            elif angle:
                continue
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    raw = line[start:end].strip()
                    if raw.startswith("<") and ">" in raw:
                        result.append(raw[1:raw.index(">")])
                    elif raw:
                        result.append(raw.split()[0])
                    break
    return result


def slug(text: str) -> str:
    text = text.casefold().replace(" ", "-")
    return "".join(char for char in text if char.isalnum() or char in {"-", "_"})


def matching_headings(doc: Document, fragment: str) -> list[Heading]:
    pieces = fragment.split("#")
    def same(left: str, right: str) -> bool:
        return left == right or slug(left) == right
    return [heading for heading in doc.headings if len(heading.chain) >= len(pieces) and all(
        same(actual, requested) for actual, requested in zip(heading.chain[-len(pieces):], pieces)
    )]


def target_path(target: str, source: Path, root: Path, catalog: dict[Path, Document]) -> Path | None:
    if not target:
        return source
    target = target.replace("\\", "/")
    if not target.lower().endswith(".md"):
        target += ".md"
    candidates = [(source.parent / target).resolve(), (root / target.lstrip("/")).resolve()]
    found = list(dict.fromkeys(path for path in candidates if path in catalog))
    if len(found) == 1:
        return found[0]
    if "/" not in target:
        by_name = [path for path in catalog if path.name == target]
        if len(by_name) == 1:
            return by_name[0]
    return None


def link_issues(catalog: dict[Path, Document], sources: set[Path], root: Path, affected: set[Path] | None = None) -> list[tuple[Path, Issue]]:
    errors: list[tuple[Path, Issue]] = []
    for source in sources:
        doc = catalog[source]
        for line_number, line in doc.visible:
            for destination in links(line):
                if "#" not in destination or urlsplit(destination).scheme or destination.startswith("//"):
                    continue
                file_part, fragment = destination.split("#", 1)
                fragment = unquote(fragment)
                if not fragment or fragment.startswith("^"):
                    continue  # Obsidian block IDs are independent of heading numbering.
                resolved = target_path(unquote(file_part), source, root, catalog)
                if resolved is None:
                    if affected is None:
                        errors.append((source, Issue(line_number, "LINK_TARGET", "헤더 링크의 파일 경로가 없거나 중복됩니다: " + destination)))
                    continue
                if affected is not None and resolved not in affected:
                    continue
                count = len(matching_headings(catalog[resolved], fragment))
                if count != 1:
                    errors.append((source, Issue(line_number, "HEADING_LINK", "헤더 링크 대상이 없거나 중복됩니다: " + destination)))
    return errors


def update_date(text: str, front_end: int, date: str) -> str:
    lines = text.splitlines(keepends=True)
    for index in range(1, front_end - 1):
        if re.match(r"^updated:[ \t]*", lines[index]):
            lines[index] = re.sub(r'^(updated:[ \t]*)[^\r\n]*', lambda match: match[1] + '"' + date + '"', lines[index])
            break
    return "".join(lines)


def atomic_write(path: Path, text: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".heading_numbers_", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(text.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(path.stat().st_mode))
        if hasattr(os, "listxattr"):
            for name in os.listxattr(path):
                os.setxattr(temporary, name, os.getxattr(path, name))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def wiki_files(root: Path) -> list[Path]:
    return sorted(path.resolve() for path in root.rglob("*.md") if not any(
        part.startswith(".") or part in IGNORED_DIRS for part in path.relative_to(root).parts
    ) and not path.is_symlink())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="위키 본문 헤더 번호 적용·검증. 월별 로그는 번호 검사에서 제외합니다.")
    parser.add_argument("command", choices=("check", "apply"))
    parser.add_argument("paths", nargs="*", help="위키 루트 기준 문서 경로. check는 생략 시 전체 문서 검사.")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="위키 최상위 폴더. 기본값: 현재 폴더.")
    parser.add_argument("--input", choices=("unnumbered", "numbered"), help="apply 필수: 첫 번호 부여 또는 기존 번호 재계산.")
    parser.add_argument("--literal-line", type=int, action="append", default=[], help="numbered 모드에서도 제목 전체를 보존할 행. 단일 파일에만 사용.")
    parser.add_argument("--date", help="번호 수정 시 updated에 기록할 YYYY-MM-DD. 기본값: 한국 기준 오늘.")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if not root.is_dir():
        parser.error("--root는 존재하는 위키 폴더여야 합니다.")
    if args.command == "apply" and (not args.paths or not args.input):
        parser.error("apply에는 대상 파일과 --input을 지정하세요.")
    if args.literal_line and (args.input != "numbered" or len(args.paths) != 1):
        parser.error("--literal-line은 단일 파일의 --input numbered에서만 사용하세요.")
    date = args.date or datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            raise ValueError
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        parser.error("--date 형식은 YYYY-MM-DD입니다.")
    try:
        catalog = {path: parse(path, path.read_bytes().decode("utf-8"), root) for path in wiki_files(root)}
        selected: set[Path] = set()
        for item in args.paths or ["."]:
            path = (root / item).resolve()
            if not path.is_relative_to(root):
                parser.error("위키 폴더 바깥의 파일은 처리하지 않습니다.")
            if path.is_dir() and args.command == "check":
                selected.update(candidate for candidate in catalog if candidate.is_relative_to(path))
            elif path in catalog:
                selected.add(path)
            else:
                parser.error("대상은 위키 내부의 Markdown 파일이어야 합니다. apply는 파일만 지정하세요: " + item)
        if not selected:
            parser.error("검사할 Markdown 파일이 없습니다.")
        plans: dict[Path, str] = {}
        errors: list[tuple[Path, Issue]] = []
        for path in sorted(selected):
            doc = catalog[path]
            if doc.is_log:
                print("SKIP_LOG " + str(path.relative_to(root)))
                continue
            proposed, issues = numbered(doc, args.input if args.command == "apply" else "check", set(args.literal_line))
            errors.extend((path, issue) for issue in issues)
            if not issues and proposed != doc.text:
                proposed = update_date(proposed, doc.front_end, date) if doc.front_end else proposed
                plans[path] = proposed
        if not errors:
            prospective = dict(catalog)
            for path, proposed in plans.items():
                prospective[path] = parse(path, proposed, root)
            errors.extend(link_issues(prospective, set(catalog) if args.command == "apply" else selected, root, set(plans) if args.command == "apply" else None))
        for path, issue in errors:
            print(f"ERROR {path.relative_to(root)}:{issue.line} [{issue.code}] {issue.message}")
        if errors:
            if args.command == "apply":
                for path, proposed in plans.items():
                    new_doc = parse(path, proposed, root)
                    for old, new in zip(catalog[path].headings, new_doc.headings):
                        if old.text != new.text:
                            print(f"HEADING {path.relative_to(root)}:{old.line} {old.text} -> {new.text}")
                print("헤더·계층 또는 관련 링크 오류로 파일을 수정하지 않았습니다. 링크 대상은 적용 후 번호를 기준으로 점검합니다.")
            return 1
        if args.command == "apply":
            for path, proposed in plans.items():
                atomic_write(path, proposed)
                print("UPDATED " + str(path.relative_to(root)))
            print(f"OK: {len(plans)}개 파일 갱신. 정보 분류와 계층의 의미는 별도 검토하세요.")
        else:
            print(f"OK: {sum(not catalog[path].is_log for path in selected)}개 문서의 헤더 번호·계층·인식 가능한 헤더 링크 검사 완료.")
        return 0
    except (OSError, UnicodeError, ValueError) as error:
        print("실행 오류: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
