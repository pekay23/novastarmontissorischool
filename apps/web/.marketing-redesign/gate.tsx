import Image from "next/image";
import Link from "next/link";
import { Asterisk, ArrowUpRight, LockKeyhole } from "lucide-react";
import { PREVIEW_ROOT } from "./content";

export function PreviewGate({ error }: { error?: string }) {
  const configured = Boolean(process.env.MARKETING_PREVIEW_PASSWORD);
  return (
    <main className="ns-access">
      <div className="ns-access-art">
        <Link className="ns-brand" href="/">
          <Image src="/logo_nms.png" alt="" width={58} height={58} />
          <span>
            Novastar<small>Montessori School</small>
          </span>
        </Link>
        <Asterisk aria-hidden="true" />
        <h1>
          A familiar school.
          <br />
          <em>A fresh perspective.</em>
        </h1>
        <p>Private marketing website preview · Novastar Montessori School</p>
      </div>
      <div className="ns-access-form">
        <p className="ns-eyebrow">
          <LockKeyhole size={15} aria-hidden="true" />A little something, just
          for you.
        </p>
        <h2>
          Welcome to
          <br />
          <em>the next chapter.</em>
        </h2>
        <p>
          Explore a new vision for Novastar. Enter your preview password to step
          inside.
        </p>
        {configured ? (
          <form action={`${PREVIEW_ROOT}/access/`} method="post">
            <input type="hidden" name="action" value="unlock" />
            <label htmlFor="preview-password">Preview password</label>
            <input
              id="preview-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              aria-describedby={error ? "preview-error" : undefined}
            />
            {error && (
              <p id="preview-error" role="alert">
                {error === "limited"
                  ? "Preview access is temporarily limited. Please try again in 15 minutes."
                  : error === "cookies"
                    ? "Your browser did not retain preview access. Allow cookies for this site, then try again."
                    : "That password did not match. Please try again."}
              </p>
            )}
            <button type="submit" className="ns-button ns-button-purple">
              Step inside <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <p role="alert">
            Preview access is not configured. Set MARKETING_PREVIEW_PASSWORD in
            the server environment to enable access.
          </p>
        )}
        <p className="ns-access-note">
          Access lasts up to eight hours. You can lock the preview at any time.
        </p>
        <Link href="/" className="ns-access-note">
          Back to the current website{" "}
          <ArrowUpRight
            size={13}
            aria-hidden="true"
            style={{ display: "inline" }}
          />
        </Link>
      </div>
    </main>
  );
}
