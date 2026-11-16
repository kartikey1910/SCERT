import { useEffect, useMemo, useState } from 'react';
import { get } from './apiClient.js';
import {
  normalizeRoles,
  rolesForAudience,
  isValidYoutubeUrl,
  getYoutubeEmbedUrl,
} from './utils/howToApplyGuide.js';

const DEFAULT_TITLE = 'How to Apply';
const DEFAULT_SUBTITLE = 'Step-by-step video guides for each user role';

const EMPTY_TEXT = {
  public: 'No sections have been added for this role yet.',
  beo: 'No tutorials have been added for BEOs yet.',
  school: 'No tutorials have been added for Schools yet.',
  district: 'No tutorials have been added for Districts yet.',
};

/**
 * The How to Apply guide: page heading, one tab per CMS role, and a card with
 * an embedded video for each section.
 *
 * `audience` picks which of the CMS role tabs are shown - 'public' for the
 * public page (every tab except BEO, School and District), 'beo' for the BEO
 * dashboard (BEO tabs only), 'school' for the School dashboard (School tabs
 * only), 'district' for the District dashboard (District tabs only). See
 * utils/howToApplyGuide.js. `embedded` drops the page-level padding for use
 * inside a dashboard.
 */
export function HowToApplyGuide({ audience = 'public', embedded = false }) {
  const [guide, setGuide] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeRoleId, setActiveRoleId] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        const data = await get('/api/public/cms/page/how_to_apply');
        const guideSection = (data?.sections || []).find((item) => item.section_name === 'guide');
        if (mounted) setGuide(guideSection || null);
      } catch {
        // Say so, rather than showing the "no tutorials yet" text for a page
        // that simply could not be fetched.
        if (mounted) {
          setGuide(null);
          setFailed(true);
        }
      } finally {
        if (mounted) setLoaded(true);
      }
    };

    loadContent();
    return () => {
      mounted = false;
    };
  }, []);

  const roles = useMemo(
    () => rolesForAudience(normalizeRoles(guide?.metadata_json?.roles), audience),
    [guide, audience]
  );

  const activeRole = roles.find((role) => role.id === activeRoleId) || roles[0];

  return (
    <section className={`how-apply-page-section${embedded ? ' how-apply-page-section--embedded' : ''}`}>
      <div className="how-apply-page-container">
        <div className="how-apply-page-header">
          <h1 className="how-apply-page-title">{guide?.title || DEFAULT_TITLE}</h1>
          <p className="how-apply-page-subtitle">{guide?.subtitle || DEFAULT_SUBTITLE}</p>
        </div>

        {!loaded ? (
          <div className="how-apply-empty-state">Loading...</div>
        ) : failed ? (
          <div className="how-apply-empty-state">The guide could not be loaded. Please try again shortly.</div>
        ) : roles.length === 0 ? (
          <div className="how-apply-empty-state">{EMPTY_TEXT[audience] || EMPTY_TEXT.public}</div>
        ) : (
          <>
            <div className="how-apply-tabs" role="tablist" aria-label="How to apply roles">
              {roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className={`how-apply-tab ${activeRole?.id === role.id ? 'how-apply-tab-active' : ''}`}
                  onClick={() => setActiveRoleId(role.id)}
                >
                  {role.label}
                </button>
              ))}
            </div>

            {activeRole.sections.length === 0 ? (
              <div className="how-apply-empty-state">{EMPTY_TEXT[audience] || EMPTY_TEXT.public}</div>
            ) : (
              <div className="how-apply-sections">
                {activeRole.sections.map((item, index) => {
                  const embedUrl = getYoutubeEmbedUrl(item.youtube_url);
                  return (
                    <article key={`${activeRole.id}-${index}`} className="how-apply-video-card">
                      <div className="how-apply-video-copy">
                        <span className="how-apply-video-index">Section {String(index + 1).padStart(2, '0')}</span>
                        <h2 className="how-apply-video-heading">{item.heading || `Section ${index + 1}`}</h2>
                        {isValidYoutubeUrl(item.youtube_url) ? (
                          <a
                            className="how-apply-video-link"
                            href={item.youtube_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open video on YouTube
                          </a>
                        ) : null}
                      </div>

                      <div className="how-apply-video-frame-wrap">
                        {embedUrl ? (
                          <iframe
                            className="how-apply-video-frame"
                            src={embedUrl}
                            title={`${activeRole.label} - ${item.heading || `Section ${index + 1}`}`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerPolicy="strict-origin-when-cross-origin"
                            allowFullScreen
                          />
                        ) : (
                          <div className="how-apply-video-placeholder">
                            Add a valid YouTube link in CMS to show the video here.
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
