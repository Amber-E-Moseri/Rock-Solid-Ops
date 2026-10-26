// Campus eligibility for Batch Management. Pure functions; no data access.
//
// A campus is identified by its fellowship_map code (fellowship_code). Campus names are for display only.
//
// A batch's eligible campuses come from two sources, applied in this order:
//   1. Explicit batch-campus settings (batch_campus_registration_settings). One row per batch and campus.
//      registration_open = false closes that campus for the batch. registration_open = true opens it, even
//      when the batch's organizational scope does not include it. A campus with no row keeps its
//      organizational eligibility. The table is an override layer: a missing row means open, not closed.
//   2. Organizational scope. A subgroup-scoped batch covers only that subgroup's campuses, never the
//      rest of its group. A batch with no subgroup covers its fellowship group (CE, CS, WS) or a
//      fellowship code. A batch with neither covers no campus. No campus is invented.
//
// Explicit rows naming a code that is not an active fellowship_map entry are ignored.

// Campus codes the batch's organizational scope covers.
export function scopeCodes(batch, fellowshipRows) {
  const subgroup = batch.subgroup_id || batch.subgroup;
  if (subgroup) return fellowshipRows.filter((r) => r.subgroup_id === subgroup).map((r) => r.fellowship_code);
  if (batch.fellowship_group) {
    return fellowshipRows
      .filter((r) => r.group_id === batch.fellowship_group || r.fellowship_code === batch.fellowship_group)
      .map((r) => r.fellowship_code);
  }
  return [];
}

// Campus codes a batch is eligible at. settingsRows are this batch's batch_campus_registration_settings rows.
export function eligibleCampusCodes(batch, fellowshipRows, settingsRows = []) {
  const known = new Set(fellowshipRows.map((r) => r.fellowship_code));
  const codes = new Set(scopeCodes(batch, fellowshipRows));
  for (const s of settingsRows) {
    if (!known.has(s.fellowship_code)) continue;
    if (s.registration_open === false) codes.delete(s.fellowship_code);
    else codes.add(s.fellowship_code);
  }
  return [...codes];
}

// Campus names for display, one per eligible code, without duplicates.
export function campusesForBatch(batch, fellowshipRows, settingsRows = []) {
  const nameByCode = new Map(fellowshipRows.map((r) => [r.fellowship_code, r.campus_name]));
  const names = eligibleCampusCodes(batch, fellowshipRows, settingsRows)
    .map((code) => nameByCode.get(code))
    .filter(Boolean);
  return [...new Set(names)];
}

// Open Registration summary. A batch is open only when its registration flag is on AND at least one
// eligible campus is still accepting registrations after overrides. An open batch with every campus
// closed does not count. Campuses are the distinct codes still accepting registrations across the
// counted batches. settingsByBatch maps batch_id to that batch's settings rows.
export function summarizeOpenRegistration(batches, fellowshipRows, settingsByBatch = new Map()) {
  const codes = new Set();
  let openBatches = 0;
  for (const b of batches) {
    if (!b.registration_open) continue;
    const accepting = eligibleCampusCodes(b, fellowshipRows, settingsByBatch.get(b.batch_id) ?? []);
    if (accepting.length === 0) continue;
    openBatches += 1;
    for (const code of accepting) codes.add(code);
  }
  return { openBatches, campuses: codes.size };
}
