# Data dictionary and relationship contract

All IDs are immutable strings. Dates use ISO-8601 calendar dates or UTC timestamps. Monetary values are not generated. `effective_from` is inclusive; `effective_to` is exclusive and nullable for current records. Synthetic personal fields are fictitious.

| Entity | Primary key | Important fields (type; required; validation) |
|---|---|---|
| CustomerType | customer_type_id / Prisma `id` | `name` (string, required, unique; Individual/Business); description (string, optional) |
| Customer | customer_id / Prisma `id` | customer_type_id (FK, required); legal_name (string, required); email (string, required, unique, synthetic `example.test`); country (ISO-3166-1 alpha-2); onboarding_date (date, required); lifecycle_state (enum DRAFT/PENDING_REVIEW/APPROVED/REJECTED/ACTIVE/SUSPENDED); declared_risk (LOW/MEDIUM/HIGH) |
| KYCRequirement | kyc_requirement_id / Prisma `id` | document_type (enum-like string, required); name (string, required); mandatory (boolean); min_risk_level (LOW/MEDIUM/HIGH); effective_from (date, required); effective_to (date, optional, later than start) |
| CustomerRequirement | composite customer_id + requirement_id | bridge for customer-specific applicable requirements; both FKs required; effective dates valid; unique pair |
| Document | document_id / Prisma `id` | customer_id (FK); document_type (required); document_number (optional); issue_date (date); expiry_date (optional, after issue); uploaded_at (timestamp, >= issue date); status (PENDING/VERIFIED/REJECTED/EXPIRED); name_match_status (MATCH/MISMATCH); file_hash (SHA-256 hex; duplicate detection key) |
| Verification | verification_id / Prisma `id` | document_id (FK); status (PENDING/APPROVED/REJECTED); verified_at (optional, required for terminal decisions); reviewer_id (optional); method (required); event history retained |
| RiskRating | risk_rating_id / Prisma `id` | customer_id (FK); risk_level (LOW/MEDIUM/HIGH); score (integer 0–100); reason_code (required); effective dates; multiple historical ratings per customer allowed |
| BusinessEntity | business_entity_id / Prisma `id` | customer_id (FK, unique; one business profile per business customer); registration_number (unique); incorporation_date; jurisdiction; status |
| BeneficialOwner | beneficial_owner_id / Prisma `id` | business_entity_id (FK); owner_name; ownership_pct (decimal 0–100); is_pep (boolean); effective dates; active owner percentages reconcile to 100% |
| ReviewCase | review_case_id / Prisma `id` | customer_id (FK); opened_date; due_date (>= opened); closed_date (optional, >= opened); status (OPEN/IN_PROGRESS/OVERDUE/CLOSED); resolution required for CLOSED |
| Alert | alert_id / Prisma `id` | customer_id (FK); document_id (optional FK); review_case_id (optional logical reference); type; trigger_date; due_date; severity; status (OPEN/ACKNOWLEDGED/RESOLVED); resolved_at required when resolved |
| AuditEvent | audit_event_id / Prisma `id` | entity_type + entity_id; event_type; event_at; actor_id; before_json/after_json; append-only event record |

## Cardinality

- CustomerType 1:N Customer.
- Customer 1:N Document, RiskRating, ReviewCase, Alert and AuditEvent.
- Customer N:M KYCRequirement through CustomerRequirement, with effective dates.
- Document 1:N Verification (each verification is a new decision event; latest decision is used for current evaluation).
- Customer 0:1 BusinessEntity; BusinessEntity 1:N BeneficialOwner.
- Document 0:N Alert; Customer 1:N Alert.
- ReviewCase belongs to exactly one Customer; review-to-alert is a nullable logical association in the CSV contract.

## Deterministic identifiers

`CUS-000001`; `KYC-2026-000001` (requirement/catalog instances may use stable requirement keys); `DOC-<customer-id>-001`; `REV-<customer-id>-2026-0001`; `ALT-2026-000001`. The API schema uses the same immutable string-ID principle. Generator CSV IDs are source-of-truth for seeded records.
