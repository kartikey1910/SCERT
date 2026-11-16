import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { get, put } from './apiClient';
import { useToast } from './ToastContext';

export function ScertRateConfigurationPage() {
  const { auth } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reportType, setReportType] = useState('CS_REPORT');
  
  const [rates, setRates] = useState([]);

  useEffect(() => {
    if (reportType === 'CS_REPORT') {
      fetchHonorariumRates();
    } else if (reportType === 'BEO_REPORT' || reportType === 'CEO_REPORT') {
      fetchSystemRates();
    }
  }, [reportType]);

  const fetchHonorariumRates = async () => {
    setLoading(true);
    try {
      const data = await get('/api/scert/rates/honorarium', { token: auth.token });
      const formatted = (data.rates || []).map(r => ({
        key: r.staff_role,
        name: r.staff_role,
        value: r.honorarium_per_unit,
        isSystemRate: false
      }));
      setRates(formatted);
    } catch (err) {
      console.error('Failed to fetch rates', err);
      toast.error('Failed to load rates');
    } finally {
      setLoading(false);
    }
  };

  const fetchSystemRates = async () => {
    setLoading(true);
    try {
      const data = await get(`/api/scert/rates/system?report_type=${reportType}`, { token: auth.token });
      const formatted = (data.rates || []).map(r => ({
        key: r.rate_key,
        name: r.rate_name,
        value: r.rate_value,
        isSystemRate: true
      }));
      setRates(formatted);
    } catch (err) {
      console.error('Failed to fetch system rates', err);
      toast.error('Failed to load system rates');
    } finally {
      setLoading(false);
    }
  };

  const handleRateChange = (key, newValue) => {
    setRates((prevRates) =>
      prevRates.map((r) =>
        r.key === key ? { ...r, value: newValue } : r
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (reportType === 'CS_REPORT') {
        const payload = rates.map(r => ({ staff_role: r.key, honorarium_per_unit: r.value }));
        await put('/api/scert/rates/honorarium', { rates: payload }, { token: auth.token });
      } else {
        const payload = rates.map(r => ({ rate_key: r.key, rate_value: r.value }));
        await put('/api/scert/rates/system', { rates: payload }, { token: auth.token });
      }
      toast.success('Rates updated successfully');
    } catch (err) {
      console.error('Failed to update rates', err);
      toast.error('Failed to save rates');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scert-page">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Rate Configuration</h3>
          
        </div>
      </div>

      <div className="dashboard-card" style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', color: '#1e293b' }}>
            Select Report Configuration
          </label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
              fontSize: '15px'
            }}
          >
            <option value="CS_REPORT">Center Superintendent (CS) Report Rates</option>
            <option value="BEO_REPORT">BEO Details Report Rates</option>
            <option value="CEO_REPORT">CEO Details Report Rates</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-state">Loading rates...</div>
        ) : (
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: 600, color: '#334155', marginBottom: '16px' }}>
              {reportType === 'CS_REPORT' ? 'Staff Honorarium Rates (₹)' : 'System Rates (₹)'}
            </h4>
            
            {rates.length === 0 ? (
              <p style={{ color: '#64748b', fontStyle: 'italic' }}>No rates configured yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {rates.map((rate, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 500, color: '#1e293b' }}>
                      {rate.name}
                      {reportType === 'CS_REPORT' && rate.key === 'Contingence' ? (
                        <div style={{ fontWeight: 400, fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                          One flat amount added to every center&apos;s report. BEOs cannot change it;
                          saving updates this session&apos;s existing reports.
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#64748b', fontWeight: 500 }}>₹</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rate.value || ''}
                        onChange={(e) => handleRateChange(rate.key, e.target.value)}
                        style={{
                          width: '120px',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: '#0f172a'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="scert-btn-primary"
                onClick={handleSave}
                disabled={saving || rates.length === 0}
                style={{ minWidth: '140px' }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
