import { ArrowUpRight, Asterisk, Flower2, HeartHandshake } from "lucide-react";
import { SCHOOL_INFO } from "@/lib/metadata";
import { photos, previewHref } from "../content";
import { ProgrammeFinder, Questions } from "../interactive";
import {
  ButtonLink,
  Eyebrow,
  Photo,
  ProgrammeCards,
  SectionHeading,
  VisitBand,
} from "../shared";

export function HomePage() {
  return (
    <>
      <section className="ns-container ns-home-intro">
        <div>
          <Eyebrow>Montessori · Ayeduase, Kumasi</Eyebrow>
          <h1>
            Room to wonder.
            <br />
            <em>Space to become.</em>
          </h1>
        </div>
        <div className="ns-intro-note">
          <Asterisk strokeWidth={1.3} aria-hidden="true" />
          <p>
            Big ideas begin with little discoveries. At Novastar, care and
            curiosity grow side by side, from the first school day to the next
            big step.
          </p>
          <ButtonLink path="admissions">Find your beginning</ButtonLink>
        </div>
      </section>
      <div className="ns-home-image-wrap">
        <Photo
          src={photos.community}
          alt="A teacher with Novastar pupils in their purple school uniforms, outdoors at school"
          className="ns-home-photo"
          priority
        />
        <div className="ns-roundel">
          <Flower2 size={25} strokeWidth={1.5} aria-hidden="true" />
          <span>
            Rooted in Kumasi.
            <br />
            <em>Open to possibility.</em>
          </span>
        </div>
        <div className="ns-photo-caption">
          <span>Our people. Our place. A community to grow with.</span>
          <span>Novastar Montessori School · Ghana</span>
        </div>
      </div>
      <div className="ns-word-strip" aria-label="Our values">
        <span>Curiosity</span>
        <Asterisk aria-hidden="true" />
        <span>Independence</span>
        <Asterisk aria-hidden="true" />
        <span>Belonging</span>
        <Asterisk aria-hidden="true" />
        <span>Joy</span>
      </div>
      <section className="ns-section ns-container">
        <SectionHeading
          label="Every age, a new adventure"
          title="One school. Many beginnings."
        >
          <p>
            Childhood is a journey, not a race. Explore the stage that feels
            right for your family.
          </p>
          <a href={previewHref("academics")}>
            How learning happens <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </SectionHeading>
        <ProgrammeCards />
      </section>
      <section className="ns-section ns-tone-lilac">
        <div className="ns-container ns-editorial">
          <Photo
            src={photos.play}
            alt="Two young Novastar pupils sharing a moment of play"
          />
          <div className="ns-editorial-copy">
            <Eyebrow>The Novastar way</Eyebrow>
            <h2>
              A childhood full of
              <br />
              <em>“I can do it.”</em>
            </h2>
            <p>
              That first brave question. The puzzle tried one more time. The
              small kindness offered to a friend. Learning lives in these
              moments.
            </p>
            <p>
              Our approach brings Montessori principles together with Ghanaian
              learning foundations, giving children practical ways to explore,
              think and express themselves.
            </p>
            <ButtonLink path="about" variant="outline">
              Get to know our school
            </ButtonLink>
            <div className="ns-learning-note">
              <HeartHandshake size={32} strokeWidth={1.3} aria-hidden="true" />
              <span>
                Care comes first.
                <br />
                Confidence grows from there.
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="ns-section ns-finder-section">
        <div className="ns-container">
          <Eyebrow>A good place to start</Eyebrow>
          <h2>
            Every child brings
            <br />
            <em>a different kind of wonder.</em>
          </h2>
          <ProgrammeFinder />
        </div>
      </section>
      <section className="ns-section ns-container">
        <SectionHeading
          label="Your family’s next chapter"
          title="Let’s take the first step together."
        >
          <p>
            A conversation, a visit, a little time to get to know each other.
          </p>
        </SectionHeading>
        <div className="ns-steps">
          {[
            [
              "01",
              "Start a conversation",
              "Tell us about your child and what you are looking for in a school.",
              "Enquire",
              "contact",
            ],
            [
              "02",
              "See it for yourself",
              "Meet us, explore the school and bring the questions that matter to you.",
              "Plan a visit",
              "visit",
            ],
            [
              "03",
              "Find the right fit",
              "Discuss placement, availability, fees and the application requirements.",
              "Explore admissions",
              "admissions",
            ],
            [
              "04",
              "Prepare for day one",
              "Get the practical details that help your child settle into school life.",
              "Good questions",
              "faqs",
            ],
          ].map(([number, title, copy, label, path]) => (
            <article className="ns-step" key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <a href={previewHref(path)}>
                {label}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      </section>
      <section className="ns-quote">
        <div className="ns-container">
          <blockquote>“{SCHOOL_INFO.motto}”</blockquote>
          <p>Our school motto. Our everyday purpose.</p>
        </div>
      </section>
      <section className="ns-section ns-container">
        <SectionHeading
          label="Before you ask"
          title="Good questions deserve clear answers."
        >
          <a href={previewHref("faqs")}>
            All your questions <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </SectionHeading>
        <Questions limit={4} />
      </section>
      <VisitBand />
    </>
  );
}
