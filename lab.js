(()=>{
"use strict";
const WS="wss://api.derivws.com/trading/v1/options/ws/public",DAY=86400,TEST_DAYS=2,INSTRUMENT_LIMIT=8;
const strategies=[
{id:1,name:"OB + EMA",group:"Tendencia",rules:"OB M2 + EMA 9/21 alineadas; confirmación de ruptura en M1",ob:true},
{id:2,name:"Liquidity Sweep",group:"Liquidez",rules:"Barrida de swing M2 + recuperación; confirmación en M1"},
{id:3,name:"Tres toques",group:"Price Action",rules:"Tres pruebas de zona M2 + rechazo; ruptura de vela en M1"},
{id:4,name:"BOS + Retest",group:"Estructura",rules:"Ruptura de estructura M2 + retesteo; confirmación en M1"},
{id:5,name:"EMA Pullback",group:"Tendencia",rules:"EMA 9/21/50 M2 alineadas + retroceso y continuación en M1"},
{id:6,name:"RSI Reversal",group:"Reversión",rules:"RSI M2 sale de extremo + giro confirmado en M1"},
{id:7,name:"FVG + Reacción",group:"Desequilibrio",rules:"Regreso a FVG M2 + rechazo confirmado en M1"},
{id:8,name:"Doble techo / suelo",group:"Price Action",rules:"Segundo test M2 + ruptura de neckline en M1"}
];
let socket=null,busy=false,req=1,reqState=null,symbols=[],results=[],hist={},idx=0,active=null,queue=[],timer=null,connectTimer=null,symbolTimer=null,overallTimer=null,validInstruments=0,failedInstruments=0;
const $=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=(v,n=5)=>Number.isFinite(v)?v.toFixed(n):"—";
function status(s){$("status").textContent=s;$("live-status").textContent=busy?"TESTING · "+s:s}
function connection(s,ok){$("connection-state").textContent=s;$("connection-state").className=ok?"connected":"disconnected"}
function ema(a,p){let o=Array(a.length).fill(null);if(a.length<p)return o;let v=a.slice(0,p).reduce((x,y)=>x+y,0)/p,k=2/(p+1);o[p-1]=v;for(let i=p;i<a.length;i++){v=a[i]*k+v*(1-k);o[i]=v}return o}
function rsi(c,p=14){let o=Array(c.length).fill(null),g=0,l=0;if(c.length<=p)return o;for(let i=1;i<=p;i++){let d=c[i]-c[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p;o[p]=l?100-100/(1+g/l):100;for(let i=p+1;i<c.length;i++){let d=c[i]-c[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p;o[i]=l?100-100/(1+g/l):100}return o}
function atr(d,p=14){let tr=d.map((c,i)=>i?Math.max(c.high-c.low,Math.abs(c.high-d[i-1].close),Math.abs(c.low-d[i-1].close)):c.high-c.low),o=Array(d.length).fill(null);if(d.length<p)return o;let v=tr.slice(0,p).reduce((a,b)=>a+b,0)/p;o[p-1]=v;for(let i=p;i<d.length;i++){v=(v*(p-1)+tr[i])/p;o[i]=v}return o}
function max(a){return a.length?Math.max(...a):null}function min(a){return a.length?Math.min(...a):null}
function features(d){
 const c=d.map(x=>x.close),e9=ema(c,9),e21=ema(c,21),e50=ema(c,50),r=rsi(c),a=atr(d);
 const body=d.map(x=>Math.abs(x.close-x.open));
 const avg=body.map((_,i)=>i<10?null:body.slice(i-10,i).reduce((s,v)=>s+v,0)/10);
 const ob=Array(d.length).fill(null),sweep=Array(d.length).fill(0),fvg=Array(d.length).fill(null);
 const swingH=Array(d.length).fill(null),swingL=Array(d.length).fill(null),bos=Array(d.length).fill(0);
 const touch=Array(d.length).fill(0),double=Array(d.length).fill(0);
 let lastPivotHigh=null,lastPivotLow=null,topSetup=null,bottomSetup=null,pendingBreak=null;
 for(let i=3;i<d.length;i++){
  const z=d[i],p=d[i-1],q=d[i-2];
  const hi=max(d.slice(Math.max(0,i-12),i).map(x=>x.high));
  const lo=min(d.slice(Math.max(0,i-12),i).map(x=>x.low));
  swingH[i]=hi;swingL[i]=lo;
  if(z.low<lo&&z.close>lo)sweep[i]=1;else if(z.high>hi&&z.close<hi)sweep[i]=-1;
  if(z.low>q.high)fvg[i]={dir:1,low:q.high,high:z.low};
  else if(z.high<q.low)fvg[i]={dir:-1,low:z.high,high:q.low};
  const strong=avg[i]!=null&&body[i]>avg[i]*1.35;
  if(strong&&z.close>z.open&&z.close>p.high){
   let j=i-1;while(j>Math.max(0,i-5)&&d[j].close>=d[j].open)j--;
   if(d[j].close<d[j].open)ob[i]={dir:1,low:d[j].low,high:d[j].open,at:j};
  }
  if(strong&&z.close<z.open&&z.close<p.low){
   let j=i-1;while(j>Math.max(0,i-5)&&d[j].close<=d[j].open)j--;
   if(d[j].close>d[j].open)ob[i]={dir:-1,low:d[j].open,high:d[j].high,at:j};
  }
  const recent=d.slice(Math.max(0,i-5),i+1),tol=(a[i]||0)*.18;
  const highTouches=recent.filter(x=>Math.abs(x.high-hi)<=tol).length;
  const lowTouches=recent.filter(x=>Math.abs(x.low-lo)<=tol).length;
  if(lowTouches>=3)touch[i]=1;else if(highTouches>=3)touch[i]=-1;
  const pivot=i-2;
  if(pivot>=2){
   const ph=d[pivot].high,pl=d[pivot].low;
   const isHigh=ph>d[pivot-1].high&&ph>d[pivot-2].high&&ph>=d[pivot+1].high&&ph>=d[pivot+2].high;
   const isLow=pl<d[pivot-1].low&&pl<d[pivot-2].low&&pl<=d[pivot+1].low&&pl<=d[pivot+2].low;
   if(isHigh){
    if(lastPivotHigh&&pivot-lastPivotHigh.i>=3&&Math.abs(ph-lastPivotHigh.v)<=(a[i]||0)*.35){
     const neck=min(d.slice(lastPivotHigh.i+1,pivot).map(x=>x.low));
     if(neck!=null)topSetup={level:neck,until:i+15};
    }
    lastPivotHigh={v:ph,i:pivot};
   }
   if(isLow){
    if(lastPivotLow&&pivot-lastPivotLow.i>=3&&Math.abs(pl-lastPivotLow.v)<=(a[i]||0)*.35){
     const neck=max(d.slice(lastPivotLow.i+1,pivot).map(x=>x.high));
     if(neck!=null)bottomSetup={level:neck,until:i+15};
    }
    lastPivotLow={v:pl,i:pivot};
   }
  }
  if(topSetup&&i<=topSetup.until&&z.close<topSetup.level&&p.close>=topSetup.level){double[i]=-1;topSetup=null}
  if(bottomSetup&&i<=bottomSetup.until&&z.close>bottomSetup.level&&p.close<=bottomSetup.level){double[i]=1;bottomSetup=null}
  if(topSetup&&i>topSetup.until)topSetup=null;
  if(bottomSetup&&i>bottomSetup.until)bottomSetup=null;
  if(pendingBreak&&i>pendingBreak.i){
   if(i<=pendingBreak.i+6&&pendingBreak.dir===1&&z.low<=pendingBreak.level+(a[i]||0)*.12&&z.close>pendingBreak.level&&z.close>z.open){bos[i]=1;pendingBreak=null}
   else if(i<=pendingBreak.i+6&&pendingBreak.dir===-1&&z.high>=pendingBreak.level-(a[i]||0)*.12&&z.close<pendingBreak.level&&z.close<z.open){bos[i]=-1;pendingBreak=null}
   else if(i>pendingBreak.i+6)pendingBreak=null;
  }
  if(z.close>hi)pendingBreak={dir:1,level:hi,i};
  else if(z.close<lo)pendingBreak={dir:-1,level:lo,i};
 }
 return{e9,e21,e50,r,a,avg,body,ob,sweep,fvg,swingH,swingL,bos,touch,double};
}
function latestOB(f,i,dir){for(let j=i;j>=Math.max(0,i-12);j--)if(f.ob[j]&&f.ob[j].dir===dir)return f.ob[j];return null}
function contextSignal(id,i,d,f){
 if(i<55||!d[i])return 0;
 const z=d[i],p=d[i-1],q=d[i-2],r=f.r[i],prev=f.r[i-1],atr=f.a[i]||0,ob=latestOB(f,i,1),bear=latestOB(f,i,-1);
 const bull= z.close>z.open && f.body[i]>(f.avg[i]||0)*.75;
 const bearC=z.close<z.open && f.body[i]>(f.avg[i]||0)*.75;
 const up=f.e9[i]>f.e21[i]&&f.e21[i]>f.e50[i],dn=f.e9[i]<f.e21[i]&&f.e21[i]<f.e50[i];
 switch(id){
 case 1: if(up&&ob&&z.close>=ob.low&&z.close<=ob.high)return 1;if(dn&&bear&&z.close<=bear.high&&z.close>=bear.low)return -1;break;
 case 2: if(f.sweep[i]===1)return 1;if(f.sweep[i]===-1)return -1;break;
 case 3: if(f.touch[i]===1&&z.close>z.open&&z.close>p.high)return 1;if(f.touch[i]===-1&&z.close<z.open&&z.close<p.low)return -1;break;
 case 4: if(f.bos[i]===1)return 1;if(f.bos[i]===-1)return -1;break;
 case 5: if(up&&z.low<=f.e21[i]&&z.close>f.e9[i]&&bull)return 1;if(dn&&z.high>=f.e21[i]&&z.close<f.e9[i]&&bearC)return -1;break;
 case 6: if(prev<30&&r>=30&&bull)return 1;if(prev>70&&r<=70&&bearC)return -1;break;
 case 7: {let g=f.fvg.slice(Math.max(0,i-8),i).filter(Boolean).slice(-1)[0];if(g&&g.dir===1&&z.low<=g.high&&z.close>g.high)return 1;if(g&&g.dir===-1&&z.high>=g.low&&z.close<g.low)return -1;break}
 case 8: if(f.double[i]===1)return 1;if(f.double[i]===-1)return -1;break;
 case 9: if(bull&&f.body[i]>(f.avg[i]||0)*1.6&&z.close>p.high)return 1;if(bearC&&f.body[i]>(f.avg[i]||0)*1.6&&z.close<p.low)return -1;break;
 case 10: if(f.sweep[i]===1&&ob&&z.low<=ob.high&&z.close>ob.high)return 1;if(f.sweep[i]===-1&&bear&&z.high>=bear.low&&z.close<bear.low)return -1;break;
 case 11:{
  const crossUp=f.e9[i]>f.e25[i]&&f.e9[i-1]<=f.e25[i-1],crossDn=f.e9[i]<f.e25[i]&&f.e9[i-1]>=f.e25[i-1];
  const towardUp=f.e9[i]>f.e9[i-1]&&f.e25[i]>f.e25[i-1]&&z.close>f.e50[i],towardDn=f.e9[i]<f.e9[i-1]&&f.e25[i]<f.e25[i-1]&&z.close<f.e50[i];
  const strong=f.avg[i]!=null&&f.body[i]>=f.avg[i]*1.35;
  if(crossUp&&towardUp&&ob&&r>=50&&r<=60&&r>prev&&bull&&strong)return 1;
  if(crossDn&&towardDn&&bear&&r<=55&&r>=40&&r<prev&&bearC&&strong)return -1;
  break;
 }}
 return 0;
}
function entryConfirm(dir,m1,i){const c=m1[i],p=m1[i-1];if(!c||!p)return false;const body=Math.abs(c.close-c.open),range=c.high-c.low||1,solid=body/range>=.45;if(dir>0)return c.close>c.open&&c.close>p.high&&solid;return c.close<c.open&&c.close<p.low&&solid}
function buildTrades(m2,m1,strat){
 const f=features(m2),a1=atr(m1),trades=[],entries=[],contextIndex=Array(m1.length).fill(-1);let k=0;
 for(let i=0;i<m1.length;i++){while(k+1<m2.length&&m2[k+1].time+120<=m1[i].time)k++;contextIndex[i]=k}
 let next=60;
 for(let i=60;i<m1.length-1;i++){
  if(i<next)continue;const mi=contextIndex[i];if(mi<55)continue;const dir=contextSignal(strat.id,mi,m2,f);if(!dir||!entryConfirm(dir,m1,i))continue;
  const entry=m1[i+1].open,zone=latestOB(f,mi,dir),pad=(a1[i]||Math.abs(entry)*.0002)*.12;
  const look=m2.slice(Math.max(0,mi-8),mi+1),swing=dir>0?min(look.map(x=>x.low)):max(look.map(x=>x.high));
  let sl=zone?(dir>0?zone.low-pad:zone.high+pad):(dir>0?swing-pad:swing+pad);
  let risk=Math.abs(entry-sl);if(!Number.isFinite(risk)||risk<=0||risk>Math.max(a1[i]||0,Math.abs(entry)*.00001)*4)continue;
  const targetR=1.25;let tp=entry+dir*risk*targetR,tp2=entry+dir*risk*2;
  const liquidity=dir>0?min(m2.slice(Math.max(0,mi-15),mi+1).map(x=>x.high).filter(v=>v>entry)):max(m2.slice(Math.max(0,mi-15),mi+1).map(x=>x.low).filter(v=>v<entry));
  if(liquidity!=null&&Math.abs(liquidity-entry)>=risk*.75&&Math.abs(liquidity-entry)<Math.abs(tp-entry))tp=liquidity;
  let result="ABIERTA",exitIndex=-1,exitPrice=null;
  for(let j=i+1;j<Math.min(m1.length,i+41);j++){const c=m1[j],stop=dir>0?c.low<=sl:c.high>=sl,target=dir>0?c.high>=tp:c.low<=tp;if(stop){result="PERDIDA";exitIndex=j;exitPrice=sl;break}if(target){result="GANADA";exitIndex=j;exitPrice=tp;break}}
  if(exitIndex<0&&i+40<m1.length){exitIndex=i+40;exitPrice=m1[exitIndex].close;result=(dir>0?exitPrice>entry:exitPrice<entry)?"GANADA":"PERDIDA"}
  const t={result,signalIndex:i,entryIndex:i+1,exitIndex,signalTime:m1[i].time,entryTime:m1[i+1].time,exitTime:exitIndex>=0?m1[exitIndex].time:null,direction:dir>0?"BUY":"SELL",entry,sl,tp,tp2,exitPrice,risk,ruleText:strat.rules,m1Index:mi};
  entries.push(t);if(exitIndex>=0)trades.push(t);next=exitIndex>=0?exitIndex+1:i+1;
 }
 const wins=trades.filter(t=>t.result==="GANADA").length,losses=trades.length-wins;
 return{strategy:strat,wins,losses,total:trades.length,rate:trades.length?wins/trades.length*100:null,entries,trades,days:m1.length?(m1[m1.length-1].time-m1[0].time)/DAY:0};
}
function updateTotals(){const wins=results.reduce((n,r)=>n+r.wins,0),losses=results.reduce((n,r)=>n+r.losses,0),ops=wins+losses;$("total-tested").textContent=results.length;$("total-wins").textContent=wins;$("total-losses").textContent=losses;$("total-ops").textContent=ops;$("total-markets").textContent=validInstruments+" válidos · "+failedInstruments+" con error";}
function render(){
 updateTotals();
 $("strategy-list").innerHTML=strategies.map(s=>{const cells=symbols.map(m=>{const r=results.find(x=>x.symbol===m.symbol&&x.strategy.id===s.id);return '<div class="instrument-result"><b>'+(r?fmt(r.rate,1)+"%":"—")+'</b><span>'+esc(m.name)+' · '+(r?(r.error?"ERROR · "+esc(r.error):r.wins+"G / "+r.losses+"P · "+r.total+" ops · "+r.entries.length+" señales"):"pendiente")+'</span></div>'}).join("");return '<article class="strategy-card"><div class="strategy-top"><strong>'+s.id+'. '+esc(s.name)+'</strong><small>'+esc(s.group)+' · '+esc(s.rules)+'</small></div><div class="strategy-results">'+cells+'</div></article>'}).join("");
 $("market-list").innerHTML=symbols.map(m=>'<div class="market-chip"><span>'+esc(m.name)+'</span><small>'+m.symbol+'</small></div>').join("");
 $("s-symbols").textContent=symbols.length;$("s-tests").textContent="8 por índice";
 const ranked=symbols.map(m=>({market:m,rows:results.filter(r=>r.symbol===m.symbol&&r.total>=5).sort((a,b)=>b.rate-a.rate||b.wins-a.wins)}));
 $("best-list").innerHTML=ranked.map(g=>'<section class="market-rank"><h4>'+esc(g.market.name)+'</h4>'+(g.rows.length?rankCard(g.rows[0],"best"):'<div class="empty">Aún no hay estrategia con 5 operaciones cerradas.</div>')+'</section>').join("")||'<div class="empty">Esperando instrumentos…</div>';
 $("worst-list").innerHTML=ranked.map(g=>'<section class="market-rank"><h4>'+esc(g.market.name)+'</h4>'+(g.rows.length?rankCard(g.rows[g.rows.length-1],"worst"):'<div class="empty">Aún no hay estrategia con 5 operaciones cerradas.</div>')+'</section>').join("")||'<div class="empty">Esperando instrumentos…</div>';
 const old=$("chart-market").value;$("chart-market").innerHTML=symbols.map(m=>'<option value="'+m.symbol+'">'+esc(m.name)+'</option>').join("");if(symbols.some(m=>m.symbol===old))$("chart-market").value=old;
 $("chart-strategy").innerHTML=strategies.map(s=>'<option value="'+s.id+'">'+s.id+". "+esc(s.name)+'</option>').join("");
 $("s-strategies").textContent=strategies.length;$("live-count").textContent=results.length+" / "+(symbols.length*strategies.length)+" pruebas completadas";
 drawChart();
}
function rankCard(r,kind){return '<article class="rank-card"><div><b>'+esc(r.market)+'</b><small>'+r.strategy.name+'</small></div><strong class="'+(kind==="best"?"rate":"loss")+'">'+fmt(r.rate,1)+'%</strong><small>'+r.wins+' ganadas · '+r.losses+' perdidas · '+r.total+' operaciones</small><button class="inspect-result" data-symbol="'+r.symbol+'" data-strategy="'+r.strategy.id+'">VER GRÁFICO</button></article>'}
function drawChart(){
 const sym=$("chart-market").value||symbols[0]?.symbol,sid=Number($("chart-strategy").value||1),r=results.find(x=>x.symbol===sym&&x.strategy.id===sid),host=$("strategy-chart");if(!host)return;
 if(!r){host.innerHTML='<div class="empty">Selecciona un instrumento y espera los datos reales.</div>';return}
 const d=hist[sym]?.m1||[],m1=hist[sym]?.m1||[],view=d.slice(-180),offset=d.length-view.length,chosen=r.entries.slice(-1)[0];
 $("chart-audit").innerHTML='<div><b>'+r.total+'</b><span>Operaciones</span></div><div><b class="rate">'+r.wins+'</b><span>Ganadas</span></div><div><b class="loss">'+r.losses+'</b><span>Perdidas</span></div><div><b>'+fmt(r.rate,1)+'%</b><span>Acierto</span></div>';
 if(!view.length){host.innerHTML="Sin velas";return}
 const vals=view.flatMap(c=>[c.high,c.low]),lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1,X=i=>18+i*964/Math.max(1,view.length-1),Y=v=>12+(hi-v)/span*265;let svg="";
 view.forEach((c,j)=>{let x=X(j),up=c.close>=c.open,col=up?"#42dfa0":"#ff7184",top=Y(Math.max(c.open,c.close)),h=Math.max(1.2,Math.abs(Y(c.open)-Y(c.close)));svg+='<line x1="'+x+'" y1="'+Y(c.high)+'" x2="'+x+'" y2="'+Y(c.low)+'" stroke="'+col+'"/><rect x="'+(x-1.6)+'" y="'+top+'" width="3.2" height="'+h+'" fill="'+col+'"/>'});
 r.entries.forEach(t=>{let j=t.entryIndex-offset;if(j<0||j>=view.length)return;let x=X(j),y=Y(t.entry),col=t.direction==="BUY"?"#42dfa0":"#ff7184";svg+='<path d="M '+x+' '+(y-7)+' l -5 -9 h 10 z" fill="'+col+'"/>';if(t.exitIndex>=offset&&t.exitIndex<d.length)svg+='<circle cx="'+X(t.exitIndex-offset)+'" cy="'+Y(t.exitPrice)+'" r="3" fill="'+(t.result==="GANADA"?"#42dfa0":"#ff7184")+'"/>'});
 if(chosen){svg+='<line x1="18" y1="'+Y(chosen.tp)+'" x2="982" y2="'+Y(chosen.tp)+'" stroke="#42dfa0" stroke-dasharray="5 4"/><line x1="18" y1="'+Y(chosen.sl)+'" x2="982" y2="'+Y(chosen.sl)+'" stroke="#ff7184" stroke-dasharray="5 4"/>'}
 host.innerHTML='<svg class="market-chart" viewBox="0 0 1000 300" role="img" aria-label="Velas M1 con entradas y niveles TP y SL">'+svg+'</svg><div class="chart-legend"><span>🟢 BUY / TP</span><span>🔴 SELL / SL</span><span>Velas M1 · contexto M2</span></div>';
 $("trade-audit-list").innerHTML=r.entries.slice(-30).reverse().map(t=>'<article class="audit-trade"><b class="'+(t.result==="GANADA"?"rate":"loss")+'">'+t.result+' · '+t.direction+'</b><span>Entrada '+fmt(t.entry)+' · '+new Date(t.entryTime*1000).toLocaleString("es-PA")+'</span><span>TP1 '+fmt(t.tp)+' · TP2 '+fmt(t.tp2)+' · SL '+fmt(t.sl)+'</span><span>Salida '+fmt(t.exitPrice)+' · '+(t.exitTime?new Date(t.exitTime*1000).toLocaleString("es-PA"):"sin salida")+'</span></article>').join("");
}
function progress(){const total=symbols.length;$("progress-count").textContent=idx+" / "+total+" instrumentos · 8 estrategias por instrumento";$("progress-bar").style.width=(total?idx/total*100:0)+"%";$("progress-title").textContent=busy?"Analizando "+(active?.name||"Deriv"):"Análisis finalizado"}
function finish(msg){busy=false;clearTimeout(timer);clearTimeout(connectTimer);clearTimeout(symbolTimer);clearTimeout(overallTimer);if(socket){try{socket.close()}catch(e){}socket=null}status(msg);$("live-detail").textContent=msg;$("start").disabled=false;progress();render();$("updated").textContent="Actualizado: "+new Date().toLocaleString("es-PA")}
function requestPage(){
 if(!busy||!reqState)return;
 req++;reqState.req=req;
 $("live-detail").textContent="Descargando velas M1 de "+(active?.name||reqState.symbol)+" · historial de 2 días…";
 try{socket.send(JSON.stringify({ticks_history:reqState.symbol,start:reqState.start,end:String(reqState.targetEnd),count:3000,style:"candles",granularity:60,req_id:req}));}
 catch(e){const st=reqState;reqState=null;st.done([], "No se pudo solicitar el gráfico M1: "+(e.message||e));return}
 clearTimeout(timer);
 timer=setTimeout(()=>{if(busy&&reqState){const st=reqState;reqState=null;st.done([], "Deriv no respondió al historial de velas M1 en 30 segundos.")}},30000);
}
function parseCandles(m){
 return (m.candles||[]).map(c=>({time:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}))
  .filter(c=>Number.isFinite(c.time)&&Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close))
  .sort((a,b)=>a.time-b.time);
}
function buildM2FromM1(m1){
 const groups=new Map();
 for(const c of m1){const t=Math.floor(c.time/120)*120;let g=groups.get(t);if(!g)groups.set(t,{time:t,parts:[]});groups.get(t).parts.push(c)}
 return [...groups.values()].filter(g=>g.parts.length===2&&g.parts[0].time===g.time&&g.parts[1].time===g.time+60)
  .map(g=>({time:g.time,open:g.parts[0].open,high:Math.max(g.parts[0].high,g.parts[1].high),low:Math.min(g.parts[0].low,g.parts[1].low),close:g.parts[1].close}));
}
function loadTwoDayCandles(symbol,done){
 const end=Math.floor(Date.now()/60000)*60,start=end-TEST_DAYS*DAY;
 reqState={symbol,done,pages:0,start,targetEnd:end,req:0};requestPage();
}
function handleHistory(m){
 if(!reqState||m.req_id!==reqState.req)return;
 clearTimeout(timer);
 const st=reqState,m1raw=parseCandles(m);
 if(!m1raw.length){reqState=null;st.done([], "Deriv no devolvió velas M1. Comprueba la respuesta histórica de Deriv.");return}
 const m1=m1raw.filter(c=>c.time>=st.start&&c.time+60<=st.targetEnd);
 const m2=buildM2FromM1(m1);
 const coverage=m1.length?(m1[m1.length-1].time+60-m1[0].time)/DAY:0;
 reqState=null;
 st.done({m1,m2,candleCount:m1.length,pages:1,coverage,start:st.start,end:st.targetEnd});
}
function runInstrument(){
 if(!busy)return;
 if(idx>=symbols.length){finish("ANÁLISIS COMPLETADO · 2 DÍAS · M2 + M1");return}
 active=symbols[idx];
 $("live-detail").textContent="Descargando gráfico M1 para construir contexto M2 y entradas M1: "+active.name;
 status("DESCARGANDO · "+active.name);progress();
 loadTwoDayCandles(active.symbol,(series,error)=>{
  if(!busy)return;
  if(error){
   failedInstruments++;$("live-detail").textContent=active.name+": ERROR DE HISTORIAL · "+error;
  }else{
   const {m1,m2,candleCount,pages,coverage}=series;
   if(coverage<1.98||m1.length<2800||m2.length<1400){
    failedInstruments++;$("live-detail").textContent=active.name+": datos insuficientes. Cobertura "+coverage.toFixed(2)+" días; M2 contexto "+m2.length+" velas; M1 entrada "+m1.length+" velas. No se publican resultados parciales.";
   }else{
    hist[active.symbol]={m1,m2};validInstruments++;
    for(const s of strategies){
     $("live-detail").textContent="TESTING · "+active.name+" · estrategia "+s.id+" de "+strategies.length+": "+s.name;
     $("progress-title").textContent="TESTING · "+active.name;
     let r;
     try{r=buildTrades(m2,m1,s)}
     catch(err){r={strategy:s,wins:0,losses:0,total:0,rate:null,entries:[],trades:[],error:"Error en motor: "+(err?.message||String(err))};failedInstruments++}
     results.push({symbol:active.symbol,market:active.name,strategy:s,...r});
     updateTotals();
     $("live-count").textContent=results.length+" / "+(symbols.length*strategies.length)+" pruebas completadas";
    }
    $("live-detail").textContent=active.name+": 2 días completos · "+m2.length+" velas M2 de contexto · "+m1.length+" velas M1 de entrada · "+candleCount.toLocaleString("es-PA")+" velas M1 recibidas en una solicitud · 8 estrategias probadas.";
   }
  }
  idx++;progress();render();runInstrument();
 });
}
function start(){
 if(busy)return;busy=true;idx=0;symbols=[];results=[];hist={};validInstruments=0;failedInstruments=0;$("start").disabled=true;$("live-detail").textContent="Conectando con Deriv para descargar datos reales…";$("updated").textContent="Conectando…";$("strategy-list").innerHTML="";$("best-list").innerHTML="";$("worst-list").innerHTML="";$("market-list").innerHTML="";connection("CONECTANDO…",false);status("CONECTANDO CON DERIV");progress();
 try{socket=new WebSocket(WS)}catch(e){finish("NO SE PUDO ABRIR LA CONEXIÓN");return}
 connectTimer=setTimeout(()=>{if(busy&&socket?.readyState!==WebSocket.OPEN)finish("NO SE PUDO CONECTAR A DERIV EN 15 SEGUNDOS")},15000);
 overallTimer=setTimeout(()=>{if(busy)finish("TIEMPO MÁXIMO · "+validInstruments+" instrumentos analizados · "+failedInstruments+" con error")},2700000);
 socket.onopen=()=>{clearTimeout(connectTimer);status("CONECTADO · PIDIENDO INSTRUMENTOS");$("live-detail").textContent="Conexión WebSocket abierta. Esperando la lista de instrumentos de Deriv…";try{socket.send(JSON.stringify({active_symbols:"brief",req_id:1}));symbolTimer=setTimeout(()=>{if(busy&&!symbols.length)finish("DERIV CONECTÓ, PERO NO RESPONDIÓ A active_symbols EN 12 SEGUNDOS");},12000)}catch(e){finish("ERROR AL PEDIR INSTRUMENTOS: "+(e.message||e))}};
 socket.onerror=()=>{if(busy)finish("ERROR DE RED: EL NAVEGADOR NO PUDO COMPLETAR EL WEBSOCKET DE DERIV")};
 socket.onclose=e=>{if(busy)finish("DERIV DESCONECTÓ · CÓDIGO "+e.code)};
 socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(err){return}
  if(m.error){const msg=m.error.message||"Error de API";if(m.req_id===1){finish("ERROR DE DERIV: "+msg);return}if(reqState&&m.req_id===reqState.req){const st=reqState;reqState=null;clearTimeout(timer);st.done([],"Deriv rechazó la descarga de velas: "+msg)}return}
  if(m.msg_type==="active_symbols"||Array.isArray(m.active_symbols)){clearTimeout(symbolTimer);connection("DERIV API CONFIRMADA",true);const list=m.active_symbols||[];const found=list.map(s=>({symbol:s.underlying_symbol||s.symbol||"",name:s.underlying_symbol_name||s.display_name||s.symbol||""})).filter(s=>s.symbol&&/volatility/i.test(s.name)&&/1s/i.test(s.name));symbols=[...new Map(found.map(s=>[s.symbol,s])).values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0,INSTRUMENT_LIMIT);$("updated").textContent="Deriv devolvió "+list.length+" símbolos · "+symbols.length+" índices 1s";if(!symbols.length){finish("DERIV NO DEVOLVIÓ ÍNDICES VOLATILITY 1s");return}$("live-detail").textContent="Índices encontrados: "+symbols.length+". Se analizarán "+strategies.length+" estrategias por instrumento.";runInstrument();return}
  if(reqState&&m.req_id===reqState.req){handleHistory(m);return}
 };
}
document.addEventListener("DOMContentLoaded",()=>{
 $("start").addEventListener("click",start);$("chart-market").addEventListener("change",drawChart);$("chart-strategy").addEventListener("change",drawChart);
 document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+b.dataset.tab));if(b.dataset.tab==="chart")drawChart()}));
 document.addEventListener("click",e=>{const b=e.target.closest(".inspect-result");if(b){$("chart-market").value=b.dataset.symbol;$("chart-strategy").value=b.dataset.strategy;document.querySelector('[data-tab="chart"]').click();drawChart()}});
 $("live-detail").textContent="Preparado: gráfico M1, contexto M2 y simulación de entradas en M1.";start();
});
})();