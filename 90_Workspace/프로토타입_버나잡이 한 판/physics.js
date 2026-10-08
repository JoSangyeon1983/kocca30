/* A moving rod tip against a fabric-covered spinning hoop. SI units; no RPM servo. */
(function(root) {
  'use strict';
  const V = {
    add:(a,b)=>a.map((x,i)=>x+b[i]), sub:(a,b)=>a.map((x,i)=>x-b[i]),
    mul:(a,s)=>a.map(x=>x*s), dot:(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),
    cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    len:a=>Math.hypot(...a), unit:a=>V.mul(a,1/(V.len(a)||1))
  };
  const Q = {
    mul:(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-V.dot(a.slice(0,3),b.slice(0,3))],
    conj:q=>[-q[0],-q[1],-q[2],q[3]],
    norm:q=>q.map(x=>x/Math.hypot(...q)),
    rotate:(q,v)=>Q.mul(Q.mul(q,[...v,0]),Q.conj(q)).slice(0,3),
    axis:(a,t)=>[...V.mul(V.unit(a),Math.sin(t/2)),Math.cos(t/2)]
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const DEFAULTS = Object.freeze({mass:.32,radius:.235,rimHeight:.10,rimWidth:.010,leatherRadius:.075,
    rimMassFraction:.65,leatherMassFraction:.10,leatherFriction:.20,clothFriction:.20,
    airDrag:.016,tipDrag:.0009,length:.50,handHeight:.64,
    initialRpm:210,initialTilt:2.5,initialSpeed:2.9,gestureScale:1,step:1/360,
    throwLower:0,throwLift:.12,throwPrepare:0,throwPush:.16,throwReturn:.30,throwSpeed:2.2});
  class Simulation {
    constructor(params={}) { this.p={...DEFAULTS,...params}; this.reset(); }
    reset() {
      this.time=0; this.phase=0;
      this.throwElapsed=-1;this.throwCount=0;this.catchCount=0;this.throwAirborne=false;
      this.throwAim=null;this.catchContactTime=0;
      this.lastThrowAt=-Infinity;this.lastReleaseAt=-Infinity;this.lastCatchAt=-Infinity;
      this.input={x:0,tilt:0,speed:this.p.initialSpeed}; this.hand={...this.input};
      this.q=Q.axis([0,0,1],this.p.initialTilt*Math.PI/180);
      this.tip=this.rodPose().tip; this.tipVelocity=[0,0,0];
      const axis=Q.rotate(this.q,[0,1,0]);
      this.position=[0,(V.dot(this.tip,axis)-this.profile(0))/axis[1],0];
      this.velocity=[0,0,0];
      // Hollow hoop plus two cloth faces and central leather patches.
      // Mass shares and hoop width are assumptions, not measured material properties.
      const p=this.p,inner=p.radius-p.rimWidth,half=p.rimHeight/2;
      const rimMass=p.mass*p.rimMassFraction,leatherMass=p.mass*p.leatherMassFraction;
      const clothMass=p.mass-rimMass-leatherMass;
      const rimSpin=rimMass*(p.radius**2+inner**2)/2;
      const spin=rimSpin+clothMass*inner**2/2+leatherMass*p.leatherRadius**2/2;
      const transverse=rimSpin/2+rimMass*p.rimHeight**2/12+
        clothMass*(inner**2/4+half**2)+leatherMass*(p.leatherRadius**2/4+half**2);
      this.inertia=[transverse,spin,transverse];
      this.momentum=Q.rotate(this.q,[0,this.inertia[1]*this.p.initialRpm*Math.PI/30,0]);
      this.contact=false; this.normalForce=0; this.contactRadius=0;
      this.contactPoint=null; this.grounded=false; this.spinAngle=0; this.contactSeconds=0;
      this.work=0; this.lastFriction=[0,0,0];
      return this;
    }
    setInput(values) {
      if(values.x!==undefined) this.input.x=clamp(values.x,-.42,.42);
      if(values.tilt!==undefined) this.input.tilt=clamp(values.tilt,-28,28);
      if(values.speed!==undefined) this.input.speed=clamp(values.speed,0,5);
    }
    canThrow() {
      if(this.grounded||this.throwAirborne||this.throwElapsed>=0||this.time-this.lastThrowAt<.8)return false;
      const local=Q.rotate(Q.conj(this.q),V.sub(this.tip,this.position));
      const rho=Math.hypot(local[0],local[2]);
      return rho<this.p.radius&&Math.abs(local[1]-this.profile(rho))<.004;
    }
    throwWheel() {
      if(!this.canThrow())return false;
      // One preset hand impulse acts at the actual support point. No position or spin reset.
      const local=Q.rotate(Q.conj(this.q),V.sub(this.tip,this.position));
      const r=Q.rotate(this.q,[local[0],this.profile(Math.hypot(local[0],local[2])),local[2]]);
      const jn=this.p.mass*this.p.throwSpeed;
      let friction=V.mul([this.velocity[0],0,this.velocity[2]],-this.p.mass);
      const limit=this.frictionAt(Math.hypot(local[0],local[2]))*jn;
      if(V.len(friction)>limit)friction=V.mul(friction,limit/V.len(friction));
      this.impulse(V.add([0,jn,0],friction),r);
      // Space represents a whole hand gesture: receive under the predicted landing point.
      // Moving the hand or tilting the rod during flight offsets this aim; contact can still miss.
      const flight=2*this.p.throwSpeed/9.81;
      const support=V.add(this.position,Q.rotate(this.q,[0,this.profile(0),0]));
      this.throwAim={x:support[0]+this.velocity[0]*flight,z:support[2]+this.velocity[2]*flight,
        startX:this.hand.x,startTilt:this.hand.tilt};
      this.throwElapsed=0;this.lastThrowAt=this.time;this.throwCount++;
      this.throwAirborne=true;this.lastReleaseAt=this.time;
      this.catchContactTime=0;
      this.contact=false;this.normalForce=0;this.contactPoint=null;
      return true;
    }
    throwOffset() {
      const t=this.throwElapsed,p=this.p;
      if(t<0)return 0;
      const ease=u=>(1-Math.cos(Math.PI*clamp(u,0,1)))/2;
      if(t<p.throwPrepare)return -p.throwLower*ease(t/p.throwPrepare);
      if(t<p.throwPrepare+p.throwPush)return -p.throwLower+(p.throwLift+p.throwLower)*ease((t-p.throwPrepare)/p.throwPush);
      return p.throwLift*(1-ease((t-p.throwPrepare-p.throwPush)/p.throwReturn));
    }
    rodPose() {
      const a=this.phase, h=this.hand, g=this.p.gestureScale;
      // A modest wrist gesture: translation, lift and changing direction together.
      // This is an editable approximation, not a measured inverse-cone trajectory.
      const base=[h.x+g*(.028*Math.cos(a)+.006*Math.sin(2*a)),
        this.p.handHeight+g*.002*Math.sin(2*a)+this.throwOffset(),-g*.024*Math.sin(a)];
      const direction=V.unit([Math.tan(h.tilt*Math.PI/180)+g*(-.046*Math.cos(a)-.009*Math.sin(2*a)),
        1,g*.032*Math.sin(a)]);
      if(this.throwAim){
        const age=this.time-this.lastThrowAt,catchAge=this.time-this.lastCatchAt;
        const inCatch=this.lastCatchAt>=this.lastThrowAt;
        const ease=u=>(1-Math.cos(Math.PI*clamp(u,0,1)))/2;
        const blend=ease(age/.08)*(1-ease(inCatch?catchAge/.45:(age-1.3)/.35));
        const regularTip=V.add(base,V.mul(direction,this.p.length));
        const offset=h.x-this.throwAim.startX+this.p.length*(Math.tan(h.tilt*Math.PI/180)-Math.tan(this.throwAim.startTilt*Math.PI/180));
        base[0]+=blend*(this.throwAim.x+offset-regularTip[0]);
        base[2]+=blend*(this.throwAim.z-regularTip[2]);
      }
      return {base,direction,tip:V.add(base,V.mul(direction,this.p.length))};
    }
    // A flat undeformed lower fabric face. No fixed central groove or centering force.
    profile() { return -this.p.rimHeight/2; }
    frictionAt(rho) { return rho<=this.p.leatherRadius?this.p.leatherFriction:this.p.clothFriction; }
    inverseInertia(v) {
      const b=Q.rotate(Q.conj(this.q),v);
      return Q.rotate(this.q,b.map((x,i)=>x/this.inertia[i]));
    }
    angularVelocity() { return this.inverseInertia(this.momentum); }
    impulse(j,r) {
      this.velocity=V.add(this.velocity,V.mul(j,1/this.p.mass));
      this.momentum=V.add(this.momentum,V.cross(r,j));
    }
    effectiveMass(r,d) {
      return 1/this.p.mass+V.dot(d,V.cross(this.inverseInertia(V.cross(r,d)),r));
    }
    kineticEnergy() {
      return .5*this.p.mass*V.dot(this.velocity,this.velocity)+.5*V.dot(this.momentum,this.angularVelocity());
    }
    step(dt=this.p.step) {
      const prev=this.tip.slice();
      if(this.throwElapsed>=0){this.throwElapsed+=dt;if(this.throwElapsed>=this.p.throwPrepare+this.p.throwPush+this.p.throwReturn)this.throwElapsed=-1;}
      this.hand.x+=(this.input.x-this.hand.x)*(1-Math.exp(-dt/ .14));
      this.hand.tilt+=(this.input.tilt-this.hand.tilt)*(1-Math.exp(-dt/ .16));
      this.hand.speed+=(this.input.speed-this.hand.speed)*(1-Math.exp(-dt/ .24));
      this.phase+=2*Math.PI*this.hand.speed*dt;
      this.tip=this.rodPose().tip; this.tipVelocity=V.mul(V.sub(this.tip,prev),1/dt);
      this.velocity[1]-=9.81*dt;
      this.momentum=V.mul(this.momentum,Math.exp(-this.p.airDrag*dt));
      this.contact=false; this.normalForce=0; this.contactPoint=null; this.lastFriction=[0,0,0];
      const local=Q.rotate(Q.conj(this.q),V.sub(this.tip,this.position));
      const rho=Math.hypot(local[0],local[2]);
      const surface=this.profile(rho);
      const depth=local[1]-surface;
      const localPoint=[local[0],surface,local[2]];
      const r=Q.rotate(this.q,localPoint);
      const normal=Q.rotate(this.q,[0,1,0]);
      const relative=()=>V.sub(V.add(this.velocity,V.cross(this.angularVelocity(),r)),this.tipVelocity);
      const vn=V.dot(relative(),normal);
      // Unilateral contact: the tip pushes, never pulls or welds the wheel to itself.
      if(rho<this.p.radius && depth>-.002 && depth<.035 && normal[1]>.08 && vn<Math.max(0,depth*.18/dt)+.02) {
        // Resolve the coupled normal/friction impact, without rebound energy from penetration bias.
        const impact=vn<-.3;
        const bias=Math.min(impact?.01:.15,Math.max(0,depth-.0001)*.18/dt);
        let jn=0,friction=[0,0,0];
        for(let iteration=0;iteration<6;iteration++){
          const nextJn=Math.max(0,jn+(bias-V.dot(relative(),normal))/this.effectiveMass(r,normal));
          this.impulse(V.mul(normal,nextJn-jn),r);jn=nextJn;
          const slip=relative(),tangential=V.sub(slip,V.mul(normal,V.dot(slip,normal)));
          const tangent=V.unit(tangential);
          let nextFriction=V.sub(friction,V.mul(tangent,V.len(tangential)/this.effectiveMass(r,tangent)));
          const limit=this.frictionAt(rho)*jn,length=V.len(nextFriction);
          if(length>limit)nextFriction=V.mul(nextFriction,limit/length);
          this.impulse(V.sub(nextFriction,friction),r);friction=nextFriction;
        }
        if(jn>0) {
          this.lastFriction=V.mul(friction,1/dt);
          this.normalForce=jn/dt; this.contact=true; this.contactRadius=rho;
          this.contactPoint=V.add(this.position,r);
          this.contactSeconds+=dt;
          const axis=Q.rotate(this.q,[0,1,0]);
          const spin=V.dot(this.angularVelocity(),axis);
          const drag=Math.min(Math.abs(spin)*this.inertia[1],this.p.tipDrag*jn);
          this.momentum=V.sub(this.momentum,V.mul(axis,Math.sign(spin)*drag));
          this.work+=V.dot(V.add(V.mul(normal,jn),friction),this.tipVelocity);
        }
      }
      this.position=V.add(this.position,V.mul(this.velocity,dt));
      if(this.throwCount>0&&this.time-this.lastThrowAt<2&&!this.contact&&depth<-.012&&!this.throwAirborne&&this.lastCatchAt<this.lastThrowAt){
        this.throwAirborne=true;this.lastReleaseAt=this.time;
      }
      if(this.throwAirborne){
        this.catchContactTime=this.contact&&Math.abs(this.velocity[1])<.3?this.catchContactTime+dt:0;
        if(this.catchContactTime>=.06){this.throwAirborne=false;this.catchCount++;this.lastCatchAt=this.time;}
      }
      const w=this.angularVelocity(), mag=V.len(w);
      if(mag>1e-10) this.q=Q.norm(Q.mul(Q.axis(w,mag*dt),this.q));
      this.spinAngle+=V.dot(w,Q.rotate(this.q,[0,1,0]))*dt;
      const axis=Q.rotate(this.q,[0,1,0]);
      const floorY=this.p.radius*Math.sqrt(Math.max(0,1-axis[1]**2))-this.profile(this.p.radius)*Math.abs(axis[1]);
      this.grounded=this.position[1]<floorY;
      if(this.grounded) {
        this.throwAirborne=false;
        this.position[1]=floorY;
        if(this.velocity[1]<0) this.velocity[1]*=-.08;
        this.velocity[0]*=Math.exp(-8*dt);this.velocity[2]*=Math.exp(-8*dt);
        this.momentum=V.mul(this.momentum,Math.exp(-3*dt));
      }
      this.time+=dt;
      return this;
    }
    advance(seconds) { const n=Math.round(seconds/this.p.step);for(let i=0;i<n;i++)this.step();return this; }
    snapshot() {
      const axis=Q.rotate(this.q,[0,1,0]);
      return {time:this.time,input:{...this.input},hand:{...this.hand},tip:this.tip.slice(),
        position:this.position.slice(),velocity:this.velocity.slice(),q:this.q.slice(),
        rpm:V.dot(this.angularVelocity(),axis)*30/Math.PI,
        tilt:Math.acos(clamp(axis[1],-1,1))*180/Math.PI,
        contact:this.contact,normalForce:this.normalForce,contactRadius:this.contactRadius,
        grounded:this.grounded,contactFraction:this.contactSeconds/(this.time||1),work:this.work,
        canThrow:this.canThrow(),throwElapsed:this.throwElapsed,throwCount:this.throwCount,catchCount:this.catchCount,
        throwAirborne:this.throwAirborne,lastThrowAt:this.lastThrowAt,lastReleaseAt:this.lastReleaseAt,lastCatchAt:this.lastCatchAt};
    }
  }
  const api={Simulation,V,Q,clamp,DEFAULTS};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BernaPhysics=api;
})(typeof globalThis==='object'?globalThis:this);
