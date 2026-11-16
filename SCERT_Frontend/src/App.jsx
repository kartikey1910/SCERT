import './App.css'
import { HashRouter as BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { LandingShell } from './LandingShell.jsx'
import { StudentLoginPage } from './student.login-page.jsx'
import { SchoolLoginPage } from './school.login-page.jsx'
import { BeoLoginPage } from './beo.login-page.jsx'
import { DistrictLoginPage } from './district.login-page.jsx'
import { ScertLoginPage } from './scert.login-page.jsx'
import { RequireScert } from './scert.require-auth.jsx'
import { ScertDashboardLayout } from './scert.dashboard-layout.jsx'
import { RequireSchool, RequireBeo, RequireDistrict, RequireStudent } from './role.require-auth.jsx'
import { SchoolDashboard } from './SchoolDashboard.jsx'
import { StudentDashboard } from './StudentDashboard.jsx'
import { BeoDashboard, DistrictDashboard } from './role.dashboards.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { PublicSchoolListPage } from './PublicSchoolListPage.jsx'
import { AboutUsPage } from './AboutUsPage.jsx'
import { ExemplarQuestionsPage } from './ExemplarQuestionsPage.jsx'
import { PublicationsPage } from './PublicationsPage.jsx'
import { AnnouncementsPage } from './AnnouncementsPage.jsx'
import { ImportantCircularsPage } from './ImportantCircularsPage.jsx'
import { HowToApplyPage } from './HowToApplyPage.jsx'
import { ViewResultPage } from './ViewResultPage.jsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing remains mounted as the background for login modals */}
        <Route path="/" element={<LandingShell />}>
          <Route index element={<></>} />
          <Route path="login/student" element={<StudentLoginPage />} />
          <Route path="login/school" element={<SchoolLoginPage />} />
          <Route path="login/beo" element={<BeoLoginPage />} />
          <Route path="login/district" element={<DistrictLoginPage />} />
          <Route path="login/scert" element={<ScertLoginPage />} />
        </Route>

        <Route path="/research-publications" element={<PublicationsPage />} />
        <Route path="/schools" element={<PublicSchoolListPage />} />
        <Route path="/about-us" element={<AboutUsPage />} />
        <Route path="/exemplar-questions" element={<ExemplarQuestionsPage />} />
        <Route path="/publications" element={<PublicationsPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/important-circulars" element={<ImportantCircularsPage />} />
        <Route path="/how-to-apply" element={<HowToApplyPage />} />
        <Route path="/view-result" element={<ViewResultPage />} />

        <Route
          path="/student/dashboard"
          element={
            <RequireStudent>
              <StudentDashboard />
            </RequireStudent>
          }
        />

        <Route
          path="/school/dashboard"
          element={
            <RequireSchool>
              <ErrorBoundary>
                <SchoolDashboard />
              </ErrorBoundary>
            </RequireSchool>
          }
        />

        <Route
          path="/beo/dashboard"
          element={
            <RequireBeo>
              <BeoDashboard />
            </RequireBeo>
          }
        />

        <Route
          path="/district/dashboard"
          element={
            <RequireDistrict>
              <DistrictDashboard />
            </RequireDistrict>
          }
        />

        <Route
          path="/scert/dashboard"
          element={
            <RequireScert>
              <ScertDashboardLayout />
            </RequireScert>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
