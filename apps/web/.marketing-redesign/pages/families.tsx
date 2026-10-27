import { ArrowUpRight, Check, Clock3, Mail, MapPin, Phone } from "lucide-react";
import { SCHOOL_INFO } from "@/lib/metadata";
import { photos, previewHref } from "../content";
import { EnquiryForm, Questions } from "../interactive";
import {
  ButtonLink,
  Eyebrow,
  PageHero,
  Photo,
  SectionHeading,
} from "../shared";

const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SCHOOL_INFO.name}, ${SCHOOL_INFO.location}`)}`;

export function AdmissionsPage() {
  return (
    <>
      <PageHero
        label="Admissions"
        title="Your next chapter starts with a conversation."
        intro="Choosing a school is a personal decision. Let’s get to know your child, understand what matters to your family, and explore the next step together."
        image={photos.play}
        alt="Young Novastar children playing together"
        tone="lilac"
        variant="editorial"
      />
      <section className="ns-section ns-container">
        <SectionHeading
          label="A clear path, a warm welcome"
          title="From first hello to first school day."
        >
          <p>
            Availability and placement are confirmed by the school. Here is how
            to begin.
          </p>
        </SectionHeading>
        <div className="ns-steps">
          {[
            {
              title: "Tell us about your child",
              copy: "Share the stage you are interested in and the questions on your mind. The team can explain current availability.",
            },
            {
              title: "Come and meet us",
              copy: "Arrange a visit to see the school and talk through the learning, routines and care your child needs.",
            },
            {
              title: "Discuss the details",
              copy: "Ask for the application checklist, current fees, placement guidance and any supporting records required.",
            },
            {
              title: "Prepare for a good beginning",
              copy: "Once a place is confirmed, agree the start date and get the practical information for your child’s first day.",
            },
          ].map((step, index) => (
            <article className="ns-step" key={step.title}>
              <span>0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="ns-section ns-tone-green">
        <div className="ns-container ns-two-column">
          <div className="ns-side-note">
            <Eyebrow>Let’s get to know you</Eyebrow>
            <h2>
              A new beginning.
              <br />
              <em>A familiar welcome.</em>
            </h2>
            <p>
              You do not need every answer before reaching out. A short enquiry
              is a good place to start.
            </p>
            <ul className="ns-info-list">
              <li>
                <Check aria-hidden="true" />
                Tell us your child’s stage of learning.
              </li>
              <li>
                <Check aria-hidden="true" />
                Ask about placement and current availability.
              </li>
              <li>
                <Check aria-hidden="true" />
                Discuss support or care needs directly with the team.
              </li>
            </ul>
            <ButtonLink path="fees" variant="outline">
              Fees & practicalities
            </ButtonLink>
          </div>
          <EnquiryForm kind="admissions" />
        </div>
      </section>
      <section className="ns-section ns-container">
        <SectionHeading label="A little clarity" title="Before you begin." />
        <Questions limit={5} />
      </section>
    </>
  );
}

export function VisitPage() {
  return (
    <>
      <PageHero
        label="Come and meet us"
        title="Some things are better felt in person."
        intro="See the spaces, meet the people and bring your questions. Let’s find a time for your family to discover Novastar."
        image={photos.community}
        alt="A teacher standing with pupils at Novastar"
        tone="gold"
        variant="editorial"
      />
      <section className="ns-section ns-container">
        <div className="ns-two-column">
          <div className="ns-side-note">
            <Eyebrow>A visit, at your pace</Eyebrow>
            <h2>
              Come curious.
              <br />
              <em>Ask anything.</em>
            </h2>
            <p>
              A conversation at the school can help you picture your child’s day
              and understand how we learn together.
            </p>
            <ul className="ns-info-list">
              <li>
                <Clock3 aria-hidden="true" />
                <span>
                  Visits are by arrangement. The school will confirm your
                  appointment.
                </span>
              </li>
              <li>
                <MapPin aria-hidden="true" />
                <span>{SCHOOL_INFO.location}</span>
              </li>
              <li>
                <Phone aria-hidden="true" />
                <a href={`tel:${SCHOOL_INFO.phoneHref}`}>{SCHOOL_INFO.phone}</a>
              </li>
            </ul>
            <div className="ns-map-panel">
              <MapPin strokeWidth={1.3} aria-hidden="true" />
              <h3>Your way to Ayeduase.</h3>
              <p>
                Contact us before setting off so we can help with directions and
                make sure someone is ready to welcome you.
              </p>
              <a href={directions} target="_blank" rel="noopener noreferrer">
                Open directions <ArrowUpRight size={18} aria-hidden="true" />
              </a>
            </div>
          </div>
          <EnquiryForm kind="visit" />
        </div>
      </section>
      <section className="ns-section ns-tone-lilac">
        <div className="ns-container">
          <SectionHeading
            label="Make the most of your visit"
            title="A few questions worth bringing."
          />
          <div className="ns-subjects">
            {[
              "What might my child’s day look like?",
              "How do you help new children settle?",
              "How will we hear about progress?",
              "What should we know about collection?",
              "What is included in the current fees?",
              "What happens after we apply?",
            ].map((question) => (
              <div key={question}>
                <Check aria-hidden="true" />
                {question}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function FeesPage() {
  return (
    <>
      <PageHero
        label="Fees & practicalities"
        title="The details matter. Let’s make them clear."
        intro="A school decision is a family decision. Ask for the current fee schedule for your child’s class, with a clear explanation of what is included."
        tone="sky"
        variant="spotlight"
      />
      <section className="ns-section ns-container">
        <div className="ns-two-column">
          <div className="ns-side-note">
            <Eyebrow>Plan with confidence</Eyebrow>
            <h2>
              A complete picture.
              <br />
              <em>No guesswork.</em>
            </h2>
            <p>
              Fees can vary by class and the services your family chooses. The
              school office is the source for current amounts, due dates and
              payment arrangements.
            </p>
            <ButtonLink
              href={`https://wa.me/${SCHOOL_INFO.whatsapp}?text=${encodeURIComponent("Hello Novastar, please could you share the current fee schedule and what is included?")}`}
            >
              Request the current schedule
            </ButtonLink>
            <div className="ns-callout">
              Confirm payment instructions directly with the school office
              before making a payment.
            </div>
          </div>
          <div className="ns-fee-categories">
            {[
              [
                "01",
                "Learning & tuition",
                "Ask about termly tuition for the class your child will join.",
              ],
              [
                "02",
                "Getting started",
                "Confirm admission, books, stationery, uniform and any one-time items.",
              ],
              [
                "03",
                "The school day",
                "Discuss meals and any additional services your family may need.",
              ],
              [
                "04",
                "Payment arrangements",
                "Check due dates, approved payment methods and who to contact with a question.",
              ],
            ].map(([number, title, copy]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="ns-section ns-tone-lilac">
        <div className="ns-container ns-two-column">
          <div className="ns-side-note">
            <Eyebrow>One less thing to wonder about</Eyebrow>
            <h2>
              Ask us for
              <br />
              <em>the practical details.</em>
            </h2>
            <p>
              Tell us the class you are considering and we can point you towards
              the right information.
            </p>
            <Photo
              src={photos.early}
              alt="An early years pupil at Novastar"
              className="ns-wide-photo"
            />
          </div>
          <EnquiryForm kind="fees" />
        </div>
      </section>
    </>
  );
}

export function ContactPage() {
  return (
    <>
      <PageHero
        label="Contact"
        title="A good conversation can change everything."
        intro="A question about your child’s next step? A visit you would like to arrange? We would be happy to hear from you."
        tone="lilac"
      />
      <section className="ns-section ns-container">
        <div className="ns-contact-tiles">
          <article>
            <Phone strokeWidth={1.4} aria-hidden="true" />
            <h3>Let’s talk.</h3>
            <p>Call the school office during opening hours.</p>
            <a href={`tel:${SCHOOL_INFO.phoneHref}`}>{SCHOOL_INFO.phone}</a>
          </article>
          <article>
            <Mail strokeWidth={1.4} aria-hidden="true" />
            <h3>Drop us a note.</h3>
            <p>A little detail helps us answer your question.</p>
            <a href={`mailto:${SCHOOL_INFO.email}`}>{SCHOOL_INFO.email}</a>
          </article>
          <article>
            <MapPin strokeWidth={1.4} aria-hidden="true" />
            <h3>Find us in Kumasi.</h3>
            <p>{SCHOOL_INFO.location}</p>
            <a href={directions} target="_blank" rel="noopener noreferrer">
              Get directions <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </article>
        </div>
      </section>
      <section className="ns-section ns-tone-green">
        <div className="ns-container ns-two-column">
          <div className="ns-side-note">
            <Eyebrow>Here to help</Eyebrow>
            <h2>
              What’s on
              <br />
              <em>your mind?</em>
            </h2>
            <p>
              For a child’s personal care, medical or learning information,
              please arrange a private conversation with the school.
            </p>
            <ul className="ns-info-list">
              <li>
                <Clock3 aria-hidden="true" />
                <span>
                  Monday–Friday
                  <br />
                  {SCHOOL_INFO.hours[0]?.time}
                </span>
              </li>
              <li>
                <Phone aria-hidden="true" />
                <a
                  href={`https://wa.me/${SCHOOL_INFO.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chat with us on WhatsApp{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </li>
            </ul>
            <a
              href={previewHref("faqs")}
              className="ns-button ns-button-outline"
            >
              A few helpful answers{" "}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <EnquiryForm />
        </div>
      </section>
    </>
  );
}
