'use strict';
const ParcelSearch=(()=>{
  let instance,worker,request=0,timer,metadata,selected,selectionRequest=0;
  const chunks=new Map();
  const el=id=>document.getElementById(id);
  const empty=()=>({type:'FeatureCollection',features:[]});
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function dwellingIndication(code){
    const counts={1111:1,1121:1,1122:2,1123:3,1124:4};
    if(Object.prototype.hasOwnProperty.call(counts,code))return `${counts[code]} dwelling unit${counts[code]===1?'':'s'} indicated by land-use code; inferred, not an assessor-confirmed count`;
    if(Number(code)===1125)return '5 or more dwelling units indicated by land-use code; exact count unknown';
    if(Number(code)===1126)return 'Condominium; dwelling count unknown (parcel may represent a unit or a larger property)';
    if(Number(code)===1112)return 'Mobile-home park; dwelling count unknown';
    return 'Unknown; no dwelling-unit count supplied for this parcel';
  }
  function clear(){selectionRequest++;instance?.getSource('gis-selected-parcel')?.setData(empty());selected=null;el('clearParcelSelection').hidden=true;}
  function getWorker(){
    if(worker)return worker;
    worker=new Worker('parcel_search_worker.js');
    worker.onmessage=event=>{
      const result=event.data;
      if(result.type==='ready'){metadata=result;return;}
      if(result.id!==request)return;
      if(result.type==='error'){el('parcelSearchStatus').textContent=`Parcel search unavailable: ${result.message}. Try again.`;return;}
      if(result.type==='results'){
        el('parcelSearchStatus').textContent=`${result.count.toLocaleString()} matches in ${metadata?.count.toLocaleString()||'the full'} city and border GIS parcels. Showing ${result.matches.length}. Source capture: ${metadata?.date?new Date(metadata.date).toLocaleDateString('en-CA',{timeZone:'America/New_York'})+' ET':'unknown'}.`;
        const container=el('parcelSearchResults');container.replaceChildren();
        for(const match of result.matches){
          const r=match.row,button=document.createElement('button');button.type='button';button.className='gis-parcel-result';
          button.innerHTML=`<b>${escape(r[2]||'Address unavailable')}</b><span>Parcel ${escape(r[0])} · APN ${escape(r[1]||'unavailable')}</span><span>${escape(r[3]||'Owner unavailable')}</span><span>${escape(match.landuse)}</span>`;
          button.onclick=()=>select(match);container.append(button);
        }
        if(!result.matches.length)container.textContent='No matching parcels in the available city and 550 m border GIS inventory. Some neighboring county coverage is unavailable.';
      }
    };
    worker.onerror=()=>{el('parcelSearchStatus').textContent='Parcel search could not load. Reload the map to retry.';};
    return worker;
  }
  function search(){
    const query=el('parcelSearchQuery').value.trim();request++;
    el('parcelSearchResults').replaceChildren();
    if(query.length<2){el('parcelSearchStatus').textContent='Enter at least 2 characters. GIS search is independent of Airbnb filters.';return;}
    el('parcelSearchStatus').textContent=metadata?'Searching city and border parcels…':'Loading the city and border parcel inventory…';
    getWorker().postMessage({query,id:request});
  }
  async function loadChunk(index){
    if(!chunks.has(index))chunks.set(index,(async()=>{
      const response=await fetch(index==='border'?'data/border_parcels/features.json.gz':`data/gis_parcels/raw/${String(index).padStart(4,'0')}.geojson.gz`);
      if(!response.ok)throw Error(`Parcel boundary: HTTP ${response.status}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
      return JSON.parse(text);
    })().catch(error=>{chunks.delete(index);throw error;}));
    return chunks.get(index);
  }
  async function select(match){
    const row=match.row,sequence=++selectionRequest;
    el('parcelSearchStatus').textContent=`Loading original boundary for parcel ${row[0]}…`;
    try{
      const isBorder=row[0].includes(':');
      const data=await loadChunk(isBorder?'border':row[6]);if(sequence!==selectionRequest)return;
      const features=data.features.filter(f=>isBorder?f.properties.border_id===row[0]:Number(f.properties.OBJECTID)===Number(row[7]));
      if(!features.length)throw Error('Original parcel record not found in saved capture');
      selected=row;instance.getSource('gis-selected-parcel').setData({type:'FeatureCollection',features});
      el('clearParcelSelection').hidden=false;
      const bounds=new maplibregl.LngLatBounds();
      function visit(coords){if(typeof coords[0]==='number')bounds.extend(coords);else coords.forEach(visit);}
      features.forEach(f=>visit(f.geometry.coordinates));
      const padding=window.innerWidth>700?{left:Math.ceil(el('filters').getBoundingClientRect().right)+20,right:24,top:90,bottom:Math.ceil(el('statusbar').getBoundingClientRect().height)+20}:55;
      instance.fitBounds(bounds,{padding,maxZoom:18});
      const original=features[0].properties;
      const a=isBorder?{...original,ADDRESS:original.border_address,KIVAPIN:original.border_id,APN:original.border_parcel,OWN_NAME:row[3]}:original;
      const related=isBorder?[]:permits.filter(p=>[p.parcel,...(p.parcels||[])].map(normalizeParcel).includes(normalizeParcel(row[0])));
      const current=related.filter(p=>p.status==='current');
      const fields=[['Address',a.ADDRESS],[isBorder?'County parcel ID':'City parcel ID',a.KIVAPIN],['County / coverage',original.border_county],['County APN',a.APN],['Owner',a.OWN_NAME],['Second owner',a.OWN_NAME2],['Land use',match.landuse],['Homes per plot (land-use indication)',dwellingIndication(a.LANDUSECODE)],['Plat',a.PLATNAME],['Lot',a.LOT],['Block',a.BLOCK],['Legal description',a.LEGAL]];
      popup?.remove();selectedListing=null;resetMatchInteraction();updatePrivacy();
      popup=new maplibregl.Popup({maxWidth:'380px',closeOnClick:false,className:'listing-popup-centered map-card-centered'}).setLngLat(row[5]).setHTML(`<h3>${escape(row[2]||'City parcel')}</h3><p>${current.length?`${current.length} current STR permit record${current.length===1?'':'s'} at this exact parcel ID`:(isBorder?'Outside KCMO; city STR permit lookup does not apply.':'No current STR permit found at this exact parcel ID in the saved inventory.')}</p><dl class="gis-parcel-details">${fields.filter(([name,value])=>value!==null&&value!==undefined&&value!=='').map(([name,value])=>`<dt>${escape(name)}</dt><dd>${escape(value)}</dd>`).join('')}</dl><p class="small muted">${isBorder?'County GIS parcel outside KCMO; excluded from city statistics.':'City GIS snapshot;'} owner and land-use fields may be outdated. A parcel can contain multiple dwelling units. This parcel search does not associate an Airbnb with an address.</p>${related.length?`<details><summary>City STR permit history (${related.length})</summary>${permitCards(related)}</details>`:''}<p class="small"><a href="${isBorder?escape(original.border_source):'https://maps.kcmo.org/apps/parcelviewer/?kiva='+encodeURIComponent(row[0])}" target="_blank" rel="noopener">${isBorder?'Open county GIS source':'Open city Parcel Viewer'}</a></p>`).addTo(instance);
      el('parcelSearchStatus').textContent=`Selected original GIS parcel ${row[0]}${isBorder?' · Outside KCMO; county source':` · ${current.length} current STR permit records.`}`;
    }catch(error){el('parcelSearchStatus').textContent=`Could not display parcel: ${error.message}`;}
  }
  function init(map){
    instance=map;
    instance.addSource('gis-selected-parcel',{type:'geojson',data:empty()});
    instance.addLayer({id:'gis-selected-fill',type:'fill',source:'gis-selected-parcel',paint:{'fill-color':'#2563eb','fill-opacity':.12}});
    instance.addLayer({id:'gis-selected-line',type:'line',source:'gis-selected-parcel',paint:{'line-color':'#1d4ed8','line-width':3}});
    el('parcelSearchQuery').addEventListener('input',()=>{
      request++;el('parcelSearchResults').replaceChildren();
      clearTimeout(timer);timer=setTimeout(search,180);
    });
    el('clearParcelSelection').onclick=()=>{clear();popup?.remove();};
    if(el('parcelSearchQuery').value.trim().length>=2)search();
  }
  return {init,clear,dwellingIndication,get selected(){return selected;}};
})();
