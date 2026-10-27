import { SCHOOL_INFO } from "@/lib/metadata";
import { previewHref } from "../content";
import { ButtonLink, PageHero } from "../shared";

const policies = [
  {
    id: "school-day",
    title: "Reporting and collection",
    paragraphs: [
      "The school opens Monday to Friday, 7:00 AM–4:00 PM. Agree your child’s reporting and collection arrangements with the office and make sure the school knows who is authorised to collect them.",
      "Tell the school promptly if arrangements change. Ask the office for the current late arrival and late collection rules.",
    ],
  },
  {
    id: "care",
    title: "Health, care and the school bag",
    paragraphs: [
      "Discuss medical, dietary and personal care needs privately with the school. Keep emergency contacts current and let the school know about changes that affect your child’s day.",
      "Ask for the appropriate clothing, meal, rest and school bag checklist for your child’s class. Age groups have different practical needs.",
    ],
  },
  {
    id: "fees",
    title: "Fees and payment",
    paragraphs: [
      "Fees are due at the beginning of each session. If you need a special arrangement, discuss it directly with the administrator or proprietress.",
      "Ask for the current fee schedule and approved payment instructions. Confirm the recipient with the school office before paying.",
    ],
  },
  {
    id: "communication",
    title: "Working together",
    paragraphs: [
      "Share questions and concerns with the school early so that they can be discussed constructively. Ask who to contact about learning, care, administration or fees.",
      "This page is a practical overview. The school’s full Policies for Parents document and signed agreements contain the detailed requirements that apply to enrolled families. Request a copy from the office.",
    ],
  },
];

export function PoliciesPage() {
  return (
    <>
      <PageHero
        label="Policies for families"
        title="Clear expectations. A caring community."
        intro="A practical guide to the everyday arrangements that help home and school work well together."
        tone="green"
        variant="masthead"
      />
      <section className="ns-section ns-container">
        <div className="ns-reading">
          <nav aria-label="Policy topics" className="ns-policy-index">
            {policies.map((policy) => (
              <a key={policy.id} href={`#${policy.id}`}>
                {policy.title}
              </a>
            ))}
          </nav>
          {policies.map((policy) => (
            <section
              className="ns-policy-section"
              id={policy.id}
              key={policy.id}
            >
              <h2>{policy.title}</h2>
              {policy.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <ButtonLink path="contact">Request the full policies</ButtonLink>
        </div>
      </section>
    </>
  );
}

const information = {
  privacy: {
    label: "Privacy",
    title: "Your family’s information deserves care.",
    intro:
      "A clear explanation of how enquiries work in this design preview and how to ask the school about personal information.",
    sections: [
      {
        title: "Enquiries in this preview",
        paragraphs: [
          "The enquiry forms prepare a draft in your browser. Completing the form does not send information to the school or store the enquiry in a school database. You choose whether to send the draft through your own email or WhatsApp.",
          "Please do not include medical records, financial documents or other sensitive details in a general enquiry. Arrange a private conversation with the school when those details are needed.",
        ],
      },
      {
        title: "When you contact the school",
        paragraphs: [
          "The contact details and information you choose to send help the school understand and respond to your enquiry. Email and WhatsApp are provided by their respective services, which have their own privacy practices.",
          "For questions about student records, school systems, access to information or corrections, contact the school office. The school’s current privacy information and enrolment agreements govern those services.",
        ],
      },
      {
        title: "Preview access",
        paragraphs: [
          "This private preview uses an essential, signed access cookie. It lasts for up to eight hours and is removed when you lock the preview. It contains an expiry and signature, not your password.",
          "The preview does not add advertising trackers or automatically embed maps. Opening directions, email or WhatsApp takes you to the service you choose.",
        ],
      },
    ],
  },
  terms: {
    label: "Website terms",
    title: "A helpful starting point for your school journey.",
    intro:
      "Please confirm the details that matter to your family directly with the school.",
    sections: [
      {
        title: "About this website",
        paragraphs: [
          "This is a private proposal for a redesigned Novastar website. Its page layouts and editorial copy are presented for review. A preview is not an offer of a school place or an enrolment agreement.",
        ],
      },
      {
        title: "School information",
        paragraphs: [
          "Programme age ranges are a guide. The school confirms placement, available places, fees, dates and other arrangements. Published news and events are drawn from the school’s existing published content.",
          "Preparing or sending an enquiry does not confirm an admission or a campus visit. Please wait for a direct response from the school.",
        ],
      },
      {
        title: "Content and links",
        paragraphs: [
          "The school name, branding and photographs remain with their respective owners. Please ask before reusing material.",
          "External services such as email, WhatsApp and maps have their own terms. If you spot an error or a broken link, please tell the school office.",
        ],
      },
    ],
  },
  accessibility: {
    label: "Accessibility",
    title: "A welcome you can find your way around.",
    intro:
      "Information should be easy to reach, read and use. Tell us when something gets in the way.",
    sections: [
      {
        title: "Using the website",
        paragraphs: [
          "The preview supports keyboard navigation, visible focus, labelled form controls, expandable questions and a mobile navigation menu. A skip link takes you directly to the main content.",
          "Layouts adapt to smaller screens, text can be enlarged using your browser controls, and motion is reduced when your device requests reduced motion.",
        ],
      },
      {
        title: "Getting another format",
        paragraphs: [
          "If a page or form is difficult to use, you can contact the school by telephone or email. Tell us the information you need and the format or support that would help.",
          "Accessibility is an ongoing part of reviewing this design. Please report a problem with the page address and a short description of what happened.",
        ],
      },
    ],
  },
  nondiscrimination: {
    label: "A welcoming community",
    title: "Every child brings something of their own.",
    intro:
      "A thoughtful conversation helps a family and a school understand each other.",
    sections: [
      {
        title: "Getting to know your child",
        paragraphs: [
          "Children bring different experiences, interests, abilities and ways of learning. Discuss the needs that matter to your child early in the admissions conversation.",
          "Ask the school about the guidance, care and arrangements available. The team can explain what it can provide and discuss any specific requirements with your family.",
        ],
      },
      {
        title: "Respect in our community",
        paragraphs: [
          "Kindness, listening and respect are part of the community we want to build. If something concerns you, speak with the school so it can be addressed through the appropriate process.",
          "Contact the office for the school’s full admissions, inclusion and family policies.",
        ],
      },
    ],
  },
};

export type InformationPageName = keyof typeof information;

export function InformationPage({ name }: { name: InformationPageName }) {
  const page = information[name];
  return (
    <>
      <PageHero
        label={page.label}
        title={page.title}
        intro={page.intro}
        tone="lilac"
        variant="compact"
      />
      <section className="ns-section ns-container">
        <article className="ns-reading">
          {page.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <h2>Let’s talk.</h2>
          <p>
            <a href={`mailto:${SCHOOL_INFO.email}`}>{SCHOOL_INFO.email}</a>
            <br />
            <a href={`tel:${SCHOOL_INFO.phoneHref}`}>{SCHOOL_INFO.phone}</a>
          </p>
          <p>
            <a href={previewHref("contact")}>Contact and directions →</a>
          </p>
        </article>
      </section>
    </>
  );
}
