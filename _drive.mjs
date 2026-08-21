import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 640 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
const names = ["monaco","shanghai","silverstone","red-dune","glacier-loop","magma-eight"];
for (let idx=0; idx<6; idx++){
  await p.goto('http://localhost:5173/games/car-race/?dbg=1', { waitUntil:'networkidle' });
  await p.waitForFunction(() => window.__game && document.querySelectorAll('.map-chip').length>0, {timeout:5000}).catch(()=>{});
  // select track idx and start
  await p.evaluate((i)=>{ const chips=document.querySelectorAll('.map-chip'); if(chips[i]) chips[i].click(); }, idx);
  await p.waitForTimeout(200);
  await p.evaluate(()=>{ document.querySelector('#overlay-button')?.click(); });
  await p.waitForTimeout(3300); // countdown -> racing
  // install autopilot
  await p.evaluate(()=>{
    window.__prog=0; window.__prev=0; window.__stuck=0; window.__lastpos=null;
    window.__ap = setInterval(()=>{
      const g=window.__game; if(!g||g.state!=='racing') return;
      const c=g.car; const pr=g.track.progressAt(c.x,c.y, window.__s);
      window.__s=pr.s;
      const tgt=g.track.pointAt((pr.s+0.045)%1);
      let err=Math.atan2(tgt.y-c.y,tgt.x-c.x)-c.angle;
      while(err>Math.PI)err-=2*Math.PI; while(err<-Math.PI)err+=2*Math.PI;
      g.keys.up=true; g.keys.down=false; g.keys.left=err<-0.07; g.keys.right=err>0.07;
      const prog=g.lap+pr.s;
      if(prog>window.__prog)window.__prog=prog;
      // stuck detection: position barely moved
      if(window.__lastpos){const d=Math.hypot(c.x-window.__lastpos.x,c.y-window.__lastpos.y); if(d<1.2)window.__stuck++; else window.__stuck=0;}
      window.__lastpos={x:c.x,y:c.y};
    },40);
  });
  // poll ~22s
  let maxStuck=0, res=null;
  for(let t=0;t<11;t++){
    await p.waitForTimeout(2000);
    res = await p.evaluate(()=>({prog:window.__prog, stuck:window.__stuck, lap:window.__game?.lap, state:window.__game?.state}));
    maxStuck=Math.max(maxStuck,res.stuck);
    if(res.state==='finished') break;
  }
  await p.evaluate(()=>{ clearInterval(window.__ap); });
  const verdict = res.prog>=1 ? 'OK (completo >=1 vuelta)' : maxStuck>25 ? 'TRABADO' : `parcial prog=${res.prog?.toFixed(2)}`;
  console.log(`${names[idx].padEnd(13)} maxProg=${res.prog?.toFixed(2)}  maxStuckTicks=${maxStuck}  -> ${verdict}`);
}
await b.close();
