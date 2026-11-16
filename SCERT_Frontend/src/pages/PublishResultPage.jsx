import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import { ScoreCard } from '../components/result/ScoreCard.jsx';
import { getPublishStatus, setPublishStatus } from '../api/resultPublish.api.js';

/**
 * SCERT → Result → Publish Result.
 *
 * Three parts, top to bottom: readiness of each class, the two release
 * switches, and a live preview of exactly what a student will see.
 *
 * The two switches are independent. "Home Page" puts the roll-number /
 * date-of-birth lookup live for everyone; "Department Access" opens the
 * result lists to School, BEO and District users. Either can be on while
 * the other is off — taking the public lookup down no longer hides the
 * lists from every office. Neither can be turned on until the All
 * Students sheet has landed rows for both class 6 and class 9.
 */

const RELEASES = [
  {
    audience: 'public',
    title: 'Home Page — Public Result',
    description: (
      <>
        Shows the <b>View Result</b> button on the portal home page. Anyone can look up a score card
        using a roll number and date of birth.
      </>
    ),
    confirmOn:
      'Publish results on the home page?\n\nEvery candidate will immediately be able to view their score card using their roll number and date of birth.\n\nSchool, BEO and District access is not affected.',
    confirmOff:
      'Remove results from the home page?\n\nThe View Result lookup will stop showing score cards until you publish again.\n\nSchool, BEO and District users will still see their result lists.',
    onLabel: 'Publish on Home Page',
    offLabel: 'Remove from Home Page',
  },
  {
    audience: 'officers',
    title: 'Department Access — School, BEO & District',
    description: (
      <>
        Opens the result lists and downloads to <b>School</b>, <b>BEO</b> and <b>District</b> users for
        their own scope. Nothing is shown to the public.
      </>
    ),
    confirmOn:
      'Release results to School, BEO and District users?\n\nEach office will be able to see and download the result lists for its own scope.\n\nThe home-page lookup is not affected.',
    confirmOff:
      'Withdraw results from School, BEO and District users?\n\nTheir result lists will show "Results have not been declared yet" until you release again.\n\nThe home-page lookup is not affected.',
    onLabel: 'Release to Departments',
    offLabel: 'Withdraw from Departments',
  },
];

/** Sample card for the preview — clearly marked, never real student data. */
function buildPreviewCard(sessionName, scholarshipName) {
  return {
    header: {
      authority: 'State Council for Educational Research and Training Uttarakhand, Dehradun',
      exam_title_hi: 'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति परीक्षा',
      exam_title_en: 'Chief Minister Meritorious Student Incentive Scholarship Exam',
      session_name: sessionName || null,
      scholarship_name: scholarshipName || null,
      level_label: 'Junior Level (Class-6th)',
      class_value: 6,
    },
    identity: {
      district: 'ALMORA',
      block: 'BHAISIYA CHHANA',
      school_name: 'G.U.P.S. CHNDRAKOT',
      roll_number: '60101XXXXX',
    },
    candidate: {
      candidate_name: 'SPECIMEN CANDIDATE',
      father_name: 'SPECIMEN FATHER',
      mother_name: 'SPECIMEN MOTHER',
      date_of_birth: '2014-10-17',
      sex: 'MALE',
      caste: 'SC',
    },
    score_card: {
      papers: [
        { sr_no: 1, paper: 'Paper-1: Mental Ability Test', maximum_marks: 60, weightage: 3, marks_obtained: 47, total: 50 },
        { sr_no: 2, paper: 'Paper-2: Scholastic Aptitude Test', maximum_marks: 60, weightage: 3, marks_obtained: 52, total: 55 },
      ],
      totals: { maximum_marks: 120, weightage: 6, marks_obtained: 99, total: 105 },
    },
    result: 'Selected',
    is_selected: true,
    is_absent: false,
    footer: {
      signatory: 'Exam Controller',
      authority: 'SCERT Uttarakhand',
      note: 'The score card has been generated electronically, hence does not require any signature.',
      validity: sessionName ? `This score card is valid for ${sessionName}.` : null,
    },
  };
}

function formatTimestamp(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

export function PublishResultPage() {
  const {
    sessionId: selectedSessionId,
    selectedScholarshipId,
    sessions = [],
    scholarships = [],
  } = useSession() || {};

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  // Holds the audience currently being saved ('' when idle), so only that
  // card shows "Please wait…" while both buttons stay locked.
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState({ audience: '', text: '' });

  const scopeReady = Boolean(selectedSessionId && selectedScholarshipId);

  const sessionName = useMemo(
    () => sessions.find((s) => String(s.session_id) === String(selectedSessionId))?.session_name || null,
    [sessions, selectedSessionId]
  );
  const scholarshipName = useMemo(
    () => scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || null,
    [scholarships, selectedScholarshipId]
  );

  const loadStatus = useCallback(async () => {
    if (!scopeReady) return;
    setLoading(true);
    setError('');
    try {
      const data = await getPublishStatus({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
      });
      setStatus(data);
    } catch (err) {
      setError(err?.message || 'Unable to load publish status.');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [scopeReady, selectedSessionId, selectedScholarshipId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleToggle = async (release) => {
    if (!status || saving) return;

    const turningOn = !status[release.audience]?.is_published;
    if (!window.confirm(turningOn ? release.confirmOn : release.confirmOff)) return;

    setSaving(release.audience);
    setError('');
    setNotice({ audience: '', text: '' });
    try {
      const data = await setPublishStatus({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
        audience: release.audience,
        is_published: turningOn,
      });
      setStatus(data);
      setNotice({ audience: release.audience, text: data?.message || 'Updated.' });
    } catch (err) {
      setError(err?.message || 'Unable to update publish status.');
      // Re-read from the server so the UI never shows a state that did not stick.
      loadStatus();
    } finally {
      setSaving('');
    }
  };

  const previewCard = useMemo(
    () => buildPreviewCard(sessionName, scholarshipName),
    [sessionName, scholarshipName]
  );

  if (!scopeReady) {
    return (
      <div className="publish-page">
        <div className="publish-section-card">
          <p className="publish-section-sub" style={{ margin: 0 }}>
            Select an academic session and scholarship to manage result publication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="publish-page">
      {/* ---- Readiness ---- */}
      <div className="publish-section-card">
        <h3 className="publish-section-title">Publication Readiness</h3>
        <p className="publish-section-sub">
          The All Students sheet must be uploaded for both classes before results can be published.
        </p>

        {loading && <div className="publish-section-sub">Loading…</div>}
        {error && <div className="publish-blocked-note">{error}</div>}

        {status && (
          <div className="publish-readiness-grid">
            {status.classes.map((cls) => (
              <div
                key={cls.class_value}
                className={`publish-readiness-item ${cls.ready ? 'publish-readiness-item--ready' : 'publish-readiness-item--missing'}`}
              >
                <div className="publish-readiness-head">
                  <span className="publish-readiness-class">Class {cls.class_value}</span>
                  <span className={`publish-badge ${cls.ready ? 'publish-badge--ready' : 'publish-badge--missing'}`}>
                    {cls.ready ? 'UPLOADED' : 'NOT UPLOADED'}
                  </span>
                </div>

                {cls.ready ? (
                  <div className="publish-readiness-stats">
                    Total students: <b>{cls.total_students.toLocaleString('en-IN')}</b><br />
                    Appeared: <b>{cls.appeared_students.toLocaleString('en-IN')}</b><br />
                    Selected: <b>{cls.selected_students.toLocaleString('en-IN')}</b>
                    {cls.upload && (
                      <div className="publish-readiness-file">
                        {cls.upload.file_name} · {formatTimestamp(cls.upload.uploaded_at)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="publish-readiness-stats">
                    No student data found for this class. Upload the All Students sheet from
                    <b> Result → Result Upload</b>.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Release switches ---- */}
      {status && (
        <div className="publish-section-card">
          <h3 className="publish-section-title">Result Publication</h3>
          <p className="publish-section-sub">
            Two independent releases. Switching one on or off never changes the other.
          </p>

          <div className="publish-release-grid">
            {RELEASES.map((release) => {
              const state = status[release.audience] || {};
              const live = Boolean(state.is_published);
              const blocked = !live && !status.can_publish;
              const isSaving = saving === release.audience;

              return (
                <div
                  key={release.audience}
                  className={`publish-release ${live ? 'publish-release--live' : ''}`}
                >
                  <div className="publish-release-head">
                    <h4 className="publish-release-title">{release.title}</h4>
                    <span className={`publish-badge ${live ? 'publish-badge--live' : 'publish-badge--off'}`}>
                      {live ? 'LIVE' : 'NOT LIVE'}
                    </span>
                  </div>

                  <p className="publish-release-desc">{release.description}</p>

                  <div className="publish-release-meta">
                    {live && state.published_at && (
                      <>
                        Live since {formatTimestamp(state.published_at)}
                        {state.published_by_name ? ` by ${state.published_by_name}` : ''}
                      </>
                    )}
                    {!live && state.unpublished_at && (
                      <>Last taken down {formatTimestamp(state.unpublished_at)}</>
                    )}
                    {!live && !state.unpublished_at && <>Never published for this session.</>}
                  </div>

                  <button
                    type="button"
                    className={`publish-btn ${live ? 'publish-btn--off' : 'publish-btn--on'}`}
                    onClick={() => handleToggle(release)}
                    disabled={Boolean(saving) || blocked}
                  >
                    {isSaving ? 'Please wait…' : live ? release.offLabel : release.onLabel}
                  </button>

                  {blocked && status.blocking_reason && (
                    <div className="publish-blocked-note">{status.blocking_reason}</div>
                  )}
                  {notice.audience === release.audience && notice.text && !error && (
                    <div className="publish-live-note">{notice.text}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- Format preview ---- */}
      <div className="publish-section-card">
        <h3 className="publish-section-title">Result Format Preview</h3>
        <p className="publish-section-sub">
          This is exactly how each student&apos;s score card will appear. Sample values shown.
        </p>
        <div className="publish-preview-wrap">
          <ScoreCard card={previewCard} watermark="SPECIMEN" />
        </div>
      </div>
    </div>
  );
}

export default PublishResultPage;
