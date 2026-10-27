import { ArrowUpRight, CalendarDays } from "lucide-react";
import {
  getPublishedEvents,
  getPublishedNews,
  getPublishedNewsItem,
} from "@/lib/data";
import { notFound } from "next/navigation";
import { previewHref } from "../content";
import { PreviewSearch, Questions } from "../interactive";
import { ButtonLink, PageHero, SectionHeading } from "../shared";

const guides = [
  {
    slug: "a-good-school-visit",
    title: "A good school visit starts with your questions.",
    intro:
      "A few things to notice when you are imagining your child in a new school.",
    paragraphs: [
      "Start with what matters to your family. How does your child respond to new people and places? What makes them feel secure? Sharing this with the school can make your conversation more useful.",
      "Look at the ordinary moments. Notice how children use the space, how adults listen and how children ask for help. Ask what a day might look like for the class you are considering.",
      "Leave with practical clarity. Find out about placement, fees, reporting and collection, family communication and the application process. You do not need to decide during the visit. Take time to reflect and ask the next question.",
    ],
  },
  {
    slug: "independence-in-small-steps",
    title: "Independence begins with the small things.",
    intro: "A little time, a little patience, and the chance to try again.",
    paragraphs: [
      "Putting something back where it belongs. Choosing between two suitable activities. Carrying a small bag. Everyday experiences offer children opportunities to practise doing things for themselves.",
      "Start with a task that is safe and appropriate for your child. Show it slowly, make the materials easy to reach, and allow enough time for an attempt. Learning often looks less tidy than doing it for them.",
      "Notice the effort. A calm conversation about what happened can matter more than a quick reward. Ask the school about the routines and activities that could connect home and classroom life.",
    ],
  },
];

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Accra",
  }).format(date);

export async function NewsPage() {
  const news = await getPublishedNews(24);
  return (
    <>
      <PageHero
        label="The school journal"
        title="A community full of stories."
        intro="Published updates from the school, alongside a little reading for the everyday adventure of growing up."
        tone="gold"
        variant="masthead"
      />
      <section className="ns-section ns-container">
        <SectionHeading label="School updates" title="From our community." />
        {news.length ? (
          <div className="ns-article-list">
            {news.map((item) => (
              <a
                className="ns-article-row"
                href={previewHref(`news/${encodeURIComponent(item.id)}`)}
                key={item.id}
              >
                <span>
                  {item.publishedAt
                    ? formatDate(item.publishedAt)
                    : "School update"}
                </span>
                <h2>{item.title}</h2>
                <ArrowUpRight aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : (
          <div className="ns-empty">
            <h2>The next story is still being written.</h2>
            <p>
              There are no published school updates to show right now. You can
              always contact the office for current information.
            </p>
            <ButtonLink path="contact">Talk with the school</ButtonLink>
          </div>
        )}
      </section>
      <section className="ns-section ns-tone-green">
        <div className="ns-container">
          <SectionHeading
            label="Family reading"
            title="Good things to think about."
          />
          <div className="ns-article-list">
            {guides.map((guide) => (
              <a
                className="ns-article-row"
                key={guide.slug}
                href={previewHref(`news/${guide.slug}`)}
              >
                <span>A guide for families</span>
                <h2>{guide.title}</h2>
                <ArrowUpRight aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export async function ArticlePage({ id }: { id: string }) {
  const guide = guides.find((item) => item.slug === id);
  if (guide)
    return (
      <>
        <PageHero
          label="Family reading"
          title={guide.title}
          intro={guide.intro}
          tone="green"
          variant="compact"
        />
        <section className="ns-section ns-container">
          <article className="ns-reading">
            {guide.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <ButtonLink path="news" variant="outline">
              Back to the journal
            </ButtonLink>
          </article>
        </section>
      </>
    );
  const item = await getPublishedNewsItem(id);
  if (!item) notFound();
  return (
    <>
      <PageHero
        label="School journal"
        title={item.title}
        intro={
          item.publishedAt ? formatDate(item.publishedAt) : "A school update"
        }
        tone="lilac"
        variant="compact"
      />
      <section className="ns-section ns-container">
        <article className="ns-reading">
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {item.bodyEn}
          </div>
          <div className="ns-button-row" style={{ marginTop: 40 }}>
            <ButtonLink path="news" variant="outline">
              Back to the journal
            </ButtonLink>
          </div>
        </article>
      </section>
    </>
  );
}

export async function EventsPage() {
  const events = await getPublishedEvents(30);
  return (
    <>
      <PageHero
        label="School calendar"
        title="Good things to look forward to."
        intro="Published upcoming dates for the Novastar community. Please confirm arrangements with the office before attending an event."
        tone="sky"
        variant="masthead"
      />
      <section className="ns-section ns-container">
        {events.length ? (
          <div className="ns-article-list">
            {events.map((event) => (
              <article className="ns-article-row" key={event.id}>
                <span>
                  <time dateTime={event.startDate.toISOString()}>
                    {formatDate(event.startDate)}
                  </time>
                </span>
                <div>
                  <h2>{event.title}</h2>
                  {event.location && <p>{event.location}</p>}
                </div>
                <CalendarDays aria-hidden="true" />
              </article>
            ))}
          </div>
        ) : (
          <div className="ns-empty">
            <h2>A little breathing space in the diary.</h2>
            <p>
              There are no upcoming published events to display. Ask the school
              office for current term dates or to arrange a visit.
            </p>
            <ButtonLink path="visit">Arrange a school visit</ButtonLink>
          </div>
        )}
      </section>
    </>
  );
}

export function FaqPage() {
  return (
    <>
      <PageHero
        label="Good questions"
        title="You’re allowed to ask everything."
        intro="School is a big part of family life. Here are a few useful answers to help you begin; there is always room for another question."
        tone="lilac"
        variant="spotlight"
      />
      <section className="ns-section ns-container">
        <Questions />
      </section>
    </>
  );
}

export function SearchPage() {
  return (
    <>
      <PageHero
        label="Find your way"
        title="A little help finding the answer."
        intro="Search the redesigned website by topic, stage or the question on your mind."
        tone="paper"
        variant="compact"
      />
      <section className="ns-section ns-container">
        <PreviewSearch />
      </section>
    </>
  );
}
