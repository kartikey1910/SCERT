import { useState, useEffect } from 'react';
import { get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';

/**
 * School Type / Location / Category are set once by the school when it
 * first completes its profile, then locked against later self-editing.
 *
 * They are dropdowns rather than free text because these three columns
 * drive the report classifiers (School Participation buckets schools by
 * matching /Dept/, /Aided/, /Local/, /Rural/, /Urban/, /UPS/, /Sec/,
 * /HSec/ against them). Years of free-text entry has already produced
 * "Dept of Edu" alongside "Dept of Education", "Government", "Govt",
 * "govt" and "GOVT", and "Rular" for "Rural" — every variant landing in a
 * different bucket. Fixed options stop new records adding to that.
 */
const SCHOOL_TYPE_OPTIONS = ['Dept of Edu', 'Govt Aided', 'Local Body'];
const SCHOOL_LOCATION_OPTIONS = ['Rural', 'Urban'];
const SCHOOL_CATEGORY_OPTIONS = [
  'UPS only',
  'UPS to Sec',
  'UPS to HSec',
  'Sec Only',
  'Sec to HSec',
  'PS to UPS',
  'PS to HSec',
];

export function SchoolProfileForm({ mode = 'complete', onSuccess, onError, onClose }) {
  const { auth } = useAuth();
  const isEdit = String(mode).toLowerCase() === 'edit';
  const [readOnlyData, setReadOnlyData] = useState({
    school_name: '',
    udise_code: '',
    block_code: '',
    block_name: '',
    district_code: '',
    district_name: '',
  });
  const [formData, setFormData] = useState({
    unit_id: '',
    school_type: '',
    school_location: '',
    school_category: '',
    address: '',
    contact_number: '',
    email: '',
    head_of_institution_name: '',
    head_of_institution_mobile: '',
  });
  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);
  const [error, setError] = useState('');
  const [selectedClasses, setSelectedClasses] = useState(new Set());
  const [classStrengths, setClassStrengths] = useState({});

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await get('/api/school/profile', { token: auth?.token });
        if (data.profile) {
          setReadOnlyData({
            school_name: data.profile.school_name || '',
            udise_code: data.profile.udise_code || '',
            block_code: data.profile.block_code || '',
            block_name: data.profile.block_name || '',
            district_code: data.profile.district_code || '',
            district_name: data.profile.district_name || '',
          });
          setFormData({
            unit_id: data.profile.unit_id || '',
            school_type: data.profile.school_type || '',
            school_location: data.profile.school_location || '',
            school_category: data.profile.school_category || '',
            address: data.profile.address || '',
            contact_number: data.profile.contact_number || '',
            email: data.profile.email || '',
            head_of_institution_name: data.profile.head_of_institution_name || '',
            head_of_institution_mobile: data.profile.head_of_institution_mobile || '',
          });

          // Prefill class strengths (important for edit mode to avoid wiping existing data)
          if (Array.isArray(data.class_strengths) && data.class_strengths.length > 0) {
            const nextSelected = new Set();
            const nextStrengths = {};
            for (const row of data.class_strengths) {
              const classLevel = String(row.class_level);
              const category = String(row.category);
              nextSelected.add(classLevel);
              nextStrengths[`${classLevel}_${category}`] = {
                boys: String(row.boys_count ?? ''),
                girls: String(row.girls_count ?? ''),
              };
            }
            setSelectedClasses(nextSelected);
            setClassStrengths(nextStrengths);
          }
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setFetchingProfile(false);
      }
    };
    
    fetchProfile();
  }, [auth?.token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue = value;

    if (name === 'unit_id') {
      nextValue = String(value || '').replace(/[^a-zA-Z0-9]+/g, '').toUpperCase();
    } else if (name === 'contact_number' || name === 'head_of_institution_mobile') {
      nextValue = String(value || '').replace(/\D/g, '').slice(0, 10);
    } else if (name === 'head_of_institution_name') {
      nextValue = String(value || '').toUpperCase();
    }

    setFormData({ ...formData, [name]: nextValue });
  };

  /**
   * These three fields are the school's to set exactly once, while
   * completing its profile, and are locked afterwards.
   *
   * They used to be locked in BOTH modes, which deadlocked every new
   * school: the fields arrive empty, /profile/complete rejects the
   * request unless all three are present, so the school could never get
   * past first login. Locking now applies to edit mode only, which is
   * where "Locked by Admin" was always meant to apply.
   */
  const renderLockableLabel = (name, label) => (
    <label className="form-label" htmlFor={name}>
      {label}{' '}
      {isEdit ? (
        <span
          className="locked-label"
          style={{ fontSize: '0.8em', color: '#666', fontWeight: 'normal', marginLeft: '4px' }}
        >
          (Locked by Admin)
        </span>
      ) : (
        <span style={{ color: '#dc2626' }}>*</span>
      )}
    </label>
  );

  const renderLockableField = (name, options, placeholder) => {
    if (isEdit) {
      return (
        <input
          id={name}
          name={name}
          type="text"
          className="form-input"
          value={formData[name]}
          disabled={true}
          readOnly
          title="Contact administrator to change this value"
        />
      );
    }

    // An already-saved value that predates these fixed options must still
    // render, or the select would silently blank it out.
    const known = options.includes(formData[name]);
    return (
      <select
        id={name}
        name={name}
        className="form-input"
        value={formData[name] || ''}
        onChange={handleChange}
        disabled={loading}
        required
      >
        <option value="">{placeholder}</option>
        {!known && formData[name] ? (
          <option value={formData[name]}>{formData[name]}</option>
        ) : null}
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // The three school classification fields are only required while
    // completing the profile — that is the one time the school can set
    // them. In edit mode they are locked, so demanding them here would
    // strand any existing school whose record predates them.
    if (!formData.unit_id) {
      setError('Please fill all required fields');
      return;
    }

    if (!isEdit && (!formData.school_type || !formData.school_location || !formData.school_category)) {
      setError('Please select School Type, School Location and School Category');
      return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(String(formData.unit_id || '').trim())) {
      setError('Unit ID must contain letters and numbers only');
      return;
    }

    const schoolContact = String(formData.contact_number || '').trim();
    if (schoolContact && !/^\d{10}$/.test(schoolContact)) {
      setError('Contact Number of School must be exactly 10 digits');
      return;
    }
    if (!/^\d{10}$/.test(String(formData.head_of_institution_mobile || '').trim())) {
      setError('Head of Institution Mobile must be exactly 10 digits');
      return;
    }

    setLoading(true);
    try {
      const class_strengths_array = [];
      selectedClasses.forEach(classLevel => {
        ['GEN', 'SC', 'ST', 'OBC'].forEach(category => {
          const key = `${classLevel}_${category}`;
          if (classStrengths[key]) {
            class_strengths_array.push({
              class_level: classLevel,
              category: category,
              boys_count: parseInt(classStrengths[key].boys) || 0,
              girls_count: parseInt(classStrengths[key].girls) || 0,
            });
          }
        });
      });
      
      const payload = {
        ...formData,
        head_of_institution_name: String(formData.head_of_institution_name || '').toUpperCase(),
      };

      if (class_strengths_array.length > 0) {
        payload.class_strengths = class_strengths_array;
      }

      const endpoint = isEdit ? '/api/school/profile/edit' : '/api/school/profile/complete';
      await put(endpoint, payload, { token: auth?.token });
      onSuccess?.();
    } catch (err) {
      const errorMsg = err.message || 'Failed to complete profile';
      setError(errorMsg);
      if (onError) onError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay auth-profile-overlay">
      <div className="modal-content profile-modal auth-profile-modal">
        <div className="modal-header auth-profile-header">
          <div className="auth-password-header-row">
            <div>
              <h2 className="modal-title auth-profile-title">
                {isEdit ? 'Edit Your School Profile' : 'Complete Your School Profile'}
              </h2>
              <p className="modal-subtitle">
                {isEdit
                  ? 'Update your profile details and save changes.'
                  : 'Please provide the following details to complete your profile.'}
              </p>
            </div>
            {onClose && (
              <button type="button" className="auth-password-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form profile-form">
          {readOnlyData.school_name && (
            <>
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">School Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.school_name}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">UDISE Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.udise_code}
                    disabled
                    readOnly
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label" htmlFor="contact_number">
                    Contact Number of School
                  </label>
                  <input
                    id="contact_number"
                    name="contact_number"
                    type="tel"
                    className="form-input"
                    placeholder="Enter 10-digit contact number"
                    inputMode="numeric"
                    maxLength={10}
                    pattern="\d{10}"
                    title="Enter exactly 10 digits"
                    value={formData.contact_number}
                    onChange={handleChange}
                    disabled={loading}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="email">
                    Email ID of School <span className="required">*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    className="form-input"
                    placeholder="Enter email address"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={loading}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">Block Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.block_code}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Block Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.block_name}
                    disabled
                    readOnly
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">District Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.district_code}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">District Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={readOnlyData.district_name}
                    disabled
                    readOnly
                  />
                </div>
              </div>
            </>
          )}
          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="unit_id">
                Unit ID (Education Portal ID) <span className="required">*</span>
              </label>
              <input
                id="unit_id"
                name="unit_id"
                type="text"
                className="form-input"
                placeholder="Enter Unit ID (e.g. AB1234)"
                value={formData.unit_id}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              {renderLockableLabel('school_type', 'School Type')}
              {renderLockableField('school_type', SCHOOL_TYPE_OPTIONS, 'Select School Type')}
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              {renderLockableLabel('school_location', 'School Location')}
              {renderLockableField('school_location', SCHOOL_LOCATION_OPTIONS, 'Select School Location')}
            </div>

            <div className="form-field">
              {renderLockableLabel('school_category', 'School Category')}
              {renderLockableField('school_category', SCHOOL_CATEGORY_OPTIONS, 'Select School Category')}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="address">
              Address
            </label>
            <textarea
              id="address"
              name="address"
              className="form-input"
              placeholder="Enter complete address"
              value={formData.address}
              onChange={handleChange}
              rows="3"
              disabled={loading}
            />
          </div>

          <h3 className="form-section-title" style={{ marginTop: '0.5rem' }}>
            Head of Institution Details
          </h3>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="head_of_institution_name">
                Head of Institution Name <span className="required">*</span>
              </label>
              <input
                id="head_of_institution_name"
                name="head_of_institution_name"
                type="text"
                className="form-input"
                placeholder="Enter name"
                value={formData.head_of_institution_name}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="head_of_institution_mobile">
                Head of Institution Mobile <span className="required">*</span>
              </label>
              <input
                id="head_of_institution_mobile"
                name="head_of_institution_mobile"
                type="tel"
                className="form-input"
                placeholder="Enter 10-digit mobile number"
                inputMode="numeric"
                maxLength={10}
                pattern="\d{10}"
                title="Enter exactly 10 digits"
                value={formData.head_of_institution_mobile}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="class-strengths-section">
            <h3 className="form-section-title">Class-wise Student Strength</h3>
            <p className="form-section-subtitle">Select classes and fill student strength details</p>
            
            <div className="class-selection">
              {['6', '8', '9'].map(classNum => (
                <label key={classNum} className="class-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedClasses.has(classNum)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedClasses);
                      if (e.target.checked) {
                        newSelected.add(classNum);
                      } else {
                        newSelected.delete(classNum);
                      }
                      setSelectedClasses(newSelected);
                    }}
                    disabled={loading}
                  />
                  <span>Class {classNum}</span>
                </label>
              ))}
            </div>

            {selectedClasses.size > 0 && (
              <div className="strength-tables">
                {Array.from(selectedClasses).sort().map(classLevel => (
                  <div key={classLevel} className="strength-table-wrapper">
                    <h4 className="table-title">Class {classLevel}</h4>
                    <table className="strength-table">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Boys</th>
                          <th>Girls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {['GEN', 'SC', 'ST', 'OBC'].map(category => {
                          const key = `${classLevel}_${category}`;
                          return (
                            <tr key={category}>
                              <td>{category}</td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  className="table-input"
                                  placeholder="0"
                                  value={classStrengths[key]?.boys || ''}
                                  onChange={(e) => {
                                    setClassStrengths({
                                      ...classStrengths,
                                      [key]: {
                                        ...classStrengths[key],
                                        boys: e.target.value,
                                      },
                                    });
                                  }}
                                  disabled={loading}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  className="table-input"
                                  placeholder="0"
                                  value={classStrengths[key]?.girls || ''}
                                  onChange={(e) => {
                                    setClassStrengths({
                                      ...classStrengths,
                                      [key]: {
                                        ...classStrengths[key],
                                        girls: e.target.value,
                                      },
                                    });
                                  }}
                                  disabled={loading}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="modal-button auth-profile-button"
            disabled={loading}
          >
            {loading ? 'Saving Profile...' : isEdit ? 'Save Changes' : 'Complete Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
