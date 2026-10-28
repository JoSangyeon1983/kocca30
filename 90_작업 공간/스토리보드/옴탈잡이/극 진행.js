"use strict";
(() => {
  const data = window.PLAY_DATA;
  const $ = id => document.getElementById(id);
  function showError(message) { $("load-error").hidden = false; $("load-error").textContent = message; }
  if (!data?.events?.length) { showError("극 진행 데이터를 불러오지 못했습니다. HTML과 함께 있는 파일을 확인해 주세요."); return; }
  const actors = {kkeok:$("kkeok"),omtal:$("omtal")};
  const people = {"꺽쇠":{actor:"kkeok",face:"꺽쇠 얼굴.png"},"옴탈":{actor:"omtal",face:"옴탈 얼굴.png"},"장쇠":{face:"장쇠 얼굴.png"}};
  const faceFiles = {basic:"채검_기본.png",left:"채검_좌.png",right:"채검_우.png"};
  const actionChapters = ["chase","grab","inspect","drive"];
  let index = -1, started = false, automatic = false, ended = false;
  let typing = false, letters = [], shown = 0, lastTime = 0, budget = 0, frame = 0, timer = 0, clockFrame = 0, faceTimer = 0;
  let followText = true, programmaticScroll = false, pointerStart = null;
  const scrollBox = $("text-scroll"), textNode = document.createTextNode("");
  $("speech-text").append(textNode);
  data.chapters.forEach(chapter => { const option = document.createElement("option"); option.value = chapter.id; option.textContent = chapter.label; $("chapter-select").append(option); });
  for (let i = 0; i < 10; i++) {
    const image = document.createElement("img"); image.className = "coin"; image.src = "이미지/엽전.png"; image.alt = "";
    image.style.left = (42 + i % 5 * 3) + "%";
    image.style.setProperty("--delay",(-i * .19) + "s"); image.style.setProperty("--drift",((i % 2 ? 1 : -1) * (60 + i * 18)) + "%");
    $("coins").append(image);
  }
  for (let i = 0; i < 6; i++) {
    const image = document.createElement("img"); image.className = "mask"; image.src = "이미지/옴탈 얼굴.png"; image.alt = "";
    const right = i >= 3, row = i % 3;
    image.dataset.origin = (right ? "right" : "left") + "-" + ["upper","middle","lower"][row];
    image.style.setProperty("--sx",right ? "110%" : "-10%"); image.style.setProperty("--sy",[19,43,65][row] + "%");
    image.style.setProperty("--mx",right ? "73%" : "27%"); image.style.setProperty("--apex",[11,23,38][row] + "%");
    image.style.setProperty("--turn",(right ? 25 : -25) + "deg"); image.style.setProperty("--delay",(-i * .6) + "s");
    $("masks").append(image);
  }
  function clearWork() {
    cancelAnimationFrame(frame); cancelAnimationFrame(clockFrame); clearTimeout(timer); clearInterval(faceTimer);
    frame = clockFrame = timer = faceTimer = 0; typing = false;
  }
  function setCast(event, instant) {
    $("stage").classList.toggle("instant",instant);
    for (const [key,element] of Object.entries(actors)) {
      const pose = event.cast[key], image = element.querySelector("img");
      if (element.dataset.asset !== pose.asset) { image.src = "이미지/" + pose.asset; element.dataset.asset = pose.asset; }
      element.style.left = pose.x + "%"; element.style.opacity = pose.visible ? "1" : "0";
      element.className = "actor" + (pose.motion ? " " + pose.motion : "") + (pose.snap ? " snap" : "");
      if (event.kind === "speech" && people[event.speaker].actor === key && pose.visible && !pose.motion) element.classList.add("speaking");
      element.setAttribute("aria-hidden",String(!pose.visible));
    }
    if (instant) { void $("stage").offsetHeight; $("stage").classList.remove("instant"); }
    $("curtain").classList.toggle("closed",event.blackout);
  }
  function setFace(pose) { $("inspection-image").src = "이미지/" + faceFiles[pose]; $("inspection").dataset.pose = pose; }
  function setEffects(event) {
    const fx = event.effect;
    $("peek-layer").hidden = !fx.peek || fx.peek === "none";
    $("peek-left").hidden = fx.peek !== "left"; $("peek-right").hidden = fx.peek !== "right";
    $("stage").dataset.demo = fx.demo;
    $("inspection").hidden = fx.face === "none";
    $("inspection").setAttribute("aria-hidden",String(fx.face === "none"));
    $("inspection").querySelectorAll(".gesture-arrow").forEach(arrow => { arrow.hidden = !fx.arrows; });
    if (fx.face !== "none") setFace("basic");
    if (fx.face === "cycle") {
      let pose = 0; const sequence = ["left","basic","right","basic"];
      setFace("left"); faceTimer = setInterval(() => { pose = (pose + 1) % sequence.length; setFace(sequence[pose]); },800);
    }
    $("hat-target").hidden = !fx.hat; $("coins").hidden = !fx.coins;
    $("masks").hidden = fx.demo !== "drive"; $("hit").hidden = fx.demo !== "drive";
    $("hand").hidden = fx.demo === "none"; $("hand").className = "hand " + fx.demo;
    $("hand").style.setProperty("--hand-target",event.cast.omtal.x + "%");
    const active = actionChapters.indexOf(event.chapter);
    $("action-hud").hidden = active < 0;
    [...$("steps").children].forEach((step,i) => { step.className = i === active ? "current" : i < active ? "done" : ""; if (i === active) step.setAttribute("aria-current","step"); else step.removeAttribute("aria-current"); });
    $("clock-value").textContent = "Ⅱ"; $("clock-label").textContent = "대사";
    $("clock-ring").style.strokeDashoffset = "0";
    if (active >= 0 && event.kind === "stage") {
      const begin = performance.now(); $("clock-label").textContent = "시연";
      const tick = now => {
        const remaining = Math.max(0,event.duration - (now - begin));
        $("clock-value").textContent = (remaining / 1000).toFixed(1);
        $("clock-ring").style.strokeDashoffset = String(125.664 * (1 - remaining / event.duration));
        if (remaining > 0) clockFrame = requestAnimationFrame(tick);
      };
      clockFrame = requestAnimationFrame(tick);
    }
  }
  function autoScroll() {
    if (!followText) return;
    programmaticScroll = true; scrollBox.scrollTop = scrollBox.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
  }
  function scheduleNext(delay) { clearTimeout(timer); timer = setTimeout(() => { timer = 0; advance(); },delay); }
  function finishTyping() {
    cancelAnimationFrame(frame); frame = 0; shown = letters.length; textNode.data = letters.join(""); typing = false;
    $("caret").classList.add("finished"); $("speech-state").textContent = "대사 완료"; $("next").textContent = "다음 →"; autoScroll();
    if (automatic) scheduleNext(1400);
  }
  function tick(now) {
    if (!typing) return;
    if (!lastTime) lastTime = now;
    budget += Math.min(now - lastTime,100); lastTime = now;
    const speed = Number($("speed").value);
    while (budget >= speed && shown < letters.length) { budget -= speed; textNode.appendData(letters[shown++]); }
    autoScroll();
    if (shown >= letters.length) finishTyping(); else frame = requestAnimationFrame(tick);
  }
  function render(target, instant = false) {
    clearWork(); index = target; ended = false;
    const event = data.events[index]; $("stage").dataset.eventId = event.id;
    $("stage").closest(".theatre").classList.add("has-started"); $("opening").classList.add("is-hidden");
    $("chapter-label").textContent = data.chapters.find(chapter => chapter.id === event.chapter).label;
    $("scene-label").textContent = event.section.replace(/^3\.[\d.]+\s*/,"");
    $("chapter-select").value = event.chapter;
    $("previous").disabled = !data.events.slice(0,index).some(item => item.kind === "speech"); $("next").disabled = false;
    const percent = Math.round(index / (data.events.length - 1) * 100);
    $("progress-fill").style.width = percent + "%"; $("progress").setAttribute("aria-valuenow",percent); $("position").textContent = `진행 ${percent}%`;
    setCast(event,instant); setEffects(event);
    $("direction").textContent = event.kind === "stage" ? event.text : "";
    $("direction").classList.toggle("visible",event.kind === "stage"); $("dialogue").classList.toggle("is-hidden",event.kind !== "speech");
    if (event.kind === "stage") { $("next").textContent = "다음 →"; scheduleNext(event.duration); return; }
    $("portrait").src = "이미지/" + people[event.speaker].face; $("portrait").alt = event.speaker + " 얼굴";
    $("speaker").textContent = event.speaker; $("speech-count").textContent = `${event.ordinal} / ${data.speechCount}번째 대사`;
    $("speech-state").textContent = "대사 중"; $("caret").classList.remove("finished"); $("next").textContent = "모두 표시 →";
    letters = Array.from(event.text); shown = 0; lastTime = 0; budget = 0; textNode.data = "";
    scrollBox.scrollTop = 0; followText = true; $("follow").hidden = true; typing = true; frame = requestAnimationFrame(tick);
  }
  function finishPlay() {
    clearWork(); ended = true; automatic = false; updateAuto();
    $("opening").classList.remove("is-hidden"); $("opening").querySelector(".eyebrow").textContent = "탈놀음 한바탕";
    $("opening").querySelector("h2").textContent = "막이 내렸습니다";
    $("opening").querySelector("p:not(.eyebrow)").textContent = "옴탈이 떠나고 마당에 한바탕 웃음이 남았습니다.";
    $("start").innerHTML = '다시 보기 <span aria-hidden="true">↻</span>';
    $("next").disabled = true; $("direction").classList.remove("visible"); $("dialogue").classList.add("is-hidden"); $("hand").hidden = true; $("position").textContent = "진행 100%";
  }
  function advance() { if (!started || ended) return; if (typing) { finishTyping(); return; } if (index + 1 < data.events.length) render(index + 1); else finishPlay(); }
  function begin() { started = true; render(0,true); }
  function previous() { for (let i = index - 1; i >= 0; i--) if (data.events[i].kind === "speech") { render(i,true); return; } }
  function updateAuto() { $("auto").setAttribute("aria-pressed",String(automatic)); $("auto").textContent = automatic ? "자동 진행 중" : "자동 진행"; }
  $("start").addEventListener("click",begin); $("restart").addEventListener("click",begin); $("next").addEventListener("click",advance); $("previous").addEventListener("click",previous);
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
    if (scrollBox.scrollHeight-scrollBox.clientHeight-scrollBox.scrollTop < 6) { followText = true; $("follow").hidden = true; }
  });
  $("follow").addEventListener("click",() => { followText = true; $("follow").hidden = true; autoScroll(); });
  document.addEventListener("keydown",event => {
    if (event.target.closest("button,select,input,textarea") || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (["Space","Enter","ArrowRight"].includes(event.code)) { event.preventDefault(); if (!started || ended) begin(); else advance(); }
    if (event.code === "ArrowLeft" && started) { event.preventDefault(); previous(); }
    if (event.target === scrollBox && ["ArrowUp","PageUp","Home"].includes(event.code)) stopFollowing();
  });
  $("fullscreen").addEventListener("click",async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("stage").closest("main").requestFullscreen(); }
    catch { showError("이 브라우저에서는 전체 화면을 열 수 없습니다. 창을 최대화해 주세요."); }
  });
  document.addEventListener("fullscreenchange",() => { $("fullscreen").textContent = document.fullscreenElement ? "화면 돌아오기" : "전체 화면"; });
  const names = [...Object.values(people).map(person => person.face),...Object.values(faceFiles),"옴탈_SD.png",...data.events.flatMap(event => Object.values(event.cast).map(pose => pose.asset))];
  const paths = [...new Set([...document.querySelectorAll("img[src]")].map(image => image.getAttribute("src")).concat(names.map(name => "이미지/" + name)))];
  Promise.all(paths.map(path => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(null); image.onerror = () => resolve(path); image.src = path; }))).then(results => {
    const missing = results.filter(Boolean); if (missing.length) showError("이미지를 불러오지 못했습니다: " + missing.join(", "));
  });
})();
