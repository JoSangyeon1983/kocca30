"""Validate final images and embedded review data without writing result files."""
import argparse
import hashlib
import json
import re
import struct
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

START = "<!-- image-work-record:start -->"
END = "<!-- image-work-record:end -->"


def inside(root, value):
    path = (root / value).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"Path outside wiki: {value}")
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def read_record(path):
    body = path.read_text(encoding="utf-8-sig")
    if body.count(START) != 1 or body.count(END) != 1:
        raise ValueError("Exactly one embedded image work record is required")
    block = body.split(START, 1)[1].split(END, 1)[0]
    match = re.fullmatch(r"\s*```json\s*\n(.*?)\n```\s*", block, re.S)
    if not match:
        raise ValueError("Embedded record must contain one JSON code block")
    data = json.loads(match.group(1))
    if data.get("schema") != "image-work-record-v1":
        raise ValueError("Unsupported image record schema")
    return body, data


def validate(record_path, root, include_archive=False):
    body, data = read_record(record_path)
    prompts = dict(re.findall(
        r"<!-- image-prompt:([a-z0-9-]+) -->\s*\n```text\s*\n(.*?)\n```",
        body, re.S))
    prompt_markers = re.findall(r"<!-- image-prompt:([a-z0-9-]+) -->", body)
    if len(prompt_markers) != len(prompts) or any(not text.strip() for text in prompts.values()):
        raise ValueError("Duplicate, missing or empty prompt block")
    paths = []
    labels = 0
    for item in data["images"]:
        path = inside(root, item["path"])
        raw = path.read_bytes()
        if raw[:8] != b"\x89PNG\r\n\x1a\n" or len(raw) < 24:
            raise ValueError(f"Invalid PNG: {path.name}")
        width, height = struct.unpack(">II", raw[16:24])
        spec = item["spec"]
        if (width, height, len(raw)) != (spec["width"], spec["height"], spec["bytes"]):
            raise ValueError(f"PNG specification mismatch: {path.name}")
        if hashlib.sha256(raw).hexdigest().upper() != spec["sha256"].upper():
            raise ValueError(f"PNG hash mismatch: {path.name}")
        expected = Counter({x["text"]: x["count"] for x in item["expected_labels"]})
        if len(expected) != len(item["expected_labels"]) or any(n < 1 for n in expected.values()):
            raise ValueError(f"Invalid expected label list: {path.name}")
        actual = Counter(x["text"] for x in item["transcription"])
        if actual != expected or any(x.get("uncertain", True) for x in item["transcription"]):
            raise ValueError(f"Label text, count or certainty mismatch: {path.name}")
        if item["review_status"] != "pass" or not item["direct_visual_review"]:
            raise ValueError(f"Review incomplete: {path.name}")
        if any(prompt_id not in prompts for prompt_id in item["prompt_ids"]):
            raise ValueError(f"Missing prompt for image: {path.name}")
        if not item["prompt_ids"]:
            raise ValueError(f"Prompt list empty: {path.name}")
        labels += sum(expected.values())
        paths.append(path)
    if len(set(paths)) != len(paths):
        raise ValueError("Duplicate final image path")
    frontmatter = body.split("---", 2)[1]
    asset_block = frontmatter.split("asset_files:", 1)[1]
    listed = re.findall(r'^  - "([^"]+)"$', asset_block, re.M)
    if set(listed) != {x["path"] for x in data["images"]}:
        raise ValueError("Frontmatter asset_files does not match final images")
    article_path = inside(root, data["article_path"])
    article = article_path.read_text(encoding="utf-8-sig")
    article_matches_snapshot = digest(article_path) == data.get("article_sha256")
    article_images = re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', article)
    article_targets = {inside(root, str((article_path.parent / unquote(ref)).relative_to(root)))
                       for ref in article_images}
    if set(paths) != article_targets:
        raise ValueError("Article image targets do not match record")
    visible = re.sub(r"(?ms)^```[^\n]*\n.*?^```\s*$", "", body)
    refs = re.findall(r"\[[^\]\n]*\]\(([^)]+)\)", visible)
    refs += re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', visible)
    checked_links = 0
    for ref in refs:
        if re.match(r"^[a-z]+://", ref):
            continue
        part = unquote(ref.split("#", 1)[0])
        if not part:
            continue
        target = (record_path.parent / part).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError(f"Invalid local link: {ref}")
        if target.is_relative_to(root / "99_Archive"):
            raise ValueError(f"Archive link forbidden: {ref}")
        checked_links += 1
    for target in re.findall(r'\[\[([^\]|]+)', frontmatter):
        source = inside(root, target + ".md")
        if not source.is_file() or source.is_relative_to(root / "99_Archive"):
            raise ValueError(f"Invalid source: {target}")
    archived = 0
    if include_archive:
        for item in data.get("archive_inventory", []):
            path = inside(root, item["archive_path"])
            if not path.is_relative_to(root / "99_Archive"):
                raise ValueError("Archive inventory path outside archive")
            if path.stat().st_size != item["bytes"] or digest(path) != item["sha256"]:
                raise ValueError(f"Archived file changed: {path.name}")
            archived += 1
    return {"passed": True, "final_images": len(paths), "labels_exactly_matched": labels,
            "prompt_blocks": len(prompts), "local_links": checked_links,
            "article_image_targets_valid": True,
            "article_matches_snapshot": article_matches_snapshot,
            "archive_files_checked": archived}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", type=Path)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--archive", action="store_true",
                        help="Also verify the local historical archive against its recorded hashes")
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        record = args.record.resolve()
        if not record.is_relative_to(root):
            raise ValueError("Record outside wiki")
        result = validate(record, root, args.archive)
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
