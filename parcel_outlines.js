'use strict';
const ParcelOutlines=(()=>{
  let map,manifest,pending,sequence=0,overviewPromise,overviewLoaded=false;
  const cache=new Map(),empty=()=>({type:'FeatureCollection',features:[]});
  const status=text=>{const el=document.getElementById('parcelOutlineStatus');if(el)el.textContent=text;};
  async function overview(){if(!overviewPromise)overviewPromise=(async()=>{const r=await fetch('data/gis_parcels/outlines/overview.json.gz');if(!r.ok)throw Error('Overview HTTP '+r.status);const bytes=new Uint8Array(await r.arrayBuffer());const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);return JSON.parse(text);})();return overviewPromise;}
  const tile=(lon,lat)=>[Math.floor((lon+180)/360*16384),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*16384)];
  async function refresh(){
    const id=++sequence;pending?.abort();pending=new AbortController();const signal=pending.signal;
    const enabled=document.getElementById('parcelOutlines').checked;
    map.setLayoutProperty('all-parcel-outlines','visibility',enabled?'visible':'none');map.setLayoutProperty('all-parcel-overview','visibility',enabled?'visible':'none');
    map.setLayoutProperty('all-parcel-numbers','visibility',enabled&&document.getElementById('parcelAddressNumbers').checked?'visible':'none');
    if(!enabled){map.getSource('all-parcel-outlines').setData(empty());map.getSource('all-parcel-numbers').setData(empty());status('Parcel outlines off.');return;}
    if(enabled&&!overviewLoaded)overview().then(value=>{if(!overviewLoaded&&map?.getSource('all-parcel-overview')){map.getSource('all-parcel-overview').setData(value);overviewLoaded=true;}}).catch(()=>status('Saved parcel overview unavailable; zoom in for detailed borders.'));
    if(map.getZoom()<14){map.getSource('all-parcel-outlines').setData(empty());map.getSource('all-parcel-numbers').setData(empty());status('Parcel borders enabled; hidden at citywide zoom and gradually revealed as you zoom into neighborhoods.');return;}
    try{
      if(!manifest){const r=await fetch('data/gis_parcels/outlines/manifest.json',{signal});if(!r.ok)throw Error(`HTTP ${r.status}`);manifest=await r.json();}
      const bounds=map.getBounds(),[x0,y0]=tile(bounds.getWest(),bounds.getNorth()),[x1,y1]=tile(bounds.getEast(),bounds.getSouth());
      if((x1-x0+1)*(y1-y0+1)>24){map.getSource('all-parcel-outlines').setData(empty());map.getSource('all-parcel-numbers').setData(empty());status('Zoom in further to keep parcel outlines responsive.');return;}
      const keys=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=`${x}-${y}`;if(manifest.tiles[key])keys.push(key);}
      status('Loading visible plot outlines…');
      const results=[];
      // Small batches limit downloads and parsing to four tiles at once.
      for(let start=0;start<keys.length;start+=4){
        results.push(...await Promise.all(keys.slice(start,start+4).map(async key=>{
          if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
          const r=await fetch(`data/gis_parcels/outlines/${key}.json.gz`,{signal});if(!r.ok)throw Error(`HTTP ${r.status}`);
          const bytes=new Uint8Array(await r.arrayBuffer());
          const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
          const value=JSON.parse(text);if(signal.aborted)throw new DOMException('Aborted','AbortError');cache.set(key,value);while(cache.size>32)cache.delete(cache.keys().next().value);return value;
        })));
      }
      if(id!==sequence)return;
      const features=new Map();for(const result of results)for(const feature of result.features)features.set(feature.properties.objectid,feature);
      map.getSource('all-parcel-outlines').setData({type:'FeatureCollection',features:[...features.values()]});
      map.getSource('all-parcel-numbers').setData({type:'FeatureCollection',features:[...features.values()].filter(f=>f.properties.address_number&&f.properties.address_point).map(f=>({type:'Feature',geometry:{type:'Point',coordinates:f.properties.address_point},properties:{address_number:f.properties.address_number}}))});
      status(`${features.size.toLocaleString()} plots loaded in viewport tiles. Original GIS boundaries; pan to load nearby plots.`);
    }catch(error){if(error.name!=='AbortError'&&id===sequence){map.getSource('all-parcel-outlines').setData(empty());map.getSource('all-parcel-numbers').setData(empty());status('Plot outlines could not load. Pan or toggle to retry.');}}
  }
  function init(instance,options={}){
    map=instance;const before=options.before||'gis-selected-fill';const hatch=new Uint8Array(16*16*4);for(let y=0;y<16;y++)for(let x=0;x<16;x++)if((x+y)%8===0||(x-y+16)%8===0){const i=(y*16+x)*4;hatch[i]=51;hatch[i+1]=65;hatch[i+2]=85;hatch[i+3]=210;}map.addImage('nonresidential-crosshatch',{width:16,height:16,data:hatch});map.addSource('all-parcel-overview',{type:'geojson',data:empty(),tolerance:.1});map.addLayer({id:'all-parcel-overview',type:'line',source:'all-parcel-overview',maxzoom:14,paint:{'line-color':'#111111','line-opacity':['interpolate',['linear'],['zoom'],10,0,12,.08,13,.25,14,.65],'line-width':['interpolate',['linear'],['zoom'],10,.15,12,.25,14,.75]}},before);map.addSource('all-parcel-outlines',{type:'geojson',data:empty()});
    map.addLayer({id:'all-parcel-outlines',type:'line',source:'all-parcel-outlines',layout:{visibility:'none'},paint:{'line-color':'#111111','line-opacity':['interpolate',['linear'],['zoom'],14,.65,16,.9],'line-width':['interpolate',['linear'],['zoom'],14,.75,16,1.1,19,1.5]}},before);
    map.addSource('all-parcel-numbers',{type:'geojson',data:empty()});
    map.addLayer({id:'all-parcel-numbers',type:'symbol',source:'all-parcel-numbers',minzoom:17,layout:{visibility:'none','text-field':['get','address_number'],'text-size':11,'text-font':['Noto Sans Regular'],'text-padding':2},paint:{'text-color':'#172b3b','text-halo-color':'#ffffff','text-halo-width':1.5}});
    for(const [id,source,maxzoom] of [['nonresidential-overview-hatch','all-parcel-overview',14],['nonresidential-detail-hatch','all-parcel-outlines',24]])map.addLayer({id,type:'fill',source,minzoom:11,maxzoom,filter:['==',['get','nonresidential'],true],paint:{'fill-pattern':'nonresidential-crosshatch','fill-opacity':['interpolate',['linear'],['zoom'],11,0,12,.2,14,.45,16,.6]}},before);
    document.getElementById('parcelAddressNumbers').addEventListener('change',refresh);
    document.getElementById('parcelOutlines').addEventListener('change',refresh);map.on('moveend',refresh);refresh();
  }
  return {init,refresh};
})();
