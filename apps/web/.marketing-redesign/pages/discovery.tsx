import { Asterisk } from "lucide-react";
import { SCHOOL_INFO } from "@/lib/metadata";
import { photos, programmes } from "../content";
import { ProgrammeFinder } from "../interactive";
import {
  ButtonLink,
  Eyebrow,
  PageHero,
  Photo,
  ProgrammeCards,
  SectionHeading,
} from "../shared";

const principles = [
  [
    "A child is a person, first.",
    "Their interests, feelings and pace matter. We start with care and build the confidence to try something new.",
  ],
  [
    "Doing makes ideas real.",
    "Children explore with their hands as well as their minds. Practical experiences help a new idea become something they understand.",
  ],
  [
    "Independence grows with guidance.",
    "Thoughtful choices and clear boundaries help children practise responsibility for themselves, their work and the people around them.",
  ],
  [
    "A school belongs to its community.",
    "Families bring knowledge of their own children. A good relationship between home and school helps us understand the whole child.",
  ],
];

export function AboutPage() {
  return (
    <>
      <PageHero
        label="Our school"
        title="A place to be yourself. And become so much more."
        intro="A school in Ayeduase, with a simple purpose: to bring care, confidence and the joy of discovery into a child’s everyday learning."
        image={photos.early}
        alt="A young child at Novastar Montessori School"
        tone="lilac"
      />
      <section className="ns-section ns-container">
        <div className="ns-editorial">
          <div className="ns-editorial-copy">
            <Eyebrow>Rooted here. Looking ahead.</Eyebrow>
            <h2>
              Growing with
              <br />
              <em>our community.</em>
            </h2>
            <p>
              Novastar Montessori School has been part of the Kumasi community
              since {SCHOOL_INFO.established}. Our journey takes children from
              crèche and nursery through kindergarten, primary and junior high.
            </p>
            <p>
              We believe a school should help children feel known. From the
              youngest learners discovering a new routine to older pupils
              finding their voice, there is room here to ask, practise, make
              mistakes and grow.
            </p>
            <ButtonLink path="school-life" variant="outline">
              Step into school life
            </ButtonLink>
          </div>
          <Photo
            src={photos.community}
            alt="Novastar pupils and their teacher together in the school grounds"
          />
        </div>
      </section>
      <section className="ns-section ns-tone-green">
        <div className="ns-container ns-manifesto">
          <div>
            <Eyebrow>What we believe</Eyebrow>
            <h2>
              Small principles.
              <br />
              <em>Lasting possibilities.</em>
            </h2>
          </div>
          <div>
            {principles.map(([title, copy], index) => (
              <article className="ns-belief" key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="ns-quote">
        <div className="ns-container">
          <blockquote>“{SCHOOL_INFO.motto}”</blockquote>
          <p>Novastar Montessori School</p>
        </div>
      </section>
    </>
  );
}

export function LearningPage() {
  return (
    <>
      <PageHero
        label="How we learn"
        title="Learning that starts with a little wonder."
        intro="Montessori principles. Ghanaian foundations. Practical experiences that help a child connect what they learn with the world they know."
        image={photos.primary}
        alt="Novastar primary school pupils"
        tone="green"
      />
      <section className="ns-section ns-container">
        <div className="ns-manifesto">
          <div>
            <Eyebrow>From a question to understanding</Eyebrow>
            <h2>
              Hands busy.
              <br />
              <em>Minds wide open.</em>
            </h2>
          </div>
          <div>
            {[
              [
                "Make room for curiosity",
                "An interesting material or a thoughtful question can open the door to a new idea. Children need time to notice, explore and try.",
              ],
              [
                "Build from the concrete",
                "Real objects, practical tasks and familiar examples make abstract concepts easier to grasp. Understanding comes before rushing ahead.",
              ],
              [
                "Practise with purpose",
                "Repetition gives children the chance to improve, recognise a mistake and experience the satisfaction of doing something independently.",
              ],
              [
                "Connect the learning",
                "Language, number, culture, science and creativity help children make sense of their lives in Ghana and the wider world.",
              ],
            ].map(([title, copy], index) => (
              <article className="ns-belief" key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="ns-section ns-tone-lilac">
        <div className="ns-container">
          <SectionHeading
            label="A connected journey"
            title="The right challenge at each new stage."
          >
            <p>
              Explore the learning, routines and questions that come with each
              chapter.
            </p>
          </SectionHeading>
          <ProgrammeCards />
        </div>
      </section>
      <section className="ns-section ns-container">
        <div className="ns-editorial">
          <Photo
            src={photos.play}
            alt="Novastar children exploring their play space together"
          />
          <div className="ns-editorial-copy">
            <Eyebrow>Beyond the lesson</Eyebrow>
            <h2>
              Learning how
              <br />
              <em>to be together.</em>
            </h2>
            <p>
              Listening. Taking turns. Caring for a shared space. Asking for
              help. These are part of learning too.
            </p>
            <p>
              When you visit, ask us how classroom life, individual guidance and
              family communication work at your child’s stage.
            </p>
            <ButtonLink path="visit">Bring your questions</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

export function ProgrammePage({
  programme,
}: {
  programme: (typeof programmes)[number];
}) {
  return (
    <>
      <PageHero
        label={programme.stage}
        title={programme.title}
        intro={programme.intro}
        image={programme.image}
        alt={
          programme.slug === "preschool"
            ? "Young Novastar pupils at play"
            : "Pupils at Novastar Montessori School"
        }
        tone={programme.tone}
      />
      <div className="ns-container ns-programme-facts">
        <div>
          <span>Stage</span>
          <strong>{programme.stage}</strong>
        </div>
        <div>
          <span>Age / class guide</span>
          <strong>{programme.ages}</strong>
        </div>
        <div>
          <span>Getting started</span>
          <strong>Talk with our admissions team</strong>
        </div>
      </div>
      <section className="ns-section ns-container">
        <div className="ns-manifesto">
          <div>
            <Eyebrow>A feel for the learning</Eyebrow>
            <h2>
              Growing a little
              <br />
              <em>more each day.</em>
            </h2>
          </div>
          <div>
            {programme.experiences.map((experience, index) => (
              <article className="ns-belief" key={experience}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{["Discover", "Practise", "Connect"][index]}</h3>
                  <p>{experience}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="ns-section ns-tone-lilac">
        <div className="ns-container">
          <SectionHeading
            label="Areas of discovery"
            title="A world of ideas to explore."
          >
            <p>
              Talk with the school about the curriculum and expectations for
              your child’s class.
            </p>
          </SectionHeading>
          <div className="ns-subjects">
            {programme.subjects.map((subject) => (
              <div key={subject}>
                <Asterisk aria-hidden="true" />
                {subject}
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="ns-section ns-container">
        <div className="ns-two-column">
          <div className="ns-side-note">
            <Eyebrow>A personal beginning</Eyebrow>
            <h2>
              The right fit
              <br />
              <em>for your child.</em>
            </h2>
            <p>
              Age ranges are a guide. A conversation about your child helps the
              school advise on placement, current availability and the next
              steps.
            </p>
            <div className="ns-button-row">
              <ButtonLink path="admissions">Joining Novastar</ButtonLink>
              <ButtonLink path="fees" variant="outline">
                Ask about fees
              </ButtonLink>
            </div>
          </div>
          <div>
            <Photo
              src={photos.community}
              alt="Children with their teacher at Novastar"
              className="ns-wide-photo"
            />
            <p className="ns-gallery-caption">
              A familiar community, with room for each new chapter.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

export function SchoolLifePage() {
  return (
    <>
      <PageHero
        label="Life at Novastar"
        title="The little moments make the big difference."
        intro="Friendships, shared discoveries, time to play, and the everyday routines that make school feel like a place to belong."
        tone="gold"
      />
      <section className="ns-container">
        <Photo
          src={photos.community}
          alt="Novastar pupils in purple uniforms with a teacher outdoors"
          className="ns-wide-photo"
          priority
        />
      </section>
      <section className="ns-section ns-container">
        <SectionHeading
          label="The rhythm of a school day"
          title="There is more to a day than lessons."
        >
          <p>
            Routines vary by class. Ask about your child’s day when you visit.
          </p>
        </SectionHeading>
        <div className="ns-day">
          {[
            [
              "01",
              "A warm beginning",
              "A familiar welcome and time to settle into the school day.",
            ],
            [
              "02",
              "Time to discover",
              "Activities, language, number and ideas to explore with guidance.",
            ],
            [
              "03",
              "Room to move",
              "Play, creativity and the chance to be alongside other children.",
            ],
            [
              "04",
              "A growing sense of self",
              "Small responsibilities, conversations and moments of independence.",
            ],
          ].map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="ns-section ns-tone-lilac">
        <div className="ns-container">
          <SectionHeading
            label="A few moments from our school"
            title="This is where we grow."
          />
          <div className="ns-gallery">
            <Photo
              src={photos.primary}
              alt="Primary school pupils at Novastar"
            />
            <Photo
              src={photos.play}
              alt="Children playing together at Novastar"
            />
            <Photo src={photos.early} alt="An early years pupil at Novastar" />
            <Photo
              src={photos.community}
              alt="A teacher and Novastar pupils in the school grounds"
            />
          </div>
          <p className="ns-gallery-caption">
            Photographs from the Novastar school collection.
          </p>
        </div>
      </section>
      <section className="ns-section ns-finder-section">
        <div className="ns-container">
          <Eyebrow>Picture your child here</Eyebrow>
          <h2>
            Every age has
            <br />
            <em>its own kind of magic.</em>
          </h2>
          <ProgrammeFinder />
        </div>
      </section>
    </>
  );
}
