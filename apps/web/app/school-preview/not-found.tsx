import { ButtonLink, PageHero } from "@/.marketing-redesign/shared";

export default function PreviewNotFound() {
  return (
    <main>
      <PageHero
        label="A small detour"
        title="This path doesn’t lead to a page."
        intro="Let’s take you back to the beginning of the Novastar preview."
      />
      <div className="ns-container ns-section">
        <ButtonLink>Back to the preview</ButtonLink>
      </div>
    </main>
  );
}
