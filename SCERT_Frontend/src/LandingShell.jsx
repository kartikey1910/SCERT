import { Outlet } from 'react-router-dom'
import { LandingPage } from './LandingPage.jsx'

export function LandingShell() {
  return (
    <div style={{ position: 'relative' }}>
      <LandingPage />
      <Outlet />
    </div>
  )
}
