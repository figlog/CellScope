'use strict';
/* CellScope standalone local UI. The original TIFFs never leave 127.0.0.1. */
const LETTERS=['A','B','C','D'];
const THICK={A:['right','bottom'], B:['left','bottom'], C:['left','top'], D:['right','top']};
const $=(id)=>document.getElementById(id);
const state={
 images:[], quarters:Object.fromEntries(LETTERS.map(k=>[k,{imageId:null,roi:null,points:[],confirmed:false,thickSides:[...THICK[k]]}])),
 letter:'A', mode:'roi', dilution:1, zoom:1,panX:0,panY:0, showPoints:true,
 drag:null,history:Object.fromEntries(LETTERS.map(k=>[k,[]])),busy:false
};
const cvs=$('count-canvas'),ctx=cvs.getContext('2d');
let view={scale:1,x:0,y:0,w:1,h:1};
let toastTimeout=null;

function escapeHtml(v){return String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function toast(msg,error=false){const el=$('toast');el.textContent=msg;el.classList.toggle('error',error);el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3600);}
async function api(path,options={}){
 const response=await fetch(path,options);
 if(!response.ok){let error=String(response.status);try{const data=await response.json();error=data.error||error;}catch{}throw new Error(error);}
 return response;
}
function pointCount(q){return q.roi&&q.imageId ? q.points.filter(p=>p.included).reduce((n,p)=>n+Number(p.mult||1),0):null;}
function currentThick(){return currentQ().thickSides||THICK[state.letter];}
function activeImage(){return state.images.find(i=>i.id===state.quarters[state.letter].imageId)||null;}
function currentQ(){return state.quarters[state.letter];}
function allReady(){return LETTERS.every(k=>{const q=state.quarters[k];return q.roi&&q.imageId;});}
function getTotal(){return LETTERS.reduce((n,k)=>n+(pointCount(state.quarters[k])||0),0);}
function formatConc(n){if(!Number.isFinite(n))return '—';return n.toExponential(2).replace('e+',' × 10^').replace('e-',' × 10^-').replace(/^(.*) × 10\^(-?\d+)$/,(_m,a,b)=>`${a} × 10${superscript(b)}`);}
function superscript(x){return String(x).split('').map(c=>({'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'}[c]||c)).join('');}
function snapshot(){const k=state.letter;state.history[k].push(JSON.stringify(state.quarters[k]));if(state.history[k].length>35)state.history[k].shift();}
function undo(){const prev=state.history[state.letter].pop();if(!prev){toast('戻す操作はありません');return;}state.quarters[state.letter]=JSON.parse(prev);refresh();}
function modeSet(mode){state.mode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('roi-caption').classList.toggle('hidden',mode!=='roi'||!activeImage());cvs.style.cursor=mode==='pan'?'grab':mode==='add'?'copy':mode==='remove'?'not-allowed':'crosshair';updateHint();}
function updateHint(){const dict={roi:'角から角までドラッグして1 mm四方の区画を指定',add:'細胞をクリックしてマーカーを追加',remove:'点をクリックして削除',toggle:'点をクリックして採用/除外を切り替え',inc:'重なった細胞をクリックして個数を+1',dec:'重なった細胞をクリックして個数を−1',pan:'ドラッグで移動。ホイールでも拡大縮小できます'};
 $('canvas-hint').textContent=activeImage()?dict[state.mode]:'画像を読み込んでください';}
function refresh(){
 const q=currentQ(), im=activeImage(), count=pointCount(q), ready=allReady(),total=getTotal();
 $('total-count').innerHTML=ready?`${total.toLocaleString('ja-JP')}<span class="summary-unit"> 個</span>`:'—<span class="summary-unit"> 個</span>';
 $('count-status').textContent=ready?'4区画の合計（自動候補を含む）':`${LETTERS.filter(k=>state.quarters[k].roi&&state.quarters[k].imageId).length} / 4 区画のROIを設定済み`;
 const dil=Number(state.dilution);
 $('concentration').textContent=ready&&dil>0?formatConc(total/4*1e4*dil):'—';
 const verified=LETTERS.filter(k=>state.quarters[k].confirmed).length;
 $('confirmed-count').textContent=verified;
 $('progress-bar').style.width=`${verified/4*100}%`;
 document.querySelectorAll('[data-tab]').forEach(b=>{
  const k=b.dataset.tab,s=state.quarters[k],n=pointCount(s);
  b.classList.toggle('active',k===state.letter);b.classList.toggle('checked',s.confirmed);
  b.querySelector('small').textContent=n==null?'—':String(n);
 });
 $('current-count').textContent=count==null?'—':String(count);
 $('active-badge').textContent=state.letter;
 $('number-points').textContent=q.roi?q.points.filter(p=>p.included).length:'—';
 $('number-excluded').textContent=q.roi?q.points.filter(p=>!p.included).length:'—';
 $('thick-select').value=currentThick().join('+');
 $('confirmed').checked=!!q.confirmed;
 $('confirmed').disabled=!q.roi;
 $('display-image-name').textContent=im?im.name:'画像未選択';
 $('image-size').textContent=im?`${im.width}×${im.height} px`:'';
 $('image-placeholder').classList.toggle('hidden',!!im);
 $('files-count').textContent=`${state.images.length} 枚`;
 const roiText=q.roi ? `ROI：${Math.round(q.roi[2]-q.roi[0])} × ${Math.round(q.roi[3]-q.roi[1])} px${q.confirmed?' · 確認済み':''}`:'計数範囲が未設定です';
 $('roi-status').textContent=roiText;
 $('roi-status').classList.toggle('ok',!!q.roi);
 $('previous-note').classList.toggle('hidden',!im||!im.previous||im.previous.letter!==state.letter);
 if(im&&im.previous&&im.previous.letter===state.letter)
    $('previous-note').textContent=`前回の暫定データと一致：区画 ${state.letter}。検出点とROIを復元できます（目視確認が必要です）。`;
 updateMapping();updateHint();render();
}
function updateMapping(){const selected=currentQ().imageId||'';const sel=$('image-select');
 const previous=sel.value;
 sel.replaceChildren(new Option('画像を選択してください',''));
 for(const im of state.images){const opt=new Option(im.name,im.id);sel.add(opt);}
 sel.value=selected;
}
function selectTab(letter){if(!LETTERS.includes(letter))return;state.letter=letter;resetView();if(currentQ().roi)modeSet('toggle');else modeSet('roi');refresh();}
function resetView(){state.zoom=1;state.panX=0;state.panY=0;$('zoom-label').textContent='100%';}
function zoom(f){state.zoom=Math.max(.55,Math.min(12,state.zoom*f));$('zoom-label').textContent=`${Math.round(state.zoom*100)}%`;render();}
function setBusy(v,msg=''){state.busy=!!v;$('run-detect').disabled=v;$('export-secondary').disabled=v;$('btn-export').disabled=v;if(msg){$('upload-progress').classList.remove('hidden');$('upload-progress').textContent=msg;}else $('upload-progress').classList.add('hidden');}

async function uploadFiles(files){if(!files.length)return;
 if(state.busy){toast('ほかの処理の終了後に実行してください',true);return;}
 setBusy(true,'画像を読み込んでいます...');let loaded=0;
 try{
  for(let f of files){
   if(!/\.(tif|tiff|png|jpe?g|bmp|webp)$/i.test(f.name)){toast(`${f.name}：画像形式が対象外です`,true);continue;}
   $('upload-progress').textContent=`読み込み中 ${loaded+1}/${files.length}：${f.name}`;
   const res=await api(`/api/upload?name=${encodeURIComponent(f.name)}`,{method:'POST',body:f});
   const data=await res.json();
   if(state.images.find(im=>im.sha256===data.sha256)){loaded++;continue;}
   const im={...data,bitmap:new Image(),loaded:false};
   im.bitmap.onload=()=>{im.loaded=true;render();};
   im.bitmap.onerror=()=>toast(`プレビュー取得に失敗：${im.name}`,true);
   im.bitmap.src=im.url;
   state.images.push(im);
   const match=data.previous;
   let dest=match?match.letter:LETTERS.find(k=>!state.quarters[k].imageId);
   if(dest){const q=state.quarters[dest];
    if(match){q.imageId=im.id;q.roi=match.roi.slice();q.points=match.points;q.confirmed=false;q.thickSides=[...THICK[dest]];}
    else{q.imageId=im.id;q.roi=null;q.points=[];q.confirmed=false;}
   }
   loaded++;
  }
  if(loaded)toast(`${loaded}枚読み込みました。格子線と検出点を確認してください。`);
  if(state.images.length){selectTab('A');}
 }catch(err){toast(`画像読み込みエラー：${err.message}`,true);}
 finally{setBusy(false);refresh();$('file-input').value='';}
}

function assignImage(id){const q=currentQ();
 if(q.imageId===id)return;
 if(q.points.length&&!confirm('画像を変更すると、この区画の現在の検出点とROIが置き換わります。変更しますか？')){updateMapping();return;}
 snapshot();q.imageId=id||null;q.roi=null;q.points=[];q.confirmed=false;
 const im=state.images.find(it=>it.id===id);
 if(im&&im.previous?.letter===state.letter){q.roi=im.previous.roi.slice();q.points=structuredClone(im.previous.points);}
 resetView();modeSet(q.roi?'toggle':'roi');refresh();
}

async function runDetect(){const q=currentQ(),im=activeImage();if(!im||!q.roi){toast('先に画像を選び、ROIを指定してください。',true);return;}
 if(q.points.length&&!confirm('現在の検出点を自動検出結果で置き換えます。よろしいですか？'))return;
 setBusy(true,'自動検出を実行しています...');
 try{const res=await api('/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  imageId:im.id,roi:q.roi,letter:state.letter,mode:$('detect-mode').value,
  threshold:Number($('threshold').value),minArea:Number($('min-area').value),maxArea:Number($('max-area').value),
  estimateMulti:$('estimate-multi').checked,thickSides:currentThick()})});
  const data=await res.json();snapshot();q.points=data.points;q.confirmed=false;modeSet('toggle');refresh();toast(`${data.points.length}件の候補を検出（採用個数 ${data.count}）。目視確認してください。`);
 }catch(err){toast(`検出できませんでした：${err.message}`,true);}finally{setBusy(false);}
}

function resize(){const r=$('canvas-wrap').getBoundingClientRect();const dpr=window.devicePixelRatio||1;
 cvs.width=Math.max(1,Math.round(r.width*dpr));cvs.height=Math.max(1,Math.round(r.height*dpr));cvs.style.width=`${r.width}px`;cvs.style.height=`${r.height}px`;render();}
function render(){if(!ctx)return;const dpr=window.devicePixelRatio||1;const w=cvs.width/dpr,h=cvs.height/dpr;
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const im=activeImage(),q=currentQ();
 if(!im||!im.loaded){view={scale:1,x:0,y:0,w,h};return;}
 const fit=Math.min((w-20)/im.width,(h-20)/im.height);
 const s=fit*state.zoom;
 const x=(w-im.width*s)/2+state.panX,y=(h-im.height*s)/2+state.panY;
 view={scale:s,x,y,w,h};
 ctx.imageSmoothingEnabled=true;ctx.drawImage(im.bitmap,x,y,im.width*s,im.height*s);
 if(q.roi){drawRoi(q.roi,false);}
 if(state.drag?.type==='roi'&&state.drag?.point){const a=state.drag.start,b=state.drag.point;const roi=[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)];drawRoi(roi,true);}
 if(state.showPoints){
  for(const p of q.points){
   const px=x+p.x*s,py=y+p.y*s;
   if(px<-15||py<-15||px>w+15||py>h+15)continue;
   const isManual=p.source==='manual';
   const color=!p.included?'#e8525b':isManual?'#03a9d2':'#27c46e';
   ctx.beginPath();ctx.arc(px,py,5.4,0,Math.PI*2);
   ctx.fillStyle=p.included?(isManual?'#0799c733':'#2ccf7844'):'#eb555520';ctx.fill();
   ctx.lineWidth=1.9;ctx.strokeStyle=color;ctx.stroke();
   if(!p.included){ctx.strokeStyle='#e8525b';ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(px-4,py-4);ctx.lineTo(px+4,py+4);ctx.moveTo(px-4,py+4);ctx.lineTo(px+4,py-4);ctx.stroke();}
   if(p.mult>1){ctx.font='bold 12px system-ui';ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.strokeText(String(p.mult),px+8,py-7);ctx.fillStyle='#cf6e08';ctx.fillText(String(p.mult),px+8,py-7);}
  }
 }
}
function drawRoi(roi,temporary){if(!roi)return;
 const [x0,y0,x1,y1]=roi;const s=view.scale;
 const left=view.x+x0*s,top=view.y+y0*s,right=view.x+x1*s,bottom=view.y+y1*s;
 if(!temporary){ctx.fillStyle='#00b67f0b';ctx.fillRect(left,top,right-left,bottom-top);}
 const lines=[['top',left,top,right,top],['right',right,top,right,bottom],['bottom',left,bottom,right,bottom],['left',left,top,left,bottom]];
 for(const [side,ax,ay,bx,by] of lines){ctx.save();ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.lineWidth=temporary?1.5:2.6;
  ctx.setLineDash(temporary?[6,4]:[]);
  ctx.strokeStyle=temporary?'#e7ffad':currentThick().includes(side)?'#ff535f':'#08b5e0';ctx.stroke();ctx.restore();}
 if(!temporary){ctx.fillStyle='#fff';ctx.font='700 12px system-ui';ctx.strokeStyle='#234032';ctx.lineWidth=3;ctx.strokeText(state.letter,left+7,top+18);ctx.fillText(state.letter,left+7,top+18);}
}
function canvasCoords(evt){const r=cvs.getBoundingClientRect();return{x:evt.clientX-r.left,y:evt.clientY-r.top};}
function imageCoords(pos){return{x:(pos.x-view.x)/view.scale,y:(pos.y-view.y)/view.scale};}
function clampImage(p,im){return{x:Math.max(0,Math.min(im.width-1,p.x)),y:Math.max(0,Math.min(im.height-1,p.y))};}
function inRoi(p,roi,pad=0){return p.x>=roi[0]-pad&&p.x<=roi[2]+pad&&p.y>=roi[1]-pad&&p.y<=roi[3]+pad;}
function nearestPoint(pos){const points=currentQ().points;const thresh=Math.min(65,Math.max(13,12/view.scale));let best=-1,dist=thresh;
 points.forEach((p,i)=>{const d=Math.hypot(p.x-pos.x,p.y-pos.y);if(d<dist){best=i;dist=d;}});
 return best;
}
function manualTouchesThick(p,roi){const radius=7;const thick=currentThick();return (thick.includes('left')&&Math.abs(p.x-roi[0])<radius)||(thick.includes('right')&&Math.abs(p.x-roi[2])<radius)||(thick.includes('top')&&Math.abs(p.y-roi[1])<radius)||(thick.includes('bottom')&&Math.abs(p.y-roi[3])<radius);}
function clickAt(p){const q=currentQ();if(!q.roi){toast('計数範囲を先に設定してください。',true);modeSet('roi');return;}
 const idx=nearestPoint(p);const mode=state.mode;
 if(mode==='add'){
  if(!inRoi(p,q.roi,18)){toast('ROI内または境界線付近をクリックしてください。',true);return;}
  snapshot();const active=!manualTouchesThick(p,q.roi);
  q.points.push({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,mult:1,included:active,source:'manual',bbox:null,area:0});
  if(!active)toast('太い線上の可能性があるため除外で追加しました。採否ボタンで変更できます。');
 }else{
  if(idx<0){toast('近くに検出点がありません。拡大してもう一度クリックしてください。');return;}
  snapshot();const pt=q.points[idx];
  if(mode==='remove')q.points.splice(idx,1);
  else if(mode==='toggle')pt.included=!pt.included;
  else if(mode==='inc')pt.mult=Math.min(12,Number(pt.mult||1)+1);
  else if(mode==='dec')pt.mult=Math.max(1,Number(pt.mult||1)-1);
 }
 q.confirmed=false;refresh();
}
function onPointerDown(e){const im=activeImage();if(!im)return;if(e.button!==0)return;
 cvs.setPointerCapture(e.pointerId);const at=canvasCoords(e);const p=clampImage(imageCoords(at),im);
 state.drag={type:state.mode,start:p,point:p,screen:at,panX:state.panX,panY:state.panY,moved:false};
 if(state.mode==='pan')cvs.style.cursor='grabbing';
}
function onPointerMove(e){if(!state.drag)return;const d=state.drag,at=canvasCoords(e),im=activeImage();if(!im)return;
 d.moved=d.moved||Math.hypot(at.x-d.screen.x,at.y-d.screen.y)>4;
 if(d.type==='pan'){state.panX=d.panX+at.x-d.screen.x;state.panY=d.panY+at.y-d.screen.y;}
 if(d.type==='roi')d.point=clampImage(imageCoords(at),im);
 render();
}
function onPointerUp(e){const d=state.drag;if(!d)return;state.drag=null;if(d.type==='pan')cvs.style.cursor='grab';
 const im=activeImage();if(!im)return;
 const p=clampImage(imageCoords(canvasCoords(e)),im);
 if(d.type==='roi'){
  const a=d.start;
  const roi=[Math.round(Math.min(a.x,p.x)),Math.round(Math.min(a.y,p.y)),Math.round(Math.max(a.x,p.x)),Math.round(Math.max(a.y,p.y))];
  if(roi[2]-roi[0]<20||roi[3]-roi[1]<20){render();return;}
  if(currentQ().points.length&&!confirm('ROIを変更すると現在の検出点を消去します。変更しますか？')){render();return;}
  snapshot();const q=currentQ();q.roi=roi;q.points=[];q.confirmed=false;
  const aspect=(roi[2]-roi[0])/(roi[3]-roi[1]);
  if(aspect<.85||aspect>1.15)toast('ROIが正方形からやや外れています。1 mmの辺を格子線の中心で指定してください。');
  else toast('ROIを設定しました。自動検出を実行してください。');
 }else if(d.type!=='pan'&&!d.moved)clickAt(p);
 refresh();
}
function buildSession(){const qs={};for(const k of LETTERS){const q=state.quarters[k],im=state.images.find(i=>i.id===q.imageId);
 qs[k]={imageName:im?.name||null,imageSha256:im?.sha256||null,roi:q.roi,points:q.points,confirmed:q.confirmed,imageId:q.imageId,thickSides:q.thickSides||THICK[k]};}
 return {version:1,dilution:state.dilution,quarters:qs,image_manifest:state.images.map(im=>({name:im.name,sha256:im.sha256,width:im.width,height:im.height}))};
}
function downloadBlob(blob,filename){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000);}
function saveSession(){downloadBlob(new Blob([JSON.stringify(buildSession(),null,2)],{type:'application/json'}),'Hemocytometer_session.json');toast('作業状態をJSONに保存しました。再開時は画像を再読み込みしてください。');}
async function exportData(){if(!state.images.length){toast('画像を読み込んでください。',true);return;}
 if(!allReady()&&!confirm('4区画すべてのROIがまだありません。途中結果として保存しますか？'))return;
 if(allReady()&&!LETTERS.every(k=>state.quarters[k].confirmed)&&!confirm('目視確認が済んでいない区画があります。暫定結果として保存しますか？'))return;
 setBusy(true,'ZIPファイルを作成しています...');
 try{const res=await api('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildSession())});downloadBlob(await res.blob(),'Hemocytometer_results.zip');toast('計数結果と注釈画像をZIPで保存しました。');}
 catch(e){toast(`保存できませんでした：${e.message}`,true);}finally{setBusy(false);}
}
async function restoreSession(file){if(!state.images.length){toast('先に元の顕微鏡画像を読み込んでください。',true);return;}
 try{const data=JSON.parse(await file.text());if(!data.quarters)throw Error('区画データが見つかりません');
  let matched=0;for(const k of LETTERS){const q=data.quarters[k];if(!q)continue;const im=state.images.find(i=>i.sha256===q.imageSha256);
   if(!im)continue;
   state.quarters[k]={imageId:im.id,roi:q.roi,points:structuredClone(q.points||[]),confirmed:!!q.confirmed,thickSides:q.thickSides||[...THICK[k]]};state.history[k]=[];matched++;
  }
  if(Number(data.dilution)>0){state.dilution=Number(data.dilution);$('dilution').value=state.dilution;}
  selectTab('A');toast(`${matched}区画の作業状態を復元しました。`);
 }catch(e){toast(`作業データを読み込めません：${e.message}`,true);}
}

function setup(){
 $('file-input').addEventListener('change',e=>uploadFiles(Array.from(e.target.files)));
 $('choose-files').addEventListener('click',e=>{e.stopPropagation();$('file-input').click();});
 $('choose-main').addEventListener('click',()=>$('file-input').click());
 $('dropzone').addEventListener('click',e=>{if(e.target.closest('button'))return;$('file-input').click();});
 $('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter')$('file-input').click();});
 for(const el of [$('dropzone'),$('canvas-wrap')]){
  el.addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('drag');});
  el.addEventListener('dragleave',e=>{$('dropzone').classList.remove('drag');});
  el.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');uploadFiles(Array.from(e.dataTransfer.files));});
 }
 document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>selectTab(el.dataset.tab)));
 document.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>modeSet(el.dataset.mode)));
 $('image-select').addEventListener('change',e=>assignImage(e.target.value));
 $('thick-select').addEventListener('change',e=>{
  const q=currentQ(),sides=e.target.value.split('+');
  if(q.points.length&&!confirm('太線の位置を変更すると計数点を消去します。変更後に再検出してください。よろしいですか？')){e.target.value=currentThick().join('+');return;}
  snapshot();q.thickSides=sides;q.points=[];q.confirmed=false;refresh();
 });
 $('threshold').addEventListener('input',e=>$('threshold-value').textContent=e.target.value);
 $('run-detect').addEventListener('click',runDetect);
 $('confirmed').addEventListener('change',e=>{const q=currentQ();if(!q.roi){e.target.checked=false;return;}snapshot();q.confirmed=e.target.checked;refresh();});
 $('dilution').addEventListener('input',e=>{state.dilution=Number(e.target.value);refresh();});
 $('zoom-in').addEventListener('click',()=>zoom(1.3));$('zoom-out').addEventListener('click',()=>zoom(1/1.3));$('zoom-reset').addEventListener('click',()=>{resetView();render();});
 $('undo').addEventListener('click',undo);
 $('toggle-points').addEventListener('click',()=>{state.showPoints=!state.showPoints;$('toggle-points').textContent=state.showPoints?'◉ マーカー表示':'○ マーカー非表示';render();});
 $('btn-export').addEventListener('click',exportData);$('export-secondary').addEventListener('click',exportData);
 $('save-session').addEventListener('click',saveSession);
 $('btn-session').addEventListener('click',()=>$('session-input').click());
 $('session-input').addEventListener('change',e=>{if(e.target.files[0])restoreSession(e.target.files[0]);e.target.value='';});
 cvs.addEventListener('pointerdown',onPointerDown);cvs.addEventListener('pointermove',onPointerMove);cvs.addEventListener('pointerup',onPointerUp);
 cvs.addEventListener('pointercancel',()=>{state.drag=null;render();});cvs.addEventListener('contextmenu',e=>e.preventDefault());
 cvs.addEventListener('wheel',e=>{if(!activeImage())return;e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
 document.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}
  if(e.key==='Escape'&&state.drag){state.drag=null;render();}
  const key={a:'add',r:'roi',d:'remove',t:'toggle',p:'pan'}[e.key.toLowerCase()];if(key)modeSet(key);
 });
 new ResizeObserver(resize).observe($('canvas-wrap'));
 modeSet('roi');refresh();
}
setup();
