"""Build a self-contained Windows x64 EXE from the existing HTML and official Fixed Runtime."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

sys.stdout.reconfigure(encoding='utf-8')
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
WORK = ROOT / 'tmp/꼭두각시거리 실행 파일'
RUNTIME = WORK / 'runtime/Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64'
OUTPUT = ROOT / '08_산출물/덜미/꼭두각시거리'
PUBLISH = WORK / 'publish'
VERSION = '1.0.0'
RUNTIME_URL = 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/232cf50b-3980-4531-afbb-779f446d7de1/Microsoft.WebView2.FixedVersionRuntime.155.0.4283.62.x64.cab'

def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def main():
    assert (RUNTIME / 'msedgewebview2.exe').is_file(), 'Extract the official Fixed Runtime to the runtime folder first.'
    files = [(HERE.parent / name, 'web/' + name) for name in
             ['극 진행 보기.html', '극 진행.css', '극 진행.js', '극 진행 데이터.js']]
    files += [(file, 'web/이미지/' + file.name) for file in sorted((HERE.parent / '이미지').glob('*.png'))]
    assert len(files) == 14
    web_hashes = {name.removeprefix('web/'): sha(file) for file, name in files}
    files += [(file, 'runtime/' + file.relative_to(RUNTIME).as_posix()) for file in sorted(RUNTIME.rglob('*')) if file.is_file()]
    WORK.mkdir(parents=True, exist_ok=True)
    payload = WORK / 'payload.zip'
    manifest = WORK / 'bundle.json'
    previous = json.loads(manifest.read_text(encoding='utf-8')) if manifest.is_file() else {}
    if previous.get('WebFiles') != web_hashes or not payload.is_file():
        with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for file, name in files:
                archive.write(file, name)
        print('PAYLOAD', payload.stat().st_size, 'bytes', len(files), 'files', flush=True)
    source = HERE.parent.parent / '덜미 - 나만의 꼭두각시 스토리보드.md'
    info = {'PayloadSha256': sha(payload), 'RuntimeVersion': '155.0.4283.62',
            'SourceSha256': sha(source), 'WebFiles': web_hashes}
    manifest.write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    env = dict(os.environ, DOTNET_CLI_TELEMETRY_OPTOUT='1', DOTNET_NOLOGO='1')
    subprocess.run(['dotnet', 'publish', str(HERE / 'KkokduPlay.csproj'), '-c', 'Release', '-r', 'win-x64',
                    '--self-contained', 'true', '-o', str(PUBLISH), '-p:PayloadDirectory=' + str(WORK)],
                   check=True, cwd=ROOT, env=env)
    produced = list(PUBLISH.iterdir())
    assert (PUBLISH / 'KkokduPlay.exe').is_file()
    assert all(p.suffix.lower() in {'.exe', '.xml'} for p in produced), [p.name for p in produced]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / ('꼭두각시거리 ' + VERSION + '.exe')
    import shutil
    shutil.copy2(PUBLISH / 'KkokduPlay.exe', destination)
    report = {'version': VERSION, 'runtimeVersion': info['RuntimeVersion'], 'runtimeUrl': RUNTIME_URL,
              'runtimeCabSha256': sha(WORK / 'WebView2 155 x64.cab'), 'payloadSha256': info['PayloadSha256'],
              'sourceSha256': info['SourceSha256'], 'webFiles': web_hashes,
              'exe': str(destination.relative_to(ROOT)), 'exeSha256': sha(destination), 'bytes': destination.stat().st_size,
              'payloadFiles': len(files), 'sdk': subprocess.check_output(['dotnet', '--version'], text=True).strip()}
    saved_report = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    (WORK / '빌드 결과.json').write_text(saved_report, encoding='utf-8')
    (HERE / '검증').mkdir(exist_ok=True)
    (HERE / '검증/빌드 결과.json').write_text(saved_report, encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['version', 'exe', 'bytes', 'exeSha256']}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
