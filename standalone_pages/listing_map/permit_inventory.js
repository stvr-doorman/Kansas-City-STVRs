'use strict';
const PermitInventory=(()=>{
  const scenario=Boolean(document.getElementById('scenarioMap'));
  const parameter=new URLSearchParams(location.search).get('include_other_permits');
  const includeOther=parameter===null?!scenario:parameter==='1';
  const scenarioPath=includeOther?'data/residential_scenarios':'data/residential_scenarios_confirmed';
  function resolve(url){
    if(includeOther)return url;
    if(url==='data/permits.json')return 'data/confirmed_permits/permits.json';
    if(url==='data/permit_parcels.geojson'||url==='data/licensed_parcels.geojson')return 'data/confirmed_permits/permit_parcels.geojson';
    return url;
  }
  function emptyGeometry(url){return !includeOther&&['data/permit_property_parcels.geojson','data/permit_location_points.json'].includes(url);}
  function setup(){
    const input=document.getElementById('includeOtherSavedPermits');
    if(input){input.checked=includeOther;input.addEventListener('change',()=>{
      const url=new URL(location.href);url.searchParams.set('include_other_permits',input.checked?'1':'0');location.assign(url);
    });}
    const note=document.getElementById('permitInventoryNote');
    if(note)note.textContent=includeOther
      ?(scenario?'Uses the full saved inventory. Only records saved as current count as existing licenses; expired temporary events remain historical.':'All saved permit records included, including temporary events and historical records. Expired and other non-current permits remain non-current.')
      :'Only regular permits confirmed issued and unexpired in the city STR GIS snapshot. Temporary events and unconfirmed records excluded. Missing records are unconfirmed, not proven invalid.';
    const download=document.getElementById('downloadPermits');
    if(download&&!includeOther){download.href='data/confirmed_permits/permits.csv';download.download='kansas_city_confirmed_current_permits.csv';}
  }
  setup();
  return {includeOther,scenarioPath,resolve,emptyGeometry};
})();
