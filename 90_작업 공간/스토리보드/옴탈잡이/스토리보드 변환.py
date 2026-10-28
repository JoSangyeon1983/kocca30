"""사용자 지정 옴탈잡이 스토리보드의 대사와 무대 상태를 로컬 재생 데이터로 변환함."""
import copy
import hashlib
import json
import re
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "덧뵈기 - 탈놀음 한바탕 스토리보드.md"


def extract():
    sections = {}
    key = None
    chapter = None
    for number, line in enumerate(SOURCE.read_text(encoding="utf-8-sig").splitlines(), 1):
        heading = re.match(r"^(#{2,4}) (.+)", line)
        if heading:
            depth, text = len(heading[1]), heading[2]
            if depth == 2 and text.startswith("3."):
                chapter = text.split(" ", 1)[0]
                key = chapter
            elif depth == 3 and text.startswith("3."):
                key = text.split(" ", 1)[0]
            elif depth == 4 and chapter:
                key = key.split("/", 1)[0] + "/" + text.split(")", 1)[0]
            else:
                continue
            sections[key] = {"name": text, "line": number, "speeches": []}
        match = re.match(r"\s+(?:- |\d+\. )(꺽쇠|옴탈|장쇠): (.+)", line)
        if match:
            assert key in sections
            sections[key]["speeches"].append({"speaker": match[1], "text": match[2].strip(), "sourceLine": number})
    return sections


def convert():
    sections = extract()
    events, chapters = [], []
    cast = {"kkeok": {"x": 50, "visible": False, "motion": "", "asset": "꺽쇠 서 있는 자세.png"},
            "omtal": {"x": -18, "visible": False, "motion": "", "asset": "옴탈 서 있는 자세.png"}}
    effect = {"demo": "none", "face": "none", "hat": False, "coins": False, "arrows": False, "peek": "none"}
    ordinal = 0
    current_chapter, current_section = "start", "3.1.1"
    blackout = False

    def pose(person, **values):
        cast[person].update(values)

    def fx(**values):
        effect.update(values)

    def base():
        return {"chapter": current_chapter, "section": sections[current_section]["name"],
                "sourceLine": sections[current_section]["line"], "blackout": blackout,
                "cast": copy.deepcopy(cast), "effect": copy.deepcopy(effect)}

    def stage(text, duration=1300):
        events.append(dict(base(), kind="stage", text=text, duration=duration))

    def speech(item):
        nonlocal ordinal
        ordinal += 1
        events.append(dict(base(), **item, kind="speech", ordinal=ordinal))

    def chapter(identifier, label, section):
        nonlocal current_chapter, current_section
        current_chapter, current_section = identifier, section
        chapters.append({"id": identifier, "label": label, "start": len(events)})

    def lines(section):
        nonlocal current_section
        current_section = section
        for item in sections[section]["speeches"]:
            speech(item)

    chapter("start", "01 시작", "3.1.1")
    blackout = True
    pose("kkeok", visible=True, motion="dance")
    stage("어둠 속에서 꺽쇠가 입장춤을 시작합니다.", 1000)
    lines("3.1.1")
    blackout = False
    stage("마당에 서서히 빛이 들어옵니다.", 1400)
    current_section = "3.1.2"
    pose("omtal", x=-18, visible=False, motion="")
    fx(peek="left")
    stage("옴탈이 왼쪽 가장자리에서 상반신을 기울여 얼굴을 내밀었다가 숨습니다.", 2100)
    fx(peek="none")
    stage("옴탈이 완전히 모습을 감춥니다.", 500)
    fx(peek="right")
    stage("옴탈이 오른쪽 가장자리에서 상반신을 기울여 얼굴을 내밀었다가 숨습니다.", 2100)
    fx(peek="none")
    stage("옴탈이 다시 완전히 모습을 감춥니다.", 600)
    speech(sections[current_section]["speeches"][0])
    pose("omtal", x=25, visible=True, motion="")
    pose("kkeok", x=68, motion="")
    stage("옴탈이 왼쪽에 자리를 잡습니다.", 1400)
    speech(sections[current_section]["speeches"][1])

    chapter("chase", "02 옴탈 쫓아내기", "3.2.1")
    pose("kkeok", x=50, motion="")
    pose("omtal", x=25, visible=True, motion="", snap=True)
    lines("3.2.1")
    current_section = "3.2.2"
    pose("kkeok", motion="sweep")
    fx(demo="chase")
    stage("꺽쇠가 몸을 크게 흔들어 왼쪽 옴탈을 쫓아냅니다.", 2800)
    pose("omtal", visible=False, motion="")
    stage("왼쪽 옴탈이 사라집니다.", 500)
    pose("omtal", x=75, visible=True, motion="wobble")
    stage("옴탈이 오른쪽에 나타납니다.", 2400)
    pose("omtal", visible=False, motion="")
    stage("오른쪽 옴탈이 사라집니다.", 500)
    pose("omtal", x=25, visible=True, motion="wobble")
    stage("옴탈이 다시 왼쪽에 나타납니다.", 2400)

    chapter("grab", "03 옴탈 잡아채기", "3.3.1")
    fx(demo="none")
    pose("kkeok", x=118, motion="dance")
    pose("omtal", x=50, motion="dance", snap=False)
    stage("꺽쇠가 오른쪽으로 퇴장하고 옴탈이 중앙으로 나옵니다.", 1500)
    pose("kkeok", visible=False, motion="")
    lines("3.3.1")
    current_section = "3.3.2/1"
    fx(demo="hat", hat=True)
    pose("omtal", motion="roam")
    lines(current_section)
    stage("손 포인터가 반짝이는 모자로 다가갑니다.", 2200)
    current_section = "3.3.2/2"
    pose("omtal", x=48, asset="옴탈_SD.png", motion="shake")
    fx(demo="shake", hat=False, coins=True)
    stage("옴탈을 잡아 흔들자 엽전이 떨어집니다.", 2400)
    lines(current_section)
    stage("옴탈이 마지막으로 크게 흔들립니다.", 1600)

    chapter("inspect", "04 옴탈 채검하기", "3.4.1")
    fx(demo="none", coins=False)
    pose("omtal", x=25, visible=True, asset="옴탈 서 있는 자세.png", motion="")
    pose("kkeok", x=118, visible=True, motion="dance")
    stage("옴탈이 본래 모습으로 돌아오고 꺽쇠가 다시 등장합니다.", 250)
    pose("kkeok", x=69, motion="")
    stage("꺽쇠가 오른쪽에 서서 옴탈의 얼굴을 살핍니다.", 1400)
    lines("3.4.1")
    current_section = "3.4.2/1"
    pose("kkeok", visible=False)
    pose("omtal", visible=False)
    fx(demo="inspect-ready", face="basic", arrows=True)
    stage("옴탈의 얼굴이 크게 나타납니다.", 1200)
    lines(current_section)
    current_section = "3.4.2/2"
    fx(demo="inspect", face="cycle")
    stage("손 포인터가 얼굴을 좌우로 살핍니다.", 2800)
    lines(current_section)
    stage("얼굴 살피기를 마칩니다.", 1600)

    chapter("drive", "05 옴탈 몰아내기", "3.5.1")
    fx(demo="none", face="none", arrows=False)
    pose("omtal", x=-18, visible=False, motion="")
    pose("kkeok", x=118, visible=True, motion="dance")
    stage("옴탈이 물러가고 꺽쇠가 오른쪽에서 나옵니다.", 250)
    pose("kkeok", x=50)
    stage("꺽쇠가 무대 중앙으로 이동합니다.", 1400)
    lines("3.5.1")
    current_section = "3.5.2"
    fx(demo="drive")
    stage("여섯 방향에서 날아드는 옴탈의 탈을 몰아냅니다.", 3000)
    lines(current_section)
    stage("날아오던 탈이 사라집니다.", 1800)

    chapter("ending", "06 마무리", "3.6")
    fx(demo="none")
    pose("kkeok", x=73, motion="dance")
    pose("omtal", x=-18, visible=True, motion="dance")
    stage("꺽쇠가 오른쪽으로 이동합니다.", 700)
    pose("omtal", x=25)
    stage("옴탈이 왼쪽에서 다시 등장해 함께 춤춥니다.", 1700)
    ending = sections["3.6"]["speeches"]
    speech(ending[0])
    pose("omtal", x=-18, motion="stumble")
    stage("옴탈이 몸을 기우뚱거리며 무대 밖으로 달아납니다.", 1600)
    pose("omtal", visible=False)
    pose("kkeok", x=50)
    stage("꺽쇠가 춤을 추며 중앙으로 돌아옵니다.", 1400)
    for item in ending[1:]:
        speech(item)
    blackout = True
    stage("막이 내립니다.", 1600)
    for index, event in enumerate(events):
        event["id"] = f"event-{index:03}"
    source_speeches = sorted((item for section in sections.values() for item in section["speeches"]), key=lambda item: item["sourceLine"])
    assert [{key: event[key] for key in ("speaker", "text", "sourceLine")} for event in events if event["kind"] == "speech"] == source_speeches
    payload = {"source": SOURCE.name, "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
               "sourceVersion": "1.1.0", "chapters": chapters, "speechCount": ordinal, "events": events,
               "previewOnly": {"input": "automatic demonstration", "motion": "translation, rotation and shaking of supplied static images",
                               "timing": "stage event durations are preview values; dialogue never expires",
                               "chaseSequence": ["left", "right", "left"], "projectileOrigins": 6,
                               "missingSourceDialogue": ["쫓아내기 성공과 실패의 랜덤 대사", "무입력 때 장쇠의 행동 유도 대사"]}}
    payload["assetInventory"] = [{"name": path.name, "width": struct.unpack(">II", path.read_bytes()[16:24])[0],
                                "height": struct.unpack(">II", path.read_bytes()[16:24])[1], "bytes": path.stat().st_size,
                                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                               for path in sorted((HERE / "이미지").glob("*.png"))]
    (HERE / "극 진행 데이터.js").write_text('"use strict";\nwindow.PLAY_DATA = ' + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8", newline="\n")
    print(json.dumps({"speeches": ordinal, "events": len(events), "chapters": len(chapters), "sourceSha256": payload["sourceSha256"]}, ensure_ascii=True))


if __name__ == "__main__":
    convert()
