from pathlib import Path
import cv2
import numpy as np
import subprocess
import json
from PIL import Image, ImageDraw

WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[3]
SOURCE=ROOT/'90_작업 공간/덧뵈기 이미지 자료/영상자료/꺽쇠_입장춤_0.mp4'
cap=cv2.VideoCapture(str(SOURCE))
fps=cap.get(cv2.CAP_PROP_FPS)
frames=[]
while True:
    ok,f=cap.read()
    if not ok: break
    frames.append(f)
cap.release()
h,w=frames[0].shape[:2]
mask=np.full((h,w),255,np.uint8)
mask[:,int(w*.26):int(w*.76)]=0
mask[int(h*.84):]=0
transform=np.eye(3)
transforms=[transform.copy()]
stats=[]
for i in range(1,len(frames)):
    previous=cv2.cvtColor(frames[i-1],cv2.COLOR_BGR2GRAY)
    current=cv2.cvtColor(frames[i],cv2.COLOR_BGR2GRAY)
    points=cv2.goodFeaturesToTrack(previous,500,.008,6,mask=mask)
    after,status,err=cv2.calcOpticalFlowPyrLK(previous,current,points,None,winSize=(25,25),maxLevel=4)
    good=status.ravel()==1
    before=points[good]
    after=after[good]
    affine,inliers=cv2.estimateAffinePartial2D(before,after,method=cv2.RANSAC,ransacReprojThreshold=1.5,maxIters=3000,confidence=.995)
    if affine is None: raise RuntimeError(f'No camera transform at {i}')
    step=np.eye(3)
    step[:2]=affine
    transform=step@transform
    transforms.append(transform.copy())
    stats.append(dict(frame=i,inliers=int(inliers.sum()),scale=float(np.hypot(transform[0,0],transform[1,0]))))

# Remove slow subject translation from the camera pan, retaining faster dance motion.
centers=[]
anchor_x=[320,310,312,312,310,218,312,327,303,325,340,336,320,318,320,320,320,320]
anchor_y=[265,316,305,305,305,320,316,316,316,316,316,320,316,316,316,316,316,316]
for i,frame in enumerate(frames):
    gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    binary=(gray>105).astype(np.uint8)
    binary[:55]=0
    binary[:,:75]=0
    binary[:,560:]=0
    binary=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
    n,labels,boxes,means=cv2.connectedComponentsWithStats(binary,8)
    pt=np.array([np.interp(i/fps,np.arange(18),anchor_x),np.interp(i/fps,np.arange(18),anchor_y),1.])
    centers.append((np.linalg.inv(transforms[i])@pt)[:2])
centers=np.array(centers)
kernel=np.exp(-.5*(np.arange(-66,67)/22)**2)
kernel/=kernel.sum()
trend=np.column_stack([np.convolve(np.pad(centers[:,k],(66,66),mode='edge'),kernel,mode='valid') for k in range(2)])
size=720
scale=1.75
canvases=[np.array([[scale,0,size/2-scale*pt[0]],[0,scale,size*.5-scale*pt[1]],[0,0,1.]]) for pt in trend]
temp=WORK/'固定 camera temp.mp4'
writer=cv2.VideoWriter(str(temp),cv2.VideoWriter_fourcc(*'mp4v'),fps,(size,size))
samples=[]
for i,(frame,matrix,canvas) in enumerate(zip(frames,transforms,canvases)):
    fixed=cv2.warpAffine(frame,(canvas@np.linalg.inv(matrix))[:2],(size,size),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(60,60,60))
    writer.write(fixed)
    if i%30==0 or i==len(frames)-1: samples.append((i,fixed))
writer.release()
out=WORK/'카메라 보정 정사각형 참조.mp4'
subprocess.run(['ffmpeg','-y','-i',str(temp),'-an','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(out)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
temp.unlink()
sheet=Image.new('RGB',(4*300,((len(samples)+3)//4)*325),'#eeeeee')
d=ImageDraw.Draw(sheet)
for j,(i,f) in enumerate(samples):
    pic=Image.fromarray(cv2.cvtColor(f,cv2.COLOR_BGR2RGB)).resize((300,300))
    x,y=j%4*300,j//4*325
    sheet.paste(pic,(x,y))
    d.text((x+8,y+304),f'{i/fps:.3f}s',fill='black')
sheet.save(WORK/'카메라 보정 관찰.jpg')
(WORK/'camera transforms.json').write_text(json.dumps(dict(fps=fps,frames=len(frames),canvases=[m.tolist() for m in canvases],centers=centers.tolist(),transforms=[m.tolist() for m in transforms],stats=stats),indent=2),encoding='utf-8')
print(json.dumps(dict(frames=len(frames),fps=fps,width=size,height=size,duration=len(frames)/fps,camera_scale_range=[min(x['scale'] for x in stats),max(x['scale'] for x in stats)],min_inliers=min(x['inliers'] for x in stats))))
