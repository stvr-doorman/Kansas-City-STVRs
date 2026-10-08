'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const collection = features => ({type:'FeatureCollection', features});
const feature = (geometry, properties={}) => ({type:'Feature', geometry, properties});
const icons = {pool:'🩱',hot_tub:'👙',bar:'🍻',pool_table:'🎱',karaoke:'🎤',bachelor_party:'💍🤵🏻',bachelorette_party:'💍💐👰🏻‍♀️'};
const customAmenityIcons = {dance_pole:'stripper.svg'};
const amenityIconHtml = key => customAmenityIcons[key]
  ? `<img class="amenity-custom-icon" src="${customAmenityIcons[key]}" alt="">`
  : esc(icons[key]||'');
const communityStatusNames = {no_license_at_address:'Community submitted: no license at address',license_at_address:'Community submitted: license at address',undetermined:'Undetermined · not matched to address yet'};
const ESTIMATED_STVR_FEE=1170;
let listings=[], permits=[], report, visible=[], selectedHost='', selectedHostMetric='', map, popup, emojiMarkers=[], refreshTimer;
const permitGrid = new Map(), addressCache = new Map(), connectionLabelGroups=new Map(), fallbackParcelLookups=new Map();
let currentPermits=[], parcelManifest, addressRequest=0;
let listingPlotAddresses={records:{}};
let spatial={available:false}, balance=[], balanceKey=null;
let selectedListing=null, hoveredPrivacyId=null, selectedPartyCombo='', selectedPartyRequireCapacity=false, pendingHostKey='';
let nameMatchingData={},parcelMatchingData=null, permitSavedDetails=null, permitLocationPoints=null, licensedParcels=null, permitParcels=null, activeListingPointIndex=null;
let hostSortKey='total',hostSortDirection='desc';
const leeway = () => Number($('leeway').value);
const edgeBuffer = () => Number($('edgeBuffer').value);
const parcelTolerance = () => $('nearTolerance').checked?9.144:0;
const numberMode = () => report?.license_mode === 'number';
let eyeMarkers = [];
function applyNumberModeUI() {
  if (!numberMode() || document.body.classList.contains('number-mode')) return;
  document.body.classList.add('number-mode');
  const hide = selector => { for (const el of document.querySelectorAll(selector)) (el.closest('label') || el).hidden = true; };
  ['#leeway', 'label[for=leeway]', '#warningSymbols', '#permits', '#addresses', '#difference', '#nearTolerance', '#nearOnly',
   '#coverage', '#historical', '#outside', '#radius', 'label[for=radius]', '#autoMatchFilters', '.community-status', '#potentialRevenueButton'].forEach(hide);
  for (const id of ['warningSymbols', 'permits', 'addresses', 'difference', 'nearTolerance', 'nearOnly', 'coverage', 'historical', 'outside']) {
    const el = document.getElementById(id);
    if (el) { el.checked = false; el.defaultChecked = false; }
  }
  document.querySelector('.community-status')?.closest('details')?.setAttribute('hidden', '');
  const likely = document.getElementById('likely');
  if (likely?.parentElement) likely.parentElement.lastChild.textContent = ' Likely unlicensed (missing or non-current registration)';
  const section = document.getElementById('rentalTypes')?.closest('section');
  if (section) document.getElementById('searchResults')?.after(section);
}
function showNotice(text) {
  let dialog = document.getElementById('noticeDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'noticeDialog';
    dialog.innerHTML = '<p id="noticeText"></p><button type="button" id="noticeClose">OK</button>';
    document.body.append(dialog);
    dialog.querySelector('#noticeClose').onclick = () => dialog.close();
  }
  dialog.querySelector('#noticeText').textContent = text;
  if (!dialog.open) dialog.showModal();
}
function updateEyes() {
  // Individual listing overlays are disabled for the neighborhood percentage view.
  for(const marker of eyeMarkers)marker.remove();eyeMarkers=[];return;
  for (const marker of eyeMarkers) marker.remove();
  eyeMarkers = [];
  if (!report?.low_priority_message || !map || map.getZoom() < 15) return;
  const bounds = map.getBounds();
  for (const l of filterListings(true, true).filter(x => x.low_priority && bounds.contains(x.displayPoint || x.point)).slice(0, 600)) {
    const el = document.createElement('div');
    el.className = 'eye-marker';
    el.textContent = '\u{1F440}';
    el.title = l.rental_type || 'Single room listing';
    el.style.cssText = 'font-size:11px;line-height:1;cursor:pointer;';
    el.addEventListener('click', event => {
      event.stopPropagation();
      popup?.remove();
      popup = new maplibregl.Popup({closeButton: true}).setLngLat(l.displayPoint || l.point)
        .setHTML(`<p style="margin:0;padding-right:24px">${esc(report.low_priority_message)}</p>`).addTo(map);
    });
    eyeMarkers.push(new maplibregl.Marker({element: el}).setLngLat(l.displayPoint || l.point).addTo(map));
  }
}
const potentiallyLicensed = l => !l.likely_hotel && l.registration_class === 'unmatched';
const likelyUnlicensed = l => numberMode() ? l.likely_unlicensed_number === true && !l.noncurrent_permit_at_permitted_address : spatial.available && Spatial.likelyUnlicensed(l,leeway(),edgeBuffer(),parcelTolerance());

function ring(point, meters, steps=40) {
  const [lon,lat]=point, angular=meters/6371008.8, phi=lat*Math.PI/180, lambda=lon*Math.PI/180;
  const coordinates=[];
  for(let i=0;i<=steps;i++) {
    const bearing=i/steps*2*Math.PI;
    const p=Math.asin(Math.sin(phi)*Math.cos(angular)+Math.cos(phi)*Math.sin(angular)*Math.cos(bearing));
    const l=lambda+Math.atan2(Math.sin(bearing)*Math.sin(angular)*Math.cos(phi),Math.cos(angular)-Math.sin(phi)*Math.sin(p));
    coordinates.push([l*180/Math.PI,p*180/Math.PI]);
  }
  return {type:'Polygon',coordinates:[coordinates]};
}
function distance(a,b) {
  const rad=Math.PI/180,dLat=(b[1]-a[1])*rad,dLon=(b[0]-a[0])*rad;
  const s=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;
  return 12742017.6*Math.asin(Math.min(1,Math.sqrt(s)));
}
function outsideCoverage(item, meters) {
  const [x,y]=item.point, dx=meters/(111000*Math.cos(y*Math.PI/180)),dy=meters/111000;
  for(let ix=Math.floor((x-dx)*100);ix<=Math.floor((x+dx)*100);ix++)
    for(let iy=Math.floor((y-dy)*100);iy<=Math.floor((y+dy)*100);iy++)
      for(const permit of permitGrid.get(`${ix}_${iy}`)||[]) if(distance(item.point,permit.point)<=meters) return false;
  return true;
}
function hostKey(l) { return l.host_user_id || String(l.host_profile_url||'').trim().toLowerCase() || `name:${l.host_name || '(unknown)'}`; }
function normalizeParcel(value) { return String(value||'').replace(/[^a-z\d]/gi,'').toUpperCase(); }
function listingPointIndex(items) {
  const bins=new Map();
  for(const item of items)if(item.point){const key=`${Math.floor(item.point[0]*100)}_${Math.floor(item.point[1]*100)}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(item.point);}
  return bins;
}
function nearVisibleListing(point,index=activeListingPointIndex) {
  if(!selectedHost||!index)return true;
  const x=Math.floor(point[0]*100),y=Math.floor(point[1]*100);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const listingPoint of index.get(`${x+dx}_${y+dy}`)||[])if(distance(point,listingPoint)<=550)return true;
  return false;
}
function openComplaint(address='', point=null, listingUrl='') {
  const url=new URL('https://docs.google.com/forms/d/e/1FAIpQLSfjyNy_1KBORvjiCx7fhIXTupuaQWXS8VDS0ttXh8Go95eCJg/viewform?usp=pp_url');
  url.searchParams.set('entry.743148639',address||'');url.searchParams.set('entry.1753077861',point?.[1]??'');
  url.searchParams.set('entry.1569813902',point?.[0]??'');url.searchParams.set('entry.1841045190',listingUrl||'');
  window.open(url.toString(),'_blank','noopener,noreferrer');
}
function bindComplaintButton(container,address,point,listingUrl='') {
  container.querySelector('[data-complaint]')?.addEventListener('click',()=>openComplaint(address,point,listingUrl));
}
function amenityCombo(listing) {
  return Object.keys(listing.amenities||{}).filter(key=>icons[key]||customAmenityIcons[key]).sort().join('|');
}
function communityStatus(listing) {
  return communityStatusNames[listing.community_license_status] ? listing.community_license_status : 'undetermined';
}
function overCapacityFlag(listing) {
  return ViolationStats.overOccupancy(listing,!$('includeLargeOverCapacity').checked,$('excludeMultipleOverCapacity').checked);
}
function updateInventoryEstimate(){
  const current=permits.filter(p=>p.status==='current').length;
  const endpoints=[Number($('edgeBuffer').min),Number($('edgeBuffer').max)].map(buffer=>{
    const items=[...new Map(filterListings(false,false,buffer).map(l=>[l.listing_id,l])).values()];
    const total=items.length,hotels=items.filter(l=>l.likely_hotel).length,count=Math.max(0,total-hotels-current);
    return {buffer,total,hotels,count,percent:total?100*count/total:0};
  });
  const low=Math.min(...endpoints.map(e=>e.count)),high=Math.max(...endpoints.map(e=>e.count));
  const pctLow=Math.min(...endpoints.map(e=>e.percent)),pctHigh=Math.max(...endpoints.map(e=>e.percent));
  const fmt=n=>n.toLocaleString(),money=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
  const range=low===high?fmt(low):`${fmt(low)} to ${fmt(high)}`;
  const percent=pctLow===pctHigh?`${pctLow.toFixed(1)}%`:`${pctLow.toFixed(1)} to ${pctHigh.toFixed(1)}%`;
  $('potentiallyLicensedCount').textContent=`${visible.filter(potentiallyLicensed).length.toLocaleString()} potentially licensed`;
  $('potentiallyLicensedCount').title='Filtered listing dots showing a permit number absent from CompassKC; licensing remains unverified. Includes dots outside the current map view.';
  $('potentiallyUnlicensedCount').textContent=`Current estimate: up to ~${fmt(high)} potentially unlicensed`;
  const equation=endpoints.map(e=>`Edge buffer ${e.buffer>0?'+':''}${e.buffer} m: ${fmt(e.total)} filtered listings − ${fmt(e.hotels)} likely hotels − ${fmt(current)} current city permits = ${fmt(e.count)} potentially unlicensed (${e.percent.toFixed(1)}%).`).join(' ');
  $('potentiallyUnlicensedCount').title=equation+' Other active filters are retained; map viewport does not affect this range. This inventory estimate does not identify individual unlicensed listings.';
  const revenueLow=money(low*ESTIMATED_STVR_FEE),revenueHigh=money(high*ESTIMATED_STVR_FEE),revenue=low===high?revenueLow:`${revenueLow} to ${revenueHigh}`;
  $('potentialRevenueButton').textContent=`Potential license revenue shortfall ${revenue}`;
  $('revenueEquation').textContent=equation+` ${range} × $${ESTIMATED_STVR_FEE} = ${revenue} potential license revenue shortfall.`;
  $('revenueSnapshotNote').textContent=`Snapshot date: ${report.as_of}. Range uses the minimum and maximum edge buffers with other active filters, regardless of viewport. Unmapped listings are excluded. It subtracts all current city permits, assumes one permit per non-hotel listing, and clamps negative differences to zero. It does not verify individual listing authorization.`;
}

function updateViolationStats() {
  const excludeLarge=!$('includeLargeOverCapacity').checked,excludeMultiple=$('excludeMultipleOverCapacity').checked;
  $('statsExcludeLarge').checked=excludeLarge;$('statsExcludeMultiple').checked=excludeMultiple;
  const scoped=visible.filter(l=>l.point&&Spatial.inScope(l,edgeBuffer()));
  const stats=ViolationStats.summarize(scoped,excludeLarge,excludeMultiple);
  const fmt=n=>n.toLocaleString();
  const percent=stats.percent===null?'N/A':stats.percent.toFixed(1)+'%';
  $('violationStatsButton').textContent=spatial.available?`${fmt(stats.over)} potential violations (${percent})`:'Potential violations N/A';
  $('violationStatsButton').title='Over-occupancy percentage · click for counts, exclusions and map filters';
  $('occupancyEquation').textContent=spatial.available
    ?`${fmt(stats.over)} over-occupancy listings ÷ ${fmt(stats.eligible)} eligible listings with known occupancy × 100 = ${percent}.`
    :'Analysis-area data unavailable; no occupancy percentage calculated.';
  const rows=[['Mapped listings in analysis area',stats.total],['Likely hotels excluded',stats.hotels],['More than 5 bedrooms excluded',stats.large],['Multiple license numbers excluded (after bedroom exclusion)',stats.multiple],['Unknown occupancy excluded',stats.unknown],['Eligible denominator',stats.eligible]];
  $('occupancyBreakdown').replaceChildren(...rows.map(([label,count])=>{const row=document.createElement('p');row.className='permit-status-row';const name=document.createElement('span');name.textContent=label;const value=document.createElement('strong');value.textContent=fmt(count);row.append(name,value);return row;}));
  $('showOverOccupancy').textContent=`Over occupancy: ${fmt(stats.over)} · Show on map (+1)`;
  $('showOverOccupancy').disabled=!spatial.available||!stats.over;
  const nonHotels=scoped.filter(l=>!l.likely_hotel),known=nonHotels.filter(l=>numberMode()?(l.likely_unlicensed_number===true||l.likely_unlicensed_number===false):Spatial.overlap(l,leeway(),parcelTolerance())!==null);
  const likely=known.filter(likelyUnlicensed).length;
  updateInventoryEstimate();
  $('likelyStatsEquation').textContent=numberMode()
    ?`${fmt(likely)} listings without a current registration number ÷ ${fmt(known.length)} non-hotel listings with saved text that are not exempt = ${known.length?(100*likely/known.length).toFixed(1)+'%':'N/A'}. ${fmt(nonHotels.length-known.length)} listings excluded (exempt or no saved text). A listing counts when it shows no registration number or a non-current one without a current permit at the matched property. Listings citing expired permits at currently permitted properties are shown separately as listed permit expired, property permit renewed. Numbers missing from CompassKC count separately as potentially licensed.`
    :spatial.available
    ?`${fmt(likely)} likely-unlicensed listings ÷ ${fmt(known.length)} spatially assessable non-hotel listings = ${known.length?(100*likely/known.length).toFixed(1)+'%':'N/A'}. ${fmt(nonHotels.length-known.length)} unknown spatial results excluded. Privacy leeway +${leeway()}%; parcel tolerance ${parcelTolerance().toFixed(2)} m; edge buffer ${edgeBuffer()} m.`
    :'Spatial data unavailable; no likely-unlicensed classification calculated.';
  $('showLikelyUnlicensed').textContent=`Likely unlicensed: ${fmt(likely)} · Show listings + heatmap`;
  $('showLikelyUnlicensed').disabled=(!spatial.available&&!numberMode())||!likely;
  $('revenueLikelyStats').textContent=numberMode()?'Registration-number screening · View calculation':spatial.available?`Spatial screening: ${fmt(likely)} · View calculation`:'Spatial screening unavailable';
}
function showStatsOnMap(kind) {
  // Keep calculation settings while clearing unrelated filters so counts reconcile.
  const preserved={includeLargeOverCapacity:$('includeLargeOverCapacity').checked,excludeMultipleOverCapacity:$('excludeMultipleOverCapacity').checked,
    edgeBuffer:$('edgeBuffer').value,leeway:$('leeway').value,nearTolerance:$('nearTolerance').checked};
  for(const control of document.querySelectorAll('#filters input')){
    if(control.type==='checkbox')control.checked=control.defaultChecked;else control.value=control.defaultValue;
  }
  for(const control of document.querySelectorAll('#filters select'))control.selectedIndex=0;
  for(const [id,value] of Object.entries(preserved))if(typeof value==='boolean')$(id).checked=value;else $(id).value=value;
  selectedHost='';selectedHostMetric='';selectedPartyCombo='';selectedPartyRequireCapacity=false;$('hostSearch').value='';
  $('scopeOnly').checked=true;$('over').value=kind==='occupancy'?'1':'0';
  $('likely').checked=kind==='likely';$('surplusHeatmap').checked=kind==='likely';
  $('violationStatsDialog').close();$('revenueDialog').close();popup?.remove();selectedListing=null;
  if($('filters').classList.contains('collapsed'))$('toggleFilters').click();
  update();fitVisible();
}
function autoMatchStatus(l){
  if(l.likely_hotel)return 'hotel';
  if(numberMode())return l.registration_class==='current'?'licensed':potentiallyLicensed(l)?'nearby':likelyUnlicensed(l)?'unlicensed':'unknown';
  const matches=(l.preliminary_matches||[]).filter(m=>m.type.includes('owner_'));
  const licensed=matches.some(m=>normalizeParcel(m.parcel)&&currentPermitParcels.has(normalizeParcel(m.parcel)));
  const unlicensed=matches.some(m=>normalizeParcel(m.parcel)&&!currentPermitParcels.has(normalizeParcel(m.parcel)));
  if(licensed&&!unlicensed)return 'licensed';
  const nearby=Spatial.overlap(l,leeway(),parcelTolerance())===true||typeof l.nearest_licensed_parcel_m==='number'&&l.nearest_licensed_parcel_m<=9.144;
  if(nearby)return 'nearby';
  return licensed&&unlicensed?'unknown':unlicensed?'unlicensed':'unknown';
}
let currentPermitParcels=new Set(),anyPermitParcels=new Set();
function updateAutoMatchCounts(){
  const candidates=filterListings(true);
  for(const status of ['licensed','nearby','unlicensed','unknown','hotel'])document.querySelector(`[data-auto-count="${status}"]`).textContent=candidates.filter(l=>autoMatchStatus(l)===status).length.toLocaleString();
}
function matchesPermitStatus(listing,status){
  if(!status)return true;
  const matches=listing.matched_permits||[];
  return status==='known'?matches.length>0:matches.some(p=>p.status===status);
}
const screeningNameCache=new WeakMap(),screeningNameLookups=new Map();
let screeningLookupRunning=false;
function screeningNames(listing){
  if(listing.user_address)return [];
  const live=fallbackParcelLookups.get(listing.listing_id)?.data||screeningNameLookups.get(listing.listing_id)?.data;
  const previous=screeningNameCache.get(listing);
  if(previous&&previous.live===live)return previous.rows;
  const geometry=collection([...(parcelMatchingData?.features||[]),...(live?.features||[])]);
  const rows=PermitProperties.candidates(listing,geometry,nameMatchingData,550).filter(row=>row.type!=='distance');
  screeningNameCache.set(listing,{live,rows});return rows;
}
function parcelHasAnyPermit(row){
  return [row.source_parcel,row.parcel].filter(Boolean).some(id=>anyPermitParcels.has(normalizeParcel(id)))
    ||(permitParcels?.features||[]).some(f=>normalizeParcel(f.properties.source_parcel)===normalizeParcel(row.source_parcel||row.parcel));
}
async function ensureScreeningNameCoverage(){
  if(!$('nameParcelNoPermit').checked||screeningLookupRunning)return;
  const queue=listings.filter(l=>l.point&&needsParcelFallback(l)&&!screeningNameLookups.has(l.listing_id)&&!fallbackParcelLookups.get(l.listing_id)?.data);
  if(!queue.length)return;
  screeningLookupRunning=true;
  const total=queue.length;
  let completed=0,failed=0;
  const status=$('nameParcelStatus');
  const refresh=()=>{status.textContent=`Checking city parcel owners: ${completed}/${total}${failed?` · ${failed} unavailable`:''}`;};
  refresh();
  await Promise.all(Array.from({length:4},async()=>{
    while(queue.length&&$('nameParcelNoPermit').checked){
      const listing=queue.shift();screeningNameLookups.set(listing.listing_id,{pending:true});
      try{const data=await ParcelCandidates.loadNames(listing,nameMatchingData);screeningNameLookups.set(listing.listing_id,{data});}
      catch(error){screeningNameLookups.set(listing.listing_id,{error:error.message});failed++;}
      completed++;refresh();
      clearTimeout(refreshTimer);refreshTimer=setTimeout(update,250);
    }
  }));
  screeningLookupRunning=false;
  status.textContent=queue.length?'City owner checks paused.':`City owner checks complete${failed?` · ${failed} unavailable`:''}. Name matches remain uncertain.`;
  update();
}
function noListedPermit(listing){return !listing.registration_text?.trim()&&!detectedPermitList(listing).length;}
function unlicensedTier(listing){
  if(listing.likely_hotel||(listing.property_permits||[]).some(p=>p.status==='current'))return -1;
  const names=screeningNames(listing);
  if(names.some(row=>currentPermitParcels.has(normalizeParcel(row.source_parcel||row.parcel))))return 0;
  const nearLimit=Math.max(155,Number(listing.privacy_radius_meters)||0);
  const nearest=listing.nearest_licensed_parcel_m;
  if(noListedPermit(listing)&&typeof nearest==='number'&&Number.isFinite(nearest)&&nearest>nearLimit)return 99;
  if(likelyUnlicensed(listing))return 49.5;
  return 0;
}
function matchesScreeningFilters(listing){
  if($('noLicenseNumber').checked&&!noListedPermit(listing))return false;
  if($('nameParcelNoPermit').checked&&!screeningNames(listing).some(row=>!parcelHasAnyPermit(row)))return false;
  const minimum=Number($('unlicensedCertainty').value);
  if($('likely').checked||minimum>0)return unlicensedTier(listing)>=minimum;
  return true;
}
function updateScreeningControls(){
  const value=Number($('unlicensedCertainty').value);
  const label=value>=99?'Very certain':value>0?'Moderately certain':'Possibly licensed, no match';
  $('unlicensedCertaintyValue').textContent=label;
  $('unlicensedCertainty').setAttribute('aria-valuetext',label);
  const excess=Number($('over').value);
  $('overValue').textContent=excess?`${excess}+ guests`:'0 · All capacities';
  $('over').max=6;
  if(excess>6)$('over').value=6;
}
function filterListings(skipAuto=false, includeLowPriority=false, scopeBuffer=null) {
  const query=$('search').value.trim().toLowerCase(), selected=[...document.querySelectorAll('.amenity:checked')].map(e=>e.value);
  const communityStatuses=[...document.querySelectorAll('.community-status:checked')].map(e=>e.value);
  const minimum=Number($('over').value), radius=Number($('radius').value);
  const rentalTypes=new Set([...document.querySelectorAll('.rental-type:checked:not(.low-priority)')].map(input=>input.value));
  const matching=requireCapacity=>listings.filter(l=>l.point && (!query||l.search.includes(query)) && (!selectedHost||hostKey(l)===selectedHost)
    && (!(scopeBuffer!==null||$('scopeOnly').checked)||Spatial.inScope(l,scopeBuffer??edgeBuffer()))
    && matchesScreeningFilters(l)
    && legendAllowsListing(l)
    && (!$('potentialOnly').checked||potentiallyLicensed(l))
    && (!$('expiredMajorOnly').checked||(l.matched_permits||[]).some(expiredMajorPermit))
    && matchesPermitStatus(l,$('permitStatusFilter').value)
    && (numberMode()||!$('nearOnly').checked||(typeof l.nearest_licensed_parcel_m==='number'&&l.nearest_licensed_parcel_m<=9.144))
    && communityStatuses.includes(communityStatus(l))
    && (!minimum||(overCapacityFlag(l)&&l.over_capacity>=minimum))
    && (!$('partyOnly').checked||(l.party_house||overCapacityFlag(l)))
    && (!requireCapacity||(selectedHost&&['party','combo'].includes(selectedHostMetric)&&overCapacityFlag(l)))
    && (selectedHostMetric!=='combo'||amenityCombo(l)===selectedPartyCombo)
    && (!selected.length||($('allAmenities').checked?selected.every(k=>l.amenities[k]):selected.some(k=>l.amenities[k])))
    && ((includeLowPriority&&l.low_priority)||(!l.low_priority&&rentalTypes.has(l.rental_type||'')))
    && (skipAuto||[...document.querySelectorAll('.auto-match-status:checked')].some(input=>input.value===autoMatchStatus(l)))
    && (numberMode()||!$('outside').checked||outsideCoverage(l,radius)));
  return matching(selectedPartyRequireCapacity);
}
function exploreFiltersActive() {
  const controls=[...document.querySelectorAll('#filters input,#filters select')].filter(control=>!control.disabled&&!control.closest('#gisParcelSearch'));
  return Boolean(selectedHost||selectedPartyCombo||selectedPartyRequireCapacity)||controls.some(control=>{
    if(control.type==='checkbox'||control.type==='radio')return control.checked!==control.defaultChecked;
    if(control.tagName==='SELECT')return control.selectedIndex!==Math.max(0,[...control.options].findIndex(option=>option.defaultSelected));
    return control.value!==control.defaultValue;
  });
}
function updateExploreClearButton() {
  const button=$('clearExploreFilters');
  if(!button)return;
  const active=exploreFiltersActive();
  button.hidden=!active;
  button.classList.toggle('filter-attention',active);
  button.setAttribute('aria-pressed',String(active));
}
function resetExploreFilters() {
  BrowserState.clear();
  for(const control of document.querySelectorAll('#filters input')){
    if(control.closest('#gisParcelSearch'))continue;
    if(control.type==='checkbox')control.checked=control.defaultChecked;
    else control.value=control.defaultValue;
  }
  for(const control of document.querySelectorAll('#filters select'))control.selectedIndex=Math.max(0,[...control.options].findIndex(option=>option.defaultSelected));
  selectedHost='';selectedHostMetric='';selectedPartyCombo='';selectedPartyRequireCapacity=false;
  $('hostSearch').value='';
  update();
}
const expiredMajorPermit=p=>p.status==='expired'&&/STR[ -]*MAJ/i.test(p.permit_number||'');
const expiredMajorListing=l=>l.registration_class==='expired'&&(l.matched_permits||[]).some(expiredMajorPermit);
function markerColor(l) {
  if(l.likely_hotel) return '#f97316';
  if(numberMode()){
    if(overCapacityFlag(l))return '#dc2626';
    if(l.cancelled_permit_at_permitted_address)return '#22c55e';
    if(expiredMajorListing(l))return '#a855f7';
    if(likelyUnlicensed(l))return '#dc2626';
    if(potentiallyLicensed(l)||l.noncurrent_permit_at_permitted_address)return '#facc15';
    if(l.registration_class==='current')return '#22c55e';
    return '#e2e8f0';
  }
  if(l.cancelled_permit_at_permitted_address&&!overCapacityFlag(l))return '#22c55e';
  if(expiredMajorListing(l)&&!overCapacityFlag(l))return '#a855f7';
  if(l.license_status==='expired') return '#facc15';
  if(l.license_status==='current') return '#22c55e';
  if(overCapacityFlag(l)) return '#fb7185';
  if(l.license_status==='other') return '#c4b5fd';
  return '#e2e8f0';
}
function listingFeature(l) {
  const permittedOverCapacity=!l.likely_hotel&&overCapacityFlag(l)&&(l.property_permits||l.matched_permits||[]).some(p=>p.status==='current');
  return feature({type:'Point',coordinates:l.displayPoint||l.point},{id:l.listing_id,color:markerColor(l),renewed:permittedOverCapacity||(!!l.noncurrent_permit_at_permitted_address&&!l.cancelled_permit_at_permitted_address&&!l.likely_hotel),renewal_icon:permittedOverCapacity?'permitted-over-capacity':overCapacityFlag(l)?'renewed-over-capacity':expiredMajorListing(l)?'renewed-major-permit':'renewed-permit',warning:!!likelyUnlicensed(l),
    stroke:overCapacityFlag(l)?'#dc2626':'#2563eb',
    label:(l.guests===null?'?':String(l.guests))+(overCapacityFlag(l)?'\n+'+l.over_capacity:'')});
}
function updateFooterListingCount(){
  if(!map)return;
  const count=new Set(visible.map(l=>l.listing_id)).size;
  $('buildStatus').textContent=`${count.toLocaleString()} visible listings`;
  $('buildStatus').title='All listing dots allowed by the active filters and edge buffer, including dots outside the current map view. Listings more than 550 m outside Kansas City are excluded.';
}
function legendCategory(listing){
  const p=listingFeature(listing).properties;
  const colors={'#a855f7':'major','#f97316':'hotel','#22c55e':'current','#facc15':'potential','#dc2626':'warning','#e2e8f0':'unknown'};
  const split={'renewed-major-permit':'renewed-major','renewed-permit':'renewed','permitted-over-capacity':'permitted-over','renewed-over-capacity':'warning'};
  return p.renewed?split[p.renewal_icon]:colors[p.color];
}
function legendAllowsListing(listing){return [...document.querySelectorAll('.legend-category:checked')].some(input=>input.value===legendCategory(listing));}
function grayPermitParcel(f){return !['current','expired','revoked','suspended'].includes(f.properties.permit_status);}
function updateLegendCounts(){
  const counts=Object.fromEntries(['major','renewed-major','hotel','current','potential','renewed','permitted-over','warning','gray-parcel','unknown','guest-label'].map(key=>[key,0]));
  const colors={'#a855f7':'major','#f97316':'hotel','#22c55e':'current','#facc15':'potential','#dc2626':'warning','#e2e8f0':'unknown'};
  const split={'renewed-major-permit':'renewed-major','renewed-permit':'renewed','permitted-over-capacity':'permitted-over','renewed-over-capacity':'warning'};
  for(const listing of visible){
    const properties=listingFeature(listing).properties;
    const category=properties.renewed?split[properties.renewal_icon]:colors[properties.color];
    if(category)counts[category]++;
    if(overCapacityFlag(listing))counts['guest-label']++;
  }
  if($('parcels').checked&&$('legendGrayParcels').checked){
    const nearby=new Set(permits.filter(p=>p.point&&nearVisibleListing(p.point)).map(p=>normalizeParcel(p.parcel)));
    counts['gray-parcel']=new Set((permitParcels?.features||[]).filter(f=>!['current','expired','revoked','suspended'].includes(f.properties.permit_status)
      &&(numberMode()||!selectedHost||nearby.has(normalizeParcel(f.properties.parcel)))).map(f=>normalizeParcel(f.properties.parcel))).size;
  }
  for(const el of document.querySelectorAll('[data-legend-count]'))el.textContent=el.dataset.legendCount==='guest-label'?`(${counts['guest-label'].toLocaleString()} over-capacity listings)`:`(${counts[el.dataset.legendCount].toLocaleString()})`;
}
function sourceData(id,data) {
  // Neighborhood view: retain counts but suppress individual point/connection displays.
  if(['listings','permit-points','privacy','coverage','connections','permit-links','candidate-connections','connection-labels','name-matches','balance','surplus','deficit'].includes(id))data=collection([]);
  if(['connections','permit-links','candidate-connections'].includes(id))data=collection(data.features.filter(f=>f.geometry.type!=='LineString'||f.geometry.coordinates.slice(1).every((point,i)=>distance(f.geometry.coordinates[i],point)<=550)));
  map.getSource(id)?.setData(data);
  if(['connections','permit-links','candidate-connections'].includes(id)){
    connectionLabelGroups.set(id,data.features.filter(f=>f.geometry.type==='LineString'&&f.properties?.uncertain).map(f=>{const a=f.geometry.coordinates[0],b=f.geometry.coordinates.at(-1);return feature({type:'Point',coordinates:[(a[0]+b[0])/2,(a[1]+b[1])/2]},{label:f.properties.reference_label||(['owner_nickname','permit_owner_nickname'].includes(f.properties.method)?(f.properties.name_source==='permit'?'Permit nickname ?':'Parcel nickname ?'):['owner_name','owner_first_name'].includes(f.properties.method)?'Name ?':'?')});}));
    map.getSource('connection-labels')?.setData(collection([...connectionLabelGroups.values()].flat()));
  }
}
function layerVisibility(ids,on) { for(const id of ids) if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',on?'visible':'none'); }
function updatePrivacy() {
  const subjects=selectedListing?[selectedListing]:visible;
  sourceData('privacy',collection($('privacy').checked?subjects.filter(l=>!l.user_address&&(l.privacy_radius_meters>0||l===selectedListing)).map(l=>{const radius=l.privacy_radius_meters>0?l.privacy_radius_meters:15;const f=feature(ring(l.point,radius),{id:l.listing_id,selected:l===selectedListing,radius_m:radius,radius_source:l.privacy_radius_meters>0?'airbnb_listing_data':'display_fallback'});f.id=l.listing_id;return f;}):[]));
}

function update() {
  ensureScreeningNameCoverage();
  updateScreeningControls();
  if(numberMode())for(const id of ['warningSymbols','permits','addresses','difference','nearTolerance','nearOnly','coverage','historical','outside'])$(id).checked=false;
  BrowserState.schedule();
  if(!map?.getSource('listings')) return;
  updateExploreClearButton();
  map.setLayoutProperty('listing-labels','visibility',$('legendGuestLabels').checked?'visible':'none');
  for(const input of document.querySelectorAll('.low-priority:checked'))input.checked=false;
  visible=filterListings();
  AreaStats.update();
  $('expiredMajorCount').textContent=listings.filter(l=>l.point&&(l.matched_permits||[]).some(expiredMajorPermit)).length.toLocaleString();
  activeListingPointIndex=selectedHost?listingPointIndex(visible):null;
  sourceData('listings',collection(visible.map(listingFeature)));
  if(selectedListing&&!visible.some(l=>l.listing_id===selectedListing.listing_id)){popup?.remove();selectedListing=null;}
  updatePrivacy();
  $('leewayValue').textContent=`+${leeway()}%`;
  $('edgeValue').textContent=`${edgeBuffer()>0?'+':''}${edgeBuffer()} m`;
  sourceData('edge-buffer',collection(spatial.available&&edgeBuffer()!==0?[spatial.buffers[String(edgeBuffer())]]:[]));
  sourceData('edge-band',collection(spatial.available&&edgeBuffer()!==0?[spatial.buffer_bands[String(edgeBuffer())]]:[]));
  layerVisibility(['boundary-halo','boundary-line','edge-buffer-line','edge-buffer-fill'],$ ('outline').checked);
  layerVisibility(['warning-markers'],$ ('warningSymbols').checked);
  const scoped=listings.filter(l=>l.point&&Spatial.inScope(l,edgeBuffer()));
  updateAutoMatchCounts();
  $('spatialSummary').textContent=numberMode()?`${scoped.filter(l=>likelyUnlicensed(l)).length.toLocaleString()} likely-unlicensed listings · ${scoped.filter(potentiallyLicensed).length.toLocaleString()} potentially licensed (permit does not show up in license list) · ${scoped.filter(l=>l.likely_unlicensed_number===null||l.likely_unlicensed_number===undefined).length} not assessed (exempt, hotel or no saved text) · ${scoped.filter(l=>l.noncurrent_permit_at_permitted_address).length.toLocaleString()} listed permit expired, property permit renewed · ${scoped.length.toLocaleString()} listings in analysis area. Not a confirmed violation.`:spatial.available?`${scoped.filter(l=>likelyUnlicensed(l)).length.toLocaleString()} spatial warnings · ${scoped.filter(l=>Spatial.overlap(l,leeway(),parcelTolerance())===null).length} unknown · ${scoped.length.toLocaleString()} listings in analysis area. ${parcelTolerance()?'Includes 10-yard parcel tolerance (Advanced). ':''}Overlap is not a confirmed license match.`:'Spatial data unavailable; no warnings inferred.';
  updateBalance();
  updateViolationStats();
  layerVisibility(['parcel-fill','parcel-line'],$ ('parcels').checked);
  layerVisibility(['heatmap'],$ ('heatmap').checked);
  const displayedPermits=$('historical').checked?permits:currentPermits;
  const nearbyPermits=displayedPermits.filter(p=>p.point&&nearVisibleListing(p.point));
  sourceData('permit-points',collection($('permits').checked?nearbyPermits.map(p=>feature({type:'Point',coordinates:p.point},{id:p.id,color:p.status==='current'?'#15803d':p.status==='expired'?(expiredMajorPermit(p)?'#a855f7':'#eab308'):['revoked','suspended'].includes(p.status)?'#dc2626':'#a78bfa'})):[]));
  if(numberMode())sourceData('permit-links',collection(permitParcelLinks(visible)));
  if(permitParcels){const nearbyParcels=new Set(permits.filter(p=>p.point&&nearVisibleListing(p.point)).map(p=>normalizeParcel(p.parcel)).filter(Boolean));sourceData('parcels',collection($('parcels').checked?permitParcels.features.filter(f=>($('legendGrayParcels').checked||!grayPermitParcel(f))&&(numberMode()||!selectedHost||nearbyParcels.has(normalizeParcel(f.properties.parcel)))):[]));}
  const radius=Number($('radius').value);
  $('radiusValue').textContent=`${radius} m`;
  sourceData('coverage',collection($('coverage').checked&&radius>0?currentPermits.filter(p=>nearVisibleListing(p.point)).map(p=>feature(ring(p.point,radius))):[]));
  $('counts').textContent=`${visible.length.toLocaleString()} visible · ${listings.filter(l=>l.point).length.toLocaleString()} mapped · ${listings.filter(l=>!l.point).length.toLocaleString()} awaiting location`;
  $('parcelMatchRadiusValue').textContent=`${parcelMatchRadius()} m`;
  if(numberMode()&&selectedListing&&needsParcelFallback(selectedListing))renderFallbackAssociations(selectedListing,popup?.getElement().querySelector('[data-property-associations]'));
  updateFooterListingCount();
  updateLegendCounts();
  updateHosts(); updateSearch(); updateSymbols(); updateEyes(); updateAddresses();
}
function updateBalance() {
  if(!spatial.available)return;
  const radius=Number($('heatRadius').value),intensity=Number($('heatIntensity').value)/100;
  $('heatRadiusValue').textContent=`${radius} m`;$('heatIntensityValue').textContent=`${Math.round(intensity*100)}%`;
  const key=String(edgeBuffer());
  if(!numberMode()&&balanceKey!==key) {
    balance=Spatial.balanceCells(listings,permits,spatial.cells,edgeBuffer(),0);balanceKey=key;
    sourceData('balance',collection(balance));
  }
  // One equal-weight observation per visible flagged listing, anchored to its marker.
  // Grid-cell centers can lie far from rentals, so they never seed the red heatmap.
  const heatListings=[...new Map(visible.filter(likelyUnlicensed).map(l=>[l.listing_id,l])).values()];
  sourceData('surplus',collection(heatListings.map(l=>feature({type:'Point',coordinates:l.displayPoint||l.point},
    {id:l.listing_id,weight:1,radius_scale:radius/550}))));
  sourceData('deficit',collection([]));
  if(map.getLayer('surplus-heatmap'))map.setPaintProperty('surplus-heatmap','heatmap-opacity',intensity);
  layerVisibility(['balance-fill','balance-outline'],$ ('difference').checked);
  layerVisibility(['surplus-heatmap'],$ ('surplusHeatmap').checked&&radius>0);
  layerVisibility(['deficit-heatmap'],false);
  const listingCount=new Set(listings.filter(l=>!l.likely_hotel&&l.point&&l.cell_id&&Spatial.inScope(l,edgeBuffer())).map(l=>l.listing_id)).size;
  const propertyCount=new Set(permits.filter(p=>p.status==='current'&&p.point&&p.cell_id&&Spatial.inScope(p,edgeBuffer())).map(p=>normalizeParcel(p.parcel)||`record:${p.id}`)).size;
  $('balanceSummary').textContent=numberMode()?`${heatListings.length.toLocaleString()} visible likely-unlicensed listings seed the red heatmap. Permit locations and parcel overlaps are not used.`:`${listingCount.toLocaleString()} non-hotel listing locations · ${propertyCount.toLocaleString()} distinct current-permit properties. ${heatListings.length.toLocaleString()} visible likely-unlicensed listings seed the red heatmap. Grid counts are independent of display filters.`;
}
function updateHosts() {
  $('clearHost').classList.toggle('filter-attention',Boolean(selectedHost));
  $('clearHost').setAttribute('aria-pressed',String(Boolean(selectedHost)));
  const groups=new Map();
  for(const l of visible) {const key=hostKey(l);if(!groups.has(key))groups.set(key,{name:l.host_name||'Unknown host',items:[]});groups.get(key).items.push(l);}
  // Keep the active host's controls even when scope or another filter hides every result.
  if(selectedHost&&!groups.has(selectedHost)){
    const identity=listings.find(l=>hostKey(l)===selectedHost);
    if(identity)groups.set(selectedHost,{name:identity.host_name||'Unknown host',items:[]});
  }
  const hostQuery=$('hostSearch').value.trim().toLowerCase();
  const metric=group=>hostSortKey==='likely'?group.items.filter(likelyUnlicensed).length:hostSortKey==='party'?group.items.filter(l=>l.party_house).length:group.items.length;
  const filteredGroups=[...groups].filter(([key,group])=>key===selectedHost||group.name.toLowerCase().includes(hostQuery)).sort((a,b)=>{
    const comparison=hostSortKey==='host'?a[1].name.localeCompare(b[1].name):metric(a[1])-metric(b[1])||a[1].name.localeCompare(b[1].name);
    return comparison*(hostSortDirection==='asc'?1:-1);
  });
  $('hostCount').textContent=`(${filteredGroups.length})`;
  $('hosts').replaceChildren();
  const heading=document.createElement('div');heading.className='host-grid host-column-labels';
  for(const [key,label] of [['host','Host'],['total','Total'],['likely','Possibly unlicensed'],['party','Party / cap']]){
    const button=document.createElement('button');button.type='button';button.dataset.sortKey=key;button.className='host-sort'+(hostSortKey===key?' active':'');button.setAttribute('aria-sort',hostSortKey===key?(hostSortDirection==='asc'?'ascending':'descending'):'none');
    button.textContent=`${label}${hostSortKey===key?(hostSortDirection==='asc'?' ▲':' ▼'):''}`;
    button.onclick=()=>{if(hostSortKey===key)hostSortDirection=hostSortDirection==='asc'?'desc':'asc';else{hostSortKey=key;hostSortDirection=key==='host'?'asc':'desc';}updateHosts();};heading.append(button);
  }
  $('hosts').append(heading);
  for(const [key,g] of filteredGroups) {
    const row=document.createElement('div');row.className='host-row host-grid';
    const name=document.createElement('button');name.className='host-name'+(key===selectedHost?' selected':'');name.textContent=g.name;const identity=g.items[0]||listings.find(l=>hostKey(l)===key);name.title=identity.host_user_id?`Host ID ${identity.host_user_id}`:identity.host_profile_url||g.name;name.onclick=()=>{selectedHost=key;selectedHostMetric='total';selectedPartyRequireCapacity=false;$('partyOnly').checked=false;update();fitVisible();};
    const total=document.createElement('button');total.className='host-count'+(selectedHost===key&&selectedHostMetric==='total'?' filter-active':'');total.textContent=g.items.length;total.title='Filter map to this host';total.onclick=()=>{selectedHost=key;selectedHostMetric='total';selectedPartyRequireCapacity=false;$('partyOnly').checked=false;update();fitVisible();};
    const unlicensed=document.createElement('button');unlicensed.className='host-metric'+(selectedHost===key&&selectedHostMetric==='likely'?' filter-active':'');unlicensed.textContent=g.items.filter(likelyUnlicensed).length;unlicensed.title='Filter this host to possibly unlicensed locations';
    unlicensed.onclick=()=>{selectedHost=key;selectedHostMetric='likely';selectedPartyRequireCapacity=false;$('partyOnly').checked=false;$('likely').checked=true;update();fitVisible();};
    const party=document.createElement('button');party.className='host-metric'+(selectedHost===key&&selectedHostMetric==='party'?' filter-active':'');const partyCount=g.items.filter(l=>l.party_house).length,capCount=g.items.filter(overCapacityFlag).length;
    const cap=document.createElement('span');cap.className='host-cap-number';cap.textContent=capCount;
    party.append(document.createTextNode(`${partyCount} / `),cap);
    party.title=`${partyCount} party-keyword listings / ${capCount} over-capacity listings. Click to filter; Require over capacity starts checked.`;
    party.setAttribute('aria-label',`${g.name}: ${partyCount} party-keyword listings, ${capCount} over-capacity listings`);
    party.onclick=()=>{selectedHost=key;selectedHostMetric='party';selectedPartyCombo='';selectedPartyRequireCapacity=true;$('partyOnly').checked=true;update();fitVisible();$('partyDisclaimer').showModal();};
    row.append(name,total,unlicensed,party);$('hosts').append(row);
    if(key===selectedHost&&['party','combo'].includes(selectedHostMetric)) {
      const combinations=new Map();
      for(const listing of listings.filter(item=>hostKey(item)===key&&(item.party_house||overCapacityFlag(item)))) {
        const combo=amenityCombo(listing);if(combo)combinations.set(combo,(combinations.get(combo)||0)+1);
      }
      const comboRow=document.createElement('div');comboRow.className='host-combos';
      const capacityLabel=document.createElement('label');capacityLabel.className='host-capacity-filter';const capacityToggle=document.createElement('input');capacityToggle.type='checkbox';capacityToggle.checked=selectedPartyRequireCapacity;capacityToggle.onchange=()=>{selectedPartyRequireCapacity=capacityToggle.checked;update();};capacityLabel.append(capacityToggle,document.createTextNode('Require over capacity'));comboRow.append(capacityLabel);
      if(!g.items.length){
        const note=document.createElement('p');note.className='host-capacity-note';note.setAttribute('role','status');
        note.textContent='No listings match all current filters. This host and its controls remain selected. Change the combination, occupancy requirement, rental types, or analysis-area filter.';
        comboRow.append(note);
        const comboListings=listings.filter(l=>hostKey(l)===key&&l.point&&(selectedHostMetric!=='combo'||amenityCombo(l)===selectedPartyCombo));
        if($('scopeOnly').checked&&comboListings.length&&comboListings.every(l=>!Spatial.inScope(l,edgeBuffer()))){
          note.textContent='This combination is outside the selected analysis area. The analysis-area filter is hiding its listings.';
          const outsideButton=document.createElement('button');outsideButton.type='button';outsideButton.className='show-outside-host';outsideButton.textContent='Include listings outside analysis area';
          outsideButton.onclick=()=>{$('scopeOnly').checked=false;update();fitVisible();};comboRow.append(outsideButton);
        }
      }
      const largeCapacityLabel=document.createElement('label');largeCapacityLabel.className='host-capacity-filter';const largeCapacityToggle=document.createElement('input');largeCapacityToggle.type='checkbox';largeCapacityToggle.checked=$('includeLargeOverCapacity').checked;largeCapacityToggle.onchange=()=>{$('includeLargeOverCapacity').checked=largeCapacityToggle.checked;update();};largeCapacityLabel.append(largeCapacityToggle,document.createTextNode('Include >5-bedroom over-capacity listings'));comboRow.append(largeCapacityLabel);
      for(const [combo,count] of [...combinations].sort((a,b)=>a[0].localeCompare(b[0]))) {
        const button=document.createElement('button');button.type='button';button.className='host-combo'+(selectedHostMetric==='combo'&&selectedPartyCombo===combo?' selected':'');
        button.innerHTML=`${combo.split('|').map(amenityIconHtml).join(' ')} ${esc(count)}`;
        button.title=`${count} host listing${count===1?'':'s'} with this exact amenity combination, before other filters`;
        button.dataset.combo=combo;
        button.setAttribute('aria-pressed',String(selectedHostMetric==='combo'&&selectedPartyCombo===combo));
        button.onclick=()=>{selectedHost=key;selectedHostMetric='combo';selectedPartyCombo=combo;$('partyOnly').checked=true;update();fitVisible();};
        comboRow.append(button);
      }
      if(combinations.size||selectedHostMetric==='party')$('hosts').append(comboRow);
    }
  }
}
function updateSearch() {
  $('searchResults').replaceChildren();
  if(!$('search').value.trim()) return;
  for(const l of visible.slice(0,6)) {const b=document.createElement('button');b.className='search-result';b.textContent=l.title||l.listing_id;b.onclick=()=>{map.flyTo({center:l.point,zoom:16});showListing(l);};$('searchResults').append(b);}
}
function updateSymbols() {
  for(const marker of emojiMarkers) marker.remove(); emojiMarkers=[];
  $('symbolNote').textContent='';
  // Individual property symbols are disabled in this view; original code retained below.
  return;
  if(!$('symbols').checked) return;
  const bounds=map.getBounds(), selected=[...document.querySelectorAll('.amenity:checked')].map(e=>e.value);
  // DOM symbols only for on-screen points; map circles remain available at all zooms.
  const candidates=visible.filter(l=>(l.party_house||overCapacityFlag(l))&&bounds.contains(l.displayPoint||l.point));
  const show=candidates.slice(0,600);
  if(candidates.length>600) $('symbolNote').textContent='Showing symbols for 600 on-screen listings. Zoom in or filter to see the others.';
  for(const l of show) {
    const amenityKeys=Object.keys(l.amenities).filter(k=>(!selected.length||selected.includes(k))&&(icons[k]||customAmenityIcons[k]));
    const values=[...new Set(['🥳',...amenityKeys])];
    const el=document.createElement('div');el.className='emoji-marker';el.setAttribute('aria-hidden','true');
    values.forEach((icon,i)=>{const s=document.createElement('span');if(icon==='🥳')s.textContent=icon;else if(customAmenityIcons[icon]){const img=document.createElement('img');img.className='amenity-custom-icon marker-icon';img.src=customAmenityIcons[icon];img.alt='';s.append(img);}else s.textContent=icons[icon];const angle=-Math.PI/2+i*2*Math.PI/values.length;s.style.left=`${Math.cos(angle)*32}px`;s.style.top=`${Math.sin(angle)*32}px`;el.append(s);});
    el.style.pointerEvents='auto';el.addEventListener('click',event=>{event.stopPropagation();showListing(l);});
    emojiMarkers.push(new maplibregl.Marker({element:el}).setLngLat(l.displayPoint||l.point).addTo(map));
  }
  $('symbols').parentElement.title=candidates.length>600?'First 600 visible amenity markers shown; zoom in to see the rest.':'Amenity keyword symbols';
}
async function updateAddresses() {
  const request=++addressRequest;
  if(!$('addresses').checked||map.getZoom()<16||!parcelManifest?.available) {sourceData('addresses',collection([]));return;}
  const b=map.getBounds(), keys=[];
  for(let x=Math.floor(b.getWest()*100);x<=Math.floor(b.getEast()*100);x++) for(let y=Math.floor(b.getSouth()*100);y<=Math.floor(b.getNorth()*100);y++) {
    const key=`${x}_${y}`; if(parcelManifest.tiles.includes(key)) keys.push(key);
  }
  try {
    const tiles=await Promise.all(keys.map(key=>{if(!addressCache.has(key))addressCache.set(key,getJSON(`data/parcels/${key}.json`).catch(e=>{addressCache.delete(key);throw e;}));return addressCache.get(key);}));
    if(request===addressRequest) sourceData('addresses',collection(tiles.flatMap(t=>t.features)));
  }catch(e){console.error('Parcel addresses:',e);}
}
function permitDate(value) {
  const date=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return date?`${date[2]}/${date[3]}/${date[1]}`:'Unknown';
}
function permitCard(p, label="") {
  if(typeof label!=="string")label="";
  const adverseStatus=["denied","revoked","suspended"].includes(String(p.status||" ").toLowerCase());
  return `<details class="permit-record"><summary><b>${esc(p.permit_number||'Permit number unavailable')}</b> <span class="badge ${esc(p.status)}" style="background:${adverseStatus?'#dc2626':p.status==='current'?'#22c55e':expiredMajorPermit(p)?'#a855f7':p.status==='expired'?'#facc15':'#e5e7eb'};color:${adverseStatus||expiredMajorPermit(p)?'white':'#111827'}">${esc(p.status)}</span>${label?`<br><span class="small">${esc(label)}</span>`:""}<br><span class="small muted">Issued ${permitDate(p.issued)} → expires ${permitDate(p.expiration)}</span></summary><p>${esc(p.address)}<br>Permit owner/applicant name: ${esc(p.owner||'Unavailable in saved permit data')}<br>Source status: <b>${esc(p.source_status)}</b><br>Parcel: ${esc(p.parcel)}<br>${esc(p.type)}${p.saved_details?.addresses?.length?`<br><b>All addresses in saved city permit details:</b><br>${p.saved_details.addresses.map(esc).join('<br>')}`:''}<br><a href="${esc(/^https?:\/\//.test(p.source_url)?p.source_url:report.sources.permits)}" target="_blank" rel="noopener">Official permit source</a></p></details>`;
}
function permitOrder(a,b) {
  return Number(b.status==='current')-Number(a.status==='current')||String(b.issued||b.expiration||'').localeCompare(String(a.issued||a.expiration||''));
}
function permitCards(records) {
  const properties=new Map();
  for(const p of records){
    const key=p.parcel||p.address||p.id;
    if(!properties.has(key))properties.set(key,[]);
    properties.get(key).push(p);
  }
  return [...properties.values()].map(rows=>`<div class="permit-property"><p class="small"><b>${esc(rows[0].address||'Property address unavailable')}</b>${rows[0].parcel?` · Parcel ${esc(rows[0].parcel)}`:''}</p>${rows.sort(permitOrder).map(permitCard).join('')}</div>`).join('');
}
function detectedPermitList(listing) {
  return Array.isArray(listing?.permit_numbers) ? listing.permit_numbers.filter(Boolean) : [];
}
function actualPermitList(listing) {
  return Array.isArray(listing?.matched_permits) ? listing.matched_permits.map(p => String(p?.permit_number ?? p?.permit ?? p?.id ?? p?.number ?? '').trim()).filter(Boolean) : [];
}
function setupAppearanceAndDisclaimer() {
  let theme='light',dismissed=false;
  try {if(BrowserState.accepted()){theme=localStorage.getItem('stvr-doorman-theme:'+STVR_SCOPE)||'light';dismissed=localStorage.getItem('stvr-doorman-disclaimer-dismissed:'+STVR_SCOPE)==='yes';}} catch {}
  const applyTheme=value=>{document.body.classList.toggle('dark-mode',value==='dark');$('themeToggle').checked=value==='dark';$('themeToggle').setAttribute('aria-pressed',String(value==='dark'));};
  applyTheme(theme);
  $('themeToggle').addEventListener('change',()=>{const value=$('themeToggle').checked?'dark':'light';applyTheme(value);try{if(BrowserState.accepted())localStorage.setItem('stvr-doorman-theme:'+STVR_SCOPE,value);}catch{}});
  const disclaimer=$('firstVisitDisclaimer');
  disclaimer.addEventListener('cancel',event=>event.preventDefault());
  $('dismissFirstVisit').onclick=()=>{try{if(BrowserState.accepted())localStorage.setItem('stvr-doorman-disclaimer-dismissed:'+STVR_SCOPE,'yes');}catch{}disclaimer.close();};
  if(!dismissed)disclaimer.showModal();
}
function setupResponsivePanels() {
  const wrapper=$('mobilePanels'),filters=$('filters'),hosts=document.querySelector('.hosts'),details=hosts.querySelector('details'),toggle=$('toggleFilters');
  let wasMobile=null;
  const sync=()=>{
    const mobile=matchMedia('(max-width: 700px)').matches;
    if(mobile!==wasMobile){
      if(mobile){filters.classList.remove('collapsed');details.open=false;}
      else filters.classList.remove('collapsed');
      wasMobile=mobile;
    }
    wrapper.classList.toggle('panel-expanded',mobile&&(!filters.classList.contains('collapsed')||details.open));
    toggle.textContent=filters.classList.contains('collapsed')?'Show':'Hide';
    toggle.setAttribute('aria-expanded',String(!filters.classList.contains('collapsed')));
  };
  toggle.onclick=()=>{
    if(filters.classList.contains('collapsed')){details.open=false;filters.classList.remove('collapsed');}
    else filters.classList.add('collapsed');
    sync();
  };
  details.addEventListener('toggle',()=>{if(!filters.contains(hosts)&&matchMedia('(max-width: 700px)').matches&&details.open)filters.classList.add('collapsed');sync();});
  window.addEventListener('resize',sync);sync();
}
function showNearbyPermitListings(permit, container) {
  const candidates=listings.filter(listing=>listing.point).map(listing=>({listing,distance_m:distance(permit.point,listing.point)})).filter(item=>item.distance_m<=550).sort((a,b)=>a.distance_m-b.distance_m||String(a.listing.host_name).localeCompare(String(b.listing.host_name)));
  const section=document.createElement('section');section.className='license-match-candidates';
  const heading=document.createElement('h4');heading.textContent=`Nearby Airbnb listings (${candidates.length})`;section.append(heading);
  const note=document.createElement('p');note.className='small muted';note.textContent='Within 550 m of this permit location. Proximity is a candidate for review, not confirmation of a license match.';section.append(note);
  if(!candidates.length){const empty=document.createElement('p');empty.className='small muted';empty.textContent='No mapped listings are within 550 m.';section.append(empty);}
  for(const {listing,distance_m} of candidates){
    const button=document.createElement('button');button.type='button';button.className='license-listing-candidate';
    const title=document.createElement('strong');title.textContent=listing.title||`Listing ${listing.listing_id}`;
    const details=document.createElement('span');details.textContent=`Host: ${listing.host_name||'Unknown'} · ${distance_m.toFixed(1)} m${listing.host_user_id?` · Host ID ${listing.host_user_id}`:''}`;
    button.append(title,details);button.onclick=()=>{popup?.remove();popup=null;showListing(listing,permit);};section.append(button);
  }
  container.replaceChildren(section);
}
const matchLabels={license_number:'License number',owner_name:'Full owner / host name',owner_first_name:'Owner / host first name',owner_nickname:'Owner / host nickname',permit_owner_name:'Full permit owner / host name',permit_owner_first_name:'Permit owner / host first name',permit_owner_nickname:'Permit owner / host nickname',distance:'Distance only'};
function associationOrder(a,b){const rank=m=>m.type==='license_number'?0:m.type==='distance'?2:1;return rank(a)-rank(b)||(a.distance_m??Infinity)-(b.distance_m??Infinity)||String(a.listing_id||a.parcel||'').localeCompare(String(b.listing_id||b.parcel||''));}
function hotelReportsHtml(listing){return (listing.hotel_reports||[]).map(r=>`<p><b>${r.source==='user_submitted'?'User submitted hotel':'Manually marked hotel'}</b>${r.hotel_name?` · ${esc(r.hotel_name)}`:''}${r.address?`<br>User-submitted address (not verified): ${esc(r.address)}`:''}${/^https?:\/\//i.test(r.proof_url||'')?`<br><a href="${esc(r.proof_url)}" target="_blank" rel="noopener">Hotel proof ↗</a>`:''}${/^https?:\/\//i.test(r.source_url||'')?`<br><a href="${esc(r.source_url)}" target="_blank" rel="noopener">Public submission source ↗</a>`:''}</p>`).join('');}
function matchBadge(m){const color=m.type==='license_number'?'#166534':m.type==='distance'?'#475569':m.type.includes('nickname')?'#a16207':m.type.includes('first_name')?'#a16207':'#1d4ed8';return `<span style="background:${color};color:white;padding:2px 5px;border-radius:4px">${esc(matchLabels[m.type]||m.type)}</span>`;}
let activeCardState=null,matchPinned=false,matchContext=null,matchRows=[];
function exitMatchView(){matchPinned=false;matchContext=null;matchRows=[];clearCandidatePreview(true);sourceData('name-matches',collection([]));document.querySelectorAll('[data-exit-matches]').forEach(e=>e.remove());BrowserState.schedule();}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&matchPinned){e.preventDefault();exitMatchView();}});
function resetMatchInteraction(){matchPinned=false;matchContext=null;matchRows=[];activeCardState=null;clearCandidatePreview(true);sourceData('name-matches',collection([]));BrowserState.schedule();}
function pinCandidate(listing,row,fit=true){
  row.type=row.type||(listing.preliminary_matches||[]).find(m=>normalizeParcel(m.parcel)===normalizeParcel(row.parcel))?.type||'distance';
  matchPinned=true;matchContext={listing_id:listing.listing_id,parcel:row.parcel};
  dockCandidateCard();
  const card=previewCard();if(card&&!card.querySelector('[data-exit-matches]')){const b=document.createElement('button');b.dataset.exitMatches='';b.textContent='Exit property exploration (Esc)';b.onclick=exitMatchView;(card.querySelector('.maplibregl-popup-content')||card).append(b);}
  previewCandidate(listing,row,fit);BrowserState.schedule();
}
function colorNameMatches(listing,rows){
  matchRows=rows;
  const features=rows.filter(r=>r.type.includes('owner_')&&r.geometry).map(r=>feature(r.geometry,{parcel:r.parcel,color:r.type.includes('nickname')?'#eab308':r.type.includes('first_name')?'#a16207':'#1d4ed8'}));
  sourceData('name-matches',collection(features));
}
function collapseMapPanels(){
  $('filters').classList.add('collapsed');document.querySelector('.hosts details').open=false;
  $('mobilePanels').classList.remove('panel-expanded');$('toggleFilters').textContent='Show';$('toggleFilters').setAttribute('aria-expanded','false');
}
let previewSlideUntil=0,previewFitTimer;
function previewCard(){return $('reportDialog').open?$('reportDialog'):popup?.getElement();}
function dockCandidateCard(card=previewCard()){
  if(!card||window.innerWidth<1000||card.classList.contains('preview-docked'))return;
  previewSlideUntil=Date.now()+400;
  card.classList.add('preview-docked');
}
document.addEventListener('toggle',event=>{
  const section=event.target;
  if(section.tagName!=='DETAILS'||!section.open)return;
  if(section.querySelector('[data-property-associations],[data-associations]')){
    dockCandidateCard(section.closest('.map-card-centered'));
  }
},true);

function candidateViewPadding(){
  const viewport=map.getCanvas().getBoundingClientRect(),margin=20;
  const card=previewCard(),content=card?.querySelector('.maplibregl-popup-content')||card;
  const overlays=[content,...document.querySelectorAll('#filters,.hosts,.maplibregl-ctrl-top-right,.maplibregl-ctrl-bottom-right')].filter(Boolean);
  let spaces=[{left:margin,right:viewport.width-margin,top:margin,bottom:viewport.height-margin}];
  for(const element of overlays){
    const style=getComputedStyle(element),rect=element.getBoundingClientRect();
    if(style.display==='none'||style.visibility==='hidden'||!rect.width||!rect.height)continue;
    const obstacle={left:rect.left-viewport.left-margin,right:rect.right-viewport.left+margin,top:rect.top-viewport.top-margin,bottom:rect.bottom-viewport.top+margin};
    spaces=spaces.flatMap(space=>{
      if(obstacle.right<=space.left||obstacle.left>=space.right||obstacle.bottom<=space.top||obstacle.top>=space.bottom)return [space];
      return [
        {...space,right:Math.min(space.right,obstacle.left)},
        {...space,left:Math.max(space.left,obstacle.right)},
        {...space,bottom:Math.min(space.bottom,obstacle.top)},
        {...space,top:Math.max(space.top,obstacle.bottom)}
      ].filter(s=>s.right-s.left>40&&s.bottom-s.top>40);
    });
  }
  const best=spaces.sort((a,b)=>(b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top))[0];
  return best?{left:best.left,right:viewport.width-best.right,top:best.top,bottom:viewport.height-best.bottom}:{left:margin,right:margin,top:margin,bottom:margin};
}
async function showProperty(property, position){
  if(matchPinned&&matchContext&&!property.parcel_first){const listing=listings.find(l=>l.listing_id===matchContext.listing_id);if(listing){const row=matchRows.find(r=>normalizeParcel(r.parcel)===normalizeParcel(property.parcel))||{...property,point:Array.isArray(position)?position:[position.lng,position.lat],type:'distance'};pinCandidate(listing,row);return;}}
  resetMatchInteraction();collapseMapPanels();
  const nextCardState={type:'property',property:{parcel:property.parcel,address:property.address,owner:property.owner,id:property.id,parcel_first:property.parcel_first},position:Array.isArray(position)?position:[position.lng,position.lat]};
  const canonical=permitParcels?.features.find(f=>normalizeParcel(f.properties.parcel)===normalizeParcel(property.parcel))?.properties||property;
  const parcel=String(canonical.parcel||''), records=permits.filter(p=>parcel?(p.parcels||[p.parcel]).some(v=>normalizeParcel(v)===normalizeParcel(parcel)):p.id===property.id);
  const primary=records.find(p=>p.status==='current')||records[0];
  const parcelFirst=property.parcel_first===true;
  const parcelDetails=`<details ${parcelFirst?'open':''}><summary>Parcel details${parcelFirst?' · owner/name association ?':''}</summary><p>${esc(canonical.address)}<br>Parcel: ${esc(parcel)}<br>Property owner: ${esc(canonical.owner||'Unavailable')}</p></details>`;
  const licenseDetails=records.length?`<details><summary>License details (${records.length})</summary>${permitCards(records)}</details>`:'';
  popup?.remove();const current=new maplibregl.Popup({closeOnClick:false,maxWidth:'400px',className:'listing-popup-centered map-card-centered'}).setLngLat(position).setHTML(`<h3>${parcelFirst?'Parcel record · uncertain owner/name match ?':primary?'License record':'Property record'}</h3><p><b>${esc(primary?.address||canonical.address)}</b>${primary&&!parcelFirst?`<br><span class="badge ${esc(primary.status)}">${esc(primary.status)}</span> · ${esc(primary.permit_number||'Permit number unavailable')}<br>${esc(primary.type)}`:''}</p>${parcelFirst?parcelDetails+licenseDetails:licenseDetails+parcelDetails}${records.length&&!numberMode()?`<details><summary>Possibly associated listings</summary><p class="small muted">Auto matched, not verified. Name matches first, then distance-only candidates, nearest first. All candidates require verification.</p><div data-associations style="max-height:260px;overflow-y:auto">Loading…</div></details>`:''}<details><summary>Forms</summary><button type="button" data-complaint>Complaint form (with evidence)</button></details>`).addTo(map);popup=current;activeCardState=nextCardState;current.on('close',resetMatchInteraction);

  bindComplaintButton(current.getElement(),canonical.address,primary?.point||canonical.point||(Array.isArray(position)?position:[position.lng,position.lat]),'');
  const container=current.getElement().querySelector('[data-associations]');
  if(!container)return;
  try{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parcel)),key=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,2);
    const manifest=await getJSON('data/property_matches/manifest.json');
    const rows=manifest.buckets.includes(key)?(await getJSON(`data/property_matches/${key}.json`))[parcel]||[]:[];
    container.replaceChildren();const seen=new Set();
    for(const row of rows.sort(associationOrder)){if(seen.has(row.listing_id))continue;seen.add(row.listing_id);const listing=listings.find(l=>l.listing_id===row.listing_id);if(!listing)continue;const button=document.createElement('button');button.className='license-listing-candidate';button.innerHTML=`${matchBadge(row)}<strong>${esc(listing.title||listing.listing_id)}</strong><span>Host: ${esc(listing.host_name||'Unknown')} · ${row.distance_m===null?'Distance unavailable':row.distance_m.toFixed(1)+' m to parcel boundary'}</span>`;button.onclick=()=>showListing(listing);container.append(button);if(listing.hotel_reports?.length){const evidence=document.createElement('div');evidence.innerHTML=hotelReportsHtml(listing);container.append(evidence);}}
    if(!seen.size)container.textContent='No candidates found.';
  }catch(e){container.textContent=`Could not load candidates: ${e.message}`;}
}
function candidateBadges(listing,row){
  const matches=(listing.preliminary_matches||[]).filter(m=>normalizeParcel(m.parcel)===normalizeParcel(row.parcel)).sort(associationOrder);
  const match=matches[0]||{type:'distance'};
  const parcel=normalizeParcel(row.parcel),historical=anyPermitParcels.has(parcel),current=currentPermitParcels.has(parcel);
  return `${matchBadge(match)} <span style="background:${current?'#166534':historical?'#a16207':'#475569'};color:white;padding:2px 5px;border-radius:4px">${current?'Current permit on parcel':historical?'expired permit':'No current permit record on parcel'}</span>`;
}
function clearCandidatePreview(force=false){if(matchPinned&&!force)return;clearTimeout(previewFitTimer);document.querySelectorAll('.preview-docked').forEach(el=>el.classList.remove('preview-docked'));sourceData('candidate-preview',collection([]));sourceData('candidate-connections',collection([]));}
function previewCandidate(listing,row,fit=true){
  const target=row.preview_point||row.point;
  if(!listing.point||!target)return;
  const card=previewCard();if(card&&window.innerWidth>=1000&&!card.classList.contains('preview-docked')){previewSlideUntil=Date.now()+400;card.classList.add('preview-docked');}
  const geom=(matchPinned&&row.type==='distance'?null:row.geometry)||{type:'Point',coordinates:target};
  const highlights=[feature({type:'Point',coordinates:target},{role:'property'}),feature({type:'Point',coordinates:listing.point},{role:'airbnb'})];
  if(geom.type!=='Point')highlights.unshift(feature(geom,{parcel:row.parcel}));
  sourceData('candidate-preview',collection(highlights));
  sourceData('candidate-connections',collection(distance(listing.point,target)<=550?[feature({type:'LineString',coordinates:[listing.point,target]},{uncertain:true,method:row.type})]:[]));
  const bounds=new maplibregl.LngLatBounds(listing.point,listing.point);bounds.extend(target);
  const visit=coords=>{if(typeof coords[0]==='number')bounds.extend(coords);else coords.forEach(visit);};if(row.geometry?.coordinates)visit(row.geometry.coordinates);
  if(!fit)return;
  clearTimeout(previewFitTimer);previewFitTimer=setTimeout(()=>map.fitBounds(bounds,{padding:candidateViewPadding(),maxZoom:map.getMaxZoom(),duration:250}),window.innerWidth>=1000?280:0);
}
function bindCandidatePreview(button,listing,row){button.onmouseenter=button.onfocus=()=>pinCandidate(listing,row);button.onmouseleave=()=>{};button.onblur=()=>{};}
async function renderListingAssociations(listing,container){
  if(numberMode()){renderFallbackAssociations(listing,container);return;}
  const rows=[...(listing.preliminary_matches||[])];container.textContent='Loading nearby properties…';
  try{for(const p of await Reporting.loadCandidates(listing)){const existing=rows.filter(m=>normalizeParcel(m.parcel)===normalizeParcel(p.parcel));if(existing.length)existing.forEach(m=>{m.point=p.point;m.geometry=p.geometry;});else rows.push({...p,type:'distance'});}}catch(e){container.textContent=`Nearby properties unavailable: ${e.message}`;return;}
  container.replaceChildren();for(const row of rows.sort(associationOrder)){const button=document.createElement('button');button.className='license-listing-candidate';button.innerHTML=`${candidateBadges(listing,row)}<strong>${esc(row.address)}</strong><span>Owner: ${esc(row.owner||'Unavailable')} · ${row.distance_m==null?'Distance unavailable':row.distance_m.toFixed(1)+' m to parcel boundary'}</span>`;bindCandidatePreview(button,listing,row);button.onclick=()=>{pinCandidate(listing,row);colorNameMatches(listing,rows);};container.append(button);}for(const button of container.querySelectorAll('button')){const enter=button.onmouseenter;button.onmouseenter=button.onfocus=()=>{enter();colorNameMatches(listing,rows);};}if(!rows.length)container.textContent='No candidates found.';
}
function needsParcelFallback(listing){return !listing.user_address&& permitParcelLinks([listing]).length===0;}
function parcelMatchRadius(){return Math.min(550,Math.max(160,Number($('parcelMatchRadius').value)||160));}
function renderFallbackAssociations(listing,container){
  if(!container)return;
  const radiusLabel=container.parentElement.querySelector('[data-parcel-radius]');if(radiusLabel)radiusLabel.textContent=parcelMatchRadius();
  let lookup=fallbackParcelLookups.get(listing.listing_id);
  if(!lookup){
    lookup={pending:true,data:null,error:null};fallbackParcelLookups.set(listing.listing_id,lookup);
    ParcelCandidates.load(listing).then(data=>{lookup.pending=false;lookup.data=data;if(selectedListing===listing&&container.isConnected)renderFallbackAssociations(listing,container);}).catch(error=>{lookup.pending=false;lookup.error=error.message;if(selectedListing===listing&&container.isConnected)renderFallbackAssociations(listing,container);});
  }
  const geometry=collection([...(parcelMatchingData?.features||[]),...(lookup.data?.features||[])]);
  const rows=PermitProperties.candidates(listing,geometry,nameMatchingData,parcelMatchRadius());
  const section=container.closest('details');
  if(section){
    const summary=section.querySelector(':scope > summary');
    if(summary&&!summary.dataset.expansionBound){
      summary.dataset.expansionBound='true';
      summary.addEventListener('click',()=>{section.dataset.expansionChosen='true';});
    }
    if(!section.dataset.expansionChosen){
      const autoRadius=Math.max(155,Number(listing.privacy_radius_meters)||0);
      const closeNames=rows.filter(row=>row.type!=='distance'&&row.distance_m<=autoRadius);
      section.open=closeNames.length>=1&&closeNames.length<=2;
    }
  }
  matchRows=rows;container.replaceChildren();
  for(const row of rows){
    const button=document.createElement('button');button.className='license-listing-candidate';
    button.innerHTML=`<b>Parcel details</b><br>${esc(row.address)}<br>Parcel: ${esc(row.source_parcel||row.parcel)}<br>Owner: ${esc(row.owner||'Unknown')}<br>${matchBadge(row)} <b>?</b> · ${row.distance_m.toFixed(1)} m${row.within_privacy_radius?' · inside Airbnb privacy radius':''}`;
    button.onclick=()=>{pinCandidate(listing,row);colorNameMatches(listing,rows);};container.append(button);
    const relatedPermits=permits.filter(p=>(p.parcels||[p.parcel]).some(id=>[row.parcel,row.source_parcel].filter(Boolean).map(normalizeParcel).includes(normalizeParcel(id)))).sort((a,b)=>(b.status==='current')-(a.status==='current'));
    if(relatedPermits.length){const details=document.createElement('details');details.innerHTML=`<summary>Permits at this candidate parcel (${relatedPermits.length}) ?</summary><p class="small muted">These belong to the candidate parcel; they are not direct matches to the listing’s displayed registration.</p>${permitCards(relatedPermits)}`;container.append(details);}
    if(row.type!=='distance'){
      const open=document.createElement('button');open.className='license-listing-candidate';open.textContent=`Open parcel details first · ${row.type==='owner_nickname'?'nickname':'name'} match ?`;
      open.onclick=()=>showProperty({...row,parcel_first:true},row.point);container.append(open);
    }
  }
  if(!rows.length)container.textContent=lookup.pending?'Checking nearby city parcel owners…':lookup.error?'City lookup unavailable; no candidates in saved coverage.':'No owner/name candidates within 550 m or distance candidates within the selected radius.';
  if(lookup.pending&&rows.length){const note=document.createElement('p');note.className='small muted';note.textContent='Checking additional nearby city parcel owners…';container.append(note);}
  const nicknameRows=rows.filter(row=>row.type!=='distance');
  sourceData('candidate-connections',collection(nicknameRows.map(row=>feature({type:'LineString',coordinates:[listing.displayPoint||listing.point,row.point]},{uncertain:true,method:row.type}))));
}
function showListing(l, nearbyPermit=null) {
  resetMatchInteraction();const nextCardState={type:'listing',listing_id:l.listing_id};
  collapseMapPanels();
  if(matchMedia('(max-width: 700px)').matches){
    const filters=$('filters'),hosts=document.querySelector('.hosts'),toggle=$('toggleFilters');
    filters.classList.add('collapsed');hosts.querySelector('details').open=false;
    $('mobilePanels').classList.remove('panel-expanded');
    toggle.textContent='Show';toggle.setAttribute('aria-expanded','false');
  }
  popup?.remove();
  selectedListing=l;UserAddresses.select(l);updatePrivacy();
  const privacy=l.privacy_radius_meters===null?'Unknown':`${l.privacy_radius_meters} m`;
  const listingSource=`<a href="${esc(l.url)}" target="_blank" rel="noopener">Airbnb.com listing</a>`;
  let html=`<h3>${esc(l.title||'Airbnb listing')}</h3>${numberMode()?'':`<span class="badge ${esc(communityStatus(l))}">${esc(communityStatusNames[communityStatus(l)])}</span>`}<p><a href="${esc(l.url)}" target="_blank" rel="noopener">Open Airbnb listing ↗</a></p><p><b>Host:</b> <button type="button" class="popup-host-select" data-select-host>${esc(l.host_name||'Unknown')}</button><br><b>Guests:</b> ${esc(l.guests??'Unknown')} · <b>Bedrooms:</b> ${esc(l.bedrooms??'Unknown')}<br><b>Capacity:</b> ${esc(l.allowed_guests??"Unknown (bedrooms missing)")} guests${overCapacityFlag(l)?`<br><b>Over capacity:</b> <a href="https://clerk.kcmo.gov/LegislationDetail.aspx?FullText=1&GUID=1BE0BD45-990E-423A-958E-1CA02BD2E626&ID=7726282&Options=&Search=" target="_blank" rel="noopener">${esc(l.over_capacity)} guests · Kansas City rules ↗</a>`:''}<br><b>Airbnb privacy radius:</b> ${esc(privacy)}</p>`;
  html+=`<p><button type="button" data-copy-privacy-streets>Copy streets, cities &amp; ZIPs in privacy radius</button><br><span class="small muted" data-privacy-street-status aria-live="polite">Uses the reported Airbnb radius and saved street GIS; no house numbers are copied.</span></p>`;
  const permitAddresses=[...new Set((l.matched_permits||[]).map(p=>p.address).filter(Boolean))];
  if(l.user_address)html+=`<p><b>Address confirmed by user:</b> ${esc(l.user_address.address)}<br>Parcel ${esc(l.user_address.parcel)} · <a href="${esc(l.user_address.source)}" target="_blank" rel="noopener">GIS source</a><br><span class="small muted">Pin placed inside this parcel. This address correction does not establish permit status.</span></p>`;
  else if(permitAddresses.length)html+=`<p><b>Address from matched permit number:</b> ${permitAddresses.map(esc).join('; ')}<br><span class="small muted">City permit record; specific listing / dwelling unit remains unverified.</span></p>`;
  const plotAddress=listingPlotAddresses.records[String(l.listing_id)];
  if(!l.user_address&&!permitAddresses.length&&plotAddress&&l.point&&plotAddress.point[0]===l.point[0]&&plotAddress.point[1]===l.point[1]&&plotAddress.parcels.some(p=>p.address)){
    html+=`<p data-underlying-plot><b>${plotAddress.parcels.length===1?'Approximate location (GIS plot address)':'Approximate location (overlapping GIS plots)'}:</b><br>${plotAddress.parcels.map(p=>`${esc(p.address||'Address unavailable')} · Parcel ${esc(p.parcel)}`).join('<br>')}<br><span class="small muted">Based on the saved map coordinate, not a verified Airbnb street address. A reported 0 m privacy radius does not confirm coordinate accuracy.</span></p>`;
  }
  else if(!l.user_address&&!permitAddresses.length)html+=`<p><b>Approximate location:</b> ${esc(l.approximate_address||l.location_name||'Street address unavailable')}</p>`;
  if(l.hotel_reports?.length)html+=`<p><b style="color:#c2410c">${l.hotel_source==='user_submitted'?'User submitted hotel':'Manually marked hotel'}</b></p><details><summary>Hotel reports and proof</summary>${hotelReportsHtml(l)}</details>`;
  if(l.not_hotel_tips?.length)html+=`<p><b>User-submitted tip: not a hotel</b> · Not verified</p><details><summary>Not-a-hotel tips</summary>${l.not_hotel_tips.map(t=>`<p>Reported address (not verified): ${esc(t.address||'Not provided')}<br><a href="${esc(t.source_url)}" target="_blank" rel="noopener">Public submission source ↗</a></p>`).join('')}</details>`;
  const detectedCount=Number(l.detected_permit_count??detectedPermitList(l).length);
  const dualCapacity=Boolean(l.dual_license_capacity)||detectedCount===2;
  const titleMentionsTwo=/\btwo\b/i.test(l.title||'');
  if(overCapacityFlag(l)||dualCapacity)html+=`<p class="small muted" data-capacity-explanation><b>Capacity estimate:</b> ${dualCapacity?'Two-unit screening: min(2 × total bedrooms + 2, 16); units are unverified.':'Per dwelling unit: min(2 × bedrooms + 1, 8), using advertised bedrooms.'} <a href="about_data.html" target="_blank" rel="noopener">Data and occupancy rules ↗</a></p>`;
  if(dualCapacity||titleMentionsTwo)html+=`<details><summary>Capacity estimate caveat</summary><p class="small spatial-warning"><b>Capacity estimate caveat:</b> ${dualCapacity?'Two permit numbers were detected in listing text; the estimate treats them as two units, splits bedrooms between units, and allows up to 8 guests per unit.':'The title mentions “two”, which may refer to multiple units.'} This is an unverified screening assumption, not confirmation of separate licensed units. Please verify the actual unit and bedroom configuration.</p></details>`;
  if(Number(l.bedrooms)>5&&(Number(l.over_capacity)||0)>0)html+=`<p class="small muted">This listing has more than 5 bedrooms. Its over-capacity flag is excluded from filters by default; enable “Include listings with over 5 bedrooms in over-capacity results” to include it.</p>`;
  /* Disabled for the compact listing card: duplicate detected and matched permit summaries. Remove this comment to restore.
  if(detectedPermitList(l).length) html+=`<p><b>Detected listing permit numbers:</b> ${detectedPermitList(l).map(esc).join(', ')}<br><span class="small muted">These are text matches from the listing and are not the canonical license list.</span></p>`;
  if(actualPermitList(l).length) html+=`<p><b>Actual matched permit records:</b> ${actualPermitList(l).map(esc).join(', ')}</p>`;
  */
  if(!numberMode()){
  const currentIds=new Set(permits.filter(p=>p.status==='current').map(p=>p.id));
  const proximityStatus=autoMatchStatus(l);
  if(proximityStatus==='nearby')html+='<p><b>Near a current permit · likely licensed</b><br><span class="small muted">Geographic proximity only; not a host-name match or verified license.</span></p>';
  const nameCandidate=(l.preliminary_matches||[]).find(m=>m.type!=='distance'&&[m.permit_id,...(m.permit_ids||[])].some(id=>currentIds.has(id)));
  html+=nameCandidate?`<p><b>Preliminary permitted-property match:</b><br>${matchBadge(nameCandidate)} ${esc(nameCandidate.address)}<br><span class="small muted">Auto matched, not verified.</span></p>`:`<p><b>Nearest permitted parcel:</b> ${typeof l.nearest_licensed_parcel_m==='number'?l.nearest_licensed_parcel_m.toFixed(1)+' m':'Unknown'}</p>`;
  html+=`<details><summary>Property / license candidates</summary><p class="small muted">Auto matched, not verified. Name matches first, then distance-only candidates, nearest first within each group. Candidates require later verification.</p><div data-property-associations style="max-height:240px;overflow-y:auto"></div></details>`;
  if(nearbyPermit)html+=`<details><summary>Nearby permit for review</summary><p class="small muted">Selected from permit locations within 550 m. This is not a confirmed match.</p>${permitCard(nearbyPermit)}</details>`;
  }
  const overlap=numberMode()?null:Spatial.overlap(l,leeway(),parcelTolerance()), effective=numberMode()?null:Spatial.effectiveRadius(l,leeway());
  if(l.likely_hotel)html+=`<details><summary>Hotel screening evidence</summary><p class="hotel-notice"><b>Likely hotel / resort</b> · Excluded from potentially unlicensed counts.<br>${(l.hotel_evidence||[]).map(e=>esc(e.field)+': '+esc(e.evidence)).join('<br>')}</p></details>`;
  const spatialText=numberMode()?(l.cancelled_permit_at_permitted_address?`Valid · Current permit at the same property: ${(l.property_permits||[]).filter(p=>p.status==='current').map(p=>p.permit_number).join(', ')}. Permit discrepancy: the listing cites ${(l.matched_permits||[]).map(p=>p.permit_number).join(', ')}, which was cancelled` :l.noncurrent_permit_at_permitted_address?(l.registration_class==='expired'?'Likely permitted · Listed permit expired, property permit renewed: the listing contains an expired permit, but a new current permit was issued for the same property. The specific listing / dwelling unit has not been verified':`Current permit at the same property · The listing cites a ${[...new Set(l.matched_permits.map(p=>p.status))].join(' / ')} permit. Current property permit: ${(l.property_permits||[]).filter(p=>p.status==='current').map(p=>p.permit_number).join(', ')}. The listing’s specific dwelling unit is not verified`):l.likely_unlicensed_number===true?`⚠️ Likely unlicensed: ${({expired:'registration number belongs to an expired permit',other:'registration number matches a non-current permit',unmatched:'registration number is not on the city list',none:'no registration number shown in the saved listing'})[l.registration_class]||'no current registration'}`:potentiallyLicensed(l)?'Potentially licensed: permit does not show up in license list (CompassKC); not verified':l.likely_unlicensed_number===false?'Registration number matches the CompassKC permit list':`Not assessed (${l.registration_class||'no saved text'})`)+(l.registration_text?` · Listed registration: ${l.registration_text}`:''):l.likely_hotel?'Likely hotel: excluded from potentially unlicensed screening':!spatial.available?'Spatial data unavailable':!Spatial.inScope(l,edgeBuffer())?'Outside the selected analysis area':overlap===null?'Unknown: privacy radius or parcel geometry missing':overlap?'Privacy circle reaches a green permitted parcel':'⚠️ Likely unlicensed location: privacy circle does not reach any current-permit parcel';
  const adversePermits=l.matched_permits.filter(p=>['denied','revoked','suspended'].includes(String(p.status||'').toLowerCase())).filter(p=>{
    const adverseDate=Date.parse(p.saved_details?.finalized||p.finalized||p.issued||p.applied||'');
    return !(l.property_permits||[]).some(current=>current.status==='current'
      &&p.parcel&&normalizeParcel(current.parcel)===normalizeParcel(p.parcel)
      &&Number.isFinite(adverseDate)&&Date.parse(current.issued)>adverseDate);
  });
  const adverseWarning=adversePermits.length?`<p style="border-left:4px solid #dc2626;background:rgba(220,38,38,.12);padding:8px"><b style="color:#dc2626">⚠️ Likely unlicensed: ${adversePermits.map(p=>`${esc(p.permit_number)}: ${esc(p.status)}`).join('; ')}</b><br>No later-issued current permit is recorded on the same parcel. See permit details below.</p>`:'';
  const connectedPermitMatch=l.matched_permits.length>0&&!needsParcelFallback(l);
  if(numberMode()&&connectedPermitMatch&&adverseWarning)html+=adverseWarning;
  if(numberMode()&&!connectedPermitMatch)html+=`<details open><summary>Registration-number screening</summary>${adverseWarning||`<p>${esc(spatialText)}</p>`}<p class="small muted">Registration source: ${listingSource}</p><p class="small muted">CompassKC supplies permit addresses and parcel identifiers. Listing registration screening uses permit numbers; green plots identify parcels linked to current permits.</p></details>`;
  else if(!numberMode())html+=`<details><summary>Parcel-overlap screening</summary><p class="${likelyUnlicensed(l)?'spatial-warning':'small'}"><b>Parcel-overlap screening:</b> ${esc(spatialText)}<br>Screening radius with +${leeway()}% leeway: ${effective===null?'Unknown':effective.toFixed(1)+' m'}<br>Extra parcel tolerance: ${parcelTolerance().toFixed(2)} m${parcelTolerance()?' (10 yards)':''}<br>Nearest permitted parcel: ${typeof l.nearest_licensed_parcel_m==='number'?l.nearest_licensed_parcel_m.toFixed(1)+' m':'Unknown'}<br><span class="small muted">${l.privacy_radius_meters>0?'The map circle uses the radius provided with this Airbnb listing.':'The selected map circle is a 15 m display fallback; it is not an Airbnb-provided radius and does not change screening.'} This geographic screen does not verify license status.</span></p></details>`;
  const locationConflicts=permitParcelLinks([l],true).filter(f=>f.properties.location_conflict);
  if(locationConflicts.length) html+=`<p class="spatial-warning"><b>Listing / permit location discrepancy</b><br>${locationConflicts.map(f=>`${esc(f.properties.permit_number)}: ${(f.properties.distance_m/1000).toFixed(2)} km from the approximate listing location`).join('<br>')}<br><span class="small muted">The number matches the saved listing text, but the locations disagree. Connections longer than 550 m are errors and are not drawn; this does not verify the listing’s address or authorization.</span></p>`;
  if(l.conflicting_permit_parcels?.length) html+=`<details><summary>Other or conflicting city parcel addresses</summary><p class="small muted">These parcel addresses differ from the primary permit address. City details may list multiple locations; secondary or conflicting addresses are excluded from automatic property connections pending review.</p>${l.conflicting_permit_parcels.map(p=>`<p>${esc(p.permit_number)}: ${esc(p.permit_address)}<br>Parcel ${esc(p.parcel)}: ${esc(p.parcel_address)}</p>`).join('')}</details>`;
  if(l.ambiguous_permit_candidates?.length) html+=`<details><summary>Abbreviated permit number is ambiguous</summary><p class="small muted">The listing omits the CD or NSD prefix. Multiple city permits share that number; no property connection is inferred from it.</p>${permitCards(l.ambiguous_permit_candidates)}</details>`;
  /* Disabled for the compact listing card: separate full property permit history. Remove this comment to restore.
  if(l.property_permits?.length) html+=`<details><summary>All permits at the matched property (${l.property_permits.length})</summary><p class="small muted">Associated by the city parcel identifier. A property permit may cover a different dwelling unit; association does not verify this listing’s authorization.</p>${permitCards(l.property_permits)}</details>`;
  */
  const recoveredProperties=propertyLocationGeometry().features.filter(f=>f.properties.match_basis==='exact_saved_permit_address'&&(l.matched_property_parcels||[]).includes(normalizeParcel(f.properties.parcel)));
  if(recoveredProperties.length)html+=`<p class="small muted"><b>Uncertain address-based parcel recovery ?</b><br>${recoveredProperties.map(f=>`Saved permit parcel ${esc(f.properties.parcel)}; current city parcel ${esc(f.properties.source_parcel)} at the same street address`).join('<br>')}. Different parcel identifiers require review. The two yellow ? lines represent the saved permit address and the current city parcel address at the same mapped location; they do not establish two separate properties.</p>`;
  if(l.permit_match_methods?.length)html+=`<p class="small muted"><b>Uncertain abbreviated permit match ?</b><br>Resolved a missing prefix using a unique same-number city permit less than 550 m away. This is provisional.</p>`;
  if(numberMode()&&needsParcelFallback(l))html+=`<details data-parcel-candidates><summary>Nearby parcel candidates ?</summary><p class="small muted">Used when no matched permit has a usable location within 550 m; distant number matches remain listed as conflicting evidence. Up to five owner/name candidates within 550 m, prioritizing the Airbnb privacy radius. Distance-only radius <span data-parcel-radius>${parcelMatchRadius()}</span> m. Nearby city parcel owners are checked automatically; saved data is used if the city lookup is unavailable. Nicknames use owner names, never Assigned To staff. Name and distance associations do not verify ownership or licensing.</p><div data-property-associations></div></details>`;
  // Compact permit match: each directly matched record once, with related history nested.
  if(l.matched_permits.length){
    const directIds=new Set(l.matched_permits.map(p=>p.id));
    const all=[...new Map([...(l.property_permits||[]),...l.matched_permits].map(p=>[p.id,p])).values()].sort(permitOrder);
    const pertinent=all.filter(p=>p.status==='current'||directIds.has(p.id));
    const history=all.filter(p=>!pertinent.includes(p));
    const first=pertinent[0];
    html+='<details open><summary>Matched permit-number records</summary>'
      +`<p class="small"><b>${esc(first.address||'Property address unavailable')}</b>${first.parcel?` · Parcel ${esc(first.parcel)}`:''}</p>`
      +pertinent.map(p=>permitCard(p,directIds.has(p.id)?`Listed registration: ${l.registration_text||p.permit_number}`:'Current property permit · not the number listed on Airbnb')).join('')
      +(l.noncurrent_permit_at_permitted_address?`<p class="small muted">${l.cancelled_permit_at_permitted_address?'Valid · Permit discrepancy: listed permit was cancelled; current property permit shown above.':'Likely permitted · Listed permit expired, property permit renewed.'} The specific listing / dwelling unit is not verified.</p>`:'')
      +(history.length?`<details><summary>Other permits at this property (${history.length})</summary>${history.map(permitCard).join('')}</details>`:'')+'</details>';
  }
  else html+='<details><summary>Permit-number matching</summary><p class="small muted">No direct permit-number match. This does not establish whether a license exists at this address.</p></details>';
  const nicknameEvidence=permitParcelLinks([l]).filter(f=>['owner_nickname','permit_owner_nickname'].includes(f.properties.method));
  for(const evidence of nicknameEvidence){
    const row=evidence.properties;
    html+=row.name_source==='parcel'
      ?`<details open><summary>Parcel nickname match ?</summary><p><b>Parcel details</b><br>${esc(row.parcel_address)}<br>Parcel: ${esc(row.parcel)}<br>Property owner: ${esc(row.matched_name)}<br>Host nickname: ${esc(row.host_name)} · ${row.distance_m.toFixed(1)} m</p><p class="small muted">The nickname matches the city parcel owner name, not a name supplied on the permit. This is an uncertain association.</p></details>`
      :`<details open><summary>Permit nickname match ?</summary><p>Permit: ${esc(row.permit_number)}<br>Permit owner/applicant name: ${esc(row.matched_name)}<br>Host nickname: ${esc(row.host_name)} · ${row.distance_m.toFixed(1)} m</p><p class="small muted">The nickname matches the saved permit owner name. This is an uncertain association.</p></details>`;
  }

  /* Disabled for the compact listing card: party keywords, permit-number evidence, lower capacity rules, forms and corrections. Remove this comment to restore.
  if(l.party_house) html+=`<p><b>🎉 Party/event keyword matches:</b> ${Object.keys(l.amenities).map(amenityIconHtml).join(' ')}</p><details><summary>Keyword evidence</summary>${Object.entries(l.amenities).map(([k,v])=>`<p>${amenityIconHtml(k)} ${esc(k.replaceAll('_',' '))}<br><span class="evidence">${esc(v.evidence)}<br>Source: ${listingSource}</span></p>`).join('')}</details>`;
  if(l.permit_evidence.length) html+=`<details><summary>Permit-number evidence</summary>${l.permit_evidence.map(e=>`<p><b>${esc(e.number)}</b> (${esc(e.method)})<br><span class="evidence">${esc(e.evidence)}<br>Source: ${listingSource}</span></p>`).join('')}</details>`;
  html+='<details><summary>Data and capacity rules</summary>';
  html+=dualCapacity?'<p class="small muted">Two-unit screening estimate: min(2 × total bedrooms + 2, 16), assuming bedrooms split evenly and each unit gets +1 guests. The detected numbers may be inaccurate and do not confirm separate licensed units. Saved listing data; approximate Airbnb location. <a href="about_data.html">Data and Kansas City rules</a></p>':'<p class="small muted">Kansas City occupancy ceiling = min(2 × bedrooms + 1, 8) per dwelling unit, using advertised bedrooms. Missing bedrooms: only excess above 8 can be flagged. Saved listing data; approximate Airbnb location. <a href="about_data.html">Data and Kansas City rules</a></p>';
  html+='</details><details><summary>Forms and corrections</summary><div class="report-actions"><button type="button" data-complaint>Complaint form (with evidence)</button><button type="button" data-report="location">Suggest location correction</button><button type="button" data-report="license">Suggest license correction</button><button type="button" data-report="address">Suggest address correction</button><a data-hotel-form target="_blank" rel="noopener">Report this listing as a hotel ↗</a></div></details>';
  */
  popup=new maplibregl.Popup({closeOnClick:false,maxWidth:'380px',className:'listing-popup-centered map-card-centered'}).setLngLat(l.displayPoint||l.point).setHTML(html).addTo(map);activeCardState=nextCardState;

  /* Disabled for the compact listing card: hotel report form bindings. Remove this comment to restore.
  if(l.likely_hotel&&!l.explicit_hotel_room&&!/\bhotel[ _-]*room\b|\broom in (?:a |boutique )?hotel\b/i.test(l.rental_type||'')){
    const link=document.createElement('a');link.textContent='Report this listing as not a hotel ↗';link.target='_blank';link.rel='noopener';link.dataset.notHotelForm='';
    const url=new URL('https://docs.google.com/forms/d/e/1FAIpQLSend-lUNSiOrOEYWo_CEpfgrIo3Xy-mR3Ycc0EOnvtFkPS2aA/viewform');url.searchParams.set('usp','pp_url');url.searchParams.set('entry.225332467',l.url);url.searchParams.set('entry.1451491665',l.not_hotel_tips?.[0]?.address||l.approximate_address||'');link.href=url.toString();popup.getElement().querySelector('.report-actions').append(link);
  }
  const hotelForm=new URL('https://docs.google.com/forms/d/e/1FAIpQLScjN7eHKBjY3c8Iew6F08WYgHN30ozXlv9NHg2lpfBrABGXdg/viewform');hotelForm.searchParams.set('usp','pp_url');hotelForm.searchParams.set('entry.225332467',l.url);popup.getElement().querySelector('[data-hotel-form]').href=hotelForm.toString();
  */
  PrivacyStreetCopy.bind(popup.getElement(),l);
  popup.getElement().querySelector('[data-select-host]').onclick=()=>{pendingHostKey=hostKey(l);$('hostPromptName').textContent=l.host_name||'Unknown host';$('hostConfirmDialog').showModal();};
  if(!l.user_address&&(!numberMode()||needsParcelFallback(l)))renderListingAssociations(l,popup.getElement().querySelector('[data-property-associations]'));
  /* Disabled for the compact listing card: complaint and correction form bindings. Remove this comment to restore.
  bindComplaintButton(popup.getElement(),l.approximate_address||l.location_name,l.point,l.url);
  popup.getElement().querySelectorAll('[data-report]').forEach(button=>button.onclick=()=>Reporting.open(l,button.dataset.report));
  */
  const linkedPermits=[...l.matched_permits,...(nearbyPermit?[nearbyPermit]:[])];
  const links=[...new Map(linkedPermits.filter(p=>p.point&&distance(l.point,p.point)<=550).map(p=>[p.id,feature({type:'LineString',coordinates:[l.point,p.point]})])).values()];
  sourceData('connections',collection(l.user_address?[]:numberMode()?permitParcelLinks([l]):links));
  if(numberMode()&&needsParcelFallback(l))renderFallbackAssociations(l,popup.getElement().querySelector('[data-property-associations]'));
  popup.on('close',()=>{resetMatchInteraction();sourceData('connections',collection([]));if(selectedListing===l){UserAddresses.select(null);selectedListing=null;updatePrivacy();}});
}
async function loadPermitDisplayParcels(){
  const base=await getJSON('data/permit_parcels.geojson');
  try{const extra=await getJSON('data/permit_property_parcels.geojson');return collection([...base.features,...extra.features]);}catch{return base;}
}
function propertyLocationGeometry(){return collection([...(permitLocationPoints?.features||[]),...((permitParcels||licensedParcels)?.features||[])]);}
function permitParcelLinks(items,includeRejected=false){
  return PermitProperties.links(items.filter(l=>!l.user_address), propertyLocationGeometry(),includeRejected,nameMatchingData);
}

function fitVisible() {
  if(!visible.length)return;
  const b=new maplibregl.LngLatBounds();visible.forEach(l=>b.extend(l.point));map.fitBounds(b,{padding:60,maxZoom:16});
}
function prepareData() {
  balanceKey=null;
  UserAddresses.apply(listings);
  PermitProperties.prepare(listings, permits, propertyLocationGeometry(), permitSavedDetails);
  const expiredMajorParcels=new Set(permits.filter(expiredMajorPermit).flatMap(p=>p.parcels||[p.parcel]).map(normalizeParcel));
  for(const f of permitParcels?.features||[])f.properties.expired_major_event=f.properties.permit_status==='expired'&&expiredMajorParcels.has(normalizeParcel(f.properties.parcel));
  anyPermitParcels=new Set(permits.flatMap(p=>[p.parcel,...(p.parcels||[])]).map(normalizeParcel).filter(Boolean));
  currentPermitParcels=new Set(permits.filter(p=>p.status==='current').map(p=>normalizeParcel(p.parcel)).filter(Boolean));
  currentPermits=permits.filter(p=>p.status==='current'&&p.point);permitGrid.clear();
  for(const p of currentPermits) {const key=`${Math.floor(p.point[0]*100)}_${Math.floor(p.point[1]*100)}`;if(!permitGrid.has(key))permitGrid.set(key,[]);permitGrid.get(key).push(p);}
  const groups=new Map();
  for(const l of listings) {
    l.search=JSON.stringify(l).toLowerCase();
    if(l.point){const key=l.point.join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(l);}
  }
  // Preserve true positions/radii; only spread stacked clickable marker centers.
  for(const group of groups.values()) group.forEach((l,i)=>{
    l.displayPoint=l.user_address||group.length===1?l.point:[l.point[0]+Math.cos(i*2*Math.PI/group.length)*.00007,l.point[1]+Math.sin(i*2*Math.PI/group.length)*.000055];
  });
  const statusSelect=$('permitStatusFilter'),previousStatus=statusSelect.value;
  const statuses=[...new Set(['current','expired','revoked','suspended',...permits.map(p=>p.status||'unknown')])];
  statusSelect.replaceChildren(...[['','All listings'],['known','Known status · any direct permit match'],...statuses.map(status=>[status,status.replace(/\b\w/g,c=>c.toUpperCase())+' ('+listings.filter(l=>matchesPermitStatus(l,status)).length.toLocaleString()+')'])].map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
  if([...statusSelect.options].some(o=>o.value===previousStatus))statusSelect.value=previousStatus;
  const previousTypes=new Map([...document.querySelectorAll('.rental-type')].map(input=>[input.value,input.checked]));
  applyNumberModeUI();
  $('rentalTypeOptions').replaceChildren(...[...new Set(listings.map(l=>l.rental_type||''))].sort().map(type=>{
    const label=document.createElement('label'),input=document.createElement('input');
    const lowType=listings.some(l=>(l.rental_type||'')===type&&l.low_priority);
    input.type='checkbox';input.className='rental-type'+(lowType?' low-priority':'');input.value=type;input.defaultChecked=!lowType;
    input.checked=lowType?false:previousTypes.has(type)?previousTypes.get(type):true;
    label.append(input,document.createTextNode(`${type||'Unknown rental type'} (${listings.filter(l=>(l.rental_type||'')===type).length.toLocaleString()})`));return label;
  }));
  const permitStatusCounts=new Map();
  for(const permit of permits){const status=String(permit.status||'unknown').toLowerCase();permitStatusCounts.set(status,(permitStatusCounts.get(status)||0)+1);}
  const permitStatusLabel=status=>status.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  updateFooterListingCount();
  const currentPermitCount=permitStatusCounts.get('current')||0;
  $('currentPermitCount').textContent=`${currentPermitCount.toLocaleString()} current permits · ${(permits.length-currentPermitCount).toLocaleString()} historical / expired`;
  const hotelCount=listings.filter(l=>l.likely_hotel).length;
  const mappedHotelCount=listings.filter(l=>l.likely_hotel&&l.point).length;
  const nonHotelCount=report.mapped_listings-mappedHotelCount;
  $('hotelCount').textContent=`Likely hotels ${hotelCount.toLocaleString()}`;
  $('hotelCount').title=`${mappedHotelCount.toLocaleString()} mapped; ${(hotelCount-mappedHotelCount).toLocaleString()} without coordinates. Excluded from STR screening.`;
  updateInventoryEstimate();
  $('permitInfoDate').textContent='Portal-confirmed issued and unexpired regular permits, October 7, 2026. Temporary events excluded.';
  const otherStatuses=[['grand_total',permits.length],...[...permitStatusCounts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))];
  $('otherPermitStatuses').replaceChildren(...otherStatuses.map(([status,count])=>{const row=document.createElement('p');row.className='permit-status-row'+(status==='current'?' permit-current':status==='grand_total'?' permit-grand-total':'');const label=document.createElement('span');label.textContent=status==='grand_total'?'Grand total · all permit records':status==='current'?'Current permits':permitStatusLabel(status);const value=document.createElement('strong');value.textContent=count.toLocaleString();row.append(label,value);return row;}));
}
async function getJSON(url) {if(['data/permit_property_parcels.geojson','data/permit_location_points.json'].includes(url))return collection([]);if(url==='data/permits.json')url='data/confirmed_permits/permits.json';if(['data/permit_parcels.geojson','data/licensed_parcels.geojson'].includes(url))url='data/confirmed_permits/permit_parcels.geojson';const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error(`${url}: HTTP ${response.status}`);return response.json();}
async function reloadData() {
  [listings,permits,report]=await Promise.all(['listings','permits','build_report'].map(n=>getJSON(`data/${n}.json`)));
  if(report.spatial?.available)spatial=await getJSON('data/spatial.json');
  Reporting.invalidate();
  if(parcelManifest?.available){licensedParcels=await getJSON('data/licensed_parcels.geojson');permitParcels=await loadPermitDisplayParcels();sourceData('parcels',permitParcels);}
  sourceData('boundary',spatial.boundary||collection([]));
  popup?.remove();prepareData();update();Reporting.loadViewport(map);$('refresh').hidden=true;
}
function addSourcesAndLayers() {
  for(const id of ['listings','privacy','permit-points','coverage','addresses','connections','permit-links','edge-buffer','edge-band','balance','surplus','deficit','nearby-parcels','candidate-preview','candidate-connections','connection-labels','name-matches'])map.addSource(id,{type:'geojson',data:collection([])});
  map.addSource('boundary',{type:'geojson',data:spatial.boundary||collection([])});
  map.addSource('parcels',{type:'geojson',data:permitParcels||collection([])});
  map.addLayer({id:'balance-fill',type:'fill',source:'balance',layout:{visibility:'none'},paint:{'fill-color':['interpolate',['linear'],['get','difference'],-20,'#15803d',0,'#f1f5f9',20,'#ef4444',100,'#991b1b'],'fill-opacity':.42}});
  map.addLayer({id:'balance-outline',type:'line',source:'balance',layout:{visibility:'none'},paint:{'line-color':'#475569','line-opacity':.3,'line-width':.5}});
  map.addLayer({id:'surplus-heatmap',type:'heatmap',source:'surplus',layout:{visibility:'none'},paint:{'heatmap-weight':['get','weight'],'heatmap-radius':['interpolate',['linear'],['zoom'],9,['*',['get','radius_scale'],4.5],11,['*',['get','radius_scale'],18],13,['*',['get','radius_scale'],72],15,['*',['get','radius_scale'],288],18,['*',['get','radius_scale'],2304]],'heatmap-intensity':1,'heatmap-opacity':.15,'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(255,255,255,0)',.02,'rgba(254,202,202,.7)',.08,'rgba(239,68,68,.85)',.22,'rgba(185,28,28,.92)',1,'rgba(127,29,29,.96)']}});
  map.addLayer({id:'deficit-heatmap',type:'heatmap',source:'deficit',layout:{visibility:'none'},paint:{'heatmap-weight':['get','weight'],'heatmap-radius':['interpolate',['linear'],['zoom'],9,['*',['get','radius_scale'],4.5],11,['*',['get','radius_scale'],18],13,['*',['get','radius_scale'],72],15,['*',['get','radius_scale'],288],18,['*',['get','radius_scale'],2304]],'heatmap-intensity':1,'heatmap-opacity':.15,'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(255,255,255,0)',.02,'rgba(237,247,237,.65)',.08,'rgba(205,232,205,.75)',.22,'rgba(151,201,151,.85)',1,'rgba(112,168,112,.9)']}});
  map.addLayer({id:'nearby-parcel-fill',type:'fill',source:'nearby-parcels',minzoom:15,paint:{'fill-color':'#94a3b8','fill-opacity':.025}});
  map.addLayer({id:'nearby-parcel-line',type:'line',source:'nearby-parcels',minzoom:15,paint:{'line-color':'#64748b','line-opacity':.65,'line-width':1}});
  map.addLayer({id:'parcel-fill',type:'fill',source:'parcels',paint:{'fill-color':['case',['boolean',['get','expired_major_event'],false],'#a855f7',['match',['get','permit_status'],'expired','#facc15','revoked','#dc2626','suspended','#dc2626','current','#22c55e','#94a3b8']],'fill-opacity':.42}});
  map.addLayer({id:'parcel-line',type:'line',source:'parcels',paint:{'line-color':['case',['boolean',['get','expired_major_event'],false],'#7e22ce',['match',['get','permit_status'],'expired','#eab308','revoked','#dc2626','suspended','#dc2626','current','#15803d','#475569']],'line-width':1.5}});
  map.addLayer({id:'coverage-fill',type:'fill',source:'coverage',paint:{'fill-color':'#4ade80','fill-opacity':.035}});
  map.addLayer({id:'coverage-line',type:'line',source:'coverage',paint:{'line-color':'#15803d','line-opacity':.35,'line-width':1}});
  map.addLayer({id:'privacy-fill',type:'fill',source:'privacy',paint:{'fill-color':'#3b82f6','fill-opacity':['case',['boolean',['get','selected'],false],.12,0]}});
  map.addLayer({id:'privacy-line',type:'line',source:'privacy',paint:{'line-color':'#2563eb','line-opacity':.32,'line-width':['case',['boolean',['feature-state','hover'],false],4.5,['boolean',['get','selected'],false],3,1.5]}});
  map.moveLayer('privacy-fill','parcel-fill');
  map.moveLayer('privacy-line','parcel-fill');
  map.moveLayer('surplus-heatmap','parcel-fill');
  map.moveLayer('deficit-heatmap','parcel-fill');
  function setPrivacyHover(id) {
    if(hoveredPrivacyId!==null)map.setFeatureState({source:'privacy',id:hoveredPrivacyId},{hover:false});
    hoveredPrivacyId=id===null?null:String(id);
    if(hoveredPrivacyId!==null)map.setFeatureState({source:'privacy',id:hoveredPrivacyId},{hover:true});
  }
  map.on('mouseenter','privacy-line',e=>{const id=e.features?.[0]?.id;if(id===undefined)return;setPrivacyHover(id);map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','privacy-line',()=>{setPrivacyHover(null);map.getCanvas().style.cursor='';});
  map.on('mouseenter','listing-markers',e=>{const id=e.features?.[0]?.properties?.id;if(id!==undefined)setPrivacyHover(id);});
  map.on('mouseleave','listing-markers',()=>setPrivacyHover(null));
  map.addLayer({id:'edge-buffer-fill',type:'fill',source:'edge-band',paint:{'fill-color':'#a855f7','fill-opacity':.09}});
  map.addLayer({id:'boundary-halo',type:'line',source:'boundary',paint:{'line-color':'#ffffff','line-width':9,'line-opacity':.95}});
  map.addLayer({id:'boundary-line',type:'line',source:'boundary',paint:{'line-color':'#172b3b','line-width':5}});
  map.addLayer({id:'edge-buffer-line',type:'line',source:'edge-buffer',paint:{'line-color':'#9333ea','line-width':2.5,'line-dasharray':[3,2]}});
  map.addLayer({id:'heatmap',type:'heatmap',source:'listings',layout:{visibility:'none'},paint:{'heatmap-radius':35,'heatmap-opacity':.6}});
  map.addLayer({id:'permit-markers',type:'circle',source:'permit-points',paint:{'circle-radius':4,'circle-color':['get','color'],'circle-stroke-color':'white','circle-stroke-width':1}});
  map.addLayer({id:'permit-links',type:'line',source:'permit-links',paint:{'line-color':['case',['boolean',['get','uncertain'],false],'#eab308','#15803d'],'line-offset':['match',['get','method'],'owner_nickname',-5,'permit_owner_nickname',-10,'current_parcel_address',5,0],'line-width':2.5,'line-opacity':1,'line-dasharray':[1.5,.7]}});
  map.addLayer({id:'connections',type:'line',source:'connections',paint:{'line-color':['case',['boolean',['get','uncertain'],false],'#eab308','#15803d'],'line-offset':['match',['get','method'],'owner_nickname',-5,'permit_owner_nickname',-10,'current_parcel_address',5,0],'line-width':2.5,'line-dasharray':[1.5,.7]}});
  map.addLayer({id:'name-matches-fill',type:'fill',source:'name-matches',paint:{'fill-color':['get','color'],'fill-opacity':.3}});
  map.addLayer({id:'name-matches-line',type:'line',source:'name-matches',paint:{'line-color':['get','color'],'line-width':3}});
  map.addLayer({id:'candidate-preview-fill',type:'fill',source:'candidate-preview',paint:{'fill-color':'#2563eb','fill-opacity':.3}});
  map.addLayer({id:'candidate-preview-line',type:'line',source:'candidate-preview',paint:{'line-color':'#1d4ed8','line-width':4}});
  map.addLayer({id:'candidate-preview-point',type:'circle',source:'candidate-preview',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['match',['get','role'],'airbnb','#e11d48','#2563eb'],'circle-radius':8,'circle-stroke-color':'#ffffff','circle-stroke-width':2}});
  map.addLayer({id:'candidate-connections',type:'line',source:'candidate-connections',paint:{'line-color':'#eab308','line-width':3,'line-dasharray':[2,2]}});
  map.addLayer({id:'connection-question-labels',type:'symbol',source:'connection-labels',layout:{'text-field':['get','label'],'text-offset':['match',['get','label'],'Nickname ?',['literal',[0,2]],'Parcel nickname ?',['literal',[0,2]],'Permit nickname ?',['literal',[0,3]],'Parcel ?',['literal',[0,1]],['literal',[0,-1]]],'text-size':['interpolate',['linear'],['zoom'],9,2.4,11,4,13,9.6,16,16],'text-font':['Noto Sans Regular'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#854d0e','text-halo-color':'white','text-halo-width':['interpolate',['linear'],['zoom'],9,.3,11,.5,13,1.2,16,2]}});
  map.addLayer({id:'listing-markers',type:'circle',source:'listings',paint:{'circle-radius':['interpolate',['linear'],['zoom'],9,3,11,5,13,12,16,20],'circle-color':['get','color'],'circle-opacity':['case',['boolean',['get','renewed'],false],0,1],'circle-stroke-color':['get','stroke'],'circle-stroke-width':2}});
  for(const [id,left,color] of [['renewed-permit','#facc15','#22c55e'],['renewed-major-permit','#a855f7','#22c55e'],['renewed-over-capacity','#facc15','#dc2626'],['permitted-over-capacity','#dc2626','#22c55e']]) {
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d');
    context.beginPath();context.arc(32,32,32,0,Math.PI*2);context.clip();
    context.fillStyle=left;context.fillRect(0,0,32,64);
    context.fillStyle=color;context.fillRect(32,0,32,64);
    map.addImage(id,context.getImageData(0,0,64,64),{pixelRatio:2});
  }
  map.addLayer({id:'renewed-listing-markers',type:'symbol',source:'listings',filter:['==',['get','renewed'],true],layout:{'icon-image':['get','renewal_icon'],'icon-size':['interpolate',['linear'],['zoom'],9,3/16,11,5/16,13,12/16,16,20/16],'icon-allow-overlap':true,'icon-ignore-placement':true}});
  map.addLayer({id:'listing-labels',type:'symbol',source:'listings',minzoom:12,layout:{'text-field':['get','label'],'text-size':12,'text-line-height':1.05,'text-font':['Noto Sans Regular'],'text-allow-overlap':true,'text-ignore-placement':true},paint:{'text-color':'#172b3b'}});
  map.addLayer({id:'address-labels',type:'symbol',source:'addresses',minzoom:16,layout:{'text-field':['get','address'],'text-size':11,'text-font':['Noto Sans Regular'],'text-offset':[0,2]},paint:{'text-color':'#172b3b','text-halo-color':'white','text-halo-width':2}});
  map.moveLayer('address-labels','listing-markers');
  const warningCanvas=document.createElement('canvas');warningCanvas.width=64;warningCanvas.height=64;
  const ctx=warningCanvas.getContext('2d');ctx.font='48px "Segoe UI Emoji", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('⚠️',32,32);
  map.addImage('spatial-warning',ctx.getImageData(0,0,64,64),{pixelRatio:2});
  map.addLayer({id:'warning-markers',type:'symbol',source:'listings',filter:['==',['get','warning'],true],layout:{'icon-image':'spatial-warning','icon-size':['interpolate',['linear'],['zoom'],9,.45,13,.7,16,.9],'icon-offset':[30,-30],'icon-allow-overlap':true,'icon-ignore-placement':true}});
  map.on('click','renewed-listing-markers',e=>{const l=listings.find(l=>l.listing_id===e.features[0].properties.id);if(l)showListing(l);});
  map.on('click','warning-markers',e=>{const l=listings.find(l=>l.listing_id===e.features[0].properties.id);if(l)showListing(l);});
  map.on('click','balance-fill',e=>{
    if(map.queryRenderedFeatures(e.point,{layers:['listing-markers','permit-markers','warning-markers']}).length)return;
    const p=e.features[0].properties;popup?.remove();popup=new maplibregl.Popup({closeOnClick:false,maxWidth:'330px',className:'listing-popup-centered map-card-centered'}).setLngLat(e.lngLat).setHTML(`<h3>Listings − licenses</h3><p>500 × 500 m cell ${esc(p.cell_id)}</p><p><b>${p.listings}</b> listing locations<br><b>${p.permits}</b> current permit records<br><b>${p.difference>0?'+':''}${p.difference}</b> listings minus permits</p><p class="small muted">Likely hotels excluded; remaining records in the selected area counted once by point location. This is a geographic estimate; Airbnb locations can be displaced. A surplus does not identify which listings lack a permit.</p>`).addTo(map);
  });
  map.on('click','listing-markers',e=>{const l=listings.find(l=>l.listing_id===e.features[0].properties.id);if(l)showListing(l);});
  map.on('click','listing-labels',e=>{const l=listings.find(l=>l.listing_id===e.features[0].properties.id);if(l)showListing(l);});
  map.on('click','privacy-line',()=>{if(selectedListing)showListing(selectedListing);});
  const listingClick=e=>map.queryRenderedFeatures(e.point,{layers:['listing-markers','renewed-listing-markers','listing-labels','warning-markers','privacy-line']}).length;
  map.on('click','permit-markers',e=>{if(listingClick(e))return;const p=permits.find(p=>p.id===e.features[0].properties.id);if(p)showProperty(p,p.point);});
  map.on('click','parcel-fill',e=>{if(listingClick(e)||map.queryRenderedFeatures(e.point,{layers:['permit-markers']}).length)return;showProperty(e.features[0].properties,e.lngLat);});
  map.on('click','nearby-parcel-fill',e=>{if(listingClick(e)||map.queryRenderedFeatures(e.point,{layers:['permit-markers','parcel-fill']}).length)return;showProperty(e.features[0].properties,e.lngLat);});
  for(const id of ['listing-markers','permit-markers','parcel-fill']){map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave',id,()=>map.getCanvas().style.cursor='');}
  map.on('moveend',()=>{updateFooterListingCount();BrowserState.schedule();updateSymbols();updateEyes();updateAddresses();Reporting.loadViewport(map);});
  Reporting.loadViewport(map);
  update();
}
async function scannerStatus() {
  $('scanStatus').textContent='Static snapshot';
  try {const latest=await getJSON('data/build_report.json');if(latest.built_at!==report.built_at)$('refresh').hidden=false;}catch{}
}
async function init() {
  BrowserState.setup();
  setupAppearanceAndDisclaimer();
  try {
    [listings,permits,report]=await Promise.all(['listings','permits','build_report'].map(n=>getJSON(`data/${n}.json`)));
    try{listingPlotAddresses=await getJSON('data/listing_plot_addresses.json');}catch{}
    try{parcelManifest=await getJSON('data/parcels/manifest.json');}catch{parcelManifest={available:false};}
    if(parcelManifest?.available){licensedParcels=await getJSON('data/licensed_parcels.geojson');permitParcels=await loadPermitDisplayParcels();}
    try{[permitLocationPoints,permitSavedDetails]=await Promise.all([getJSON('data/permit_location_points.json'),getJSON('data/permit_saved_details.json')]);}catch{}
    try{[nameMatchingData,parcelMatchingData]=await Promise.all([getJSON('data/nicknames.json'),getJSON('data/parcel_matching_candidates.geojson')]);}catch{}
    if(report.spatial?.available)spatial=await getJSON('data/spatial.json');
    if(!spatial.available){for(const id of ['scopeOnly','likely','warningSymbols','difference','surplusHeatmap','heatRadius','heatIntensity']){$(id).checked=false;$(id).disabled=true;}}
    await UserAddresses.load();
    prepareData();
    const savedView=BrowserState.restore();
    $('densityFocusEnabled').checked=false;$('areaEnable-neighborhood').checked=true;$('areaLabels-neighborhood').checked=true;$('parcels').checked=true;$('parcelOutlines').checked=false;$('parcelAddressNumbers').checked=false;
    for(const id of ['privacy','permits','symbols','coverage','difference','heatmap','surplusHeatmap','historical'])if($(id)){$(id).checked=false;$(id).disabled=true;}
    if(numberMode()&&parcelManifest?.available&&!localStorage.getItem('kc_compass_green_parcels_v1')){ $('parcels').checked=true;localStorage.setItem('kc_compass_green_parcels_v1','1'); }
    map=new maplibregl.Map({container:'map',center:[-94.55410,39.12402],zoom:11,...savedView,style:{version:8,glyphs:'vendor/fonts/{fontstack}/{range}.pbf',sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'basemap',type:'raster',source:'osm'}]}});
    map.addControl(new maplibregl.NavigationControl(),'top-right');map.addControl(new maplibregl.ScaleControl());
    map.on('load',()=>{addSourcesAndLayers();AreaStats.init(map);ParcelSearch.init(map);ParcelOutlines.init(map);UserAddresses.init(map);});
    map.once('load',()=>BrowserState.restoreUI());
    for(const el of document.querySelectorAll('#filters input:not(.rental-type),#filters select'))el.addEventListener(el.type==='search'?'input':'change',()=>{updateExploreClearButton();clearTimeout(refreshTimer);refreshTimer=setTimeout(update,el.type==='search'?180:0);});
    $('rentalTypes').addEventListener('toggle',()=>{$('rentalTypeHint').textContent=$('rentalTypes').open?'Click to hide':'Click to expand';});
    $('rentalTypeOptions').addEventListener('change',event=>{const t=event.target;if(t.classList.contains('low-priority')&&t.checked){t.checked=false;showNotice(report.low_priority_message);}update();});
    for(const [id,checked] of [['rentalTypesAll',true],['rentalTypesNone',false]])$(id).onclick=()=>{
      for(const input of document.querySelectorAll('.rental-type:not(.low-priority)'))input.checked=checked;update();
    };
    setupResponsivePanels();
    // Footer wraps as counts and viewport widths change; reserve its actual height.
    new ResizeObserver(()=>{const height=$('statusbar').getBoundingClientRect().height;
      document.documentElement.style.setProperty('--map-footer-height',height+'px');map.resize();
    }).observe($('statusbar'));
    $('clearExploreFilters').onclick=resetExploreFilters;
    $('hostSearch').addEventListener('input',updateHosts);
    $('clearHost').onclick=()=>{selectedHost='';selectedHostMetric='';selectedPartyCombo='';selectedPartyRequireCapacity=false;$('likely').checked=false;$('partyOnly').checked=false;update();};
    $('potentiallyUnlicensedCount').onclick=()=>$('revenueDialog').showModal();
    $('potentiallyLicensedCount').onclick=()=>{resetExploreFilters();$('potentialOnly').checked=true;update();fitVisible();};
    $('currentPermitCount').onclick=()=>$('otherPermitDialog').showModal();$('closeOtherPermits').onclick=()=>$('otherPermitDialog').close();
    $('violationStatsButton').onclick=()=>{updateViolationStats();$('violationStatsDialog').showModal();};
    $('closeViolationStats').onclick=()=>$('violationStatsDialog').close();
    $('statsExcludeLarge').onchange=()=>{$('includeLargeOverCapacity').checked=!$('statsExcludeLarge').checked;update();};
    $('statsExcludeMultiple').onchange=()=>{$('excludeMultipleOverCapacity').checked=$('statsExcludeMultiple').checked;update();};
    $('showOverOccupancy').onclick=()=>showStatsOnMap('occupancy');
    $('showLikelyUnlicensed').onclick=()=>showStatsOnMap('likely');
    $('revenueLikelyStats').onclick=()=>{$('revenueDialog').close();updateViolationStats();$('violationStatsDialog').showModal();};
    $('potentialRevenueButton').onclick=()=>$('revenueDialog').showModal();$('closeRevenueDialog').onclick=()=>$('revenueDialog').close();
    $('sourcesButton').onclick=()=>$('sourcesDialog').showModal();$('closeSourcesDialog').onclick=()=>$('sourcesDialog').close();
    $('aboutButton').onclick=()=>$('aboutPageDialog').showModal();$('closeAboutPageDialog').onclick=()=>$('aboutPageDialog').close();
    $('legislativeTipsButton').onclick=()=>$('legislativeTipsDialog').showModal();$('closeLegislativeTipsDialog').onclick=()=>$('legislativeTipsDialog').close();
    $('hostPromptClose').onclick=$('hostPromptNo').onclick=()=>$('hostConfirmDialog').close();
    $('hostPromptYes').onclick=()=>{if(!pendingHostKey)return;selectedHost=pendingHostKey;selectedHostMetric='total';selectedPartyCombo='';selectedPartyRequireCapacity=false;$('partyOnly').checked=false;$('hostSearch').value='';$('hostConfirmDialog').close();popup?.remove();popup=null;update();fitVisible();};
    $('closePartyDisclaimer').onclick=()=>$('partyDisclaimer').close();
    $('resetZoom').onclick=()=>map.flyTo({center:[-94.55410,39.12402],zoom:11});
    $('fitArea').onclick=()=>{if(!spatial.available)return;const b=new maplibregl.LngLatBounds();function visit(v){if(typeof v[0]==='number')b.extend(v);else v.forEach(visit);}spatial.boundary.features.forEach(f=>visit(f.geometry.coordinates));map.fitBounds(b,{padding:window.innerWidth>700?{left:Math.ceil($('filters').getBoundingClientRect().right)+15,right:65,top:40,bottom:45}:40});};
    $('reset').onclick=resetExploreFilters;
    $('refresh').onclick=reloadData;
    Reporting.setup();
    scannerStatus();setInterval(scannerStatus,30000);
    // Small public interface for reproducible browser validation.
    window.nashville={get map(){return map;},get listings(){return listings;},get permits(){return permits;},get visible(){return visible;},get selectedListing(){return selectedListing;},get spatial(){return spatial;},get balance(){return balance;},likelyUnlicensed,showListing,markerColor,filterListings,update,ring};
  }catch(error){console.error(error);$('counts').textContent='Map could not load. Serve this folder over HTTP and check the data files.';$('buildStatus').textContent=error.message;}
}
init();
