from pathlib import Path
from PIL import Image
import hashlib,json
entries=json.loads("[[\"01\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-02838d7a-123b-4f74-861d-37d695228ab1.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/01.png\"],[\"02\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-222bd0a5-f3c3-4963-ba51-00b9c938476a.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/02.png\"],[\"03\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-3b4db15c-5f09-4d55-80b2-c15adbd17736.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/03.png\"],[\"04\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-9a7e9c46-e3a6-4546-96c3-4815f7fad5af.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/04.png\"],[\"05\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-503bb2bd-2545-4f70-8e58-b0ed203f7a71.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/05.png\"],[\"06\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-1105b420-1afb-42d8-853c-80ecd9c08c86.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/06.png\"],[\"07\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-ecd1b553-1c13-4f1a-b8b2-db839c1be3cf.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/07.png\"],[\"08\",\"C:\\\\Users\\\\cellbig\\\\.codex\\\\generated_images\\\\01a15c31-23d7-79f3-a1df-fd041ac38d84\\\\exec-f760d49b-8843-443c-8985-b96172fb12c8.png\",\"06_자산/이미지/덧뵈기/꺽쇠 입장춤/동작 러프 개별/08.png\"]]")
for key,source,dest in entries:
 p=Path(dest)
 with Image.open(p) as im:
  im.load()
  print(json.dumps({'key':key,'size':im.size,'mode':im.mode,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'same_as_generated':p.read_bytes()==Path(source).read_bytes()},ensure_ascii=True))
p=Path('06_자산/이미지/덧뵈기/꺽쇠 입장춤/꺽쇠 입장춤 시작과 종료.png')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='53223b9802f580a3ca6ca5aa2e0c3d7b86150b4655999b70a337764636158025'
print('BOOKEND_UNCHANGED')

