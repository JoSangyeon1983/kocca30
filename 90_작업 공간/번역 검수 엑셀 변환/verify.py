import json
import hashlib
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[2]
work = Path(__file__).resolve().parent
manifest_path = work / 'outputs/20261110/verification.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
xlsx_path = Path(manifest['delivery'])
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
relationship = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
checks = []

with zipfile.ZipFile(xlsx_path) as archive:
    assert archive.testzip() is None
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', ns):
            shared.append(''.join(t.text or '' for t in item.findall('.//m:t', ns)))
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    rels = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): r.get('Target') for r in rels}
    sheets = workbook.findall('m:sheets/m:sheet', ns)
    assert [s.get('name') for s in sheets] == ['UI 문구', '이름 풀']
    assert len([name for name in archive.namelist() if name.startswith('xl/tables/table') and name.endswith('.xml')]) == 2
    count = 0
    for item, source in zip(sheets, manifest['sources']):
        target = targets[item.get(relationship)].lstrip('/')
        if not target.startswith('xl/'):
            target = 'xl/' + target
        sheet = ET.fromstring(archive.read(target))
        pane = sheet.find('m:sheetViews/m:sheetView/m:pane', ns)
        assert pane is not None
        assert float(pane.get('xSplit', 0)) == 1, ET.tostring(pane)
        assert float(pane.get('ySplit', 0)) == 6, ET.tostring(pane)
        assert pane.get('topLeftCell') == 'B7'
        source_path = root / '90_작업 공간/번역 검수' / source['file']
        source_bytes = source_path.read_bytes()
        assert hashlib.sha256(source_bytes).hexdigest() == source['sha256']
        data = json.loads(source_bytes.decode('utf-8-sig'))
        expected = [[key, value['ko'], value['en']] for key, value in data.items()]
        cells = {}
        for cell in sheet.findall('m:sheetData/m:row/m:c', ns):
            assert cell.find('m:f', ns) is None
            cell_type = cell.get('t')
            value = cell.find('m:v', ns)
            if cell_type == 's':
                text = shared[int(value.text)]
            elif cell_type == 'inlineStr':
                text = ''.join(t.text or '' for t in cell.findall('.//m:t', ns))
            else:
                text = value.text if value is not None else ''
            cells[cell.get('r')] = (cell_type, text)
        for row_index, row in enumerate(expected, start=7):
            for column_index, value in enumerate(row):
                address = f'{chr(65 + column_index)}{row_index}'
                cell_type, text = cells[address]
                assert cell_type in ('s', 'inlineStr', 'str'), (address, cell_type)
                assert text == value, (source['file'], address, text, value)
                count += 1
        assert [cells[f'{c}6'][1] for c in 'ABC'] == ['키', '한국어 (ko)', '영어 (en)']
        checks.append({'sheet': item.get('name'), 'rows': len(expected), 'freeze': 'B7', 'text_cells_match': len(expected) * 3})
    for table_path in (n for n in archive.namelist() if n.startswith('xl/tables/table') and n.endswith('.xml')):
        table = ET.fromstring(archive.read(table_path))
        assert table.get('ref') in ('A6:C189', 'A6:C26')
        assert table.find('m:autoFilter', ns).get('ref') == table.get('ref')
        assert len(table.findall('m:tableColumns/m:tableColumn', ns)) == 3
    assert count == 609

assert hashlib.sha256(xlsx_path.read_bytes()).hexdigest() == manifest['sha256']
manifest['nativeXmlChecks'] = checks
manifest['zipIntegrity'] = True
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'zipIntegrity': True, 'verifiedTextCells': count, 'checks': checks}, ensure_ascii=False, indent=2))
