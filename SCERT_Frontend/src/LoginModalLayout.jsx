import { useNavigate } from 'react-router-dom'
import { ModalOverlay } from './ModalOverlay.jsx'

export function LoginModalLayout({ title = 'Welcome', subtitle, brandTitle, brandSubtitle, brandImageSrc = '/scert-logo.png', children }) {
  const navigate = useNavigate()


  return (
    <ModalOverlay ariaLabel={title} onClose={close}>
      <div className="auth-modal-window auth-modal-single" role="document">

        <div className="auth-modal-left auth-modal-full">
          <div className="auth-modal-logo-top">
            <img src={brandImageSrc} alt="SCERT Logo" className="auth-modal-top-logo" />
          </div>
          <div className="auth-modal-heading">
            <h2 className="auth-modal-title">{title}</h2>
            {subtitle ? <p className="auth-modal-subtitle">{subtitle}</p> : null}
          </div>
          <div className="auth-modal-body">{children}</div>
        </div>
        
      </div>
    </ModalOverlay>
  )
}
