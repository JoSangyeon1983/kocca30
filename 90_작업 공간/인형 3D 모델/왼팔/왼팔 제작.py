"""Approximate textured left arm from ArmL.png; reuses the doll's mesh exporter."""
from pathlib import Path
import base64
import hashlib
import importlib.util
import json
import math
import shutil
import struct
import subprocess
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SOURCE = Path(r'C:\Users\cellbig\Documents\ArmL.png')
spec = importlib.util.spec_from_file_location('doll_mesh_tools', ROOT.parent/'모델 제작.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.ROOT = ROOT


def prepare():
    rgba = np.array(Image.open(SOURCE).convert('RGBA'))
    source_size = (rgba.shape[1], rgba.shape[0])
    pad = 12
    rgba = cv2.copyMakeBorder(rgba, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0, 0))
    h, w = rgba.shape[:2]
    mask = (rgba[:, :, 3] > 140).astype(np.uint8)
    if rgba[:, :, 3].min() == 255:
        mask = (rgba[:, :, :3].max(2) > 15).astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    mask = (labels == 1+np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    mask = (cv2.GaussianBlur(mask.astype(np.float32), (5, 5), 0.7) > 0.5).astype(np.uint8)
    inner = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    sdf = inner-cv2.distanceTransform(1-mask, cv2.DIST_L2, 5)
    opaque = (rgba[:, :, 3] > 200) & (mask > 0)
    _, nearest = cv2.distanceTransformWithLabels((~opaque).astype(np.uint8), cv2.DIST_L2, 5,
                                               labelType=cv2.DIST_LABEL_PIXEL)
    front = rgba[:, :, :3][opaque][np.maximum(0, nearest-1)]
    yy, xx = np.mgrid[:h, :w]
    # Image-space shoulder-to-hand axis: a modelling assumption, not an arm joint.
    shoulder = np.array([source_size[0]*.08+pad, source_size[1]*.07+pad])
    hand = np.array([source_size[0]*.80+pad, source_size[1]*.91+pad])
    axis = hand-shoulder
    axis /= np.linalg.norm(axis)
    transverse = np.array([axis[1], -axis[0]])
    t = (xx-shoulder[0])*axis[0]+(yy-shoulder[1])*axis[1]
    q = (xx-shoulder[0])*transverse[0]+(yy-shoulder[1])*transverse[1]
    offset = int(math.floor(t.min()))
    bins = np.rint(t-offset).astype(int)
    count = int(bins.max())+1
    left, right = np.full(count, np.inf), np.full(count, -np.inf)
    np.minimum.at(left, bins[mask > 0], q[mask > 0])
    np.maximum.at(right, bins[mask > 0], q[mask > 0])
    valid = np.isfinite(left) & np.isfinite(right)
    for edge in (left, right):
        edge[:] = np.interp(np.arange(count), np.flatnonzero(valid), edge[valid])
        edge[:] = cv2.GaussianBlur(edge.reshape(-1, 1), (1, 21), 3).reshape(-1)
    radius = np.maximum((right-left)/2, 1)[bins]
    center = ((left+right)/2)[bins]
    section = np.sqrt(np.maximum(0, 1-((q-center)/radius)**2))
    depth = np.minimum(radius*section, np.sqrt(2*radius*np.maximum(inner-.5, 0)))
    depth = cv2.GaussianBlur(depth.astype(np.float32), (11, 11), 1.8)
    df, db = depth*.78*mask, depth*.72*mask
    # Keep the sleeve fabric on the inferred back; simplify unseen hand markings.
    back = front.copy()
    r, g, b = [front[:, :, i].astype(float) for i in range(3)]
    wood = (r > 100) & (r > g*1.18) & (g > b*1.3) & (mask > 0)
    noise = np.random.default_rng(52).normal(0, 1, (h, w)).astype(np.float32)
    grain = cv2.GaussianBlur(noise, (3, 21), 3)
    grain /= max(float(grain.std()), .001)
    wood_color = np.clip(np.array([193, 139, 78])+grain[:, :, None]*5+
                         noise[:, :, None]*1.8, 0, 255).astype(np.uint8)
    back[wood] = wood_color[wood]
    back = cv2.GaussianBlur(back, (3, 3), .45)
    return mask, sdf, df, db, [front, back], source_size


def arm_export(p, n, uv, faces, textures):
    provisional, doc = base.export_glb(p, n, uv, faces, textures)
    blob = provisional.read_bytes()
    json_length = struct.unpack_from('<I', blob, 12)[0]
    binary_chunk = blob[20+json_length:]
    doc['asset']['generator'] = 'Image-projected approximate left-arm mesh'
    doc['asset']['extras']['source'] = 'user-provided ArmL.png'
    doc['asset']['extras']['limitations'] = 'Inferred depth and back. No rig; not attached to the doll.'
    doc['nodes'][0]['name'] = 'LeftArm'
    doc['meshes'][0]['name'] = 'Left arm approximate volume'
    js = json.dumps(doc, ensure_ascii=True, separators=(',', ':')).encode()
    js += b' '*((-len(js)) % 4)
    revised = (struct.pack('<4sII', b'glTF', 2, 20+len(js)+len(binary_chunk))+
               struct.pack('<II', len(js), 0x4E4F534A)+js+binary_chunk)
    provisional.write_bytes(revised)
    target = ROOT/'왼팔 기초 모델.glb'
    assert provisional.parent.resolve() == target.parent.resolve() == ROOT.resolve()
    provisional.replace(target)
    return target


def main():
    started = time.perf_counter()
    body = ROOT.parent/'인형 기초 모델.glb'
    body_hash = hashlib.sha256(body.read_bytes()).hexdigest()
    right_arm = ROOT.parent/'오른팔'/'오른팔 기초 모델.glb'
    right_hash = hashlib.sha256(right_arm.read_bytes()).hexdigest()
    mask, sdf, df, db, textures, size = prepare()
    p, n, uv, faces = base.mesh(mask, sdf, df, db, step=6)
    model = arm_export(p, n, uv, faces, textures)
    checks = base.validate(model)
    shutil.copyfile(SOURCE, ROOT/'왼팔 입력 원본.png')
    font = ImageFont.truetype(r'C:\Windows\Fonts\malgun.ttf', 21)
    views = [(0, '정면'), (45, '45도'), (90, '측면'), (180, '뒷면 추정')]
    sheet = Image.new('RGB', (620*4, 1005), '#f7f7f7')
    for i, (angle, label) in enumerate(views):
        sheet.paste(base.render(p, n, uv, faces, textures, angle, width=620), (i*620, 45))
        ImageDraw.Draw(sheet).text((i*620+24, 12), label, font=font, fill='#30384a')
    sheet.save(ROOT/'왼팔 입체 확인.png')
    html = (ROOT.parent/'미리보기 틀.html').read_text(encoding='utf-8')
    html = html.replace('인형 기초 모델.glb', '왼팔 기초 모델.glb')
    html = html.replace('인형 3D 미리보기', '인형 왼팔 3D 미리보기')
    html = html.replace('원본 이미지로 만든 기초 입체 모델', '원본 이미지로 만든 왼팔 기초 모델')
    html = html.replace('distance=2.6', 'distance=1.15').replace('Math.max(.8,', 'Math.max(.3,')
    html = html.replace('__GLB__', base64.b64encode(model.read_bytes()).decode())
    (ROOT/'왼팔 미리보기.html').write_text(html, encoding='utf-8')
    script = html.split('<script>', 1)[1].split('</script>', 1)[0]
    syntax = subprocess.run(['node', '--check', '--input-type=commonjs'], input=script,
                            capture_output=True, text=True, encoding='utf-8')
    assert syntax.returncode == 0, syntax.stderr
    assert hashlib.sha256(body.read_bytes()).hexdigest() == body_hash
    assert hashlib.sha256(right_arm.read_bytes()).hexdigest() == right_hash
    assert hashlib.sha256(SOURCE.read_bytes()).digest() == hashlib.sha256((ROOT/'왼팔 입력 원본.png').read_bytes()).digest()
    checks.update(input_size=size, original_copy_matches=True, body_model_unchanged=True,
                  right_arm_model_unchanged=True, model_texture_padding_px=12,
                  viewer_javascript_syntax='passed', viewer_browser_execution='not tested',
                  build_and_check_seconds=round(time.perf_counter()-started, 4))
    print(json.dumps(checks, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
