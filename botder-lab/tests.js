/* Pruebas rápidas sin framework. */
(function(){
 const E=window.BotderLabEngines,results=[];
 function test(name,fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
 function assert(v,msg){if(!v)throw new Error(msg||"assert failed");}
 const sample=Array.from({length:80},(_,i)=>{const base=100+i*.12+Math.sin(i*.45)*2;return{time:i*60000,open:base-.15,close:base+.1,high:base+.55,low:base-.55};});
 test("pivotes produce indices ordenados",()=>{const p=E.pivots(sample,2);assert(p.length>0);assert(p.every((x,i)=>i===0||p[i-1].index<=x.index));});
 test("estructura/liquidez no emite señal sin regla confirmada",()=>{const x=E.evaluateLiquidity(sample);assert(x.signal===null);assert(Array.isArray(x.liquidity));});
 test("motores se devuelven separados",()=>{const x=E.runIsolatedEngines(sample);assert("threeTouchBuy"in x&&"threeTouchSell"in x&&"liquidity"in x);assert(x.liquidity.signal===null);});
 test("datos insuficientes no generan tres toques",()=>{const x=E.fitThreeTouch(sample.slice(0,8),"BUY");assert(x.ok===false);});
 const root=document.getElementById("test-results");root.innerHTML=results.map(r=>'<div class="test '+(r.ok?'pass':'fail')+'"><b>'+(r.ok?'✓':'✕')+' '+r.name+'</b>'+(r.error?'<small>'+r.error+'</small>':'')+'</div>').join("");
 document.getElementById("test-summary").textContent=results.filter(x=>x.ok).length+"/"+results.length+" pruebas correctas";
})();
