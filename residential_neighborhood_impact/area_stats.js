'use strict';
// Local official polygons; rental totals always follow the map's listing filters.
const AreaStats = (() => {
  let snapshot,lastCachedSignature='',zipLoading;
  let data, gisData, mixData, councilMembers, mapInstance, areaPopup, housingKey='', housingTotals=new Map(),gisTotals=new Map();
  const keys=['neighborhood','zip','council','plan','tract','county'];
  const rowsByLayer=new Map();
  let plotTotals=new Map(),plotUnassigned=new Map(),missingPlotCount=0,overallLicensedPlots=0;
  const control=(name,key)=>document.getElementById(`${name}-${key}`);
  const share=p=>p.percent===null?'N/A':`${p.percent.toFixed(2)}% · listing/plot`;
  const licensedShare=p=>p.licensed_percent===null?'N/A':`${p.licensed_percent.toFixed(3)}%`;
  const hotelShare=p=>p.hotel_percent===null?'N/A':`${p.hotel_percent.toFixed(3)}%`;
  const el=id=>document.getElementById(id);
  const sourceDate=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  const palette=['#2563eb','#7c3aed','#0891b2','#db2777','#059669','#d97706','#4f46e5','#c2410c'];
  const fc=features=>({type:'FeatureCollection',features});
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function color(id){let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))>>>0;return palette[hash%palette.length];}
  function updateHousing(){
    const scoped=el('scopeOnly').checked,buffer=Number(el('edgeBuffer').value),signature=`${scoped}:${buffer}`;
    if(signature===housingKey)return;
    housingKey=signature;housingTotals=new Map();gisTotals=new Map();
    if(!scoped||!gisData)return;
    const totals=gisData.totals[String(buffer)];
    if(!totals)return;
    for(const areas of Object.values(totals))for(const [id,counts] of Object.entries(areas)){
      housingTotals.set(id,counts.residential);gisTotals.set(id,counts);
    }
  }
  function updatePlots(){
    plotTotals=new Map();plotUnassigned=new Map(keys.map(key=>[key,0]));
    const current=new Set(permits.filter(p=>p.status==='current').flatMap(p=>[p.parcel,...(p.parcels||[])]).map(normalizeParcel).filter(Boolean));
    const loaded=new Map((permitParcels?.features||[]).map(f=>[normalizeParcel(f.properties.parcel),f.properties.point]));
    const records=new Map((gisData?.permit_parcel_records||data.plots?.records||[]).map(r=>[r.parcel,r]));
    missingPlotCount=0;overallLicensedPlots=0;
    for(const parcel of current){
      const plot=records.get(parcel),sourcePoint=loaded.get(parcel);
      if(!plot||(!gisData?.permit_parcel_records&&(!sourcePoint||!plot.source_point||sourcePoint[0]!==plot.source_point[0]||sourcePoint[1]!==plot.source_point[1]))){missingPlotCount++;continue;}
      if(el('scopeOnly').checked&&plot.boundary_distance_m < -Number(el('edgeBuffer').value))continue;
      overallLicensedPlots++;
      for(const key of keys){
        const id=plot.areas[key];
        if(id)plotTotals.set(id,(plotTotals.get(id)||0)+1);
        else plotUnassigned.set(key,plotUnassigned.get(key)+1);
      }
    }
  }
  function stats(subjects, layer, excludeHotels){
    const totals=new Map(layer.features.map(f=>[f.properties.area_id,{total:0,hotels:0,count:0,homes:0}]));
    const seen=new Set();let unassigned=0,eligible=0;
    for(const listing of subjects){
      const id=String(listing.listing_id);if(seen.has(id)||!listing.point)continue;seen.add(id);
      const included=!excludeHotels||!listing.likely_hotel;if(included)eligible++;
      // A refreshed/moved listing must be rebuilt before using its saved assignment.
      const original=data?.points?.[id];
      const valid=original&&original[0]===listing.point[0]&&original[1]===listing.point[1];
      const total=totals.get(valid?layer.assignments[id]:null);
      if(!total){if(included)unassigned++;continue;}
      total.total++;if(listing.likely_hotel)total.hotels++;if(included)total.count++;
      if(!listing.likely_hotel&&/^Entire\b/i.test(listing.rental_type||''))total.homes++;
    }
    return {totals,unassigned,eligible};
  }
  function showArea(row){
    const bounds=new maplibregl.LngLatBounds();
    function visit(coords){if(typeof coords[0]==='number')bounds.extend(coords);else coords.forEach(visit);}
    visit(row.geometry.coordinates);
    const padding=window.innerWidth>700?{
      left:Math.ceil(document.getElementById('filters').getBoundingClientRect().right)+15,
      right:24,
      top:85,bottom:Math.ceil(document.getElementById('statusbar').getBoundingClientRect().height)+20
    }:55;
    mapInstance.fitBounds(bounds,{padding,maxZoom:15});
    areaPopup?.remove();
    const p=row.properties;
    areaPopup=new maplibregl.Popup({maxWidth:'320px'}).setLngLat(p.anchor).setHTML(`<b>${escape(p.name)}</b> · ${escape(p.boundary_title)}${p.unreliable?`<p><b>Mixed / nonresidential / unclassified neighborhood</b><br>${escape(p.unreliable_reason)}</p>`:""}${p.members?`<p>${escape(p.members)}</p>`:""}<p><b>${p.count.toLocaleString()} Airbnb listings</b><br><b>${p.licensed_plots.toLocaleString()} licensed plots</b> · unique parcels with a current permit<br>${p.total.toLocaleString()} filtered listings, including ${p.hotels.toLocaleString()} likely hotels</p><p>${p.total_plots===null?'GIS area counts unavailable outside the analysis scope.':`${p.total_plots.toLocaleString()} GIS plots · ${p.housing.toLocaleString()} residential plots<br>${p.single_family_plots.toLocaleString()} single-family / townhouse plots · ${p.unknown_landuse_plots.toLocaleString()} unknown land-use plots`}</p><p><b>Airbnb / all GIS plots: ${share(p)}</b><br>${p.housing===null?'Enable the analysis-area limit to calculate a matching denominator.':`${p.homes.toLocaleString()} filtered entire-place listings ÷ ${p.total_plots.toLocaleString()} total GIS plots × 100.`}</p><p><b>Licensed plots / all GIS plots: ${licensedShare(p)}</b><br>${p.housing===null?'Matching denominator unavailable.':`${p.licensed_plots.toLocaleString()} unique plots with a current permit ÷ ${p.total_plots.toLocaleString()} total GIS plots × 100.`}</p><p><b>Likely hotel listings / all GIS plots: ${hotelShare(p)}</b><br>${p.housing===null?'Matching denominator unavailable.':`${p.hotels.toLocaleString()} likely hotel listings ÷ ${p.total_plots.toLocaleString()} total GIS plots × 100.`} This comparison ratio does not measure homes used as hotels.</p><p class="small">Licensed plots follow the analysis area independently of Airbnb filters. All GIS plots are counted once by original city parcel ID, including nonresidential, unclassified and vacant plots. Residential counts are shown separately for context. Multifamily plots can contain many homes; this ratio is not a verified percentage of dwelling units used as Airbnbs.</p>`).addTo(mapInstance);
  }
  function renderList(key){
    const query=control('areaSearch',key).value.trim().toLowerCase(),sort=control('areaSort',key).value;
    const sorted=(rowsByLayer.get(key)||[]).filter(r=>(r.properties.name+' '+(r.properties.members||'')).toLowerCase().includes(query)).sort((a,b)=>{
      if(sort==='count'&&a.properties.count!==b.properties.count)return b.properties.count-a.properties.count;
      if(sort==='plots'&&a.properties.licensed_plots!==b.properties.licensed_plots)return b.properties.licensed_plots-a.properties.licensed_plots;
      if(sort==='licensed_percent'&&a.properties.licensed_percent!==b.properties.licensed_percent)return (b.properties.licensed_percent??-1)-(a.properties.licensed_percent??-1);
      if(sort==='percent'&&a.properties.percent!==b.properties.percent)return (b.properties.percent??-1)-(a.properties.percent??-1);
      return a.properties.name.localeCompare(b.properties.name,undefined,{numeric:true});
    });
    const container=control('areaCounts',key);container.replaceChildren();
    for(const row of sorted){
      const button=document.createElement('button');button.type='button';button.className='area-count-row';
      const name=document.createElement('span');name.textContent=row.properties.name;
      if(row.properties.members){const members=document.createElement('small');members.textContent=row.properties.members;members.style.display='block';name.append(members);}
      const values=document.createElement('span');values.className='area-count-values';
      const count=document.createElement('b');count.textContent=`${row.properties.count.toLocaleString()} Airbnbs`;
      const plots=document.createElement('small');plots.textContent=`${row.properties.licensed_plots.toLocaleString()} licensed plots`;
      const residential=document.createElement('small');residential.textContent=row.properties.housing===null?'GIS count unavailable':`${row.properties.housing.toLocaleString()} residential plots`;
      const percent=document.createElement('small');percent.textContent=share(row.properties);percent.title='Filtered entire-place listings ÷ all unique GIS plots; includes nonresidential and unclassified plots, not dwelling units';
      residential.className='area-row-extra';values.append(percent,count,plots,residential);
      const mix=document.createElement('small');mix.textContent=row.properties.mix?`${row.properties.mix.single_family.toLocaleString()} single-family · ${row.properties.mix.duplex.toLocaleString()} duplex · ${row.properties.primary_all.toFixed(1)}% of all plots`:'Residential mix unavailable';mix.className='area-row-extra';values.append(mix);
      if(row.properties.unknown_landuse_plots>0){const unknown=document.createElement('small');unknown.className='area-row-extra';unknown.textContent=`${row.properties.unknown_landuse_plots.toLocaleString()} unclassified plots`;values.append(unknown);}
      const licensedPercent=document.createElement('small');licensedPercent.textContent=`${licensedShare(row.properties)} licensed plots / all GIS plots`;values.append(licensedPercent);
      percent.className='area-row-percent';
      const hotelPercent=document.createElement('small');hotelPercent.className='area-row-extra';hotelPercent.textContent=`${row.properties.hotels.toLocaleString()} likely hotel listings · ${hotelShare(row.properties)} hotel listings / all GIS plots`;values.append(hotelPercent);
      button.append(name,values);button.onclick=()=>showArea(row);container.append(button);
    }
    if(!sorted.length)container.textContent='No matching areas.';
  }
  function update(){
    if(snapshot&&mapInstance?.getSource('density-overall')){updateCached();return;}
    if(!data||!mapInstance?.getSource('area-polygons-neighborhood'))return;
    updateHousing();updatePlots();let active=0;
    for(const id of ['densityAll','densityResidential','densityUnknown'])el(id+'Value').textContent=el(id).value+'%';
    const focus=el('densityFocusEnabled').checked&&el('scopeOnly').checked&&!!mixData;
    const entire=new Set(visible.filter(l=>l.point&&!l.likely_hotel&&/^Entire\b/i.test(l.rental_type||'')).map(l=>String(l.listing_id))).size;
    const hotels=new Set(visible.filter(l=>l.point&&l.likely_hotel).map(l=>String(l.listing_id))).size;
    const overall=el('scopeOnly').checked?gisData?.scope_totals?.[String(Number(el('edgeBuffer').value))]:null;
    el('areaOverall').textContent=overall?.plots>0?`Overall Airbnb / all GIS plots: ${(100*entire/overall.plots).toFixed(3)}%. ${entire.toLocaleString()} filtered entire-place listings (excluding likely hotels) ÷ ${overall.plots.toLocaleString()} total GIS plots × 100. Licensed plots / all GIS plots: ${(100*overallLicensedPlots/overall.plots).toFixed(3)}%. ${overallLicensedPlots.toLocaleString()} unique plots with a current permit ÷ ${overall.plots.toLocaleString()} total GIS plots × 100. Likely hotel listings / all GIS plots: ${(100*hotels/overall.plots).toFixed(3)}%. ${hotels.toLocaleString()} likely hotel listings ÷ ${overall.plots.toLocaleString()} total GIS plots × 100 (comparison ratio, not the percentage of homes used as hotels). Includes all plots in the analysis scope, even areas with no rentals; parcels are not dwelling units.`:'Overall percentage unavailable: enable the analysis-area limit and load GIS scope totals.';
    areaPopup?.remove();areaPopup=null;
    for(const key of keys){
      const layer=data.layers[key],enabled=control('areaEnable',key).checked,mode=control('areaColor',key).value;
      control('areaAlphaValue',key).textContent=`${control('areaAlpha',key).value}%`;
      control('areaControls',key).hidden=!enabled;
      for(const suffix of ['fill','line','labels','bubbles','bubble-values'])mapInstance.setLayoutProperty(`area-${suffix}-${key}`,'visibility',enabled&&(suffix==='fill'||suffix==='line'||suffix==='labels'||(suffix==='bubbles'||suffix==='bubble-values')&&control('areaLabels',key).checked)?'visible':'none');
      if(!enabled){rowsByLayer.set(key,[]);control('areaCounts',key).replaceChildren();continue;}
      active++;
      const result=stats(visible,layer,el('areaExcludeHotels').checked);
      const rows=layer.features.map(f=>{
        const total=result.totals.get(f.properties.area_id);
        const housing=el('scopeOnly').checked&&gisData?(housingTotals.get(f.properties.area_id)||0):null;
        const gis=gisTotals.get(f.properties.area_id);
        const mix=el('scopeOnly').checked?mixData?.totals?.[String(Number(el('edgeBuffer').value))]?.[f.properties.area_id]:null;
        const primary=mix?mix.single_family+mix.duplex:0;
        const primary_all=mix&&gis?.plots?100*primary/gis.plots:null,primary_residential=mix&&housing?100*primary/housing:null,unknown_share=mix&&gis?.plots?100*mix.unknown/gis.plots:null;
        const residential_share=gis?.plots>0?100*(housing||0)/gis.plots:null;
        const unreliable=gis?.plots>0&&(residential_share<70||unknown_share>15);
        const unreliable_reason=unreliable?`${housing} classified residential of ${gis.plots} total plots; ${gis.unknown} unclassified. Less than 70% classified residential or more than 15% unclassified. The all-plot ratio is not a percentage of homes.`:'';
        const percent=gis?.plots>0?100*total.homes/gis.plots:null;
        return {...f,properties:{...f.properties,...total,members:key==='council'?(()=>{const district=String(f.properties.name).match(/\d+/)?.[0],members=councilMembers?.districts[district];return members?`${members.in_district} · ${members.at_large} (at large)`:'';})():'',mix,primary_all,primary_residential,unknown_share,unreliable,unreliable_reason,licensed_plots:plotTotals.get(f.properties.area_id)||0,housing,total_plots:gis?.plots??null,single_family_plots:gis?.single_family??null,unknown_landuse_plots:gis?.unknown??null,percent,licensed_percent:gis?.plots>0?100*(plotTotals.get(f.properties.area_id)||0)/gis.plots:null,hotel_percent:gis?.plots>0?100*total.hotels/gis.plots:null,boundary_type:key,boundary_title:layer.title,color:color(f.properties.area_id)}};
      });
      const nonempty=rows.length;
      const ceiling=Number(el('maximumNeighborhoodPercent').value);
      const qualified=rows.filter(r=>r.properties.percent!==null&&r.properties.percent<=ceiling);
      rows.splice(0,rows.length,...qualified);
      rowsByLayer.set(key,rows);
      const maximum=Math.max(1,...rows.map(r=>r.properties.count)),maxPercent=Math.max(.01,...rows.map(r=>r.properties.percent||0));
      mapInstance.getSource(`area-polygons-${key}`).setData(fc(rows));
      mapInstance.getSource(`area-anchors-${key}`).setData(fc(rows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:r.properties.anchor},properties:{...r.properties,bubble:r.properties.percent===null?'?':`${Number(r.properties.percent.toFixed(r.properties.percent<1?2:1))}%`,priority:-(r.properties.percent??-1),label:`${r.properties.name}\n${r.properties.count.toLocaleString()} Airbnbs · ${r.properties.licensed_plots.toLocaleString()} licensed plots\n${share(r.properties)}`}}))));
      mapInstance.setPaintProperty(`area-fill-${key}`,'fill-opacity',mode==='none'?0:Number(control('areaAlpha',key).value)/100);
      const maxPlots=Math.max(1,...rows.map(r=>r.properties.licensed_plots));
      const maxLicensedPercent=Math.max(.01,...rows.map(r=>r.properties.licensed_percent||0));
      const measure=mode==='licensed_percent'?'licensed_percent':mode==='percent'?'percent':mode==='plots'?'licensed_plots':'count',max=mode==='licensed_percent'?maxLicensedPercent:mode==='percent'?5:mode==='plots'?maxPlots:maximum;
      mapInstance.setPaintProperty(`area-fill-${key}`,'fill-color',['count','percent','plots','licensed_percent'].includes(mode)?['case',['==',['get',measure],null],'#cbd5e1',['interpolate',['linear'],['coalesce',['get',measure],0],0,'#bfdbfe',max/2,'#3b82f6',max,'#1e3a8a']]:['get','color']);
      control('areaColorLegend',key).textContent=mode==='licensed_percent'?`Light → dark blue: 0 → ${maxLicensedPercent.toFixed(3)}% licensed plots / all GIS plots.`:mode==='count'?`Light → dark blue: 0 → ${maximum.toLocaleString()} Airbnb listings.`:mode==='plots'?`Light → dark blue: 0 → ${maxPlots.toLocaleString()} licensed plots.`:mode==='percent'?`Light → dark blue: 0 → 5%+ listings / all GIS plots; gray = unavailable.`:mode==='identity'?'Colors identify areas; they do not indicate licensing status.':'Boundary outlines only.';
      const assignedPlots=rows.reduce((sum,r)=>sum+r.properties.licensed_plots,0);
      control('areaSummary',key).textContent=`${(result.eligible-result.unassigned).toLocaleString()} Airbnbs · ${assignedPlots.toLocaleString()} licensed plots · ${rows.length} areas at or below ${Number(el('maximumNeighborhoodPercent').value)}% (${nonempty-rows.length} above the limit or without a denominator). ${result.unassigned.toLocaleString()} Airbnbs and ${plotUnassigned.get(key)} located licensed plots unassigned / outside these boundaries. ${!el('scopeOnly').checked?'Estimated percentages unavailable: enable “Limit displayed listings to analysis area.”':''}`;
      control('areaSource',key).innerHTML=`<a href="${escape(layer.source)}" target="_blank" rel="noopener">Boundary source</a> · retrieved ${escape(sourceDate(data.downloaded_at))} ET. ${escape(layer.note)} Display clipped to city plus 550 m.`;
      renderList(key);
    }
    for(const id of ['listing-markers','renewed-listing-markers','permit-markers','warning-markers','connection-question-labels','privacy-fill','privacy-line','parcel-fill','parcel-line','coverage-fill','coverage-line','permit-links','connections','name-matches-fill','name-matches-line','candidate-connections'])if(mapInstance.getLayer(id))mapInstance.setLayerZoomRange(id,active?9:0,24);
    mapInstance.setLayoutProperty('density-overall-bubble','visibility',active?'visible':'none');
    mapInstance.setLayoutProperty('density-overall-circle','visibility',active?'visible':'none');
    if(mapInstance.getLayer('zip-context-lines')){const enabled=control('areaEnable','zip').checked;for(const id of ['zip-context-lines','zip-context-labels'])mapInstance.setLayoutProperty(id,'visibility',enabled?'visible':'none');for(const suffix of ['fill','line','labels'])mapInstance.setLayoutProperty(`area-${suffix}-zip`,'visibility','none');}
    mapInstance.getSource('density-overall').setData(fc(overall?.plots>0?[{type:'Feature',geometry:{type:'Point',coordinates:[-94.58,39.1]},properties:{label:`${(100*entire/overall.plots).toFixed(1)}%`}}]:[]));
    el('areaSummary').textContent=active?`${active} boundary type${active===1?'':'s'} active. Percentages use all GIS plots. Areas at or below the adjustable percentage limit are shown, including 0%; land-use mix does not exclude areas. Licensed plots count unique parcels with a current permit, independently of Airbnb filters. ${missingPlotCount} current-permit parcels lack usable saved geometry and are excluded from area totals.`:'Turn on a boundary type to compare areas.';
  }
  function download(key){
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const lines=[['Area','Airbnb listings','Licensed plots (unique parcels with current permit)','All filtered listings','Likely hotels within filtered listings','Filtered entire-place listings excluding hotels','Residential GIS plots','All GIS plots','Single-family / townhouse GIS plots','Unknown land-use GIS plots','Entire-place listings per all GIS plots (%)','Likely hotel listings per all GIS plots (%)','Licensed plots per all GIS plots (%)','Boundary type','GIS count method','Single-family plots','Duplex plots','Single-family and duplex share of all plots (%)','Single-family and duplex share of residential plots (%)','Council representatives'],...(rowsByLayer.get(key)||[]).map(r=>{const p=r.properties;return [p.name,p.count,p.licensed_plots,p.total,p.hotels,p.homes,p.housing,p.total_plots,p.single_family_plots,p.unknown_landuse_plots,p.percent===null?'':p.percent.toFixed(4),p.hotel_percent===null?'':p.hotel_percent.toFixed(4),p.licensed_percent===null?'':p.licensed_percent.toFixed(4),p.boundary_title,gisData?.method||'Unavailable',p.mix?.single_family,p.mix?.duplex,p.primary_all,p.primary_residential,p.members];})];
    const blob=new Blob(['\uFEFF'+lines.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kansas-city-${key}-listing-counts.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function localJSON(url){
    for(let attempt=0;attempt<3;attempt++)try{const response=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error(`${url}: HTTP ${response.status}`);return await response.json();}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}
  }
  const preload=localJSON('data/percentage_snapshot.json');preload.catch(()=>{});
  function loadZipContext(){
    if(mapInstance.getSource('zip-context')||zipLoading)return;
    zipLoading=localJSON('data/zip_context.geojson').then(full=>{
      mapInstance.addSource('zip-context',{type:'geojson',data:full});
      mapInstance.addSource('zip-context-centers',{type:'geojson',data:fc(full.features.map(f=>({type:'Feature',geometry:{type:'Point',coordinates:f.properties.anchor},properties:f.properties})))});
      mapInstance.addLayer({id:'zip-context-lines',type:'line',source:'zip-context',paint:{'line-color':'#7c3aed','line-width':2,'line-opacity':.8}});
      mapInstance.addLayer({id:'zip-context-labels',type:'symbol',source:'zip-context-centers',minzoom:7,layout:{'text-field':['concat','ZIP ',['get','name']],'text-size':13,'text-font':['Noto Sans Regular']},paint:{'text-color':'#6d28d9','text-halo-color':'#ffffff','text-halo-width':2}});
      lastCachedSignature='';update();
    }).catch(error=>{zipLoading=null;console.error('Local ZIP overlay:',error);control('areaSummary','zip').textContent='Saved ZIP outlines could not load; toggle ZIP codes to retry.';});
  }
  function updateCached(){
    control('areaEnable','neighborhood').checked=true;control('areaLabels','neighborhood').checked=true;
    const signature=JSON.stringify([el('maximumNeighborhoodPercent').value,...keys.flatMap(key=>[control('areaEnable',key).checked,control('areaColor',key).value,control('areaAlpha',key).value])]);
    if(signature===lastCachedSignature)return;lastCachedSignature=signature;
    const ceiling=Number(el('maximumNeighborhoodPercent').value);el('areaOverall').textContent=snapshot.overallText;
    for(const key of keys){
      const enabled=key==='neighborhood'||control('areaEnable',key).checked,mode=control('areaColor',key).value;
      const rows=enabled?snapshot.layers[key].features.filter(r=>r.properties.percent!==null&&r.properties.percent<=ceiling):[];
      rowsByLayer.set(key,rows);control('areaControls',key).hidden=!enabled;
      for(const suffix of ['fill','line','labels','bubbles','bubble-values'])mapInstance.setLayoutProperty(`area-${suffix}-${key}`,'visibility',enabled&&!['labels','bubble-values'].includes(suffix)?'visible':'none');
      mapInstance.getSource(`area-polygons-${key}`).setData(fc(rows));
      mapInstance.getSource(`area-anchors-${key}`).setData(fc(rows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:r.properties.anchor},properties:{...r.properties,bubble:Number(r.properties.percent.toFixed(r.properties.percent<1?2:1))+'%',priority:-r.properties.percent}}))));
      mapInstance.setPaintProperty(`area-fill-${key}`,'fill-opacity',mode==='none'?0:Number(control('areaAlpha',key).value)/100);
      const measure=mode==='licensed_percent'?'licensed_percent':mode==='percent'?'percent':mode==='plots'?'licensed_plots':'count';const maximum=mode==='percent'?5:Math.max(1,...rows.map(r=>r.properties[measure]||0));
      mapInstance.setPaintProperty(`area-fill-${key}`,'fill-color',['count','percent','plots','licensed_percent'].includes(mode)?['interpolate',['linear'],['coalesce',['get',measure],0],0,'#bfdbfe',maximum/2,'#3b82f6',maximum,'#1e3a8a']:['get','color']);
      control('areaAlphaValue',key).textContent=control('areaAlpha',key).value+'%';control('areaColorLegend',key).textContent=mode==='identity'?'Colors identify areas.':'';
      control('areaSummary',key).textContent=`${rows.length} areas at or below ${ceiling}%. Precalculated from the saved local snapshot; zoom does not change the calculation.`;
      control('areaSource',key).textContent=`Saved boundary snapshot: ${sourceDate(snapshot.downloaded_at)}.`;renderList(key);
    }
    const zip=control('areaEnable','zip').checked;
    if(zip)loadZipContext();
    if(mapInstance.getLayer('zip-context-lines'))for(const id of ['zip-context-lines','zip-context-labels'])mapInstance.setLayoutProperty(id,'visibility',zip?'visible':'none');
    for(const suffix of ['fill','line'])mapInstance.setLayoutProperty(`area-${suffix}-zip`,'visibility','none');
    mapInstance.getSource('density-overall').setData(snapshot.overall);
    PercentageOverlay.update(rowsByLayer.get('neighborhood'),snapshot.overall);
    el('areaSummary').textContent='Percentages use all GIS plots from the saved snapshot. The adjustable ceiling hides ratios above the limit. Neighborhood names and dots are always enabled; a citywide dot appears below zoom 9.5.';
  }
  async function init(instance){
    mapInstance=instance;
    try{
      snapshot=await preload;data={layers:snapshot.layers,downloaded_at:snapshot.downloaded_at,points:{}};
      const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const ctx=canvas.getContext('2d');ctx.beginPath();ctx.arc(48,48,43,0,Math.PI*2);ctx.fillStyle='#1e40af';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#ffffff';ctx.stroke();mapInstance.addImage('density-bubble',ctx.getImageData(0,0,96,96),{pixelRatio:2});
      ctx.clearRect(0,0,96,96);ctx.beginPath();ctx.arc(48,48,43,0,Math.PI*2);ctx.fillStyle='#64748b';ctx.fill();ctx.stroke();mapInstance.addImage('density-unreliable-bubble',ctx.getImageData(0,0,96,96),{pixelRatio:2});
      for(const key of keys){
        mapInstance.addSource(`area-polygons-${key}`,{type:'geojson',data:fc([])});
        mapInstance.addSource(`area-anchors-${key}`,{type:'geojson',data:fc([])});
        mapInstance.addLayer({id:`area-fill-${key}`,type:'fill',source:`area-polygons-${key}`,paint:{'fill-color':['get','color'],'fill-opacity':.12}},'balance-fill');
        mapInstance.addLayer({id:`area-line-${key}`,type:'line',source:`area-polygons-${key}`,paint:{'line-color':'#000000','line-width':2.6,'line-opacity':.95}},'parcel-fill');
        mapInstance.addLayer({id:`area-labels-${key}`,type:'symbol',source:`area-anchors-${key}`,minzoom:9.5,layout:{'text-field':['get','name'],'text-offset':[0,2.5],'text-allow-overlap':true,'text-ignore-placement':true,'text-size':12,'text-font':['Noto Sans Regular'],'text-max-width':18,'text-padding':5},paint:{'text-color':'#172b3b','text-halo-color':'#ffffff','text-halo-width':2}});
        // Circles render independently of font downloads and symbol collision placement.
        mapInstance.addLayer({id:`area-bubbles-${key}`,type:'circle',source:`area-anchors-${key}`,minzoom:9.5,layout:{'circle-sort-key':['get','priority']},paint:{'circle-radius':['interpolate',['linear'],['coalesce',['get','percent'],0],0,21.5,5,29],'circle-color':'#1e40af','circle-stroke-color':'#ffffff','circle-stroke-width':2}});
        mapInstance.addLayer({id:`area-bubble-values-${key}`,type:'symbol',source:`area-anchors-${key}`,minzoom:9.5,layout:{'text-field':['get','bubble'],'text-size':16,'text-font':['Noto Sans Regular'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#ffffff'}});
        mapInstance.on('click',`area-bubbles-${key}`,event=>{const row=(rowsByLayer.get(key)||[]).find(r=>r.properties.area_id===event.features?.[0]?.properties.area_id);if(row)showArea(row);});
        mapInstance.on('click',`area-labels-${key}`,event=>{const row=(rowsByLayer.get(key)||[]).find(r=>r.properties.area_id===event.features?.[0]?.properties.area_id);if(row)showArea(row);});
        for(const name of ['areaEnable','areaColor','areaLabels'])control(name,key).addEventListener('change',()=>{
          if(name==='areaEnable'&&control(name,key).checked)control(name,key).closest('details').open=true;
          update();
        });
        control('areaAlpha',key).addEventListener('input',update);
        control('areaSearch',key).addEventListener('input',()=>renderList(key));control('areaSort',key).addEventListener('change',()=>renderList(key));control('downloadAreaCounts',key).onclick=()=>download(key);
      }
      el('areaExcludeHotels').addEventListener('change',update);
      for(const id of ['maximumNeighborhoodPercent'])el(id).addEventListener('input',update);
      el('areaHousingNote').textContent='Saved City GIS plots; precalculated locally. No live parcel API is used.';
      mapInstance.addSource('density-overall',{type:'geojson',data:fc([])});
      mapInstance.addLayer({id:'density-overall-circle',type:'circle',source:'density-overall',maxzoom:9.5,paint:{'circle-radius':36.5,'circle-color':'#1e40af','circle-stroke-color':'#ffffff','circle-stroke-width':2}});
      mapInstance.addLayer({id:'density-overall-bubble',type:'symbol',source:'density-overall',maxzoom:9.5,layout:{'text-field':['get','label'],'text-size':20,'text-font':['Noto Sans Regular'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#ffffff'}});
      mapInstance.on('click','density-overall-circle',()=>mapInstance.easeTo({center:[-94.58,39.1],zoom:10.5}));
      mapInstance.on('click','density-overall-bubble',()=>mapInstance.easeTo({center:[-94.58,39.1],zoom:10.5}));
      update();
    }catch(error){console.error('Area boundaries:',error);el('areaSummary').textContent='Area boundaries could not load. Reload to retry.';}
  }
  return {init,update,get rows(){return [...rowsByLayer.values()].flat();},get rowsByLayer(){return rowsByLayer;},get data(){return data;},get gisData(){return gisData;}};
})();
