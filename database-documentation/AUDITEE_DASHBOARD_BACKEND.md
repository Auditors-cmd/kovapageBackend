# Auditee Dashboard Backend Blueprint

## Screen Goal
Support an auditee-facing dashboard where the logged-in auditee can:
- see document requests assigned to them
- know who requested each item
- see request status
- upload requested governance/supporting documents
- receive reminders and review feedback

This blueprint is based on the dashboard screenshot showing:
- document name
- requested by
- status
- upload action

## What This Screen Represents
This is not just a generic notification list.
It is a structured `document request` workflow between audit staff and the auditee.

A clean backend model should support:
- one request per required document or evidence item
- optional grouping under an audit engagement or audit plan
- upload and re-upload flow
- reviewer feedback
- due dates and reminders
- dashboard summary counts for pending, submitted, overdue, and reviewed items

## Recommended Core Entity
Create a new model: `DocumentRequest`

This model should represent a single auditee-facing request for a document.

## Proposed `DocumentRequest` Fields
- `id`: UUID primary key
- `requestNumber`: string, unique
- `title`: string
  example: `Risk Management Policy v2`
- `description`: text
  guidance or request details
- `category`: string
  example: `governance`, `financial`, `compliance`, `evidence`, `policy`
- `status`: enum
  values:
  - `pending_upload`
  - `uploaded`
  - `under_review`
  - `approved`
  - `rejected`
  - `overdue`
  - `cancelled`
- `priority`: enum
  values: `low`, `medium`, `high`, `critical`
- `requestedBy`: UUID -> users.id
- `assignedTo`: UUID -> users.id
  the auditee user
- `auditPlanId`: UUID -> audit_plans.id, nullable
- `annualAuditPlanId`: UUID -> annual audit plan entity, nullable
- `department`: string
- `requestedAt`: date
- `dueDate`: date
- `submittedAt`: date
- `reviewedAt`: date
- `reviewedBy`: UUID -> users.id
- `reviewComments`: text
- `isReuploadRequired`: boolean
- `reuploadCount`: integer
- `metadata`: JSONB

## Proposed File Attachment Fields
You have two options.

### Option A: Single file on the request
Fastest for version 1.

Add fields directly on `DocumentRequest`:
- `fileName`
- `originalFileName`
- `fileUrl`
- `fileSize`
- `mimeType`
- `cloudinaryPublicId`

Use this if each request only needs one active uploaded document.

### Option B: Separate upload history table
Better long-term design.

Create `DocumentRequestSubmission`:
- `id`
- `documentRequestId`
- `submittedBy`
- `fileName`
- `originalFileName`
- `fileUrl`
- `fileSize`
- `mimeType`
- `cloudinaryPublicId`
- `submittedAt`
- `comments`
- `versionNumber`
- `status`
  values: `uploaded`, `replaced`, `accepted`, `rejected`

Recommendation:
- phase 1: use single-file fields on `DocumentRequest`
- phase 2: add `DocumentRequestSubmission` if you want history and audit trail

## Why This Needs Its Own Model
Do not store this only in `Notification.metadata`.

Reason:
- notifications are good for alerts, not business state
- the dashboard rows need stable records with statuses and timestamps
- uploads, approvals, and rejections need structured querying
- reminders and overdue logic should work off a dedicated entity

## Relationship With Existing Models
### `User`
- `requestedBy` links to requester
- `assignedTo` links to auditee
- `reviewedBy` links to reviewer

### `Notification`
Use notifications as side effects, not the source of truth.

Example notification triggers:
- document request assigned to auditee
- reminder before due date
- auditee uploaded a document
- reviewer rejected upload and asked for re-upload
- reviewer approved submission

### `AuditPlan`
Optional link if the request belongs to an existing operational audit plan.

### `AnnualAuditPlan`
Optional future link if a request is tied to annual planning or annual plan evidence.

## Recommended Status Logic
### `pending_upload`
- request created
- no submission yet
- auditee sees upload button

### `uploaded`
- file submitted by auditee
- waiting for reviewer action or auto-transition to `under_review`

### `under_review`
- reviewer opened or is processing the file

### `approved`
- submission accepted
- request completed

### `rejected`
- submission was rejected
- auditee should see reason and upload again
- UI can still show upload action

### `overdue`
- due date passed and no valid approved submission exists
- can be computed dynamically or persisted by a job

### `cancelled`
- request withdrawn by requester or admin

## Suggested Business Rules
- only the assigned auditee can upload for their request
- only authorized audit staff can create requests
- only requester, QA, team lead, unit head, or CAE can review depending on your workflow
- approved requests become read-only unless explicitly reopened
- rejected requests must store review comments
- overdue should be recalculated whenever listing dashboard items or by scheduled task

## Suggested Upload Rules
Since you already use Cloudinary for raw files in `middleware/upload.js`, create a separate upload middleware for auditee documents.

Recommended new fieldname:
- `documentFile`

Recommended allowed file types:
- `.pdf`
- `.doc`
- `.docx`
- `.xls`
- `.xlsx`
- `.csv`
- `.ppt`
- `.pptx`
- `.jpg`
- `.jpeg`
- `.png`

Suggested storage folder:
- `kovapage/auditee-documents`

Suggested size limit:
- 15MB or 20MB depending on your business need

## API Blueprint
Recommended route file:
- `routes/auditee.js`

Recommended mount path:
- `/api/auditee`

### Dashboard Endpoints
- `GET /api/auditee/dashboard`
  returns summary cards and recent requests
- `GET /api/auditee/document-requests`
  list requests assigned to logged-in auditee
  filters:
  - `status`
  - `category`
  - `priority`
  - `search`
- `GET /api/auditee/document-requests/:id`
  one request detail with reviewer comments and file metadata

### Auditee Actions
- `POST /api/auditee/document-requests/:id/upload`
  upload or replace the requested document
- `POST /api/auditee/document-requests/:id/resubmit`
  optional wrapper for rejected requests
- `POST /api/auditee/document-requests/:id/mark-viewed`
  optional if you want view tracking

### Requester / Reviewer Endpoints
These can live in `routes/audit.js` or a dedicated `routes/documentRequest.js`.

- `POST /api/document-requests`
  create a request
- `GET /api/document-requests`
  list requests across staff view
- `GET /api/document-requests/:id`
  detailed view for requester/reviewer
- `PUT /api/document-requests/:id`
  edit request fields like due date or description
- `POST /api/document-requests/:id/review`
  approve or reject uploaded document
- `POST /api/document-requests/:id/remind`
  trigger reminder notification
- `POST /api/document-requests/:id/cancel`
  cancel request

## Example Review Payload
```json
{
  "decision": "rejected",
  "comments": "Please upload the signed version with board approval page included."
}
```

## Example Dashboard Response
```json
{
  "success": true,
  "data": {
    "summary": {
      "pendingUpload": 2,
      "underReview": 1,
      "approved": 5,
      "overdue": 1
    },
    "documentRequests": [
      {
        "id": "uuid",
        "title": "Risk Management Policy v2",
        "requestedBy": {
          "id": "uuid",
          "name": "Michael Brown",
          "team": "Internal Audit"
        },
        "status": "pending_upload",
        "dueDate": "2026-04-12T00:00:00.000Z",
        "canUpload": true,
        "lastSubmission": null
      }
    ]
  }
}
```

## Dashboard Logic For The Screenshot
From the screenshot, the backend likely needs to compute:
- `document name`
  from `DocumentRequest.title`
- `requested by`
  from requester user record plus team/department
- `status badge`
  from request status
- `Upload Document` button visibility
  true when status is one of:
  - `pending_upload`
  - `rejected`
  - `overdue`
- `Audit Notification` menu count
  from unread notifications plus optionally open document requests

## Suggested Summary Logic
For the auditee dashboard top-level cards or nav badges later, compute:
- unread notifications count
- pending document requests count
- overdue requests count
- documents under review count
- approved submissions count

## Suggested Reminder Logic
Reminder logic can be:
- automatic reminder X days before due date
- reminder on due date
- overdue reminder after due date until submission

Can be implemented by:
- scheduled job
- or lazy reminder generation from periodic admin action

## Suggested Authorization Rules
### Auditee
Can:
- see only requests assigned to them
- upload and replace own requested documents
- read reviewer comments

### Team Lead / QA / Requester
Can:
- create request
- view requests they created
- review uploads if allowed by role
- reject or approve

### CAE / BAC / Admin-level roles
Can:
- view all requests
- override status if needed

## Notification Integration Plan
Your existing [Notification.js](C:/Users/Bruce/Documents/KovapageBackend/kovapageBackend/models/Notification.js) can support this immediately.

Suggested notification metadata:
```json
{
  "documentRequestId": "uuid",
  "status": "pending_upload",
  "auditPlanId": "uuid",
  "requestedBy": "uuid",
  "assignedTo": "uuid"
}
```

Suggested titles:
- `New governance document request assigned`
- `Document upload received`
- `Document requires re-upload`
- `Document submission approved`
- `Document request overdue`

## Suggested Build Phases
### Phase 1
- create `DocumentRequest` model
- add auditee list/detail/upload endpoints
- add create/review endpoints for staff
- add notification triggers
- surface counts on auditee dashboard

### Phase 2
- add `DocumentRequestSubmission` history table
- add reviewer assignment
- add due-date reminder job
- add download/view endpoint

### Phase 3
- add bulk request creation from audit engagements
- add request templates by audit type
- add document completeness tracking for each audit
- add dashboard analytics and SLA reporting

## Best Fit For This Repo
For this codebase, the cleanest approach is:
- new model: `DocumentRequest`
- use current `Notification` model for alerts
- create `routes/auditee.js`
- optionally create `routes/documentRequest.js` for staff-side actions
- add a dedicated upload middleware for `documentFile`

## Next Recommended Step
The next concrete backend step should be:
1. create `models/DocumentRequest.js`
2. add upload middleware for auditee documents
3. add `routes/auditee.js`
4. add create/review endpoints for staff
5. connect notifications

When you share more dashboard screenshots, we can keep extending this same document-driven backend map screen by screen.
