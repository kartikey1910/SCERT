const shellStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '18px',
  overflow: 'hidden',
  background: '#fff',
};

const scrollStyle = {
  width: '100%',
  overflowX: 'auto',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '900px',
};

const thStyle = {
  background: '#f8fafc',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 800,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  padding: '14px 16px',
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  fontSize: '14px',
  color: '#1f2937',
  padding: '14px 16px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
};

const emptyStyle = {
  padding: '42px 18px',
  textAlign: 'center',
  color: '#6b7280',
  fontSize: '15px',
};

const footerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  padding: '14px 16px',
  borderTop: '1px solid #e5e7eb',
  background: '#fcfcfd',
  flexWrap: 'wrap',
};

const pagerButtonStyle = {
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: '10px',
  padding: '8px 12px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledPagerStyle = {
  ...pagerButtonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const loadingStyle = {
  padding: '48px 18px',
  textAlign: 'center',
  color: '#475569',
  fontSize: '15px',
};

const errorStyle = {
  padding: '18px',
  margin: '16px',
  borderRadius: '12px',
  background: '#fff1f2',
  color: '#be123c',
  fontSize: '14px',
  border: '1px solid #fecdd3',
};

function renderCell(column, row, rowIndex) {
  if (typeof column.render === 'function') {
    return column.render(row, rowIndex);
  }

  const value = row?.[column.key];
  return value === undefined || value === null || value === '' ? '—' : value;
}

export function ResultTable({
  columns = [],
  rows = [],
  loading = false,
  error = '',
  emptyMessage = 'No records available.',
  pagination = null,
  onPageChange,
}) {
  const page = Number(pagination?.page || 1);
  const limit = Number(pagination?.limit || 10);
  const total = Number(pagination?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));

  return (
    <div style={shellStyle}>
      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={scrollStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={thStyle}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length || 1} style={loadingStyle}>
                  Loading data...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length || 1} style={emptyStyle}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={row.id || row.rank || row.roll_number || row.school_name || row.block_code || row.district_name || rowIndex} className={window.getSubmissionRoleRowClass(row)}>
                  {columns.map((column) => (
                    <td key={column.key} style={tdStyle}>
                      {renderCell(column, row, rowIndex)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && !loading ? (
        <div style={footerStyle}>
          <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
            Showing page {page} of {totalPages} • {total} total record{total === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              style={page <= 1 ? disabledPagerStyle : pagerButtonStyle}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              style={page >= totalPages ? disabledPagerStyle : pagerButtonStyle}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
