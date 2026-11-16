import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, post, put } from './apiClient.js';
import { HiOutlineTrash } from 'react-icons/hi';
import { useSession } from './scert.session-context.jsx';

export function ScertFormBuilder({ scholarshipId, onDoLater }) {
  const { auth } = useAuth();
  const { sessionId } = useSession();
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const getEmptyNewField = () => ({
    field_label: '',
    field_key: '',
    field_type: 'TEXT',
    is_required: false,
    placeholder: '',
    options: []
  });

  // New field form state
  const [newField, setNewField] = useState(getEmptyNewField);
  const [optionDraft, setOptionDraft] = useState({ label: '', value: '' });

  // Dragging state
  const [draggedIndex, setDraggedIndex] = useState(null);

  const fieldTypes = [
    'TEXT', 'NUMBER', 'EMAIL', 'TEXTAREA', 'DATE', 
    'DROPDOWN', 'RADIO', 'CHECKBOX', 'FILE'
  ];

  const fieldTypesWithOptions = ['DROPDOWN', 'RADIO', 'CHECKBOX'];

  useEffect(() => {
    fetchFormFields();
  }, [scholarshipId]);

  const fetchFormFields = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get(`/api/scholarships/${scholarshipId}/form`, { 
        token: auth.token
      });
      setFields(data.form || []);
    } catch (err) {
      if (err.status === 404) {
        setFields([]);
      } else {
        setError(err.message || 'Failed to load form fields');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddField = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!newField.field_label || !newField.field_key || !newField.field_type) {
      setError('Field label, key, and type are required');
      return;
    }

    try {
      const response = await post(
        `/api/scert/scholarships/${scholarshipId}/fields`,
        {
          field_label: newField.field_label,
          field_key: newField.field_key,
          field_type: newField.field_type,
          is_required: newField.is_required
        },
        { token: auth.token, sessionId: sessionId }
      );

      // Add options if field type supports them
      if (fieldTypesWithOptions.includes(newField.field_type) && newField.options.length > 0) {
        for (const option of newField.options) {
          await post(
            `/api/scert/fields/${response.field_id}/options`,
            {
              option_label: option.label,
              option_value: option.value
            },
            { token: auth.token, sessionId: sessionId }
          );
        }
      }

      setSuccess('Field added successfully!');
      setShowAddFieldModal(false);
      setNewField(getEmptyNewField());
      setOptionDraft({ label: '', value: '' });
      fetchFormFields();
    } catch (err) {
      setError(err.message || 'Failed to add field');
    }
  };

  const handleAddOptionToModal = () => {
    const label = optionDraft.label.trim();
    const value = optionDraft.value.trim();

    if (!label || !value) {
      setError('Option label and value are required');
      return;
    }

    setNewField({
      ...newField,
      options: [...newField.options, { label, value }]
    });
    setOptionDraft({ label: '', value: '' });
  };

  const handleRemoveOptionFromModal = (index) => {
    setNewField({
      ...newField,
      options: newField.options.filter((_, i) => i !== index)
    });
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newFields = [...fields];
    const draggedField = newFields[draggedIndex];
    newFields.splice(draggedIndex, 1);
    newFields.splice(index, 0, draggedField);
    
    setFields(newFields);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const updates = fields.map((field, index) => ({
        field_id: field.field_id,
        sort_order: index + 1
      }));

      await put(
        `/api/scert/scholarships/${scholarshipId}/fields/reorder`,
        updates,
        { token: auth.token, sessionId: sessionId }
      );

      setSuccess('Fields reordered successfully!');
    } catch (err) {
      setError(err.message || 'Failed to reorder fields');
      fetchFormFields(); // Revert on error
    } finally {
      setDraggedIndex(null);
    }
  };

  const handleDeleteField = async (fieldId) => {
    if (!confirm('Are you sure you want to delete this field?')) return;

    try {
      await put(
        `/api/scert/fields/${fieldId}`,
        { is_active: false },
        { token: auth.token, sessionId: sessionId }
      );
      setSuccess('Field deleted successfully!');
      fetchFormFields();
    } catch (err) {
      setError(err.message || 'Failed to delete field');
    }
  };

  const generateFieldKey = (label) => {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  };

  if (loading) {
    return (
      <div className="scert-page">
        <div className="scert-placeholder">Loading form builder...</div>
      </div>
    );
  }

  const closeAddFieldModal = () => {
    setShowAddFieldModal(false);
    setError('');
    setOptionDraft({ label: '', value: '' });
    setNewField(getEmptyNewField());
  };

  return (
    <div className="scert-page form-builder-page">
      <div className="scert-page-header">
        <div>
          <h1 className="scert-page-title">Form Builder</h1>
          <p className="scert-page-subtitle">
            Create a custom application form for this scholarship.
          </p>
        </div>
        <button
          className="scert-btn-secondary"
          onClick={() => onDoLater && onDoLater()}
        >
          Do it Later
        </button>
      </div>

      {error && <div className="scert-form-error">{error}</div>}
      {success && <div className="scert-form-success">{success}</div>}

      <div className="form-builder-container">
        <div className="form-builder-actions">
          <button
            className="scert-btn-primary"
            onClick={() => {
              setError('');
              setOptionDraft({ label: '', value: '' });
              setNewField(getEmptyNewField());
              setShowAddFieldModal(true);
            }}
          >
            Add Field
          </button>
        </div>

        {fields.length > 0 && (
          <div className="modal-option-help form-builder-tip">
            Tip: Drag and drop cards to reorder fields.
          </div>
        )}

        {fields.length === 0 ? (
          <div className="form-builder-empty">
            <p>No fields added yet. Click "Add Field" to get started!</p>
          </div>
        ) : (
          <div className="form-fields-list">
            {fields.map((field, index) => (
              <div 
                key={field.field_id} 
                className="form-field-card"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                <div className="form-field-card-header">
                  <div className="form-field-number">#{index + 1}</div>
                  <div className="form-field-info">
                    <h4 className="form-field-label">
                      {field.field_label}
                      {field.is_required && <span className="required-badge">Required</span>}
                    </h4>
                    <div className="form-field-meta">
                      <span className="field-type-badge">{field.field_type}</span>
                      <span className="field-key-text">Key: {field.field_key}</span>
                    </div>
                  </div>
                  <button
                    className="form-field-delete-btn"
                    onClick={() => handleDeleteField(field.field_id)}
                    title="Delete field"
                  >
                    <HiOutlineTrash />
                  </button>
                </div>

                {fieldTypesWithOptions.includes(field.field_type) && (
                  <div className="form-field-options">
                    <div className="options-header">
                      <span className="options-title">Options:</span>
                    </div>
                    {field.options && field.options.length > 0 ? (
                      <ul className="options-list">
                        {field.options.map((opt) => (
                          <li key={opt.option_id} className="option-item">
                            <span className="option-label">{opt.option_label}</span>
                            <span className="option-value">({opt.option_value})</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="no-options">No options added</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Field Modal */}
      {showAddFieldModal && (
        <div className="modal-overlay" onClick={closeAddFieldModal}>
          <div className="modal-content form-builder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add New Field</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeAddFieldModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form className="modal-form" onSubmit={handleAddField}>
              <div className="form-field">
                <label className="form-label">
                  Field Label <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., Student Name, Annual Income"
                  value={newField.field_label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setNewField({
                      ...newField,
                      field_label: label,
                      field_key: generateFieldKey(label)
                    });
                  }}
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label">
                  Field Key <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., student_name, annual_income"
                  value={newField.field_key}
                  onChange={(e) => setNewField({ ...newField, field_key: e.target.value })}
                  required
                />
                <small className="modal-option-help">
                  Unique identifier (lowercase, underscores only)
                </small>
              </div>

              <div className="form-field">
                <label className="form-label">
                  Field Type <span className="required">*</span>
                </label>
                <select
                  className="form-input"
                  value={newField.field_type}
                  onChange={(e) => setNewField({ ...newField, field_type: e.target.value })}
                  required
                >
                  {fieldTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label checkbox-label">
                  <input
                    type="checkbox"
                    checked={newField.is_required}
                    onChange={(e) => setNewField({ ...newField, is_required: e.target.checked })}
                  />
                  <span>Mark as Required Field</span>
                </label>
              </div>

              {fieldTypesWithOptions.includes(newField.field_type) && (
                <div className="form-field">
                  <label className="form-label">Options</label>

                  <div className="modal-options-inline">
                    <div className="modal-option-editor">
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Option label (e.g., General)"
                        value={optionDraft.label}
                        onChange={(e) => setOptionDraft({ ...optionDraft, label: e.target.value })}
                      />
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Option value (e.g., GENERAL)"
                        value={optionDraft.value}
                        onChange={(e) => setOptionDraft({ ...optionDraft, value: e.target.value })}
                      />
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        onClick={handleAddOptionToModal}
                      >
                        Add
                      </button>
                    </div>

                    <div className="modal-option-help">Add all options before saving the field.</div>

                    <div className="modal-options-container">
                      {newField.options.length === 0 ? (
                        <div className="modal-option-help">No options added yet.</div>
                      ) : (
                        newField.options.map((opt, idx) => (
                          <div key={idx} className="modal-option-item">
                            <span>
                              {opt.label} ({opt.value})
                            </span>
                            <button
                              type="button"
                              className="modal-option-remove"
                              onClick={() => handleRemoveOptionFromModal(idx)}
                              aria-label="Remove option"
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="scert-btn-secondary"
                  onClick={closeAddFieldModal}
                >
                  Cancel
                </button>
                <button type="submit" className="scert-btn-primary">
                  Add Field
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
