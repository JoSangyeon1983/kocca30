"use strict";
(() => {
  const data = window.PLAY_DATA;
  const $ = id => document.getElementById(id);
  if (!data?.events?.length) { $("load-error").hidden = false; $("load-error").textContent = "극 진행 데이터를 불러오지 못했습니다. HTML과 함께 있는 파일을 확인해 주세요."; return; }
  const actors = {park:$("park"),kkok:$("kkok"),deol:$("deol")};
  const people = {"박첨지":{actor:"park",face:"박첨지_얼굴.png"},"꼭두각시":{actor:"kkok",face:"꼭두각시_얼굴.png"},"덜머리집":{actor:"deol",face:"덜머리집_얼굴.png"},"산받이":{face:"산받이_얼굴.png"}};
  let index = -1, started = false, automatic = false, ended = false;
  let typing = false, letters = [], shown = 0, lastTime = 0, budget = 0, frame = 0, timer = 0;
  let followText = true, programmaticScroll = false;
  let pointerStart = null;
  const scrollBox = $("text-scroll"), textNode = document.createTextNode("");
  $("speech-text").append(textNode);
  data.chapters.forEach(chapter => { const option = document.createElement("option"); option.value = chapter.id; option.textContent = chapter.label; $("chapter-select").append(option); });
  function clearWork() { cancelAnimationFrame(frame); clearTimeout(timer); frame = 0; timer = 0; typing = false; }
  function setCast(event, instant) {
    $("stage").classList.toggle("instant", instant);
    for (const [key,element] of Object.entries(actors)) {
      const pose = event.cast[key];
      element.style.left = pose.x + "%";
      element.style.transform = `translateX(-50%) translateY(${pose.visible ? 0 : 105}%) rotate(${pose.angle || 0}deg)`;
      element.className = "actor" + (pose.motion ? " " + pose.motion : "");
      if (event.kind === "speech" && people[event.speaker].actor === key && pose.visible && !pose.motion) element.classList.add("speaking");
      element.setAttribute("aria-hidden", String(!pose.visible));
    }
    if (instant) { void $("stage").offsetHeight; $("stage").classList.remove("instant"); }
    $("curtain").classList.toggle("closed", Boolean(event.blackout));
  }
  function autoScroll() {
    if (!followText) return;
    programmaticScroll = true;
    scrollBox.scrollTop = scrollBox.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
  }
  function scheduleNext(delay) { clearTimeout(timer); timer = setTimeout(() => { timer = 0; advance(); }, delay); }
  function finishTyping() {
    cancelAnimationFrame(frame); frame = 0;
    shown = letters.length; textNode.data = letters.join(""); typing = false;
    $("caret").classList.add("finished"); $("speech-state").textContent = "대사 완료";
    $("next").textContent = "다음 →"; autoScroll();
    if (automatic) scheduleNext(1400);
  }
  function tick(now) {
    if (!typing) return;
    if (!lastTime) lastTime = now;
    budget += Math.min(now - lastTime, 100); lastTime = now;
    const speed = Number($("speed").value);
    while (budget >= speed && shown < letters.length) {
      budget -= speed; textNode.appendData(letters[shown++]);
    }
    autoScroll();
    if (shown >= letters.length) finishTyping(); else frame = requestAnimationFrame(tick);
  }
  function render(target, instant = false) {
    clearWork(); index = target; ended = false;
    const event = data.events[index];
    $("stage").closest(".theatre").classList.add("has-started");
    $("opening").classList.add("is-hidden");
    $("chapter-label").textContent = data.chapters.find(chapter => chapter.id === event.chapter).label;
    $("scene-label").textContent = event.section;
    $("chapter-select").value = event.chapter;
    $("previous").disabled = !data.events.slice(0,index).some(item => item.kind === "speech");
    $("next").disabled = false;
    const percent = Math.round(index / (data.events.length - 1) * 100);
    $("progress-fill").style.width = percent + "%"; $("progress").setAttribute("aria-valuenow",percent);
    $("position").textContent = `진행 ${percent}%`;
    setCast(event,instant);
    $("direction").textContent = event.kind === "stage" ? event.text : "";
    $("direction").classList.toggle("visible",event.kind === "stage");
    $("dialogue").classList.toggle("is-hidden",event.kind !== "speech");
    if (event.kind === "stage") {
      $("next").textContent = "다음 →";
      scheduleNext(event.duration);
      return;
    }
    $("portrait").src = "이미지/" + people[event.speaker].face;
    $("portrait").alt = event.speaker + " 얼굴";
    $("speaker").textContent = event.speaker;
    $("speech-count").textContent = `${event.ordinal}번째 대사`;
    $("speech-state").textContent = "대사 중";
    $("caret").classList.remove("finished");
    $("next").textContent = "모두 표시 →";
    letters = Array.from(event.text); shown = 0; lastTime = 0; budget = 0;
    textNode.data = ""; scrollBox.scrollTop = 0; followText = true; $("follow").hidden = true;
    typing = true; frame = requestAnimationFrame(tick);
  }
  function finishPlay() {
    clearWork(); ended = true; automatic = false; updateAuto();
    $("opening").classList.remove("is-hidden");
    $("opening").querySelector(".eyebrow").textContent = "꼭두각시거리";
    $("opening").querySelector("h2").textContent = "막이 내렸습니다";
    $("opening").querySelector("p:not(.eyebrow)").textContent = "한바탕 소동이 끝났습니다.";
    $("start").innerHTML = '다시 보기 <span aria-hidden="true">↻</span>';
    $("next").disabled = true; $("direction").classList.remove("visible"); $("dialogue").classList.add("is-hidden");
    $("position").textContent = "진행 100%";
  }
  function advance() {
    if (!started || ended) return;
    if (typing) { finishTyping(); return; }
    if (index + 1 < data.events.length) render(index+1); else finishPlay();
  }
  function begin() { started = true; render(0,true); }
  function previous() {
    for (let i = index - 1; i >= 0; i--) if (data.events[i].kind === "speech") { render(i,true); return; }
  }
  function updateAuto() { $("auto").setAttribute("aria-pressed",String(automatic)); $("auto").textContent = automatic ? "자동 진행 중" : "자동 진행"; }
  $("start").addEventListener("click",begin);
  $("restart").addEventListener("click",begin);
  $("next").addEventListener("click",advance);
  $("previous").addEventListener("click",previous);
  $("auto").addEventListener("click",() => {
    automatic = !automatic; updateAuto();
    if (!started || ended) { if (automatic) begin(); return; }
    if (!typing && data.events[index].kind === "speech") { if (automatic) scheduleNext(1400); else clearTimeout(timer); }
  });
  $("chapter-select").addEventListener("change",() => { started = true; render(data.chapters.find(chapter => chapter.id === $("chapter-select").value).start,true); });
  function stopFollowing() { followText = false; $("follow").hidden = false; }
  scrollBox.addEventListener("wheel",event => { if (event.deltaY < 0) stopFollowing(); },{passive:true});
  scrollBox.addEventListener("pointerdown",event => { pointerStart = {x:event.clientX,y:event.clientY,top:scrollBox.scrollTop,time:performance.now()}; });
  scrollBox.addEventListener("pointermove",event => { if (pointerStart && Math.abs(event.clientY-pointerStart.y)>8) stopFollowing(); });
  scrollBox.addEventListener("pointerup",event => {
    if (pointerStart && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<7 && Math.abs(scrollBox.scrollTop-pointerStart.top)<4 && performance.now()-pointerStart.time<500 && !getSelection()?.toString()) advance();
    pointerStart = null;
  });
  scrollBox.addEventListener("pointercancel",() => { pointerStart = null; });
  scrollBox.addEventListener("scroll",() => {
    if (programmaticScroll) return;
    const atBottom = scrollBox.scrollHeight-scrollBox.clientHeight-scrollBox.scrollTop < 6;
    if (atBottom) { followText = true; $("follow").hidden = true; }
  });
  $("follow").addEventListener("click",() => { followText = true; $("follow").hidden = true; autoScroll(); });
  document.addEventListener("keydown",event => {
    if (event.target.closest("button,select,input,textarea") || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.code === "Space" || event.code === "Enter" || event.code === "ArrowRight") { event.preventDefault(); if (!started || ended) begin(); else advance(); }
    if (event.code === "ArrowLeft" && started) { event.preventDefault(); previous(); }
    if (event.target === scrollBox && ["ArrowUp","PageUp","Home"].includes(event.code)) stopFollowing();
  });
  $("fullscreen").addEventListener("click",async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("stage").closest("main").requestFullscreen(); }
    catch { $("load-error").hidden = false; $("load-error").textContent = "이 브라우저에서는 전체 화면을 열 수 없습니다. 창을 최대화해 주세요."; }
  });
  document.addEventListener("fullscreenchange",() => { $("fullscreen").textContent = document.fullscreenElement ? "화면 돌아오기" : "전체 화면"; });
  const paths = [...new Set([...document.querySelectorAll("img[src]")].map(img => img.getAttribute("src")).concat(Object.values(people).map(person => "이미지/"+person.face)))];
  Promise.all(paths.map(path => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(null); img.onerror = () => resolve(path); img.src = path; }))).then(results => {
    const missing = results.filter(Boolean);
    if (missing.length) { $("load-error").hidden = false; $("load-error").textContent = "이미지를 불러오지 못했습니다: " + missing.join(", "); }
  });
})();
