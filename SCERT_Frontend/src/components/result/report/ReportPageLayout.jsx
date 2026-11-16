import React from 'react';

const layoutStyle = {
  width: '100%',
  maxWidth: '850px',
  margin: '0 auto 32px auto',
  background: '#ffffff',
  padding: '48px 40px',
  boxSizing: 'border-box',
  fontFamily: '"Inter", "Roboto", sans-serif',
  pageBreakAfter: 'always',
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
  color: '#0f172a'
};

export function ReportPageLayout({ children, isLastPage }) {
  const style = isLastPage ? { ...layoutStyle, pageBreakAfter: 'auto', marginBottom: 0 } : layoutStyle;
  
  return (
    <div style={style} className="print-page-layout">
      {children}
      <style>{`
        @media print {
          body {
            background: #fff;
            -webkit-print-color-adjust: exact;
          }
          .print-page-layout {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 20px !important;
            max-width: 100% !important;
            page-break-after: always;
          }
          .print-page-layout:last-child {
            page-break-after: auto;
          }
        }
      `}</style>
    </div>
  );
}
