# Email Event Matrix

This document defines the complete matrix of all 34 transactional, notification, SLA reminder, escalation, and summary email events in the ONEPWS Complaint & CAPA Management System.

All emails pass through the centralized `sendTemplatedEmail()` engine with strict recipient scoping, deduplication keys, corporate HTML/plain-text rendering, and persistent delivery audit logging.

| Event Key | Trigger Point | Template Key | TO Rule | CC Rule | BCC Rule | Dedupe Behavior | Related Entity | Tested Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AUTH: USER_CREATED** | User created in Admin / Master Data | `user-created` | Newly created user | — | — | None | User | VERIFIED |
| **AUTH: PASSWORD_RESET_REQUESTED** | User submits Forgot Password form | `password-reset-requested` | Requesting user | — | — | 1 per reset token | User | VERIFIED |
| **AUTH: PASSWORD_CHANGED** | Password reset completed or changed | `password-changed` | User | — | — | None | User | VERIFIED |
| **COMPLAINT: COMPLAINT_CREATED** | Complaint logged & submitted | `complaint-created` | Complaint Coordinator / Owner | Quality Head | — | 1 per complaint create | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_ASSIGNED** | Owner/Coordinator assigned | `complaint-assigned` | Complaint Owner | Complaint Coordinator | — | 1 per assign event | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_REASSIGNED** | Owner changed | `complaint-reassigned` | New Complaint Owner | Previous Owner, Coordinator | — | 1 per reassign event | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_ACKNOWLEDGED** | Acknowledged stage completed (D0) | `complaint-acknowledged` | Complaint Owner | Quality Head | — | 1 per ack timestamp | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_CONTAINMENT_COMPLETED** | Containment stage completed (D3) | `complaint-containment-completed` | Complaint Owner, Coordinator | Department Head, Quality Head | — | 1 per containment timestamp | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_RCA_COMPLETED** | RCA stage completed (D4/D5) | `complaint-rca-completed` | Complaint Owner | Department Head, Quality Head | — | 1 per RCA timestamp | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_CAPA_ASSIGNED** | CAPA stage completed (D6/D7) | `complaint-capa-assigned` | Complaint Owner, CAPA Owners | Department Head | — | 1 per stage mark | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_STATUS_CHANGED** | Status transition | `complaint-status-changed` | Complaint Owner | Coordinator | — | 1 per status change | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_CLOSED** | Complaint closed with closure signoff | `complaint-closed` | Complaint Owner, Coordinator | Department Head, Quality Head | — | 1 per closure | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_REOPENED** | Complaint reopened (manual or auto) | `complaint-reopened` | Complaint Owner | Department Head, Quality Head | — | 1 per reopen | Complaint | VERIFIED |
| **COMPLAINT: COMPLAINT_REPORT_SHARED** | Authorized 8D report shared via email | `complaint-report-shared` | Specified Recipient | Sender | — | None (manual) | Complaint | VERIFIED |
| **TAT: TAT_REMINDER** | Cron evaluates stage SLA milestone | `tat-reminder` | Complaint Owner | Coordinator | — | Milestone key (`rem:{id}:{stage}:{pct}`) | Complaint | VERIFIED |
| **TAT: TAT_DUE_SOON** | Stage deadline within configured window | `tat-due-soon` | Complaint Owner | Coordinator | — | Due soon key (`duesoon:{id}:{stage}:{date}`) | Complaint | VERIFIED |
| **TAT: TAT_OVERDUE** | Stage deadline exceeded | `tat-overdue` | Complaint Owner | Department Head | — | Overdue key (`overdue:{id}:{stage}:{date}`) | Complaint | VERIFIED |
| **TAT: TAT_ESCALATION** | Overdue exceeds tier thresholds (0/24/72/168h) | `tat-escalation` | Tier Recipients (Owner/HOD/Quality/Mgmt) | Next Escalation Tier | — | Tier key (`esc:{id}:{stage}:lvl{tier}`) | Complaint | VERIFIED |
| **CAPA: CAPA_ASSIGNED** | CAPA created and assigned to owner | `capa-assigned` | CAPA Owner | Complaint Owner, HOD | — | 1 per CAPA creation | Capa | VERIFIED |
| **CAPA: CAPA_REASSIGNED** | CAPA owner modified | `capa-reassigned` | New CAPA Owner | Previous CAPA Owner | — | 1 per reassign | Capa | VERIFIED |
| **Complaint: TAT_DELAY_DAILY** | Any of the 4 TAT stages (Acknowledgement, Containment, RCA Completion, CAPA Assignment) is incomplete and past its due date; one email per complaint per day, listing all four stages, until they are completed | `tat-delay-daily` | Complaint Owner (+ open CAPA owners when CAPA Assignment is late; common mailboxes if no owner email) | Common mailboxes, department Manager and HOD, recipients' own Manager/HOD; Management is **never** copied on reminders (it receives only the monthly summary report) | — | `TATDELAY_{complaintId}_{yyyy-mm-dd}` | Complaint | VERIFIED |
| **Complaint: EFFECTIVENESS_REVIEW_DUE** | Periodic check of a closed complaint, every 6 months after its closure date (6, 12, 18 …) until recorded in the Effectiveness Tracker; daily cron, buckets at 30/14/7/3/1/0 days, then weekly while overdue; at most 25 per run | `effectiveness-review-due` | Complaint Owner, Quality Head, Master Admin | Department Manager, HOD, Management, recipients' own Manager/HOD | — | `EFFREV_{complaintId}_{cycle}_{bucket}` | Complaint | VERIFIED |
| **CAPA: CAPA_DUE_REMINDER** | CAPA target date approaching | `capa-due-reminder` | CAPA Owner | Department Head | — | Milestone key (`rem:capa:{id}:{pct}`) | Capa | VERIFIED |
| **CAPA: CAPA_OVERDUE** | CAPA past target date | `capa-overdue` | CAPA Owner | Department Head, Quality Head | — | Overdue key (`overdue:capa:{id}:{date}`) | Capa | VERIFIED |
| **CAPA: CAPA_COMPLETED** | Action plan executed | `capa-completed` | Complaint Owner | Quality Head | — | 1 per action complete | Capa | VERIFIED |
| **CAPA: CAPA_EVIDENCE_UPLOADED** | Verification evidence uploaded | `capa-evidence-uploaded` | Quality Head | CAPA Owner | — | 1 per upload | Capa | VERIFIED |
| **CAPA: CAPA_EVIDENCE_ACCEPTED** | Evidence reviewed and accepted | `capa-evidence-accepted` | CAPA Owner | Complaint Owner | — | 1 per accept review | Capa | VERIFIED |
| **CAPA: CAPA_EVIDENCE_REJECTED** | Evidence reviewed and rejected | `capa-evidence-rejected` | CAPA Owner | Complaint Owner, Department Head | — | 1 per reject review | Capa | VERIFIED |
| **CAPA: CAPA_EFFECTIVENESS_VERIFIED** | Effectiveness check verified Effective | `capa-effectiveness-verified` | CAPA Owner, Complaint Owner | Quality Head | — | 1 per verification | Capa | VERIFIED |
| **CAPA: CAPA_NOT_EFFECTIVE** | Effectiveness check verified Not Effective | `capa-not-effective` | Complaint Owner, CAPA Owner | Department Head, Management | — | 1 per not-effective | Capa | VERIFIED |
| **SIGNATURE: COMPLAINT_PREPARED** | D1-D8 Prepared by signed | `complaint-prepared` | Complaint Reviewer candidates | Complaint Owner | — | 1 per prepare sign | Complaint | VERIFIED |
| **SIGNATURE: COMPLAINT_REVIEWED** | Reviewed by signed | `complaint-reviewed` | Complaint Approver candidates | Complaint Owner, Preparer | — | 1 per review sign | Complaint | VERIFIED |
| **SIGNATURE: COMPLAINT_APPROVED** | Approved by signed | `complaint-approved` | Complaint Owner, Coordinator | Quality Head, Management | — | 1 per approval sign | Complaint | VERIFIED |
| **SIGNATURE: SIGNATURE_REVOKED** | Signature revoked by Master Admin | `signature-revoked` | Signer whose signature was revoked | Complaint Owner, Quality Head | — | 1 per revoke action | Complaint | VERIFIED |
| **SUMMARY: DAILY_SUMMARY** | No longer sent (replaced by the monthly digest) | `daily-summary` | Department Heads, Quality Head, Admins | — | — | Digest key (`summary:daily:{companyId}:{date}`) | System | VERIFIED |
| **SUMMARY: WEEKLY_SUMMARY** | Monthly digest (1st of each month; key kept for history) | `weekly-summary` | Executive Management, Quality Head | — | — | Digest key (`MONTHLY_SUMMARY_{companyId}_{YYYY-MM}`) | System | VERIFIED |
