import { useEffect, useMemo, useState } from 'react';
import { get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { isBeoRole, isSchoolRole, isDistrictRole } from './utils/howToApplyGuide.js';

const FALLBACK_SECTION = {
  title: 'How to Apply',
  subtitle: 'Step-by-step video guides for each user role',
  description: '',
  metadata_json: {
    roles: [
      {
        id: 'school',
        label: 'School',
        sections: [
          {
            heading: '',
            youtube_url: '',
          },
        ],
      },
    ],
  },
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'role';
}

function createRole(label = '') {
  return {
    id: `${slugify(label || 'role')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: label || 'New Role',
    sections: [
      {
        heading: '',
        youtube_url: '',
      },
    ],
  };
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return FALLBACK_SECTION.metadata_json.roles;
  }

  return roles.map((role, index) => ({
    id: role?.id || `${slugify(role?.label)}-${index + 1}`,
    label: role?.label || `Role ${index + 1}`,
    sections: Array.isArray(role?.sections) && role.sections.length > 0
      ? role.sections.map((section) => ({
          heading: section?.heading || '',
          youtube_url: section?.youtube_url || '',
        }))
      : [
          {
            heading: '',
            youtube_url: '',
          },
        ],
  }));
}

export function ScertHowToApplyCms() {
  const { auth } = useAuth();
  const toast = useToast();
  const [section, setSection] = useState(FALLBACK_SECTION);
  const [activeRoleId, setActiveRoleId] = useState(FALLBACK_SECTION.metadata_json.roles[0].id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadSection = async () => {
      try {
        setLoading(true);
        const data = await get('/api/scert/cms/page/how_to_apply/guide', {
          token: auth.token,
        });
        if (mounted) {
          const roles = normalizeRoles(data?.metadata_json?.roles);
          setSection({
            ...FALLBACK_SECTION,
            ...data,
            metadata_json: {
              ...(data?.metadata_json || {}),
              roles,
            },
          });
          setActiveRoleId(roles[0]?.id || FALLBACK_SECTION.metadata_json.roles[0].id);
        }
      } catch (err) {
        toast.error(toast.getErrorMessage(err, 'Failed to load How to Apply CMS.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSection();
    return () => {
      mounted = false;
    };
  }, [auth.token]);

  const roles = useMemo(
    () => normalizeRoles(section?.metadata_json?.roles),
    [section]
  );

  useEffect(() => {
    if (!roles.some((role) => role.id === activeRoleId)) {
      setActiveRoleId(roles[0]?.id || FALLBACK_SECTION.metadata_json.roles[0].id);
    }
  }, [roles, activeRoleId]);

  const activeRoleIndex = roles.findIndex((role) => role.id === activeRoleId);
  const activeRole = activeRoleIndex >= 0 ? roles[activeRoleIndex] : roles[0];

  const updateRoles = (nextRoles, nextActiveRoleId = activeRoleId) => {
    const normalized = normalizeRoles(nextRoles);
    setSection((prev) => ({
      ...prev,
      metadata_json: {
        ...(prev.metadata_json || {}),
        roles: normalized,
      },
    }));
    setActiveRoleId(nextActiveRoleId || normalized[0]?.id || FALLBACK_SECTION.metadata_json.roles[0].id);
  };

  const updateRoleField = (index, field, value) => {
    const nextRoles = roles.map((role, roleIndex) => {
      if (roleIndex !== index) return role;
      const nextLabel = field === 'label' ? value : role.label;
      return {
        ...role,
        [field]: value,
        id: field === 'label' ? `${slugify(nextLabel)}-${role.id.split('-').slice(-2).join('-')}` : role.id,
      };
    });
    updateRoles(nextRoles, nextRoles[index]?.id);
  };

  const addRole = () => {
    const nextRole = createRole(`Role ${roles.length + 1}`);
    updateRoles([...roles, nextRole], nextRole.id);
  };

  const removeRole = (index) => {
    const nextRoles = roles.filter((_, roleIndex) => roleIndex !== index);
    updateRoles(nextRoles, nextRoles[Math.max(0, index - 1)]?.id);
  };

  const addSection = () => {
    if (!activeRole) return;
    const nextRoles = roles.map((role) =>
      role.id === activeRole.id
        ? {
            ...role,
            sections: [
              ...role.sections,
              {
                heading: '',
                youtube_url: '',
              },
            ],
          }
        : role
    );
    updateRoles(nextRoles, activeRole.id);
  };

  const updateSectionField = (sectionIndex, field, value) => {
    if (!activeRole) return;
    const nextRoles = roles.map((role) =>
      role.id === activeRole.id
        ? {
            ...role,
            sections: role.sections.map((section, index) =>
              index === sectionIndex ? { ...section, [field]: value } : section
            ),
          }
        : role
    );
    updateRoles(nextRoles, activeRole.id);
  };

  const removeSection = (sectionIndex) => {
    if (!activeRole) return;
    const nextRoles = roles.map((role) =>
      role.id === activeRole.id
        ? {
            ...role,
            sections: role.sections.filter((_, index) => index !== sectionIndex),
          }
        : role
    );
    updateRoles(nextRoles, activeRole.id);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const data = await put(
        '/api/scert/cms/page/how_to_apply/guide',
        {
          title: section.title || '',
          subtitle: section.subtitle || '',
          description: section.description || '',
          image_path: null,
          button_text: '',
          button_link: '',
          metadata_json: {
            roles: roles.map((role) => ({
              id: role.id,
              label: role.label || '',
              sections: (role.sections || []).map((item) => ({
                heading: item.heading || '',
                youtube_url: item.youtube_url || '',
              })),
            })),
          },
        },
        { token: auth.token }
      );

      const nextRoles = normalizeRoles(data?.section?.metadata_json?.roles);
      setSection({
        ...FALLBACK_SECTION,
        ...data.section,
        metadata_json: {
          ...(data?.section?.metadata_json || {}),
          roles: nextRoles,
        },
      });
      setActiveRoleId(nextRoles[0]?.id || FALLBACK_SECTION.metadata_json.roles[0].id);
      toast.success('How to Apply page updated successfully.');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to update How to Apply page.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cms-page">
        <div className="cms-panel">
          <div className="cms-loading">Loading How to Apply CMS...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cms-page">
      <div className="cms-page-header">
        <div>
          <h1 className="cms-page-title">How to Apply CMS</h1>
          <p className="cms-page-subtitle">
            Manage role tabs and step-by-step YouTube video sections. Tabs shown to the public go on the How to Apply page; a tab labelled BEO goes to the Tutorial tab in the BEO dashboard, a tab labelled School goes to the Tutorial tab in the School dashboard, and a tab labelled District goes to the Tutorial tab in the District dashboard.
          </p>
        </div>
      </div>

      <section className="cms-panel">
        <div className="cms-panel-top">
          <div>
            <h2 className="cms-panel-title">Page Content</h2>
            <p className="cms-panel-note">
              Add role tabs, then add one or more titled YouTube video sections inside each tab.
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
              placeholder="How to Apply"
            />
          </label>

          <label className="cms-field">
            <span className="cms-field-label">Page Subtitle</span>
            <input
              type="text"
              className="cms-input"
              value={section.subtitle || ''}
              onChange={(e) => setSection((prev) => ({ ...prev, subtitle: e.target.value }))}
              placeholder="Step-by-step video guides for each user role"
            />
          </label>
        </div>

        <div className="cms-repeatable">
          <div className="cms-repeatable-header">
            <h3 className="cms-block-title">Role Tabs</h3>
            <button type="button" className="cms-mini-btn" onClick={addRole}>
              Add Role Tab
            </button>
          </div>

          <div className="cms-tabs">
            {roles.map((role, index) => (
              <button
                key={role.id}
                type="button"
                className={`cms-tab ${activeRole?.id === role.id ? 'cms-tab-active' : ''}`}
                onClick={() => setActiveRoleId(role.id)}
              >
                {role.label || `Role ${index + 1}`}
              </button>
            ))}
          </div>

          {activeRole ? (
            <div className="cms-repeatable-card">
              <div className="cms-repeatable-toolbar">
                <span className="cms-item-index">Active Tab</span>
                <button
                  type="button"
                  className="cms-danger-btn"
                  onClick={() => removeRole(activeRoleIndex)}
                  disabled={roles.length <= 1}
                >
                  Remove Role Tab
                </button>
              </div>

              <label className="cms-field">
                <span className="cms-field-label">Role Tab Label</span>
                <input
                  type="text"
                  className="cms-input"
                  value={activeRole.label || ''}
                  onChange={(e) => updateRoleField(activeRoleIndex, 'label', e.target.value)}
                  placeholder="District"
                />
                <span className="cms-field-hint">
                  {isBeoRole(activeRole)
                    ? 'Shown in the BEO dashboard (Tutorial tab) - not on the public page.'
                    : isSchoolRole(activeRole)
                      ? 'Shown in the School dashboard (Tutorial tab) - not on the public page.'
                      : isDistrictRole(activeRole)
                        ? 'Shown in the District dashboard (Tutorial tab) - not on the public page.'
                        : 'Shown on the public How to Apply page. Label the tab "BEO", "School" or "District" to show it in that dashboard instead.'}
                </span>
              </label>

              <div className="cms-repeatable" style={{ marginTop: '1rem' }}>
                <div className="cms-repeatable-header">
                  <h3 className="cms-block-title">Video Sections</h3>
                  <button type="button" className="cms-mini-btn" onClick={addSection}>
                    Add Section
                  </button>
                </div>

                {activeRole.sections.length === 0 ? (
                  <div className="cms-empty-state">No sections added for this role yet.</div>
                ) : null}

                {activeRole.sections.map((item, index) => (
                  <div key={`${activeRole.id}-section-${index}`} className="cms-repeatable-card">
                    <div className="cms-repeatable-toolbar">
                      <span className="cms-item-index">Section {index + 1}</span>
                      <button
                        type="button"
                        className="cms-danger-btn"
                        onClick={() => removeSection(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="cms-grid cms-grid--2">
                      <label className="cms-field">
                        <span className="cms-field-label">Section Heading</span>
                        <input
                          type="text"
                          className="cms-input"
                          value={item.heading || ''}
                          onChange={(e) => updateSectionField(index, 'heading', e.target.value)}
                          placeholder="School Registration and Login"
                        />
                      </label>

                      <label className="cms-field">
                        <span className="cms-field-label">YouTube Link</span>
                        <input
                          type="url"
                          className="cms-input"
                          value={item.youtube_url || ''}
                          onChange={(e) => updateSectionField(index, 'youtube_url', e.target.value)}
                          placeholder="https://www.youtube.com/watch?v=..."
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
