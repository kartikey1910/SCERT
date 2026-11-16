import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicTopNav } from './PublicTopNav.jsx';
import { ScoreCard } from './components/result/ScoreCard.jsx';
import { getResultAvailability, lookupResult } from './api/resultPublish.api.js';

/**
 * Public result lookup: roll number + date of birth in, official score
 * card out.
 *
 * The form stays on screen after a successful lookup so a parent can
 * check several children without navigating back and forth.
 */
export function ViewResultPage() {
  const navigate = useNavigate();

  const [availability, setAvailability] = useState({ loading: true, published: false });
  const [rollNumber, setRollNumber] = useState('');
  const [dob, setDob] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [card, setCard] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getResultAvailability();
      if (!cancelled) setAvailability({ loading: false, published: Boolean(res?.published) });
    })();
    return () => { cancelled = true; };
  }, []);

  // Warm the browser's cache for the score-card letterhead emblem as soon
  // as this page mounts — well before a lookup even resolves, let alone
  // before anyone reaches the print button. Without this, the very first
  // print of a session could fire while the <img> in ScoreCard was still
  // mid-fetch and come out with a blank letterhead.
  useEffect(() => {
    const img = new Image();
    img.src = '/scert-emblem.png';
  }, []);

  /**
   * Printing races the emblem <img>: if it hasn't finished loading, some
   * browsers print/PDF the page with that slot blank rather than waiting.
   * The preload above makes that rare, but this is the actual guarantee —
   * it checks the on-page image's own `complete` flag and only prints
   * once it's true (falling back to a short timeout so a genuinely
   * broken image can't block printing forever).
   */
  const handlePrint = () => {
    const logo = document.querySelector('.scorecard-logo');
    if (!logo || logo.complete) {
      window.print();
      return;
    }
    const done = () => { logo.removeEventListener('load', done); logo.removeEventListener('error', done); window.print(); };
    logo.addEventListener('load', done);
    logo.addEventListener('error', done);
    setTimeout(done, 1500);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedRoll = rollNumber.trim();
    if (!trimmedRoll) { setError('Please enter your roll number.'); return; }
    if (!dob) { setError('Please enter your date of birth.'); return; }

    setSubmitting(true);
    setError('');
    setCard(null);

    try {
      const { ok, data } = await lookupResult({ roll_number: trimmedRoll, dob });
      if (ok && data?.found) {
        setCard(data.result);
        // Bring the card into view on phones, where the form fills the screen.
        setTimeout(() => {
          document.getElementById('scorecard-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      } else {
        setError(data?.message || 'Unable to fetch the result. Please try again.');
      }
    } catch {
      setError('Unable to reach the server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="landing-root viewresult-root">
      <PublicTopNav activeTab="Result" />

      <div className="viewresult-container">
        <div className="viewresult-heading">
          <h1 className="viewresult-title">View Scholarship Result</h1>
          <p className="viewresult-subtitle">
            Enter your roll number and date of birth exactly as printed on your admit card.
          </p>
        </div>

        {!availability.loading && !availability.published && (
          <div className="viewresult-notice">
            Results have not been declared yet. Please check back later.
          </div>
        )}

        <form className="viewresult-form-card" onSubmit={handleSubmit}>
          {error && <div className="viewresult-error">{error}</div>}

          <div className="viewresult-field">
            <label className="viewresult-label" htmlFor="vr-roll">Roll Number</label>
            <input
              id="vr-roll"
              className="viewresult-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 6010102053"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="viewresult-field">
            <label className="viewresult-label" htmlFor="vr-dob">Date of Birth</label>
            <input
              id="vr-dob"
              className="viewresult-input"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              disabled={submitting}
            />
            <div className="viewresult-hint">
              As recorded in your examination form.
            </div>
          </div>

          <button className="viewresult-submit" type="submit" disabled={submitting}>
            {submitting ? 'Fetching Result…' : 'View Result'}
          </button>
        </form>

        <div id="scorecard-anchor" />

        {card && (
          <>
            <ScoreCard card={card} />
            <div className="viewresult-actions">
              <button
                type="button"
                className="viewresult-action-btn viewresult-action-btn--primary"
                onClick={handlePrint}
              >
                Print / Save as PDF
              </button>
              <button
                type="button"
                className="viewresult-action-btn"
                onClick={() => navigate('/')}
              >
                Back to Home
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ViewResultPage;
