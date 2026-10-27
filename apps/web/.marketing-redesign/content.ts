export const PREVIEW_ROOT = "/school-preview";
export const previewHref = (path = "") =>
  `${PREVIEW_ROOT}/${path ? `${path.replace(/^\/+|\/+$/g, "")}/` : ""}`;

export const photos = {
  community: "/images/photo_2_2026-10-05_11-06-55%20for%20primary%20school.jpg",
  primary: "/images/photo_3_2026-10-05_11-06-55%20for%20primary%20school.jpg",
  play: "/images/photo_4_2026-10-05_11-06-55%20for%20preschool.jpg",
  early: "/images/photo_1_2026-10-05_11-06-55%20for%20preschool.jpg",
};

export const programmes = [
  {
    slug: "preschool",
    name: "The early years",
    stage: "Crèche, nursery & kindergarten",
    ages: "6 months–5 years",
    tone: "gold",
    image: photos.play,
    title: "Small discoveries. A whole new world.",
    intro:
      "A gentle beginning, with room to play, explore and practise doing things for themselves.",
    description:
      "Care, conversation and hands-on discovery help our youngest children grow comfortable in a community beyond home.",
    subjects: [
      "Practical life",
      "Language & storytelling",
      "Early mathematics",
      "Sensorial exploration",
      "Creative expression",
      "Movement & play",
    ],
    experiences: [
      "Pouring, sorting and caring for materials turn everyday tasks into moments of independence.",
      "Stories, songs and conversation make language part of the whole day.",
      "Play and purposeful activity give children time to repeat, explore and discover.",
    ],
  },
  {
    slug: "primary-school",
    name: "The primary years",
    stage: "Basic 1–6",
    ages: "6–11 years",
    tone: "green",
    image: photos.primary,
    title: "Bigger questions. Deeper understanding.",
    intro:
      "The foundations to think clearly, express an idea and keep asking why.",
    description:
      "Ghanaian curriculum foundations meet practical learning, growing responsibility and the pleasure of figuring something out.",
    subjects: [
      "English language",
      "Mathematics",
      "Science",
      "Asante Twi",
      "History & culture",
      "Computing & creative arts",
    ],
    experiences: [
      "Concrete examples help children connect a new idea to something they can see and understand.",
      "Reading, discussion and writing give children different ways to express their thinking.",
      "Working alongside others builds the habits of listening, sharing responsibility and contributing.",
    ],
  },
  {
    slug: "junior-high",
    name: "The next chapter",
    stage: "Junior High 1–3",
    ages: "JHS 1–3",
    tone: "sky",
    image: photos.community,
    title: "Growing in knowledge. Finding a voice.",
    intro:
      "A thoughtful next step for young people becoming more independent learners.",
    description:
      "Subject knowledge, study habits and personal responsibility come together as learners prepare for what comes next.",
    subjects: [
      "English language",
      "Mathematics",
      "Integrated science",
      "Social studies",
      "Asante Twi",
      "Computing",
    ],
    experiences: [
      "Subject learning makes space for discussion, application and thoughtful questions.",
      "Growing independence comes with guidance in planning, preparation and study.",
      "Families can discuss placement, learning needs and the transition to junior high with the school.",
    ],
  },
] satisfies Array<{
  slug: string;
  name: string;
  stage: string;
  ages: string;
  tone: string;
  image: string;
  title: string;
  intro: string;
  description: string;
  subjects: string[];
  experiences: string[];
}>;

export const faqs = [
  {
    question: "Where is the school?",
    answer:
      "You will find Novastar at Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi. Contact the office for directions before your first visit.",
  },
  {
    question: "Which age groups can join?",
    answer:
      "The school offers crèche, nursery, kindergarten, primary and junior high. Age ranges on this website are a guide; the school will discuss the right placement for your child.",
  },
  {
    question: "Can we visit before applying?",
    answer:
      "Yes. Contact the school with a preferred day and time. The office will confirm a suitable appointment; sending an enquiry does not reserve a visit.",
  },
  {
    question: "What are the school hours?",
    answer:
      "The school opens Monday to Friday, 7:00 AM–4:00 PM. Please discuss your child’s reporting and collection arrangements with the office.",
  },
  {
    question: "How do I get the current fees?",
    answer:
      "Ask the school office for the current schedule for your child’s class. Confirm tuition, optional services, one-time items and payment arrangements before making a payment.",
  },
  {
    question: "Does Montessori mean children do whatever they want?",
    answer:
      "Montessori combines choice with structure. Thoughtfully prepared activities, adult guidance and care for other people help children practise independence responsibly.",
  },
  {
    question: "How will we hear about our child’s learning?",
    answer:
      "Ask about the school’s communication and reporting arrangements when you visit. Enrolled families can also sign in to the parent portal for the information available to their account.",
  },
  {
    question: "What should we bring when applying?",
    answer:
      "Contact the admissions team for the current document checklist and any class-specific requirements. Share learning or care needs early so that the school can discuss them with you.",
  },
];

export const pageIndex = [
  {
    path: "",
    title: "Welcome to Novastar",
    description: "Montessori education, care and discovery in Kumasi.",
  },
  {
    path: "about",
    title: "Our school",
    description: "Our purpose, values and place in Ayeduase.",
  },
  {
    path: "academics",
    title: "How learning happens",
    description: "Montessori principles and Ghanaian curriculum foundations.",
  },
  {
    path: "preschool",
    title: "The early years",
    description: "Crèche, nursery and kindergarten; 6 months to 5 years.",
  },
  {
    path: "primary-school",
    title: "The primary years",
    description: "Basic 1 to 6; subject learning and growing independence.",
  },
  {
    path: "junior-high",
    title: "Junior high",
    description: "JHS 1 to 3; the next chapter in learning.",
  },
  {
    path: "school-life",
    title: "Life at Novastar",
    description: "Play, friendships, school routines and a photo gallery.",
  },
  {
    path: "admissions",
    title: "Joining our community",
    description: "Enquire, visit, apply and prepare for the first day.",
  },
  {
    path: "visit",
    title: "Come and meet us",
    description: "Prepare a campus visit enquiry and get directions.",
  },
  {
    path: "fees",
    title: "Fees and practicalities",
    description: "Request the current fee schedule and payment information.",
  },
  {
    path: "news",
    title: "School journal",
    description: "Published school news and updates.",
  },
  {
    path: "events",
    title: "Dates for your diary",
    description: "Published upcoming school events.",
  },
  {
    path: "contact",
    title: "Let’s talk",
    description: "Phone, email, WhatsApp, directions and enquiries.",
  },
  {
    path: "faqs",
    title: "Good questions",
    description: "Answers for families considering Novastar.",
  },
  {
    path: "policies",
    title: "Policies for families",
    description: "School routines, collection, health and fees.",
  },
  {
    path: "privacy",
    title: "Privacy",
    description: "Personal information and family enquiries.",
  },
  {
    path: "terms",
    title: "Website terms",
    description: "Using this website and checking school information.",
  },
  {
    path: "accessibility",
    title: "Accessibility",
    description: "Getting information in a format that works for you.",
  },
  {
    path: "nondiscrimination",
    title: "A welcoming community",
    description: "Inclusion and discussing your child’s needs.",
  },
];
