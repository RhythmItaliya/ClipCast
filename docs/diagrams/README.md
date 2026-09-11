# ClipCast — formal system diagrams

Standard software-engineering diagram set for ClipCast, one file per type.
Open any of them at [excalidraw.com](https://excalidraw.com) → menu → **Open**
(or drag the file in).

| # | Diagram | What it shows |
|---|---|---|
| 01 | [Use Case Diagram](01-use-case-diagram.excalidraw) | Every actor (Visitor, User, Admin, Stripe, Modal, YouTube, Google/Discord) and the use cases they perform, with `<<include>>` relationships between use cases. |
| 02 | [System Architecture Diagram](02-system-architecture-diagram.excalidraw) | Layered view — presentation, application, integration, and data layers — and how they connect. |
| 03 | [Flowchart](03-flowchart.excalidraw) | Standard start/end/process/decision flowchart for "submit a video, get clips back," including both gate-rejection and render-failure paths. |
| 04 | [Activity Diagram](04-activity-diagram.excalidraw) | The same journey as a UML activity diagram, in swimlanes (User / Frontend / Queue / Backend). |
| 05 | [Sequence Diagram](05-sequence-diagram.excalidraw) | Lifelines for every component (User, Frontend, Database, Inngest, Downloader, Processor, S3) with numbered, time-ordered messages. |
| 06 | [Class Diagram](06-class-diagram.excalidraw) | The Prisma models as UML classes, with attributes and relationship cardinalities. |
| 07 | [ER Diagram](07-er-diagram.excalidraw) | The same data model as a database ER diagram — PK/FK annotated entities. |
| 08 | [DFD — Level 0 (Context)](08-dfd-level0-context.excalidraw) | The whole system as a single process, with every external entity it exchanges data with. |
| 09 | [DFD — Level 1](09-dfd-level1.excalidraw) | Process 0 decomposed into its 5 major sub-processes and their data stores. |

## Regenerating

Every file here is produced by [`generate_diagrams.py`](generate_diagrams.py)
from the architecture (TanStack data layer, credit ledger, email OTP, caption
pills, Any/All clip modes, daily auto-clip cron). When the system changes, edit
the specs in that script and re-run:

    python3 docs/diagrams/generate_diagrams.py

> **Note:** the current diagram set focuses on the clip pipeline and billing. It
> does not yet depict the **Audio Studio** (docs/14–16, 19), the **multi-agent
> production crew** (docs/17–18), or the multi-LLM provider switch (DeepSeek /
> Gemini / Claude) — update the script's specs and regenerate to add them.

## How these relate to the other docs folders

- [`../excalidraw/`](../excalidraw/) has informal architecture/flow diagrams
  built during development (system design, pipeline overview, credits,
  video processing, YouTube ingestion) — freer-form, more implementation
  detail per box.
- This folder (`diagrams/`) is the formal, standard diagram set — the types
  typically required for project documentation/submission (use case, class,
  ER, DFD, etc.), each following that diagram type's own notation.
- [`../*.md`](../00-overview.md) is the prose walkthrough with real code —
  read that for *how* to build each piece; these diagrams are the *shape* of
  the system at a glance.

All diagrams here are generated from a small script (not hand-drawn) so they
stay easy to regenerate as the system changes.
