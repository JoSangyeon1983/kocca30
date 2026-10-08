(function() {
  'use strict';
  const {Simulation,V,Q,clamp}=BernaPhysics;
  const sim=new Simulation();
  const $=id=>document.getElementById(id);
  const canvas=$('scene'),ctx=canvas.getContext('2d'),chart=$('chart'),gc=chart.getContext('2d');
  const keyActions={ArrowLeft:'left',ArrowRight:'right',KeyA:'tiltLeft',KeyD:'tiltRight',KeyW:'faster',KeyS:'slower'};
  const keys=new Set(),heldPointers=new Map(),path=[],samples=[];
  let paused=false,view='perspective',last=0,accumulator=0,nextSample=0;
  let width=0,height=0,dpr=1,drag=null,lastStatus='';
  const fields={position:'x',tilt:'tilt',speed:'speed'};
  for(const [id,field] of Object.entries(fields)) $(id).addEventListener('input',()=>{sim.setInput({[field]:Number($(id).value)});updateUI();});
  function clearHeld() {
    keys.clear();heldPointers.clear();
    document.querySelectorAll('[data-action]').forEach(b=>b.classList.remove('active'));
  }
  function reset() {
    clearHeld();sim.reset();path.length=0;samples.length=0;nextSample=0;accumulator=0;
    updateUI();draw();
  }
  function togglePause() {
    paused=!paused;clearHeld();accumulator=0;updateUI();
  }
  function performThrow() {
    if(sim.throwWheel()){paused=false;accumulator=0;}
    updateUI();
  }
  $('throw').addEventListener('click',performThrow);
  $('pause').addEventListener('click',togglePause);$('reset').addEventListener('click',reset);
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    view=b.dataset.view;
    document.querySelectorAll('[data-view]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});draw();
  }));
  const editing=target=>target instanceof HTMLElement && (target.isContentEditable||target.matches('textarea,select,input:not([type="range"])'));
  window.addEventListener('keydown',e=>{
    if(editing(e.target))return;
    if(keyActions[e.code]){e.preventDefault();keys.add(e.code);}
    if(e.code==='Space'){e.preventDefault();if(!e.repeat)performThrow();}
    if(e.code==='KeyP'){e.preventDefault();if(!e.repeat)togglePause();}
    if(e.code==='KeyR'){e.preventDefault();if(!e.repeat)reset();}
  });
  window.addEventListener('keyup',e=>{keys.delete(e.code);});
  window.addEventListener('blur',()=>{clearHeld();drag=null;canvas.classList.remove('dragging');});
  document.addEventListener('visibilitychange',()=>{clearHeld();last=0;accumulator=0;});
  document.querySelectorAll('[data-action]').forEach(b=>{
    b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);heldPointers.set(e.pointerId,b.dataset.action);b.classList.add('active');});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,e=>{heldPointers.delete(e.pointerId);b.classList.remove('active');});
  });
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();canvas.focus();canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');
    drag={id:e.pointerId,start:e.clientX,value:e.shiftKey?sim.input.tilt:sim.input.x,tilt:e.shiftKey};
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const dx=(e.clientX-drag.start)/canvas.getBoundingClientRect().width;
    sim.setInput(drag.tilt?{tilt:drag.value+dx*80}:{x:drag.value+dx*1.05});updateUI();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drag=null;canvas.classList.remove('dragging');});
  $('export').addEventListener('click',()=>{
    const header='time_s,hand_speed_hz,hand_x_m,rod_tilt_deg,wheel_rpm,wheel_tilt_deg,contact,normal_force_N,wheel_x_m,wheel_y_m,wheel_z_m,throw_count,catch_count,airborne,rod_tip_y_m';
    const csv=[header,...samples.map(s=>[s.time.toFixed(3),s.hand.speed.toFixed(4),s.hand.x.toFixed(4),s.hand.tilt.toFixed(4),s.rpm.toFixed(3),s.tilt.toFixed(3),Number(s.contact),s.normalForce.toFixed(4),...s.position.map(v=>v.toFixed(5)),s.throwCount,s.catchCount,Number(s.throwAirborne),s.tip[1].toFixed(5)].join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='버나잡이_관찰기록.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  function applyActions(dt) {
    const active=new Set([...Array.from(keys,c=>keyActions[c]),...heldPointers.values()]);
    const diff=(positive,negative)=>Number(active.has(positive))-Number(active.has(negative));
    sim.setInput({x:sim.input.x+diff('right','left')*.12*dt,
      tilt:sim.input.tilt+diff('tiltRight','tiltLeft')*12*dt,
      speed:sim.input.speed+diff('faster','slower')*.6*dt});
    document.querySelectorAll('[data-action]').forEach(b=>b.classList.toggle('active',active.has(b.dataset.action)));
  }
  function updateUI() {
    const s=sim.snapshot();
    for(const [id,field] of Object.entries(fields))$(id).value=sim.input[field];
    $('speedValue').textContent=sim.input.speed.toFixed(2)+'회/초';
    $('tiltValue').textContent=sim.input.tilt.toFixed(1)+'°';
    $('positionValue').textContent=(sim.input.x*100).toFixed(1)+'cm';
    $('rpm').innerHTML=s.rpm.toFixed(0)+' <small>rpm</small>';
    $('wheelTilt').innerHTML=s.tilt.toFixed(1)+' <small>°</small>';
    $('time').textContent=s.time.toFixed(1)+'초';
    $('pause').textContent=paused?'계속 돌리기':'일시정지';
    $('throw').disabled=!s.canThrow;
    const status=paused?'일시정지':s.grounded?'바닥에 떨어짐':s.throwElapsed>=0&&s.throwElapsed<sim.p.throwPush?'던지는 중':s.throwAirborne?(s.contact?'받는 중':s.velocity[1]>.1?'공중 회전, 올라가는 중':s.velocity[1]<-.1?'공중 회전, 내려오는 중':'공중 회전'):s.time-s.lastCatchAt<.7?'다시 받아 돌리는 중':s.contact?'막대 위에서 회전':s.position[1]<.9?'지지에서 벗어남':'돌리는 중';
    if(status!==lastStatus){$('state').textContent=status;lastStatus=status;}
    $('state').style.color=s.grounded?'#985044':'#48756c';
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const cr=chart.getBoundingClientRect();chart.width=Math.round(cr.width*dpr);chart.height=Math.round(cr.height*dpr);
    draw();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function camera() {
    const lift=Math.max(0,sim.position[1]-1.16),follow=lift*.5;
    const target=view==='top'?[0,.95,0]:[0,.72+follow,0];
    const eye=view==='front'?[0,.90+follow,3.3]:view==='top'?[.03,3.6+lift,.04]:[1.1,1.65+follow,3.1];
    const forward=V.unit(V.sub(target,eye));
    const right=V.unit(V.cross(forward,view==='top'?[0,0,-1]:[0,1,0]));
    return {eye,forward,right,up:V.cross(right,forward),focal:Math.min(width*2.7,height*2.5)/(view==='top'?1:1+lift*.9)};
  }
  function draw() {
    if(!width||!height)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const bg=ctx.createLinearGradient(0,0,0,height);bg.addColorStop(0,'#f4f0e7');bg.addColorStop(1,'#e4dccb');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    const cam=camera();
    const project=p=>{const d=V.sub(p,cam.eye),z=V.dot(d,cam.forward);return {x:width/2+V.dot(d,cam.right)*cam.focal/z,y:height*.49-V.dot(d,cam.up)*cam.focal/z,z};};
    const poly=(pts,color,stroke)=>{
      const p=pts.map(project);if(p.some(v=>v.z<.1))return;
      ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(const v of p.slice(1))ctx.lineTo(v.x,v.y);ctx.closePath();ctx.fillStyle=color;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.6;ctx.stroke();}
    };
    const line=(a,b,color,size)=>{const p=project(a),q=project(b);if(p.z<.1||q.z<.1)return;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=color;ctx.lineWidth=size;ctx.lineCap='round';ctx.stroke();};
    poly([[-2,0,-1.8],[2,0,-1.8],[2,0,2],[-2,0,2]],'#e3dac7');
    for(let z=-1.6;z<=1.5;z+=.25)line([-2,0,z],[2,0,z],'#d9ceb9',.5);
    for(let x=-1.8;x<=1.8;x+=.30)line([x,0,-1.8],[x,0,2],'#d9ceb9',.5);
    // A soft ground shadow changes with the independently simulated wheel position.
    const shadow=[];for(let i=0;i<64;i++){const a=i/64*Math.PI*2;shadow.push([sim.position[0]+Math.cos(a)*sim.p.radius,0.001,sim.position[2]+Math.sin(a)*sim.p.radius*.75]);}
    poly(shadow,'rgba(99,77,47,'+(sim.grounded?.18:.07)+')');
    if($('showPath').checked&&path.length>1){for(let i=1;i<path.length;i++)line(path[i-1],path[i],'rgba(152,80,68,'+(.08+.35*i/path.length)+')',1.2);}
    const shapes=[];
    const add=(points,color,stroke)=>shapes.push({z:points.reduce((s,p)=>s+project(p).z,0)/points.length,draw:()=>poly(points,color,stroke)});
    const addLine=(a,b,color,size)=>shapes.push({z:(project(a).z+project(b).z)/2,draw:()=>line(a,b,color,size)});
    const pose=sim.rodPose(),b=pose.base,t=pose.tip;
    // A wrist and forearm visibly move with the rod, with a stable grip at its base.
    const elbow=[b[0]-.14,b[1]-.22,b[2]+.20],wrist=V.add(b,[-.028,-.023,.018]);
    const scale=cam.focal/project(b).z;
    addLine(elbow,wrist,'#d6cdbd',scale*.088);
    addLine(V.add(elbow,[.005,0,-.018]),wrist,'#eee6d8',scale*.065);
    addLine(wrist,V.add(b,[.023,.019,0]),'#c59170',scale*.059);
    addLine(V.add(wrist,[.009,0,.008]),V.add(b,[.017,.013,.012]),'#e0b394',scale*.040);
    addLine(V.add(b,V.mul(pose.direction,-.075)),t,'#7b5934',scale*.010);
    addLine(V.add(b,V.mul(pose.direction,-.075)),t,'#b0915a',scale*.004);
    for(let i=0;i<3;i++)addLine(V.add(b,[-.022,.004+i*.011,.018]),V.add(b,[.016,.006+i*.011,.021]),'#c18d6b',scale*.009);
    const transform=v=>V.add(sim.position,Q.rotate(sim.q,v));
    const R=sim.p.radius,N=64,inner=R-sim.p.rimWidth,leather=sim.p.leatherRadius;
    const half=sim.p.rimHeight/2;
    const face=(r,a,side)=>transform([r*Math.cos(a),side*half,r*Math.sin(a)]);
    const bodyEye=Q.rotate(Q.conj(sim.q),V.sub(cam.eye,sim.position));
    for(let i=0;i<N;i++) {
      const a=i/N*Math.PI*2,aa=(i+1)/N*Math.PI*2;
      const mid=(a+aa)/2;
      if(bodyEye[0]*Math.cos(mid)+bodyEye[2]*Math.sin(mid)<=R)continue;
      const light=.5+.5*Math.cos(mid-.7);
      const tone='rgb('+[125+28*light,96+26*light,60+22*light].map(Math.round).join(',')+')';
      add([face(R,a,1),face(R,a,-1),face(R,aa,-1),face(R,aa,1)],tone,tone);
    }
    // Draw the visible cap as one plane so tessellation cannot create radial cracks or a false dome.
    const side=bodyEye[1]>=0?1:-1;
    const circle=r=>Array.from({length:N},(_,i)=>face(r,i/N*Math.PI*2,side));
    shapes.push({z:project(transform([0,side*half,0])).z,draw:()=>{
      poly(circle(R),side>0?'#ac946b':'#8d724d','#735d40');
      poly(circle(inner),side>0?'#e0d5bb':'#c8b99a');
      const ink=side>0?'#c7b99b':'#b2a17e',spacing=.014;
      for(let offset=-inner+spacing;offset<inner;offset+=spacing) {
        const extent=Math.sqrt(inner**2-offset**2);
        line(transform([offset,side*half,-extent]),transform([offset,side*half,extent]),ink,.4);
        line(transform([-extent,side*half,offset]),transform([extent,side*half,offset]),ink,.4);
      }
      // Coplanar central leather overlay on each face; no raised center or built-in groove.
      poly(circle(leather),side>0?'#9e7553':'#866346','#755236');
      for(let i=0;i<N;i++) {
        const a=i/N*Math.PI*2,aa=(i+1)/N*Math.PI*2;
        if(i<5)poly([face(inner,a,side),face(R,a,side),face(R,aa,side),face(inner,aa,side)],'#934c40');
        line(face(leather-.004,a,side),face(leather-.004,a+.045,side),'#dfc4a0',.65);
        line(face(inner,a,side),face(inner,aa,side),'#b8a484',.7);
        // Parallel cloth-layer edges around the hoop, an illustrative material detail.
        for(const inset of [.0015,.003]) {
          const edge=(angle)=>transform([R*Math.cos(angle),side*(half-inset),R*Math.sin(angle)]);
          if(bodyEye[0]*Math.cos((a+aa)/2)+bodyEye[2]*Math.sin((a+aa)/2)>R)line(edge(a),edge(aa),'#c7b99b',.5);
        }
      }
    }});
    shapes.sort((a,b)=>b.z-a.z);for(const s of shapes)s.draw();
    if($('showContact').checked&&sim.contactPoint&&sim.contact){const p=project(sim.contactPoint);ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#47776d';ctx.fill();ctx.strokeStyle='#fffaf1';ctx.lineWidth=1.5;ctx.stroke();}
    drawChart();
  }
  function drawChart() {
    const w=chart.width/dpr,h=chart.height/dpr;if(!w||!h)return;
    gc.setTransform(dpr,0,0,dpr,0,0);gc.clearRect(0,0,w,h);
    gc.strokeStyle='#ece5d9';gc.lineWidth=1;
    for(let y=8;y<h;y+=18){gc.beginPath();gc.moveTo(0,y);gc.lineTo(w,y);gc.stroke();}
    const recent=samples.filter(s=>s.time>=sim.time-20);
    const maxRpm=Math.max(300,...recent.map(s=>Math.abs(s.rpm)));
    for(const [field,color,max] of [['rpm','#985044',maxRpm],['tilt','#48756c',90]]){
      gc.beginPath();let first=true;
      for(const s of recent){const x=w*(s.time-Math.max(0,sim.time-20))/20,y=h-5-clamp(Math.abs(s[field])/max,0,1)*(h-10);if(first){gc.moveTo(x,y);first=false;}else gc.lineTo(x,y);}
      gc.lineWidth=1.6;gc.strokeStyle=color;gc.stroke();
    }
  }
  function frame(now) {
    if(!last)last=now;const elapsed=Math.min(.08,(now-last)/1000);last=now;
    if(!document.hidden)applyActions(elapsed);
    if(!paused&&!document.hidden){
      accumulator+=elapsed;
      while(accumulator>=sim.p.step){sim.step();accumulator-=sim.p.step;}
      if(sim.time>=nextSample){
        samples.push(sim.snapshot());path.push(sim.tip.slice());
        if(path.length>45)path.shift();
        if(samples.length>36000)samples.shift();nextSample=sim.time+.05;
      }
    }
    updateUI();draw();requestAnimationFrame(frame);
  }
  // Read-only state for repeatable browser QA.
  window.bernaDiagnostics=()=>({...sim.snapshot(),paused,view,samples:samples.length,
    held:keys.size+heldPointers.size,params:{...sim.p}});
  reset();resize();requestAnimationFrame(frame);
})();
