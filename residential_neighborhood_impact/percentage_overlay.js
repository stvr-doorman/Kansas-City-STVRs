'use strict';
// Local canvas labels do not depend on map glyph downloads or symbol placement.
const PercentageOverlay=(()=>{
  let map,canvas,rows=[],overall,frame;
  function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
  function draw(){
    frame=0;if(!map||!canvas)return;
    const rect=map.getCanvas().getBoundingClientRect(),ratio=devicePixelRatio||1;
    if(canvas.width!==Math.round(rect.width*ratio)||canvas.height!==Math.round(rect.height*ratio)){
      canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
      canvas.style.width=rect.width+'px';canvas.style.height=rect.height+'px';
    }
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,rect.width,rect.height);
    ctx.textAlign='center';ctx.textBaseline='middle';
    const near=map.getZoom()>=9.5;
    function circle(point,radius,text){
      ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fillStyle='#1e40af';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
      ctx.font='bold '+(radius>30?20:16)+'px Arial, sans-serif';ctx.fillStyle='#fff';ctx.fillText(text,point.x,point.y);
    }
    const projected=rows.map(row=>({row,point:map.project(row.properties.anchor)})).filter(({point})=>point.x>=-100&&point.x<=rect.width+100&&point.y>=-100&&point.y<=rect.height+100);
    if(near)for(const {row,point} of [...projected].sort((a,b)=>b.row.properties.percent-a.row.properties.percent)){
      const percent=row.properties.percent;circle(point,21.5+Math.min(percent,5)*1.5,Number(percent.toFixed(percent<1?2:1))+'%');
    }
    // Every eligible neighborhood gets its name, including at aggregate zoom.
    ctx.font='bold 12px Arial, sans-serif';ctx.lineJoin='round';ctx.lineWidth=4;
    for(const {row,point} of projected){
      const name=row.properties.name,words=name.split(' '),lines=[];let line='';
      for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>180){lines.push(line);line=word;}else line=next;}lines.push(line);
      lines.forEach((text,i)=>{const y=point.y+(near?39:12)+i*14;ctx.strokeStyle='#fff';ctx.strokeText(text,point.x,y);ctx.fillStyle='#172b3b';ctx.fillText(text,point.x,y);});
    }
    if(!near&&overall?.features?.length){const f=overall.features[0];circle(map.project(f.geometry.coordinates),36.5,f.properties.label);}
    canvas.dataset.neighborhoods=String(projected.length);canvas.dataset.mode=near?'neighborhood':'overall';
  }
  function init(instance){
    map=instance;canvas=document.createElement('canvas');canvas.id='percentageOverlay';canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{position:'absolute',left:'0',top:'0',pointerEvents:'none',zIndex:'2'});map.getCanvasContainer().append(canvas);
    for(const event of ['move','resize','styledata'])map.on(event,schedule);
    map.once('remove',()=>{cancelAnimationFrame(frame);canvas.remove();});schedule();
  }
  function update(features,aggregate){rows=features;overall=aggregate;schedule();}
  return {init,update};
})();
