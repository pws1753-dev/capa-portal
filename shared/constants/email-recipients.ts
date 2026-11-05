/**
 * Who receives each portal email by default, shown read-only in the template editor so an administrator
 * can see what the To/CC lists they edit are added to. Management is never copied on reminders.
 */
export const EMAIL_DEFAULT_RECIPIENTS: Record<string, { to: string; cc: string }> = {
  "USER_CREATED": {
    "to": "Newly created user",
    "cc": ""
  },
  "PASSWORD_RESET_REQUESTED": {
    "to": "Requesting user",
    "cc": ""
  },
  "PASSWORD_CHANGED": {
    "to": "User",
    "cc": ""
  },
  "COMPLAINT_CREATED": {
    "to": "Complaint Coordinator / Owner",
    "cc": "Quality Head"
  },
  "COMPLAINT_ASSIGNED": {
    "to": "Complaint Owner",
    "cc": "Complaint Coordinator"
  },
  "COMPLAINT_REASSIGNED": {
    "to": "New Complaint Owner",
    "cc": "Previous Owner, Coordinator"
  },
  "COMPLAINT_ACKNOWLEDGED": {
    "to": "Complaint Owner",
    "cc": "Quality Head"
  },
  "COMPLAINT_CONTAINMENT_COMPLETED": {
    "to": "Complaint Owner, Coordinator",
    "cc": "Department Head, Quality Head"
  },
  "COMPLAINT_RCA_COMPLETED": {
    "to": "Complaint Owner",
    "cc": "Department Head, Quality Head"
  },
  "COMPLAINT_CAPA_ASSIGNED": {
    "to": "Complaint Owner, CAPA Owners",
    "cc": "Department Head"
  },
  "COMPLAINT_STATUS_CHANGED": {
    "to": "Complaint Owner",
    "cc": "Coordinator"
  },
  "COMPLAINT_CLOSED": {
    "to": "Complaint Owner, Coordinator",
    "cc": "Department Head, Quality Head"
  },
  "COMPLAINT_REOPENED": {
    "to": "Complaint Owner",
    "cc": "Department Head, Quality Head"
  },
  "COMPLAINT_REPORT_SHARED": {
    "to": "Specified Recipient",
    "cc": "Sender"
  },
  "TAT_REMINDER": {
    "to": "Complaint Owner, Coordinator",
    "cc": "Common mailboxes, department Manager and HOD"
  },
  "TAT_DUE_SOON": {
    "to": "Complaint Owner",
    "cc": "Coordinator"
  },
  "TAT_OVERDUE": {
    "to": "Complaint Owner",
    "cc": "Department Head"
  },
  "TAT_ESCALATION": {
    "to": "Tier Recipients (Owner/HOD/Quality/Mgmt)",
    "cc": "Next Escalation Tier"
  },
  "CAPA_ASSIGNED": {
    "to": "CAPA Owner",
    "cc": "Complaint Owner, HOD"
  },
  "CAPA_REASSIGNED": {
    "to": "New CAPA Owner",
    "cc": "Previous CAPA Owner"
  },
  "TAT_DELAY_DAILY": {
    "to": "Complaint Owner (and open CAPA owners when CAPA Assignment is late)",
    "cc": "Common mailboxes, department Manager and HOD"
  },
  "EFFECTIVENESS_REVIEW_DUE": {
    "to": "Complaint Owner, Quality Head, Master Admin",
    "cc": "Common mailboxes, department Manager and HOD"
  },
  "CAPA_DUE_REMINDER": {
    "to": "CAPA Owner",
    "cc": "Common mailboxes, department Manager and HOD"
  },
  "CAPA_OVERDUE": {
    "to": "CAPA Owner, Department Head",
    "cc": "Common mailboxes, department Manager and HOD"
  },
  "CAPA_COMPLETED": {
    "to": "Complaint Owner",
    "cc": "Quality Head"
  },
  "CAPA_EVIDENCE_UPLOADED": {
    "to": "Quality Head",
    "cc": "CAPA Owner"
  },
  "CAPA_EVIDENCE_ACCEPTED": {
    "to": "CAPA Owner",
    "cc": "Complaint Owner"
  },
  "CAPA_EVIDENCE_REJECTED": {
    "to": "CAPA Owner",
    "cc": "Complaint Owner, Department Head"
  },
  "CAPA_EFFECTIVENESS_VERIFIED": {
    "to": "CAPA Owner, Complaint Owner",
    "cc": "Quality Head"
  },
  "CAPA_NOT_EFFECTIVE": {
    "to": "Complaint Owner, CAPA Owner",
    "cc": "Department Head, Management"
  },
  "COMPLAINT_PREPARED": {
    "to": "Complaint Reviewer candidates",
    "cc": "Complaint Owner"
  },
  "COMPLAINT_REVIEWED": {
    "to": "Complaint Approver candidates",
    "cc": "Complaint Owner, Preparer"
  },
  "COMPLAINT_APPROVED": {
    "to": "Complaint Owner, Coordinator",
    "cc": "Quality Head, Management"
  },
  "SIGNATURE_REVOKED": {
    "to": "Signer whose signature was revoked",
    "cc": "Complaint Owner, Quality Head"
  },
  "DAILY_SUMMARY": {
    "to": "Department Heads, Quality Head, Admins",
    "cc": ""
  },
  "WEEKLY_SUMMARY": {
    "to": "Executive Management, Quality Head",
    "cc": ""
  }
};
