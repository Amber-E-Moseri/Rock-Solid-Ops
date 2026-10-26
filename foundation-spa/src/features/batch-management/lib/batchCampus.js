// Campus resolution for Batch Management. Pure functions over fellowship_map rows; no data access.

// Campus names a batch is offered at.
// A batch with a subgroup resolves to that subgroup's campuses. A batch without one resolves by its
// fellowship, which may be a group code (CE, CS, WS) or a fellowship code.
export function campusesForBatch(batch, fellowshipRows) {
  const subgroup = batch.subgroup_id || batch.subgroup;
  let rows;
  if (subgroup) {
    rows = fellowshipRows.filter((r) => r.subgroup_id === subgroup);
  } else if (batch.fellowship_group) {
    rows = fellowshipRows.filter((r) => r.group_id === batch.fellowship_group || r.fellowship_code === batch.fellowship_group);
  } else {
    rows = [];
  }
  return [...new Set(rows.map((r) => r.campus_name).filter(Boolean))];
}

// Distinct campuses represented by the given batches. Campuses no batch uses are not counted.
export function countCampuses(batches, fellowshipRows) {
  const names = new Set();
  for (const b of batches) {
    for (const name of campusesForBatch(b, fellowshipRows)) names.add(name);
  }
  return names.size;
}
