import Image from "next/image";
import { ArrowDown, ArrowUpRight, Asterisk, MapPin } from "lucide-react";
import { cn } from "@novastar/shared-ui";
import { SCHOOL_INFO } from "@/lib/metadata";
import { photos, previewHref, programmes, PREVIEW_ROOT } from "./content";
import { Navigation } from "./interactive";

export function ButtonLink({
  children,
  path,
  href,
  variant = "purple",
}: {
  children: React.ReactNode;
  path?: string;
  href?: string;
  variant?: "purple" | "gold" | "outline" | "light";
}) {
  return (
    <a
      className={cn("ns-button", `ns-button-${variant}`)}
      href={href ?? previewHref(path)}
    >
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>
  );
}

export function Photo({
  src,
  alt,
  className,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("ns-photo", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 700px) 100vw, (max-width: 1100px) 70vw, 60vw"
        {...(priority ? { preload: true } : {})}
      />
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="ns-eyebrow">
      <span aria-hidden="true" />
      {children}
    </p>
  );
}

export function PageHero({
  label,
  title,
  intro,
  image,
  alt,
  tone = "paper",
  variant = "editorial",
}: {
  label: string;
  title: string;
  intro: string;
  image?: string;
  alt?: string;
  tone?: string;
  variant?: "editorial" | "spotlight" | "masthead" | "compact";
}) {
  return (
    <section
      className={cn("ns-page-hero", `ns-tone-${tone}`, `ns-hero-${variant}`)}
    >
      <div className="ns-container">
        <div className="ns-breadcrumb">
          <a href={previewHref()}>Home</a>
          <span aria-hidden="true">/</span>
          <span>{label}</span>
        </div>
        <div className={cn("ns-page-intro", image && "ns-page-intro-image")}>
          <div>
            <Eyebrow>{label}</Eyebrow>
            <h1>{title}</h1>
            <p className="ns-lead">{intro}</p>
          </div>
          {image && (
            <Photo
              src={image}
              alt={alt ?? "Novastar school community"}
              className="ns-inner-hero-photo"
              priority
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function SectionHeading({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ns-section-heading">
      <div>
        <Eyebrow>{label}</Eyebrow>
        <h2>{title}</h2>
      </div>
      {children && <div className="ns-section-aside">{children}</div>}
    </div>
  );
}

export function ProgrammeCards() {
  return (
    <div className="ns-programmes">
      {programmes.map((programme, index) => (
        <a
          href={previewHref(programme.slug)}
          key={programme.slug}
          className={cn("ns-programme", `ns-programme-${programme.tone}`)}
        >
          <div className="ns-programme-top">
            <span>0{index + 1}</span>
            <span>{programme.ages}</span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </div>
          <Photo
            src={programme.image}
            alt={
              programme.slug === "preschool"
                ? "Young Novastar children playing together"
                : "Novastar pupils in their school uniforms"
            }
          />
          <div className="ns-programme-copy">
            <p>{programme.stage}</p>
            <h3>{programme.name}</h3>
            <p>{programme.description}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

export function VisitBand() {
  return (
    <section className="ns-visit-band">
      <div className="ns-container">
        <div>
          <Eyebrow>Your next step</Eyebrow>
          <h2>
            You can feel a school
            <br />
            when you step inside.
          </h2>
          <p>
            Come with your questions. Meet the people, see the spaces, and
            imagine your child here.
          </p>
          <ButtonLink path="visit" variant="gold">
            Plan a visit
          </ButtonLink>
        </div>
        <div className="ns-visit-art" aria-hidden="true">
          <Asterisk strokeWidth={1} />
          <span>
            Come curious.
            <br />
            <em>Leave inspired.</em>
          </span>
        </div>
      </div>
    </section>
  );
}

export function SiteShell({
  children,
  path,
}: {
  children: React.ReactNode;
  path: string;
}) {
  return (
    <>
      <div className="ns-preview-bar">
        <span>Novastar · Private design preview</span>
        <form action={`${PREVIEW_ROOT}/access/`} method="post">
          <input type="hidden" name="action" value="lock" />
          <button type="submit">Lock preview</button>
        </form>
      </div>
      <a className="ns-skip" href="#preview-main">
        Skip to content
      </a>
      <Navigation currentPath={path} />
      <main id="preview-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="ns-footer">
        <div className="ns-container">
          <div className="ns-footer-top">
            <a href={previewHref()} className="ns-footer-wordmark">
              A little curiosity.
              <br />
              <em>A lifetime of possibility.</em>
            </a>
            <div>
              <MapPin size={22} aria-hidden="true" />
              <p>
                Rooted in Ayeduase.
                <br />
                Growing together in Kumasi.
              </p>
              <a href={previewHref("contact")}>
                Find your way here <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="ns-footer-grid">
            <div>
              <a className="ns-brand" href={previewHref()}>
                <Image src="/logo_nms.png" alt="" width={54} height={54} />
                <span>
                  Novastar<small>Montessori School</small>
                </span>
              </a>
              <p>{SCHOOL_INFO.motto}</p>
              <a href={`tel:${SCHOOL_INFO.phoneHref}`}>{SCHOOL_INFO.phone}</a>
              <a href={`mailto:${SCHOOL_INFO.email}`}>{SCHOOL_INFO.email}</a>
            </div>
            <div>
              <h3>Discover</h3>
              {[
                ["Our school", "about"],
                ["How we learn", "academics"],
                ["Life at Novastar", "school-life"],
                ["School journal", "news"],
              ].map(([label, url]) => (
                <a key={url} href={previewHref(url)}>
                  {label}
                </a>
              ))}
            </div>
            <div>
              <h3>Join us</h3>
              {[
                ["Admissions", "admissions"],
                ["Plan a visit", "visit"],
                ["Fees & practicalities", "fees"],
                ["Good questions", "faqs"],
              ].map(([label, url]) => (
                <a key={url} href={previewHref(url)}>
                  {label}
                </a>
              ))}
            </div>
            <div>
              <h3>Stay connected</h3>
              <a href={previewHref("events")}>School calendar</a>
              <a href={previewHref("contact")}>Contact the school</a>
              <a href="/portal/login/">
                Parent portal <ArrowUpRight size={14} aria-hidden="true" />
              </a>
              <a href={previewHref("search")}>Search this site</a>
              <p>
                {SCHOOL_INFO.hours[0]?.time}
                <br />
                Monday–Friday
              </p>
            </div>
          </div>
          <div className="ns-footer-bottom">
            <span>
              © {new Date().getFullYear()} {SCHOOL_INFO.name}
            </span>
            <div>
              {[
                ["Privacy", "privacy"],
                ["Terms", "terms"],
                ["Accessibility", "accessibility"],
                ["Policies", "policies"],
                ["Inclusion", "nondiscrimination"],
              ].map(([label, url]) => (
                <a key={url} href={previewHref(url)}>
                  {label}
                </a>
              ))}
            </div>
            <a href="#preview-main" aria-label="Back to main content">
              Back to top{" "}
              <ArrowDown className="ns-up" size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

export const communityPhoto = photos.community;
