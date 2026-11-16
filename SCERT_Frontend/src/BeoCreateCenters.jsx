import { useMemo, useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get, post, put } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { HiOutlineTrash, HiOutlineMenuAlt4, HiOutlinePencil } from 'react-icons/hi';
import { BeoEditCenterModal } from './BeoEditCenterModal.jsx';

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function moveItem(list, fromIndex, toIndex) {
  if (fromIndex === toIndex) return list;
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function BeoCreateCenters() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedScholarshipId } = useDashboard();

  const [eligibleSchools, setEligibleSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Left side: form (draft) centers
  const [draftCenters, setDraftCenters] = useState([]);

  // Right side: staged rows to be confirmed (ordered)
  const [pendingCenters, setPendingCenters] = useState([]);

  const [confirming, setConfirming] = useState(false);

  const [dragFromIndex, setDragFromIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Centers list
  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);
  // The most centers this BEO may have for the scholarship (NMMSS: 2); null
  // when there is no limit. The server sends it and enforces it on create.
  const [maxCenters, setMaxCenters] = useState(null);

  // Editing a created center's superintendent details
  const [editingCenter, setEditingCenter] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!selectedScholarshipId) {
      setEligibleSchools([]);
      setDraftCenters([]);
      setPendingCenters([]);
      setCenters([]);
      setMaxCenters(null);
      return;
    }

    fetchEligibleSchools();
    fetchCenters();
    setDraftCenters([]);
    setPendingCenters([]);
    setError('');
    setSuccess('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScholarshipId]);

  const eligibleSchoolById = useMemo(() => {
    const map = new Map();
    for (const s of eligibleSchools) {
      map.set(String(s.school_user_id), s);
    }
    return map;
  }, [eligibleSchools]);

  // Centers that already count toward the limit: created ones plus those
  // staged for confirming. The form's own draft rows are added where checked.
  const centersInUse = centers.length + pendingCenters.length;
  const limitReached = maxCenters !== null && centersInUse >= maxCenters;
  const limitMessage = (extra = 0) =>
    `NMMSS allows at most ${maxCenters} exam centers. ` +
    `You have ${centersInUse} (created or in the pending list)` +
    (extra ? `, so ${Math.max(0, maxCenters - centersInUse)} more can be added.` : '.');

const fetchEligibleSchools = async () => {
  setLoadingSchools(true);
  setError('');

  try {
    const data = await get(`/api/beo/centers/eligible-schools?scholarship_id=${selectedScholarshipId}`, {
      token: auth?.token,
      params: {
        scholarship_id: selectedScholarshipId,
      },
    });

    setEligibleSchools(Array.isArray(data.schools) ? data.schools : []);
  } catch (err) {
    setError(err.message || 'Failed to fetch eligible schools');
    toast.error(`Failed to load eligible schools: ${toast.getErrorMessage(err)}`);
    setEligibleSchools([]);
  } finally {
    setLoadingSchools(false);
  }
};

const fetchCenters = async () => {
  if (!selectedScholarshipId) return;
  
  setLoadingCenters(true);
  
  try {
    const data = await get(
      `/api/beo/centers?scholarship_id=${selectedScholarshipId}`,
      { token: auth?.token }
    );
    
    setCenters(Array.isArray(data.centers) ? data.centers : []);
    setMaxCenters(Number.isInteger(data.max_centers) ? data.max_centers : null);
  } catch (err) {
    console.error('Failed to fetch centers:', err);
    setCenters([]);
  } finally {
    setLoadingCenters(false);
  }
};

  const addDraftCenter = () => {
    setDraftCenters((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        school_user_id: '',
        superintendent_name: '',
        superintendent_mobile: '',
      },
    ]);
  };

  const removeDraftCenter = (id) => {
    setDraftCenters((prev) => prev.filter((c) => c.id !== id));
  };

  const updateDraftCenter = (id, field, value) => {
    setDraftCenters((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const validateCenterRows = (rows) => {
    for (const row of rows) {
      if (!row.school_user_id || !row.superintendent_name || !row.superintendent_mobile) {
        return 'All center fields must be filled.';
      }

      const phone = normalizePhone(row.superintendent_mobile);
      if (phone.length !== 10) {
        return 'Superintendent mobile must be a valid 10-digit phone number.';
      }
    }
    return '';
  };

  const addDraftCentersToPending = () => {
    setError('');
    setSuccess('');

    if (!selectedScholarshipId) {
      setError('Please select a scholarship to continue.');
      toast.error('Please select a scholarship to continue.');
      return;
    }

    if (draftCenters.length === 0) {
      setError('Please add at least one center.');
      toast.error('Please add at least one center.');
      return;
    }

    const validation = validateCenterRows(draftCenters);
    if (validation) {
      setError(validation);
      toast.error(validation);
      return;
    }

    if (maxCenters !== null && centersInUse + draftCenters.length > maxCenters) {
      const message = limitMessage(draftCenters.length);
      setError(message);
      toast.error(message);
      return;
    }

    const existingSchoolIds = new Set(pendingCenters.map((c) => String(c.school_user_id)));
    const seenInBatch = new Set();

    for (const c of draftCenters) {
      const sid = String(c.school_user_id);
      if (existingSchoolIds.has(sid)) {
        setError('One or more schools are already added in the list.');
        toast.error('One or more schools are already added in the list.');
        return;
      }
      if (seenInBatch.has(sid)) {
        setError('Duplicate school selected in the draft centers.');
        toast.error('Duplicate school selected in the draft centers.');
        return;
      }
      seenInBatch.add(sid);
    }

    const rowsToAdd = draftCenters.map((c) => {
      const school = eligibleSchoolById.get(String(c.school_user_id));
      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        school_user_id: c.school_user_id,
        school_name: school?.school_name || '—',
        udise_code: school?.udise_code || '—',
        superintendent_name: c.superintendent_name,
        superintendent_mobile: c.superintendent_mobile,
      };
    });

    setPendingCenters((prev) => [...prev, ...rowsToAdd]);
    setDraftCenters([]);
    setSuccess(`Added ${rowsToAdd.length} center(s) to the list.`);
    toast.success(`Added ${rowsToAdd.length} center(s) to the list.`);
  };

  const removePendingCenter = (id) => {
    setPendingCenters((prev) => prev.filter((c) => c.id !== id));
  };

  const handleConfirmCenters = async () => {
    setError('');
    setSuccess('');

    if (!selectedScholarshipId) {
      setError('Please select a scholarship to continue.');
      toast.error('Please select a scholarship to continue.');
      return;
    }

    if (pendingCenters.length === 0) {
      setError('Please add at least one center to confirm.');
      toast.error('Please add at least one center to confirm.');
      return;
    }

    const validation = validateCenterRows(pendingCenters);
    if (validation) {
      setError(validation);
      toast.error(validation);
      return;
    }

    // centers.length is what already exists; pendingCenters are about to be added.
    if (maxCenters !== null && centers.length + pendingCenters.length > maxCenters) {
      const message = limitMessage(1);
      setError(message);
      toast.error(message);
      return;
    }

    setConfirming(true);

    try {
      const payload = {
        scholarship_id: selectedScholarshipId,
        centers: pendingCenters.map((c) => ({
          school_user_id: parseInt(c.school_user_id, 10),
          superintendent_name: c.superintendent_name,
          superintendent_mobile: c.superintendent_mobile,
        })),
      };

      await post('/api/beo/centers', payload, {
        token: auth?.token,
      });

      setSuccess(`Successfully created ${pendingCenters.length} center(s).`);
      toast.success(`Successfully created ${pendingCenters.length} center(s).`);
      setPendingCenters([]);
      setDraftCenters([]);
      fetchEligibleSchools();
      fetchCenters();
    } catch (err) {
      setError(err.message || 'Failed to confirm centers');
      toast.error(`Failed to confirm centers: ${toast.getErrorMessage(err)}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleSaveSuperintendent = async (details) => {
    if (!editingCenter) return;

    setSavingEdit(true);
    try {
      const data = await put(`/api/beo/centers/${editingCenter.center_id}`, details, {
        token: auth?.token,
      });
      const saved = data?.center || details;
      setCenters((prev) =>
        prev.map((c) =>
          c.center_id === editingCenter.center_id
            ? {
                ...c,
                superintendent_name: saved.superintendent_name,
                superintendent_mobile: saved.superintendent_mobile,
              }
            : c
        )
      );
      toast.success('Superintendent details updated.');
      setEditingCenter(null);
    } catch (err) {
      toast.error(`Failed to update superintendent details: ${toast.getErrorMessage(err)}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDragStart = (index) => {
    setDragFromIndex(index);
    setDragOverIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e, index) => {
    e.preventDefault();

    if (dragFromIndex === null || dragFromIndex === undefined) {
      setDragOverIndex(null);
      return;
    }

    setPendingCenters((prev) => moveItem(prev, dragFromIndex, index));
    setDragFromIndex(index);
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDragFromIndex(null);
    setDragOverIndex(null);
  };

  if (!selectedScholarshipId) {
    return (
      <div className="applications-view">
        <div className="empty-state">
          <h3>Please select a scholarship to continue</h3>
          <p>Use the scholarship dropdown above to select a scholarship for center creation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Create Exam Centers</h3>
              
            </div>
        </div>
        <button
          type="button"
          className="scert-btn-secondary"
          onClick={fetchEligibleSchools}
          disabled={loadingSchools}
        >
          {loadingSchools ? 'Refreshing…' : 'Refresh Schools'}
        </button>
      </div>

      

      {loadingSchools ? (
        <div className="loading-state">Loading eligible schools...</div>
      ) : eligibleSchools.length === 0 ? (
        <div className="empty-state">No eligible schools available for center creation.</div>
      ) : (
        <div className="beo-center-create-split">
          {/* Left pane: build centers */}
          <div className="beo-center-create-pane">
            <div className="view-header-row" style={{ marginBottom: '0.75rem' }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title" style={{ margin: 0 }}>Center Details</h3>
              
            </div>
                
              </div>
              <button
                type="button"
                className="form-submit-btn"
                onClick={addDraftCenter}
                disabled={loadingSchools || eligibleSchools.length === 0 || draftCenters.length > 0 || limitReached}
                title={limitReached ? `Maximum of ${maxCenters} centers reached` : undefined}
              >
                + Add Center
              </button>
            </div>

            {maxCenters !== null && (
              <div className="field-hint" style={{ marginBottom: '0.75rem' }}>
                NMMSS allows a maximum of {maxCenters} exam centers per block. Used:{' '}
                <strong>{centersInUse}</strong> of {maxCenters}
                {pendingCenters.length > 0 ? ` (${pendingCenters.length} in the pending list)` : ''}.
              </div>
            )}

            {draftCenters.length === 0 ? (
              <div className="empty-state">
                {limitReached
                  ? `The maximum of ${maxCenters} centers has been reached.`
                  : 'Click “Add Center” to create center.'}
              </div>
            ) : (
              <div className="centers-form">
                {draftCenters.map((center, index) => (
                  <div key={center.id} className="center-form-card">
                    <div className="center-form-header">
                      <h4>Center {index + 1}</h4>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => removeDraftCenter(center.id)}
                        title="Remove Center"
                      >
                        <HiOutlineTrash />
                      </button>
                    </div>

                    <div className="form-field">
                      <label className="form-label">Select School</label>
                      <select
                        className="form-input"
                        value={center.school_user_id}
                        onChange={(e) =>
                          updateDraftCenter(center.id, 'school_user_id', e.target.value)
                        }
                      >
                        <option value="">-- Select School --</option>
                        {eligibleSchools.map((school) => (
                          <option key={school.school_user_id} value={school.school_user_id}>
                            {school.school_name} - {school.udise_code}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <label className="form-label">Superintendent Name</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Enter superintendent name"
                        value={center.superintendent_name}
                        onChange={(e) =>
                          updateDraftCenter(center.id, 'superintendent_name', e.target.value.toUpperCase())
                        }
                      />
                    </div>

                    <div className="form-field">
                      <label className="form-label">Superintendent Mobile</label>
                      <input
                        type="tel"
                        className="form-input"
                        placeholder="Enter mobile number"
                        value={center.superintendent_mobile}
                        inputMode="numeric"
                        maxLength={10}
                        onChange={(e) =>
                          updateDraftCenter(center.id, 'superintendent_mobile', normalizePhone(e.target.value).slice(0, 10))
                        }
                      />
                    </div>
                  </div>
                ))}

                <div className="form-actions">
                  <button
                    type="button"
                    className="form-submit-btn"
                    onClick={addDraftCentersToPending}
                    disabled={draftCenters.length === 0}
                  >
                    {`Create ${draftCenters.length} Center(s)`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right pane: ordered pending list */}
          <div className="beo-center-create-pane">
            <div className="view-header-row" style={{ marginBottom: '0.75rem' }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title" style={{ margin: 0 }}>Pending Centers</h3>
              
            </div>
              </div>
              <button
                type="button"
                className="form-submit-btn"
                onClick={handleConfirmCenters}
                disabled={confirming || pendingCenters.length === 0}
                style={{ marginTop: 0 }}
              >
                {confirming ? 'Confirming…' : 'Confirm Centers'}
              </button>
            </div>

            {pendingCenters.length === 0 ? (
              <div className="empty-state">
                No centers in the list yet.
              </div>
            ) : (
              <>
                <div className="smart-table-wrap beo-center-create-table-wrap">
                  <table className="smart-table beo-center-create-table">
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Action</th>
                        <th style={{ width: 48 }} aria-label="Reorder" />
                        <th style={{ width: 72 }}>Order</th>
                        <th>School</th>
                        <th>UDISE</th>
                        <th>Superintendent</th>
                        <th>Mobile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingCenters.map((row, index) => {
                        const isOver = dragOverIndex === index && dragFromIndex !== null;

                        return (
                          <tr
                            key={row.id}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDrop={(e) => handleDrop(e, index)}
                            onDragEnd={handleDragEnd}
                            className={isOver ? 'beo-center-row-drag-over' : ''}
                          >
                            <td>
                              <button
                                type="button"
                                className="icon-action-btn"
                                onClick={() => removePendingCenter(row.id)}
                                title="Remove from list"
                              >
                                <HiOutlineTrash />
                              </button>
                            </td>
                            <td>
                              <span className="beo-center-drag-handle" title="Drag to reorder">
                                <HiOutlineMenuAlt4 />
                              </span>
                            </td>
                            <td className="smart-table-strong">{index + 1}</td>
                            <td className="smart-table-strong">{row.school_name || '—'}</td>
                            <td>{row.udise_code || '—'}</td>
                            <td>{row.superintendent_name || '—'}</td>
                            <td>{row.superintendent_mobile || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="table-footer" style={{ marginTop: '0.75rem' }}>
                  <span className="table-count">
                    Total: <strong>{pendingCenters.length}</strong> center(s)
                  </span>
                </div>

              </>
            )}
          </div>
        </div>
      )}

      {/* Centers List Below */}
      <div style={{ marginTop: '2rem' }}>
        <div className="view-header-row" style={{ marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">List Of Created Centers</h3>
              
            </div>
          </div>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchCenters}
            disabled={loadingCenters}
          >
            {loadingCenters ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loadingCenters ? (
          <div className="loading-state">Loading centers...</div>
        ) : centers.length === 0 ? (
          <div className="empty-state">
            No centers have been created for this scholarship yet.
          </div>
        ) : (
          <>
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Action</th>
                    <th>Center Order</th>
                    <th>School Name</th>
                    <th>UDISE Code</th>
                    <th>Superintendent Name</th>
                    <th>Superintendent Mobile</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {centers.map((center) => (
                    <tr key={center.center_id} className={window.getSubmissionRoleRowClass(center)}>
                      <td>
                        <button
                          type="button"
                          className="icon-action-btn"
                          onClick={() => setEditingCenter(center)}
                          title="Edit superintendent name and mobile"
                          aria-label={`Edit superintendent of center ${center.center_order ?? ''}`}
                        >
                          <HiOutlinePencil />
                        </button>
                      </td>
                      <td className="smart-table-strong">
                        {center.center_order || '—'}
                      </td>
                      <td>{center.school_name || '—'}</td>
                      <td>{center.udise_code || '—'}</td>
                      <td>{center.superintendent_name || '—'}</td>
                      <td>{center.superintendent_mobile || '—'}</td>
                      <td>
                        <span className="status-pill status-approved">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span className="table-count">
                Total: <strong>{centers.length}</strong> center(s)
              </span>
            </div>
          </>
        )}
      </div>

      {editingCenter && (
        <BeoEditCenterModal
          key={editingCenter.center_id}
          center={editingCenter}
          onClose={() => setEditingCenter(null)}
          onSave={handleSaveSuperintendent}
          isSaving={savingEdit}
        />
      )}
    </div>
  );
}
