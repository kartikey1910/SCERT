import { PublicTopNav } from './PublicTopNav.jsx';

import { useEffect, useMemo, useState } from 'react';
import { get } from './apiClient.js';

const FALLBACK_SECTION = {
  title: 'About Us',
  subtitle: 'हमारे बारे में',
  description: [
    'The State Council of Educational Research and Training (SCERT), Uttarakhand conducts key scholarship examinations each year, including National Means-cum-Merit Scholarship Scheme (NMMSS), Dr. Shivanand Nautiyal Scholarship Scheme (SNSS), Sridev Suman Scholarship Scheme (SSSS), for Class 8 and the Chief Minister Meritorious Student incentive Scholarship Scheme for Classes 6 and 9. These initiatives provide financial support to meritorious students, especially from economically weaker sections, fostering equity and academic excellence across the state.',
    'National Means-cum-Merit Scholarship Scheme (NMMSS) launched in 2008 by the Ministry of Education, this centrally sponsored scheme aims to reduce dropout rates and encourage students from economically weaker sections to pursue secondary education. The scholarship amount was revised to 12,000 per annum in 2017. Uttarakhand’s quota under this scheme is 1048 scholarships.',
    'Dr. Shivanand Nautiyal Scholarship Scheme (SNSS) introduced by the Government of Uttarakhand, this scheme recognizes meritorious Class 8 students and provides monthly financial assistance. A total of 100 scholarships are awarded each year, equally distributed between Garhwal and Kumaon mandals.',
    'Sridev Suman Scholarship Scheme (SSSS) is a state initiative to honor exceptional Class 8 students. It ensures that every development block supports its top performers and highlights Uttarakhand’s commitment to equity and grassroots-level encouragement.',
    'Chief Minister’s Meritorious Student Scholarship Scheme (CM Scholarship), launched in 2023, motivates students from Class 6 to Class 12 by offering monthly scholarships based on performance in scholarship exams and board results. It is a strong initiative to recognize merit and foster excellence at every stage of schooling.',
    '',
    'राज्य शैक्षिक अनुसंधान एवं प्रशिक्षण परिषद (SCERT), उत्तराखंड प्रत्येक वर्ष कई महत्वपूर्ण छात्रवृत्ति परीक्षाओं का आयोजन करती है। इनमें राष्ट्रीय साधन-सह-मेधा छात्रवृत्ति योजना (NMMSS), डॉ. शिवानंद नौटियाल छात्रवृत्ति योजना (SNSS), श्रीदेव सुमन छात्रवृत्ति योजना (SSSS) कक्षा 8 के लिए तथा मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति योजना कक्षा 6 और 9 के लिए शामिल हैं। ये पहल विशेष रूप से आर्थिक रूप से कमजोर वर्गों के मेधावी छात्रों को वित्तीय सहायता प्रदान करती हैं, जिससे राज्य में समानता और शैक्षणिक उत्कृष्टता को बढ़ावा मिलता है।',
    'राष्ट्रीय साधन-सह-मेधावी छात्रवृत्ति योजना (NMMSS): इस योजना को वर्ष 2008 में शिक्षा मंत्रालय द्वारा प्रारंभ किया गया था। यह केंद्र प्रायोजित योजना विद्यालय छोड़ने की दर को कम करने तथा आर्थिक रूप से कमजोर वर्गों के छात्रों को माध्यमिक शिक्षा जारी रखने के लिए प्रोत्साहित करने के उद्देश्य से लागू की गई है। वर्ष 2017 में छात्रवृत्ति राशि को संशोधित कर ₹12,000 प्रति वर्ष कर दिया गया। इस योजना के अंतर्गत उत्तराखंड को 1048 छात्रवृत्तियां आवंटित की गयी हैं।',
    'डॉ. शिवानंद नौटियाल छात्रवृत्ति योजना (SNSS): उत्तराखंड सरकार द्वारा प्रारंभ की गई यह योजना कक्षा 8 के मेधावी छात्रों को सम्मानित करने के लिए है तथा उन्हें मासिक वित्तीय सहायता प्रदान करती है। प्रत्येक वर्ष कुल 100 छात्रवृत्तियां प्रदान की जाती हैं, जिन्हें गढ़वाल और कुमाऊँ मंडलों के बीच समान रूप से वितरित किया जाता है।',
    'श्रीदेव सुमन छात्रवृत्ति योजना (SSSS): यह एक राज्य स्तरीय पहल है, जिसका उद्देश्य कक्षा 8 के उत्कृष्ट छात्रों को सम्मानित करना है। इस योजना के अंतर्गत प्रत्येक विकासखंड के शीर्ष प्रदर्शन करने वाले छात्रों को सहायता प्रदान की जाती है। यह योजना समानता और जमीनी स्तर पर प्रोत्साहन के प्रति उत्तराखंड की प्रतिबद्धता को दर्शाती है।',
    'मुख्यमंत्री मेधावी छात्र छात्रवृत्ति योजना (CM Scholarship): वर्ष 2023 में प्रारंभ की गई यह प्रमुख योजना कक्षा 6 से कक्षा 12 तक के छात्रों को प्रेरित करती है। इसमें छात्रवृत्ति परीक्षाओं और बोर्ड परीक्षा के परिणामों के आधार पर मासिक छात्रवृत्ति प्रदान की जाती है। यह योजना स्कूली शिक्षा के प्रत्येक चरण में मेधावी छात्रों को पहचानने और उत्कृष्टता को बढ़ावा देने की एक सशक्त पहल है।'
  ].join('\n\n'),
};

export function AboutUsPage() {
  const [section, setSection] = useState(FALLBACK_SECTION);

  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        const data = await get('/api/public/cms/page/about_us');
        const mainSection = (data?.sections || []).find((item) => item.section_name === 'main_content');
        if (mounted && mainSection) {
          setSection({
            ...FALLBACK_SECTION,
            ...mainSection,
          });
        }
      } catch (_) {
        if (mounted) {
          setSection(FALLBACK_SECTION);
        }
      }
    };

    loadContent();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const paragraphs = useMemo(
    () =>
      String(section.description || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    [section.description]
  );

  return (
    <div className="landing-root">
      <PublicTopNav activeTab="About Us" />

      <main className="landing-main">
        <section className="about-public-section">
          <div className="about-public-card">
            <h1 className="about-public-title">{section.title || 'About Us'}</h1>
            {section.subtitle ? (
              <h2 className="about-public-subtitle">{section.subtitle}</h2>
            ) : null}
            {paragraphs.map((paragraph, index) => (
              <p key={`about-${index}`} className="about-public-paragraph">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
