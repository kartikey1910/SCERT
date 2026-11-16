import { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const SECTION_TABS = [
  { key: 'hero_slider', label: 'Hero Slider' },
  { key: 'notice_bar', label: 'Notice Bar' },
  { key: 'about_home', label: 'About Section' },
  { key: 'useful_links', label: 'Useful Links' },
  { key: 'faq', label: 'FAQ' },
];

const EMPTY_SECTION = {
  title: '',
  subtitle: '',
  description: '',
  image_url: '',
  image_path: '',
  button_text: '',
  button_link: '',
  metadata_json: {},
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSection(section) {
  return {
    ...EMPTY_SECTION,
    ...section,
    metadata_json: section?.metadata_json || {},
  };
}

function TextInput({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="cms-field">
      <span className="cms-field-label">{label}</span>
      <input
        type="text"
        className="cms-input"
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 6, placeholder = '' }) {
  return (
    <label className="cms-field">
      <span className="cms-field-label">{label}</span>
      <textarea
        className="cms-textarea"
        rows={rows}
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function normalizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '#') return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  return `https://${raw}`;
}

function getFaqContact(section) {
  return {
    title: section?.metadata_json?.contact?.title || '',
    address: section?.metadata_json?.contact?.address || '',
    email: section?.metadata_json?.contact?.email || '',
    mobile: section?.metadata_json?.contact?.mobile || '',
    social_links: Array.isArray(section?.metadata_json?.contact?.social_links)
      ? section.metadata_json.contact.social_links
      : [],
  };
}

export function ScertHomePageCms() {
  const { auth } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('notice_bar');
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadSections = async () => {
      try {
        setLoading(true);
        const data = await get('/api/scert/cms/homepage', { token: auth.token });
        if (!mounted) return;
        const mapped = {};
        for (const section of data?.sections || []) {
          mapped[section.section_name] = normalizeSection(section);
        }
        setSections(mapped);
      } catch (err) {
        toast.error(toast.getErrorMessage(err, 'Failed to load Home Page CMS.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSections();
    return () => {
      mounted = false;
    };
  }, [auth.token, toast]);

  const currentSection = useMemo(
    () => normalizeSection(sections[activeTab]),
    [sections, activeTab]
  );

  const updateSection = (updater) => {
    setSections((prev) => {
      const next = deepClone(prev);
      next[activeTab] = updater(normalizeSection(next[activeTab]));
      return next;
    });
  };

  const updateField = (field, value) => {
    updateSection((section) => ({ ...section, [field]: value }));
  };

  const updateItems = (items) => {
    updateSection((section) => ({
      ...section,
      metadata_json: {
        ...(section.metadata_json || {}),
        items,
      },
    }));
  };

  const items = currentSection?.metadata_json?.items || [];
  const faqContact = activeTab === 'faq' ? getFaqContact(currentSection) : null;

  const addItem = () => {
    if (activeTab === 'useful_links') {
      updateItems([...items, { label: '', link: '' }]);
      return;
    }

    if (activeTab === 'faq') {
      updateItems([...items, { question: '', answer: '' }]);
    }
  };

  const updateItemField = (index, field, value) => {
    const nextItems = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item
    );
    updateItems(nextItems);
  };

  const removeItem = (index) => {
    updateItems(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateFaqContactField = (field, value) => {
    updateSection((section) => ({
      ...section,
      metadata_json: {
        ...(section.metadata_json || {}),
        contact: {
          ...getFaqContact(section),
          [field]: value,
        },
      },
    }));
  };

  const updateFaqSocialLinks = (links) => {
    updateSection((section) => ({
      ...section,
      metadata_json: {
        ...(section.metadata_json || {}),
        contact: {
          ...getFaqContact(section),
          social_links: links,
        },
      },
    }));
  };

  const addFaqSocialLink = () => {
    updateFaqSocialLinks([...(faqContact?.social_links || []), { label: '', link: '' }]);
  };

  const updateFaqSocialLinkField = (index, field, value) => {
    updateFaqSocialLinks(
      (faqContact?.social_links || []).map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  };

  const removeFaqSocialLink = (index) => {
    updateFaqSocialLinks((faqContact?.social_links || []).filter((_, itemIndex) => itemIndex !== index));
  };

  const handleImageUpload = async (file) => {
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('image', file);
      formData.append('section_name', activeTab);

      const res = await fetch(buildApiUrl('/api/scert/cms/upload-image'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
        body: formData,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || 'Failed to upload CMS image.');
      }

      updateSection((section) => ({
        ...section,
        image_path: data.image_path || '',
        image_url: data.image_url || '',
      }));
      toast.success('Image uploaded successfully.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to upload image.'));
    } finally {
      setUploading(false);
    }
  };

  // ---- Hero slider: a list of uploaded slides (image + description) ----
  const MAX_SLIDES = 10;
  const isHeroSlider = activeTab === 'hero_slider';

  const uploadSlideImage = async (file) => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('section_name', 'hero_slider');
    const res = await fetch(buildApiUrl('/api/scert/cms/upload-image'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
      body: formData,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'Failed to upload the image.');
    return data;
  };

  /** index === null adds a new slide; otherwise the slide at index gets a new image. */
  const handleSlideUpload = async (file, index = null) => {
    if (!file) return;
    try {
      setUploading(true);
      const data = await uploadSlideImage(file);
      if (index === null) {
        updateItems([
          ...items,
          { image_path: data.image_path || '', image_url: data.image_url || '', alt: '' },
        ]);
      } else {
        updateItems(
          items.map((item, i) =>
            i === index ? { ...item, image_path: data.image_path || '', image_url: data.image_url || '' } : item
          )
        );
      }
      toast.success('Image uploaded. Click Save / Update to publish it.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to upload image.'));
    } finally {
      setUploading(false);
    }
  };

  const moveSlide = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    updateItems(next);
  };

  const renderHeroSliderEditor = () => (
    <div className="cms-repeatable">
      <div className="cms-repeatable-header">
        <h3 className="cms-block-title">Slides ({items.length}/{MAX_SLIDES})</h3>
        <label className="cms-upload-btn" aria-disabled={uploading || items.length >= MAX_SLIDES}>
          {uploading ? 'Uploading...' : 'Add Slide (Upload Image)'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            disabled={uploading || items.length >= MAX_SLIDES}
            onChange={(e) => {
              handleSlideUpload(e.target.files?.[0]);
              e.target.value = '';
            }}
            hidden
          />
        </label>
      </div>

      <p className="cms-panel-note">
        Landscape photos work best: about 1900 &times; 560 px (the slider crops to a wide band). JPG, PNG or
        WebP. Slides play in the order shown here. With no slides, the home page keeps its built-in images.
      </p>

      {items.length === 0 ? (
        <div className="cms-empty-state">No slides added yet. The home page is showing its built-in images.</div>
      ) : null}

      {items.map((item, index) => (
        <div key={`hero-slide-${index}-${item.image_path}`} className="cms-repeatable-card">
          <div className="cms-repeatable-toolbar">
            <span className="cms-item-index">Slide {index + 1}</span>
            <span style={{ display: 'flex', gap: '0.4rem' }}>
              <button type="button" className="cms-mini-btn" onClick={() => moveSlide(index, -1)} disabled={index === 0}>
                Move Up
              </button>
              <button
                type="button"
                className="cms-mini-btn"
                onClick={() => moveSlide(index, 1)}
                disabled={index === items.length - 1}
              >
                Move Down
              </button>
              <label className="cms-mini-btn" style={{ cursor: 'pointer' }}>
                Replace Image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  disabled={uploading}
                  onChange={(e) => {
                    handleSlideUpload(e.target.files?.[0], index);
                    e.target.value = '';
                  }}
                  hidden
                />
              </label>
              <button type="button" className="cms-danger-btn" onClick={() => removeItem(index)}>
                Remove
              </button>
            </span>
          </div>

          {item.image_url ? (
            <div className="cms-image-preview-wrap">
              <img src={buildApiUrl(item.image_url)} alt={item.alt || `Slide ${index + 1}`} className="cms-image-preview" />
            </div>
          ) : null}

          <TextInput
            label="Description (for screen readers)"
            value={item.alt}
            onChange={(value) => updateItemField(index, 'alt', value)}
            placeholder="e.g. SCERT Uttarakhand headquarters, Dehradun"
          />
        </div>
      ))}
    </div>
  );

  const handleSave = async () => {
    try {
      setSaving(true);

      const normalizedMetadata = activeTab === 'useful_links'
        ? {
            ...(currentSection.metadata_json || {}),
            items: (items || []).map((item) => ({
              ...item,
              link: normalizeExternalUrl(item.link),
            })),
          }
        : currentSection.metadata_json || {};

      const payload = {
        title: currentSection.title || '',
        subtitle: currentSection.subtitle || '',
        description: currentSection.description || '',
        image_path: currentSection.image_path || null,
        button_text: currentSection.button_text || '',
        button_link: currentSection.button_link || '',
        metadata_json: normalizedMetadata,
      };

      const data = await put(`/api/scert/cms/homepage/${activeTab}`, payload, {
        token: auth.token,
      });

      setSections((prev) => ({
        ...prev,
        [activeTab]: normalizeSection(data.section),
      }));
      toast.success('Home page section updated successfully.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to update section.'));
    } finally {
      setSaving(false);
    }
  };

  const renderItemEditor = () => {
    if (!['useful_links', 'faq'].includes(activeTab)) return null;

    return (
      <div className="cms-repeatable">
        <div className="cms-repeatable-header">
          <h3 className="cms-block-title">Items</h3>
          <button type="button" className="cms-mini-btn" onClick={addItem}>
            Add Item
          </button>
        </div>

        {items.length === 0 ? (
          <div className="cms-empty-state">No items added yet.</div>
        ) : null}

        {items.map((item, index) => (
          <div key={`${activeTab}-item-${index}`} className="cms-repeatable-card">
            <div className="cms-repeatable-toolbar">
              <span className="cms-item-index">Item {index + 1}</span>
              <button
                type="button"
                className="cms-danger-btn"
                onClick={() => removeItem(index)}
              >
                Remove
              </button>
            </div>

            {activeTab === 'useful_links' ? (
              <div className="cms-grid cms-grid--2">
                <TextInput
                  label="Label"
                  value={item.label}
                  onChange={(value) => updateItemField(index, 'label', value)}
                  placeholder="E-BOOKS"
                />
                <TextInput
                  label="Link"
                  value={item.link}
                  onChange={(value) => updateItemField(index, 'link', value)}
                  placeholder="https://..."
                />
              </div>
            ) : null}

            {activeTab === 'faq' ? (
              <div className="cms-grid cms-grid--1">
                <TextInput
                  label="Question"
                  value={item.question}
                  onChange={(value) => updateItemField(index, 'question', value)}
                  placeholder="Enter FAQ question"
                />
                <TextArea
                  label="Answer"
                  value={item.answer}
                  onChange={(value) => updateItemField(index, 'answer', value)}
                  rows={5}
                  placeholder="Enter FAQ answer"
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderFaqContactEditor = () => {
    if (activeTab !== 'faq') return null;

    return (
      <div className="cms-repeatable">
        <div className="cms-repeatable-header">
          <h3 className="cms-block-title">Contact Section</h3>
          <button type="button" className="cms-mini-btn" onClick={addFaqSocialLink}>
            Add Social Link
          </button>
        </div>

        <div className="cms-grid cms-grid--2">
          <TextInput
            label="Contact Title"
            value={faqContact?.title}
            onChange={(value) => updateFaqContactField('title', value)}
            placeholder="Contact Us"
          />
          <TextInput
            label="Email"
            value={faqContact?.email}
            onChange={(value) => updateFaqContactField('email', value)}
            placeholder="scert-uk@nic.in"
          />
          <TextArea
            label="Address"
            value={faqContact?.address}
            onChange={(value) => updateFaqContactField('address', value)}
            rows={4}
            placeholder="State Council of Educational Research & Training, Uttarakhand, Dehradun"
          />
          <TextInput
            label="Mobile Number"
            value={faqContact?.mobile}
            onChange={(value) => updateFaqContactField('mobile', value)}
            placeholder="0135-2789655"
          />
        </div>

        <div className="cms-repeatable">
          <div className="cms-repeatable-header">
            <h4 className="cms-block-title">Social Links</h4>
          </div>

          {(faqContact?.social_links || []).length === 0 ? (
            <div className="cms-empty-state">No social links added yet.</div>
          ) : null}

          {(faqContact?.social_links || []).map((item, index) => (
            <div key={`faq-social-link-${index}`} className="cms-repeatable-card">
              <div className="cms-repeatable-toolbar">
                <span className="cms-item-index">Link {index + 1}</span>
                <button
                  type="button"
                  className="cms-danger-btn"
                  onClick={() => removeFaqSocialLink(index)}
                >
                  Remove
                </button>
              </div>

              <div className="cms-grid cms-grid--2">
                <TextInput
                  label="Label"
                  value={item.label}
                  onChange={(value) => updateFaqSocialLinkField(index, 'label', value)}
                  placeholder="Facebook"
                />
                <TextInput
                  label="Link"
                  value={item.link}
                  onChange={(value) => updateFaqSocialLinkField(index, 'link', value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="cms-page">
        <div className="cms-panel">
          <div className="cms-loading">Loading Home Page CMS...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cms-page">
      <div className="cms-page-header">
        <div>
          <h1 className="cms-page-title">Home Page CMS</h1>
          <p className="cms-page-subtitle">
            Update public home page sections here. Saved content reflects on the landing page.
          </p>
        </div>
      </div>

      <div className="cms-layout">
        <aside className="cms-tabs">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? 'cms-tab cms-tab-active' : 'cms-tab'}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </aside>

        <section className="cms-panel">
          <div className="cms-panel-top">
            <div>
              <h2 className="cms-panel-title">
                {SECTION_TABS.find((tab) => tab.key === activeTab)?.label}
              </h2>
              <p className="cms-panel-note">
                Section key: <code>{activeTab}</code>
              </p>
            </div>

            <button
              type="button"
              className="cms-save-btn"
              onClick={handleSave}
              disabled={saving || uploading}
            >
              {saving ? 'Saving...' : 'Save / Update'}
            </button>
          </div>

          {isHeroSlider ? (
            renderHeroSliderEditor()
          ) : (
            <>
          <div className="cms-grid cms-grid--2">
            <TextInput
              label="Title"
              value={currentSection.title}
              onChange={(value) => updateField('title', value)}
            />
            <TextInput
              label="Subtitle"
              value={currentSection.subtitle}
              onChange={(value) => updateField('subtitle', value)}
            />
            <TextInput
              label="Button Text"
              value={currentSection.button_text}
              onChange={(value) => updateField('button_text', value)}
            />
            <TextInput
              label="Button Link"
              value={currentSection.button_link}
              onChange={(value) => updateField('button_link', value)}
            />
          </div>

          <TextArea
            label="Description"
            value={currentSection.description}
            onChange={(value) => updateField('description', value)}
            rows={activeTab === 'about_home' ? 14 : 5}
          />

          <div className="cms-image-block">
            <div className="cms-image-header">
              <h3 className="cms-block-title">Section Image</h3>
              <label className="cms-upload-btn">
                {uploading ? 'Uploading...' : 'Upload / Replace Image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(e) => handleImageUpload(e.target.files?.[0])}
                  hidden
                />
              </label>
            </div>

            {currentSection.image_url ? (
              <div className="cms-image-preview-wrap">
                <img
                  src={currentSection.image_url}
                  alt={`${activeTab} preview`}
                  className="cms-image-preview"
                />
              </div>
            ) : (
              <div className="cms-empty-state">No image uploaded for this section.</div>
            )}
          </div>

          {renderItemEditor()}
          {renderFaqContactEditor()}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
