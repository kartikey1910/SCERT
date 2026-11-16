import { useEffect, useState } from 'react';
import { get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const FALLBACK_SECTION = {
  title: '',
  subtitle: '',
  description: '',
  image_url: '',
  image_path: '',
  button_text: '',
  button_link: '',
  metadata_json: {},
};

export function ScertAboutPageCms() {
  const { auth } = useAuth();
  const toast = useToast();
  const [section, setSection] = useState(FALLBACK_SECTION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadSection = async () => {
      try {
        setLoading(true);
        const data = await get('/api/scert/cms/page/about_us/main_content', {
          token: auth.token,
        });
        if (mounted) {
          setSection({
            ...FALLBACK_SECTION,
            ...data,
            metadata_json: data?.metadata_json || {},
          });
        }
      } catch (err) {
        toast.error(toast.getErrorMessage(err, 'Failed to load About Page CMS.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSection();
    return () => {
      mounted = false;
    };
  }, [auth.token, toast]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const data = await put(
        '/api/scert/cms/page/about_us/main_content',
        {
          title: section.title || '',
          subtitle: section.subtitle || '',
          description: section.description || '',
          image_path: section.image_path || null,
          button_text: section.button_text || '',
          button_link: section.button_link || '',
          metadata_json: section.metadata_json || {},
        },
        { token: auth.token }
      );

      setSection({
        ...FALLBACK_SECTION,
        ...data.section,
        metadata_json: data?.section?.metadata_json || {},
      });
      toast.success('About page content updated successfully.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to update About page content.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cms-page">
        <div className="cms-panel">
          <div className="cms-loading">Loading About Page CMS...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cms-page">
      <div className="cms-page-header">
        <div>
          <h1 className="cms-page-title">About Page CMS</h1>
          <p className="cms-page-subtitle">
            Update the content shown on the public About Us page.
          </p>
        </div>
      </div>

      <section className="cms-panel">
        <div className="cms-panel-top">
          <div>
            <h2 className="cms-panel-title">About Us Content</h2>
            <p className="cms-panel-note">
              Use blank lines to separate paragraphs. The page will render the content as individual blocks.
            </p>
          </div>

          <button
            type="button"
            className="cms-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save / Update'}
          </button>
        </div>

        <div className="cms-grid cms-grid--2">
          <label className="cms-field">
            <span className="cms-field-label">Page Title</span>
            <input
              type="text"
              className="cms-input"
              value={section.title || ''}
              onChange={(e) => setSection((prev) => ({ ...prev, title: e.target.value }))}
            />
          </label>

          <label className="cms-field">
            <span className="cms-field-label">Hindi Subtitle</span>
            <input
              type="text"
              className="cms-input"
              value={section.subtitle || ''}
              onChange={(e) => setSection((prev) => ({ ...prev, subtitle: e.target.value }))}
            />
          </label>
        </div>

        <label className="cms-field" style={{ marginTop: '1.2rem' }}>
          <span className="cms-field-label">Page Content</span>
          <textarea
            className="cms-textarea"
            rows={20}
            value={section.description || ''}
            onChange={(e) => setSection((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Enter the About Us page content here..."
          />
        </label>
      </section>
    </div>
  );
}
