# 003: Tailwind, headless components and a URL-driven search page

Status: accepted, 2026-10-13

## Context

- Spec 002 builds the search UI. Of three prototyped layouts, the owner chose the one with a filter sidebar. Most of it is ordinary controls: buttons that toggle a filter, native selects, text inputs and collapsible lists.
- A few parts need behavior that native HTML doesn't give for free: a filter drawer on phones (a dialog that holds keyboard focus), tooltips that keyboard and touch users can reach, and announcements for screen readers when results or a copy action change. Spec 002 AC32 requires WCAG 2.2 AA.
- Every search goes through the website's server code (decision record 002), so search can't run in the browser.
- Spec 002 AC16: the URL holds the whole query, and opening it shows results in the first page load.
- Writing server-side Next.js code is a learning goal. All the tools below are open source and free, so the cost rule isn't affected.

## Decision

**Styling: Tailwind CSS 4.** The prototype's design values (Public Sans and IBM Plex Mono, the grays, the blue accent, the notice-type colors and the reason-group colors) become theme variables. Tailwind generates CSS at build time and adds no code to the browser, so it works the same in server and client components.

**Components that need behavior: Radix Primitives**, styled with Tailwind, only where native HTML falls short: the phone filter drawer, tooltips and popovers. shadcn/ui's copy-in components can be the starting point where they fit, since their code lands in the repo and can be restyled freely. Everything else is plain HTML elements.

**Search state: the URL.** The search page is a server component. It reads the query from the URL, asks Typesense, and renders results and filter counts. Selecting a filter value is a link to the URL with that value added or removed, so every state can be shared, bookmarked and reached with back and forward. A few small client components cover input that's typed rather than clicked:

- the search box, field-search rows and year inputs, which update the URL after a short pause in typing
- searching the values of long filters (8,778 journals, 1,718 publishers), which asks a route handler for matching values instead of sending every name to every page
- the phone filter drawer and the copy-citation button

## Checked facts (2026-10-13)

| Fact | Source |
|---|---|
| Latest releases: Next.js 16.4.0 (2026-10-06), React 19.3.0, Tailwind CSS 4.3.3, the shadcn CLI 4.21.4, radix-ui 1.8.1, react-aria-components 1.22.1 | npm registry |
| `<Link>` prefetches routes that enter the viewport. The default, `"auto"`, prefetches a dynamic route down to its nearest `loading.js` boundary. `prefetch={false}` turns it off for both viewport and hover. Prefetching only runs in production. | Next.js Link docs (16.4.0) |
| By default `<Link>` keeps the scroll position while the page is visible. `scroll={false}` stops Next.js from scrolling to the page. | Next.js Link docs (16.4.0) |
| `"use cache"` needs the `cacheComponents` option. Its default store is in memory: on serverless hosts, entries "typically don't persist across requests". The persistent `"use cache: remote"` "typically incurs platform fees". | Next.js `use cache` docs (updated 2026-09-29) |
| shadcn/ui copies component code into the project. Its docs have both Radix and Base UI component sections. Which primitives each component uses wasn't confirmed. | ui.shadcn.com/docs |

## Alternatives considered

- **Client-side state with a JSON route handler.** Each filter change costs the same single round trip through the server to Typesense, and the response is about the same size. But the query would live both in React state and in the URL, and the first page load would need a separate server-rendering path to meet AC16. Rejected as more code for no speed gain.
- **A full component library (MUI, Chakra, Mantine).** Each has its own visual language. Restyling one to match the chosen design would take more work than building the few components needed, and they lean on client components.
- **React Aria Components instead of Radix.** The most thorough accessibility of the options, but more verbose. A reasonable fallback if Radix lacks a widget we need.
- **USWDS (the US Web Design System).** Its tone suits a public-record site, but it's Sass and plain JavaScript, not React, so every component would need wrapping.
- **CSS Modules or plain CSS.** Workable, but slower to iterate on than Tailwind for a design that's still changing.

## Consequences

- **Every filter change is one round trip** from the browser to the website's server code and on to Typesense. Expected to take roughly 100 to 300 ms when the website and Typesense run in the same region. That figure is unverified; spec 002 AC33 measures it locally, and Phase 4 picks the regions.
- **A clicked filter shows as selected immediately** while the new results load, and the old results are dimmed rather than removed.
- **Filter links set `prefetch={false}`,** so scrolling past dozens of filter values doesn't start searches or use up the visitor's rate limit. They also keep the scroll position.
- **Each URL change counts as one search** toward the per-visitor rate limit, so typed input waits for a pause before updating the URL.
- **Caching identical queries isn't free on Vercel.** The default cache doesn't persist between serverless requests, and the persistent options may be billed by usage. Spec 002 runs without caching and adds it only if the performance budget needs it. Phase 4 checks any persistent cache against the cost rule.
- **Without JavaScript,** filter links and the search form still work. The field-search rows, value search in long filters and the phone drawer need JavaScript.
- **The prototype's design values move into the Tailwind theme.** The mapping of reasons to color groups lives in one tested module, because the grouping is this site's, not Retraction Watch's.
