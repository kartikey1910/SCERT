import { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, get } from './apiClient.js';
import { PublicTopNav } from './PublicTopNav.jsx';

const FALLBACK_SECTION = {
  title: 'Important Circulars & GOs',
  subtitle: 'Latest notices, results, and circular updates',
  metadata_json: {
    items: [],
  },
};

function badgeClassName(variant) {
  if (variant === 'results') return 'public-doc-icon public-doc-icon-results';
  if (variant === 'circular') return 'public-doc-icon public-doc-icon-circular';
  return 'public-doc-icon public-doc-icon-notice';
}

export function AnnouncementsPage() {
  const [section, setSection] = useState(FALLBACK_SECTION);

  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        const data = await get('/api/public/cms/page/announcements_page');
        const listSection = (data?.sections || []).find((item) => item.section_name === 'list');
        if (mounted && listSection) {
          setSection({
            ...FALLBACK_SECTION,
            ...listSection,
          });
        }
      } catch (_) {
        if (mounted) setSection(FALLBACK_SECTION);
      }
    };

    loadContent();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const items = useMemo(
    () => section?.metadata_json?.items || [],
    [section]
  );

  return (
    <div className="landing-root">
      <PublicTopNav activeTab="Announcements" />

      <main className="landing-main">
        <section className="public-announcements-section">
          <div className="public-announcements-container">
            <div className="public-announcements-header">
              <h1 className="public-announcements-title">{section.title || 'Announcements'}</h1>
              {section.subtitle ? (
                <p className="public-announcements-subtitle">{section.subtitle}</p>
              ) : null}
            </div>

            {items.length === 0 ? (
              <div className="public-docs-empty">No announcements have been added yet.</div>
            ) : (
              <div className="public-docs-grid">
                {items.map((item, index) => (
                  <div key={`announcement-${index}`} className="public-doc-card">
                    {item.thumbnail_url ? (
                      <div className="public-doc-card-thumb">
                        <img src={buildApiUrl(item.thumbnail_url)} alt="Thumbnail" />
                      </div>
                    ) : null}
                    
                    <div className="public-doc-card-top">
                      {item.badge ? (
                        <span className={badgeClassName(item.badge_variant)}>{item.badge}</span>
                      ) : (
                        <span className="public-doc-icon">NOTICE</span>
                      )}
                      <span className="public-doc-index">
                        {item.day ? `${item.day} ` : ''}{item.month || ''}
                      </span>
                    </div>
                    <h3 className="public-doc-card-title">{item.title || 'Untitled Announcement'}</h3>
                    {item.description ? (
                      <p className="public-doc-card-text">{item.description}</p>
                    ) : null}
                    
                    {item.file_url || item.file_path ? (
                      <div className="public-doc-actions">
                        <a
                          className="public-doc-view-btn"
                          href={buildApiUrl(item.file_url || item.file_path)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View
                        </a>
                        <a
                          className="public-doc-download-btn"
                          href={`${buildApiUrl(item.file_url || item.file_path)}?download=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                        >
                          Download
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
