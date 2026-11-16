/**
 * SCERT notifications as the same scrolling bar the home page uses for
 * announcements: red bar, badge, headlines that scroll slowly and pause on
 * hover, and a View All button at the right end. Clicking a headline or View
 * All calls onOpen, which the dashboards use to show the full list.
 */

const MAX_ITEMS = 3;
const EXCERPT_LENGTH = 110;

const excerpt = (text) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > EXCERPT_LENGTH ? `${t.slice(0, EXCERPT_LENGTH).trimEnd()}…` : t;
};

export function NotificationMarquee({ notifications = [], onOpen }) {
  const items = (Array.isArray(notifications) ? notifications : [])
    .filter((n) => String(n?.title || '').trim())
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return null;

  const lines = items.map((n) => ({
    key: n.notification_id ?? n.title,
    date: n.created_at ? new Date(n.created_at).toLocaleDateString() : '',
    text: [String(n.title).trim(), excerpt(n.message)].filter(Boolean).join(' — '),
  }));
  // About 30px a second, the pace of the home page bar (~7.5px per character).
  const duration = Math.max(40, Math.round(lines.reduce((n, l) => n + l.text.length + 12, 0) * 0.25));

  return (
    <div className="flash-news-bar notification-marquee" role="region" aria-label="Notifications">
      <div className="flash-news-content">
        <div className="flash-news-badge">NOTIFICATIONS :</div>
        <div className="flash-news-marquee">
          <div
            className="flash-news-track flash-news-track--announcements"
            style={{ '--flash-news-duration': `${duration}s` }}
          >
            {[0, 1].map((copy) => (
              <div className="flash-news-group" key={copy} aria-hidden={copy === 1 ? 'true' : undefined}>
                {lines.map((line) => (
                  <button
                    key={`${copy}-${line.key}`}
                    type="button"
                    className="flash-news-item"
                    tabIndex={copy === 1 ? -1 : undefined}
                    onClick={() => onOpen?.()}
                    title="Open notifications"
                  >
                    {line.date && <span className="flash-news-item-date">{line.date}</span>}
                    {line.text}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="flash-news-viewall" onClick={() => onOpen?.()}>
          View All
        </button>
      </div>
    </div>
  );
}
