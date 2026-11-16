export function VerificationPager({ page, total, limit, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontSize: '13px', color: '#6b7280', flexWrap: 'wrap', gap: '8px',
    }}>
      <span>
        {total === 0
          ? 'No records'
          : `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total.toLocaleString()}`}
      </span>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          style={{
            padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
            background: page <= 1 ? '#f3f4f6' : '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer',
          }}
        >
          Prev
        </button>
        <span style={{ padding: '6px 12px' }}>Page {page} of {totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          style={{
            padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
            background: page >= totalPages ? '#f3f4f6' : '#fff', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
