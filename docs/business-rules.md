# Business rules, decision outcomes and exceptions

## Evidence completeness

For customer `c`, let `R(c)` be the active mandatory requirements selected by customer type and risk. A requirement is satisfied if at least one document has the required document type, document status `VERIFIED`, non-expired expiry date, and latest verification status `APPROVED`.

`completeness_pct = 100 * satisfied_requirements / mandatory_requirements`, rounded to two decimals. If no mandatory requirements apply, completeness is 100%. An approval decision is blocked if any mandatory requirement is unsatisfied.

## Risk cadence

| Risk | Periodic review interval | Requirement policy |
|---|---:|---|
| LOW | 365 days | standard requirements |
| MEDIUM | 180 days | standard + medium-risk requirements |
| HIGH | 90 days | all applicable high-risk requirements |

## Alert lead times

Document expiry lead times: 30, 14, 7 and 0 calendar days. Expired documents produce a high-severity exception. Reviews past due and not resolved produce overdue alerts.

## Ground-truth exception catalogue

| issue_type | Detection rule | Expected decision |
|---|---|---|
| EXPIRED_DOCUMENT_MARKED_VALID | expiry_date < as_of_date while status is VERIFIED | reject document and raise exception |
| APPROVED_WITH_MISSING_EVIDENCE | customer state APPROVED while one or more mandatory evidence requirements are unsatisfied | reopen onboarding and block approval |
| OWNERSHIP_OVER_100_PERCENT | sum of active beneficial owner percentages > 100% | flag ownership reconciliation exception |
| REVIEW_CLOSED_WITHOUT_RESOLUTION | review status CLOSED and resolution is null/blank | reopen review and require resolution |
| DUPLICATE_DOCUMENT_ACROSS_CUSTOMERS | same file hash appears under unrelated customer IDs | quarantine duplicate and investigate |

The generator creates valid baseline rows, then injects these labelled anomalies. The labels live only in `ground_truth.csv/json`; they are not features on source entity rows.
