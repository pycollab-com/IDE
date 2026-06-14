import logoUrl from "../assets/pycollab-app-logo.png";
import "./AppLanding.css";

const DOWNLOAD_URL =
  "https://github.com/pycollab-com/IDE/releases/latest/download/PyCollab.IDE.dmg";

export default function AppLanding() {
  return (
    <main className="app-landing-page">
      <section className="app-landing-stage" aria-label="PyCollab landing page">
        <div className="app-landing-artboard" aria-hidden="true">
          <svg className="app-landing-artwork" viewBox="0 0 820 607">
            <rect width="820" height="607" fill="#121113" />
            <path
              fill="#899878"
              d="M301 0H820V353C804 364 780 368 753 367C711 365 675 349 635 326L462 229C399 193 352 160 320 123C287 84 273 39 301 0Z"
            />
            <path
              fill="#899878"
              d="M0 284C97 269 188 323 210 417C220 460 211 498 194 536L139 607H0Z"
            />
          </svg>
        </div>

        <a className="app-landing-brand" href="/">
          PyCollab
        </a>

        <div className="app-landing-lockup">
          <img
            className="app-landing-logo"
            src={logoUrl}
            alt="PyCollab logo"
            width="148"
            height="148"
          />
          <h1 className="app-landing-title">PyCollab IDE</h1>
          <a className="app-landing-download" href={DOWNLOAD_URL}>
            Download for macOS
          </a>
        </div>
      </section>
    </main>
  );
}
