"""Build an explicitly approximate, image-projected doll mesh, not an AI reconstruction."""
from pathlib import Path
import base64
import hashlib
import io
import json
import math
import shutil
import struct
import subprocess
from collections import Counter

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SOURCE = Path(r'C:\Users\cellbig\Documents\head_body.png')
SCALE = 0.001


def jpeg_bytes(rgb):
    stream = io.BytesIO()
    Image.fromarray(rgb).save(stream, 'JPEG', quality=94, subsampling=0)
    return stream.getvalue()


def prepare():
    image = np.array(Image.open(SOURCE).convert('RGBA'))
    h, w = image.shape[:2]
    mask = (image[:, :, 3] > 140).astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    main = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    mask = (labels == main).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    mask = (cv2.GaussianBlur(mask.astype(np.float32), (5, 5), 0.7) > 0.5).astype(np.uint8)
    inner = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    outer = cv2.distanceTransform(1-mask, cv2.DIST_L2, 5)
    sdf = inner - outer
    # Pad transparent texels from their nearest opaque texel, preventing dark seams.
    opaque = image[:, :, 3] > 200
    _, nearest = cv2.distanceTransformWithLabels((~opaque).astype(np.uint8), cv2.DIST_L2, 5,
                                               labelType=cv2.DIST_LABEL_PIXEL)
    palette = image[:, :, :3][opaque]
    front_texture = palette[np.maximum(0, nearest-1)]
    yy, xx = np.mgrid[0:h, 0:w]

    def tile(box):
        x0, y0, x1, y1 = box
        patch = front_texture[y0:y1, x0:x1]
        # Mirror alternate tiles to reduce conspicuous repetition.
        patch = np.concatenate((patch, patch[:, ::-1]), axis=1)
        patch = np.concatenate((patch, patch[::-1]), axis=0)
        return patch[yy % patch.shape[0], xx % patch.shape[1]]

    # Back-of-head material is deliberately neutral: do not repeat painted facial
    # marks or a cropped hairline across the unseen back.
    rng = np.random.default_rng(27)
    noise = rng.normal(0, 1, (h, w)).astype(np.float32)
    grain = cv2.GaussianBlur(noise, (3, 31), 5)
    grain /= max(float(grain.std()), 0.001)
    fine = cv2.GaussianBlur(noise, (3, 3), 0.6)
    wood = np.clip(np.array([184, 129, 77])+grain[:, :, None]*5+
                   fine[:, :, None]*6, 0, 255).astype(np.uint8)
    hair = np.clip(np.array([44, 38, 33])+grain[:, :, None]*2+
                   fine[:, :, None]*5, 0, 255).astype(np.uint8)
    blue = tile((444, 823, 484, 865))
    linen = tile((470, 1157, 510, 1204))
    ochre = tile((412, 725, 454, 745))
    back_texture = blue.copy()
    back_texture[yy < 475] = wood[yy < 475]
    back_texture[yy < 406] = hair[yy < 406]
    ears = (yy > 238) & (yy < 335) & ((xx < 228) | (xx > 498))
    back_texture[ears] = wood[ears]
    collar = (yy > 475) & (yy < 501)
    back_texture[collar] = linen[collar]
    belt = (yy > 713) & (yy < 771)
    back_texture[belt] = ochre[belt]
    back_texture[yy > 1003] = linen[yy > 1003]
    back_texture[yy > 1384] = wood[yy > 1384]
    back_texture[yy > 1465] = ochre[yy > 1465]
    back_texture = cv2.GaussianBlur(back_texture, (3, 3), 0.45)

    # Volumes below are modelling assumptions in image pixels, not measured anatomy.
    keys = [0, 50, 180, 330, 399, 423, 468, 500, 650, 742, 830, 990, 1030, 1160, 1300, 1370, 1400, 1470, 1510]
    fd = [45, 95, 100, 87, 62, 43, 46, 70, 76, 83, 84, 84, 75, 81, 72, 45, 72, 88, 35]
    bd = [55, 120, 118, 98, 68, 47, 50, 82, 85, 88, 89, 87, 79, 85, 75, 47, 56, 57, 28]
    front_depth = np.zeros((h, w), dtype=np.float32)
    back_depth = np.zeros_like(front_depth)
    for y in range(h):
        changes = np.diff(np.r_[0, mask[y], 0].astype(np.int16))
        for left, right in zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)):
            radius = max((right-left)/2, 1)
            center = (right+left-1)/2
            x = np.arange(left, right)
            section = np.sqrt(np.maximum(0, 1-((x-center)/radius)**2))
            front_depth[y, left:right] = np.interp(y, keys, fd)*section
            back_depth[y, left:right] = np.interp(y, keys, bd)*section
    front_depth = cv2.GaussianBlur(front_depth, (17, 17), 3)
    back_depth = cv2.GaussianBlur(back_depth, (17, 17), 3)
    front_depth = np.minimum(front_depth, np.sqrt(2*105*np.maximum(inner-0.5, 0)))
    back_depth = np.minimum(back_depth, np.sqrt(2*120*np.maximum(inner-0.5, 0)))
    nose = 27*np.exp(-((xx-356)/23)**2-((yy-286)/38)**2)
    belt_relief = 12*np.exp(-((xx-345)/40)**2-((yy-744)/30)**2)
    front_depth += (nose+belt_relief)*np.minimum(inner/9, 1)
    front_depth *= mask
    back_depth *= mask
    return mask, sdf, front_depth, back_depth, [front_texture, back_texture]


def sample(field, x, y):
    x = max(0, min(field.shape[1]-1.001, x))
    y = max(0, min(field.shape[0]-1.001, y))
    ix, iy = int(x), int(y)
    a, b = x-ix, y-iy
    return float((1-b)*((1-a)*field[iy, ix]+a*field[iy, ix+1]) +
                 b*((1-a)*field[iy+1, ix]+a*field[iy+1, ix+1]))


def mesh(mask, sdf, df, db, step=11):
    h, w = mask.shape
    point_lookup, points, boundary = {}, [], []

    def vertex(p):
        x, y, edge = p
        key = (round(x, 5), round(y, 5))
        if key not in point_lookup:
            point_lookup[key] = len(points)
            points.append([x, y])
            boundary.append(edge)
        elif edge:
            boundary[point_lookup[key]] = True
        return point_lookup[key]

    def clipped(poly):
        output = []
        for a, b in zip(poly, poly[1:]+poly[:1]):
            av, bv = float(a[2]), float(b[2])
            if av >= 0:
                output.append((a[0], a[1], False))
            if (av >= 0) != (bv >= 0):
                t = av/(av-bv)
                output.append((a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1]), True))
        return output

    faces = []
    ys, xs = np.where(mask)
    for y in range(max(0, int(ys.min())-step), min(h-1, int(ys.max())+step), step):
        y2 = min(y+step, h-1)
        for x in range(max(0, int(xs.min())-step), min(w-1, int(xs.max())+step), step):
            x2 = min(x+step, w-1)
            corners = [(x, y, sdf[y, x]), (x2, y, sdf[y, x2]),
                       (x2, y2, sdf[y2, x2]), (x, y2, sdf[y2, x])]
            for tri in ([corners[0], corners[1], corners[2]],
                        [corners[0], corners[2], corners[3]]):
                poly = clipped(tri)
                if len(poly) < 3:
                    continue
                ids = [vertex(p) for p in poly]
                for k in range(1, len(ids)-1):
                    faces.append([ids[0], ids[k+1], ids[k]])
    points = np.array(points, dtype=np.float64)
    edge = np.array(boundary)
    n = len(points)
    heights = np.array([[sample(df, x, y), sample(db, x, y)] for x, y in points])
    heights[edge] = 0
    cx = (xs.min()+xs.max())/2
    positions = []
    for side in (0, 1):
        sign = 1 if side == 0 else -1
        positions.append(np.column_stack(((points[:, 0]-cx)*SCALE,
                                          (ys.max()-points[:, 1])*SCALE,
                                          heights[:, side]*SCALE*sign)))
    positions = np.concatenate(positions).astype('<f4')
    uv = np.tile(points/[w-1, h-1], (2, 1)).astype('<f4')
    ffront = np.array(faces, dtype=np.uint32)
    fback = ffront[:, ::-1]+n
    all_faces = np.concatenate((ffront, fback))
    normals = np.zeros_like(positions)
    tri = positions[all_faces]
    cross = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
    for i in range(3):
        np.add.at(normals, all_faces[:, i], cross)
    normals[:n][edge] += normals[n:][edge]
    normals[n:][edge] = normals[:n][edge]
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return positions, normals.astype('<f4'), uv, [ffront.astype('<u4'), fback.astype('<u4')]


def export_glb(positions, normals, uv, parts, textures):
    data = bytearray()
    views, accessors = [], []

    def view(blob, target=None):
        while len(data) % 4:
            data.append(0)
        start = len(data)
        data.extend(blob)
        v = {'buffer': 0, 'byteOffset': start, 'byteLength': len(blob)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views)-1

    def accessor(arr, typ, component, target):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': component,
             'count': len(arr), 'type': typ}
        if typ == 'VEC3':
            a['min'], a['max'] = arr.min(0).tolist(), arr.max(0).tolist()
        accessors.append(a)
        return len(accessors)-1

    pa = accessor(positions, 'VEC3', 5126, 34962)
    na = accessor(normals, 'VEC3', 5126, 34962)
    ua = accessor(uv, 'VEC2', 5126, 34962)
    primitives = []
    for i, faces in enumerate(parts):
        ia = accessor(faces.reshape(-1), 'SCALAR', 5125, 34963)
        primitives.append({'attributes': {'POSITION': pa, 'NORMAL': na, 'TEXCOORD_0': ua},
                           'indices': ia, 'material': i, 'mode': 4})
    images = [{'bufferView': view(jpeg_bytes(t)), 'mimeType': 'image/jpeg'} for t in textures]
    doc = {
        'asset': {'version': '2.0', 'generator': 'Image-projected approximate doll mesh',
                  'extras': {'method': 'silhouette inflation and source-image projection',
                             'limitations': 'Back and depth are invented approximations. No rig or AI reconstruction.',
                             'source': 'user-provided head_body.png',
                             'scale': '1 source pixel = 0.001 m; arbitrary preview scale, not a measurement'}},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'Doll'}],
        'meshes': [{'name': 'Doll approximate volume', 'primitives': primitives}],
        'materials': [{'name': name, 'pbrMetallicRoughness': {
            'baseColorTexture': {'index': i}, 'metallicFactor': 0, 'roughnessFactor': 0.95},
            'doubleSided': False} for i, name in enumerate(['Original front projection', 'Estimated back texture'])],
        'textures': [{'sampler': 0, 'source': i} for i in range(2)],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': images, 'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': len(data)}]}
    js = json.dumps(doc, ensure_ascii=True, separators=(',', ':')).encode()
    js += b' '*((-len(js)) % 4)
    data.extend(b'\x00'*((-len(data)) % 4))
    blob = (struct.pack('<4sII', b'glTF', 2, 12+8+len(js)+8+len(data))+
            struct.pack('<II', len(js), 0x4E4F534A)+js+
            struct.pack('<II', len(data), 0x004E4942)+data)
    path = ROOT/'인형 기초 모델.glb'
    path.write_bytes(blob)
    return path, doc


def validate(path):
    b = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', b)
    assert (magic, version, length) == (b'glTF', 2, len(b))
    jlen, jtype = struct.unpack_from('<II', b, 12)
    assert jtype == 0x4E4F534A
    doc = json.loads(b[20:20+jlen])
    blen, btype = struct.unpack_from('<II', b, 20+jlen)
    assert btype == 0x004E4942
    binary = b[28+jlen:]
    assert len(binary) == blen

    def read_accessor(index):
        a = doc['accessors'][index]
        v = doc['bufferViews'][a['bufferView']]
        dtype = {5126: '<f4', 5125: '<u4'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
        return np.frombuffer(binary, dtype=dtype, count=a['count']*width,
                             offset=v.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(-1, width)

    p = read_accessor(0)
    normal = read_accessor(1)
    texcoord = read_accessor(2)
    triangles = np.concatenate([read_accessor(pr['indices']).reshape(-1, 3)
                                for pr in doc['meshes'][0]['primitives']])
    assert np.isfinite(p).all() and np.isfinite(normal).all()
    assert np.max(np.abs(np.linalg.norm(normal, axis=1)-1)) < 0.001
    assert (texcoord >= 0).all() and (texcoord <= 1).all()
    assert triangles.max() < len(p)
    welded_positions, weld = np.unique(np.round(p, 7), axis=0, return_inverse=True)
    welded_faces = weld[triangles]
    edges = Counter(tuple(sorted((int(f[i]), int(f[(i+1) % 3]))))
                    for f in welded_faces for i in range(3))
    bad_edges = sum(v != 2 for v in edges.values())
    if bad_edges:
        print('Boundary diagnostics:', [(welded_positions[list(e)].tolist(), count)
                                       for e, count in edges.items() if count != 2])
    assert bad_edges == 0, f'{bad_edges} non-manifold edges'
    area_vectors = np.cross(p[triangles[:, 1]]-p[triangles[:, 0]],
                            p[triangles[:, 2]]-p[triangles[:, 0]])
    assert np.linalg.norm(area_vectors, axis=1).min() > 1e-12
    volume = np.einsum('ij,ij->i', p[triangles[:, 0]],
                       np.cross(p[triangles[:, 1]], p[triangles[:, 2]])).sum()/6
    assert volume > 0
    for im in doc['images']:
        v = doc['bufferViews'][im['bufferView']]
        stream = io.BytesIO(binary[v['byteOffset']:v['byteOffset']+v['byteLength']])
        Image.open(stream).verify()
    return {'vertices': len(p), 'triangles': len(triangles), 'materials': len(doc['materials']),
            'textures': len(doc['textures']), 'dimensions_m': np.ptp(p, axis=0).tolist(),
            'scale_is_arbitrary': True, 'closed_edges_after_uv_seam_welding': bad_edges == 0,
            'signed_volume_m3': float(volume), 'bytes': len(b),
            'sha256': hashlib.sha256(b).hexdigest()}


def render(positions, normals, uv, parts, textures, angle, width=490, height=960):
    a = math.radians(angle)
    rotation = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0],
                         [-math.sin(a), 0, math.cos(a)]])
    p = positions @ rotation.T
    ns = normals @ rotation.T
    factor = (height-100)/np.ptp(positions[:, 1])
    screen = np.column_stack((width/2+p[:, 0]*factor, height-54-p[:, 1]*factor))
    background = np.tile(np.linspace(247, 232, height)[:, None, None], (1, width, 3))
    buffer = background.astype(np.uint8)
    depth = np.full((height, width), -1e10)
    light = np.array([-0.35, 0.6, 0.72]); light /= np.linalg.norm(light)
    for material, faces in enumerate(parts):
        texture = textures[material]
        for indices in faces:
            if ns[indices, 2].mean() <= -0.1:
                continue
            tri = screen[indices]
            x0, y0 = np.maximum(0, np.floor(tri.min(0)).astype(int))
            x1, y1 = np.minimum([width-1, height-1], np.ceil(tri.max(0)).astype(int))
            if x1 < x0 or y1 < y0:
                continue
            x, y = np.meshgrid(np.arange(x0, x1+1)+0.5, np.arange(y0, y1+1)+0.5)
            t0, t1, t2 = tri
            det = (t1[1]-t2[1])*(t0[0]-t2[0])+(t2[0]-t1[0])*(t0[1]-t2[1])
            if abs(det) < 1e-10:
                continue
            b0 = ((t1[1]-t2[1])*(x-t2[0])+(t2[0]-t1[0])*(y-t2[1]))/det
            b1 = ((t2[1]-t0[1])*(x-t2[0])+(t0[0]-t2[0])*(y-t2[1]))/det
            b2 = 1-b0-b1
            z = b0*p[indices[0], 2]+b1*p[indices[1], 2]+b2*p[indices[2], 2]
            valid = (b0 >= -1e-5) & (b1 >= -1e-5) & (b2 >= -1e-5)
            valid &= z > depth[y0:y1+1, x0:x1+1]
            if not valid.any():
                continue
            bary = np.stack((b0[valid], b1[valid], b2[valid]), 1)
            tc = bary @ uv[indices]
            tx = np.clip(tc[:, 0]*(texture.shape[1]-1), 0, texture.shape[1]-1).astype(int)
            ty = np.clip(tc[:, 1]*(texture.shape[0]-1), 0, texture.shape[0]-1).astype(int)
            n = bary @ ns[indices]
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-8)
            shade = 0.66+0.34*np.maximum(n @ light, 0)
            buffer[y0:y1+1, x0:x1+1][valid] = np.clip(texture[ty, tx]*shade[:, None], 0, 255)
            depth[y0:y1+1, x0:x1+1][valid] = z[valid]
    return Image.fromarray(buffer)


def main():
    mask, sdf, df, db, textures = prepare()
    p, n, uv, faces = mesh(mask, sdf, df, db)
    path, _ = export_glb(p, n, uv, faces, textures)
    result = validate(path)
    shutil.copyfile(SOURCE, ROOT/'입력 원본.png')
    font = ImageFont.truetype(r'C:\Windows\Fonts\malgun.ttf', 21)
    contact = Image.new('RGB', (490*4, 1005), '#f7f7f7')
    labels = [(0, '정면'), (45, '오른쪽 45도'), (90, '오른쪽 측면'), (180, '뒷면 추정')]
    for i, (angle, label) in enumerate(labels):
        contact.paste(render(p, n, uv, faces, textures, angle), (i*490, 45))
        ImageDraw.Draw(contact).text((i*490+24, 12), label, font=font, fill='#30384a')
    contact.save(ROOT/'입체 확인.png')
    template = (ROOT/'미리보기 틀.html').read_text(encoding='utf-8')
    html = template.replace('__GLB__', base64.b64encode(path.read_bytes()).decode())
    (ROOT/'인형 미리보기.html').write_text(html, encoding='utf-8')
    script = html.split('<script>', 1)[1].split('</script>', 1)[0]
    syntax = subprocess.run(['node', '--check', '--input-type=commonjs'], input=script,
                            capture_output=True, text=True, encoding='utf-8')
    assert syntax.returncode == 0, syntax.stderr
    result['viewer_javascript_syntax'] = 'passed'
    result['viewer_browser_execution'] = 'not tested'
    result['source_copy_sha256_matches'] = (hashlib.sha256(SOURCE.read_bytes()).digest() ==
                                            hashlib.sha256((ROOT/'입력 원본.png').read_bytes()).digest())
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
