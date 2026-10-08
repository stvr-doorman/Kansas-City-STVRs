'use strict';
// This viewer uses saved local nearby-parcel tiles exclusively.
const ParcelCandidates=(()=>{
  async function load(listing,nameTokens=null){
    const rows=await Reporting.loadCandidates(listing);
    return {type:'FeatureCollection',features:rows.filter(row=>row.geometry&&(!nameTokens?.length||nameTokens.some(name=>String(row.owner||'').toLowerCase().includes(name.toLowerCase())))).map(row=>({type:'Feature',geometry:row.geometry,properties:{...row,source_url:'Saved local nearby-parcel snapshot'}}))};
  }
  function loadNames(listing,nicknames={}){
    const tokens=String(listing.host_name||'').toLowerCase().match(/[a-z]+/g)||[];
    const names=[...new Set(tokens.flatMap(name=>[name,...(nicknames[name]||[])]))].filter(name=>name.length>=2);
    return names.length?load(listing,names):Promise.resolve({type:'FeatureCollection',features:[]});
  }
  return {load,loadNames};
})();
