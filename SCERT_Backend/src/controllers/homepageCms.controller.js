const path = require("path");
const { promises: fsp } = require("fs");
const pool = require("../config/db");
const { normalizeFile, MAX_FILE_SIZE } = require("../utils/fileProcessor");
const { resolveFileUrl, resolveFileDiskPath } = require("../utils/fileUrl.util");
const { validateCmsUploadFile } = require("../utils/cmsUploadValidation");

const { createClient } = require("redis");
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const cmsPublicCacheClient = createClient({ url: redisUrl });
cmsPublicCacheClient.on("error", (err) =>
  console.error("homepageCms redis error:", err));
cmsPublicCacheClient.connect().catch((err) =>
  console.error("homepageCms redis connect error:", err));
const HOMEPAGE_CACHE_KEY = "homepage:sections:public";
const HOMEPAGE_CACHE_TTL = 300; // 5 minutes

const HOME_PAGE_NAME = "home";
const SCERT_ROLE_ID = 5;

const DEFAULT_PAGE_SECTIONS = {
  [HOME_PAGE_NAME]: {
    // Home page hero slider. No slides = the landing page keeps its built-in images.
    hero_slider: {
      title: "Hero Slider",
      subtitle: "",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: { items: [] },
    },
    notice_bar: {
      title: "NOTICE :",
      subtitle: "",
      description:
        "Hackathon 2.0 Finalists Announced: Celebrating Excellence in Education-2026 • Empowering Children Through Digital Literacy: CLAP Uttarakhand",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {},
    },
    about_home: {
      title: "Brief of Scholarships (CM)",
      subtitle: "",
      description: [
        "मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृति योजना जूनियर स्तर (कक्षा 6)",
        "(For the Students Studying in Class 6th of Govt. and Govt. Aided)",
        "संचालन - उत्तराखंड सरकार।",
        "परीक्षा का आयोजन - एस.सी.ई.आर.टी. उत्तराखंड देहरादून।",
        "कुल छात्रवृत्ति - प्रत्येक विकासखण्ड में कुल प्रतिभागी छात्रों की 10% छात्रवृत्तियाँ माध्यमिक शिक्षा निदेशालय द्वारा आवंटित की जाएगी।",
        "चयन परीक्षा हेतु अर्हता: आवेदक उत्तराखंड राज्य में संचालित राजकीय अथवा राजकीय सहायता प्राप्त विद्यालयों (केन्द्रीय एवं आवासीय विद्यालयों को छोड़कर) की कक्षा 6 में संस्थागत छात्र-छात्रा के रूप में अध्ययनरत हो।",
        "कक्षा 5 की परीक्षा उत्तराखंड राज्य के राजकीय अथवा राजकीय सहायता प्राप्त विद्यालय से ही उत्तीर्ण की हो। अभिभावक की आय का कोई प्रतिबंध नहीं है।",
        "परीक्षा का प्रारूप: प्रथम प्रश्न पत्र (Mental Ability Test) - 60 प्रश्न, बहुविकल्पीय (MCQ)। द्वितीय प्रश्न पत्र (Scholastic Aptitude Test) - 60 प्रश्न, बहुविकल्पीय (MCQ)।",
        "छात्रवृत्ति हेतु चयन: प्रत्येक विकासखण्ड से परीक्षा में सम्मिलित प्रतिभागियों के 10% छात्रों का मेरिट के आधार पर चयन किया जाएगा। आरक्षित वर्ग (एस.सी. एवं एस.टी.) के परीक्षार्थियों को प्रतियोगी परीक्षा में 5% का अधिमान दिया जाएगा।",
        "छात्रवृत्ति की दर: कक्षा 6 - ₹600 प्रति माह, कक्षा 7 - ₹700 प्रति माह, कक्षा 8 - ₹800 प्रति माह (निर्धारित अंक व उपस्थिति शर्तों के अनुसार)।",
        "",
        "मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृति योजना माध्यमिक स्तर (कक्षा 9)",
        "(For the Students Studying in Class 9th of Govt. and Govt. Aided)",
        "संचालन - उत्तराखंड सरकार।",
        "परीक्षा का आयोजन - एस.सी.ई.आर.टी. उत्तराखंड देहरादून।",
        "कुल छात्रवृत्ति - प्रत्येक विकासखण्ड में कुल प्रतिभागी छात्रों की 10% छात्रवृत्तियाँ माध्यमिक शिक्षा निदेशालय द्वारा आवंटित की जाएगी।",
        "चयन परीक्षा हेतु अर्हता: आवेदक उत्तराखण्ड राज्य में संचालित राजकीय अथवा राजकीय सहायता प्राप्त विद्यालयों (केन्द्रीय एवं आवासीय विद्यालयों को छोड़कर) की कक्षा 9 में संस्थागत छात्र-छात्रा के रूप में अध्ययनरत हो।",
        "कक्षा 8 की परीक्षा उत्तराखंड राज्य के राजकीय अथवा राजकीय सहायता प्राप्त विद्यालय से ही उत्तीर्ण की हो। अभिभावक की आय का कोई प्रतिबंध नहीं है।",
        "परीक्षा का प्रारूप: प्रथम प्रश्न पत्र (Mental Ability Test) - 100 प्रश्न, बहुविकल्पीय (MCQ)। द्वितीय प्रश्न पत्र (Scholastic Aptitude Test) - 100 प्रश्न, बहुविकल्पीय (MCQ)।",
        "छात्रवृत्ति हेतु चयन: प्रत्येक विकासखण्ड से परीक्षा में सम्मिलित प्रतिभागियों के 10% छात्रों का मेरिट के आधार पर चयन किया जाएगा। आरक्षित वर्ग (एस.सी. एवं एस.टी.) के परीक्षार्थियों को प्रतियोगी परीक्षा में 5% का अधिमान दिया जाएगा।",
        "छात्रवृत्ति की दर: कक्षा 9 - ₹900 प्रति माह, कक्षा 10 - ₹900 प्रति माह (निर्धारित अंक व उपस्थिति शर्तों के अनुसार)।",
      ].join("\n\n"),
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {},
    },
    announcements: {
      title: "Latest Announcements",
      subtitle: "",
      description: "",
      image_url: null,
      button_text: "VIEW ALL",
      button_link: "#",
      metadata_json: {
        items: [
          { day: "24", month: "MAR", title: "Teacher Training Workshop on NEP 2020", badge: "Notice", badge_variant: "notice", link: "#" },
          { day: "18", month: "MAR", title: "State Scholarship Results Declared", badge: "Results", badge_variant: "results", link: "#" },
          { day: "12", month: "MAR", title: "Amendment in DIET Admission Guidelines", badge: "Circular", badge_variant: "circular", link: "#" },
        ],
      },
    },
    useful_links: {
      title: "Useful Links",
      subtitle: "",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        items: [
          { label: "E-BOOKS", link: "#" },
          { label: "SCHOLARSHIP", link: "#" },
          { label: "CURRICULUM", link: "#" },
          { label: "FORMS", link: "#" },
        ],
      },
    },
    faq: {
      title: "Frequently Asked Questions",
      subtitle: "Unlock Your Future: Scholarship Application Guide",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        contact: {
          title: "Contact Us",
          address: "State Council of Educational Research & Training, Uttarakhand, Dehradun",
          email: "scert-uk@nic.in",
          mobile: "0135-2789655",
          social_links: [
            { label: "Website", link: "https://scert.uk.gov.in" },
            { label: "Facebook", link: "#" },
            { label: "YouTube", link: "#" },
          ],
        },
        items: [
          { question: "What is the dateline for submission of application?", answer: "The deadline depends on the scholarship scheme. Please check the active scheme details on your dashboard; the last date is shown there and in the official notification." },
          { question: "How do I register myself in the Scholarship Portal and create my unique ID?", answer: "Use the Student Registration option, complete the required details, and verify your information. After successful registration you can sign in using your registered login ID and password." },
          { question: "What should I do if I do not find my institute name or course/branch name in the drop-down menu?", answer: "Please contact your School/Institute admin to ensure your details are updated, or reach out to the helpdesk with your school UDISE code and course details." },
          { question: "Whether I have to fill-up the on-line application in one sitting?", answer: "No. You can save your application as a draft and continue later before final submission." },
          { question: "How can I contact the helpdesk for technical problems?", answer: "Use the Helpdesk contact details shown on this page or click the Contact Us button to reach support." },
          { question: "Which fields can I edit before final submission of application?", answer: "You can edit any draft application fields before submission. After submission, edits may be restricted based on workflow stage and role actions." },
          { question: "What happens if I detect any mistake in my application after submitting/forwarding the application?", answer: "Depending on the verification stage, your School/BEO/District/SCERT authority may return the application with remarks for correction, or advise you on the next steps." },
        ],
      },
    },
  },
  about_us: {
    main_content: {
      title: "About Us",
      subtitle: "हमारे बारे में",
      description: [
        "The State Council of Educational Research and Training (SCERT), Uttarakhand conducts key scholarship examinations each year, including National Means-cum-Merit Scholarship Scheme (NMMSS), Dr. Shivanand Nautiyal Scholarship Scheme (SNSS), Sridev Suman Scholarship Scheme (SSSS), for Class 8 and the Chief Minister Meritorious Student incentive Scholarship Scheme for Classes 6 and 9. These initiatives provide financial support to meritorious students, especially from economically weaker sections, fostering equity and academic excellence across the state.",
        "National Means-cum-Merit Scholarship Scheme (NMMSS) launched in 2008 by the Ministry of Education, this centrally sponsored scheme aims to reduce dropout rates and encourage students from economically weaker sections to pursue secondary education. The scholarship amount was revised to 12,000 per annum in 2017. Uttarakhand’s quota under this scheme is 1048 scholarships.",
        "Dr. Shivanand Nautiyal Scholarship Scheme (SNSS) introduced by the Government of Uttarakhand, this scheme recognizes meritorious Class 8 students and provides monthly financial assistance. A total of 100 scholarships are awarded each year, equally distributed between Garhwal and Kumaon mandals.",
        "Sridev Suman Scholarship Scheme (SSSS) is a state initiative to honor exceptional Class 8 students. It ensures that every development block supports its top performers and highlights Uttarakhand’s commitment to equity and grassroots-level encouragement.",
        "Chief Minister’s Meritorious Student Scholarship Scheme (CM Scholarship), launched in 2023, motivates students from Class 6 to Class 12 by offering monthly scholarships based on performance in scholarship exams and board results. It is a strong initiative to recognize merit and foster excellence at every stage of schooling.",
        "",
        "राज्य शैक्षिक अनुसंधान एवं प्रशिक्षण परिषद (SCERT), उत्तराखंड प्रत्येक वर्ष कई महत्वपूर्ण छात्रवृत्ति परीक्षाओं का आयोजन करती है। इनमें राष्ट्रीय साधन-सह-मेधा छात्रवृत्ति योजना (NMMSS), डॉ. शिवानंद नौटियाल छात्रवृत्ति योजना (SNSS), श्रीदेव सुमन छात्रवृत्ति योजना (SSSS) कक्षा 8 के लिए तथा मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति योजना कक्षा 6 और 9 के लिए शामिल हैं। ये पहल विशेष रूप से आर्थिक रूप से कमजोर वर्गों के मेधावी छात्रों को वित्तीय सहायता प्रदान करती हैं, जिससे राज्य में समानता और शैक्षणिक उत्कृष्टता को बढ़ावा मिलता है।",
        "राष्ट्रीय साधन-सह-मेधावी छात्रवृत्ति योजना (NMMSS): इस योजना को वर्ष 2008 में शिक्षा मंत्रालय द्वारा प्रारंभ किया गया था। यह केंद्र प्रायोजित योजना विद्यालय छोड़ने की दर को कम करने तथा आर्थिक रूप से कमजोर वर्गों के छात्रों को माध्यमिक शिक्षा जारी रखने के लिए प्रोत्साहित करने के उद्देश्य से लागू की गई है। वर्ष 2017 में छात्रवृत्ति राशि को संशोधित कर ₹12,000 प्रति वर्ष कर दिया गया। इस योजना के अंतर्गत उत्तराखंड को 1048 छात्रवृत्तियां आवंटित की गयी हैं।",
        "डॉ. शिवानंद नौटियाल छात्रवृत्ति योजना (SNSS): उत्तराखंड सरकार द्वारा प्रारंभ की गई यह योजना कक्षा 8 के मेधावी छात्रों को सम्मानित करने के लिए है तथा उन्हें मासिक वित्तीय सहायता प्रदान करती है। प्रत्येक वर्ष कुल 100 छात्रवृत्तियां प्रदान की जाती हैं, जिन्हें गढ़वाल और कुमाऊँ मंडलों के बीच समान रूप से वितरित किया जाता है।",
        "श्रीदेव सुमन छात्रवृत्ति योजना (SSSS): यह एक राज्य स्तरीय पहल है, जिसका उद्देश्य कक्षा 8 के उत्कृष्ट छात्रों को सम्मानित करना है। इस योजना के अंतर्गत प्रत्येक विकासखंड के शीर्ष प्रदर्शन करने वाले छात्रों को सहायता प्रदान की जाती है। यह योजना समानता और जमीनी स्तर पर प्रोत्साहन के प्रति उत्तराखंड की प्रतिबद्धता को दर्शाती है।",
        "मुख्यमंत्री मेधावी छात्र छात्रवृत्ति योजना (CM Scholarship): वर्ष 2023 में प्रारंभ की गई यह प्रमुख योजना कक्षा 6 से कक्षा 12 तक के छात्रों को प्रेरित करती है। इसमें छात्रवृत्ति परीक्षाओं और बोर्ड परीक्षा के परिणामों के आधार पर मासिक छात्रवृत्ति प्रदान की जाती है। यह योजना स्कूली शिक्षा के प्रत्येक चरण में मेधावी छात्रों को पहचानने और उत्कृष्टता को बढ़ावा देने की एक सशक्त पहल है।",
      ].join("\n\n"),
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {},
    },
  },
  exemplar_questions: {
    documents: {
      title: "Exemplar Questions",
      subtitle: "Download question papers and reference PDFs",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        items: [],
      },
    },
  },
  publications: {
    documents: {
      title: "Publications",
      subtitle: "Download research papers, manuals, and publication PDFs",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        items: [],
      },
    },
  },
  important_circulars_gos: {
    documents: {
      title: "Important Circulars & GOs",
      subtitle: "Download circulars, government orders, and official PDF documents",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        items: [],
      },
    },
  },
  announcements_page: {
    list: {
      title: "Announcements",
      subtitle: "Latest notices, results, and circular updates",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        items: [
          { day: "24", month: "MAR", title: "Teacher Training Workshop on NEP 2020", badge: "Notice", badge_variant: "notice", description: "" },
          { day: "18", month: "MAR", title: "State Scholarship Results Declared", badge: "Results", badge_variant: "results", description: "" },
          { day: "12", month: "MAR", title: "Amendment in DIET Admission Guidelines", badge: "Circular", badge_variant: "circular", description: "" },
        ],
      },
    },
  },
  how_to_apply: {
    guide: {
      title: "How to Apply",
      subtitle: "Step-by-step video guides for each user role",
      description: "",
      image_url: null,
      button_text: "",
      button_link: "",
      metadata_json: {
        roles: [
          {
            id: "school",
            label: "School",
            sections: [
              {
                heading: "School Registration and Login",
                youtube_url: "",
              },
            ],
          },
          {
            id: "beo",
            label: "BEO",
            sections: [
              {
                heading: "BEO Dashboard Walkthrough",
                youtube_url: "",
              },
            ],
          },
          {
            id: "district",
            label: "District",
            sections: [
              {
                heading: "District Dashboard Walkthrough",
                youtube_url: "",
              },
            ],
          },
          {
            id: "scert",
            label: "SCERT",
            sections: [
              {
                heading: "SCERT Workflow Overview",
                youtube_url: "",
              },
            ],
          },
        ],
      },
    },
  },
};

let tablesEnsured = false;

async function ensureCmsTables() {
  if (tablesEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scert_db.page_cms_sections (
      id bigserial PRIMARY KEY,
      page_name varchar(100) NOT NULL,
      section_name varchar(100) NOT NULL,
      title text,
      subtitle text,
      description text,
      image_url text,
      button_text text,
      button_link text,
      metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_updated timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by bigint NULL REFERENCES scert_db.users(user_id),
      CONSTRAINT uq_page_cms_page_section UNIQUE (page_name, section_name)
    )
  `);

  for (const [pageName, pageSections] of Object.entries(DEFAULT_PAGE_SECTIONS)) {
    for (const [sectionName, section] of Object.entries(pageSections)) {
      await pool.query(
        `INSERT INTO scert_db.page_cms_sections
         (page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (page_name, section_name) DO NOTHING`,
        [
          pageName,
          sectionName,
          section.title || null,
          section.subtitle || null,
          section.description || null,
          section.image_url || null,
          section.button_text || null,
          section.button_link || null,
          JSON.stringify(section.metadata_json || {}),
        ]
      );
    }
  }

  tablesEnsured = true;
}

function assertScert(req) {
  if (Number(req.user?.role_id) !== SCERT_ROLE_ID) {
    const error = new Error("Only SCERT users can access Home Page CMS");
    error.status = 403;
    throw error;
  }
}

function mapSectionRow(row) {
  const metadata = row.metadata_json || {};
  const normalizedItems = Array.isArray(metadata.items)
    ? metadata.items.map((item) => {
        if (!item || typeof item !== "object") return item;
        const resolvedPath = item.file_path || item.file_url || null;
        return {
          ...item,
          file_url: resolvedPath ? resolveFileUrl(resolvedPath) : item.file_url || null,
          // Hero slider slides carry an uploaded image path.
          ...(item.image_path ? { image_url: resolveFileUrl(item.image_path) } : {}),
        };
      })
    : metadata.items;

  return {
    page_name: row.page_name,
    section_name: row.section_name,
    title: row.title || "",
    subtitle: row.subtitle || "",
    description: row.description || "",
    image_url: resolveFileUrl(row.image_url),
    image_path: row.image_url || null,
    button_text: row.button_text || "",
    button_link: row.button_link || "",
    metadata_json: {
      ...metadata,
      ...(Array.isArray(normalizedItems) ? { items: normalizedItems } : {}),
    },
    last_updated: row.last_updated,
  };
}

exports.getHomePageSectionsPublic = async (req, res) => {
  try {
    // ✅ Try Redis cache first
    try {
      const cached = await cmsPublicCacheClient.get(HOMEPAGE_CACHE_KEY);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (redisErr) {
      // Redis down — fall through to DB silently
      console.error("homepageCms redis get error:", redisErr.message);
    }

    // Cache miss — hit DB
    await ensureCmsTables();
    const result = await pool.query(
      `SELECT page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated
       FROM scert_db.page_cms_sections
       WHERE page_name = $1
       ORDER BY id ASC`,
      [HOME_PAGE_NAME]
    );

    const response = {
      page_name: HOME_PAGE_NAME,
      sections: result.rows.map(mapSectionRow),
    };

    // ✅ Store in Redis for 5 minutes
    try {
      await cmsPublicCacheClient.setEx(
        HOMEPAGE_CACHE_KEY,
        HOMEPAGE_CACHE_TTL,
        JSON.stringify(response)
      );
    } catch (redisErr) {
      console.error("homepageCms redis set error:", redisErr.message);
    }

    res.json(response);
  } catch (err) {
    console.error("getHomePageSectionsPublic error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getHomePageSection = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();

    const result = await pool.query(
      `SELECT page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated
       FROM scert_db.page_cms_sections
       WHERE page_name = $1 AND section_name = $2
       LIMIT 1`,
      [HOME_PAGE_NAME, req.params.section]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "CMS section not found" });
    }

    res.json(mapSectionRow(result.rows[0]));
  } catch (err) {
    const status = err.status || 500;
    console.error("getHomePageSection error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.getHomePageSections = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();

    const result = await pool.query(
      `SELECT page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated
       FROM scert_db.page_cms_sections
       WHERE page_name = $1
       ORDER BY id ASC`,
      [HOME_PAGE_NAME]
    );

    res.json({
      page_name: HOME_PAGE_NAME,
      sections: result.rows.map(mapSectionRow),
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("getHomePageSections error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.updateHomePageSection = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();

    const sectionName = String(req.params.section || "").trim();
    const {
      title = "",
      subtitle = "",
      description = "",
      image_path = null,
      button_text = "",
      button_link = "",
      metadata_json = {},
    } = req.body || {};

    // Hero slider: keep only what a slide is (an uploaded CMS image and its
    // description), so nothing else can be stored or served from this section.
    let metadataToStore = metadata_json || {};
    if (sectionName === "hero_slider") {
      const slides = Array.isArray(metadataToStore.items) ? metadataToStore.items : [];
      metadataToStore = {
        items: slides
          .map((slide) => ({
            image_path: String(slide?.image_path || "").replace(/\\/g, "/").trim(),
            alt: String(slide?.alt || "").trim().slice(0, 200),
          }))
          .filter((slide) => /^cms\/[\w./-]+$/.test(slide.image_path) && !slide.image_path.includes(".."))
          .slice(0, 10),
      };
    }

    const result = await pool.query(
      `UPDATE scert_db.page_cms_sections
       SET title = $3,
           subtitle = $4,
           description = $5,
           image_url = $6,
           button_text = $7,
           button_link = $8,
           metadata_json = $9::jsonb,
           last_updated = CURRENT_TIMESTAMP,
           updated_by = $10
       WHERE page_name = $1
         AND section_name = $2
      RETURNING page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated`,
      [
        HOME_PAGE_NAME,
        sectionName,
        title || null,
        subtitle || null,
        description || null,
        image_path || null,
        button_text || null,
        button_link || null,
        JSON.stringify(metadataToStore),
        req.user.user_id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "CMS section not found" });
    }

    // Invalidate homepage cache on CMS update
    try {
      await cmsPublicCacheClient.del(HOMEPAGE_CACHE_KEY);
    } catch (_) {}

    res.json({
      message: "Homepage section updated successfully",
      section: mapSectionRow(result.rows[0]),
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("updateHomePageSection error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

function sanitizePageName(pageName) {
  const value = String(pageName || "").trim();
  if (!value || !DEFAULT_PAGE_SECTIONS[value]) {
    const error = new Error("Invalid CMS page");
    error.status = 400;
    throw error;
  }
  return value;
}

function sanitizeSectionName(sectionName) {
  const value = String(sectionName || "").trim();
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    const error = new Error("Invalid CMS section");
    error.status = 400;
    throw error;
  }
  return value;
}

function isValidYoutubeUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (host === "youtube.com" || host === "youtu.be")
    );
  } catch {
    return false;
  }
}

function sanitizePageMetadata(pageName, metadata) {
  if (pageName !== "how_to_apply" || !metadata || typeof metadata !== "object") {
    return metadata || {};
  }

  const roles = Array.isArray(metadata.roles)
    ? metadata.roles.map((role) => ({
        ...role,
        sections: Array.isArray(role?.sections)
          ? role.sections.map((section) => ({
              ...section,
              youtube_url: isValidYoutubeUrl(section?.youtube_url)
                ? String(section.youtube_url).trim()
                : null,
            }))
          : [],
      }))
    : [];

  return {
    ...metadata,
    roles,
  };
}

exports.getPageSectionsPublic = async (req, res) => {
  try {
    await ensureCmsTables();
    const pageName = sanitizePageName(req.params.pageName);

    const result = await pool.query(
      `SELECT page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated
       FROM scert_db.page_cms_sections
       WHERE page_name = $1
       ORDER BY id ASC`,
      [pageName]
    );

    res.json({
      page_name: pageName,
      sections: result.rows.map(mapSectionRow),
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("getPageSectionsPublic error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.getPageSections = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();
    const pageName = sanitizePageName(req.params.pageName);

    const result = await pool.query(
      `SELECT page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated
       FROM scert_db.page_cms_sections
       WHERE page_name = $1
       ORDER BY id ASC`,
      [pageName]
    );

    res.json({
      page_name: pageName,
      sections: result.rows.map(mapSectionRow),
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("getPageSections error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.getPageSection = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();
    const pageName = sanitizePageName(req.params.pageName);

    const result = await pool.query(
      `SELECT page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated
       FROM scert_db.page_cms_sections
       WHERE page_name = $1 AND section_name = $2
       LIMIT 1`,
      [pageName, req.params.section]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "CMS section not found" });
    }

    res.json(mapSectionRow(result.rows[0]));
  } catch (err) {
    const status = err.status || 500;
    console.error("getPageSection error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.updatePageSection = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();

    const pageName = sanitizePageName(req.params.pageName);
    const sectionName = String(req.params.section || "").trim();
    const {
      title = "",
      subtitle = "",
      description = "",
      image_path = null,
      button_text = "",
      button_link = "",
      metadata_json = {},
    } = req.body || {};

    const result = await pool.query(
      `UPDATE scert_db.page_cms_sections
       SET title = $3,
           subtitle = $4,
           description = $5,
           image_url = $6,
           button_text = $7,
           button_link = $8,
           metadata_json = $9::jsonb,
           last_updated = CURRENT_TIMESTAMP,
           updated_by = $10
       WHERE page_name = $1
         AND section_name = $2
       RETURNING page_name, section_name, title, subtitle, description, image_url, button_text, button_link, metadata_json, last_updated`,
      [
        pageName,
        sectionName,
        title || null,
        subtitle || null,
        description || null,
        image_path || null,
        button_text || null,
        button_link || null,
        JSON.stringify(sanitizePageMetadata(pageName, metadata_json)),
        req.user.user_id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "CMS section not found" });
    }

    // Invalidate homepage cache on CMS update
    try {
      await cmsPublicCacheClient.del(HOMEPAGE_CACHE_KEY);
    } catch (_) {}

    res.json({
      message: "Page section updated successfully",
      section: mapSectionRow(result.rows[0]),
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("updatePageSection error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.uploadHomePageImage = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();

    if (!req.file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    if (!String(req.file.mimetype || "").startsWith("image/")) {
      return res.status(400).json({ message: "Only image uploads are supported for CMS" });
    }

    const sectionName = sanitizeSectionName(req.body?.section_name);
    const pageName = req.body?.page_name ? sanitizePageName(req.body.page_name) : HOME_PAGE_NAME;

    const extension = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? extension : ".jpg";
    const fileName = `${Date.now()}${safeExt}`;
    const relativePath = path.join("cms", pageName, sectionName, fileName).replace(/\\/g, "/");
    const absolutePath = path.join(__dirname, "../../uploads", relativePath);

    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });

    const normalizedBuffer = await normalizeFile(req.file.buffer, req.file.mimetype);
    if (normalizedBuffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ message: "Image is too large after processing" });
    }

    await fsp.writeFile(absolutePath, normalizedBuffer);

    res.json({
      message: "Image uploaded successfully",
      image_path: relativePath,
      image_url: resolveFileUrl(relativePath),
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("uploadHomePageImage error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.uploadCmsFile = async (req, res) => {
  try {
    assertScert(req);
    await ensureCmsTables();

    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }

    const sectionName = sanitizeSectionName(req.body?.section_name);
    const pageName = req.body?.page_name ? sanitizePageName(req.body.page_name) : HOME_PAGE_NAME;
    const validatedFile = await validateCmsUploadFile(req.file);
    const fileName = validatedFile.storedFileName;
    const relativePath = path
      .join("cms-private", pageName, sectionName, fileName)
      .replace(/\\/g, "/");
    const absolutePath = path.join(__dirname, "../../private_uploads", relativePath);

    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, req.file.buffer);

    res.json({
      message: "File uploaded successfully",
      file_ref: relativePath,
      file_path: relativePath,
      file_url: resolveFileUrl(relativePath),
      file_name: req.file.originalname || fileName,
    });
  } catch (err) {
    const status = err.status || 500;
    console.error("uploadCmsFile error:", err);
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

exports.serveCmsFile = async (req, res) => {
  try {
    await ensureCmsTables();

    const pageName = sanitizePageName(req.params.pageName);
    const sectionName = sanitizeSectionName(req.params.sectionName);
    const fileName = path.basename(String(req.params.fileName || "").trim());

    if (!fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
      return res.status(400).json({ message: "Invalid file reference" });
    }

    const relativePath = path
      .join("cms-private", pageName, sectionName, fileName)
      .replace(/\\/g, "/");
    const absolutePath = resolveFileDiskPath(relativePath);

    try {
      await fsp.access(absolutePath);
    } catch {
      return res.status(404).json({ message: "File not found" });
    }

    const extension = path.extname(fileName).toLowerCase();
    const contentTypeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Type",
      contentTypeMap[extension] || "application/octet-stream"
    );
    
    const isDownload = req.query.download === "1" || req.query.download === "true";
    const disposition = isDownload ? "attachment" : "inline";
    
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${fileName.replace(/"/g, "")}"`
    );

    return res.sendFile(absolutePath);
  } catch (err) {
    const status = err.status || 500;
    console.error("serveCmsFile error:", err);
    return res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};
