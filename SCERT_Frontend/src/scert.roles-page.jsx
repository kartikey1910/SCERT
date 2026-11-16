import { useState, useEffect } from 'react';
import { get, post, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import districtBlockData from './master-data/district-block.master.json';
import { HiOutlineClipboardCopy, HiOutlineTrash } from 'react-icons/hi';
import { HiOutlineKey } from 'react-icons/hi2';
import { useToast } from './ToastContext.jsx';

export function ScertRolesPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const [activeRole, setActiveRole] = useState('school');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ show: false, action: null, userId: null, label: null, message: '', title: '' });
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Pagination state
  const [schoolsData, setSchoolsData] = useState({ data: [], pagination: {} });
  const [beosData, setBeosData] = useState({ data: [], pagination: {} });
  const [districtsData, setDistrictsData] = useState({ data: [], pagination: {} });
  const [schoolPage, setSchoolPage] = useState(1);
  const [beoPage, setBeoPage] = useState(1);
  const [districtPage, setDistrictPage] = useState(1);
  const [schoolSearchInput, setSchoolSearchInput] = useState('');
  const [beoSearchInput, setBeoSearchInput] = useState('');
  const [districtSearchInput, setDistrictSearchInput] = useState('');
  const [schoolSearchQuery, setSchoolSearchQuery] = useState('');
  const [beoSearchQuery, setBeoSearchQuery] = useState('');
  const [districtSearchQuery, setDistrictSearchQuery] = useState('');

  // School form data
  const [schoolData, setSchoolData] = useState({
    school_name: '',
    udise_code: '',
    selectedDistrict: '',
    selectedBlock: '',
    school_type: '',
    school_category: '',
    school_location: ''
  });

  // BEO form data
  const [beoData, setBeoData] = useState({
    unit_id: '',
    selectedDistrict: '',
    selectedBlock: ''
  });

  // District form data
  const [districtData, setDistrictData] = useState({
    unit_id: '',
    selectedDistrict: ''
  });

  // Available options
  const [districts, setDistricts] = useState([]);
  const [schoolBlocks, setSchoolBlocks] = useState([]);
  const [beoBlocks, setBeoBlocks] = useState([]);

  useEffect(() => {
    const districtList = Object.keys(districtBlockData).map(key => ({
      key,
      ...districtBlockData[key]
    }));
    setDistricts(districtList);
    
    fetchSchools(1);
    fetchBeos(1);
    fetchDistricts(1);
  }, []);

  const fetchSchools = async (page, query = schoolSearchQuery) => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (String(query || '').trim()) params.set('q', String(query).trim());
      const data = await get(`/api/scert/schools?${params.toString()}`, { token: auth.token });
      setSchoolsData(data);
      setSchoolPage(page);
    } catch (err) {
      console.error('Failed to fetch schools:', err);
      toast.error(`Failed to load schools: ${toast.getErrorMessage(err)}`);
    }
  };

  const fetchBeos = async (page, query = beoSearchQuery) => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (String(query || '').trim()) params.set('q', String(query).trim());
      const data = await get(`/api/scert/beos?${params.toString()}`, { token: auth.token });
      setBeosData(data);
      setBeoPage(page);
    } catch (err) {
      console.error('Failed to fetch BEOs:', err);
      toast.error(`Failed to load BEOs: ${toast.getErrorMessage(err)}`);
    }
  };

  const fetchDistricts = async (page, query = districtSearchQuery) => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (String(query || '').trim()) params.set('q', String(query).trim());
      const data = await get(`/api/scert/districts?${params.toString()}`, { token: auth.token });
      setDistrictsData(data);
      setDistrictPage(page);
    } catch (err) {
      console.error('Failed to fetch districts:', err);
      toast.error(`Failed to load districts: ${toast.getErrorMessage(err)}`);
    }
  };

  const resetForms = () => {
    setSchoolData({ school_name: '', udise_code: '', selectedDistrict: '', selectedBlock: '', school_type: '', school_category: '', school_location: '' });
    setBeoData({ unit_id: '', selectedDistrict: '', selectedBlock: '' });
    setDistrictData({ unit_id: '', selectedDistrict: '' });
    setSchoolBlocks([]);
    setBeoBlocks([]);
  };

  const handleSchoolDistrictChange = (districtKey) => {
    setSchoolData({ ...schoolData, selectedDistrict: districtKey, selectedBlock: '' });
    if (districtKey && districtBlockData[districtKey]) {
      const blocks = Object.keys(districtBlockData[districtKey].blocks).map(key => ({
        key,
        ...districtBlockData[districtKey].blocks[key]
      }));
      setSchoolBlocks(blocks);
    } else {
      setSchoolBlocks([]);
    }
  };

  const handleBeoDistrictChange = (districtKey) => {
    setBeoData({ ...beoData, selectedDistrict: districtKey, selectedBlock: '' });
    if (districtKey && districtBlockData[districtKey]) {
      const blocks = Object.keys(districtBlockData[districtKey].blocks).map(key => ({
        key,
        ...districtBlockData[districtKey].blocks[key]
      }));
      setBeoBlocks(blocks);
    } else {
      setBeoBlocks([]);
    }
  };

  const handleCreateSchool = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const selectedDistrictData = districtBlockData[schoolData.selectedDistrict];
      const selectedBlockData = selectedDistrictData.blocks[schoolData.selectedBlock];
      
      const payload = {
        school_name: schoolData.school_name,
        udise_code: schoolData.udise_code,
        block_code: selectedBlockData.block_code,
        block_name: selectedBlockData.block_name,
        district_code: selectedDistrictData.district_code,
        district_name: selectedDistrictData.district_name,
        school_type: schoolData.school_type,
        school_category: schoolData.school_category,
        school_location: schoolData.school_location
      };
      
      const response = await post('/api/scert/school/create', payload, { token: auth.token });
      setCreatedCredentials({
        role: 'School',
        login_id: response.login_id,
        password: response.default_password,
        details: schoolData.school_name
      });
      
      setShowModal(true);
      setSuccess('School created successfully!');
      toast.success('School created successfully!');
      setShowCreateForm(false);
      resetForms();
      fetchSchools(1);
    } catch (err) {
      setError(err.message || 'Failed to create school');
      toast.error(`Failed to create school: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBeo = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const selectedDistrictData = districtBlockData[beoData.selectedDistrict];
      const selectedBlockData = selectedDistrictData.blocks[beoData.selectedBlock];
      
      const payload = {
        unit_id: beoData.unit_id,
        block_code: selectedBlockData.block_code,
        block_name: selectedBlockData.block_name,
        district_code: selectedDistrictData.district_code,
        district_name: selectedDistrictData.district_name
      };
      
      const response = await post('/api/scert/beo/create', payload, { token: auth.token });
      setCreatedCredentials({
        role: 'BEO',
        login_id: response.login_id,
        password: response.default_password,
        details: `Unit ${beoData.unit_id}`
      });
      
      setShowModal(true);
      setSuccess('BEO created successfully!');
      toast.success('BEO created successfully!');
      setShowCreateForm(false);
      resetForms();
      fetchBeos(1);
    } catch (err) {
      setError(err.message || 'Failed to create BEO');
      toast.error(`Failed to create BEO: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDistrict = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const selectedDistrictData = districtBlockData[districtData.selectedDistrict];
      
      const payload = {
        unit_id: districtData.unit_id,
        district_code: selectedDistrictData.district_code,
        district_name: selectedDistrictData.district_name
      };
      
      const response = await post('/api/scert/district/create', payload, { token: auth.token });
      setCreatedCredentials({
        role: 'District',
        login_id: response.login_id,
        password: response.default_password,
        details: `Unit ${districtData.unit_id}`
      });
      
      setShowModal(true);
      setSuccess('District created successfully!');
      toast.success('District created successfully!');
      setShowCreateForm(false);
      resetForms();
      fetchDistricts(1);
    } catch (err) {
      setError(err.message || 'Failed to create district');
      toast.error(`Failed to create district: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard!');
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to copy to clipboard'));
    }
  };

  const executeConfirmAction = async () => {
    const { action, userId, label } = confirmModal;
    setConfirmModal({ ...confirmModal, show: false });

    if (action === 'reset') {
      try {
        const response = await put(
          `/api/scert/users/${userId}/reset-password`,
          {},
          { token: auth.token }
        );
        toast.success(
          `${label} password reset to ${response?.default_password || 'scertPass'} successfully.`
        );
      } catch (err) {
        toast.error(`Failed to reset password: ${toast.getErrorMessage(err)}`);
      }
    } else if (action === 'delete') {
      try {
        await put(
          `/api/scert/users/${userId}/delete`,
          {},
          { token: auth.token }
        );

        toast.success(`${label} deleted successfully.`);

        if (activeRole === 'school') {
          fetchSchools(schoolPage, schoolSearchQuery);
        } else if (activeRole === 'beo') {
          fetchBeos(beoPage, beoSearchQuery);
        } else if (activeRole === 'district') {
          fetchDistricts(districtPage, districtSearchQuery);
        }
      } catch (err) {
        toast.error(`Failed to delete user: ${toast.getErrorMessage(err)}`);
      }
    }
  };

  const handleResetPassword = (userId, label) => {
    setConfirmModal({
      show: true,
      action: 'reset',
      userId,
      label,
      title: 'Confirm Reset Password',
      message: `Are you sure you want to reset the password for ${label} to "scertPass"?`
    });
  };

  const handleDeleteUser = (userId, label) => {
    setConfirmModal({
      show: true,
      action: 'delete',
      userId,
      label,
      title: 'Confirm Delete User',
      message: `Are you sure you want to delete ${label}? This will deactivate the user and remove it from the active user list.`
    });
  };

  const renderPagination = (pagination, onPageChange) => {
    if (!pagination || pagination.totalPages <= 1) return null;
    
    return (
      <div className="table-footer">
        <span className="table-count">
          Total: <strong>{pagination.total}</strong> | Page {pagination.page} of {pagination.totalPages}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="scert-btn-secondary"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page === 1}
            style={{ padding: '0.5rem 1rem' }}
          >
            Previous
          </button>
          <button
            className="scert-btn-secondary"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page === pagination.totalPages}
            style={{ padding: '0.5rem 1rem' }}
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="scert-page">
      <div className="scert-page-header">
        <h1 className="scert-page-title">User & Role Management</h1>
        <p className="scert-page-subtitle">
          Create and manage logins for Schools, BEOs, and Districts.
        </p>
      </div>

      {error && <div className="scert-form-error">{error}</div>}
      {success && <div className="scert-form-success">{success}</div>}

      <div className="roles-container">
        <div className="roles-tabs">
          <button
            className={`role-tab ${activeRole === 'school' ? 'active' : ''}`}
            onClick={() => {
              setActiveRole('school');
              setShowCreateForm(false);
            }}
          >
            School ({schoolsData.pagination?.total || 0})
          </button>
          <button
            className={`role-tab ${activeRole === 'beo' ? 'active' : ''}`}
            onClick={() => {
              setActiveRole('beo');
              setShowCreateForm(false);
            }}
          >
            BEO ({beosData.pagination?.total || 0})
          </button>
          <button
            className={`role-tab ${activeRole === 'district' ? 'active' : ''}`}
            onClick={() => {
              setActiveRole('district');
              setShowCreateForm(false);
            }}
          >
            District ({districtsData.pagination?.total || 0})
          </button>
        </div>

        <div className="roles-content">
          {activeRole === 'school' && !showCreateForm && (
            <div>
              <div className="view-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Schools</h3>
              
            </div>
                <button className="scert-btn-violet" onClick={() => setShowCreateForm(true)}>
          Create School
                </button>
              </div>

              {schoolsData.data.length === 0 ? (
                <div className="empty-state">No schools created yet.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                    <input
                      className="scert-form-input"
                      type="text"
                      placeholder="Search schools on this page"
                      value={schoolSearchInput}
                      onChange={(e) => setSchoolSearchInput(e.target.value)}
                      style={{ marginBottom: 0, flex: 1 }}
                    />
                    <button
                      type="button"
                      className="scert-btn-secondary"
                      onClick={() => {
                        const nextQuery = schoolSearchInput.trim();
                        setSchoolSearchQuery(nextQuery);
                        fetchSchools(1, nextQuery);
                      }}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Search
                    </button>
                  </div>
                  {schoolsData.data.length === 0 ? (
                    <div className="empty-state">No matching schools found.</div>
                  ) : (
                    <div className="smart-table-wrap">
                    <table className="smart-table">
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>Login ID</th>
                          <th>School Name</th>
                          <th>UDISE Code</th>
                          <th>District</th>
                          <th>Block</th>
                          <th>Created At</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schoolsData.data.map((school) => (
                          <tr key={school.user_id} className={window.getSubmissionRoleRowClass(school)}>
                            <td><code className="smart-table-id">#{school.user_id}</code></td>
                            <td className="smart-table-strong">{school.login_id}</td>
                            <td>{school.school_name}</td>
                            <td>{school.udise_code}</td>
                            <td>{school.district_name}</td>
                            <td>{school.block_name}</td>
                            <td>{new Date(school.created_at).toLocaleDateString()}</td>
                            <td style={{ display: 'flex', gap: '1rem' }}>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="Reset password to scertPass"
                                onClick={() =>
                                  handleResetPassword(
                                    school.user_id,
                                    school.school_name || school.login_id || `User #${school.user_id}`
                                  )
                                }
                              >
                                <HiOutlineKey />
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="Delete user"
                                onClick={() =>
                                  handleDeleteUser(
                                    school.user_id,
                                    school.school_name || school.login_id || `User #${school.user_id}`
                                  )
                                }
                              >
                                <HiOutlineTrash />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                  {renderPagination(schoolsData.pagination, (page) => fetchSchools(page, schoolSearchQuery))}
                </>
              )}
            </div>
          )}

          {activeRole === 'school' && showCreateForm && (
            <>
              <div className="view-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Create School</h3>
              
            </div>
                <button className="scert-btn-secondary" onClick={() => setShowCreateForm(false)}>
                  ← Back to List
                </button>
              </div>
              <form className="scert-form" onSubmit={handleCreateSchool}>
                <div className="scert-form-field">
                  <label className="scert-form-label">School Name <span className="scert-form-required">*</span></label>
                  <input className="scert-form-input" value={schoolData.school_name} onChange={(e) => setSchoolData({ ...schoolData, school_name: e.target.value })} required />
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">UDISE Code <span className="scert-form-required">*</span></label>
                  <input className="scert-form-input" value={schoolData.udise_code} onChange={(e) => setSchoolData({ ...schoolData, udise_code: e.target.value })} placeholder="e.g., 123456" required />
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">School Type <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={schoolData.school_type} onChange={(e) => setSchoolData({ ...schoolData, school_type: e.target.value })} required>
                    <option value="">Select School Type</option>
                    <option value="Govt Aided">Govt Aided</option>
                    <option value="Dept of Edu">Dept of Edu</option>
                    <option value="Local Body">Local Body</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">School Category <span className="scert-form-required">*</span></label>
                  <input className="scert-form-input" value={schoolData.school_category} onChange={(e) => setSchoolData({ ...schoolData, school_category: e.target.value })} placeholder="e.g., Primary, UPS only, Sec Only" required />
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">School Location <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={schoolData.school_location} onChange={(e) => setSchoolData({ ...schoolData, school_location: e.target.value })} required>
                    <option value="">Select Location</option>
                    <option value="Rural">Rural</option>
                    <option value="Urban">Urban</option>
                  </select>
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">District <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={schoolData.selectedDistrict} onChange={(e) => handleSchoolDistrictChange(e.target.value)} required>
                    <option value="">Select District</option>
                    {districts.map(district => (
                      <option key={district.key} value={district.key}>{district.district_name}</option>
                    ))}
                  </select>
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">Block <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={schoolData.selectedBlock} onChange={(e) => setSchoolData({ ...schoolData, selectedBlock: e.target.value })} required disabled={!schoolData.selectedDistrict}>
                    <option value="">Select Block</option>
                    {schoolBlocks.map(block => (
                      <option key={block.key} value={block.key}>{block.block_name}</option>
                    ))}
                  </select>
                </div>

                <div className="scert-form-actions">
                  <button type="submit" className="scert-btn-violet" disabled={loading}>
                    {loading ? 'Creating...' : 'Create School Login'}
                  </button>
                </div>
              </form>
            </>
          )}

          {activeRole === 'beo' && !showCreateForm && (
            <div className="applications-view">
              <div className="view-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">BEOs</h3>
              
            </div>
                <button className="scert-btn-violet" onClick={() => setShowCreateForm(true)}>
          Create BEO
                </button>
              </div>

              {beosData.data.length === 0 ? (
                <div className="empty-state">No BEOs created yet.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                    <input
                      className="scert-form-input"
                      type="text"
                      placeholder="Search BEOs on this page"
                      value={beoSearchInput}
                      onChange={(e) => setBeoSearchInput(e.target.value)}
                      style={{ marginBottom: 0, flex: 1 }}
                    />
                    <button
                      type="button"
                      className="scert-btn-secondary"
                      onClick={() => {
                        const nextQuery = beoSearchInput.trim();
                        setBeoSearchQuery(nextQuery);
                        fetchBeos(1, nextQuery);
                      }}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Search
                    </button>
                  </div>
                  {beosData.data.length === 0 ? (
                    <div className="empty-state">No matching BEOs found.</div>
                  ) : (
                    <div className="smart-table-wrap">
                    <table className="smart-table">
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>Login ID</th>
                          <th>Unit ID</th>
                          <th>District</th>
                          <th>Block</th>
                          <th>Created At</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {beosData.data.map((beo) => (
                          <tr key={beo.user_id} className={window.getSubmissionRoleRowClass(beo)}>
                            <td><code className="smart-table-id">#{beo.user_id}</code></td>
                            <td className="smart-table-strong">{beo.login_id}</td>
                            <td>{beo.unit_id}</td>
                            <td>{beo.district_name}</td>
                            <td>{beo.block_name}</td>
                            <td>{new Date(beo.created_at).toLocaleDateString()}</td>
                            <td style={{ display: 'flex', gap: '1rem' }}>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="Reset password to scertPass"
                                onClick={() =>
                                  handleResetPassword(
                                    beo.user_id,
                                    beo.login_id || `BEO #${beo.user_id}`
                                  )
                                }
                              >
                                <HiOutlineKey />
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="Delete user"
                                onClick={() =>
                                  handleDeleteUser(
                                    beo.user_id,
                                    beo.login_id || `BEO #${beo.user_id}`
                                  )
                                }
                              >
                                <HiOutlineTrash />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                  {renderPagination(beosData.pagination, (page) => fetchBeos(page, beoSearchQuery))}
                </>
              )}
            </div>
          )}

          {activeRole === 'beo' && showCreateForm && (
            <>
              <div className="view-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Create BEO</h3>
              
            </div>
                <button className="scert-btn-secondary" onClick={() => setShowCreateForm(false)}>
                  ← Back to List
                </button>
              </div>
              <form className="scert-form" onSubmit={handleCreateBeo}>
                <div className="scert-form-field">
                  <label className="scert-form-label">Unit ID <span className="scert-form-required">*</span></label>
                  <input className="scert-form-input" value={beoData.unit_id} onChange={(e) => setBeoData({ ...beoData, unit_id: e.target.value })} placeholder="Enter Unit ID (e.g. AB1234)" required />
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">District <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={beoData.selectedDistrict} onChange={(e) => handleBeoDistrictChange(e.target.value)} required>
                    <option value="">Select District</option>
                    {districts.map(district => (
                      <option key={district.key} value={district.key}>{district.district_name}</option>
                    ))}
                  </select>
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">Block <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={beoData.selectedBlock} onChange={(e) => setBeoData({ ...beoData, selectedBlock: e.target.value })} required disabled={!beoData.selectedDistrict}>
                    <option value="">Select Block</option>
                    {beoBlocks.map(block => (
                      <option key={block.key} value={block.key}>{block.block_name}</option>
                    ))}
                  </select>
                </div>

                <div className="scert-form-actions">
                  <button type="submit" className="scert-btn-violet" disabled={loading}>
                    {loading ? 'Creating...' : 'Create BEO Login'}
                  </button>
                </div>
              </form>
            </>
          )}

          {activeRole === 'district' && !showCreateForm && (
            <div className="applications-view">
              <div className="view-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Districts</h3>
              
            </div>
                <button className="scert-btn-violet" onClick={() => setShowCreateForm(true)}>
          Create District
                </button>
              </div>

              {districtsData.data.length === 0 ? (
                <div className="empty-state">No districts created yet.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                    <input
                      className="scert-form-input"
                      type="text"
                      placeholder="Search districts on this page"
                      value={districtSearchInput}
                      onChange={(e) => setDistrictSearchInput(e.target.value)}
                      style={{ marginBottom: 0, flex: 1 }}
                    />
                    <button
                      type="button"
                      className="scert-btn-secondary"
                      onClick={() => {
                        const nextQuery = districtSearchInput.trim();
                        setDistrictSearchQuery(nextQuery);
                        fetchDistricts(1, nextQuery);
                      }}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Search
                    </button>
                  </div>
                  {districtsData.data.length === 0 ? (
                    <div className="empty-state">No matching districts found.</div>
                  ) : (
                    <div className="smart-table-wrap">
                    <table className="smart-table">
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>Login ID</th>
                          <th>Unit ID</th>
                          <th>District</th>
                          <th>Created At</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {districtsData.data.map((district) => (
                          <tr key={district.user_id} className={window.getSubmissionRoleRowClass(district)}>
                            <td><code className="smart-table-id">#{district.user_id}</code></td>
                            <td className="smart-table-strong">{district.login_id}</td>
                            <td>{district.unit_id}</td>
                            <td>{district.district_name}</td>
                            <td>{new Date(district.created_at).toLocaleDateString()}</td>
                            <td style={{ display: 'flex', gap: '1rem' }}>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="Reset password to scertPass"
                                onClick={() =>
                                  handleResetPassword(
                                    district.user_id,
                                    district.login_id || `District #${district.user_id}`
                                  )
                                }
                              >
                                <HiOutlineKey />
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="Delete user"
                                onClick={() =>
                                  handleDeleteUser(
                                    district.user_id,
                                    district.login_id || `District #${district.user_id}`
                                  )
                                }
                              >
                                <HiOutlineTrash />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                  {renderPagination(districtsData.pagination, (page) => fetchDistricts(page, districtSearchQuery))}
                </>
              )}
            </div>
          )}

          {activeRole === 'district' && showCreateForm && (
            <>
              <div className="view-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Create District</h3>
              
            </div>
                <button className="scert-btn-secondary" onClick={() => setShowCreateForm(false)}>
                  ← Back to List
                </button>
              </div>
              <form className="scert-form" onSubmit={handleCreateDistrict}>
                <div className="scert-form-field">
                  <label className="scert-form-label">Unit ID <span className="scert-form-required">*</span></label>
                  <input className="scert-form-input" value={districtData.unit_id} onChange={(e) => setDistrictData({ ...districtData, unit_id: e.target.value })} placeholder="Enter Unit ID (e.g. AB1234)" required />
                </div>

                <div className="scert-form-field">
                  <label className="scert-form-label">District <span className="scert-form-required">*</span></label>
                  <select className="scert-form-input" value={districtData.selectedDistrict} onChange={(e) => setDistrictData({ ...districtData, selectedDistrict: e.target.value })} required>
                    <option value="">Select District</option>
                    {districts.map(district => (
                      <option key={district.key} value={district.key}>{district.district_name}</option>
                    ))}
                  </select>
                </div>

                <div className="scert-form-actions">
                  <button type="submit" className="scert-btn-violet" disabled={loading}>
                    {loading ? 'Creating...' : 'Create District Login'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {showModal && createdCredentials && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content credentials-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">✅ {createdCredentials.role} Created Successfully</h2>
              <button className="modal-close-btn" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="credentials-content">
              <p className="credentials-warning">
                ⚠️ <strong>Important:</strong> Save these credentials securely. They won't be shown again.
              </p>

              <div className="credentials-details">
                <div className="credential-item">
                  <label>Role Type:</label>
                  <div className="credential-value">
                    <span>{createdCredentials.role}</span>
                  </div>
                </div>

                <div className="credential-item">
                  <label>Details:</label>
                  <div className="credential-value">
                    <span>{createdCredentials.details}</span>
                  </div>
                </div>

                <div className="credential-item">
                  <label>Login ID:</label>
                  <div className="credential-value">
                    <code>{createdCredentials.login_id}</code>
                    <button className="copy-btn" onClick={() => copyToClipboard(createdCredentials.login_id)} title="Copy to clipboard">
                      <HiOutlineClipboardCopy />
                    </button>
                  </div>
                </div>

                <div className="credential-item">
                  <label>Default Password:</label>
                  <div className="credential-value">
                    <code>{createdCredentials.password}</code>
                    <button className="copy-btn" onClick={() => copyToClipboard(createdCredentials.password)} title="Copy to clipboard">
                      <HiOutlineClipboardCopy />
                    </button>
                  </div>
                </div>
              </div>

              <div className="credentials-note">
                <p>📝 The user must change their password on first login.</p>
              </div>
            </div>

            <div className="modal-actions">
              <button className="scert-btn-primary" onClick={() => setShowModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmModal.show && (
        <div className="modal-overlay" onClick={() => setConfirmModal({ ...confirmModal, show: false })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{confirmModal.title}</h2>
              <button className="modal-close-btn" onClick={() => setConfirmModal({ ...confirmModal, show: false })}>✕</button>
            </div>
            <div className="credentials-content" style={{ padding: '1rem 0' }}>
              <p>{confirmModal.message}</p>
            </div>
            <div className="modal-actions">
              <button
                className={confirmModal.action === 'delete' ? 'scert-btn-danger' : 'scert-btn-violet'}
                onClick={executeConfirmAction}
              >
                Yes, {confirmModal.action === 'delete' ? 'Delete' : 'Reset'}
              </button>
              <button
                className="scert-btn-secondary"
                onClick={() => setConfirmModal({ ...confirmModal, show: false })}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
