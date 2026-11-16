import { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, get } from './apiClient.js';
import { PublicTopNav } from './PublicTopNav.jsx';

const FALLBACK_SECTION = {
  title: 'Publications',
  subtitle: 'Download research papers, manuals, and publication PDFs',
  metadata_json: {
    items: [],
  },
};

function getFileName(item) {
  if (item.file_name) return item.file_name;
  if (item.file_url || item.file_path) {
    const parts = String(item.file_url || item.file_path).split('/');
    return parts[parts.length - 1];
  }
  return 'PDF Document';
}

export function PublicationsPage() {
  const [section, setSection] = useState(FALLBACK_SECTION);

  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        const data = await get('/api/public/cms/page/publications');
        const documentsSection = (data?.sections || []).find((item) => item.section_name === 'documents');
        if (mounted && documentsSection) {
          setSection({
            ...FALLBACK_SECTION,
            ...documentsSection,
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

  const documents = useMemo(
    () => section?.metadata_json?.items || [],
    [section]
  );

  return (
    <div className="landing-root">
      <PublicTopNav activeTab="Publications" />

      <main className="landing-main">
        <section className="public-docs-section">
          <div className="public-docs-container">
            <div className="public-docs-header">
              <h1 className="public-docs-title">{section.title || 'Publications'}</h1>
              {section.subtitle ? (
                <p className="public-docs-subtitle">{section.subtitle}</p>
              ) : null}
            </div>

            {documents.length === 0 ? (
              <div className="public-docs-empty">
                No publication PDFs have been uploaded yet.
              </div>
            ) : (
              <div className="public-docs-grid">
                {documents.map((item, index) => (
                  <div key={`publication-${index}`} className="public-doc-card">
                    {item.thumbnail_url ? (
                      <div className="public-doc-card-thumb">
                        <img src={buildApiUrl(item.thumbnail_url)} alt="Thumbnail" />
                      </div>
                    ) : null}
                    
                    <h3 className="public-doc-card-title">{item.title || getFileName(item)}</h3>
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
