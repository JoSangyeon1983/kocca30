'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const objects = window.BEONA_DATA;
  const model = new BeonaBalance.Model(objects[0]);
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  const keys = new Set();
  const modes = { restore: '복원', hold: '유지', increase: '증가', air: '공중 복원', fall: '낙하 후 재시작' };
  const colors = { restore: '#236653', hold: '#946d27', increase: '#b66636', air: '#3b7290', fall: '#a63d36' };
  const rad = degrees => degrees * Math.PI / 180;
  let lastTime = null;
  let selected = 0;
  objects.forEach((p, i) => { const option = new Option(p.name, i); $('object-select').add(option); });
  function fillFields() {
    const p = model.params;
    for (const [id, key] of [['speed', 'tiltSpeed'], ['restore', 'restore'], ['hold', 'hold'], ['limit', 'limit']]) $(id).value = p[key];
    $('object-name').textContent = p.name;
    $('rules').innerHTML = '<strong>막대 각도의 크기로 판정</strong><br>복원 <span>0° 이상, ' + p.restore + '° 미만</span><br>유지 <span>' + p.restore + '° 이상, ' + p.hold + '° 미만</span><br>증가 <span>' + p.hold + '° 이상, ' + p.limit + '° 미만</span><br>낙하 <span>' + p.limit + '° 이상</span>';
    $('error').textContent = '';
  }
  function clearInput() { keys.clear(); document.querySelectorAll('[data-hold]').forEach(button => button.classList.remove('held')); }
  function restart() { clearInput(); model.reset(); $('rod-test').value = 0; lastTime = null; }
  $('object-select').addEventListener('change', e => { selected = Number(e.target.value); clearInput(); model.setParams(objects[selected]); fillFields(); });
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      model.setParams({ ...objects[selected], tiltSpeed: Number($('speed').value), restore: Number($('restore').value), hold: Number($('hold').value), limit: Number($('limit').value) });
      clearInput(); fillFields();
    } catch (error) { $('error').textContent = error.message; }
  });
  $('launch').addEventListener('click', () => model.launch());
  $('reset').addEventListener('click', restart);
  $('neutral').addEventListener('click', () => { model.rod = 0; $('rod-test').value = 0; });
  $('rod-test').addEventListener('input', e => { if (model.fallTime === null) model.rod = Number(e.target.value); });
  const controlKeys = new Set(['KeyA', 'KeyS', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyR']);
  document.addEventListener('keydown', e => {
    if (!controlKeys.has(e.code) || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space' && e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    if (e.code === 'Space') { if (!e.repeat) model.launch(); return; }
    if (e.code === 'KeyR') { if (!e.repeat) restart(); return; }
    keys.add(e.code);
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  document.querySelectorAll('[data-hold]').forEach(button => {
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.hold); button.classList.add('held'); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => { keys.delete(button.dataset.hold); button.classList.remove('held'); });
  });
  window.addEventListener('blur', () => { clearInput(); lastTime = null; });
  document.addEventListener('visibilitychange', () => { clearInput(); lastTime = null; });
  function ellipse(x, y, rx, ry, fill, stroke) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function drawObject(x, y) {
    const type = model.params.beonaId;
    const radius = type === 'beona_3' ? 112 : type === 'beona_2' ? 68 : 96;
    const depth = type === 'beona_1' ? 12 : 27;
    const tint = type === 'beona_1' ? '#d7ae68' : type === 'beona_2' ? '#d8ded4' : '#b7cbd0';
    ctx.save(); ctx.translate(x, y); ctx.rotate(rad(model.tilt));
    ctx.lineWidth = 2;
    ellipse(0, depth / 2, radius, 29, tint, '#69776b');
    ellipse(0, -depth / 2, radius, 29, '#f2e6cb', '#69776b');
    ctx.save(); ctx.translate(0, -depth / 2); ctx.scale(1, 29 / radius); ctx.rotate(-rad(model.spin));
    // Asymmetric marker and curved spokes make independent counterclockwise spin visible.
    ctx.strokeStyle = '#a8884b'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12);
      ctx.lineTo(Math.cos(angle + .3) * (radius - 12), Math.sin(angle + .3) * (radius - 12)); ctx.stroke();
    }
    ellipse(radius * .72, 0, 9, 9, '#a34131');
    ctx.restore();
    ellipse(0, -depth / 2, 12, 4, '#8e714b');
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0, 0, 900, 530);
    const baseX = 450 + model.x;
    const baseY = 431;
    const rodLength = 196;
    const tipX = baseX + Math.sin(rad(model.rod)) * rodLength;
    const tipY = baseY - Math.cos(rad(model.rod)) * rodLength;
    ctx.strokeStyle = '#e8e8dd'; ctx.lineWidth = 1;
    for (let x = 50; x <= 850; x += 50) { ctx.beginPath(); ctx.moveTo(x, 65); ctx.lineTo(x, 465); ctx.stroke(); }
    for (let y = 65; y <= 465; y += 50) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(860, y); ctx.stroke(); }
    ctx.fillStyle = '#eae5d9'; ctx.fillRect(40, 465, 820, 1);
    ellipse(baseX, 463, 91, 10, '#e9e7db');
    ctx.setLineDash([5, 6]); ctx.strokeStyle = '#bac4b8'; ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(baseX, 196); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineCap = 'round'; ctx.strokeStyle = '#6c4f32'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.strokeStyle = '#c3a379'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(baseX - 1, baseY - 3); ctx.lineTo(tipX - 1, tipY); ctx.stroke();
    ellipse(baseX, baseY, 13, 13, '#2d5e4d');
    if (model.fallTime !== null) {
      if (draw.fallOrigin === null) draw.fallOrigin = { x: tipX, y: tipY - 6, direction: Math.sign(model.rod) || 1 };
      const t = model.fallTime;
      drawObject(draw.fallOrigin.x + draw.fallOrigin.direction * 115 * t, draw.fallOrigin.y + 360 * t * t);
    } else { draw.fallOrigin = null; drawObject(tipX, tipY - 6 - model.height); }
    ctx.fillStyle = colors[model.mode]; ctx.font = '14px "Malgun Gothic", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(model.mode === 'fall' ? '한계값 도달, 다시 시작합니다' : model.mode === 'air' ? '공중에서 0° 방향으로 복원' : '시계 반대방향 회전 유지', 450, 40);
    ctx.fillStyle = '#6b7770'; ctx.font = '12px "Malgun Gothic", sans-serif'; ctx.fillText('← 왼쪽 (−)                        오른쪽 (+) →', 450, 506);
    $('rod-angle').textContent = model.rod.toFixed(1) + '°';
    $('beona-angle').textContent = model.tilt.toFixed(1) + '°';
    $('contact').textContent = model.fallTime !== null ? '낙하 중' : model.flightTime !== null ? '공중' : '접촉 중';
    $('mode').textContent = modes[model.mode]; $('mode').style.color = colors[model.mode];
    if (document.activeElement !== $('rod-test')) $('rod-test').value = model.rod;
  }
  draw.fallOrigin = null;
  function frame(time) {
    if (lastTime !== null && !document.hidden) {
      const dt = Math.min((time - lastTime) / 1000, .1);
      model.tick(dt, { turn: Number(keys.has('KeyS')) - Number(keys.has('KeyA')), move: Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')) });
    }
    lastTime = time; draw(); requestAnimationFrame(frame);
  }
  fillFields(); requestAnimationFrame(frame);
})();
