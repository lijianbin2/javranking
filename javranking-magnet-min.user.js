 // ==UserScript==
 // @name         JavRanking 全榜单通用 - 区间抓取字幕最小磁链(自动下载TXT)
 // @namespace    javranking.magnet.min
 // @version      1.1.3
 // @description  全站所有排行榜通用：在榜单页选排名区间，自动抓取每个作品详情页中字幕磁链里容量最小的一条，抓完自动下载TXT
 // @author       you
 // @match        *://javranking.cc/*
 // @run-at       document-idle
 // @grant        none
 // @downloadURL  https://raw.githubusercontent.com/lijianbin2/javranking/main/javranking-magnet-min.user.js
 // @updateURL    https://raw.githubusercontent.com/lijianbin2/javranking/main/javranking-magnet-min.user.js
 // ==/UserScript==
 (function(){
 'use strict';
 const $ = (s,r)=> (r||document).querySelector(s);
 const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
 const sleep = ms => new Promise(r=>setTimeout(r,ms));
 const LS_KEY='javr_min_cfg_v2';
 let running=false, stopFlag=false;
 let results=new Map(); window.addEventListener('beforeunload',function(e){ if(running){ e.preventDefault(); e.returnValue=''; } });
 let cfg={start:1,end:10,conc:3,delay:400};
 try{ const s=localStorage.getItem(LS_KEY); if(s) cfg=Object.assign(cfg,JSON.parse(s)); }catch(e){}
 function saveCfg(){ try{localStorage.setItem(LS_KEY,JSON.stringify(cfg));}catch(e){} }
 function boardSlug(){
   try{
     const p=location.pathname.replace(/\/$/,'');
     const parts=p.split('/').filter(Boolean);
     let last=parts[parts.length-1]||'board';
     if(last==='most-awarded-videos') return 'most-awarded-videos';
     if(last==='rankings') return 'rankings-index';
     return last;
   }catch(e){ return 'board'; }
 }
 function boardName(){
   const h=document.querySelector('h1');
   return h?h.textContent.trim().slice(0,40):boardSlug();
 }
 function parseSizeToMB(txt){
   if(!txt) return Infinity;
   const m=String(txt).trim().match(/([\d.,]+)\s*([KMGT]?I?B)/i);
   if(!m) return Infinity;
   const num=parseFloat(m[1].replace(/,/g,''));
   if(isNaN(num)) return Infinity;
   let u=m[2].toUpperCase().replace('IB','B');
   if(u==='B') return num/1024/1024;
   if(u==='KB') return num/1024;
   if(u==='MB') return num;
   if(u==='GB') return num*1024;
   if(u==='TB') return num*1024*1024;
   return Infinity;
 }
 function isSub(nm){ return /字幕|中字|中文字幕|熟肉|翻译|Chinese/i.test(nm||''); }
 function getRankingItems(){
   const lis=$$('li[data-rank]');
   const map=new Map();
   lis.forEach(li=>{
     const r=parseInt(li.getAttribute('data-rank'),10);
     if(!r||map.has(r)) return;
     const codeEl=li.querySelector('[data-video-card-code]');
     const titleEl=li.querySelector('[data-video-card-title]');
     const cover=li.querySelector('[data-video-card-cover]');
     const tA=titleEl||cover;
     let href=tA?tA.getAttribute('href'):null;
     if(!href){ const a=li.querySelector('a[href*="/videos/"]'); if(a) href=a.getAttribute('href'); }
     if(!href) return;
     let url='';
     try{ url=new URL(href,location.origin).href; }catch(e){ return; }
     const code=codeEl?codeEl.textContent.trim():'';
     const title=titleEl?titleEl.textContent.trim():(cover?cover.getAttribute('aria-label')||'':'');
     map.set(r,{rank:r,code:code,title:title,url:url});
   });
   if(map.size===0){
     $$('script[type="application/ld+json"]').forEach(sc=>{
       try{
         const j=JSON.parse(sc.textContent);
         const list=Array.isArray(j)?j:[j];
         list.forEach(o=>{
           const arr=o.itemListElement||[];
           arr.forEach(it=>{
             const pos=it.position; const u=it.url; const nm=it.name||'';
             if(pos&&u&&!map.has(pos)) map.set(pos,{rank:pos,code:(nm.split(' ')[0]||''),title:nm,url:u});
           });
         });
       }catch(e){}
     });
   }
   return Array.from(map.values()).sort((a,b)=>a.rank-b.rank);
 }
   async function fetchWithRetry(url,tries){
     tries=tries||3; let lastErr=null;
     for(let i=0;i<tries;i++){
       try{
         const res=await fetch(url,{credentials:'same-origin',headers:{'Accept':'text/html'}});
         if(!res.ok) throw new Error('HTTP '+res.status);
         return await res.text();
       }catch(err){
         lastErr=err;
         const m=String((err&&err.message)||err);
         if(/HTTP (429|5\d\d)/.test(m)||/Failed to fetch|NetworkError|Load failed|network/i.test(m)){
           if(i<tries-1){ await sleep(cfg.delay*(i+1)*2+Math.random()*300); continue; }
         }
         throw err;
       }
     }
     throw lastErr;
   }
 async function fetchSubMin(item){
   const html=await fetchWithRetry(item.url,3);
   const doc=new DOMParser().parseFromString(html,'text/html');
   let nodes=Array.from(doc.querySelectorAll('.magnet-item'));
   const cands=[];
   nodes.forEach(n=>{
     if(!n) return;
     const a=n.querySelector('a[href^="magnet:"]');
     if(!a) return;
     let magnet=(a.getAttribute('href')||'').replace(/&amp;/g,'&');
     const sizeEl=n.querySelector('.magnet-tag--size');
     let sizeText=sizeEl?sizeEl.textContent.trim():'';
     if(!sizeText&&n.textContent){
       const m=n.textContent.match(/[\d.,]+\s*[KMGT]?I?B/i);
       if(m) sizeText=m[0];
     }
     const mb=parseSizeToMB(sizeText);
     const name=((a.getAttribute('title')||a.textContent)||'').trim();
     if(magnet.indexOf('magnet:')===0) cands.push({magnet:magnet,sizeText:sizeText,sizeMB:mb,name:name});
   });
   if(cands.length===0) throw new Error('未找到磁链');
   // 只取字幕：先过滤，没有字幕再回退全局最小并标记
   let pool=cands.filter(c=>isSub(c.name));
   let noSub=false;
   if(pool.length===0){ pool=cands; noSub=true; }
   pool.sort((a,b)=>a.sizeMB-b.sizeMB);
   const best=pool[0];
   best.noSub=noSub;
   best.total=cands.length;
   best.subCount=cands.filter(c=>isSub(c.name)).length;
   return best;
 }
 function copyText(t){
   if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
   return new Promise((res,rej)=>{
     const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select();
     try{ document.execCommand('copy'); res(); }catch(e){ rej(e); }
     ta.remove();
   });
 }
 function download(name,content,mime){
   const b=new Blob([content],{type:mime||'text/plain;charset=utf-8'});
   const u=URL.createObjectURL(b);
   const a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click();
   setTimeout(()=>{URL.revokeObjectURL(u); a.remove();},1500);
 }
 function buildDetailTXT(arr,s,e){
   let out='';
   out+='# '+boardName()+' '+location.href+'\n';
   out+='# 排名 '+s+'-'+e+' 字幕最小，共'+arr.filter(v=>!v.error).length+'成功 / '+arr.filter(v=>v.error).length+'失败（失败已剔除不列出），'+new Date().toLocaleString()+'\n';
   out+='# 说明：每组第一行为信息行(#开头)，第二行为磁链。批量导入时只取 magnet: 开头行即可。无字幕的会标注 [无字幕回退为全局最小]\n\n';
   arr.forEach(v=>{
     if(v.error){ return; }
     else{
       const flag=v.noSub?' [无字幕回退为全局最小,共'+v.total+'条]':' [字幕'+v.subCount+'条选最小]';
       out+='#'+v.rank+' '+v.code+' '+v.sizeText+flag+' '+v.title+'\n'+v.magnet+'\n\n';
     }
   });
   return out;
 }
 function buildUI(){
   if($('#javr-min-panel')) return;
   const st=document.createElement('style');
   st.textContent='#javr-min-panel{position:fixed;right:12px;top:70px;width:440px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.22);z-index:999999;font-size:13px;color:#111827;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}#javr-min-head{background:#111827;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:8px}#javr-min-head b{font-size:14px;flex:1}#javr-min-head button{background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}#javr-min-body{padding:10px 12px;overflow:auto}#javr-min-body .row{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}#javr-min-body input[type=number]{width:70px;padding:5px 6px;border:1px solid #d1d5db;border-radius:6px}#javr-min-btns button{padding:6px 10px;border-radius:8px;border:1px solid #d1d5db;background:#f9fafb;cursor:pointer}#javr-min-btns button.primary{background:#111827;color:#fff;border-color:#111827}#javr-min-btns button:disabled{opacity:.5;cursor:not-allowed}#javr-min-prog{height:8px;background:#f3f4f6;border-radius:99px;overflow:hidden;margin:8px 0}#javr-min-bar{height:100%;width:0;background:#10b981}#javr-min-log{background:#0f172a;color:#d1fae5;font-size:11px;border-radius:8px;padding:8px;max-height:110px;overflow:auto;white-space:pre-wrap;margin-bottom:8px}#javr-min-table{width:100%;border-collapse:collapse;font-size:12px}#javr-min-table th,#javr-min-table td{border-bottom:1px solid #eee;padding:5px 4px;text-align:left;vertical-align:top}#javr-min-table td.m{font-family:ui-monospace,Consolas,monospace;word-break:break-all}#javr-min-table a{color:#2563eb;text-decoration:none}#javr-min-foot{color:#6b7280;font-size:11px;margin-top:6px}';
   document.head.appendChild(st);
   const p=document.createElement('div'); p.id='javr-min-panel';
   p.innerHTML='<div id="javr-min-head"><b>榜单字幕最小磁链</b><button id="javr-min-hide" title="折叠/展开">—</button></div><div id="javr-min-body"><div class="row"><label>从 <input id="javr-min-s" type="number" min="1" value="'+cfg.start+'"></label><label>到 <input id="javr-min-e" type="number" min="1" value="'+cfg.end+'"></label><span id="javr-min-max" style="color:#6b7280"></span></div><div class="row"><label>并发 <input id="javr-min-c" type="number" min="1" max="6" value="'+cfg.conc+'" style="width:50px"></label><label>间隔ms <input id="javr-min-d" type="number" min="0" step="100" value="'+cfg.delay+'" style="width:64px"></label></div><div class="row" id="javr-min-btns"><button id="javr-min-go" class="primary">开始抓取</button><button id="javr-min-stop" disabled>停止</button><button id="javr-min-copy">复制全部磁链</button></div><div class="row" id="javr-min-btns2"><button id="javr-min-txt">手动再下一次TXT</button><button id="javr-min-retry">重试失败</button><button id="javr-min-clear">清空</button></div><div style="color:#059669;font-size:12px;margin-bottom:4px">固定逻辑：只取【字幕磁链中最小】，无字幕则回退全局最小并标注。抓完自动下载TXT。网络失败自动重试3次，遇限流自动加间隔，无需手动调。</div><div id="javr-min-prog"><div id="javr-min-bar"></div></div><div id="javr-min-stat" style="margin-bottom:6px;color:#374151">就绪</div><div id="javr-min-log"></div><table id="javr-min-table"><thead><tr><th style="width:36px">#</th><th>番号/标题</th><th style="width:70px">字幕最小</th><th>磁链</th></tr></thead><tbody id="javr-min-tb"><tr><td colspan="4" style="color:#9ca3af">暂无结果。输入排名区间后点 开始抓取。</td></tr></tbody></table><div id="javr-min-foot">适配：most-awarded-videos 与 /rankings/下所有榜单（DMM/JAVDB/JAVLibrary/TOP250/年度榜等）。解析 li[data-rank] + 详情页 .magnet-item / .magnet-tag--size。</div></div>';
   document.body.appendChild(p);
   const body=$('#javr-min-body');
   $('#javr-min-hide').onclick=()=>{ body.style.display=body.style.display==='none'?'':'none'; };
   const updMax=()=>{ const items=getRankingItems(); const mx=items.length?items[items.length-1].rank:0; $('#javr-min-max').textContent=mx?('本榜共 '+items.length+' 部，最大 '+mx):'(本页未检测到榜单)'; return items; };
   setTimeout(updMax,800);
   setInterval(()=>{ if(!running) updMax(); },3000);
   function log(m){ const el=$('#javr-min-log'); el.textContent+='['+new Date().toLocaleTimeString()+'] '+m+'\n'; el.scrollTop=el.scrollHeight; }
   function stat(t,d){ $('#javr-min-stat').textContent=t; if(d!=null){ $('#javr-min-bar').style.width=Math.round(d*100)+'%'; } }
   function render(){
     const tb=$('#javr-min-tb'); tb.innerHTML='';
     const arr=Array.from(results.values()).sort((a,b)=>a.rank-b.rank);
     if(arr.length===0){ tb.innerHTML='<tr><td colspan="4" style="color:#9ca3af">暂无结果。</td></tr>'; return; }
     arr.forEach(r=>{
       const tr=document.createElement('tr');
       if(r.error){ tr.innerHTML='<td>'+r.rank+'</td><td>'+(r.code||'')+'<br><span style="color:#ef4444">失败:'+r.error+'</span><br><a href="'+r.url+'" target="_blank">打开详情</a></td><td>—</td><td>—</td>'; }
       else{ const flag=r.noSub?'<br><span style="color:#d97706">[无字幕,全局最小]</span>':''; tr.innerHTML='<td>'+r.rank+'</td><td><b>'+(r.code||'')+'</b><br><a href="'+r.url+'" target="_blank">'+(r.title||'').slice(0,40)+'</a><br><span style="color:#6b7280">'+(r.mname||'').slice(0,40)+'</span>'+flag+'</td><td>'+r.sizeText+'</td><td class="m"><a href="'+r.magnet+'" title="'+r.magnet+'">磁链打开</a> <button data-cp="'+r.rank+'" style="cursor:pointer">复制</button><br><span style="color:#6b7280">'+r.magnet.slice(0,46)+'...</span></td>'; }
       tb.appendChild(tr);
     });
     tb.querySelectorAll('button[data-cp]').forEach(b=>{ b.onclick=()=>{ const rr=results.get(parseInt(b.getAttribute('data-cp'),10)); if(rr&&rr.magnet) copyText(rr.magnet).then(()=>log('#'+rr.rank+' 已复制')); }; });
   }
   function autoDownloadTXT(){
     const arr=Array.from(results.values()).filter(v=>v.rank>=cfg.start&&v.rank<=cfg.end).sort((a,b)=>a.rank-b.rank);
     if(arr.length===0) return;
     const okArr=arr.filter(v=>!v.error);
     if(okArr.length===0){ log('成功 0 条，失败 '+arr.length+' 条，已按设置剔除，不下载TXT'); return; }
     const txt=buildDetailTXT(arr,cfg.start,cfg.end);
     const fn='javranking_'+boardSlug()+'_'+cfg.start+'-'+cfg.end+'_字幕最小磁链.txt';
     download(fn,txt);
     log('已自动下载 '+fn+'（'+okArr.length+' 成功，失败已剔除）');
   }
   async function ensureItems(s,e,known){
     let map=new Map(known.map(o=>[o.rank,o]));
     let missing=[];
     for(let r=s;r<=e;r++) if(!map.has(r)) missing.push(r);
     if(missing.length===0) return map;
     log('DOM 缺 '+missing.length+' 部，按 ?page 补拉…');
     const pageSize=20;
     const pages=Array.from(new Set(missing.map(r=>Math.ceil(r/pageSize))));
     for(const pg of pages){
       if(stopFlag) break;
       try{
         const u=new URL(location.href); u.searchParams.set('page',pg);
         const res=await fetch(u.href,{credentials:'same-origin'}); const html=await res.text();
         const doc=new DOMParser().parseFromString(html,'text/html');
         doc.querySelectorAll('li[data-rank]').forEach(li=>{
           const r=parseInt(li.getAttribute('data-rank'),10); if(!r||map.has(r)) return;
           const codeEl=li.querySelector('[data-video-card-code]'); const titleEl=li.querySelector('[data-video-card-title]');
           const a2=li.querySelector('a[href*="/videos/"]'); if(!a2) return;
           map.set(r,{rank:r,code:codeEl?codeEl.textContent.trim():'',title:titleEl?titleEl.textContent.trim():'',url:new URL(a2.getAttribute('href'),location.origin).href});
         });
         await sleep(300);
       }catch(err){ log('补拉第'+pg+'页失败:'+err.message); }
     }
     return map;
   }
   async function run(retryOnly){
     if(running) return;
     cfg.start=Math.max(1,parseInt($('#javr-min-s').value||'1',10));
     cfg.end=Math.max(cfg.start,parseInt($('#javr-min-e').value||cfg.start,10));
     cfg.conc=Math.min(6,Math.max(1,parseInt($('#javr-min-c').value||'3',10)));
     cfg.delay=Math.max(0,parseInt($('#javr-min-d').value||'0',10));
     saveCfg();
     running=true; stopFlag=false;
     $('#javr-min-go').disabled=true; $('#javr-min-stop').disabled=false;
     let known=getRankingItems();
     let map=await ensureItems(cfg.start,cfg.end,known);
     let queue=[];
     for(let r=cfg.start;r<=cfg.end;r++){
       const it=map.get(r);
       if(!it){ results.set(r,{rank:r,code:'',title:'',url:'',error:'榜单未找到该排名'}); continue; }
       if(retryOnly&&results.has(r)&&!results.get(r).error) continue;
       queue.push(it);
     }
     render();
     log('开始: '+boardName()+' '+cfg.start+'-'+cfg.end+'，待抓 '+queue.length+' 部，并发'+cfg.conc+'，只取字幕最小');
     let done=0; const total=queue.length;
     stat('抓取中 0/'+total,0);
     let idx=0;
     async function worker(){
       while(idx<queue.length&&!stopFlag){
         const it=queue[idx++];
         try{
           stat('抓取中 '+done+'/'+total+' (正在:#'+it.rank+' '+it.code+')',total?done/total:0);
           const best=await fetchSubMin(it);
           results.set(it.rank,{rank:it.rank,code:it.code,title:it.title,url:it.url,magnet:best.magnet,sizeText:best.sizeText,sizeMB:best.sizeMB,mname:best.name,noSub:best.noSub,total:best.total,subCount:best.subCount});
           log('#'+it.rank+' '+it.code+' 字幕最小 '+best.sizeText+(best.noSub?' [无字幕回退]':'')+' '+best.name.slice(0,30));
         }catch(err){ results.set(it.rank,{rank:it.rank,code:it.code,title:it.title,url:it.url,error:String(err.message||err).slice(0,80)}); log('#'+it.rank+' 失败:'+err.message); if(/429|50\d|Failed to fetch|NetworkError|Load failed/i.test(String((err&&err.message)||''))){ cfg.delay=Math.min(cfg.delay+500,5000); const dEl=$('#javr-min-d'); if(dEl) dEl.value=cfg.delay; try{saveCfg();}catch(e2){} log('检测到限流/网络波动，间隔已自动上调到 '+cfg.delay+'ms，后续请求自动沿用'); } }
         done++; render(); stat('抓取中 '+done+'/'+total,done/total);
         if(cfg.delay) await sleep(cfg.delay);
       }
     }
     const ws=[]; for(let i=0;i<Math.min(cfg.conc,queue.length);i++) ws.push(worker());
     await Promise.all(ws);
     running=false; $('#javr-min-go').disabled=false; $('#javr-min-stop').disabled=true;
     const okN=Array.from(results.values()).filter(v=>!v.error&&v.rank>=cfg.start&&v.rank<=cfg.end).length;
     stat(stopFlag?('已停止 '+done+'/'+total):('完成 '+done+'/'+total+'，成功 '+okN),total?done/total:1);
     log(stopFlag?'已手动停止':'全部完成，准备自动下载TXT…');
     render();
     if(!stopFlag) autoDownloadTXT();
   }
   $('#javr-min-go').onclick=()=>run(false); ["#javr-min-s","#javr-min-e","#javr-min-c","#javr-min-d"].forEach(function(sel){ const el=$(sel); if(el) el.addEventListener("keydown",function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); run(false); } }); });
   $('#javr-min-retry').onclick=()=>run(true);
   $('#javr-min-stop').onclick=()=>{ stopFlag=true; };
   $('#javr-min-clear').onclick=()=>{ results.clear(); render(); $('#javr-min-log').textContent=''; stat('已清空',0); };
   $('#javr-min-copy').onclick=()=>{
     const arr=Array.from(results.values()).filter(v=>!v.error&&v.magnet).sort((a,b)=>a.rank-b.rank).map(v=>v.magnet);
     if(!arr.length){ alert('暂无可复制的磁链'); return; }
     copyText(arr.join('\n')).then(()=>log('已复制 '+arr.length+' 条磁链')).catch(()=>alert('复制失败'));
   };
   $('#javr-min-txt').onclick=()=>{ autoDownloadTXT(); };
   window._javrMin={getRankingItems:getRankingItems,results:results};
 }
 function init(){
   const items=getRankingItems();
   // 只有榜单页才挂面板：most-awarded-videos 或 rankings/详情页 且有 li[data-rank]
   const isBoard=/most-awarded-videos|\/rankings\//.test(location.pathname);
   if(!isBoard) return;
   if(items.length===0){
     let n=0;
     const t=setInterval(()=>{ n++; const it=getRankingItems(); if(it.length>0||n>20){ clearInterval(t); if(it.length>0) buildUI(); } },800);
     return;
   }
   buildUI();
 }
 init();
 })();
