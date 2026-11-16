/**
 * The scholarship the top dropdown should open on: the newest ACTIVE one.
 * "Newest" is created_at, then scholarship_id - scholarships copied into a
 * session together share one created_at, so the id breaks the tie. With no
 * ACTIVE scholarship it falls back to the newest of any status.
 */
export function pickDefaultScholarship(list) {
  const all = Array.isArray(list) ? list : [];
  const active = all.filter((s) => s?.status === 'ACTIVE');
  const pool = active.length > 0 ? active : all;

  const newestFirst = (a, b) => {
    const byDate = new Date(b?.created_at || 0) - new Date(a?.created_at || 0);
    if (byDate !== 0 && !Number.isNaN(byDate)) return byDate;
    return Number(b?.scholarship_id) - Number(a?.scholarship_id);
  };

  return [...pool].sort(newestFirst)[0] || null;
}
