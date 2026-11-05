/* BOTDER Strategy Lab · backtest independiente, sin ejecución de operaciones */
(() => {
"use strict";
const ENDPOINT="wss://api.derivws.com/trading/v1/options/ws/public";
const STRATEGIES=[
 {id:"ema_pullback",name:"EMA 9/20/50 · Pullback",desc:"Tendencia alineada y retroceso a EMA20"},
 {id:"ema_cross",name:"Cruce EMA 9/21",desc:"Cruce confirmado de medias"},
 {id:"rsi_reversal",name:"RSI · Reversión",desc:"Salida de sobreventa/sobrecompra con filtro de tendencia"},
 {id:"macd_cross",name:"MACD · Cruce",desc:"Cruce MACD y línea de señal"},
 {id:"bollinger",name:"Bandas de Bollinger",desc:"Reversión desde bandas con RSI"},
 {id:"donchian",name:"Donchian · Ruptura",desc:"Ruptura del máximo/mínimo de 20 velas"},
 {id:"atr_breakout",name:"ATR · Expansión",desc:"Ruptura de rango con expansión de volatilidad"},
 {id:"adx_trend",name:"ADX + DI",desc:"Continuación de tendencia con fuerza ADX"},
 {id:"engulfing",name:"Envolvente + EMA50",desc:"Patrón envolvente a favor de tendencia"},
 {id:"liquidity_sweep",name:"Barrido de liquidez",desc:"Barrido de pivote y cierre de rechazo"}
];
let socket=null,symbols=[],cursor=0,results=[],busy=false,requestId=100,activeSymbol=null,scanToken=0;
const $=id=>document.getElementById(id);
const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):"—";
function status(s){const el=$("lab-status");if(el)el.textContent=s;}
function progress(){const el=$("lab-progress");if(el)el.textContent=(cursor)+" / "+symbols.length+" instrumentos";}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function ema(values,p){const out=Array(values.length).fill(null);if(values.length<p)return out;let e=values.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);out[p-1]=e;for(let i=p;i<values.length;i++){e=values[i]*k+e*(1-k);out[i]=e;}return out;}
function rsi(values,p=14){const out=Array(values.length).fill(null);if(values.length<=p)return out;let g=0,l=0;for(let i=1;i<=p;i++){const d=values[i]-values[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;out[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;out[i]=al===0?100:100-100/(1+ag/al);}return out;}
function atr(d,p=14){const tr=d.map((c,i)=>i?Math.max(c.high-c.low,Math.abs(c.high-d[i-1].close),Math.abs(c.low-d[i-1].close)):c.high-c.low);return ema(tr,p);}
function adx(d,p=14){const plus=Array(d.length).fill(null),minus=Array(d.length).fill(null),dx=Array(d.length).fill(null),out=Array(d.length).fill(null);let tr=0,up=0,dn=0;for(let i=1;i<d.length;i++){const u=d[i].high-d[i-1].high,v=d[i-1].low-d[i].low;tr+=Math.max(d[i].high-d[i].low,Math.abs(d[i].high-d[i-1].close),Math.abs(d[i].low-d[i-1].close));up+=u>v&&u>0?u:0;dn+=v>u&&v>0?v:0;if(i===p){plus[i]=100*up/tr;minus[i]=100*dn/tr;}else if(i>p){const t=Math.max(d[i].high-d[i].low,Math.abs(d[i].high-d[i-1].close),Math.abs(d[i].low-d[i-1].close));tr=tr-tr/p+t;up=up-up/p+(u>v&&u>0?u:0);dn=dn-dn/p+(v>u&&v>0?v:0);plus[i]=100*up/tr;minus[i]=100*dn/tr;}if(plus[i]!=null)dx[i]=100*Math.abs(plus[i]-minus[i])/(plus[i]+minus[i]||1);}let sum=0;for(let i=0;i<dx.length;i++){if(dx[i]==null)continue;if(i<p*2){sum+=dx[i];if(i===p*2-1)out[i]=sum/p;}else out[i]=(out[i-1]*(p-1)+dx[i])/p;}return{adx:out,plus,minus};}
function macd(v){const a=ema(v,12),b=ema(v,26),line=v.map((_,i)=>a[i]!=null&&b[i]!=null?a[i]-b[i]:null),valid=line.map(x=>x??0),sig=ema(valid,9);return{line,signal:sig};}
function boll(v,i,p=20,m=2){if(i<p-1)return null;const s=v.slice(i-p+1,i+1),mean=s.reduce((a,b)=>a+b,0)/p,sd=Math.sqrt(s.reduce((a,b)=>a+(b-mean)**2,0)/p);return{mid:mean,upper:mean+m*sd,lower:mean-m*sd};}
function signalAt(id,d,i,x){const c=d[i],p=d[i-1],e9=x.e9,e20=x.e20,e21=x.e21,e50=x.e50,r=x.rsi,a=x.atr,ad=x.adx,mc=x.macd;const bull=c.close>c.open,bear=c.close<c.open;
 switch(id){
 case"ema_pullback":if(e9[i]>e20[i]&&e20[i]>e50[i]&&c.low<=e20[i]&&c.close>e9[i]&&bull)return"COMPRAR";if(e9[i]<e20[i]&&e20[i]<e50[i]&&c.high>=e20[i]&&c.close<e9[i]&&bear)return"VENDER";break;
 case"ema_cross":if(e9[i]>e21[i]&&e9[i-1]<=e21[i-1]&&c.close>e50[i])return"COMPRAR";if(e9[i]<e21[i]&&e9[i-1]>=e21[i-1]&&c.close<e50[i])return"VENDER";break;
 case"rsi_reversal":if(r[i-1]<30&&r[i]>=30&&c.close>e50[i])return"COMPRAR";if(r[i-1]>70&&r[i]<=70&&c.close<e50[i])return"VENDER";break;
 case"macd_cross":if(mc.line[i]>mc.signal[i]&&mc.line[i-1]<=mc.signal[i-1]&&c.close>e50[i])return"COMPRAR";if(mc.line[i]<mc.signal[i]&&mc.line[i-1]>=mc.signal[i-1]&&c.close<e50[i])return"VENDER";break;
 case"bollinger":{const b=boll(d.map(z=>z.close),i);if(b&&c.close>b.lower&&p.close<=b.lower&&r[i]<45)return"COMPRAR";if(b&&c.close<b.upper&&p.close>=b.upper&&r[i]>55)return"VENDER";break;}
 case"donchian":{const prev=d.slice(Math.max(0,i-20),i);if(prev.length===20&&c.close>Math.max(...prev.map(z=>z.high)))return"COMPRAR";if(prev.length===20&&c.close<Math.min(...prev.map(z=>z.low)))return"VENDER";break;}
 case"atr_breakout":{const prev=d.slice(Math.max(0,i-10),i);if(prev.length===10&&a[i]>a[i-1]&&c.close>Math.max(...prev.map(z=>z.high))&&c.close-c.open>a[i]*.5)return"COMPRAR";if(prev.length===10&&a[i]>a[i-1]&&c.close<Math.min(...prev.map(z=>z.low))&&c.open-c.close>a[i]*.5)return"VENDER";break;}
 case"adx_trend":if(ad.adx[i]>22&&ad.plus[i]>ad.minus[i]&&e9[i]>e20[i]&&c.close>e50[i])return"COMPRAR";if(ad.adx[i]>22&&ad.minus[i]>ad.plus[i]&&e9[i]<e20[i]&&c.close<e50[i])return"VENDER";break;
 case"engulfing":if(bull&&p.close<p.open&&c.close>p.open&&c.open<p.close&&c.close>e50[i])return"COMPRAR";if(bear&&p.close>p.open&&c.close<p.open&&c.open>p.close&&c.close<e50[i])return"VENDER";break;
 case"liquidity_sweep":{const prev=d.slice(Math.max(0,i-12),i);if(prev.length>=8){const lo=Math.min(...prev.map(z=>z.low)),hi=Math.max(...prev.map(z=>z.high));if(c.low<lo&&c.close>lo&&bull)return"COMPRAR";if(c.high>hi&&c.close<hi&&bear)return"VENDER";}break;}
 }
 return null;
}
function structureLevels(d,i,dir,entry,a){
 const from=Math.max(0,i-12),recent=d.slice(from,i+1),pad=Math.max((a[i]||0)*.18,Math.abs(entry)*1e-7);
 let sl=dir==="COMPRAR"?Math.min(...recent.map(c=>c.low))-pad:Math.max(...recent.map(c=>c.high))+pad;
 let risk=dir==="COMPRAR"?entry-sl:sl-entry;if(!(risk>0)||!Number.isFinite(risk))return null;
 const prior=d.slice(Math.max(0,i-80),i).filter(c=>dir==="COMPRAR"?c.high>entry:c.low<entry);
 const levels=prior.map(c=>dir==="COMPRAR"?c.high:c.low).filter(v=>dir==="COMPRAR"?v>entry:v<entry).sort((u,v)=>dir==="COMPRAR"?u-v:v-u);
 const valid=levels.filter(v=>Math.abs(v-entry)>=risk*2);
 const tp1=valid[0]??(dir==="COMPRAR"?entry+2*risk:entry-2*risk);
 const tp2=valid.find(v=>Math.abs(v-entry)>=risk*3&& (dir==="COMPRAR"?v>tp1:v<tp1))??(dir==="COMPRAR"?Math.max(tp1,entry+3*risk):Math.min(tp1,entry-3*risk));
 return{sl,tp1,tp2,risk,rr1:Math.abs(tp1-entry)/risk,rr2:Math.abs(tp2-entry)/risk};
}
function backtest(d,symbol,strategy){
 const close=d.map(c=>c.close),x={e9:ema(close,9),e20:ema(close,20),e21:ema(close,21),e50:ema(close,50),rsi:rsi(close),atr:atr(d),adx:adx(d),macd:macd(close)};
 const warm=80,split=Math.floor(d.length*.7),trades=[];let nextAllowed=warm;
 for(let i=warm;i<d.length-2;i++){
  if(i<nextAllowed)continue;const dir=signalAt(strategy.id,d,i,x);if(!dir)continue;
  const entry=d[i+1].open,levels=structureLevels(d,i,dir,entry,x.atr);if(!levels||levels.rr1<1.99)continue;
  const t={symbol,strategy:strategy.name,direction:dir,signalTime:d[i].time,entryTime:d[i+1].time,entry,sl:levels.sl,tp1:levels.tp1,tp2:levels.tp2,rr1:levels.rr1,rr2:levels.rr2,result:"ABIERTA",split:i<split?"ENTRENAMIENTO":"PRUEBA"};
  let tp1Reached=false;
  for(let j=i+1;j<d.length;j++){
   const c=d[j],stop=dir==="COMPRAR"?c.low<=(tp1Reached?t.entry:t.sl):c.high>=(tp1Reached?t.entry:t.sl),one=dir==="COMPRAR"?c.high>=t.tp1:c.low<=t.tp1,two=dir==="COMPRAR"?c.high>=t.tp2:c.low<=t.tp2;
   // Orden conservador: stop antes de objetivos si ambos aparecen en la misma vela.
   if(stop){t.result=tp1Reached?"TP1":"SL";t.exitTime=c.time;t.exitPrice=tp1Reached?t.entry:t.sl;t.r=tp1Reached?(t.rr1*.5): -1;break;}
   if(two){t.tp1Reached=true;t.tp2Reached=true;t.result="TP2";t.exitTime=c.time;t.exitPrice=t.tp2;t.r=tp1Reached?(t.rr1*.5+t.rr2*.5):t.rr2;break;}
   if(one&&!tp1Reached){tp1Reached=true;t.tp1Reached=true;}
  }
  if(t.result==="ABIERTA"){t.result="SIN_CIERRE";t.exitTime=d.at(-1).time;t.exitPrice=d.at(-1).close;t.r=0;}
  trades.push(t);nextAllowed=Math.max(i+1,d.findIndex((c,j)=>j>i&&c.time>=t.exitTime));
 }
 return trades;
}
function summarize(trades){const closed=trades.filter(t=>t.result!=="SIN_CIERRE"),test=closed.filter(t=>t.split==="PRUEBA"),wins=a=>a.filter(t=>t.result==="TP1"||t.result==="TP2").length;const r=a=>a.reduce((s,t)=>s+t.r,0);const avg=a=>a.length?r(a)/a.length:0;const tp1Count=closed.filter(t=>t.tp1Reached||t.result==="TP1"||t.result==="TP2").length,tp2Count=closed.filter(t=>t.tp2Reached||t.result==="TP2").length,testTp1=test.filter(t=>t.tp1Reached||t.result==="TP1"||t.result==="TP2").length,testTp2=test.filter(t=>t.tp2Reached||t.result==="TP2").length;return{total:trades.length,closed:closed.length,test:test.length,wins:wins(closed),losses:closed.filter(t=>t.result==="SL").length,tp1:tp1Count,tp2:tp2Count,rate:closed.length?wins(closed)/closed.length*100:0,testRate:test.length?wins(test)/test.length*100:0,tp1Rate:closed.length?tp1Count/closed.length*100:0,tp2Rate:closed.length?tp2Count/closed.length*100:0,testTp1Rate:test.length?testTp1/test.length*100:0,testTp2Rate:test.length?testTp2/test.length*100:0,expectancy:avg(closed),testExpectancy:avg(test),profitFactor:(()=>{const pos=closed.filter(t=>t.r>0).reduce((s,t)=>s+t.r,0),neg=Math.abs(closed.filter(t=>t.r<0).reduce((s,t)=>s+t.r,0));return neg?pos/neg:pos?99:0;})(),trades};}
function processInstrument(item,candles){const per=STRATEGIES.map(s=>({...s,...summarize(backtest(candles,item.name,s))}));per.forEach(s=>{s.symbol=item.symbol;s.market=item.name;s.candles=candles.length;});results.push(...per);}
function bestByMarket(){const names=[...new Set(results.map(r=>r.symbol))];return names.map(symbol=>{const rows=results.filter(r=>r.symbol===symbol).sort((a,b)=>{const aa=a.test>=20?a.testRate:-1,bb=b.test>=20?b.testRate:-1;return bb-aa||b.testExpectancy-a.testExpectancy;});return rows[0];}).filter(Boolean);}
function render(){
 const body=$("lab-results");if(!body)return;
 const rows=bestByMarket();
 body.innerHTML=rows.length?rows.map(r=>'<tr><td>'+escapeHtml(r.market)+'</td><td>'+escapeHtml(r.name)+'</td><td>'+fmt(r.testRate)+'%</td><td>'+r.test+'</td><td>'+fmt(r.testExpectancy,2)+'R</td><td>'+fmt(r.profitFactor,2)+'</td></tr>').join(""):'<tr><td colspan="6">Todavía no hay resultados. Pulsa «ANALIZAR TODOS».</td></tr>';
 const all=results.slice().sort((a,b)=>(b.test>=20?b.testRate:-1)-(a.test>=20?a.testRate:-1)||b.testExpectancy-a.testExpectancy);
 const ranking=$("lab-ranking");if(ranking)ranking.innerHTML=all.slice(0,10).map((r,i)=>'<div class="lab-rank-row"><b>#'+(i+1)+' '+escapeHtml(r.market)+'</b><span>'+escapeHtml(r.name)+'</span><strong>'+(r.test>=20?fmt(r.testRate)+'%':"MUESTRA BAJA")+'</strong></div>').join("")||"Esperando resultados.";
 const stats=$("lab-summary");if(stats){const m=rows.length;stats.textContent=m+" instrumentos · "+results.length+" pruebas estrategia/instrumento";}
}
function csvDownload(){if(!results.length)return;const cols=["market","symbol","name","candles","total","closed","test","wins","losses","tp1","tp2","rate","testRate","expectancy","testExpectancy","profitFactor"];const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"';const lines=[cols.join(","),...results.map(r=>cols.map(k=>q(r[k])).join(","))];const trades=results.flatMap(r=>r.trades.map(t=>({...t,market:r.market})));const tradeCols=["market","symbol","strategy","direction","signalTime","entryTime","entry","sl","tp1","tp2","result","exitTime","exitPrice","r","split"];lines.push("","DETALLE_OPERACIONES",tradeCols.join(","),...trades.map(t=>tradeCols.map(k=>q(t[k])).join(",")));const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="BOTDER_LAB_10_ESTRATEGIAS.csv";a.click();URL.revokeObjectURL(url);}
function closeSocket(){if(socket){try{socket.close();}catch{}socket=null;}}
function finish(){busy=false;closeSocket();status("ANÁLISIS TERMINADO · "+results.length+" pruebas calculadas");progress();render();const b=$("lab-start");if(b)b.disabled=false;}
function runScan(){
 if(busy)return;busy=true;scanToken++;const token=scanToken;results=[];cursor=0;symbols=[];render();const b=$("lab-start");if(b)b.disabled=true;status("Conectando con Deriv…");
 closeSocket();socket=new WebSocket(ENDPOINT);
 socket.onopen=()=>socket.send(JSON.stringify({active_symbols:"full",req_id:1}));
 socket.onerror=()=>{if(token===scanToken){status("No se pudo conectar al servicio público de Deriv.");finish();}};
 socket.onclose=()=>{if(busy&&token===scanToken)finish();};
 socket.onmessage=ev=>{
  if(token!==scanToken)return;let msg;try{msg=JSON.parse(ev.data);}catch{return;}
  if(msg.error){if(msg.req_id===1){status("Deriv rechazó la lista de instrumentos: "+msg.error.message);finish();}else next();return;}
  if(msg.msg_type==="active_symbols"){symbols=(msg.active_symbols||[]).filter(s=>/volatility/i.test([s.display_name,s.underlying_symbol_name,s.underlying_symbol,s.market_display_name,s.submarket_display_name].filter(Boolean).join(" "))).map(s=>({symbol:s.underlying_symbol||s.symbol,name:s.underlying_symbol_name||s.display_name||s.underlying_symbol||s.symbol})).filter(s=>s.symbol);if(!symbols.length){status("Deriv no devolvió índices Volatility.");finish();return;}status("Descargando velas M1 de todos los índices…");progress();next();}
  if(msg.req_id===requestId&&msg.msg_type==="history"){const raw=msg.candles||msg.history?.candles||[];const candles=raw.map(c=>({time:Number(c.epoch??c.open_time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter(c=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);if(candles.length>=500&&activeSymbol){processInstrument(activeSymbol,candles);cursor++;progress();render();}else if(activeSymbol){results.push(...STRATEGIES.map(s=>({...s,symbol:activeSymbol.symbol,market:activeSymbol.name,candles:candles.length,total:0,closed:0,test:0,wins:0,losses:0,tp1:0,tp2:0,rate:0,testRate:0,expectancy:0,testExpectancy:0,profitFactor:0,trades:[]})));cursor++;progress();}next();}
 };
 function next(){if(token!==scanToken||!busy)return;if(cursor>=symbols.length){finish();return;}activeSymbol=symbols[cursor];requestId++;status("Analizando "+activeSymbol.name+" · "+(cursor+1)+"/"+symbols.length);socket.send(JSON.stringify({ticks_history:activeSymbol.symbol,count:5000,end:"latest",style:"candles",granularity:60,req_id:requestId}));}
}
function exportAll(){csvDownload();}
function init(){const start=$("lab-start"),exportBtn=$("lab-export");if(start)start.addEventListener("click",runScan);if(exportBtn)exportBtn.addEventListener("click",exportAll);const panel=$("strategy-lab");if(panel){const head=panel.querySelector("summary");if(head)head.addEventListener("click",()=>{if(!results.length)status("Laboratorio listo · analiza los instrumentos para comparar estrategias.");});}}
window.BotderStrategyLab={runScan,exportAll,getResults:()=>results.slice(),strategies:STRATEGIES};
document.addEventListener("DOMContentLoaded",init);
})();