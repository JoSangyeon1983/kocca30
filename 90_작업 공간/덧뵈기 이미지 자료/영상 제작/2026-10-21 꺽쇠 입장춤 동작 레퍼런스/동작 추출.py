from pathlib import Path
import cv2
from PIL import Image, ImageDraw

WORK=Path(__file__).resolve().parent
ROOT=WORK.parents[3]
source=ROOT/'90_작업 공간/덧뵈기 이미지 자료/영상자료/꺽쇠_입장춤_0.mp4'
times=[2,4,5,7,8,10,11,509/30]
cap=cv2.VideoCapture(str(source))
sheet=Image.new('RGB',(4*654,2*516),'white')
draw=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
    cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
    ok,frame=cap.read()
    if not ok: raise RuntimeError(f'Cannot read {t}')
    encoded_ok,encoded=cv2.imencode('.png',frame)
    if not encoded_ok: raise RuntimeError(f'Cannot encode {t}')
    encoded.tofile(str(WORK/f'원본 자세 {i+1:02d}.png'))
    pic=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
    x,y=i%4*654,i//4*516
    sheet.paste(pic,(x,y))
    draw.text((x+12,y+489),f'{i+1:02d} | {t:.3f} s',fill='black')
cap.release()
sheet.save(WORK/'원본 동작 8컷.jpg',quality=96)
print('Extracted 8 original-video frames in chronological order.')
