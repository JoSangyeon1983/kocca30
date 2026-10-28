"""지정 스토리보드의 대사와 이동 지시만 로컬 HTML 데이터로 변환한다."""
import copy
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / '덜미 - 나만의 꼭두각시 스토리보드.md'
lines = SOURCE.read_text(encoding='utf-8-sig').splitlines()
sections = {}
section = None
for line_number, line in enumerate(lines, 1):
    heading = re.match(r'### (3\.\d+\.\d+) (.+)', line)
    if heading:
        section = heading[1]
        sections[section] = {'name': heading[2], 'line': line_number, 'speeches': []}
    elif line.startswith('## 3.5 '):
        section = '3.5'
        sections[section] = {'name': '박첨지 울음', 'line': line_number, 'speeches': []}
    match = re.match(r'\s+\d+\. (박첨지|산받이|꼭두각시|꼭두가시|덜머리집): (.+)', line)
    if match:
        sections[section]['speeches'].append({'speaker': match[1].replace('꼭두가시', '꼭두각시'), 'text': match[2].strip(), 'sourceLine': line_number})

cast = {'park': {'x':50,'visible':False}, 'kkok': {'x':73,'visible':False}, 'deol': {'x':22,'visible':False}}
events = []
chapters = []
ordinal = 0
current_section = None
current_chapter = None
corrections = []

def pose(key, **values):
    cast[key].update(values)

def stage(text, duration=1200, blackout=False):
    events.append({'kind':'stage','chapter':current_chapter,'section':sections[current_section]['name'],'sourceLine':sections[current_section]['line'],'text':text,'duration':duration,'blackout':blackout,'cast':copy.deepcopy(cast)})

def speech(item):
    global ordinal
    item = dict(item)
    for old,new in [('때렸나? 5 울퉁불퉁하고','때렸나? 울퉁불퉁하고'),('짚으로 7 만든','짚으로 만든')]:
        if old in item['text']:
            corrections.append({'sourceLine':item['sourceLine'],'before':old,'after':new,'reason':'대사 문맥에 끼어 있는 독립 숫자. 주석 번호 잔재로 추정되나 주석 원문은 미확인.'})
            item['text'] = item['text'].replace(old,new)
    ordinal += 1
    events.append(dict(item,kind='speech',ordinal=ordinal,chapter=current_chapter,section=sections[current_section]['name'],cast=copy.deepcopy(cast)))

groups = [
    ('start','01 시작',['3.1.1','3.1.2','3.1.3']),
    ('fight','02 싸움',['3.2.1']),
    ('property','03 재산 분배',['3.3.1','3.3.2','3.3.3','3.3.4','3.3.5','3.3.6','3.3.7']),
    ('travel','04 노잣돈',['3.4.1','3.4.2']),
    ('ending','05 박첨지 울음',['3.5'])
]
for chapter_id,label,keys in groups:
    current_chapter = chapter_id
    chapters.append({'id':chapter_id,'label':label,'start':len(events)})
    for key in keys:
        current_section = key
        if key == '3.1.1':
            pose('park',visible=True,motion='sway')
            stage('박첨지가 무대 중앙에서 홀로 놉니다.',1800)
            pose('park',motion='')
        elif key == '3.1.2':
            pose('park',x=27)
            pose('kkok',x=73,visible=True)
            stage('오른쪽 장막 아래에서 꼭두각시가 등장합니다.',1400)
        elif key == '3.2.1':
            pose('deol',x=53,motion='fight-left')
            pose('kkok',x=68,motion='fight-right')
            stage('꼭두각시와 덜머리집이 서로 부딪히며 싸웁니다.',2700)
        elif key == '3.3.1':
            pose('deol',x=50,motion='')
            pose('kkok',x=75,motion='')
            stage('두 사람이 싸움을 멈추고 물러섭니다.',1200)
        for number,item in enumerate(sections[key]['speeches'],1):
            if key == '3.1.2' and number == 6:
                pose('park',x=41)
                pose('kkok',x=62)
                stage('박첨지와 꼭두각시가 무대 중앙에서 만납니다.',1300)
            elif key == '3.1.3' and number == 25:
                pose('deol',x=22,visible=True)
                stage('왼쪽 장막 아래에서 덜머리집이 등장합니다.',1400)
            elif key == '3.5' and number == 2:
                pose('kkok',x=87)
                stage('꼭두각시가 무대 오른쪽으로 떠납니다.',1000)
                pose('kkok',visible=False)
                stage('꼭두각시가 장막 아래로 퇴장합니다.',1100)
            elif key == '3.5' and number == 3:
                pose('park',x=14)
                pose('deol',x=23)
                stage('박첨지와 덜머리집이 왼쪽으로 이동합니다.',1100)
                pose('park',visible=False)
                pose('deol',visible=False)
                stage('박첨지와 덜머리집이 장막 아래로 퇴장합니다.',1200)
                pose('park',x=50,visible=True)
                stage('박첨지가 무대 중앙으로 다시 등장합니다.',1400)
            elif key == '3.5' and number == 7:
                pose('park',motion='cry',angle=3)
            elif key == '3.5' and number == 9:
                pose('park',motion='',angle=0)
            speech(item)
        if key == '3.1.3':
            pose('park',x=24)
            pose('deol',x=50)
            pose('kkok',x=75)
            stage('박첨지가 왼쪽으로 물러나고 덜머리집이 중앙으로 갑니다.',1300)

stage('막이 내립니다.',1400,blackout=True)
assert len(corrections) <= 2
assert ordinal == sum(len(section['speeches']) for section in sections.values())
payload = {'source':SOURCE.name,'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'chapters':chapters,'speechCount':ordinal,'corrections':corrections,'events':events}
(HERE / '극 진행 데이터.js').write_text('"use strict";\nwindow.PLAY_DATA = '+json.dumps(payload,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
print(json.dumps({'speeches':ordinal,'events':len(events),'chapters':len(chapters),'sourceSha256':payload['sourceSha256'],'corrections':corrections},ensure_ascii=True,indent=2))
