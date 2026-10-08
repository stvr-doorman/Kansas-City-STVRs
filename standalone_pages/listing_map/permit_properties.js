'use strict';
// Property associations use explicit city parcel IDs, never proximity or owner names.
const PermitProperties = (() => {
  const key = value => String(value || '').replace(/[^a-z\d]/gi, '').toUpperCase();
  const parcels = permit => [...new Set([...(permit.parcels || []), permit.parcel].map(key).filter(Boolean))];
  const addressKey = value => String(value || '').toUpperCase().split(/KANSAS CITY|\bUNIT\b|\bSTE\b|\bAPT\b|#/)[0]
    .replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE').replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR').replace(/\bROAD\b/g, 'RD').replace(/\bCOURT\b/g, 'CT').replace(/[^A-Z\d]/g, '');
  function distance(a, b) {
    const r = Math.PI / 180, v = Math.sin((b[1]-a[1])*r/2)**2
      + Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;
    return 12742017.6 * Math.asin(Math.min(1, Math.sqrt(v)));
  }
  function nameMatch(host, owner, nicknames = {}) {
    const tokens = value => String(value || '').toLowerCase().match(/[a-z]+/g) || [];
    const hostNames=tokens(host), ownerNames=tokens(owner);
    if (!hostNames.length || !ownerNames.length) return 'distance';
    if (hostNames.every(name=>ownerNames.includes(name))) return hostNames.length>1?'owner_name':'owner_first_name';
    if (hostNames.some(name=>(nicknames[name]||[]).some(nickname=>ownerNames.includes(nickname)))) return 'owner_nickname';
    return 'distance';
  }
  function candidates(listing, geometry, nicknames, radius=160) {
    if (!listing.point || links([listing], geometry).length) return [];
    const limit=Math.min(550,Math.max(0,Number(radius)||160)), unique=new Map();
    for(const feature of geometry?.features||[]) {
      const row=feature.properties;
      if(!row.point)continue;
      const meters=distance(listing.point,row.point);
      if(meters>=550)continue;
      const type=nameMatch(listing.host_name,row.owner,nicknames);
      if(type==='distance'&&meters>=limit)continue;
      const candidate={...row,geometry:feature.geometry,type,distance_m:meters,
        within_privacy_radius:Number(listing.privacy_radius_meters)>0&&meters<=Number(listing.privacy_radius_meters)};
      const id=key(row.parcel);
      if(!unique.has(id)||feature.geometry.type!=='Point')unique.set(id,candidate);
    }
    const all=[...unique.values()];
    const names=all.filter(row=>row.type!=='distance').sort((a,b)=>Number(b.within_privacy_radius)-Number(a.within_privacy_radius)||a.distance_m-b.distance_m).slice(0,5);
    return names.length?names:all.sort((a,b)=>a.distance_m-b.distance_m).slice(0,5);
  }
  function propertyParcels(permit, plots) {
    const ids = parcels(permit), address = addressKey(permit.address);
    return ids.filter(id => {
      const plot = plots.get(id), target = addressKey(plot?.address);
      // Conflicting city parcel/address associations remain review evidence, not map destinations.
      return !address || !target || address === target;
    });
  }
  function matchNumbers(listing, permitsByNumber, permitsBySuffix, plots) {
    listing.permit_match_methods = [];
    listing.ambiguous_permit_candidates = [];
    const registration = String(listing.registration_text || '').trim();
    const evidenceRows = [...(listing.permit_evidence || [])];
    if (registration) {
      const numbers = registration.match(/\b(?:(?:NSD|CD)[\s-]*)?STR(?:[\s-]*MAJ)?[\s-]*\d+\b|\bCD[\s-]*SUP[\s-]*\d+[\s-]*\d+\b/gi);
      for (const raw of numbers || [registration]) evidenceRows.push({raw});
    }
    if (!evidenceRows.length) return;
    const matched = new Map(), ambiguous = new Map(), detected = new Set();
    for (const evidence of evidenceRows) {
      // Normalize formatting only. CD and NSD are separate city permit series.
      const raw = key(evidence.raw || evidence.number);
      detected.add(evidence.raw || evidence.number);
      const exact = permitsByNumber.get(raw);
      if (exact) matched.set(exact.id, exact);
      else if (/^STR(?:MAJ)?\d+$/.test(raw)) {
        const [, family, digits] = raw.match(/^(STR(?:MAJ)?)(\d+)$/);
        const candidates = permitsBySuffix.get(family + ':' + (digits.replace(/^0+/, '') || '0')) || [];
        const nearby = listing.point ? candidates.filter(p => propertyParcels(p, plots).some(id=>{
          const point=plots.get(id)?.point || p.point;
          return point && distance(listing.point,point)<550;
        })) : [];
        // Missing series prefixes are resolved only by a unique same-number record within 550 m.
        if (nearby.length === 1) {
          matched.set(nearby[0].id, nearby[0]);
          listing.permit_match_methods.push({permit_number:nearby[0].permit_number,method:'abbreviated_number_nearby',raw:evidence.raw});
        } else for (const candidate of candidates) ambiguous.set(candidate.id, candidate);
      }
    }
    listing.permit_numbers = [...detected];
    const distinctNumbers=new Set(listing.permit_numbers.map(key));
    const oldDual=listing.dual_license_capacity===true;
    listing.detected_permit_count=distinctNumbers.size;
    listing.dual_license_capacity=distinctNumbers.size===2;
    if(oldDual!==listing.dual_license_capacity) {
      const bedrooms=listing.bedrooms, guests=listing.guests;
      listing.allowed_guests=typeof bedrooms==='number'&&Number.isFinite(bedrooms)
        ? Math.min(2*bedrooms+(listing.dual_license_capacity?2:1),listing.dual_license_capacity?16:8) : 8;
      if(typeof guests==='number'&&Number.isFinite(guests)) listing.over_capacity=Math.max(0,guests-listing.allowed_guests);
    }
    listing.matched_permits = [...matched.values()];
    listing.matched_permit_numbers = listing.matched_permits.map(p => p.permit_number);
    listing.ambiguous_permit_candidates = [...ambiguous.values()].filter(p => !matched.has(p.id));
    if (['current', 'expired', 'other', 'unmatched', 'none'].includes(listing.registration_class)) {
      const status = listing.matched_permits.some(p => p.status === 'current') ? 'current'
        : listing.matched_permits.some(p => p.status === 'expired') ? 'expired'
        : listing.matched_permits.length ? 'other' : 'unmatched';
      listing.registration_class = status;
      listing.license_status = status;
      listing.likely_unlicensed_number = !listing.likely_hotel && ['expired', 'other'].includes(status);
      listing.potentially_licensed_number = !listing.likely_hotel && status === 'unmatched';
    }
  }
  function prepare(listings, permits, geometry, savedDetails) {
    // Signed boundary distances are positive inside Kansas City, negative outside.
    // Apply the fixed outer limit independently of optional map filters.
    for (let index = listings.length - 1; index >= 0; index--)
      if (Number.isFinite(listings[index].boundary_distance_m) && listings[index].boundary_distance_m < -550)
        listings.splice(index, 1);
    const byParcel = new Map();
    const plots = new Map((geometry?.features || []).map(f => [key(f.properties.parcel), f.properties]));
    const byNumber = new Map(), bySuffix = new Map();
    for (const permit of permits) {
      if (savedDetails?.[permit.id]) permit.saved_details = savedDetails[permit.id];
      const number = key(permit.permit_number);
      byNumber.set(number, permit);
      const parts = number.match(/^(?:CD|NSD)(STR(?:MAJ)?)(\d+)$/);
      if (parts) {
        const suffix = parts[1] + ':' + (parts[2].replace(/^0+/, '') || '0');
        if (!bySuffix.has(suffix)) bySuffix.set(suffix, []);
        bySuffix.get(suffix).push(permit);
      }
    }
    for (const permit of permits) for (const parcel of propertyParcels(permit, plots)) {
      if (!byParcel.has(parcel)) byParcel.set(parcel, []);
      byParcel.get(parcel).push(permit);
    }
    for (const listing of listings) {
      matchNumbers(listing, byNumber, bySuffix, plots);
      const direct = listing.matched_permits || [];
      const records = new Map();
      listing.matched_property_parcels = [...new Set(direct.flatMap(p => propertyParcels(p, plots)))];
      listing.conflicting_permit_parcels = direct.flatMap(p => parcels(p).filter(id => !propertyParcels(p, plots).includes(id))
        .map(id => ({permit_number: p.permit_number, parcel: id, permit_address: p.address, parcel_address: plots.get(id)?.address})));
      for (const permit of direct) {
        records.set(permit.id || permit.permit_number, permit);
        for (const parcel of propertyParcels(permit, plots)) for (const related of byParcel.get(parcel) || [])
          records.set(related.id || related.permit_number, related);
      }
      listing.property_permits = [...records.values()];
      listing.noncurrent_permit_at_permitted_address = direct.length>0
        && direct.every(p=>p.status!=='current') && listing.property_permits.some(p=>p.status==='current');
      listing.cancelled_permit_at_permitted_address = listing.noncurrent_permit_at_permitted_address
        && direct.every(p=>p.status==='cancelled');
      listing.expired_permit_at_permitted_address = listing.registration_class === 'expired'
        && direct.some(p => p.status === 'expired') && listing.property_permits.some(p => p.status === 'current');
    }
  }
  function links(listings, geometry, includeRejected = false, nicknames = {}) {
    const plots = new Map((geometry?.features || []).map(f => [key(f.properties.parcel), f.properties.point]));
    const owners = new Map((geometry?.features || []).map(f => [key(f.properties.parcel), f.properties.owner]));
    const addresses = new Map((geometry?.features || []).map(f => [key(f.properties.parcel), f.properties.address]));
    const addressRecovered = new Set((geometry?.features || []).filter(f=>f.properties.match_basis==='exact_saved_permit_address').map(f=>key(f.properties.parcel)));
    const recoveredParcels = new Map((geometry?.features || []).filter(f=>f.properties.match_basis==='exact_saved_permit_address').map(f=>[key(f.properties.parcel),f.properties.source_parcel]));
    const result = [];
    for (const listing of listings) {
      if (!listing.point) continue;
      const seen = new Set();
      for (const permit of listing.matched_permits || []) {
        const ids = listing.matched_property_parcels || parcels(permit);
        const targets = parcels(permit).filter(id => ids.includes(id)).map(parcel => ({parcel, point: plots.get(parcel)})).filter(t => t.point);
        if (!targets.length && permit.point && !listing.conflicting_permit_parcels?.some(p => p.permit_number === permit.permit_number)) targets.push({parcel: parcels(permit)[0] || '', point: permit.point});
        for (const target of targets) {
          const id = target.parcel || target.point.join(',');
          if (seen.has(id)) continue;
          seen.add(id);
          if (recoveredParcels.has(target.parcel)) seen.add(key(recoveredParcels.get(target.parcel)));
          const meters = distance(listing.point, target.point);
          const drawnMeters = distance(listing.displayPoint || listing.point, target.point);
          if (!includeRejected && (meters > 550 || drawnMeters > 550)) continue;
          const abbreviated=listing.permit_match_methods?.some(m=>m.permit_number===permit.permit_number);
          const uncertain=!!abbreviated || addressRecovered.has(target.parcel) || !!listing.ambiguous_permit_candidates?.length || (listing.matched_permits||[]).length>1;
          result.push({type: 'Feature', geometry: {type: 'LineString', coordinates: [listing.displayPoint || listing.point, target.point]},
            properties: {listing_id: listing.listing_id, parcel: target.parcel, permit_number: permit.permit_number,
              uncertain, method: abbreviated?'abbreviated_number_nearby':'permit_number',
              distance_m: meters,
              location_conflict: meters > 550 || drawnMeters > 550}});
          if(addressRecovered.has(target.parcel)) {
            const permitLine=result[result.length-1];
            permitLine.properties.reference_label='Permit ?';
            result.push({...permitLine,properties:{...permitLine.properties,uncertain:true,method:'current_parcel_address',
              source_parcel:recoveredParcels.get(target.parcel),reference_label:'Parcel ?'}});
          }
          const nameEvidence=[{name:permit.owner,source:'permit',method:'permit_owner_nickname'},
            {name:owners.get(target.parcel),source:'parcel',method:'owner_nickname'}];
          for(const evidence of nameEvidence)if(nameMatch(listing.host_name,evidence.name,nicknames)==='owner_nickname') {
            const numberLine=result.findLast(f=>f.properties.listing_id===listing.listing_id&&f.properties.parcel===target.parcel);
            numberLine.properties.uncertain=true;
            result.push({...numberLine,properties:{...numberLine.properties,uncertain:true,method:evidence.method,
              name_source:evidence.source,matched_name:evidence.name,host_name:listing.host_name,
              parcel_address:addresses.get(target.parcel),reference_label:evidence.source==='parcel'?'Parcel nickname ?':'Permit nickname ?'}});
          }
        }
      }
    }
    return result;
  }
  return {prepare, links, candidates, nameMatch};
})();
