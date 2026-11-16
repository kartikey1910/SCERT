import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { post } from './apiClient.js'
import { useAuth } from './AuthContext.jsx'
import { ChangePasswordModal } from './ChangePasswordModal.jsx'
import { SchoolProfileForm } from './SchoolProfileForm.jsx'
import { BeoProfileForm } from './BeoProfileForm.jsx'
import { DistrictProfileForm } from './DistrictProfileForm.jsx'

const DEFAULT_ROLE_HINTS = [
  'Student – Registered Email',
  'School – UDISE Code',
  'BEO – Unit ID',
  'District – Unit ID',
  'SCERT – Official Email',
]

export function LoginForm({
  title = 'Sign in to continue',
  subtitle = 'Use your registered Login ID and password to access the SCERT scholarship portal.',
  loginIdPlaceholder = 'Email / UDISE Code / Unit ID',
  roleHints = DEFAULT_ROLE_HINTS,
  redirectPath,
  showRegisterLink = false,
  onRegisterClick = null,
  loginIdInputType = 'text',
  loginIdValidator = null,
  loginIdSanitizer = null,
  passwordMinLength = null,
}) {
  const { login, updateAuth, logout } = useAuth()
  const navigate = useNavigate()

  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [currentRole, setCurrentRole] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState({ loginId: false, password: false })
  const [fieldErrors, setFieldErrors] = useState({ loginId: '', password: '' })

  // Client-side rate limiting (UX only): lock after 5 failed attempts for 3 minutes.
  const RATE_LIMIT_MAX_ATTEMPTS = 5
  const RATE_LIMIT_LOCK_MS = 3 * 60 * 1000

  const rateLimitKey = useMemo(() => {
    const raw = redirectPath || title || 'default'
    const safe = String(raw).replace(/\s+/g, '_')
    return `scert_login_rate:${safe}`
  }, [redirectPath, title])

  const [rateState, setRateState] = useState(() => {
    if (typeof window === 'undefined') return { failCount: 0, lockUntil: 0 }
    try {
      const raw = window.localStorage.getItem(rateLimitKey)
      const parsed = raw ? JSON.parse(raw) : null
      return {
        failCount: Number(parsed?.failCount || 0),
        lockUntil: Number(parsed?.lockUntil || 0),
      }
    } catch {
      return { failCount: 0, lockUntil: 0 }
    }
  })

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Re-hydrate when switching pages / roles
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(rateLimitKey)
      const parsed = raw ? JSON.parse(raw) : null
      setRateState({
        failCount: Number(parsed?.failCount || 0),
        lockUntil: Number(parsed?.lockUntil || 0),
      })
    } catch {
      setRateState({ failCount: 0, lockUntil: 0 })
    }
  }, [rateLimitKey])

  useEffect(() => {
    if (!rateState.lockUntil) return
    if (Date.now() >= rateState.lockUntil) return

    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [rateState.lockUntil])

  const isLocked = rateState.lockUntil && now < rateState.lockUntil
  const lockSecondsLeft = isLocked ? Math.ceil((rateState.lockUntil - now) / 1000) : 0

  const formatLockTime = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${String(s).padStart(2, '0')}s`
  }
  const handleCancel = () => {
  navigate('/', { replace: true })
}

  const persistRateState = (next) => {
    setRateState(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(rateLimitKey, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const validateLoginId = (value) => {
    const v = String(value || '').trim()
    if (!v) return 'Login ID is required.'
    if (typeof loginIdValidator === 'function') {
      return loginIdValidator(v) || ''
    }
    return ''
  }

  const validatePassword = (value) => {
    const v = String(value || '')
    if (!v) return 'Password is required.'
    if (typeof passwordMinLength === 'number' && passwordMinLength > 0 && v.length < passwordMinLength) {
      return `Password must be at least ${passwordMinLength} characters.`
    }
    return ''
  }

  const validateAll = (values = { loginId, password }) => {
    return {
      loginId: validateLoginId(values.loginId),
      password: validatePassword(values.password),
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (isLocked) {
      setError(`Too many failed login attempts. Please try again in ${formatLockTime(lockSecondsLeft)}.`)
      return
    }

    const nextTouched = { loginId: true, password: true }
    setTouched(nextTouched)

    const nextErrors = validateAll({ loginId, password })
    setFieldErrors(nextErrors)

    if (nextErrors.loginId || nextErrors.password) {
      setError('Please correct the highlighted fields and try again.')
      return
    }

    setLoading(true)
    try {
      const data = await post('/api/auth/login', {
        login_id: loginId.trim(),
        password,
      })

      // Reset rate limiter on successful login
      persistRateState({ failCount: 0, lockUntil: 0 })

      const payload = {
        token: data.token,
        role: data.role,
        role_id: data.role_id,
        is_first_login: Boolean(data.is_first_login),
        profile_completed: Boolean(data.profile_completed),
      }

      login(payload)
      setCurrentRole(data.role)

      const rolesWithFirstLogin = ['school', 'beo', 'district']
      const roleLower = String(data.role || '').toLowerCase()

      if (payload.is_first_login && rolesWithFirstLogin.includes(roleLower)) {
        setShowPasswordModal(true)
      } else if (!payload.profile_completed && rolesWithFirstLogin.includes(roleLower)) {
        setShowProfileForm(true)
      } else {
        setSuccess('Login successful. Redirecting to your dashboard...')
        if (redirectPath) {
          navigate(redirectPath, { replace: true })
        }
      }
    } catch (err) {
      const status = err?.status
      const isCredentialFailure = status === 401 || status === 403
      // SCERT has switched Student Access off. The password was right, so this is
      // neither a wrong-credentials message nor a failed attempt toward the lockout.
      const isStudentAccessClosed = err?.data?.code === 'STUDENT_ACCESS_DISABLED'

      if (isStudentAccessClosed) {
        setError(err.message || 'Student access is currently closed. Please try again later.')
      } else if (isCredentialFailure) {
        const nextFailCount = (rateState.failCount || 0) + 1

        if (nextFailCount >= RATE_LIMIT_MAX_ATTEMPTS) {
          const lockUntil = Date.now() + RATE_LIMIT_LOCK_MS
          persistRateState({ failCount: 0, lockUntil })
          setError('Too many failed login attempts. Your login is locked for 3 minutes.')
        } else {
          persistRateState({ failCount: nextFailCount, lockUntil: 0 })
          const remaining = RATE_LIMIT_MAX_ATTEMPTS - nextFailCount
          setError(`Invalid credentials. You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`)
        }
      } else {
        setError(err.message || 'Unable to login. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordChangeSuccess = () => {
    logout()
    setShowPasswordModal(false)
    setShowProfileForm(false)
    setSuccess('Password changed successfully. Please sign in again.')
    navigate('/', { replace: true })
  }

  const handleProfileSuccess = () => {
    updateAuth({ profile_completed: true })
    setShowProfileForm(false)
    setSuccess('Profile completed successfully. Redirecting...')
    setTimeout(() => {
      if (redirectPath) {
        navigate(redirectPath, { replace: true })
      }
    }, 1000)
  }

  const renderProfileForm = () => {
    switch (String(currentRole || '').toLowerCase()) {
      case 'school':
        return <SchoolProfileForm onSuccess={handleProfileSuccess} />
      case 'beo':
        return <BeoProfileForm onSuccess={handleProfileSuccess} />
      case 'district':
        return <DistrictProfileForm onSuccess={handleProfileSuccess} />
      default:
        return null
    }
  }

  if (showPasswordModal) {
    return <ChangePasswordModal onSuccess={handlePasswordChangeSuccess} />
  }

  if (showProfileForm) {
    return renderProfileForm()
  }

  return (
    <div className="auth-modal-form-wrap">
      {title || subtitle ? (
        <div className="auth-modal-form-header">
          {title ? <h3 className="auth-modal-form-title">{title}</h3> : null}
          {subtitle ? <p className="auth-modal-form-subtitle">{subtitle}</p> : null}
        </div>
      ) : null}

      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label className="form-label" htmlFor="loginId">
            Login ID
          </label>
          <input
            id="loginId"
            type={loginIdInputType}
            className={`form-input ${touched.loginId && fieldErrors.loginId ? 'input-error' : ''}`}
            placeholder={loginIdPlaceholder}
            autoComplete="username"
            value={loginId}
            onChange={(e) => {
              const rawValue = e.target.value
              const v =
                typeof loginIdSanitizer === 'function'
                  ? loginIdSanitizer(rawValue)
                  : rawValue
              setLoginId(v)
              if (touched.loginId) {
                setFieldErrors((prev) => ({ ...prev, loginId: validateLoginId(v) }))
              }
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, loginId: true }))
              setFieldErrors((prev) => ({ ...prev, loginId: validateLoginId(loginId) }))
            }}
            aria-invalid={Boolean(touched.loginId && fieldErrors.loginId)}
          />
          {touched.loginId && fieldErrors.loginId && (
            <div className="field-error-text">{fieldErrors.loginId}</div>
          )}

          {Array.isArray(roleHints) && roleHints.length > 0 && (
            <div className="role-hints">
              {roleHints.map((hint) => (
                <span key={hint} className="role-pill">
                  {hint}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="password">
            Password
          </label>
          <div className="password-input">
  <input
    id="password"
    type={showPassword ? 'text' : 'password'}
    className={`form-input ${touched.password && fieldErrors.password ? 'input-error' : ''}`}
    placeholder="Enter your password"
    autoComplete="current-password"
    value={password}
    onChange={(e) => {
      const v = e.target.value
      setPassword(v)
      if (touched.password) {
        setFieldErrors((prev) => ({ ...prev, password: validatePassword(v) }))
      }
    }}
    onBlur={() => {
      setTouched((prev) => ({ ...prev, password: true }))
      setFieldErrors((prev) => ({ ...prev, password: validatePassword(password) }))
    }}
    aria-invalid={Boolean(touched.password && fieldErrors.password)}
  />

  <button
    type="button"
    onClick={() => setShowPassword(!showPassword)}
    className="auth-modal-password-toggle"
    aria-label={showPassword ? 'Hide password' : 'Show password'}
  >
    {showPassword ? (
      /* eye-off svg */
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    ) : (
      /* eye svg */
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )}
  </button>
</div>


          {touched.password && fieldErrors.password && (
            <div className="field-error-text">{fieldErrors.password}</div>
          )}
          {!fieldErrors.password && typeof passwordMinLength === 'number' && passwordMinLength > 0 && (
            <div className="field-helper-text">Minimum {passwordMinLength} characters.</div>
          )}
        </div>

<div className="login-actions">
  <button
    type="button"
    className="login-cancel-button "
    onClick={handleCancel}
    disabled={loading}
  >
    Cancel
  </button>

  <button
    type="submit"
    className="login-button"
    disabled={loading || isLocked || !loginId.trim() || !password}
  >
    {loading ? (
      <>
        <span className="login-button-spinner" />
        Signing in...
      </>
    ) : (
      <>
        Continue
        <span aria-hidden="true">→</span>
      </>
    )}
  </button>
</div>


        {error && <div className={`login-error ${isLocked ? 'lockout' : ''}`}>{error}</div>}
        {success && <div className="login-success">{success}</div>}

        {showRegisterLink && onRegisterClick && (
          <div className="register-link-container">
            <span>Don't have an account? </span>
            <button type="button" className="register-link" onClick={onRegisterClick}>
              Register here
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
