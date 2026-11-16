const tableContainerStyle = {
  width: '100%',
  overflowX: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: '13px',
};

const thStyle = {
  background: '#f8fafc',
  padding: '12px 16px',
  fontWeight: 700,
  color: '#475569',
  borderBottom: '1px solid #e5e7eb',
  borderRight: '1px solid #f1f5f9',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  borderRight: '1px solid #f1f5f9',
  color: '#1e293b',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const paginationWrapStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '16px',
  padding: '0 8px',
};

const btnStyle = {
  padding: '8px 16px',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  color: '#334155',
  fontWeight: 600,
  fontSize: '13px',
  cursor: 'pointer',
};

export function RemainingSchoolsTable({
  rows = [],
  loading = false,
  error = '',
  page = 1,
  limit = 25,
  total = 0,
  onPageChange,
}) {
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      <div style={tableContainerStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>School Name</th>
              <th style={thStyle}>District</th>
              <th style={thStyle}>Block</th>
              <th style={thStyle}>Classification</th>
              <th style={thStyle}>School Type</th>
              <th style={thStyle}>Location</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#dc2626' }}>
                  {error}
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                  Loading remaining schools...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                  No remaining schools found for the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} style={i % 2 === 0 ? { background: '#ffffff' } : { background: '#fafafa' }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{row.school_name || '-'}</td>
                  <td style={tdStyle}>{row.district_name || '-'}</td>
                  <td style={tdStyle}>{row.block_name || '-'}</td>
                  <td style={{ ...tdStyle, color: '#2563eb', fontWeight: 600 }}>{row.school_classification || 'OTHER'}</td>
                  <td style={tdStyle}>{row.school_type || '-'}</td>
                  <td style={tdStyle}>{row.school_location || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div style={paginationWrapStyle}>
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
            Showing {Math.min((page - 1) * limit + 1, total)} to {Math.min(page * limit, total)} of {total} remaining schools
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={{ ...btnStyle, opacity: page <= 1 ? 0.5 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </button>
            <button
              style={{ ...btnStyle, opacity: page >= totalPages ? 0.5 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
