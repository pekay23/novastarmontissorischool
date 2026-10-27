import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasPreviewAccess } from "@/.marketing-redesign/access";
import {
  pageIndex,
  programmes,
  PREVIEW_ROOT,
} from "@/.marketing-redesign/content";
import { PreviewGate } from "@/.marketing-redesign/gate";
import { SiteShell } from "@/.marketing-redesign/shared";
import { HomePage } from "@/.marketing-redesign/pages/home";
import {
  AboutPage,
  LearningPage,
  ProgrammePage,
  SchoolLifePage,
} from "@/.marketing-redesign/pages/discovery";
import {
  AdmissionsPage,
  ContactPage,
  FeesPage,
  VisitPage,
} from "@/.marketing-redesign/pages/families";
import {
  ArticlePage,
  EventsPage,
  FaqPage,
  NewsPage,
  SearchPage,
} from "@/.marketing-redesign/pages/community";
import {
  InformationPage,
  PoliciesPage,
} from "@/.marketing-redesign/pages/policies";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ error?: string; previewCheck?: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  if (!(await hasPreviewAccess())) return { title: "Private design preview" };
  const path = (await params).slug?.join("/") ?? "";
  const page = pageIndex.find((item) => item.path === path);
  return {
    title:
      page?.title ?? (path === "search" ? "Find your way" : "School journal"),
  };
}

export default async function PreviewPage({ params, searchParams }: PageProps) {
  const query = await searchParams;
  if (!(await hasPreviewAccess()))
    return (
      <PreviewGate
        error={query.previewCheck === "1" ? "cookies" : query.error}
      />
    );
  if (query.previewCheck === "1") redirect(`${PREVIEW_ROOT}/`);
  const segments = (await params).slug ?? [];
  const path = segments.join("/");
  const programme = programmes.find((item) => item.slug === path);
  let page: React.ReactNode;
  if (programme) page = <ProgrammePage programme={programme} />;
  else if (segments.length === 2 && segments[0] === "news")
    page = <ArticlePage id={segments[1]} />;
  else
    switch (path) {
      case "":
        page = <HomePage />;
        break;
      case "about":
        page = <AboutPage />;
        break;
      case "academics":
        page = <LearningPage />;
        break;
      case "school-life":
        page = <SchoolLifePage />;
        break;
      case "admissions":
        page = <AdmissionsPage />;
        break;
      case "visit":
        page = <VisitPage />;
        break;
      case "fees":
        page = <FeesPage />;
        break;
      case "contact":
        page = <ContactPage />;
        break;
      case "news":
        page = <NewsPage />;
        break;
      case "events":
        page = <EventsPage />;
        break;
      case "faqs":
        page = <FaqPage />;
        break;
      case "search":
        page = <SearchPage />;
        break;
      case "policies":
        page = <PoliciesPage />;
        break;
      case "privacy":
      case "terms":
      case "accessibility":
      case "nondiscrimination":
        page = <InformationPage name={path} />;
        break;
      default:
        notFound();
    }
  return <SiteShell path={path}>{page}</SiteShell>;
}
