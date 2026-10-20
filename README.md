# Drijfvuil modern

An isolated, redesigned successor to `..\drijfvuil-alt`: a Dutch report
explorer with a React/Vite client, Nest GraphQL API, shared contracts and Nx
tasks. **M2 demo report creation and M3 PostgreSQL adapter/migration code have
independently passed their bounded QA gates.** Legacy application/reports remain
untouched. M3 is code-only: no PostgreSQL execution or integration acceptance
is claimed. **M4 demo photo attachments have independently passed bounded
local-demo QA. M5 authentication, M6 shared cleanup/isolated ports and M7 local
clustering with corrected focus preservation have also independently passed.**
This is not persistent storage or production acceptance.

## Scope and safety

- Currently authorized runtime checks use synthetic in-memory reports only.
  New demo reports are temporary and disappear when the API restarts.
  M4 authorizes synthetic local demo image uploads, not real data, production
  endpoints, database access or AWS calls.
- Demo startup requires explicit `DRIJFVUIL_MODE=demo`; there is no silent
  fallback. API binds to loopback only. M3 adds a future opt-in PostgreSQL mode,
  but starting or accessing a database is **not authorized** for this slice.
- The map uses Leaflet geometry on a labeled schematic grid. No external
  tiles/fonts/assets are fetched. **M7 local clustering independently passed
  on its corrected replacement freeze; the original focus failure is preserved
  in the verification history.** No PWA/offline guarantee, real basemap or
  full geography accuracy is claimed.
- The GraphQL schema is a subset: `reports`, `report`, `cities`, `quarters`,
  the guarded M5 `demoAccount` query, anonymous
  `createReport(createReportInput: CreateReportDto!)`, and guarded M6
  `setReportCleaned(id: Int!, cleaned: Boolean!)`.
  Existing field vocabulary is retained. Read-query default city is 9000;
  explicit null city returns all cities, ignoring quarter as in the legacy
  resolver. Offset/limit remain documented no-ops for compatibility.
- **M5 update, 2026-10-18:** local-demo authentication independently passed
  its bounded demo QA gate. Only synthetic accounts,
  hashed-password verification, expiring HttpOnly-cookie sessions, sign-in/out
  UI and a protected demo-account operation are in scope. Anonymous reports/
  photos stay available. No real accounts, database/AWS, external identity
  service, roles, report edits/deletes or deployment are authorized.
- **M6 update, 2026-10-18:** the user approved temporary demo cleanup status:
  either signed-in fixture account may mark any report cleaned or reopen it;
  anonymous users may view but not change status. M6 independently passed
  on its replacement 62-input freeze. No ownership/roles, report edits/deletes, cleanup
  history, pagination changes or database/AWS access are included.
- M2's approved demo policy allows anonymous creation only: **5 resolver-reaching
  attempts per rolling minute across the process** and **100 added reports per
  process**, excluding fixtures. Validation failures reaching the resolver count;
  GraphQL validation/coercion errors before the resolver do not. No reset endpoint
  or automatic write retry. These are not production security guarantees.

## Tooling and local commands

Use Node **24.19.0** (available validation runtime) and Yarn **4.18.1**.
Before production, update to the verified supported patched Node 24 release
and rerun acceptance; at research time Node 24.22.0 is the LTS candidate.
No global install or `corepack enable` is needed.

```powershell
corepack yarn install --immutable
corepack yarn check
```

The CI workflow uses `.node-version` and the Yarn version pinned in
`package.json`. It installs dependencies with `corepack yarn install --immutable`
and runs `corepack yarn check` (type checks, lint, tests and both builds) on
pushes and pull requests to `main`. It does not use npm or Webpack.

The GitHub Pages workflow builds the Vite frontend with the Pages base path
and uploads only `dist/web`, including its generated `index.html` and assets.
The default project URL is `https://stargrasske.github.io/drijfvuil-modern/`,
not the account root. Select **GitHub Actions** as the Pages source in the
repository settings. Pages serves static files only: it cannot run the Nest
API or Vite's development proxy. Reports, photos and authentication require
a separately hosted API with appropriate routing; this workflow does not
deploy a working full-stack demo.

Two terminals, both in this directory:

```powershell
$env:DRIJFVUIL_MODE = 'demo'
$env:NX_DAEMON = 'false'
corepack yarn dev:api
```

```powershell
$env:NX_DAEMON = 'false'
corepack yarn dev
```

Client: `http://127.0.0.1:4200`; API: `http://127.0.0.1:3333/graphql`.
Vite proxies `/graphql`, `/files` and `/auth` locally. Production builds do not start services;
a future deployment must explicitly configure same-origin routing.

For isolated local ports, set the same explicit pair in **both terminals**
before starting the API/Vite:

```powershell
$env:DRIJFVUIL_API_PORT = '13333'
$env:DRIJFVUIL_WEB_PORT = '14200'
```

Check that the chosen ports are free first; never stop/access unrelated
listeners. Both values must be canonical decimal integers 1..65535 and must
differ. Defaults 3333/4200 apply only when unset; empty/invalid values fail.
API/Vite remain loopback-only and fail on occupied ports without incrementing
or falling back. `/graphql`, `/auth` and `/files` target the configured API.
Auth/cleanup Origin/Host checks accept only the configured pair's HTTP
localhost/127.0.0.1 origins, not unused defaults or arbitrary origins.
Port configuration passed the bounded M6 independent QA gate.

Yarn uses a project-local cache and node-modules linker. Dependency lifecycle
scripts are disabled; no forced peers, engine suppression or hand-authored
dependency lock data. Nx uses `nx:run-commands` targets and does not connect to
Nx Cloud. `@nx/nest` is omitted deliberately: its 23.3 peers exclude Nest 12.
TypeScript 6 is retained because the selected typescript-eslint excludes 7.
Vitest 5.0.4 is outside Yarn's publication quarantine; 5.0.5 was too new at
installation time. The age protection was not disabled.

## Plan and remaining recreation

See the approved [modernization plan](../../upgrade-plans/drijfvuil-modernization-plan-2026-10-16.md).
Latest accepted slice: M7 local schematic-map clustering, zoom/member reveal
and corrected focus preservation, independently verified on the replacement
65-input frozen implementation. List, filters and cleanup status remain
synchronized. No external tiles/services or service worker is included.
Next: separately authorize real PostgreSQL migration/integration/rollback
checks, persistent image storage, broader cleanup/edit/delete flows,
basemap/clustering/PWA, about/legal and release acceptance. No sibling-only
features are included.

### Demo report creation

The inline form uses city/quarter, coordinates, water/land, litter type and notes.
It blocks duplicate pending submits, retains values on errors, and refreshes
the explorer filters/selection after success. M4 adds optional demo photos;
M5 adds optional demo sign-in without requiring it for reports/photos.
A network error may leave the write outcome uncertain; the UI must
not silently retry or promise that no report was created.

Independently verified API choices:
coordinates require exactly two finite range-valid values; notes max 364
characters; optional supplied litter type must be nonblank and max 80
characters. City omission defaults to 9000 but explicit null is rejected;
quarter is optional/null, otherwise it must belong to the city. Omitted/null
location defaults to water; other supplied values must be water/land.
Litter type is optional in the API but required in the form. Unsupported
nonempty image IDs are rejected; absent/null/empty normalize to null.
These input adaptations are not a claim of exact legacy schema equivalence.
Multiple mutation aliases are not a transaction: a later failure does not roll
back earlier successful additions.

## Verification

**M1 read-only demo: Dev-verified, 2026-10-16T14:47:32+02:00.**
Executed in this successor only with Node 24.19.0 / Yarn 4.18.1:

| Actual check | Result |
| --- | --- |
| `corepack yarn check` | Pass: both app type checks, ESLint, Vitest and both production builds through Nx, without cache hits. |
| Vitest | **3 files / 34 tests passed**: 15 real Nest/GraphQL in-process checks and 19 client/DOM checks. |
| `corepack yarn install --immutable` | Pass against the generated lock and existing installation; not a fresh empty-directory/platform restore. |
| Compiled API + built-client proxy | Both returned the expected synthetic GraphQL results over loopback; client HTTP 200. |
| Actual browser, built client | Desktop 1440px: map marker selection, three city/quarter filter cycles, quarter reset and four-report all-city view passed. Mobile 390px: no horizontal overflow. |
| Browser failure recovery | Injected HTTP 503 produced the explicit error state; retry restored three reports. |
| Browser isolation/lifecycle regression | External origins blocked, zero attempted external requests. Repeated filter changes plus zoom produced zero JavaScript page errors after the Leaflet fix. Expected console network error only during the deliberately injected 503. |

Browser testing found and fixed a pending Leaflet zoom transition on map
unmount and a lazy-loaded Leaflet stylesheet overriding the schematic grid.
Programmatic map transitions and zoom animation are disabled; the same
filter/zoom sequence then passed. Client tests also cover stale-response
rejection, aborted requests, polling cleanup, invalid payloads and geolocation
success/denial without asking for location on render.

Historical M1 Yarn lock SHA-256, before M3 dependency additions:
`c044751a32ebc5e2909901283d8cc47a70ed48c58cef33088e13c8808ceb8219`.
Initial install reported disabled lifecycle hooks for Nx and
`@apollo/protobufjs`; no hooks were enabled to get passing results.
Temporary local preview processes were stopped after verification.

These are the implementing agent's checks, **not independent QA approval**,
full browser/a11y coverage, clean-platform/native/DB/AWS acceptance, complete
legacy feature parity, production readiness or permission to deploy.

### M2 frozen Dev handoff

Dev agent `2dde6330-fede-4915-8126-502d1485e955` published **M2 READY-FOR-QA**
at **2026-10-16T15:03:11+02:00**, then stopped source writes.
Dev reports `corepack yarn check` passed: both type checks, lint,
**5 files / 81 tests**, and both production builds, uncached.
No dependencies, servers or legacy files were changed by Dev.

Frozen implementation input manifest: **38 files**, SHA-256
`37a7b17add575f11ac0ba18ba8b358e87a48c7fa930356fe77890d91b6e599be`.
Algorithm: all files recursively under `apps` and `libs`, plus root
`package.json`, `yarn.lock`, `nx.json`, `tsconfig.base.json`,
`eslint.config.mjs`, `vitest.config.ts`, `.yarnrc.yml`, `.node-version`,
`project.json`, `.gitignore`; ordinal-sort relative Windows paths, concatenate
`path<TAB>lowercase-file-SHA256<LF>`, hash UTF-8 without BOM. README and generated
outputs are excluded.

### M2 independent QA acceptance

QA agent `bd844d16-998c-4879-b630-252702e18e19` published **M2 QA-PASS** and
released its validation window at **2026-10-16T15:11:32+02:00**. The 38-input
fingerprint above matched independently before and after all checks.

| Independently executed check | Result |
| --- | --- |
| `corepack yarn check`, `NX_SKIP_NX_CACHE=true` | Exit 0: both type checks, lint, **81 tests in 5 files**, both production builds; cache explicitly skipped. |
| Compiled Nest/GraphQL probes, `m2-independent-qa.mjs` in session artifacts | Creation/read/filter/defaults/pagination, validation without unintended writes, unsupported image rejection, rolling throttle windows, alias partial commits, process-wide budget/cap sharing and defensive copies passed. |
| Capacity boundary | Exactly 100 additions, excluding four fixtures; later rejection preserved stored state. |
| Actual built-client browser | Creation with 364-character notes, two simultaneous submit attempts producing one mutation, filter reconciliation, new-report selection/details and highlighted marker passed. |
| Browser recovery / uncertain outcome | Values retained after failure; corrected retry succeeded. A committed mutation with deliberately lost response disclosed uncertainty and did not auto-retry; subsequent read found the report. |
| Browser isolation / mobile | External origins blocked with zero attempted external requests; no JavaScript page errors; 390px viewport without horizontal overflow. Expected network console error only for deliberately lost response. |

QA made no source, manifest or documentation edits and stopped its owned demo
servers; ports 4317/4318 had no listeners at completion.

**Acceptance is limited to M2's ephemeral anonymous demo creation.** It is not
full product/security acceptance, exact legacy schema parity, persistent
storage, authentication, DB/AWS integration or deployment approval. Any
persistence/auth/upload follow-on still needs its own bounded authorization.

### M3 frozen code handoff

The user has now authorized PostgreSQL adapter/migration **implementation and
isolated unit tests only**, explicitly excluding database startup/access.
Dev `58090aab-6381-4249-9fc4-4033a176d171` owns the successor code for this slice.
It published **M3 CODE-READY-FOR-QA** and stopped writes at
**2026-10-16T16:15:23+02:00**.

Dev reports:

- Exact new dependencies: TypeORM **1.1.2**, pg **8.23.1** and development
  `@types/pg` **8.23.1**; Yarn-generated lock. Install and immutable install
  passed with dependency hooks still disabled.
- Final uncached `corepack yarn check` passed: **148 tests / 6 files**, both
  type checks, lint and both builds; completed 2026-10-16T16:15:04+02:00.
- No real driver initialization, database startup/access, SQL execution,
  migration execution, browser demonstration or live integration occurred.

Frozen identity: **46 implementation inputs**, SHA-256
`2691654c2438e91c2d4eeaf71c241881dda8f4c92f3a89e4dba513e135c2501d`.
The same algorithm/root input list as M2 is used; added API files are included
under `apps`. README and generated outputs remain excluded.

#### Configuration and unexecuted database procedures

The implemented future mode is `DRIJFVUIL_MODE=postgres`, requiring an explicit
`DRIJFVUIL_DATABASE_URL` with credentials, host and database. Query overrides
and fragments are rejected; configuration failures must not disclose secrets.
No application import automatically connects. No automatic synchronization,
migrations, seeds, retries or fixture fallback are intended.

The migration targets the new **drijfvuil_m3** schema with history table
**drijfvuil_m3_migrations**. It is **not a legacy TypeORM 0.2 database migration**.
Catalog provisioning is absent: an empty database must not become synthetic
demo data. Storage metadata drives different temporary-demo versus PostgreSQL
UI disclosures. Failed/uncertain PostgreSQL writes conservatively retain
process-budget reservations.

`corepack yarn migration:run` and `corepack yarn migration:revert` are provided
as future explicit procedures but were **not executed and are not authorized
to run yet**. Database SQL correctness, constraints, migration history setup,
real durability, transactions and rollback remain unverified until a separately
approved disposable PostgreSQL integration exercise.

### M3 independent code-only QA acceptance

QA `fb03db3a-6f6c-4d77-9e1f-33985ea7920e` published
**M3 CODE-QA-PASS — NOT PG INTEGRATION PASS** and released its QA window at
**2026-10-16T16:23:27+02:00**. All 46 frozen inputs matched the M3 fingerprint
above before and after validation; no high-confidence code defect was found.

| Independently executed check | Result |
| --- | --- |
| `corepack yarn check` with `NX_SKIP_NX_CACHE=true`, twice | Exit 0 both times: **148 tests / 6 files**, both type checks, lint and both builds; cache skipped. |
| Typed compiled-code probes | **14 groups passed** with repository, provider and QueryRunner doubles. A throwing guard on real `DataSource.initialize` recorded **zero calls**. |
| Configuration and lifecycle | Explicit modes, URL rejection/redaction, inert imports, no fallback, partial-initialization cleanup and idempotent shutdown checked offline. |
| Repository / GraphQL behavior | Nested data/ISO date mapping, nullable quarter, invalid relations, not-found/empty results, legacy filters/defaults/ignored pagination, validation and error propagation passed against doubles. |
| Process budgets | Throttle and shared capacity checked; PostgreSQL reservations include failed/uncertain saves, so the cap can be reached before 100 successful additions. No failed write was converted into fake success. |
| Migration / CLI review | Recorded up/down ordering and composite city/quarter constraints checked with a mock QueryRunner; rejection propagates without retry. Emitted CLI paths match the package scripts. |

Offline inspection confirmed the installed TypeORM creates its history table
in the connection's default schema/search path before running `up()`.
Application entities target `drijfvuil_m3`; history bootstrap therefore does
not depend on that schema already existing. The migration's down path does
not drop the history table/schema and uses no broad `CASCADE`.
This establishes code ordering only, not actual PostgreSQL execution.

QA did not start/access/discover a database, initialize a real driver, execute
SQL or the migration CLI, start services/containers, install dependencies,
or modify source/manifests/docs. No browser run was performed for M3.

**Still unrun:** actual SQL/constraints/sequence behavior, history permissions
and search path, real persistence across restart, concurrent transactions,
durability, migration/revert execution and rollback. Catalog provisioning is
also absent; empty catalog data is not replaced with fixtures.
The code-only pass does **not** authorize database activation, production,
AWS, authentication or deployment.

### M4 frozen Dev handoff

The user approved optional demo report photos with local tests/browser checks
only. Dev `572c65c4-783b-46c4-aba3-a56e7bdc582b` published
**M4 DEMO-READY-FOR-QA** at **2026-10-16T17:19:33+02:00**, then stopped source
writes. Producer owns documentation; independent QA
`f43ff2ff-b1ee-4d84-b4dd-20c0baf0178c` subsequently validated and released the window.

The approved boundary is JPEG/PNG/WebP, **5,000,000 bytes maximum per image**
(inclusive), and at most **10 stored images per process**. Storage is temporary
memory, lost on restart. The slice must link the uploaded image to a created
report, show it locally, retain failed values/selections, prevent duplicate
pending submission and disclose uncertain write outcomes.

Tests use synthetic fixtures and owned loopback demo servers only, with
external browser requests blocked. No database, real driver, migration,
SQL, AWS or production access is authorized. There are no claims of S3
presigning, persistent photo storage, malware scanning or production privacy.

Implementation contract, subsequently independently verified below:

- Multipart `POST /files/upload` accepts exactly one `upload` file and returns
  `{id,key,url,dbImageId}`. This is the successor's local contract, not a claim
  of complete legacy upload/createImage API parity.
- A local GET route returns stored bytes with format-appropriate Content-Type,
  generated filename, `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
  No S3/presigned URLs or external object store are involved.
- The byte boundary uses a one-byte parser sentinel to distinguish exactly
  5,000,000 bytes from larger input; oversized data is rejected before storage.
  Slots are reserved before parsing and released after failed/aborted uploads.
- Ten slots are shared process-wide, including orphaned confirmed uploads.
  There is no automatic orphan cleanup/reset endpoint. A confirmed upload can
  be reused across retries/reports; each report has at most one photo.
- PostgreSQL upload, retrieval and image-reference use remain rejected.
  Signature checks are not full image decoding, malware or privacy validation.

Dev's uncached `corepack yarn check` passed: both type checks, lint,
**184 tests / 9 files** and both production builds. No dependencies or root
runtime configuration files were added. Its basic real-browser synthetic PNG
preview/upload/create/selected-detail/image-decode flow passed with external
origins blocked. Extended mobile smoke remained incomplete because browser
tooling reported a stale file-chooser state. Owned Dev processes were stopped.

Frozen implementation identity: **50 inputs**, SHA-256
`9979d8ef51b26534632393563cb39697c93ddc808a62bb7e66ac4e0500968e18`,
using the same root list and ordinal Windows-path hash algorithm as M2/M3.

### M4 independent local-demo QA acceptance

QA `f43ff2ff-b1ee-4d84-b4dd-20c0baf0178c` published **M4 DEMO-QA-PASS** and
released its window at **2026-10-16T17:30:23+02:00**. The same 50-input
fingerprint matched before and after all checks; no blocking M4 defect was found.

| Independently executed check | Result |
| --- | --- |
| Uncached `corepack yarn check`, twice | Both exit 0: **184 tests / 9 files**, API/web type checks, lint and both builds. |
| Compiled-code / real HTTP probes | **77 assertions passed**: 74 main probes and 3 fresh-process restart checks. |
| Multipart boundaries | Exactly 5,000,000 bytes accepted and retrieved byte-for-byte; 5,000,001 rejected. Missing/empty/duplicate/unexpected files or fields, MIME/signature mismatch and malformed multipart rejected. |
| Capacity / cleanup | Process-shared reservations, concurrent uploads across providers, ten-slot cap, idempotent release and real socket-abort cleanup passed; rejected/aborted requests left no hidden image/metadata. |
| Retrieval / GraphQL linkage | Safe headers, defensive byte/metadata copies, invalid/unknown IDs, image reuse in reports, filters, no-photo path and unknown-reference rejection passed. Fake PostgreSQL mode denied image operations without real driver initialization. |
| Fresh process | Previously uploaded image returned 404; reports reset to four photo-free fixtures. |
| Actual browser, 390px | Synthetic PNG/JPEG previews and selected-report images decoded; duplicate immediate submits produced one upload/one mutation; filters and details reconciled. No horizontal overflow. |
| Browser failure/retry | Failed fields/file retained; a confirmed upload was reused after corrected report retry without re-uploading. Lost upload/report responses disclosed uncertain outcomes and did not automatically retry. Malformed/external image URLs were rejected. |

The independent browser run recovered from the inherited browser-profile/
file-chooser problem using a fresh owned integrated-browser page. External
origins were blocked. UI cleanup on React unmount was source-reviewed and
covered by rerun tests, not separately induced in the production-build browser.
WebP coverage is signature/MIME/byte HTTP roundtrip; actual browser decoding
was demonstrated for PNG and JPEG only. No full accessibility, decoder,
malware, privacy or security audit is claimed.

All owned servers/pages/probe apps were closed; the QA server PID was absent
and its loopback port unresponsive afterward. QA changed no implementation,
manifest or documentation files. No database, SQL/migration, AWS or legacy/
production endpoint was accessed.

**M4 acceptance is limited to public, synthetic, temporary local-demo photos.**
At M4 handoff, authentication, persistent images, real PostgreSQL integration,
S3/presigning, production security and deployment remained separate unapproved/
unrun gates. The M5 approval below supersedes only local-demo authentication.

### M5 frozen authentication handoff

Dev `da30c8a0-b225-4a02-8583-765c065c31a4` published
**M5 DEMO-READY-FOR-QA** at **2026-10-18T20:49:14.4596415+02:00**.
Frozen implementation: **56 inputs**, SHA-256
`7ad2d7eba44c36d06909cfd5c9347f1a4a31c19979a5436b81086e98d98bc571`,
using the established input-manifest algorithm. Source writes stopped.

Dev reports **214 tests / 12 files**, both type checks, lint and both builds
passing uncached, plus **18 browser checks** through the actual Vite proxy.
Node 24.19.0 / Yarn 4.18.1; no dependencies added. Browser coverage reported
sign-in/out, cookie isolation, protected query, rejected foreign-origin logout,
session recovery and mobile layout. It did not wait a literal 30 minutes;
controlled expiry tests and browser revoked-session recovery are distinct.

The optional Dutch demo sign-in panel discloses two non-real fixture accounts:

| Synthetic login | Demo-only password |
| --- | --- |
| `water@demo.invalid` | `Demo-water-1!` |
| `oever@demo.invalid` | `Demo-oever-2!` |

These public credentials must never be reused for real accounts. Passwords
are verified using awaited salted scrypt; public account payloads expose only
ID/name. No roles, registration/reset/email or report edits/deletes exist.

`GET /auth/session`, `POST /auth/login` and `POST /auth/logout` manage opaque,
process-memory sessions. GraphQL `demoAccount { id name }` exercises a real
session guard; anonymous reports/create/photos remain available. PostgreSQL
mode rejects demo authentication without fixture fallback.

Cookies are HttpOnly, SameSite=Strict, Path=/ with absolute 30-minute expiry;
they deliberately lack Secure for local HTTP and are not production-ready.
Login/logout require exact allowlisted loopback Origin/Host agreement, with
Vite preserving Host; forwarded headers are not trusted. Limits are 20 live
sessions, five state-reaching login attempts per rolling minute per process,
and two concurrent verifications. Transport/CSRF/admission rejections do not
consume attempts. Restart clears sessions/limits; this is not distributed
session management or production abuse prevention.

### M5 independent local-demo authentication acceptance

QA `31e7ea95-fad5-478c-9ae2-a16759a4104b` published **M5 DEMO-QA-PASS** and
released its window at **2026-10-18T20:59:01.1612401+02:00**. The 56-input
fingerprint above matched independently before execution at
20:50:55.1169353+02:00 and after checks/shutdown at 20:58:54.9575152+02:00.
No blocking M5 defect was found.

| Independently executed check | Result |
| --- | --- |
| Uncached `corepack yarn check` | Exit 0: **214 tests / 12 files**, API/web type checks, lint and both production builds; Node 24.19.0 / Yarn 4.18.1. |
| Compiled-code / real HTTP probes | **112 assertions passed**, including repeated payload exclusions and a harness diagnostic; not 112 distinct test cases. |
| Credentials / sessions | Awaited correct/wrong/unknown verification, generic failure responses, secret exclusions, session rotation/isolation, logout, shared capacity/concurrency and exact rolling-limit boundaries passed. |
| Absolute expiry | Controlled-clock probes passed at deadline minus 1ms and exact 30-minute expiry; reads did not renew sessions. |
| Cookies / CSRF | Actual cookie attributes/clearing, no-store responses, duplicate-cookie rejection, Origin/Host rejection and forwarded-header handling passed. |
| Guard / regression | Anonymous, authenticated, revoked and expired protected-query responses passed. Existing public GraphQL error/status behavior, anonymous create, multipart upload/retrieval and photo linkage passed. Fake PostgreSQL capability denied auth; **zero real-driver initialization calls**. |
| Actual browser via Vite proxy | **35 assertions passed**: 21 auth and 14 anonymous report/photo regression assertions, independent of Dev's counts. |

Browser checks covered duplicate pending login, committed-but-lost login/logout
responses with honest uncertainty and manual recovery, two isolated accounts,
HttpOnly cookie invisibility to JavaScript, no browser-storage tokens, reload
recovery, rejected foreign-origin logout, revoked-session recovery and visible
sign-out. Anonymous no-photo/photo creation, retained failures, confirmed-upload
reuse and uncertain writes remained functional. At 390px there was no
horizontal overflow; both final browser runs recorded zero attempted external
origins and zero JavaScript page errors.

Expiry used controlled clocks, not a literal 30-minute browser wait. Browser
auth used the real Vite development proxy against the compiled API; production
builds passed separately, not a deployed reverse proxy/TLS setup. Current
browser image decoding was PNG; historical M4 format evidence remains distinct.
No formal accessibility or security audit is claimed.

All owned servers/pages were stopped; final loopback listeners and known owned
PIDs were absent. QA edited no implementation/docs, installed nothing and
accessed no database, SQL/migration, AWS, external identity service or legacy
endpoint. **Acceptance covers synthetic local HTTP, memory-only demo auth,
not real-account/production authentication, persistent identity, deployment
or permission to begin another slice.** PostgreSQL integration remains unrun.

### M6 historical 59-input cleanup handoff

Dev `fc60d939-ef28-4074-af77-83801131e04d` published
**M6 DEMO-READY-FOR-QA** at **2026-10-18T21:27:22.9662459+02:00**.
Frozen implementation: **59 inputs**, SHA-256
`80daaecc646280a87d548acc219cddd1f3d3dd2c576890c45641d72fe6017414`
using the established manifest algorithm. Implementation writes stopped.

Dev reports 37 targeted tests, then uncached **251 tests / 14 files**, both
type checks, lint and builds passing under Node 24.19.0 / Yarn 4.18.1.
No dependencies or root runtime files changed. Its 59 browser assertions were
across runs; 54 preceded the final read-refresh refinement and five exercised
that refinement afterward. These claims are not independent final-source QA.

New public `Report.cleaned` is false for initial/new demo reports, changes to
true/false, and remains null for unsupported PostgreSQL reports. Authenticated
`setReportCleaned(id: Int!, cleaned: Boolean!): Report!` marks/reopens any known
demo report; either fixture account may update the same report. The desired
state is explicit/idempotent; repeated same-state calls do not change updatedAt.
No events, ownership, roles, history or report edit/delete capability is added.
PostgreSQL denies cleanup writes; no schema/migration changes or driver access.

The mutation reuses strict Origin/Host/Fetch-Site checks; Vite preserves Host
for `/graphql`. A separate process-wide **20 cleanup attempts per rolling
minute** includes authenticated same-origin semantic failures/no-ops, excluding
auth/CSRF/pre-resolver denials. Existing create quotas remain independent.
Current-state storage is temporary and bounded by reports, with no history.

Status is visible in list/map/details without hiding cleaned reports.
Signed-in controls block duplicates and preserve last confirmed state while
pending. Uncertain writes block further cleanup writes; the manual
**Actuele opruimstatus ophalen** action reads rather than resends a mutation.
Confirmation/recovery refreshes the explorer and preserves selection/filters.
Anonymous creation/photos remain available; expired sessions remove write access.

QA `490c1b01-b0cb-4810-a7cd-e8a0a70669c3` now owns read-only independent
validation. **M6 acceptance is pending.** Earlier passes do not approve M6;
database/AWS, persistence and production acceptance remain excluded.

**Historical browser gate blocker:** QA reported the matching freeze and fresh 251/14
checks passing, but unrelated processes now occupy fixed demo ports 3333/4200.
They will not be accessed/stopped by this team. Independent final-source
browser validation awaits legitimate owner release; isolated passing checks
do not constitute M6 acceptance. Source remains frozen.

QA's blocked window also recorded 118 independent compiled/HTTP assertions
passing, zero real-driver initialization and matching before/after inputs.
The user has since confirmed legitimate owner coordination and port release.
The same QA session is resuming to verify availability and perform the missing
browser checks. **Acceptance remains pending** until those checks and the
final fingerprint/cleanup pass.

**Historical resumption blocker, 2026-10-19:** the prerequisite check found listeners
on 3333 (PID 13236) and 4200 (PID 36636). QA stopped before endpoint access,
browser/service startup or a new source fingerprint check, touching no
processes; window released at 08:18:34.3858701+02:00. **M6 is still BLOCKED.**
The prior 251/14 and 118-assertion results remain dated evidence, not current
source verification or final browser acceptance.

**Approved follow-up:** the user chose configurable isolated demo ports with
the same strict Origin/Host policy. Dev has resumed bounded configuration
changes; the prior freeze/results are historical and must not be used to
approve the changed implementation. Loopback binding and 3333/4200 defaults
stay; invalid/occupied ports must fail explicitly, never silently fall back.
New Dev freeze and fresh independent checks/browser QA are required.

### M6 port-isolation frozen handoff

Dev's replacement **M6 DEMO-READY-FOR-QA** was frozen at
**2026-10-19T08:55:12.6403873+02:00**: **62 inputs**, SHA-256
`3681665d759fada56583c1689babb9249dcf5f571f972869f5a61b98f0c7985e`.
This supersedes the 59-input freeze above. Source writes stopped.

Dev reports 81 targeted tests / 4 files, then uncached **310 tests / 16 files**,
type checks, lint and both builds passing; Node 24.19.0 / Yarn 4.18.1.
It reports 21 Chrome browser assertions through owned 13333/14200 instances,
including shared-account cleanup/reopen, cookies, exact-origin rejection and
file proxying. All owned instances/browser profiles were reportedly stopped.
These are Dev checks, not independent QA approval.

Shared configuration under `libs/runtime` validates defaults/overrides and
derives the strict loopback origin policy used by both auth and cleanup.
Occupied/invalid settings fail explicitly; Vite uses strictPort and preserves
Host on all three proxies. No dependency, database schema or product-behavior
expansion was introduced.

The same independent QA session subsequently verified this **new** identity
below. Earlier 251/14 and 118-assertion results remain historical and are not
counted as acceptance evidence for the replacement implementation.

### M6 independent shared-demo cleanup acceptance

QA `490c1b01-b0cb-4810-a7cd-e8a0a70669c3` published **M6 DEMO-QA-PASS** and
released its final window at **2026-10-19T09:10:14.4537760+02:00**.
The replacement **62-input** SHA-256
`3681665d759fada56583c1689babb9249dcf5f571f972869f5a61b98f0c7985e`
matched independently before execution at 08:59:03.4291648+02:00 and after
all execution/shutdown at 09:10:12.1724958+02:00.

| Independently executed check | Result |
| --- | --- |
| Uncached `corepack yarn check` | Exit 0: **310 tests / 16 files**, both app type checks, lint and production builds; Node 24.19.0 / Yarn 4.18.1. |
| Compiled-code / real HTTP cleanup regressions | **120 assertions passed**: shared-account mark/reopen, idempotence/timestamps, auth/CSRF/expiry, public filters, quota separation, copies, photo preservation and fake PostgreSQL denial. |
| Configuration / startup / policy probes | **64 assertions passed**: default/custom/partial pairs, invalid values/collisions, exact origins, port-80 canonicalization, proxy targets, loopback binding and occupied-owned-port failure without fallback. |
| Actual final-source Chrome via isolated Vite | **49 assertions passed** in one complete run on owned 13333/14200 instances. |
| Driver isolation | **Zero real-driver initialization calls**; PostgreSQL checks used fakes only. |

Counts are tracked assertions, not distinct test-case totals; they include
repeated denials and grouped checks. They do not add Dev or earlier blocked
window counts. No blocking M6 defect remained.

Browser evidence covered anonymous status/no write controls, two cookie
accounts updating the same report, rejected foreign/unused-default origins,
confirmed status while pending, duplicate suppression and a genuinely
committed-but-lost response. Manual read failure retained the uncertainty
barrier; successful read reconciled state without resending a mutation and
preserved filters, selection and markers.

Controlled stale polling could not overwrite the confirmed state. Pending
filter reads disabled stale actions; a concurrent create completion did not
steal cleanup selection. Real session revocation removed cleanup controls and
reset sign-in UI. Anonymous no-photo/photo creation, decoded PNG, duplicate
upload/create protection and cleaning an anonymously created photo report
passed. At 390px there was no horizontal overflow; zero attempted external
page origins, page exceptions or unexpected interception errors were recorded.

Exact expiry used controlled clocks, not a literal 30-minute browser wait.
Polling used the existing callback under control, not a literal minute wait.
One Chrome/Vite development-proxy run is not cross-browser, deployment/TLS,
formal accessibility/security or production reverse-proxy acceptance. New
browser decoding covered PNG only, not fresh JPEG/WebP validation.

All owned API/Vite/Chrome/probe resources were stopped and profiles removed;
owned listeners/PIDs were verified absent before the final fingerprint.
Unrelated/default-port services were never accessed or stopped. QA changed no
implementation/docs and installed nothing. No database, SQL/migration, AWS,
real identity service, legacy or production access occurred.

**M6 acceptance is temporary shared-demo cleanup and isolated-loopback
configuration only.** It does not approve persistent cleanup, ownership,
legacy cleanup events/history, edits/deletes, production security, deployment
or another slice. Real PostgreSQL integration remains separately unapproved.

### M7 historical original clustering handoff

UI Specialist Dev `b5db624f-591b-4e16-b590-cd630ee75402` published
**M7 DEMO-READY-FOR-QA** at **2026-10-19T21:17:26.1590813+02:00**.
Frozen implementation: **65 inputs**, SHA-256
`f7af7114e603d553a5f3ff10c2b96f8f0a9a62dcac4c58e00fec1ebb57d2eb0c`
using the established manifest algorithm. Source writes stopped.

Dev reports 73 targeted tests / 4 files, then uncached **337 tests / 18 files**,
both type checks, lint and builds passing under Node 24.19.0 / Yarn 4.18.1.
Its complete final-source Chrome run passed 50 assertions using real owned
Vite/API on 14200/13333. No dependencies were added; only seven web files
changed. These are Dev checks, not independent approval.

The existing local Leaflet map groups current filtered reports by 56px
fixed-seed distance at the current zoom, deterministically sorted by ID.
This nontransitive, bounded O(n squared) scan fits the demo's 104-report cap;
it is not DBSCAN or a geography/performance guarantee. Cluster activation
zooms where useful and opens a member chooser; colocated reports stay
accessible at maximum zoom 18. Counts represent reports, including cleaned
reports, not cleanup totals.

Native Enter/Space buttons expose member selection, selected ID/status and
visible focus. The complete report list remains available. Poll/status reads
preserve pan/zoom; explicit changed filters fit current confirmed data.
Pending/uncertain cleanup locks cover map clusters/singles/chooser/list/filter
selection. No tiles/fonts/assets, geometry dataset, service worker or remote
map provider were introduced.

Independent QA `8c99ac7d-00ca-47ac-a1e0-0858f141b9d1` now owns the read-only
validation window. **M7 acceptance is pending.** Earlier M2-M6 evidence does
not approve this implementation or establish full accessibility, multi-browser,
geography, PWA/offline, database/AWS or production acceptance.

### M7 historical independent failure and correction

QA released **M7 DEMO-QA-FAIL** at
**2026-10-19T21:34:04.0937489+02:00** on the matching 65-input freeze above.
Fresh 337 tests / 18 files, type checks, lint and builds passed, plus 122
tracked independent assertions (60 algorithm and 62 browser/integration/
lifecycle/isolation). These do not outweigh the blocking keyboard defect.

**M7-QA-1:** automatic polling disables the focused chooser member button,
moving focus to BODY. After the real read succeeds, the same connected button
is enabled but focus is still lost. Pan/zoom remain preserved. This was
reproduced in actual Chrome with the real App/API, not merely a DOM hypothesis.

Dev may now correct this same-slice defect, keeping stale-read and cleanup
locks intact and avoiding focus theft after deliberate user navigation.
A new freeze, integrated regression and independent browser revalidation are
required. QA changed no source/docs and stopped all owned resources.
**M7 is not accepted; correction is in progress.**

### M7 replacement focus-correction handoff

Replacement **M7 DEMO-READY-FOR-QA** was frozen at
**2026-10-19T21:54:02.4777413+02:00**: **65 inputs**, SHA-256
`09db58f13d207057c5307a486ca57a7addc95883a93897ac58e2bf0c4a67e58b`.
This supersedes the original failed identity, without erasing its failure.
Implementation writes stopped.

Read-unavailable controls retain focus using aria-disabled plus real guarded
activation; the report list remains mounted during refresh. No automatic
refocusing overrides deliberate user navigation. Stale/filter/cleanup
uncertainty guards remain in force. Six web files changed; no dependencies,
API, grouping algorithm, useExplorer or root configuration changed.

Dev reports 82 targeted tests / 4 files, then uncached **346 tests / 18 files**,
type checks, lint and builds passing, plus **114 tracked Chrome assertions**
over held-read focus, inert blocked controls, Tab/click-away, pan/zoom and
cleanup/filter barriers. Counts are Dev verification, not independent QA.

The same QA session subsequently verified this replacement below, including
the actual App/API poll pending/settled scenario.

### M7 independent local-clustering acceptance

QA `8c99ac7d-00ca-47ac-a1e0-0858f141b9d1` published replacement
**M7 DEMO-QA-PASS**, released **2026-10-19T22:03:52.5284184+02:00**.
All **65 inputs**, SHA-256
`09db58f13d207057c5307a486ca57a7addc95883a93897ac58e2bf0c4a67e58b`,
matched independently before fresh execution at 21:57:32.8094517+02:00 and
after shutdown at 22:03:52.5114338+02:00. The original failed identity is not
accepted or relabelled by this replacement verdict.

| Independently executed check | Result |
| --- | --- |
| Uncached `corepack yarn check` | Exit 0: **346 tests / 18 files**, both app type checks, lint and production builds; Node 24.19.0 / Yarn 4.18.1. |
| Independent algorithm/browser probes | **218 tracked assertions passed**: 60 algorithm and 158 browser/integration/lifecycle/isolation assertions, zero recorded defects. |
| Original focus failure, actual App/API | **10 polling/focus journeys passed**, including chooser, cluster, singleton, list, cleanup read/write, Tab-away, click-away, failed read/retry and 390px chooser. |
| Cluster/regression behavior | Exact membership/counts, 56px boundary, deterministic grouping, max-zoom colocated members, actual keyboard/mouse selection, filters, cleanup recovery and real anonymous no-photo/PNG creation passed. |

Counts include repeated/grouped checks, not 218 distinct scenarios or extra
Vitest tests, and do not add Dev or original failed-phase counts.

The precise original reproduction now retains the same connected focused
chooser before, during and after a genuine held explorer response: native
disabled remains false; aria-disabled changes false/true/false. Pan/zoom remain
exactly unchanged. Equivalent checks passed for other report/cleanup controls.
Native Enter/Space, pointer and programmatic blocked activation produced no
selection, reveal, recenter, read or mutation beyond the intended poll.

Deliberate Tab/click-away remained respected after completion; failed reads,
retry and filter/membership changes did not forcibly restore old focus.
Pending/uncertain cleanup barriers still blocked actions; successful manual
status read reconciled without mutation retry. Real PNG upload/display,
colocated additions, 24 zoom activations, repeated filter cycles, 44px targets
and visible keyboard focus passed. Supplemental actual-map synthetic fixtures
covered empty/add/remove/status/geometry and unmount/remount separately.
Zero page exceptions, unexpected interception errors or attempted external
page origins were recorded.

All owned API/Vite/Chrome/profile/debug resources were stopped and verified
absent before the final hash. QA changed no source/docs and installed nothing;
no unrelated/default-port service, legacy, database/driver/SQL/migration,
AWS, real identity or production access occurred.

Acceptance is **bounded local-demo clustering and focus/selection/read
lifecycle behavior**, not formal WCAG/security, multi-browser, geography,
performance, PWA/offline, persistence or deployment approval. Polls used the
existing controlled callback with genuine HTTP, not a literal minute wait.
Fresh browser PNG evidence does not imply JPEG/WebP, geolocation or full
auth-expiry/capacity matrix reruns. No next-slice permission is implied.
