import { useEffect, useMemo, useState } from 'react';
import { generatePdfThumbnail } from './utils/pdfThumbnail.js';
import { buildApiUrl, get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const FALLBACK_SECTION = {
  title: '',
  subtitle: '',
  description: '',
  metadata_json: {
    items: [],
  },
};

function getDisplayFileName(item) {
  if (item?.file_name) return item.file_name;
  if (item?.file_url || item?.file_path) {
    const parts = String(item.file_url || item.file_path).split('/');
    return parts[parts.length - 1] || 'Uploaded PDF';
  }
  return 'No file uploaded yet';
}

export function ScertPublicationsCms() {
  const { auth } = useAuth();
  const toast = useToast();
  const [section, setSection] = useState(FALLBACK_SECTION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadSection = async () => {
      try {
        setLoading(true);
        const data = await get('/api/scert/cms/page/publications/documents', {
          token: auth.token,
        });
        if (mounted) {
          setSection({
            ...FALLBACK_SECTION,
            ...data,
            metadata_json: data?.metadata_json || { items: [] },
          });
        }
      } catch (err) {
        toast.error(toast.getErrorMessage(err, 'Failed to load Publications CMS.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSection();
    return () => {
      mounted = false;
    };
  }, [auth.token]);

  const items = useMemo(() => section?.metadata_json?.items || [], [section]);

  const updateItems = (nextItems) => {
    setSection((prev) => ({
      ...prev,
      metadata_json: {
        ...(prev.metadata_json || {}),
        items: nextItems,
      },
    }));
  };

  const addItem = () => {
    updateItems([
      ...items,
      {
        title: '',
        description: '',
        file_name: '',
        file_path: '',
        file_url: '',
      },
    ]);
  };

  const updateItemField = (index, field, value) => {
    updateItems(
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  };

  const removeItem = (index) => {
    updateItems(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleUpload = async (index, file) => {
    if (!file) return;

    try {
      setUploadingIndex(index);

      let thumbnailUrl = '';
      if (file.type === 'application/pdf') {
        try {
          const thumbnailBlob = await generatePdfThumbnail(file);
          if (thumbnailBlob) {
            const thumbFormData = new FormData();
            thumbFormData.append('image', thumbnailBlob, 'thumbnail.jpg');
            thumbFormData.append('page_name', 'publications');
            thumbFormData.append('section_name', 'documents');
            const thumbRes = await fetch(buildApiUrl('/api/scert/cms/upload-image'), {
              method: 'POST',
              headers: { Authorization: `Bearer ${auth.token}` },
              body: thumbFormData,
            });
            const thumbData = await thumbRes.json().catch(() => null);
            if (thumbRes.ok && thumbData?.image_url) {
              thumbnailUrl = thumbData.image_url;
            }
          }
        } catch (err) {
          console.warn('Failed to generate/upload thumbnail', err);
        }
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('page_name', 'publications');
      formData.append('section_name', 'documents');

      const res = await fetch(buildApiUrl('/api/scert/cms/upload-file'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || 'Failed to upload publication PDF.');
      }
      if (!data?.file_path || !data?.file_url) {
        throw new Error('Upload completed but file URL was not returned by the server.');
      }

      setSection((prev) => {
        const prevItems = prev?.metadata_json?.items || [];
        return {
          ...prev,
          metadata_json: {
            ...(prev.metadata_json || {}),
            items: prevItems.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    file_name: data.file_name || file.name,
                    file_path: data.file_path || '',
                    file_url: data.file_url || '',
                    thumbnail_url: thumbnailUrl || (file.type.startsWith('image/') ? data.file_url : ''),
                  }
                : item
            ),
          },
        };
      });
      toast.success('Publication PDF uploaded successfully.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to upload publication PDF.'));
    } finally {
      setUploadingIndex(null);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const data = await put(
        '/api/scert/cms/page/publications/documents',
        {
          title: section.title || '',
          subtitle: section.subtitle || '',
          description: section.description || '',
          image_path: null,
          button_text: '',
          button_link: '',
          metadata_json: {
            items,
          },
        },
        { token: auth.token }
      );

      setSection({
        ...FALLBACK_SECTION,
        ...data.section,
        metadata_json: data?.section?.metadata_json || { items: [] },
      });
      toast.success('Publications page updated successfully.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to update Publications page.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cms-page">
        <div className="cms-panel">
          <div className="cms-loading">Loading Publications CMS...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cms-page">
      <div className="cms-page-header">
        <div>
          <h1 className="cms-page-title">Publications CMS</h1>
          <p className="cms-page-subtitle">
            Upload and manage downloadable PDF files for the public Publications page.
          </p>
        </div>
      </div>

      <section className="cms-panel">
        <div className="cms-panel-top">
          <div>
            <h2 className="cms-panel-title">PDF Files</h2>
            <p className="cms-panel-note">
              Add one or more publication PDFs and save the list to publish them on the public page.
            </p>
          </div>

          <button
            type="button"
            className="cms-save-btn"
            onClick={handleSave}
            disabled={saving || uploadingIndex !== null}
          >
            {saving ? 'Saving...' : 'Save / Update'}
          </button>
        </div>

        <div className="cms-repeatable">
          <div className="cms-repeatable-header">
            <h3 className="cms-block-title">Publication Files</h3>
            <button type="button" className="cms-mini-btn" onClick={addItem}>
              Add PDF
            </button>
          </div>

          {items.length === 0 ? (
            <div className="cms-empty-state">No publication PDFs added yet.</div>
          ) : null}

          {items.map((item, index) => (
            <div key={`publication-item-${index}`} className="cms-repeatable-card">
              <div className="cms-repeatable-toolbar">
                <span className="cms-item-index">PDF {index + 1}</span>
                <button
                  type="button"
                  className="cms-danger-btn"
                  onClick={() => removeItem(index)}
                >
                  Remove
                </button>
              </div>

              <div className="cms-grid cms-grid--2">
                <label className="cms-field">
                  <span className="cms-field-label">Document Title</span>
                  <input
                    type="text"
                    className="cms-input"
                    value={item.title || ''}
                    onChange={(e) => updateItemField(index, 'title', e.target.value)}
                    placeholder="Annual Research Bulletin"
                  />
                </label>

                <label className="cms-field">
                  <span className="cms-field-label">Description</span>
                  <input
                    type="text"
                    className="cms-input"
                    value={item.description || ''}
                    onChange={(e) => updateItemField(index, 'description', e.target.value)}
                    placeholder="Optional short note"
                  />
                </label>
              </div>

              <div className="cms-file-row">
                <div className="cms-file-meta">
                  <div className="cms-file-name">{getDisplayFileName(item)}</div>
                  {item.file_url || item.file_path ? (
                    <a
                      href={buildApiUrl(item.file_url || item.file_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cms-file-link"
                    >
                      View uploaded PDF
                    </a>
                  ) : null}
                </div>

                <label className="cms-upload-btn">
                  {uploadingIndex === index ? 'Uploading...' : (item.file_url || item.file_path) ? 'Replace PDF' : 'Upload PDF'}
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => handleUpload(index, e.target.files?.[0])}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
