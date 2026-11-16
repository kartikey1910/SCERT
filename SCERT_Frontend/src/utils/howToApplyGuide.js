/**
 * Shared rules for the "How to Apply" guide, which SCERT edits in the CMS as a
 * list of role tabs (School, BEO, ...), each holding titled YouTube videos.
 *
 * Which tab shows where is decided by the tab's label:
 *
 *   a tab labelled "BEO" (or "Block Education Officer")     ->  the BEO
 *                                                                dashboard's Tutorial tab
 *   a tab labelled "School" (or "Schools")                  ->  the School
 *                                                                dashboard's Tutorial tab
 *   a tab labelled "District" (or "Chief Education Officer",
 *   "CEO")                                                  ->  the District
 *                                                                dashboard's Tutorial tab
 *   every other tab                                         ->  the public page
 *
 * so a BEO, School or District tutorial pushed from the CMS never appears on
 * the homepage guide, and never appears for a different role's dashboard.
 * The label is the only tag the CMS has, and the CMS editor shows the
 * placement next to the label field so the admin can see the effect.
 */

export function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'role'
  );
}

/** Roles as the CMS stores them, with missing pieces filled in. */
export function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];

  return roles.map((role, index) => ({
    id: role?.id || `${slugify(role?.label)}-${index + 1}`,
    label: role?.label || `Role ${index + 1}`,
    sections: Array.isArray(role?.sections)
      ? role.sections.map((section) => ({
          heading: section?.heading || '',
          youtube_url: section?.youtube_url || '',
        }))
      : [],
  }));
}

/** True for a role tab that holds BEO tutorials. */
export function isBeoRole(role) {
  return /\bbeo\b|block\s+education/i.test(String(role?.label || ''));
}

/** True for a role tab that holds School tutorials. */
export function isSchoolRole(role) {
  return /\bschools?\b/i.test(String(role?.label || ''));
}

/** True for a role tab that holds District tutorials. */
export function isDistrictRole(role) {
  return /\bdistricts?\b|chief\s+education\s+officer|\bceo\b/i.test(String(role?.label || ''));
}

/**
 * The role tabs one audience should see:
 *   'beo'      -> tabs labelled BEO
 *   'school'   -> tabs labelled School
 *   'district' -> tabs labelled District
 *   'public'   -> every other tab (never BEO, School or District)
 */
export function rolesForAudience(roles, audience) {
  if (audience === 'beo') return roles.filter((role) => isBeoRole(role));
  if (audience === 'school') return roles.filter((role) => isSchoolRole(role));
  if (audience === 'district') return roles.filter((role) => isDistrictRole(role));
  return roles.filter((role) => !isBeoRole(role) && !isSchoolRole(role) && !isDistrictRole(role));
}

export function isValidYoutubeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return parsed.protocol === 'https:' && (host === 'youtube.com' || host === 'youtu.be');
  } catch {
    return false;
  }
}

export function getYoutubeEmbedUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!isValidYoutubeUrl(value)) return '';

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }
    if (host === 'youtube.com') {
      if (url.pathname.startsWith('/embed/')) {
        const id = url.pathname.split('/embed/')[1]?.split('/')[0];
        return id ? `https://www.youtube.com/embed/${id}` : '';
      }
      const id = url.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }
  } catch {
    return '';
  }

  return '';
}
