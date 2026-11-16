import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';

export function DistrictBeoListPage() {
  const { auth } = useAuth();
  const [beos, setBeos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchBeos = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await get('/api/district/beos', { token: auth?.token });
        setBeos(Array.isArray(data?.beos) ? data.beos : []);
      } catch (err) {
        console.error('Failed to fetch BEOs:', err);
        setError(err.message || 'Failed to load BEO list');
        setBeos([]);
      } finally {
        setLoading(false);
      }
    };

    if (auth?.token) {
      fetchBeos();
    }
  }, [auth?.token]);

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">List of BEOs</h3>
          <p className="view-subtitle">Block Education Officers under your district</p>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading BEOs...</div>
      ) : beos.length === 0 ? (
        <div className="empty-state">No BEOs found for this district.</div>
      ) : (
        <div className="smart-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: '72px' }}>S. No.</th>
                <th style={{ textAlign: 'left' }}>Block Name</th>
                <th style={{ textAlign: 'left' }}>Block Code</th>
                <th style={{ textAlign: 'left' }}>BEO Name</th>
                <th style={{ textAlign: 'left' }}>Mobile No.</th>
              </tr>
            </thead>
            <tbody>
              {beos.map((beo, idx) => (
                <tr key={beo.user_id || idx}>
                  <td className="smart-table-strong" style={{ textAlign: 'left' }}>{idx + 1}</td>
                  <td style={{ textAlign: 'left' }}>{beo.block_name || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{beo.block_code || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{beo.beo_name || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{beo.beo_mobile || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
