# Webpage snapshots

The Lambda uses Puppeteer and DuckDuckGo Autoconsent to reject optional cookies
before capturing the screenshot, rendered HTML, and title. Autoconsent runs in an
isolated browser world and handles frames and consent redirects. Its rules are
bundled into `dist/index.js`, and its browser script is packaged as
`autoconsent.playwright.js` alongside it; no external consent or screenshot service
is used. Update the pinned `@duckduckgo/autoconsent` dependency to refresh rules.

The former cookie filter lists and English button-text matcher have been removed
so they cannot hide or block controls Autoconsent needs to interact with. Cosmetic
hiding is disabled. Detected consent failures and failed upstream self-tests fail
the job rather than producing a successful snapshot of a known consent wall.
Unsupported banners may still require additional rules.

Run `npm run webpage-snapshot::build` from the repository root. The build uses
esbuild and copies the browser script into `dist`. The root `npm run package` command includes both
files in `webpage-snapshot.zip`. At runtime the Lambda reads the browser script
from the directory containing `index.js`.
