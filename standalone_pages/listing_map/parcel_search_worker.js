'use strict';
let records, labels, searches=[], loading;
const addressAliases=value=>String(value||'').replace(/\bROAD\b/gi,'RD').replace(/\bSTREET\b/gi,'ST').replace(/\bAVENUE\b/gi,'AVE').replace(/\bBOULEVARD\b/gi,'BLVD').replace(/\bDRIVE\b/gi,'DR');
const normalize=value=>addressAliases(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
async function load(){
  if(loading)return loading;
  loading=(async()=>{
    const response=await fetch('data/gis_parcels/search_index.json.gz');
    if(!response.ok)throw Error(`Parcel index: HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
    const data=JSON.parse(text);records=data.records;labels=data.landuse_labels;
    try{
      const response=await fetch('data/border_parcels/search_index.json.gz');
      if(response.ok){const bytes=new Uint8Array(await response.arrayBuffer());const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);records.push(...JSON.parse(text).records);}
    }catch(error){console.warn('Border parcel search unavailable',error);}
    searches=records.map(row=>normalize([row[0],row[1],row[2],row[3],row[4],labels[String(row[4])]||'',row[8],row[9],row[10],row[11],row[12]?.zip||''].join(' ')));
    postMessage({type:'ready',count:records.length,source:data.source,date:data.downloaded_at});
  })();
  return loading;
}
onmessage=async event=>{
  const {query,id}=event.data;
  try{
    await load();
    const tokens=query.trim().split(/\s+/).map(normalize).filter(Boolean),compact=normalize(query);
    let count=0;const top=[];
    for(let i=0;i<records.length;i++)if(tokens.every(token=>searches[i].includes(token))){
      count++;const row=records[i];
      const rank=normalize(row[0])===compact||normalize(row[1])===compact?0:normalize(row[2]).startsWith(compact)?1:2;
      if(top.length<40||rank<top[top.length-1].rank){top.push({row,rank,landuse:row[0].includes(':')?'Outside city · within 550 m border band':labels[String(row[4])]||'Land use unavailable'});top.sort((a,b)=>a.rank-b.rank||a.row[2].localeCompare(b.row[2],undefined,{numeric:true}));if(top.length>40)top.pop();}
    }
    postMessage({type:'results',id,count,matches:top});
  }catch(error){loading=null;postMessage({type:'error',id,message:error.message});}
};
