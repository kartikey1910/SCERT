import { useEffect } from 'react';
import { PublicTopNav } from './PublicTopNav.jsx';
import { HowToApplyGuide } from './HowToApplyGuide.jsx';

// The public guide. BEO tutorials are kept off it: they live in the BEO
// dashboard's own How to Apply tab (see utils/howToApplyGuide.js).
export function HowToApplyPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="landing-root">
      <PublicTopNav activeTab="How to Apply" />

      <main className="landing-main">
        <HowToApplyGuide audience="public" />
      </main>
    </div>
  );
}
