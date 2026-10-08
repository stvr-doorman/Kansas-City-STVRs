'use strict';
const NeighborhoodStyle=(()=>{
  function update(map){
    if(!map?.getLayer('listing-markers'))return;
    map.setPaintProperty('listing-markers','circle-radius',['interpolate',['linear'],['zoom'],8,1.8,12,2.6,17,3.8]);
    map.setPaintProperty('listing-markers','circle-stroke-width',0.35);
    for(const id of ['renewed-listing-markers','listing-labels','warning-markers'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility','none');
  }
  function init(map){
    update(map);
    map.setPaintProperty('parcel-fill','fill-color','#14532d');
    map.setPaintProperty('parcel-fill','fill-opacity',0.7);
    map.setPaintProperty('parcel-line','line-color','#052e16');
    map.setPaintProperty('parcel-line','line-width',1.4);
    map.addLayer({id:'licensed-parcel-pulse',type:'line',source:'parcels',paint:{'line-color':'#166534','line-width':1,'line-opacity':0.8,'line-blur':0.4}});
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    let frame,last=0;
    function animate(time){
      if(time-last>70){
        last=time;const phase=(time%2400)/2400,active=!motion.matches&&!document.hidden;
        map.setPaintProperty('parcel-fill','fill-opacity',active?0.67+0.12*Math.sin(phase*Math.PI*2):0.75);
        map.setPaintProperty('licensed-parcel-pulse','line-width',active?1+phase*7:1.5);
        map.setPaintProperty('licensed-parcel-pulse','line-opacity',active?(1-phase)*0.8:0);
      }
      frame=requestAnimationFrame(animate);
    }
    frame=requestAnimationFrame(animate);map.once('remove',()=>cancelAnimationFrame(frame));
  }
  return {init,update};
})();
