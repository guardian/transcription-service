# Webpage snapshots

The Lambda uses Puppeteer and DuckDuckGo Autoconsent to reject optional cookies
before capturing the screenshot, rendered HTML, and title. Autoconsent runs in an
isolated browser world and handles frames and consent redirects. Its script and
rules are bundled into `dist/index.js`; no external consent or screenshot service
is used. Update the pinned `@duckduckgo/autoconsent` dependency to refresh rules.

The former cookie filter lists and English button-text matcher have been removed
so they cannot hide or block controls Autoconsent needs to interact with. Cosmetic
hiding is disabled. Detected consent failures and failed upstream self-tests fail
the job rather than producing a successful snapshot of a known consent wall.
Unsupported banners may still require additional rules.

Run `npm run webpage-snapshot::build` from the repository root. The build embeds
the browser script as text because it must execute inside Chromium, not Node.
The existing single-file Lambda packaging command remains sufficient.

Run browser regression tests with `npm test --workspace webpage-snapshot`.
By default these use the installed Sparticuz Chromium binary. On platforms where
that binary cannot run, set `CHROMIUM_EXECUTABLE_PATH` to a compatible Chromium
executable. Tests use intercepted fixture pages, including YouTube consent markup,
so they do not depend on live websites or AWS services.
