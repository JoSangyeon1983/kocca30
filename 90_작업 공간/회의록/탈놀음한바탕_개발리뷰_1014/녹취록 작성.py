"""Build the reviewed transcript from immutable Clova source and explicit edits."""

from pathlib import Path
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = HERE / "원문/탈놀음한바탕_개발리뷰_1014.txt"
PLANNING = ROOT / "04_상세 기획/덧뵈기 - 탈놀음 한바탕/덧뵈기 - 탈놀음 한바탕 기획서.md"
TITLE = "2026-10-14 탈놀음 한바탕 개발 리뷰"
TRANSCRIPT = HERE / (TITLE + " 녹취록.md")
AUDIT = HERE / (TITLE + " 교정 대조표.md")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def relative(path):
    import os
    return Path(os.path.relpath(path, HERE)).as_posix()


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def table(headers, rows):
    return ["| " + " | ".join(headers) + " |",
            "|" + "|".join("---" for _ in headers) + "|"] + [
        "| " + " | ".join(cell(v) for v in row) + " |" for row in rows
    ]


raw_bytes = SOURCE.read_bytes()
raw = raw_bytes.decode("utf-8-sig")
lines = raw.splitlines()
extraction = json.loads((HERE / "클로바 최초 추출.json").read_text(encoding="utf-8-sig"))
rules = json.loads((HERE / "교정 데이터.json").read_text(encoding="utf-8-sig"))
assert sha(raw_bytes).upper() == extraction["source_sha256"] == rules["source_sha256"]
assert len(lines) == extraction["total_lines"]
assert PLANNING.is_file()
units = extraction["units"]
by_line = {}
for index, unit in enumerate(units, 1):
    assert unit["id"] == f"C{index:04d}"
    unit["transcript_id"] = f"T{index:04d}"
    unit["corrections"] = []
    for item in unit["content"]:
        assert item["text"] == lines[item["line"] - 1]
        assert item["line"] not in by_line
        by_line[item["line"]] = (unit, item)

edited = {n: item["text"] for n, (_, item) in by_line.items()}
origins = {n: [(i, i + 1) for i in range(len(text))] for n, text in edited.items()}
applied = []


def apply(rule, n):
    before, after = rule["before"], rule["after"]
    if before == after:
        return
    assert before in edited[n], (n, before, edited[n])
    old_text = edited[n]
    old_map = origins[n]
    matches = list(re.finditer(re.escape(before), old_text))
    count = len(matches)
    output = []
    output_map = []
    cursor = 0
    raw_expression = None
    for match in matches:
        output.append(old_text[cursor:match.start()])
        output_map.extend(old_map[cursor:match.start()])
        covered = old_map[match.start():match.end()]
        span = (min(start for start, _ in covered), max(end for _, end in covered))
        if raw_expression is None:
            raw_expression = by_line[n][1]["text"][span[0]:span[1]]
        output.append(after)
        output_map.extend([span] * len(after))
        cursor = match.end()
    output.append(old_text[cursor:])
    output_map.extend(old_map[cursor:])
    edited[n] = "".join(output)
    origins[n] = output_map
    unit = by_line[n][0]
    record = dict(rule, raw_expression=raw_expression, occurrences=count, source_id=unit["id"],
                  transcript_id=unit["transcript_id"], line=n)
    unit["corrections"].append(record)
    applied.append(record)


for rule in rules["global_replacements"]:
    found = [n for n, text in edited.items() if rule["before"] in text]
    assert found, rule["before"]
    for n in found:
        apply(rule, n)
for rule in rules["line_replacements"]:
    assert rule["line"] in by_line, rule
    apply(rule, rule["line"])

uncertain = [r for r in applied if "미확인" in r["status"]]
contextual = [r for r in applied if r["status"] == "문맥 교정"]
changed_units = [u for u in units if u["corrections"]]
source_link = relative(SOURCE)
plan_link = relative(PLANNING)
audit_link = relative(AUDIT)
transcript_link = relative(TRANSCRIPT)
source_description = f"사용자 제공 클로바노트 TXT: {SOURCE.name}, {TITLE}."
metadata = [
    "---", f'title: "{TITLE} 녹취록"', "type: reference",
    'created: "2026-10-14"', 'updated: "2026-10-14"', "status: review",
    "sources:", "  - " + json.dumps(source_description, ensure_ascii=False),
    "source_check: partial", "target_folder: 01_프로젝트",
    "related_documents:",
    '  - "[[04_상세 기획/덧뵈기 - 탈놀음 한바탕/덧뵈기 - 탈놀음 한바탕 기획서]]"',
    "---", "", "# 자료 정보", "", "## 회의와 원자료", ""
]
metadata += table(["항목", "확인 내용"], [
    ("회의 식별명", TITLE),
    ("원문 표기 일시", lines[1].split(" ・ ")[0]),
    ("원문 표기 녹음 길이", "50분 55초"),
    ("TXT 발언 시각 범위", f"{units[0]['time']} ~ {units[-1]['time']}"),
    ("장소, 진행 방식 및 실제 종료 시각", "제공 자료에서 확인되지 않음"),
    ("원자료", f"[클로바노트 TXT](<{source_link}>), UTF-8, {len(lines)}행"),
    ("수기 녹취록 및 음성", "미제공. 사용자가 수기 자료는 없다고 명시함"),
    ("편집 대조 범위", f"발언 {len(units)}개 전체, C0001 ~ {units[-1]['id']}"),
])
metadata += ["", "## 교정 방법과 확인 범위", "",
    "- 사용자 요청에 따라 클로바노트 TXT 한 개를 전체 읽고 지정 기획서의 용어와 문맥으로 교정한 편집 완성본임. 두 TXT 대조나 음성 청취를 수행한 결과가 아님.",
    "- 발언 순서, 원문의 시각과 발언자 표시, 수치, 부정, 질문, 의견 차이와 수정 과정을 보존함. 기획서의 내용으로 발언이나 답변을 새로 만들지 않음.",
    "- 명백한 명칭과 오인식은 교정하고, 원문에 잘못 인식된 어구가 있으나 의미를 확정할 수 없는 경우 대괄호 안에 원문과 미확인 상태를 표시함.",
    "- 문맥 교정은 앞뒤 발언에서 도출한 편집 판단이며 실제 음성의 확인을 뜻하지 않음. 인물 지칭, 수치와 부정 표현이 충돌하면 원문을 유지하며 그 문제를 표시함.",
    "- 원음과 수기가 없으므로 STT의 누락, 실제 발화 내용과 화자 배정의 정확성은 검증하지 못함. 특히 한 표기 안에 짧은 응답이 섞인 부분을 다른 참석자의 발언으로 임의 분리하지 않음.",
    "", "## 용어 참고와 검증 기록", "",
    f"- 문맥 참고: [덧뵈기 - 탈놀음 한바탕 기획서](<{plan_link}>). 문서의 개요, 모션 인식, 옴탈잡이 용어와 동작 설명을 사용함. 발언의 직접 출처는 클로바노트 TXT임.",
    f"- 원문 위치, 수정 전후 표현과 판단 근거: [교정 대조표](<{audit_link}>). 최초 추출과 세부 교정 데이터도 같은 작업 폴더에 보존함.",
    "- 원문 3행에 표시된 이름과 역할, 발언의 이름 표기를 사용함. `참석자 8`과 `참석자 13`은 실제 인물을 확인하지 못해 원문 번호를 유지함.",
    "", "# 녹취", ""]

phases = [
    (0, "개발 일정과 기획 설명"),
    (8 * 60 + 33, "그래픽 제작 방식과 콘텐츠 전개"),
    (25 * 60 + 23, "바닥면, 사용자 인식과 게임 동작"),
    (39 * 60 + 4, "연출 보완과 HTML 데모, 결과 표시"),
    (48 * 60 + 57, "검토 진행과 기획 문서 형식"),
]
current_phase = None
for unit in units:
    minute, second = map(int, unit["time"].split(":"))
    phase = max(i for i, (start, _) in enumerate(phases) if start <= minute * 60 + second)
    if phase != current_phase:
        metadata += ["## " + phases[phase][1], ""]
        current_phase = phase
    lo = unit["header_line"]
    hi = unit["content"][-1]["line"]
    metadata += [f"**{unit['transcript_id']} | {unit['time']} | {unit['speaker']}**", "",
                 f"原文位置PLACEHOLDER {unit['id']}, TXT {lo} ~ {hi}행.", ""]
    for item in unit["content"]:
        metadata.append("> " + edited[item["line"]])
    metadata.append("")
metadata += ["# 교정과 미확인 사항", "", "## 처리 결과", ""]
metadata += table(["항목", "결과"], [
    ("전체 발언", f"{len(units)}개 모두 반영. 발언 삭제, 순서 변경과 화자 재배정 없음"),
    ("텍스트 교정", f"{len(changed_units)}개 발언에서 {len(applied)}개 수정 기록, 세부 내용은 교정 대조표에 기재"),
    ("문맥 교정", f"{len(contextual)}개 수정 기록. 음성 미확인 상태의 편집 판단으로 구분함"),
    ("미확인", f"{len(uncertain)}개 수정 기록에 미확인 표시. 같은 발언 안의 여러 어구를 개별 집계한 값임"),
    ("원자료 보존", "사용자 TXT 원본은 수정하지 않았으며 SHA-256은 대조표에 기록함"),
])
metadata += ["", "## 중요한 의미 확인 필요 사항", ""]
metadata += table(["원문 위치", "남은 확인 사항"], [
    ("04:45, 05:43", "원문의 꺽새, 껍세는 꺽쇠로 철자만 정리함. 기획서에서는 SD 및 얼굴 강조 캐릭터가 옴탈이므로 실제 지칭은 미확인임"),
    ("10:44, 21:16, 23:21", "트리 스파이어의 명칭과 3D 반복 표기의 차원 구분. 제작 방식에 관한 의견 차이는 삭제하지 않음"),
    ("13:55, 14:50, 32:06", "미니게임 수가 3개에서 다른 수로 언급되는 과정. 기획서에 맞춰 전체 발언의 수치를 통일하지 않음"),
    ("25:32, 26:12, 27:13", "바닥면 개발 포함 여부와 입력 진행 방식의 불완전한 표현. 합의나 부정 표현을 보충하지 않음"),
    ("28:04 ~ 29:01", "추적 기술, 장비명 백토와 장비에서 받는 데이터의 정확한 명칭"),
    ("37:02 ~ 38:09", "배역 설명에 섞인 응답, 원작 대사의 정확한 내용과 5분 걸리고 표현"),
    ("43:30, 45:24, 49:50", "스크립트 작성 완료 여부, 결과 지표의 피지 지칭과 윤 의원님 호칭"),
])
metadata += ["", "- 위 표 이외의 불완전한 어구도 녹취 본문의 대괄호와 교정 대조표에 남김. 미확인 항목이 있어도 전체 TXT의 처리와 편집은 완료했으며 음성의 정확성을 확정한 것은 아님.", ""]
transcript_text = "\n".join(metadata).replace("原文位置PLACEHOLDER", "원문 위치:")

audit = ["---", f'title: "{TITLE} 교정 대조표"', "type: system",
         'created: "2026-10-14"', 'updated: "2026-10-14"', "---", "",
         "# 원자료와 작업 범위", ""]
audit += table(["항목", "기록"], [
    ("원본 파일", f"[클로바노트 TXT](<{source_link}>)"),
    ("사용자 추가 폴더", HERE.relative_to(ROOT).as_posix()),
    ("회의 식별명", TITLE),
    ("인코딩과 원문 크기", f"UTF-8, {len(raw_bytes)}바이트, {len(lines)}행"),
    ("원본 SHA-256", sha(raw_bytes).upper()),
    ("수기 및 음성", "미제공. 이번 요청은 단일 STT와 지정 기획서의 문맥 교정임"),
    ("문맥 참고", f"[기획서](<{plan_link}>), 문서 정보에 기록된 최신 버전 4.1.1"),
    ("참고 문서 SHA-256", sha(PLANNING.read_bytes()).upper()),
    ("발언자 정보", "TXT 3행과 발언 표기의 이름 및 역할 사용. 참석자 8, 13의 실명과 화자 분리 정확성은 미확인"),
])
audit += ["", "- 작업 근거: 사용자가 수기 자료가 없음을 명시하고 지정 기획서를 토대로 용어를 교정한 녹취록 완성본을 요청함. 수기 대조 결과나 원음 확인 결과를 생성하지 않음.",
          "- 최초 추출: [클로바 최초 추출.json](<클로바 최초 추출.json>). 발언자와 시각이 있는 원문 단위에 C0001부터 ID를 부여하고 모든 발언을 한 번씩 완성본 T0001부터 대응함.",
          "- 교정 규칙: [교정 데이터.json](<교정 데이터.json>). 명백한 용어 교정, 문맥 교정과 미확인을 구분하고 단순 표기 정리 외 변경을 해당 원문 행에 한정함.",
          "- 의미 있는 반복, 질문, 부정, 의견 차이, 수치의 변경 과정과 불완전한 발언을 보존함. 표기의 잘못과 실제 발언의 내용 오류를 구분하여 기획서와의 내용 충돌은 임의로 덮어쓰지 않음.",
          "", "# 전체 원문 대응", ""]
audit += table(["원문 범위", "처리"], [
    ("1 ~ 3행", "클로바 파일 제목, 일시와 길이, 이름 표시 메타데이터. 회의 발언으로 만들지 않음"),
    ("빈 행", "구분용 공백. 발언 내용이 아니므로 별도 발언으로 생성하지 않음"),
    (f"{units[0]['header_line']} ~ {units[-1]['content'][-1]['line']}행", f"발언 머리말 {len(units)}개와 내용 {len(by_line)}행 전부 녹취록에 반영함"),
    ("1275행", "클로바 서비스 주소인 비발언 꼬리말. 회의 발언에서 제외함"),
])
audit += ["", f"- 완성본: [녹취록](<{transcript_link}>).", ""]
coverage = []
for unit in units:
    n = len(unit["corrections"])
    pending = sum("미확인" in r["status"] for r in unit["corrections"])
    result = "원문 유지" if not n else f"수정 {n}건" + (f", 미확인 {pending}건" if pending else "")
    coverage.append((unit["transcript_id"], unit["id"], unit["time"], unit["speaker"],
                     f"{unit['header_line']} ~ {unit['content'][-1]['line']}", result))
audit += table(["완성본 ID", "클로바 ID", "시각", "원문 발언자", "TXT 행", "처리 상태"], coverage)
audit += ["", "# 수정 전후와 판단 근거", "",
          "- 다음 표의 원문 표현은 해당 행의 실제 문자열임. 교정 표기는 편집자의 판단이며 원문을 수정한 결과가 아님.",
          "- 문맥 교정은 음성 미확인 상태임. 미확인 표기에는 확인되지 않은 원문을 보존하며 원음이나 참석자의 해당 구간 확인이 필요함.", ""]
audit += table(["발언 ID", "TXT 행", "원문 표현", "반영 표현", "판정과 근거"], [
    (r["transcript_id"], r["line"], r["raw_expression"], r["after"], r["status"] + ": " + r["reason"])
    for r in sorted(applied, key=lambda r: r["line"])
])
audit += ["", "# 검증 기록", "", "- 검토자: Codex. 검토일: 2026-10-14.",
          "- 확인 방법: 원본 TXT 전체 읽기, 지정 기획서 전체 읽기 및 용어 확인, 발언별 교정 판단, 최초 추출과 완성본 전수 대응 검사.",
          "- 음성 청취, 수기 간 대조와 참석자 확인은 수행하지 않음. 전체 발언을 처리했으나 미확인 어구가 남아 녹취록의 source_check는 partial임.",
          "- 실제 검증 수치와 원본 보존 확인: [검증 결과.json](<검증 결과.json>).", ""]

assert len(units) == len(coverage) == 381
assert len(by_line) == 506
assert SOURCE.read_bytes() == raw_bytes
TRANSCRIPT.write_text(transcript_text, encoding="utf-8", newline="\n")
AUDIT.write_text("\n".join(audit), encoding="utf-8", newline="\n")
result = {
    "passed": True, "source_sha256": sha(raw_bytes).upper(), "source_preserved": True,
    "source_lines": len(lines), "speech_units": len(units), "mapped_units": len(coverage),
    "speech_content_lines": len(by_line), "unprocessed_speech_units": 0,
    "changed_units": len(changed_units), "applied_edit_records": len(applied),
    "contextual_edit_records": len(contextual), "unresolved_edit_records": len(uncertain),
    "source_time_range": [units[0]["time"], units[-1]["time"]],
    "audio_checked": False, "handwritten_available": False,
    "source_check": "partial",
    "planning_sha256": sha(PLANNING.read_bytes()).upper(),
    "speaker_order_preserved": True, "timestamp_order_preserved": True,
}
(HERE / "검증 결과.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=True))
