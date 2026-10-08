'use strict';
const UserAddresses=(()=>{
  let records={},map;
  const empty=()=>({type:'FeatureCollection',features:[]});
  async function load(){
    const response=await fetch('data/listing_address_overrides.json');
    if(response.ok)records=(await response.json()).records;
  }
  function apply(listings){
    for(const listing of listings){
      const record=records[String(listing.listing_id)];if(!record)continue;
      if(!listing.user_address)listing.airbnb_point=listing.point?.slice();
      listing.user_address=record;listing.point=record.point.slice();
      listing.boundary_distance_m=record.boundary_distance_m;
      listing.cell_id=record.cell_id??null;listing.nearest_licensed_parcel_m=record.nearest_licensed_parcel_m??null;
    }
  }
  function patchAreas(data){
    for(const [id,record] of Object.entries(records)){
      data.points[id]=record.point;
      for(const [key,layer] of Object.entries(data.layers)){
        delete layer.assignments[id];if(record.areas[key])layer.assignments[id]=record.areas[key];
      }
    }
  }
  function select(listing){
    const record=listing?.user_address;
    map?.getSource('user-confirmed-parcel')?.setData(record?{type:'FeatureCollection',features:[{type:'Feature',geometry:record.geometry,properties:{}}]}:empty());
  }
  function init(instance){
    map=instance;map.addSource('user-confirmed-parcel',{type:'geojson',data:empty()});
    map.addLayer({id:'user-confirmed-parcel-line',type:'line',source:'user-confirmed-parcel',paint:{'line-color':'#0891b2','line-width':3}});
  }
  return {load,apply,patchAreas,init,select};
})();
