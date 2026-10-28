from pathlib import Path
import cv2
import json
import hashlib
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
WORK = Path(__file__).resolve().parent
SOURCE = ROOT / '90_작업 공간/덧뵈기 이미지 자료/영상자료/꺽쇠_등장.mp4'
STILL = ROOT / '08_산출물/덧뵈기/서 있는 캐릭터/꺽쇠 서 있는 자세.png'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def contact(path, times, output, columns=5):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    info = dict(path=str(path.relative_to(ROOT)), fps=fps, frames=count,
                duration=count/fps, width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), sha256=sha(path))
    sheet = Image.new('RGB', (columns*300, ((len(times)+columns-1)//columns)*244), '#eeeeee')
    draw = ImageDraw.Draw(sheet)
    for index, sec in enumerate(times):
        cap.set(cv2.CAP_PROP_POS_MSEC, sec*1000)
        ok, frame = cap.read()
        if not ok:
            continue
        pic = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        pic.thumbnail((296,218))
        x,y = (index%columns)*300, (index//columns)*244
        sheet.paste(pic, (x+(300-pic.width)//2,y))
        draw.text((x+8,y+222),f'{sec:.2f} s',fill='black')
    cap.release()
    sheet.save(output)
    return info

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'keyframe':
        key_path=WORK/(sys.argv[2] if len(sys.argv)>2 else '크로마키 기준 프레임.png')
        im=Image.open(key_path).convert('RGB')
        a=np.array(im)
        green=(a[:,:,1]>140)&(a[:,:,1].astype(int)-a[:,:,0]>65)&(a[:,:,1].astype(int)-a[:,:,2]>65)
        ys,xs=np.where(~green)
        print(json.dumps(dict(size=im.size,sha256=sha(key_path),
                              corner_rgb=a[:30,:30].mean(axis=(0,1)).round(2).tolist(),
                              foreground_box=[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]),ensure_ascii=True))
        raise SystemExit(0)
    if len(sys.argv) > 1 and sys.argv[1] == 'result':
        target = Path(sys.argv[2]).resolve()
        capture = cv2.VideoCapture(str(target))
        fps = capture.get(cv2.CAP_PROP_FPS)
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        last_time=(count-1)/fps
        times=[0,0.5]+[i for i in range(1,int(last_time)+1) if i<last_time]+[last_time]
        info = contact(target, times, WORK/'생성 영상 관찰.jpg',4)
        measurements=[]
        for index in range(count):
            ok, frame = capture.read()
            if not ok:
                break
            b,g,r=cv2.split(frame)
            green=(g>140)&(g.astype(int)-r>65)&(g.astype(int)-b>65)
            foreground=(~green).astype('uint8')
            number,labels,stats,centers=cv2.connectedComponentsWithStats(foreground,8)
            if number < 2:
                measurements.append({'frame':index,'missing':True})
                continue
            component=1+np.argmax(stats[1:,cv2.CC_STAT_AREA])
            x,y,w,h,area=[int(n) for n in stats[component]]
            sample=np.concatenate([frame[:30,:30].reshape(-1,3),frame[-30:,-30:].reshape(-1,3)])
            measurements.append(dict(frame=index,box=[x,y,w,h],center=[float(n) for n in centers[component]],
                          background_bgr=sample.mean(axis=0).round(2).tolist(),
                          green_ratio=float(green.mean()),clipped=x==0 or y==0 or x+w>=width or y+h>=height))
            if index in (0,count-1):
                cv2.imencode('.png',frame)[1].tofile(str(WORK/('시작 프레임.png' if index==0 else '종료 프레임.png')))
        capture.release()
        valid=[m for m in measurements if 'box' in m]
        first_img=cv2.imdecode(np.fromfile(str(WORK/'시작 프레임.png'),dtype=np.uint8),cv2.IMREAD_COLOR)
        last_img=cv2.imdecode(np.fromfile(str(WORK/'종료 프레임.png'),dtype=np.uint8),cv2.IMREAD_COLOR)
        def mask(img):
            b,g,r=cv2.split(img)
            return ~((g>140)&(g.astype(int)-r>65)&(g.astype(int)-b>65))
        first_mask,last_mask=mask(first_img),mask(last_img)
        union=first_mask|last_mask
        summary=dict(decoded=len(measurements),total=count,clipped_frames=[m['frame'] for m in valid if m['clipped']],
                     center_x_range=[min(m['center'][0] for m in valid),max(m['center'][0] for m in valid)],
                     corner_green_bgr_range=[[min(m['background_bgr'][i] for m in valid),max(m['background_bgr'][i] for m in valid)] for i in range(3)],
                     min_green_fraction=min(m['green_ratio'] for m in valid),first=valid[0],last=valid[-1],
                     first_last_silhouette_iou=float((first_mask&last_mask).sum()/union.sum()),
                     first_last_mean_abs_rgb_diff_on_union=float(np.abs(first_img.astype(float)-last_img.astype(float))[union].mean()))
        report={'video':info,'checks':summary}
        # Detailed frame measurements are retained only in the Markdown verification record.
        (WORK/'검수 수치 임시.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=True,indent=2))
        raise SystemExit(0)
    if len(sys.argv) > 1 and sys.argv[1] == 'clip':
        out = WORK/'동작 참조 30초부터 40초.mp4'
        subprocess.run(['ffmpeg','-y','-ss','30','-i',str(SOURCE),'-t','10',
                        '-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',
                        '-movflags','+faststart',str(out)],check=True,
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        print(json.dumps({'clip':str(out),'sha256':sha(out)},ensure_ascii=True))
        raise SystemExit(0)
    info = contact(SOURCE, list(range(0,45,2)), WORK/'원본 영상 관찰.jpg')
    im = Image.open(STILL)
    print(json.dumps({'source':info, 'still':{'size':im.size,'mode':im.mode,
          'bbox':im.getbbox(),'sha256':sha(STILL)}},ensure_ascii=False,indent=2))
