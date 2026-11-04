/* BOTDER LAB — motores independientes. Sin dependencias externas. */
(function(root){
  "use strict";
  const finite=n=>Number.isFinite(Number(n));
  function pivots(candles,depth=3){
    const out=[];
    for(let i=depth;i<candles.length-depth;i++){
      let hi=true,lo=true;
      for(let k=1;k<=depth;k++){
        if(candles[i].high<=candles[i-k].high||candles[i].high<candles[i+k].high)hi=false;
        if(candles[i].low>=candles[i-k].low||candles[i].low>candles[i+k].low)lo=false;
      }
      if(hi)out.push({index:i,time:candles[i].time,price:candles[i].high,type:"high",confirmedAt:i+depth});
      if(lo)out.push({index:i,time:candles[i].time,price:candles[i].low,type:"low",confirmedAt:i+depth});
    }
    return out.sort((a,b)=>a.index-b.index);
  }
  const lineAt=(a,b,x)=>a.price+(b.price-a.price)*(x-a.index)/(b.index-a.index);
  function fitThreeTouch(candles,side,options={}){
    const depth=options.depth??3,tolerance=options.tolerance??0.0008,minGap=options.minGap??4;
    const ps=pivots(candles,depth).filter(p=>p.type===(side==="BUY"?"low":"high"));
    if(ps.length<3)return{ok:false,reason:"Faltan tres pivotes confirmados",pivots:ps};
    // Usa los dos pivotes anteriores para proyectar la misma línea; el tercero valida el contacto.
    for(let j=2;j<ps.length;j++){
      const a=ps[j-2],b=ps[j-1],c=ps[j];
      if(b.index-a.index<minGap||c.index-b.index<minGap)continue;
      const projected=lineAt(a,b,c.index),delta=Math.abs(c.price-projected);
      const scale=Math.max(Math.abs(projected),1);
      if(delta/scale>tolerance)continue;
      // BUY: soporte ascendente; SELL: resistencia descendente.
      if(side==="BUY"&&b.price<=a.price)continue;
      if(side==="SELL"&&b.price>=a.price)continue;
      const slope=(b.price-a.price)/(b.index-a.index);
      const touches=[a,b,c];
      const touchIndex=c.index;
      const touchLine=lineAt(a,b,touchIndex);
      const rejection=findRejection(candles,touchIndex,side,touchLine,tolerance);
      if(!rejection)continue;
      const confirmation=threeCloses(candles,rejection.index,side);
      if(!confirmation)continue;
      const opposite=oppositeBoundary(candles,ps,touches,side,slope);
      const tp1=opposite?lineAt(opposite.a,opposite.b,confirmation.endIndex):null;
      const next=allOppositePivots(candles,depth,side).find(p=>p.index>confirmation.endIndex);
      const firstTouchLine=lineAt(a,b,a.index);
      const pad=Math.max(Math.abs(a.price)*0.00015,1e-8);
      const sl=side==="BUY"?a.price-pad:a.price+pad;
      return{ok:true,side,touches,rejection,confirmation,entryIndex:confirmation.endIndex,
        entry:candles[confirmation.endIndex].close,trendline:{a,b,slope},channel:opposite,
        levels:{tp1,tp2:next?.price??null,sl},reason:"Tres contactos + rechazo + tres cierres a favor"};
    }
    return{ok:false,reason:"No se encontró una secuencia válida de tres contactos",pivots:ps};
  }
  function findRejection(candles,start,side,level,tolerance){
    for(let i=start;i<Math.min(candles.length,start+4);i++){
      const c=candles[i],body=Math.abs(c.close-c.open),lower=Math.min(c.open,c.close)-c.low,upper=c.high-Math.max(c.open,c.close);
      const near=Math.abs((side==="BUY"?c.low:c.high)-level)/Math.max(Math.abs(level),1)<=tolerance*2;
      const wick=side==="BUY"?lower>=body*0.8&&c.close>c.open:upper>=body*0.8&&c.close<c.open;
      if(near&&wick)return{index:i,level};
    }
    return null;
  }
  function threeCloses(candles,rejectionIndex,side){
    const start=rejectionIndex+1,end=start+2;if(end>=candles.length)return null;
    for(let i=start;i<=end;i++){
      const c=candles[i],prev=candles[i-1];
      if(side==="BUY"?(c.close<=c.open||c.close<=prev.close):(c.close>=c.open||c.close>=prev.close))return null;
    }
    return{startIndex:start,endIndex:end,count:3};
  }
  function oppositeBoundary(candles,sidePivots,touches,side,slope){
    const wanted=side==="BUY"?"high":"low";
    const opp=pivots(candles,3).filter(p=>p.type===wanted&&p.index>touches[0].index&&p.index<touches[2].index);
    if(opp.length<2)return null;
    const a=opp[0],b=opp[opp.length-1];
    // Borde paralelo al soporte/resistencia principal, desplazado al extremo opuesto observado.
    const offset=(a.price-lineAt(touches[0],touches[1],a.index));
    return{a:{index:touches[0].index,price:touches[0].price+offset},b:{index:touches[1].index,price:touches[1].price+offset},slope};
  }
  function allOppositePivots(candles,depth,side){return pivots(candles,depth).filter(p=>p.type===(side==="BUY"?"high":"low"));}
  function evaluateLiquidity(candles,depth=3){
    const ps=pivots(candles,depth),highs=ps.filter(p=>p.type==="high"),lows=ps.filter(p=>p.type==="low");
    const zones=[];
    for(const p of highs)zones.push({kind:"LIQUIDEZ_SUPERIOR",price:p.price,index:p.index});
    for(const p of lows)zones.push({kind:"LIQUIDEZ_INFERIOR",price:p.price,index:p.index});
    const obs=[],fvgs=[];
    for(let i=2;i<candles.length;i++){
      const a=candles[i-2],b=candles[i-1],c=candles[i];
      if(c.low>b.high)fvgs.push({side:"BUY",low:b.high,high:c.low,index:i});
      if(c.high<b.low)fvgs.push({side:"SELL",low:c.high,high:b.low,index:i});
      if(b.close<b.open&&c.close>c.open&&c.close>b.high)obs.push({side:"BUY",low:b.low,high:b.high,index:i});
      if(b.close>b.open&&c.close<c.open&&c.close<b.low)obs.push({side:"SELL",low:b.low,high:b.high,index:i});
    }
    return{pivots:ps,liquidity:zones,orderBlocks:obs,fvgs,signal:null,
      status:"CONTEXTO DETECTADO — regla exacta de entrada pendiente de confirmar"};
  }
  function runIsolatedEngines(candles,options={}){
    return{
      threeTouchBuy:fitThreeTouch(candles,"BUY",options.threeTouch),
      threeTouchSell:fitThreeTouch(candles,"SELL",options.threeTouch),
      liquidity:evaluateLiquidity(candles,options.liquidityDepth??3)
    };
  }
  root.BotderLabEngines={pivots,fitThreeTouch,evaluateLiquidity,runIsolatedEngines};
})(typeof window!=="undefined"?window:globalThis);
