import { useEffect } from 'react'

export function ModalOverlay({ children, onClose, ariaLabel = 'Dialog' }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="auth-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        // close only when clicking the backdrop, not the content
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="auth-modal-overlay-inner">{children}</div>
    </div>
  )
}
