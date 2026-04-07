# Annual Audit Plan Backend Blueprint

## Goal
Build a backend structure that can support a document-style annual audit plan like the sample you shared while still fitting the current KovaPage backend patterns.

The backend should support:
- annual planning narratives and risk methodology text
- grouped plan sections such as branch audit, head office audit, subsidiaries, risk audit, QA, IT audit, investigation, anti-fraud, and similar groups
- quarter-by-quarter planning rows with yearly totals
- approval workflow for QA, CAE, and board-level signoff
- dashboard-friendly APIs for planning, review, approval, and export
- Word/PDF-ready export payloads

## Recommendation
Use a dedicated `AnnualAuditPlan` entity instead of forcing everything into `AuditPlan.metadata`.

Reason:
- the current `AuditPlan` model is good for operational audit plans and APM workflows
- the sample annual plan is a document-level artifact with sections, narrative, summaries, approvals, and many rows
- keeping it separate will make exports, dashboard APIs, and future approval stages cleaner

## Proposed Core Model
Create a new model: `AnnualAuditPlan`

Suggested fields:
- `id`: UUID primary key
- `planNumber`: string, unique
- `title`: string
- `year`: integer
- `status`: enum
  values: `draft`, `under_review`, `qa_approved`, `cae_approved`, `board_pending`, `board_approved`, `published`, `archived`
- `scope`: string or text
- `executiveSummary`: text
- `riskMethodology`: text
- `assumptions`: text
- `changeControlNotes`: text
- `approvalNotes`: text
- `version`: integer
- `currency`: string
- `createdBy`: UUID -> users.id
- `updatedBy`: UUID -> users.id
- `approvedBy`: UUID -> users.id
- `approvedAt`: date
- `publishedAt`: date
- `metadata`: JSONB

Suggested metadata content:
- `sourceRiskAssessmentSummary`
- `documentSettings`
- `boardApproval`
- `exportHistory`
- `workflowHistory`
- `dashboardTags`

## Proposed Child Structure
Use JSONB for section content at first, then normalize later only if needed.

Recommended section payload shape:

```json
{
  "sections": [
    {
      "id": "branch-audit",
      "title": "Branch Audit",
      "order": 1,
      "description": "Optional section intro",
      "rows": [
        {
          "id": "row-1",
          "unit": "Internal Audit Group",
          "subUnit": null,
          "riskRating": "High",
          "frequency": "Quarterly",
          "q1": 149,
          "q2": 184,
          "q3": 181,
          "q4": 137,
          "total": 651,
          "notes": null,
          "sourceRiskAssessmentId": null,
          "sourceAuditPlanIds": []
        }
      ],
      "totals": {
        "q1": 152,
        "q2": 187,
        "q3": 183,
        "q4": 139,
        "total": 661
      }
    }
  ]
}
```

## Why JSONB Sections First
JSONB is the fastest path because:
- your codebase already uses JSONB heavily
- the sample document is highly document-shaped
- dashboards can still consume section arrays cleanly
- export generation becomes easier because the stored structure already resembles the final document

Later, if needed, sections and rows can be normalized into:
- `annual_audit_plan_sections`
- `annual_audit_plan_rows`

## Supporting Tables To Consider Later
These are optional for phase 2, not required on day 1.

### `annual_audit_plan_approvals`
Useful if you want multi-stage signoff history.

Fields:
- `id`
- `annualAuditPlanId`
- `stage`
- `decision`
- `decisionBy`
- `decisionAt`
- `comments`

### `annual_audit_plan_exports`
Useful for document download history.

Fields:
- `id`
- `annualAuditPlanId`
- `format`
- `fileUrl`
- `generatedBy`
- `generatedAt`
- `version`

## Status Workflow
Recommended workflow:
- `draft`
- `under_review`
- `qa_approved`
- `cae_approved`
- `board_pending`
- `board_approved`
- `published`
- `archived`

Suggested meaning:
- `draft`: editable by planning owners
- `under_review`: submitted for QA or management review
- `qa_approved`: quality assurance validated content
- `cae_approved`: chief audit executive approved internal plan version
- `board_pending`: awaiting board audit committee decision
- `board_approved`: approved for official use
- `published`: visible to downstream dashboards or execution modules
- `archived`: retained historical version

## Relationship With Existing Models
### `RiskAssessment`
Annual plans should be able to reference risk outputs.

Use cases:
- section rows can store source risk references
- annual plan summary can store aggregated risk narrative
- auto-schedule logic can help prefill quarterly plans

### `AuditPlan`
Operational and unit-level audit plans should remain separate.

Recommended linkage:
- annual plan rows can store `sourceAuditPlanIds`
- annual plan generation can pull from approved unit plans and QA consolidated plans
- published annual plans can feed execution planning later

### `Notification`
Use notifications for:
- submission for review
- approval or rejection
- board review readiness
- publication

## Endpoint Blueprint
Recommended new route file:
- `routes/annualAuditPlan.js`

Recommended mount path:
- `/api/annual-audit-plans`

### Core CRUD
- `POST /api/annual-audit-plans`
  create a new annual audit plan
- `GET /api/annual-audit-plans`
  list plans with filters: year, status, version, createdBy
- `GET /api/annual-audit-plans/:id`
  fetch one full annual plan
- `PUT /api/annual-audit-plans/:id`
  update editable fields while draft or rejected
- `DELETE /api/annual-audit-plans/:id`
  delete draft-only records

### Section Editing
- `PUT /api/annual-audit-plans/:id/sections`
  replace all sections
- `POST /api/annual-audit-plans/:id/sections/:sectionId/rows`
  add row to a section
- `PUT /api/annual-audit-plans/:id/sections/:sectionId/rows/:rowId`
  update one planning row
- `DELETE /api/annual-audit-plans/:id/sections/:sectionId/rows/:rowId`
  remove one row

### Workflow
- `POST /api/annual-audit-plans/:id/submit`
- `POST /api/annual-audit-plans/:id/qa-approve`
- `POST /api/annual-audit-plans/:id/qa-reject`
- `POST /api/annual-audit-plans/:id/cae-approve`
- `POST /api/annual-audit-plans/:id/cae-reject`
- `POST /api/annual-audit-plans/:id/board-submit`
- `POST /api/annual-audit-plans/:id/board-approve`
- `POST /api/annual-audit-plans/:id/board-reject`
- `POST /api/annual-audit-plans/:id/publish`

### Generation Helpers
- `POST /api/annual-audit-plans/generate-from-risk`
  seed sections from risk assessment and historical planning data
- `POST /api/annual-audit-plans/:id/recalculate-totals`
  recompute section and plan totals
- `GET /api/annual-audit-plans/:id/summary`
  dashboard-friendly summary payload

### Export
- `GET /api/annual-audit-plans/:id/export/pdf`
- `GET /api/annual-audit-plans/:id/export/docx`
- `GET /api/annual-audit-plans/:id/export/json`

## Role Access Recommendation
### Quality Assurance
Can:
- create annual plans
- edit draft plans
- submit for approval
- view all plans
- export draft versions

### Unit Head
Can:
- contribute feeder data through existing APM and risk endpoints
- view annual plan summary where relevant
- not directly approve the master annual plan unless business rules require it

### Chief Audit Executive
Can:
- review all annual plans
- approve or reject
- submit to board stage
- publish approved plans

### BAC Secretariat or Board Support
Can:
- view board-pending plans
- update meeting/board metadata
- record board decision

## Dashboard Data Needed Later
When you share dashboard screenshots, we should map them to these backend response shapes:
- annual plan summary cards
- section totals by quarter
- approval queue
- pending reviews
- published plan list by year
- export history
- revision history
- source risk concentration

Recommended summary payload:

```json
{
  "id": "uuid",
  "year": 2025,
  "status": "cae_approved",
  "version": 3,
  "summary": {
    "sections": 8,
    "units": 74,
    "q1Total": 172,
    "q2Total": 198,
    "q3Total": 194,
    "q4Total": 165,
    "yearTotal": 729
  },
  "approvals": {
    "qaApprovedAt": null,
    "caeApprovedAt": null,
    "boardApprovedAt": null
  }
}
```

## Export Strategy
### PDF
Use the same Puppeteer pattern already in the repo.

### DOCX
Best approach later:
- build a document template generator with a structured payload
- either generate with a DOCX templating library or render to HTML then convert if acceptable

### Recommendation
Phase 1 export targets:
- JSON
- PDF

Phase 2:
- DOCX matching the sample more closely

## Suggested Build Phases
### Phase 1
- add `AnnualAuditPlan` model
- add CRUD endpoints
- add section JSONB structure
- add submit and approval workflow
- add JSON and PDF export

### Phase 2
- auto-generate rows from risk assessments and approved plans
- approval history table
- export history table
- dashboard summary endpoints

### Phase 3
- DOCX export
- board meeting integration
- version compare and audit trail
- richer dashboard widgets from your screenshots

## Minimal First Schema If You Want To Move Fast
If you want the fastest implementation, the first model can be:
- `planNumber`
- `title`
- `year`
- `status`
- `executiveSummary`
- `riskMethodology`
- `sections` in `metadata.sections`
- `createdBy`
- `approvedBy`
- `approvedAt`

That is enough to start building APIs and exports without over-modeling too early.

## Best Fit For This Repo
For this codebase, the best balance is:
- new model: `AnnualAuditPlan`
- use JSONB for sections and document content
- keep current `AuditPlan` for operational planning and APM flows
- expose a dedicated annual-plan route namespace
- later connect dashboards and risk-derived generation logic on top

## Next Recommended Step
The next concrete step should be to implement:
1. `models/AnnualAuditPlan.js`
2. `routes/annualAuditPlan.js`
3. server route mounting
4. basic CRUD + submit/approve endpoints
5. one PDF export endpoint

After that, we can adapt it when you share the dashboard screenshots.
