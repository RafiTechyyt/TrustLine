# TrustLine

Anonymous complaint and issue reporting for colleges.

Anyone connected to a college — a student, a hostel resident, a parent, a
contract worker, a member of staff — can file a report without an account and
without leaving a name. The report is routed to the department that can actually
fix it, the person who filed it can follow it and reply using a trace code that
is shown to them once, and the college's own numbers are published whether or
not they are flattering.

It runs on a laptop with no database, no build step and no internet connection.
`npm start` and it is up.

## Running it

Node 18 or newer. Express is already vendored in `node_modules/`, so there is
nothing to install and `npm install` is not needed.

```
npm run seed     # builds three colleges of demo data (about 4 seconds)
npm start        # http://localhost:3000
```

The seeder prints every login and a handful of trace codes to try. It empties
the data directory first, so run it whenever the demo has been walked over.

| Command | What it does |
| --- | --- |
| `npm start` | Serves both surfaces and the API on port 3000 |
| `npm run seed` | Rebuilds `data/` — 3 colleges, 12 accounts, 68 reports, 290 messages |
| `npm run smoke` | 33 assertions against the service layer, no HTTP |
| `npm run api-test` | 47 assertions against a live server, including the privacy guarantees |

Environment variables, all optional: `PORT`, `TRUSTLINE_DATA_DIR`,
`TRUSTLINE_SECRET` (sessions survive a restart if you set it),
`TRUSTLINE_SESSION_HOURS`, `TRUSTLINE_OWNER_EMAIL`, `TRUSTLINE_OWNER_PASSWORD`.

## The three surfaces

**The public site** at `/` is where a report is filed and followed. No login
exists for a reporter, by design. `/c/cep` is a college's own page: its report
form, its public register, its notices and its response times.

**The staff console** at `/ops` is a separate document with its own stylesheet,
so a reporter never downloads the desk UI and the two surfaces are free to look
nothing alike. A department officer sees only the desks they hold. A college
admin sees the whole college, the routing table, the team and the numbers.

**The platform office**, also at `/ops`, approves colleges and admins. It cannot
open a report, and there is no route that would serve it one — `SuperAdmin.canRead()`
returns false unconditionally, so the refusal is a property of the account class
rather than a check someone has to remember to write.

Demo logins after seeding:

```
owner@trustline.app        trustline-owner        platform office
anitha.menon@cep.ac.in     perumon-admin-2026     admin, CEP
ramesh.pillai@cep.ac.in    hostel-desk-2026       officer, hostel desk only
suresh.babu@gecbh.ac.in    bartonhill-admin-2026  admin, a second college
```

## How a report moves

Someone opens `/c/cep`, writes what happened, and picks who they are — a
student, staff, a parent, an alumnus, a visitor, or nobody in particular. Before
they submit, the moderation scanner reads the draft back to them and points at
anything that identifies them: their own name, a phone number, a room number.
It masks the sample in its own warning, because a scanner that echoes the leak
back has not helped.

They choose whether the report appears on the public register, and whether to
hand over a contact detail. Handing one over is a separate decision from filing,
and seeing it later needs a separate permission (`reports.contact.view`) from
reading the report.

Filing returns a trace code — `TL-XXXX-XXXX` — and that is the only time it is
ever shown. The code is a credential, not an identifier, so it never appears in
a query string: the passphrase travels in an `x-trace-pass` header and the
browser keeps the code in the URL fragment, which is not sent to the server.

Routing runs four strategies in order and stops at the first that decides:
wording that indicates danger goes straight to a safety desk, then the
category's own rule, then keyword matches against each desk, and if nothing
matches at all, the desk with the lightest open load. Every report records which
strategy chose it, which is why the analytics screen can warn an admin when too
many reports fell through to the last one — that share is a measure of how badly
the routing table is configured.

From there the report walks a state machine: nine states, each its own class,
each deciding for itself which moves are legal and what the reporter is allowed
to see. Response windows come from the category or the desk, and the clock stops
while a report is waiting on the reporter rather than on the college — a report
cannot be late because the person who filed it hasn't replied yet.

## Layout

```
server.js              boot and graceful shutdown
src/
  config.js            the only file that reads process.env
  core/                the domain — no HTTP, no storage, no framework
    accounts/          Account and its three role subclasses, plus permissions
    reporters/         Reporter and its six subclasses
    status/            nine ComplaintState classes
    routing/           four routing strategies behind one interface
    priority/          the floor a reporter's situation sets
    events/            EventBus
  repositories/        JsonStore and one repository per entity
  services/            the use cases; subscribers.js wires the observers
  security/            rate limiting on a rotating salt
  http/                Express: app, middleware, respond helpers, eight route modules
public/
  index.html           the public site
  ops.html             the staff console
  assets/
    base.css           paper — the surface a reporter sees
    ops.css            carbon — redefines every token, so components reskin
    ui.js              the shared element builder, router, formatters, overlays
    app.js             the public app
    ops.js             the staff console
    charts.js          canvas charts, because the CSP allows no third-party script
scripts/
  seed.js              the demo data
  smoke.js             service-layer assertions
  api-test.js          HTTP assertions against a real server
data/                  the JSON store, rebuilt by the seeder
```

About 16,000 lines across 81 source files.

## The object model

The project is an OOP exercise and the patterns are load-bearing rather than
decorative. Every one of them is doing a job the procedural alternative would
have done worse.

`Entity` is the base every stored object extends. `Account` extends it and is
extended in turn by `SuperAdmin`, `CollegeAdmin` and `DepartmentOfficer`, each
holding its own frozen permission set and its own `canRead()`. Route handlers
ask `account.can(P.REPORTS_STATUS_WRITE)` and never test the role, so a fourth
kind of account is one new subclass rather than a search through the codebase
for `role === "admin"`.

`Reporter` has six subclasses, and the choice of subclass is what sets the
priority floor a desk cannot go under. A parent reporting a safety matter does
not get quietly moved down to low priority, because the floor is a property of
the report, not a desk preference.

The **state pattern** carries the complaint lifecycle: nine `ComplaintState`
classes, each answering for itself what it permits and what the reporter sees.
The **strategy pattern** carries routing, composed so the four strategies run in
order behind one interface. **Repositories** put every entity behind the same
small API, so the JSON store could become SQL without the services noticing.
The **observer pattern** carries the audit trail, the live feed and the event
counters: those three subscribe to an `EventBus`, and no service knows they
exist — one of the smoke tests asserts exactly that. A **factory** builds the
right `Account` subclass from a stored row, and the **template method** in
`Repository` gives every repository its shared read and write behaviour.

Fields are private with `#`, so the invariants each class defends cannot be
walked around from outside.

## Privacy, and what it cost

Anonymity is only real if it holds when it is inconvenient, so a few things are
deliberately harder than they needed to be.

No IP address is stored anywhere. Rate limiting works against a salt that
rotates, so the same visitor is unrecognisable across windows and the limiter
cannot double as a log. Internal notes are filtered out inside the repository
rather than in a view, so a note cannot leak through a projection nobody thought
to check. Reporter actions land in the audit log with no actor at all — the
writer labels them "TrustLine" — which is what makes the log safe for an admin
to read without it becoming a way to work out who filed what. Every `/api`
response is `no-store` and `Referrer-Policy` is `no-referrer`, because a cached
trace response and a leaked referrer are both leaked reports. `/api/health`
answers liveness only; the store counts and the listener table sit behind
`platform.metrics.read` at `/api/platform/status`.

Evidence is described, never uploaded. Every evidence item carries
`storedAs: null` and always will. A photograph of a hostel corridor carries
EXIF, a filename carries a device's naming convention, and neither is worth the
risk to a system whose only promise is that the person filing cannot be found.

Passwords are scrypt. Sessions are HMAC-SHA256 tokens signed in `src/lib/crypto.js`
against a secret that is generated at boot unless you set one. The
Content-Security-Policy is `'self'` only, which is why there is no CDN anywhere
in the front end and why the charts are drawn by hand on a canvas.

## Tests

`npm run smoke` exercises the services directly — routing decisions, the state
machine's refusals, the priority floor, the SLA clock pausing, the observers
running without any service knowing about them, and the whole store surviving a
restart from disk.

`npm run api-test` boots a real server on a temporary data directory and walks
it over HTTP: a college registering and being approved, an officer confined to
their desks, a reporter's thread, a merge, an escalation, the sweep. Several
steps exist to catch a privacy regression rather than a functional one — that
the platform office is refused a report body through every route it has, that
the moderation scanner does not echo an unmasked phone number, that a preview
writes nothing, and that signing out actually detaches the session.

Both suites are assertions, not snapshots. They fail with a sentence describing
what the product got wrong.
