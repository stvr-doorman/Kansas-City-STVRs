'use strict';
// Read-only city parcel lookups supplement the limited saved permit-parcel coverage.
const ParcelCandidates=(()=>{
  const cache=new Map();
  function center(geometry){
    const ring=geometry.type==='MultiPolygon'?geometry.coordinates[0][0]:geometry.coordinates[0];
    let area=0,x=0,y=0;
    for(let i=0;i<ring.length-1;i++){
      const a=ring[i],b=ring[i+1],cross=a[0]*b[1]-b[0]*a[1];
      area+=cross;x+=(a[0]+b[0])*cross;y+=(a[1]+b[1])*cross;
    }
    return Math.abs(area)>1e-14?[x/(3*area),y/(3*area)]:ring[0];
  }
  async function load(listing, nameTokens=null){
    if(!listing.point)return {features:[]};
    const key=listing.point.join(',')+(nameTokens?':'+nameTokens.join('|'):'');
    if(!cache.has(key))cache.set(key,(async()=>{
      const endpoint='https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/6/query';
      const where=nameTokens?.length?nameTokens.map(name=>`UPPER(OWN_NAME) LIKE '%${name.replace(/'/g,"''")}%'`).join(' OR '):'1=1';
      const params=new URLSearchParams({where,geometry:JSON.stringify({x:listing.point[0],y:listing.point[1]}),geometryType:'esriGeometryPoint',inSR:'4326',distance:'550',units:'esriSRUnit_Meter',spatialRel:'esriSpatialRelIntersects',outFields:'KIVAPIN,ADDRESS,OWN_NAME',outSR:'4326',returnGeometry:'true',f:'geojson'});
      const response=await fetch(`${endpoint}?${params}`,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`City parcel lookup: ${response.status}`);
      const data=await response.json();
      if(data.error||data.exceededTransferLimit)throw Error('City parcel lookup incomplete');
      return {type:'FeatureCollection',features:(data.features||[]).filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type)).map(f=>({type:'Feature',geometry:f.geometry,properties:{parcel:String(f.properties.KIVAPIN),address:f.properties.ADDRESS||'',owner:f.properties.OWN_NAME||'',point:center(f.geometry),source_url:endpoint}}))};
    })().catch(error=>{cache.delete(key);throw error;}));
    return cache.get(key);
  }
  function loadNames(listing,nicknames={}){
    const tokens=String(listing.host_name||'').toLowerCase().match(/[a-z]+/g)||[];
    const names=[...new Set(tokens.flatMap(name=>[name,...(nicknames[name]||[])]))].filter(name=>name.length>=2);
    return names.length?load(listing,names):Promise.resolve({features:[]});
  }
  return {load,loadNames};
})();
