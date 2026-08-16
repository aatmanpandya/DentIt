# DentalPMS

A dental practice management system for clinics, built India-first (cash-pay, GST) with later
expansion to insurance-driven markets. Clinical charting quality — particularly periodontal
charting — is the intended differentiator.

## Language

### Practice structure

**Organization**:
A tenant. One dental business, which may run several physical sites.
_Avoid_: Account, tenant, practice, company

**Location**:
A physical site belonging to an Organization, where appointments happen.
_Avoid_: Branch, clinic, office, site

**Operatory**:
A single treatment room at a Location, schedulable as one resource.
_Avoid_: Chair, room, surgery, op

**Provider**:
A User who delivers treatment and can be booked — dentist or hygienist.
_Avoid_: Doctor, dentist, practitioner, clinician

### People

**Patient**:
A person receiving care. Identity only — never the payer role.
_Avoid_: Client, customer

**Responsible Party**:
The person financially liable for a Patient's charges. Often the Patient, but not always
(a parent, a spouse). Kept distinct so a minor's ledger has an unambiguous payer.
_Avoid_: Guarantor, payer, account holder

### Clinical

**Tooth Notation**:
The scheme used to name teeth. Stored canonically as FDI two-digit; rendered as FDI or
Universal per Organization preference. Storage never changes; only rendering does.
_Avoid_: Tooth numbering, tooth code

**Charted Procedure**:
A single treatment on a specific tooth and surfaces, at a point in its lifecycle
(planned → accepted → scheduled → completed → invoiced). The one source of truth shared by
the Odontogram, Treatment Plan, and ledger — never duplicated into any of them.
_Avoid_: Treatment, procedure, service, line item

**Charted Condition**:
An observed clinical finding on a tooth (caries, fracture, missing). A finding, not work done.
_Avoid_: Diagnosis, finding, issue

**Odontogram**:
The interactive whole-mouth tooth chart showing Charted Conditions and Charted Procedures.
_Avoid_: Tooth chart, dental chart, chart

**Perio Exam**:
One periodontal examination of a Patient at a point in time, containing measurements for each
examined tooth.
_Avoid_: Perio chart, periodontal assessment, probing

**Perio Site**:
One of six probing positions on a tooth — `MB, B, DB` on the buccal aspect, `ML, L, DL` on the
lingual.
_Avoid_: Point, position, location, probe site

**Perio Measurement**:
One reading at one Perio Site within a Perio Exam — pocket depth, gingival margin, bleeding,
suppuration. Mobility and furcation are per-tooth, not per-site. Stored per site so per-site
history is answerable.
_Avoid_: Probing depth, reading, measurement

**Procedure Code**:
A catalogue entry naming a billable treatment, its clinical scope (mouth, arch, quadrant, tooth,
surface) and its Tax Class. A definition; a Charted Procedure is an instance of one.
_Avoid_: Code, service code, treatment code, CDT code

**Treatment Plan**:
An ordered proposal of Charted Procedures presented to a Patient for acceptance, optionally
split into phases. References Charted Procedures; does not own them.
_Avoid_: Case, proposal, quote, estimate

### Commercial

**Billing Adapter**:
The market-specific implementation of pricing, coverage estimation, and tax. `SelfPayAdapter`
(India, cash-pay + GST) is the only one built; insurance markets plug in later.
_Avoid_: Billing engine, pricing module

**Fee Schedule**:
The effective-dated set of prices an Organization charges for Procedure Codes, optionally
scoped to one Location.
_Avoid_: Price list, rate card, tariff

**Tax Class**:
The tax treatment attached to a Procedure Code — `exempt_healthcare`, `gst_5`, or `gst_18`.
A property of the code, never of an invoice, because a single invoice can mix all three.
_Avoid_: GST rate, tax rate, tax category

**Deployment Target**:
Where an Organization's database lives — `cloud` (hosted by us) or `onsite` (the clinic's own
hardware). One codebase, two targets. An install is wholly one or the other; data does not
move between them and there is no offline sync.
_Avoid_: Hosting mode, on-prem, deployment type, self-hosted
