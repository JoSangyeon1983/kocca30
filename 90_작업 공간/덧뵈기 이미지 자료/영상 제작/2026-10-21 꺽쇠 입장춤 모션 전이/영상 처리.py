from pathlib import Path
import argparse
import cv2
import hashlib
import json
import math
import numpy as np
from PIL import Image, ImageDraw
import subprocess

WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[3]
SOURCE=ROOT/'90_작업 공간/덧뵈기 이미지 자료/영상자료/꺽쇠_입장춤_0.mp4'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read_frame(cap, sec):
    cap.set(cv2.CAP_PROP_POS_MSEC, sec*1000)
    ok, frame=cap.read()
    return frame if ok else None

def foreground(frame):
    b,g,r=cv2.split(frame)
    return ~((g>130)&(g.astype(np.int16)-r>55)&(g.astype(np.int16)-b>55))

def audit(path, tag):
    cap=cv2.VideoCapture(str(path))
    fps=cap.get(cv2.CAP_PROP_FPS)
    width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    boxes=[]
    corners=[]
    first=None
    last=None
    decoded=0
    for index in range(count):
        ok,frame=cap.read()
        if not ok:
            break
        if index==0:
            first=frame.copy()
        last=frame
        decoded+=1
        mask=foreground(frame).astype('uint8')
        n,labels,stats,centers=cv2.connectedComponentsWithStats(mask,8)
        if n>1:
            c=1+np.argmax(stats[1:,cv2.CC_STAT_AREA])
            x,y,w,h,area=[int(v) for v in stats[c]]
            boxes.append(dict(frame=index,box=[x,y,w,h],center=centers[c].round(2).tolist(),
                              touches_border=x<=0 or y<=0 or x+w>=width or y+h>=height))
        corner=np.concatenate([frame[:24,:24].reshape(-1,3),frame[-24:,-24:].reshape(-1,3)])
        corners.append(corner.mean(axis=0).tolist())
    cap.release()
    for name,frame in [('start',first),('end',last)]:
        cv2.imencode('.png',frame)[1].tofile(str(WORK/f'{tag} {name}.png'))
    times=sorted(set([0,.5]+list(range(1,math.ceil(count/fps)))+[(count-1)/fps]))
    times=[t for t in times if t<=(count-1)/fps]
    cap=cv2.VideoCapture(str(path))
    sheet=Image.new('RGB',(5*256,math.ceil(len(times)/5)*280),'#eeeeee')
    draw=ImageDraw.Draw(sheet)
    for i,t in enumerate(times):
        frame=read_frame(cap,t)
        if frame is None:
            continue
        pic=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
        pic.thumbnail((252,252))
        x,y=(i%5)*256,(i//5)*280
        sheet.paste(pic,(x+(256-pic.width)//2,y))
        draw.text((x+5,y+256),f'{t:.3f}s',fill='black')
    cap.release()
    sheet.save(WORK/f'{tag} frames.jpg')
    fm,lm=foreground(first),foreground(last)
    union=fm|lm
    corner_array=np.array(corners)
    result=dict(file=str(path.relative_to(ROOT)),width=width,height=height,fps=fps,frames=count,
                duration=count/fps,decoded=decoded,bytes=path.stat().st_size,sha256=sha(path),
                square=width==height,clipped_frames=[b['frame'] for b in boxes if b['touches_border']],
                first=boxes[0],last=boxes[-1],
                box_height_range=[min(b['box'][3] for b in boxes),max(b['box'][3] for b in boxes)],
                center_x_range=[min(b['center'][0] for b in boxes),max(b['center'][0] for b in boxes)],
                corner_bgr_mean_min=corner_array.min(axis=0).round(2).tolist(),
                corner_bgr_mean_max=corner_array.max(axis=0).round(2).tolist(),
                first_last_iou=float((fm&lm).sum()/union.sum()))
    probe=subprocess.run(['ffprobe','-v','error','-show_entries',
          'format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_frames',
          '-of','json',str(path)],check=True,capture_output=True,text=True)
    result['probe']=json.loads(probe.stdout)
    (WORK/f'{tag} audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    summary=dict(result)
    summary['clipped_frame_count']=len(summary.pop('clipped_frames'))
    print(json.dumps(summary,ensure_ascii=True,indent=2))

def compare(path, offset=0, tag='comparison'):
    source_cap=cv2.VideoCapture(str(SOURCE))
    result_cap=cv2.VideoCapture(str(path))
    times=list(range(17))+[16.9666667]
    sheet=Image.new('RGB',(960,len(times)*280),'#eeeeee')
    draw=ImageDraw.Draw(sheet)
    for i,t in enumerate(times):
        for column,cap,sec in [(0,source_cap,t),(1,result_cap,t+offset)]:
            frame=read_frame(cap,sec)
            if frame is None:
                continue
            pic=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
            pic.thumbnail((470,250))
            sheet.paste(pic,(column*480+(480-pic.width)//2,i*280))
        draw.text((10,i*280+254),f'SOURCE {t:.3f}s',fill='black')
        draw.text((490,i*280+254),f'RESULT {t+offset:.3f}s',fill='black')
    source_cap.release()
    result_cap.release()
    # Two sheets keep limb correspondence legible during visual QA.
    sheet.crop((0,0,960,9*280)).save(WORK/f'{tag} 1.jpg')
    sheet.crop((0,9*280,960,18*280)).save(WORK/f'{tag} 2.jpg')

def assemble(opening,main,ending,out):
    # Main dance is mapped 1:1 in time. Only the two 3-second transitions are retimed.
    command=['ffmpeg','-y','-i',str(opening),'-i',str(main),'-i',str(ending),
        '-filter_complex',
        '[0:v]setpts=0.5*(PTS-STARTPTS),scale=1080:1080,setsar=1,fps=30,format=yuv420p[a];'
        '[1:v]setpts=PTS-STARTPTS,scale=1080:1080,setsar=1,fps=30,format=yuv420p[b];'
        '[2:v]setpts=0.5*(PTS-STARTPTS),scale=1080:1080,setsar=1,fps=30,format=yuv420p[c];'
        '[a][b][c]concat=n=3:v=1:a=0[v]',
        '-map','[v]','-an','-c:v','libx264','-crf','16','-preset','medium',
        '-pix_fmt','yuv420p','-movflags','+faststart',str(out)]
    subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    audit(out,'delivery')

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('mode',choices=['audit','compare','assemble'])
    p.add_argument('paths',nargs='+')
    p.add_argument('--offset',type=float,default=0)
    p.add_argument('--tag',default='comparison')
    args=p.parse_args()
    paths=[Path(x).resolve() for x in args.paths]
    if args.mode=='audit':
        audit(paths[0],args.paths[1] if len(args.paths)>1 else 'main')
    elif args.mode=='compare':
        compare(paths[0],args.offset,args.tag)
    else:
        assemble(*paths)
