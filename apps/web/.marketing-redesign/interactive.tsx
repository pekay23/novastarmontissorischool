"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Menu,
  Search,
} from "lucide-react";
import { cn } from "@novastar/shared-ui";
import { SCHOOL_INFO } from "@/lib/metadata";
import { faqs, pageIndex, previewHref, programmes } from "./content";

const navigation = [
  { label: "Our school", path: "about" },
  { label: "Learning", path: "academics" },
  { label: "School life", path: "school-life" },
  { label: "Admissions", path: "admissions" },
];

export function Navigation({ currentPath }: { currentPath: string }) {
  return (
    <header className="ns-header">
      <div className="ns-utility">
        <span>
          Ayeduase, Kumasi <span aria-hidden="true">↗</span> A place to grow.
        </span>
        <div>
          <a href={previewHref("events")}>School calendar</a>
          <a href="/portal/login/">
            Parent portal <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="ns-navigation">
        <a href={previewHref()} className="ns-brand">
          <Image src="/logo_nms.png" alt="" width={56} height={56} priority />
          <span>
            Novastar<small>Montessori School</small>
          </span>
        </a>
        <nav className="ns-desktop-nav" aria-label="Preview main navigation">
          {navigation.map((item) => (
            <a
              key={item.path}
              href={previewHref(item.path)}
              aria-current={currentPath === item.path ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
          <a
            href={previewHref("contact")}
            aria-current={currentPath === "contact" ? "page" : undefined}
          >
            Contact
          </a>
        </nav>
        <div className="ns-header-actions">
          <a
            href={previewHref("search")}
            className="ns-search-button"
            aria-label="Search preview"
          >
            <Search size={20} />
          </a>
          <a href={previewHref("visit")} className="ns-nav-cta">
            Come & see <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <details className="ns-mobile-menu">
            <summary aria-label="Open navigation">
              <Menu size={24} aria-hidden="true" />
            </summary>
            <nav aria-label="Preview mobile navigation">
              {[
                ...navigation,
                { label: "Contact", path: "contact" },
                { label: "Fees & practicalities", path: "fees" },
                { label: "Good questions", path: "faqs" },
                { label: "Plan a visit", path: "visit" },
              ].map((item) => (
                <a
                  href={previewHref(item.path)}
                  key={item.path}
                  aria-current={currentPath === item.path ? "page" : undefined}
                >
                  {item.label}
                  <ArrowUpRight size={18} aria-hidden="true" />
                </a>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export function ProgrammeFinder() {
  const [stage, setStage] = useState("preschool");
  const programme =
    programmes.find((item) => item.slug === stage) ?? programmes[0];
  return (
    <div className="ns-finder">
      <div>
        <label htmlFor="ns-stage">Where is your child in their journey?</label>
        <div className="ns-select-wrap">
          <select
            id="ns-stage"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            <option value="preschool">A first step · Early years</option>
            <option value="primary-school">A growing explorer · Primary</option>
            <option value="junior-high">A new chapter · Junior high</option>
          </select>
          <ChevronDown size={20} aria-hidden="true" />
        </div>
        <p>
          Placement is personal. We’ll help you find the right starting point.
        </p>
      </div>
      <div className="ns-finder-result" aria-live="polite">
        <span>{programme.stage}</span>
        <h3>{programme.name}</h3>
        <p>{programme.description}</p>
        <a href={previewHref(programme.slug)}>
          Explore this stage <ArrowUpRight size={20} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export function Questions({ limit }: { limit?: number }) {
  return (
    <div className="ns-questions">
      {faqs.slice(0, limit).map((faq, index) => (
        <details key={faq.question}>
          <summary>
            <span className="ns-question-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            {faq.question}
            <span className="ns-question-plus" aria-hidden="true">
              +
            </span>
          </summary>
          <p>{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function PreviewSearch() {
  const [query, setQuery] = useState("");
  const matches = pageIndex.filter((page) =>
    `${page.title} ${page.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="ns-search">
      <label htmlFor="ns-search-input">What would you like to know?</label>
      <div className="ns-search-field">
        <Search size={24} aria-hidden="true" />
        <input
          id="ns-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try ‘fees’, ‘early years’ or ‘visit’"
        />
      </div>
      <p role="status">
        {matches.length} {matches.length === 1 ? "page" : "pages"} to explore
      </p>
      <div className="ns-search-results">
        {matches.map((page) => (
          <a key={page.path} href={previewHref(page.path)}>
            <div>
              <h2>{page.title}</h2>
              <p>{page.description}</p>
            </div>
            <ArrowUpRight aria-hidden="true" />
          </a>
        ))}
      </div>
      {matches.length === 0 && (
        <p>
          Try another word, or{" "}
          <a href={previewHref("contact")}>contact the school</a> for help.
        </p>
      )}
    </div>
  );
}

export function EnquiryForm({
  kind = "general",
}: {
  kind?: "visit" | "admissions" | "fees" | "general";
}) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(
    null,
  );
  const title =
    kind === "visit"
      ? "A visit to Novastar"
      : kind === "admissions"
        ? "An admissions enquiry"
        : kind === "fees"
          ? "A fee schedule request"
          : "An enquiry for Novastar";
  return (
    <form
      className="ns-enquiry"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = (key: string) => String(form.get(key) ?? "").trim();
        const body = [
          `Hello Novastar,`,
          "",
          `${title} from ${value("name")}.`,
          `Email: ${value("email")}`,
          `Phone: ${value("phone")}`,
          `Stage: ${value("stage")}`,
          ...(kind === "visit"
            ? [
                `Preferred visit: ${value("date")} (please confirm availability)`,
              ]
            : []),
          "",
          value("message"),
          "",
          "Please let me know the next steps.",
        ].join("\n");
        setDraft({ subject: `${title} — ${value("name")}`, body });
      }}
    >
      <div className="ns-form-heading">
        <span className="ns-eyebrow">Start a conversation</span>
        <h2>
          {kind === "visit"
            ? "Let’s find a time to meet."
            : "Tell us a little about your family."}
        </h2>
        <p>
          This prepares your message for email or WhatsApp. Nothing is sent
          until you choose a channel and send it there.
        </p>
      </div>
      <div className="ns-form-grid">
        <label>
          Your name
          <input name="name" autoComplete="name" required maxLength={100} />
        </label>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={160}
          />
        </label>
        <label>
          Phone number <span>(optional)</span>
          <input name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </label>
        <label>
          Stage of interest
          <select name="stage" required defaultValue="">
            <option value="" disabled>
              Please choose
            </option>
            {programmes.map((programme) => (
              <option key={programme.slug}>{programme.stage}</option>
            ))}
            <option>Help me decide</option>
          </select>
        </label>
        {kind === "visit" && (
          <label className="ns-form-wide">
            Preferred visit date
            <input name="date" type="date" required />
            <span>The school will confirm the day and time.</span>
          </label>
        )}
        <label className="ns-form-wide">
          What would you like to ask? <span>(optional)</span>
          <textarea
            name="message"
            rows={4}
            maxLength={2000}
            placeholder="Tell us what matters to your family. Please leave out medical or other sensitive details."
          />
        </label>
      </div>
      <label className="ns-consent">
        <input type="checkbox" required />{" "}
        <span>
          I’m happy to share these details with the school for this enquiry.{" "}
          <a href={previewHref("privacy")}>Read about privacy.</a>
        </span>
      </label>
      <button type="submit" className="ns-button ns-button-purple">
        Prepare my enquiry <ArrowRight size={18} aria-hidden="true" />
      </button>
      {draft && (
        <div className="ns-draft" role="status">
          <h3>Your message is ready.</h3>
          <p>
            Choose how to send it. A visit or admission is confirmed only after
            the school replies.
          </p>
          <div className="ns-button-row">
            <a
              className="ns-button ns-button-purple"
              href={`mailto:${SCHOOL_INFO.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
            >
              Open email <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <a
              className={cn("ns-button", "ns-button-outline")}
              href={`https://wa.me/${SCHOOL_INFO.whatsapp}?text=${encodeURIComponent(draft.body)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open WhatsApp <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <details>
            <summary>Read your message</summary>
            <pre>{draft.body}</pre>
          </details>
        </div>
      )}
    </form>
  );
}
