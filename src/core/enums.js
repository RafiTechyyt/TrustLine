// enums.js — small closed sets shared across the domain.
// Report *status* is not here: statuses are classes, see core/status/.

export const PRIORITY = Object.freeze({
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  URGENT: "urgent",
});

export const PRIORITY_RANK = Object.freeze({
  [PRIORITY.LOW]: 1,
  [PRIORITY.NORMAL]: 2,
  [PRIORITY.HIGH]: 3,
  [PRIORITY.URGENT]: 4,
});

export const PRIORITY_ORDER = Object.freeze([
  PRIORITY.LOW, PRIORITY.NORMAL, PRIORITY.HIGH, PRIORITY.URGENT,
]);

export function highestPriority(...values) {
  return values
    .filter((v) => PRIORITY_RANK[v])
    .reduce((best, v) => (PRIORITY_RANK[v] > PRIORITY_RANK[best] ? v : best), PRIORITY.LOW);
}

export const VISIBILITY = Object.freeze({
  /** Only the reporter and the assigned desk can see it. */
  PRIVATE: "private",
  /** Shows on the college feed so others can add themselves to it. */
  PUBLIC: "public",
});

export const COLLEGE_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REJECTED: "rejected",
});

export const CONTACT_SHARING = Object.freeze({
  /** Default. Nothing but the trace code links the reporter to the report. */
  NONE: "none",
  /** The handling department may see the contact detail. */
  DEPARTMENT: "department",
  /** Only the college admin may see it. */
  ADMIN_ONLY: "admin_only",
});

export const AUTHOR_TYPE = Object.freeze({
  REPORTER: "reporter",
  OFFICER: "officer",
  SYSTEM: "system",
});
