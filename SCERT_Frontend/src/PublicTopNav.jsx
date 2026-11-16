import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudentAccessPublic } from './api/studentAccess.api.js';

const NAV_TABS = [
  { label: 'Home', route: '/' },
  { label: 'About Us', route: '/about-us' },
  { label: 'How to Apply', route: '/how-to-apply' },
  { label: 'Exemplar Questions', route: '/exemplar-questions' },
  { label: 'Publications', route: '/publications' },
  { label: 'Announcements', route: '/announcements' },
  { label: 'Important Circulars & GOs', route: '/important-circulars' },
  { label: 'Contact Us', href: '#contact-us' },
];

export function PublicTopNav({ activeTab = 'Home', onTabSelect }) {
  const navigate = useNavigate();
  const [deptOpen, setDeptOpen] = useState(false);
  // The Student Login button is shown only while SCERT has student access switched on.
  const [studentAccessOpen, setStudentAccessOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    getStudentAccessPublic().then((status) => {
      if (mounted) setStudentAccessOpen(status.enabled === true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const goto = (path) => {
    setDeptOpen(false);
    navigate(path);
  };

  return (
    <>
      <header className="landing-header">
        <div className="landing-header-inner">
          <div className="landing-header-left">
            <img src="/scert-logo.png" alt="SCERT" className="landing-logo" />
          </div>

          <div className="landing-header-right">
            <div className="landing-actions">
              {studentAccessOpen && (
                <button
                  type="button"
                  className="landing-btn-student"
                  onClick={() => goto('/login/student')}
                >
                  Student Login
                </button>
              )}

              <button
                type="button"
                className="landing-btn-student"
                onClick={() => goto('/login/school')}
              >
                School Login
              </button>

              <div className="landing-dept-wrapper">
                <button
                  type="button"
                  className="landing-btn-dept"
                  onClick={() => setDeptOpen((open) => !open)}
                >
                  Department Login <span aria-hidden="true">▾</span>
                </button>

                {deptOpen && (
                  <div className="landing-dept-menu">
                    <button
                      type="button"
                      className="landing-dept-item"
                      onClick={() => goto('/login/beo')}
                    >
                      Block Login
                    </button>
                    <button
                      type="button"
                      className="landing-dept-item"
                      onClick={() => goto('/login/district')}
                    >
                      District Login
                    </button>
                    <button
                      type="button"
                      className="landing-dept-item"
                      onClick={() => goto('/login/scert')}
                    >
                      SCERT Login
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <nav className="landing-primary-nav" aria-label="Primary">
        <div className="landing-primary-nav-inner">
          {NAV_TABS.map((tab) => (
            <a
              key={tab.label}
              href={tab.route ? `#${tab.route}` : tab.href}
              className={`landing-nav-link ${activeTab === tab.label ? 'landing-nav-link-active' : ''}`}
              onClick={(e) => {
                onTabSelect?.(tab.label);
                if (tab.route) {
                  e.preventDefault();
                  goto(tab.route);
                }
              }}
            >
              {tab.label}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
