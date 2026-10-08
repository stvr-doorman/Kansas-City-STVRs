'use strict';
const PrivacyStreetCopy=(()=>{
  let loading;
  function format(streets){
    const groups=new Map();
    for(const [street,cityState,zip] of streets){
      if(!groups.has(cityState))groups.set(cityState,{streets:new Set(),zips:new Set()});
      const group=groups.get(cityState);group.streets.add(street);group.zips.add(zip);
    }
    return [...groups.keys()].sort().map(cityState=>{
      const group=groups.get(cityState);
      return `${[...group.streets].sort().join('\n')}\n${cityState} · ${[...group.zips].sort().join(', ')}`;
    }).join('\n\n');
  }
  async function getListing(listing){
    if(!loading)loading=fetch('data/privacy_streets/listing_streets.json').then(async response=>{
      if(!response.ok)throw Error('Street data could not load.');return response.json();
    }).catch(error=>{loading=null;throw error;});
    const point=listing.airbnb_point||listing.point;
    const data=await loading,record=data.records[String(listing.listing_id)];
    if(!record||!point||record.point[0]!==point[0]||record.point[1]!==point[1]||record.radius!==listing.privacy_radius_meters)throw Error('Street results need rebuilding for this listing’s saved location/radius.');
    return record;
  }
  function bind(container,listing){
    const button=container.querySelector('[data-copy-privacy-streets]'),status=container.querySelector('[data-privacy-street-status]');
    button.onclick=async()=>{
      button.disabled=true;status.textContent='Finding streets in the saved privacy circle…';
      try{
        if(typeof listing.privacy_radius_meters!=='number'||listing.privacy_radius_meters<0)throw Error('No reported privacy radius is available for this listing.');
        const record=await getListing(listing);
        if(!record.streets.length){status.textContent=`No mapped street centerlines intersect the reported ${record.radius} m radius. The map’s 15 m display fallback is not used; clipboard unchanged.`;return;}
        const text=format(record.streets);
        let copied=false;
        try{await navigator.clipboard.writeText(text);copied=true;}catch{}
        if(!copied){
          const field=document.createElement('textarea');field.value=text;field.setAttribute('aria-label','Street names, cities and ZIPs to copy');container.append(field);field.select();
          copied=document.execCommand('copy');if(copied)field.remove();
        }
        status.textContent=copied?`Copied streets${listing.user_address?' around the original Airbnb pin':''} grouped by city/state, with ZIPs listed once per group, from the reported ${record.radius} m radius.`:'Select and copy the street list shown below.';
      }catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}
    };
  }
  return {bind,getListing,format};
})();
