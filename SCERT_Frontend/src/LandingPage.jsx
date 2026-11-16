import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { get, post, buildApiUrl } from './apiClient';
import { PublicTopNav } from './PublicTopNav.jsx';
import { getResultAvailability } from './api/resultPublish.api.js';

const FALLBACK_FAQ_ITEMS = [
  {
    question: 'What is the dateline for submission of application?',
    answer: 'The deadline depends on the scholarship scheme. Please check the active scheme details on your dashboard; the last date is shown there and in the official notification.'
  },
  {
    question: 'How do I register myself in the Scholarship Portal and create my unique ID?',
    answer: 'Use the Student Registration option, complete the required details, and verify your information. After successful registration you can sign in using your registered login ID and password.'
  },
  {
    question: 'What should I do if I do not find my institute name or course/branch name in the drop-down menu?',
    answer: 'Please contact your School/Institute admin to ensure your details are updated, or reach out to the helpdesk with your school UDISE code and course details.'
  },
  {
    question: 'Whether I have to fill-up the on-line application in one sitting?',
    answer: 'No. You can save your application as a draft and continue later before final submission.'
  },
  {
    question: 'How can I contact the helpdesk for technical problems?',
    answer: 'Use the Helpdesk contact details shown on this page or click the Contact Us button to reach support.'
  },
  {
    question: 'Which fields can I edit before final submission of application?',
    answer: 'You can edit any draft application fields before submission. After submission, edits may be restricted based on workflow stage and role actions.'
  },
  {
    question: 'What happens if I detect any mistake in my application after submitting/forwarding the application?',
    answer: 'Depending on the verification stage, your School/BEO/District/SCERT authority may return the application with remarks for correction, or advise you on the next steps.'
  }
];

const FALLBACK_ABOUT_TEXT = [
  'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृति योजना जूनियर स्तर (कक्षा 6)',
  '(For the Students Studying in Class 6th of Govt. and Govt. Aided)',
  'संचालन - उत्तराखंड सरकार।',
  'परीक्षा का आयोजन - एस.सी.ई.आर.टी. उत्तराखंड देहरादून।',
  'कुल छात्रवृत्ति - प्रत्येक विकासखण्ड में कुल प्रतिभागी छात्रों की 10% छात्रवृत्तियाँ माध्यमिक शिक्षा निदेशालय द्वारा आवंटित की जाएगी।',
  'चयन परीक्षा हेतु अर्हता: आवेदक उत्तराखंड राज्य में संचालित राजकीय अथवा राजकीय सहायता प्राप्त विद्यालयों (केन्द्रीय एवं आवासीय विद्यालयों को छोड़कर) की कक्षा 6 में संस्थागत छात्र-छात्रा के रूप में अध्ययनरत हो।',
  'कक्षा 5 की परीक्षा उत्तराखंड राज्य के राजकीय अथवा राजकीय सहायता प्राप्त विद्यालय से ही उत्तीर्ण की हो। अभिभावक की आय का कोई प्रतिबंध नहीं है।',
  'परीक्षा का प्रारूप: प्रथम प्रश्न पत्र (Mental Ability Test) - 60 प्रश्न, बहुविकल्पीय (MCQ)। द्वितीय प्रश्न पत्र (Scholastic Aptitude Test) - 60 प्रश्न, बहुविकल्पीय (MCQ)।',
  'छात्रवृत्ति हेतु चयन: प्रत्येक विकासखण्ड से परीक्षा में सम्मिलित प्रतिभागियों के 10% छात्रों का मेरिट के आधार पर चयन किया जाएगा। आरक्षित वर्ग (एस.सी. एवं एस.टी.) के परीक्षार्थियों को प्रतियोगी परीक्षा में 5% का अधिमान दिया जाएगा।',
  'छात्रवृत्ति की दर: कक्षा 6 - ₹600 प्रति माह, कक्षा 7 - ₹700 प्रति माह, कक्षा 8 - ₹800 प्रति माह (निर्धारित अंक व उपस्थिति शर्तों के अनुसार)।',
  '',
  'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृति योजना माध्यमिक स्तर (कक्षा 9)',
  '(For the Students Studying in Class 9th of Govt. and Govt. Aided)',
  'संचालन - उत्तराखंड सरकार।',
  'परीक्षा का आयोजन - एस.सी.ई.आर.टी. उत्तराखंड देहरादून।',
  'कुल छात्रवृत्ति - प्रत्येक विकासखण्ड में कुल प्रतिभागी छात्रों की 10% छात्रवृत्तियाँ माध्यमिक शिक्षा निदेशालय द्वारा आवंटित की जाएगी।',
  'चयन परीक्षा हेतु अर्हता: आवेदक उत्तराखण्ड राज्य में संचालित राजकीय अथवा राजकीय सहायता प्राप्त विद्यालयों (केन्द्रीय एवं आवासीय विद्यालयों को छोड़कर) की कक्षा 9 में संस्थागत छात्र-छात्रा के रूप में अध्ययनरत हो।',
  'कक्षा 8 की परीक्षा उत्तराखंड राज्य के राजकीय अथवा राजकीय सहायता प्राप्त विद्यालय से ही उत्तीर्ण की हो। अभिभावक की आय का कोई प्रतिबंध नहीं है।',
  'परीक्षा का प्रारूप: प्रथम प्रश्न पत्र (Mental Ability Test) - 100 प्रश्न, बहुविकल्पीय (MCQ)। द्वितीय प्रश्न पत्र (Scholastic Aptitude Test) - 100 प्रश्न, बहुविकल्पीय (MCQ)।',
  'छात्रवृत्ति हेतु चयन: प्रत्येक विकासखण्ड से परीक्षा में सम्मिलित प्रतिभागियों के 10% छात्रों का मेरिट के आधार पर चयन किया जाएगा। आरक्षित वर्ग (एस.सी. एवं एस.टी.) के परीक्षार्थियों को प्रतियोगी परीक्षा में 5% का अधिमान दिया जाएगा।',
  'छात्रवृत्ति की दर: कक्षा 9 - ₹900 प्रति माह, कक्षा 10 - ₹900 प्रति माह (निर्धारित अंक व उपस्थिति शर्तों के अनुसार)।'
];

const FALLBACK_CMS = {
  notice_bar: {
    title: 'NOTICE :',
    description:
      'Hackathon 2.0 Finalists Announced: Celebrating Excellence in Education-2026 • Empowering Children Through Digital Literacy: CLAP Uttarakhand',
  },
  about_home: {
    title: 'Scholarships Info',
    subtitle: '',
    description: FALLBACK_ABOUT_TEXT.join('\n\n'),
  },
  useful_links: {
    title: 'Useful Links',
    metadata_json: {
      items: [
        { label: 'E-BOOKS', link: '#' },
        { label: 'SCHOLARSHIP', link: '#' },
        { label: 'CURRICULUM', link: '#' },
        { label: 'FORMS', link: '#' },
      ]
    }
  },
  faq: {
    title: 'Frequently Asked Questions',
    subtitle: 'Unlock Your Future: Scholarship Application Guide',
    metadata_json: {
      contact: {
        title: 'Contact Us',
        address: 'State Council of Educational Research & Training, Uttarakhand, Dehradun',
        email: 'scert-uk@nic.in',
        mobile: '0135-2789655',
        social_links: [
          { label: 'Website', link: 'https://scert.uk.gov.in' },
          { label: 'Facebook', link: '#' },
          { label: 'YouTube', link: '#' },
        ],
      },
      items: FALLBACK_FAQ_ITEMS,
    }
  }
};

function normalizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '#') return '#';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  return `https://${raw}`;
}

const HOME_CAROUSEL_IMAGES = [
  {
    src: '/about-scert.webp',
    alt: 'SCERT Uttarakhand headquarters, Dehradun',
  },
  {
    src: '/1200-675-23323436-thumbnail-16x9-school.jpg',
    alt: 'Entrance gateway to the SCERT Uttarakhand campus, Tapovan Enclave, Nanurkhera, Dehradun',
  },
];
/**
 * The scholarship brief, as a full-bleed carousel.
 *
 * The band spans the viewport, but the artwork is portrait (1275x1650), so
 * the image is contained and centred inside it rather than stretched —
 * stretching a document scan to a 1900px-wide screen makes it unreadable.
 *
 * Autoplay stops while the visitor is hovering or tabbed into the carousel,
 * so it never yanks a slide away from someone who is reading it.
 */
function BriefCarousel({ images }) {
  const [rawIndex, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = images.length;
  // The slides can change after first paint (CMS slides replace the built-in
  // ones), so never point past the end.
  const index = count > 0 && rawIndex >= count ? 0 : rawIndex;

  const go = useCallback(
    (next) => setIndex(((next % count) + count) % count),
    [count]
  );

  useEffect(() => {
    if (paused || count < 2) return undefined;
    const id = setInterval(() => setIndex((prev) => (prev + 1) % count), 6000);
    return () => clearInterval(id);
  }, [paused, count]);

  if (count === 0) return null;

  return (
    <div
      className="brief-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Scholarship brief"
      tabIndex={0}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
      }}
    >
      <div className="brief-carousel-viewport">
        <div
          className="brief-carousel-track"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {images.map((image, i) => (
            <div
              key={image.src}
              className="brief-carousel-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index}
            >
              <img
                src={image.src}
                alt={image.alt}
                className="brief-carousel-image"
                /* Every slide loads up front. Lazy loading looks like a
                   saving, but the track lives inside an overflow:hidden
                   viewport, so an off-screen slide never intersects and
                   the image stays blank until something forces it -
                   which for a carousel is exactly when it is too late. */
                loading="eager"
                decoding="async" 
              />
            </div>
          ))}
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              className="brief-carousel-arrow brief-carousel-arrow--prev"
              onClick={() => go(index - 1)}
              aria-label="Previous slide"
            >
              &#8249;
            </button>
            <button
              type="button"
              className="brief-carousel-arrow brief-carousel-arrow--next"
              onClick={() => go(index + 1)}
              aria-label="Next slide"
            >
              &#8250;
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="brief-carousel-dots">
          {images.map((image, i) => (
            <button
              key={image.src}
              type="button"
              className={`brief-carousel-dot${i === index ? ' is-active' : ''}`}
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeNavTab, setActiveNavTab] = useState('Home');
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [visitorCount, setVisitorCount] = useState(0);
  const [cmsSections, setCmsSections] = useState(FALLBACK_CMS);
  // Only shown once SCERT publishes — the endpoint fails closed, so a
  // backend hiccup hides the button rather than sending students to a
  // page that cannot serve them.
  const [resultPublished, setResultPublished] = useState(false);
  // The three latest announcements shown in the flash-news bar.
  const [flashAnnouncements, setFlashAnnouncements] = useState([]);

  useEffect(() => {
    // Check if user has already accepted cookies
    const cookieAccepted = localStorage.getItem('cookieAccepted');
    if (!cookieAccepted) {
      setShowCookieBanner(true);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const availability = await getResultAvailability();
      if (mounted) setResultPublished(Boolean(availability?.published));
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;

    const trackAndLoadVisitors = async () => {
      try {
        const trackRes = await post('/api/public/visitors/track', {});
        if (mounted && Number.isFinite(Number(trackRes?.total_visits))) {
          setVisitorCount(Number(trackRes.total_visits));
          return;
        }
      } catch (_) {
        // Fallback to read-only fetch if tracking fails
      }

      try {
        const countRes = await get('/api/public/visitors');
        if (mounted && Number.isFinite(Number(countRes?.total_visits))) {
          setVisitorCount(Number(countRes.total_visits));
        }
      } catch (_) {
        if (mounted) setVisitorCount(0);
      }
    };

    trackAndLoadVisitors();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (location.pathname === '/about-us') {
      setActiveNavTab('About Us');
    } else if (location.pathname === '/exemplar-questions') {
      setActiveNavTab('Exemplar Questions');
    } else if (location.pathname === '/publications') {
      setActiveNavTab('Publications');
    } else if (location.pathname === '/important-circulars') {
      setActiveNavTab('Important Circulars & GOs');
    } else if (location.pathname === '/announcements') {
      setActiveNavTab('Announcements');
    } else if (location.pathname === '/') {
      setActiveNavTab('Home');
    }
  }, [location.pathname]);

  useEffect(() => {
    let mounted = true;

    const loadFlashAnnouncements = async () => {
      try {
        const data = await get('/api/public/cms/page/announcements_page');
        const list = (data?.sections || []).find((item) => item.section_name === 'list');
        const items = (list?.metadata_json?.items || []).filter((item) => String(item?.title || '').trim());
        if (mounted) setFlashAnnouncements(items.slice(0, 3));
      } catch (_) {
        // The bar falls back to the notice text.
      }
    };

    loadFlashAnnouncements();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadHomeCms = async () => {
      try {
        const data = await get('/api/public/cms/homepage');
        if (!mounted) return;

        const mapped = { ...FALLBACK_CMS };
        for (const section of data?.sections || []) {
          mapped[section.section_name] = {
            ...(mapped[section.section_name] || {}),
            ...section,
          };
        }
        setCmsSections(mapped);
      } catch (_) {
        if (mounted) {
          setCmsSections(FALLBACK_CMS);
        }
      }
    };

    loadHomeCms();
    return () => {
      mounted = false;
    };
  }, []);

  const acceptCookies = () => {
    localStorage.setItem('cookieAccepted', 'true');
    setShowCookieBanner(false);
  };

  const goto = (path) => navigate(path);
  // Slides SCERT uploaded in the Home Page CMS; the built-in images stand in until there are some.
  const cmsHeroImages = (cmsSections.hero_slider?.metadata_json?.items || [])
    .filter((item) => item?.image_url)
    .map((item) => ({
      src: buildApiUrl(item.image_url),
      alt: item.alt || 'SCERT Uttarakhand',
    }));
  const heroImages = cmsHeroImages.length > 0 ? cmsHeroImages : HOME_CAROUSEL_IMAGES;
  const noticeSection = cmsSections.notice_bar || FALLBACK_CMS.notice_bar;
  const aboutSection = cmsSections.about_home || FALLBACK_CMS.about_home;
  const usefulLinksSection = cmsSections.useful_links || FALLBACK_CMS.useful_links;
  const faqSection = cmsSections.faq || FALLBACK_CMS.faq;
  const usefulLinkItems = usefulLinksSection?.metadata_json?.items?.length
    ? usefulLinksSection.metadata_json.items
    : FALLBACK_CMS.useful_links.metadata_json.items;
  const faqItems = faqSection?.metadata_json?.items?.length
    ? faqSection.metadata_json.items
    : FALLBACK_CMS.faq.metadata_json.items;
  const faqContact = faqSection?.metadata_json?.contact || FALLBACK_CMS.faq.metadata_json.contact;

  return (
    <div className="landing-root">
      {/* Top Info Bar */}
      {/* <div className="landing-top-bar">
        <div className="landing-top-bar-inner">
          <div className="landing-top-bar-left">
            <span className="landing-top-bar-text">SCERT Uttarakhand</span>
          </div>
          <div className="landing-top-bar-right">
            <span className="landing-top-bar-item">📞0135-278-9655</span>
            <span className="landing-top-bar-item">✉ scert-uk@nic.in</span>
          </div>
        </div>
      </div> */}

      <div className="landing-sticky-stack">
        <PublicTopNav activeTab={activeNavTab} onTabSelect={setActiveNavTab} />

        {/* Flash News Bar */}
        <div className="flash-news-bar">
          <div className="flash-news-content">
            <div className="flash-news-badge">
              {flashAnnouncements.length > 0 ? 'ANNOUNCEMENTS :' : noticeSection.title || 'NOTICE :'}
            </div>
            <div className="flash-news-marquee">
              {flashAnnouncements.length > 0 ? (
                // Two identical halves so the loop is seamless; it pauses on hover
                // so a headline can be read and clicked.
                <div
                  className="flash-news-track flash-news-track--announcements"
                  style={{
                    '--flash-news-duration': `${Math.max(
                      40,
                      Math.round(flashAnnouncements.reduce((n, a) => n + String(a.title).length + 12, 0) * 0.9)
                    )}s`,
                  }}
                >
                  {[0, 1].map((copy) => (
                    <div className="flash-news-group" key={copy} aria-hidden={copy === 1 ? 'true' : undefined}>
                      {flashAnnouncements.map((item, i) => (
                        <button
                          key={`flash-${copy}-${i}`}
                          type="button"
                          className="flash-news-item"
                          tabIndex={copy === 1 ? -1 : undefined}
                          onClick={() => goto('/announcements')}
                          title="Open Announcements"
                        >
                          {(item.day || item.month) && (
                            <span className="flash-news-item-date">
                              {item.day ? `${item.day} ` : ''}{item.month || ''}
                            </span>
                          )}
                          {item.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="flash-news-track"
                  // Long notices need a long loop: ~30px a second whatever the length.
                  style={{
                    animationDuration: `${Math.max(
                      40,
                      Math.round(String(noticeSection.description || FALLBACK_CMS.notice_bar.description).length * 0.3)
                    )}s`,
                  }}
                >
                  {noticeSection.description || FALLBACK_CMS.notice_bar.description}
                  &nbsp;&nbsp;•&nbsp;&nbsp;
                  {noticeSection.description || FALLBACK_CMS.notice_bar.description}
                </div>
              )}
            </div>
            <button type="button" className="flash-news-viewall" onClick={() => goto('/announcements')}>
              View All
            </button>
          </div>
        </div>
      </div>

      <main className="landing-main">
        <div className="landing-main-container">
          <div className="landing-main-content">
            {resultPublished && (
              <div className="result-cta-banner">
                <div className="result-cta-text">
                  <p className="result-cta-title">Scholarship Result Declared</p>
                  <p className="result-cta-sub">
                    Enter your roll number and date of birth to view your score card.
                  </p>
                </div>
                <button
                  type="button"
                  className="result-cta-btn"
                  onClick={() => goto('/view-result')}
                >
                  View Result
                </button>
              </div>
            )}

            <BriefCarousel images={heroImages} />

            <section className="useful-links-strip">
              <h2 className="useful-links-strip-title">
                <span className="sidebar-icon">&#128279;</span>
                {usefulLinksSection.title || FALLBACK_CMS.useful_links.title}
              </h2>
              <div className="useful-links-row">
                {usefulLinkItems.map((item, index) => (
                  <a
                    key={`useful-link-${index}`}
                    className="useful-link-item"
                    href={normalizeExternalUrl(item.link)}
                    target={item.link && item.link !== '#' ? '_blank' : undefined}
                    rel={item.link && item.link !== '#' ? 'noopener noreferrer' : undefined}
                  >
                    <span className="useful-link-text">{item.label}</span>
                  </a>
                ))}
              </div>
            </section>
          </div>

        </div>

        <section id="how-to-apply" className="howto-section">
          <div className="howto-inner">
            <div className="howto-header">
              <h2 className="howto-title">How to Apply?</h2>
              <a className="howto-page-link" href="#/how-to-apply">Open full guide</a>
              <p className="howto-subtitle">Unlock Your Future: Scholarship Application Guide</p>
            </div>

            <div className="howto-flow">
              <div className="howto-card">
                <div className="howto-card-icon">
                  <div className="howto-icon-circle">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M9 7H15M9 11H15M9 15H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M7 3H15L19 7V21H7V3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M15 3V7H19" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                    <span className="howto-step-badge">1</span>
                  </div>
                </div>
                <h3 className="howto-card-title">Register at the portal</h3>
                
              </div>

              <div className="howto-arrow" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M13 6L19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <div className="howto-card">
                <div className="howto-card-icon">
                  <div className="howto-icon-circle">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M4 5H20V15H4V5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M8 19H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M10 15V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M14 15V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 9H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 12H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="howto-step-badge">2</span>
                  </div>
                </div>
                <h3 className="howto-card-title">
                   Login into the dashboard
                </h3>
                
              </div>

              <div className="howto-arrow" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M13 6L19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <div className="howto-card">
                <div className="howto-card-icon">
                  <div className="howto-icon-circle">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M7 3H15L19 7V21H7V3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M15 3V7H19" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M9 11H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9 14H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9 17H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M5 10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="howto-step-badge">3</span>
                  </div>
                </div>
                <h3 className="howto-card-title">Select Scheme &amp; Apply</h3>
                <ul className="howto-list">
                  <li>Please select the Scheme name.</li>
                  <li>Provide all necessary details and information.</li>
                  <li>Submit the form</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="faq-section">
          <div className="faq-inner">
            <div className="faq-head">
              <div>
                <h2 className="faq-title">{faqSection.title || FALLBACK_CMS.faq.title}</h2>
                <p className="faq-subtitle">{faqSection.subtitle || FALLBACK_CMS.faq.subtitle}</p>
              </div>
            </div>

            <div className="faq-grid">
              <div className="faq-accordion" role="region" aria-label="Frequently Asked Questions">
                {faqItems.map((item, idx) => {
                  const open = openFaqIndex === idx;
                  return (
                    <div key={item.question} className={`faq-item ${open ? 'open' : ''}`}>
                      <button
                        type="button"
                        className="faq-question"
                        aria-expanded={open}
                        onClick={() => setOpenFaqIndex(open ? null : idx)}
                      >
                        <span className="faq-question-text">{item.question}</span>
                        <span className={`faq-chevron ${open ? 'open' : ''}`} aria-hidden="true">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>
                      <div className="faq-answer" aria-hidden={!open}>
                        <div className="faq-answer-inner">{item.answer}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <aside className="faq-contact-card" id="contact-us">
                <div className="faq-contact-head">
                  <h3 className="faq-contact-title">{faqContact?.title || 'Contact Us'}</h3>
                </div>

                <div className="faq-contact-list">
                  <div className="faq-contact-item">
                    <span className="faq-contact-label">Address</span>
                    <p className="faq-contact-value">{faqContact?.address || '-'}</p>
                  </div>

                  <div className="faq-contact-item">
                    <span className="faq-contact-label">Email</span>
                    {faqContact?.email ? (
                      <a className="faq-contact-link" href={`mailto:${faqContact.email}`}>
                        {faqContact.email}
                      </a>
                    ) : (
                      <span className="faq-contact-value">-</span>
                    )}
                  </div>

                  <div className="faq-contact-item">
                    <span className="faq-contact-label">Mobile</span>
                    {faqContact?.mobile ? (
                      <a className="faq-contact-link" href={`tel:${String(faqContact.mobile).replace(/\s+/g, '')}`}>
                        {faqContact.mobile}
                      </a>
                    ) : (
                      <span className="faq-contact-value">-</span>
                    )}
                  </div>
                </div>

                <div className="faq-social-wrap">
                  <span className="faq-contact-label">Follow Us</span>
                  <div className="faq-social-links">
                    {(faqContact?.social_links || []).map((item, index) => (
                      <a
                        key={`faq-social-${index}`}
                        className="faq-social-link"
                        href={item.link || '#'}
                        target={item.link && item.link !== '#' ? '_blank' : undefined}
                        rel={item.link && item.link !== '#' ? 'noopener noreferrer' : undefined}
                      >
                        {item.label || 'Link'}
                      </a>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <div className="footer-content">
            <p>© 2026 State Council of Educational Research & Training, Uttarakhand • All Rights Reserved</p>
            <p className="footer-visitor-counter" aria-label="Total visitors till date">
              Total Visitors : {visitorCount.toLocaleString('en-IN')}
            </p>
            <p className="footer-links">
              <a href="https://scert.uk.gov.in/about-us">About Us</a>
              <span>•</span>
              <a href="https://scert.uk.gov.in/contact-us">Contact Us</a>
              <span>•</span>
              <a href="https://scert.uk.gov.in/RTI">RTI</a>
            </p>
          </div>
        </footer>
      </main>

      {showCookieBanner && (
        <div className="cookie-banner">
          <div className="cookie-banner-content">
            <svg className="cookie-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21.598 11.064a1.006 1.006 0 0 0-.854-.172A2.938 2.938 0 0 1 20 11c-1.654 0-3-1.346-3-3 0-.217.031-.444.099-.716a1 1 0 0 0-1.067-1.236A9.956 9.956 0 0 0 2 12c0 5.514 4.486 10 10 10s10-4.486 10-10c0-.049-.003-.097-.007-.16a1.004 1.004 0 0 0-.395-.776zM8.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-2 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm2.5-6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm3.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor"/>
            </svg>
            <span className="cookie-text">We use cookies to ensure you get the best experience on our portal. By continuing, you agree to our <a href="https://scert.uk.gov.in/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
            <button 
              type="button"
              className="cookie-accept-btn"
              onClick={acceptCookies}
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
