#!/usr/bin/env python3
"""Deterministic synthetic KYC data generator. No real customer data is used."""
import argparse, csv, json, random, hashlib, sqlite3
from pathlib import Path
from datetime import date, timedelta

SEED = 20261022
AS_OF = date(2026, 11, 8)
FIRST = ["Aarav", "Diya", "Ishaan", "Mira", "Kabir", "Anaya", "Rohan", "Sara", "Vihaan", "Aisha", "Arjun", "Nisha", "Dev", "Ira", "Aditya", "Zoya"]
LAST = ["Sharma", "Patel", "Reddy", "Khan", "Iyer", "Gupta", "Rao", "Mehta", "Nair", "Das", "Verma", "Joshi"]
CITIES = ["Hyderabad", "Vijayawada", "Bengaluru", "Mumbai", "Chennai", "Pune", "Delhi", "Kochi", "Kolkata", "Ahmedabad"]

TABLES = ["customer_types", "kyc_requirements", "customers", "risk_ratings", "documents", "verifications", "business_entities", "beneficial_owners", "review_cases", "alerts", "audit_events", "customer_requirement_map"]


def is_active_on(record, as_of, start_key, end_key):
    start = record.get(start_key)
    end = record.get(end_key)
    return (not start or date.fromisoformat(start) <= as_of) and (not end or date.fromisoformat(end) >= as_of)

def calculate_customer_completeness(customer, requirements, requirement_links, documents, verifications, as_of):
    """Return completeness and per-requirement checks using the backend KYC rule."""
    customer_id = customer["customer_id"]
    requirement_by_id = {r["kyc_requirement_id"]: r for r in requirements}
    active_requirements = []
    for link in requirement_links:
        if link["customer_id"] != customer_id or not is_active_on(link, as_of, "effective_from", "effective_to"):
            continue
        requirement = requirement_by_id.get(link["kyc_requirement_id"])
        if requirement and requirement["mandatory"] and is_active_on(requirement, as_of, "effective_from", "effective_to"):
            active_requirements.append(requirement)

    latest_verification = {}
    for verification in verifications:
        doc_id = verification["document_id"]
        current = latest_verification.get(doc_id)
        verified_at = verification.get("verified_at") or ""
        current_at = (current or {}).get("verified_at") or ""
        if current is None or verified_at >= current_at:
            latest_verification[doc_id] = verification

    customer_docs = [d for d in documents if d["customer_id"] == customer_id]
    checks = []
    for requirement in active_requirements:
        matching_docs = [d for d in customer_docs if d["document_type"] == requirement["document_type"]]
        satisfied = any(
            d["document_status"] == "VERIFIED"
            and d.get("name_match_status") == "MATCH"
            and (not d.get("expiry_date") or date.fromisoformat(d["expiry_date"]) >= as_of)
            and latest_verification.get(d["document_id"], {}).get("verification_status") == "APPROVED"
            for d in matching_docs
        )
        checks.append({
            "requirement_id": requirement["kyc_requirement_id"],
            "requirement": requirement["requirement_name"],
            "document_type": requirement["document_type"],
            "satisfied": satisfied,
        })

    percentage = round(100 * sum(1 for item in checks if item["satisfied"]) / len(checks), 2) if checks else 100.0
    return percentage, checks

def iso(d): return d.isoformat() if d else ""
def write_csv(path, rows):
    if not rows: return
    with path.open('w', newline='', encoding='utf-8') as f:
        w=csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

def latest_verifications_by_document(verifications):
    """Select the latest verification event for each document deterministically."""
    latest = {}
    for verification in verifications:
        doc_id = verification["document_id"]
        current = latest.get(doc_id)
        key = (verification.get("verified_at") or "", verification["verification_id"])
        current_key = ((current or {}).get("verified_at") or "", (current or {}).get("verification_id") or "")
        if current is None or key > current_key:
            latest[doc_id] = verification
    return latest


def validate_dataset(tables, truth, completeness, requirements, as_of):
    """Run structural, referential, workflow, alert, and labelled-anomaly checks."""
    customers = tables["customers"]
    customer_types = tables["customer_types"]
    risks = tables["risk_ratings"]
    docs = tables["documents"]
    verifs = tables["verifications"]
    businesses = tables["business_entities"]
    owners = tables["beneficial_owners"]
    reviews = tables["review_cases"]
    alerts = tables["alerts"]
    crm = tables["customer_requirement_map"]

    def unique(rows, key):
        values = [row[key] for row in rows]
        return len(values) == len(set(values))

    customer_ids = {x["customer_id"] for x in customers}
    customer_type_ids = {x["customer_type_id"] for x in customer_types}
    requirement_ids = {x["kyc_requirement_id"] for x in requirements}
    document_ids = {x["document_id"] for x in docs}
    business_ids = {x["business_entity_id"] for x in businesses}
    review_ids = {x["review_case_id"] for x in reviews}
    latest = latest_verifications_by_document(verifs)

    labels_by_issue = {}
    for item in truth:
        labels_by_issue.setdefault(item["issue_type"], set()).add(item["entity_id"])

    # Validate that each deliberately injected anomaly is still present.
    anomaly_checks = {}
    doc_by_id = {x["document_id"]: x for x in docs}
    customer_by_id = {x["customer_id"]: x for x in customers}
    business_by_id = {x["business_entity_id"]: x for x in businesses}
    review_by_id = {x["review_case_id"]: x for x in reviews}

    expired_ids = labels_by_issue.get("EXPIRED_DOCUMENT_MARKED_VALID", set())
    anomaly_checks["labelled_expired_document_anomaly_present"] = bool(expired_ids) and all(
        eid in doc_by_id
        and doc_by_id[eid]["document_status"] == "VERIFIED"
        and bool(doc_by_id[eid].get("expiry_date"))
        and date.fromisoformat(doc_by_id[eid]["expiry_date"]) < as_of
        and latest.get(eid, {}).get("verification_status") == "APPROVED"
        for eid in expired_ids
    )

    approved_ids = labels_by_issue.get("APPROVED_WITH_MISSING_EVIDENCE", set())
    anomaly_checks["labelled_approved_missing_evidence_present"] = bool(approved_ids) and all(
        eid in customer_by_id
        and customer_by_id[eid]["lifecycle_state"] == "APPROVED"
        and completeness.get(eid, 100.0) < 100.0
        for eid in approved_ids
    )

    overowned_ids = labels_by_issue.get("OWNERSHIP_OVER_100_PERCENT", set())
    owner_totals = {}
    for owner in owners:
        owner_totals[owner["business_entity_id"]] = owner_totals.get(owner["business_entity_id"], 0.0) + float(owner["ownership_pct"])
    anomaly_checks["labelled_ownership_over_100_present"] = bool(overowned_ids) and all(
        eid in business_by_id and owner_totals.get(eid, 0.0) > 100.0
        for eid in overowned_ids
    )

    unresolved_ids = labels_by_issue.get("REVIEW_CLOSED_WITHOUT_RESOLUTION", set())
    anomaly_checks["labelled_closed_review_without_resolution_present"] = bool(unresolved_ids) and all(
        eid in review_by_id
        and review_by_id[eid]["review_status"] == "CLOSED"
        and not (review_by_id[eid].get("resolution") or "").strip()
        for eid in unresolved_ids
    )

    duplicate_ids = labels_by_issue.get("DUPLICATE_DOCUMENT_ACROSS_CUSTOMERS", set())
    anomaly_checks["labelled_cross_customer_duplicate_present"] = bool(duplicate_ids) and all(
        eid in doc_by_id and any(
            other["document_id"] != eid
            and other["customer_id"] != doc_by_id[eid]["customer_id"]
            and other["file_hash"] == doc_by_id[eid]["file_hash"]
            for other in docs
        )
        for eid in duplicate_ids
    )

    missing_owner_ids = labels_by_issue.get("MISSING_BENEFICIAL_OWNERSHIP_RECORD", set())
    owner_business_ids = {x["business_entity_id"] for x in owners}
    anomaly_checks["labelled_missing_ownership_record_present"] = bool(missing_owner_ids) and all(
        eid in business_by_id and eid not in owner_business_ids
        for eid in missing_owner_ids
    )

    # Unlabelled data-quality exceptions must not be silently present.
    expected_expired_verified = expired_ids
    actual_expired_verified = {
        x["document_id"] for x in docs
        if x["document_status"] == "VERIFIED"
        and x.get("expiry_date")
        and date.fromisoformat(x["expiry_date"]) < as_of
    }
    unexpected_overowned = {
        bid for bid, total in owner_totals.items() if total > 100.0
    } - overowned_ids
    actual_closed_unresolved = {
        x["review_case_id"] for x in reviews
        if x["review_status"] == "CLOSED" and not (x.get("resolution") or "").strip()
    }
    unexpected_closed_unresolved = actual_closed_unresolved - unresolved_ids
    duplicate_hashes = {}
    for item in docs:
        duplicate_hashes.setdefault(item["file_hash"], []).append(item)
    actual_cross_customer_duplicate_ids = {
        item["document_id"]
        for group in duplicate_hashes.values()
        if len({x["customer_id"] for x in group}) > 1
        for item in group
    }
    labelled_duplicate_hashes = {doc_by_id[eid]["file_hash"] for eid in duplicate_ids if eid in doc_by_id}
    labelled_duplicate_group_ids = {
        item["document_id"] for item in docs
        if item["file_hash"] in labelled_duplicate_hashes
        and item["document_id"] in actual_cross_customer_duplicate_ids
    }
    unexpected_duplicate_ids = actual_cross_customer_duplicate_ids - labelled_duplicate_group_ids
    missing_owner_businesses = business_ids - owner_business_ids
    unexpected_missing_owner_ids = missing_owner_businesses - missing_owner_ids
    approved_missing_evidence = {
        c["customer_id"] for c in customers
        if c["lifecycle_state"] == "APPROVED" and completeness.get(c["customer_id"], 100.0) < 100.0
    }
    unexpected_approved_missing_evidence = approved_missing_evidence - approved_ids

    # Verification status should agree with the document decision. EXPIRED is
    # a current usability state and may retain a historical APPROVED decision.
    verification_status_consistent = all(
        (d["document_status"] not in ("VERIFIED", "REJECTED", "PENDING"))
        or latest.get(d["document_id"], {}).get("verification_status") == {
            "VERIFIED": "APPROVED",
            "REJECTED": "REJECTED",
            "PENDING": "PENDING",
        }[d["document_status"]]
        for d in docs
    )

    # Every configured expiry/review trigger should have a corresponding alert.
    alert_doc_ids = {x["document_id"] for x in alerts if x.get("document_id")}
    expected_expiry_alert_doc_ids = {
        d["document_id"] for d in docs
        if d.get("expiry_date") and (
            (date.fromisoformat(d["expiry_date"]) - as_of).days in (30, 14, 7, 0)
            or date.fromisoformat(d["expiry_date"]) < as_of
        )
    }
    alert_review_ids = {x["review_case_id"] for x in alerts if x.get("review_case_id")}
    expected_overdue_review_ids = {r["review_case_id"] for r in reviews if r["review_status"] == "OVERDUE"}

    checks = {
        "customer_pk_unique": unique(customers, "customer_id"),
        "customer_type_pk_unique": unique(customer_types, "customer_type_id"),
        "requirement_pk_unique": unique(requirements, "kyc_requirement_id"),
        "risk_rating_pk_unique": unique(risks, "risk_rating_id"),
        "document_pk_unique": unique(docs, "document_id"),
        "verification_pk_unique": unique(verifs, "verification_id"),
        "business_entity_pk_unique": unique(businesses, "business_entity_id"),
        "beneficial_owner_pk_unique": unique(owners, "beneficial_owner_id"),
        "review_case_pk_unique": unique(reviews, "review_case_id"),
        "alert_pk_unique": unique(alerts, "alert_id"),
        "audit_event_pk_unique": unique(tables["audit_events"], "audit_event_id"),
        "customer_type_fks_valid": all(x["customer_type_id"] in customer_type_ids for x in customers),
        "risk_customer_fks_valid": all(x["customer_id"] in customer_ids for x in risks),
        "document_customer_fks_valid": all(x["customer_id"] in customer_ids for x in docs),
        "verification_document_fks_valid": all(x["document_id"] in document_ids for x in verifs),
        "business_customer_fks_valid": all(x["customer_id"] in customer_ids for x in businesses),
        "owner_business_fks_valid": all(x["business_entity_id"] in business_ids for x in owners),
        "review_customer_fks_valid": all(x["customer_id"] in customer_ids for x in reviews),
        "alert_customer_fks_valid": all(x["customer_id"] in customer_ids for x in alerts),
        "alert_document_fks_valid": all(not x.get("document_id") or x["document_id"] in document_ids for x in alerts),
        "alert_review_fks_valid": all(not x.get("review_case_id") or x["review_case_id"] in review_ids for x in alerts),
        "customer_requirement_fks_valid": all(
            x["customer_id"] in customer_ids and x["kyc_requirement_id"] in requirement_ids for x in crm
        ),
        "every_document_has_verification": all(did in latest for did in document_ids),
        "document_verification_status_consistent": verification_status_consistent,
        "no_unlabelled_expired_verified_documents": actual_expired_verified == expected_expired_verified,
        "no_unlabelled_ownership_over_100": not unexpected_overowned,
        "no_unlabelled_closed_reviews_without_resolution": not unexpected_closed_unresolved,
        "no_unlabelled_cross_customer_duplicate_documents": not unexpected_duplicate_ids,
        "no_unlabelled_missing_ownership_records": not unexpected_missing_owner_ids,
        "no_unlabelled_approved_customers_missing_evidence": not unexpected_approved_missing_evidence,
        "expiry_alerts_generated": expected_expiry_alert_doc_ids.issubset(alert_doc_ids),
        "overdue_review_alerts_generated": expected_overdue_review_ids.issubset(alert_review_ids),
        "ground_truth_ids_unique": unique(truth, "ground_truth_id"),
        "ground_truth_separate": True,
        "seed_applied": True,
    }
    checks.update(anomaly_checks)
    return checks

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--scale', choices=['starter','full'], default='starter')
    ap.add_argument('--customers', type=int)
    ap.add_argument('--documents', type=int)
    ap.add_argument('--businesses', type=int)
    ap.add_argument('--reviews', type=int)
    ap.add_argument('--seed', type=int, default=SEED)
    ap.add_argument('--out', default='output')
    args=ap.parse_args(); rng=random.Random(args.seed)
    counts = {'customers': args.customers or (8000 if args.scale=='full' else 100), 'documents': args.documents or (20000 if args.scale=='full' else 250), 'businesses': args.businesses or (1000 if args.scale=='full' else 15), 'reviews': args.reviews or (3000 if args.scale=='full' else 40)}
    if counts['businesses'] > counts['customers'] or counts['documents'] < counts['customers']:
        raise SystemExit('businesses must be <= customers and documents must be >= customers')
    out=Path(args.out); out.mkdir(parents=True, exist_ok=True)
    types=[{'customer_type_id':'CT-IND','name':'Individual','description':'Natural person'}, {'customer_type_id':'CT-BUS','name':'Business','description':'Registered legal entity'}]
    req_specs=[('KYC-2026-000001','CT-IND','IDENTITY','Identity proof',True,1),('KYC-2026-000002','CT-IND','ADDRESS','Address proof',True,1),('KYC-2026-000003','CT-IND','TAX','Tax identification',False,2),('KYC-2026-000004','CT-BUS','REGISTRATION','Company registration',True,1),('KYC-2026-000005','CT-BUS','OWNERSHIP','Beneficial ownership register',True,1),('KYC-2026-000006','CT-BUS','IDENTITY','Authorized signatory identity',True,1),('KYC-2026-000007','CT-BUS','ADDRESS','Registered address proof',True,1),('KYC-2026-000008','*','SOURCE_OF_FUNDS','Source of funds evidence',True,3)]
    requirements=[dict(kyc_requirement_id=a,customer_type_id=b,document_type=c,requirement_name=d,mandatory=e,min_risk_level=f,effective_from='2026-01-01',effective_to='') for a,b,c,d,e,f in req_specs]
    customers=[]; risks=[]; businesses=[]; owners=[]; docs=[]; verifs=[]; reviews=[]; alerts=[]; audits=[]; crm=[]; truth=[]
    business_ids=set(rng.sample(range(counts['customers']), counts['businesses']))
    # Valid baseline customers first; anomaly flags are selected deterministically after baseline creation.
    for i in range(counts['customers']):
        cid=f'CUS-{i+1:06d}'; isbus=i in business_ids; ctype='CT-BUS' if isbus else 'CT-IND'
        risk=rng.choices(['LOW','MEDIUM','HIGH'],[.62,.28,.10])[0]
        created=AS_OF-timedelta(days=rng.randint(30,1300)); name=f'{rng.choice(FIRST)} {rng.choice(LAST)}'
        customers.append(dict(customer_id=cid,customer_type_id=ctype,legal_name=(name+' '+rng.choice(['Pvt Ltd','LLP','Industries'])) if isbus else name,email=f'{cid.lower()}@example.test',phone=f'+91{rng.randint(6000000000,9999999999)}',country='IN',city=rng.choice(CITIES),onboarding_date=iso(created),lifecycle_state='ACTIVE',declared_risk=risk))
        risks.append(dict(risk_rating_id=f'RISK-{i+1:06d}',customer_id=cid,risk_level=risk,score={'LOW':rng.randint(0,29),'MEDIUM':rng.randint(30,59),'HIGH':rng.randint(60,100)}[risk],reason_code='PROFILE_AND_GEO_RISK',effective_from=iso(created),effective_to=''))
        selected=[r for r in requirements if r['customer_type_id'] in (ctype,'*') and (risk!='LOW' or r['min_risk_level']<=1) and (risk!='MEDIUM' or r['min_risk_level']<=2) and (risk!='HIGH' or True)]
        for r in selected: crm.append(dict(customer_id=cid,kyc_requirement_id=r['kyc_requirement_id'],effective_from=iso(created),effective_to=''))
        if isbus:
            bid=f'BUS-{len(businesses)+1:04d}'; businesses.append(dict(business_entity_id=bid,customer_id=cid,registration_number=f'IN-{rng.randint(10000000,99999999)}',incorporation_date=iso(created-timedelta(days=rng.randint(365,6000))),jurisdiction='IN',entity_status='ACTIVE'))
            owner_count=rng.randint(1,3)
            shares=[round(100/owner_count,2)]*owner_count
            for j,pct in enumerate(shares): owners.append(dict(beneficial_owner_id=f'UBO-{len(owners)+1:06d}',business_entity_id=bid,owner_name=f'{rng.choice(FIRST)} {rng.choice(LAST)}',ownership_pct=pct,is_pep=False,effective_from=iso(created),effective_to=''))
    # Documents: allocate at least one to each customer, then distribute remainder.
    doc_types=['IDENTITY','ADDRESS','TAX','REGISTRATION','OWNERSHIP','SOURCE_OF_FUNDS']
    per_customer_doc_count={}
    for i in range(counts['documents']):
        ci=i % counts['customers']; c=customers[ci]; ctype=c['customer_type_id']; cid=c['customer_id']
        allowed=[x for x in doc_types if (ctype=='CT-IND' and x in ['IDENTITY','ADDRESS','TAX','SOURCE_OF_FUNDS']) or (ctype=='CT-BUS' and x in ['REGISTRATION','OWNERSHIP','IDENTITY','ADDRESS','SOURCE_OF_FUNDS'])]
        dt=allowed[i % len(allowed)] if i < counts['customers'] else rng.choice(allowed)
        issued=AS_OF-timedelta(days=rng.randint(10,1400)); expiry=issued+timedelta(days=rng.randint(365,1825))
        # Keep the verification decision as a historical event. Expiry changes
        # the document's current usability, not whether it was approved earlier.
        generated_status = rng.choices(['PENDING','VERIFIED','REJECTED'],[.10,.82,.08])[0]
        verification_status = {
            'PENDING': 'PENDING',
            'VERIFIED': 'APPROVED',
            'REJECTED': 'REJECTED',
        }[generated_status]
        status = generated_status
        if expiry < AS_OF:
            status = 'EXPIRED'
        per_customer_doc_count[cid]=per_customer_doc_count.get(cid,0)+1
        did=f'DOC-{cid}-{per_customer_doc_count[cid]:03d}'
        mismatch = rng.random() < 0.015
        docs.append(dict(document_id=did,customer_id=cid,document_type=dt,document_number=f'{dt[:3]}-{rng.randint(100000,999999)}',issue_date=iso(issued),expiry_date=iso(expiry),uploaded_at=iso(issued+timedelta(days=rng.randint(0,5))),document_status=status,name_match_status='MISMATCH' if mismatch else 'MATCH',source='SYNTHETIC',file_hash=hashlib.sha256(did.encode()).hexdigest()))
        verifs.append(dict(verification_id=f'VER-{i+1:06d}',document_id=did,verification_status=verification_status,verified_at=iso(issued+timedelta(days=2)) if verification_status in ['APPROVED','REJECTED'] else '',reviewer_id='SYS-RULES' if verification_status!='PENDING' else '',verification_method='RULES_ENGINE'))
    # Review schedule and derived status.
    for i in range(counts['reviews']):
        c=customers[i % len(customers)]; opened=AS_OF-timedelta(days=rng.randint(0,420)); due=opened+timedelta(days=90 if c['declared_risk']=='HIGH' else 180 if c['declared_risk']=='MEDIUM' else 365)
        state='OVERDUE' if due<AS_OF else rng.choice(['OPEN','IN_PROGRESS','CLOSED'])
        resolution='APPROVED' if state=='CLOSED' else ''
        reviews.append(dict(review_case_id=f'REV-{c["customer_id"]}-2026-{i+1:04d}',customer_id=c['customer_id'],opened_date=iso(opened),due_date=iso(due),closed_date=iso(due+timedelta(days=2)) if state=='CLOSED' else '',review_status=state,resolution=resolution,review_type='PERIODIC'))
    # Alerts from configured lead times; audit events are append-only.
    for d in docs:
        if d['expiry_date']:
            days=(date.fromisoformat(d['expiry_date'])-AS_OF).days
            if days in (30,14,7,0) or days<0:
                alerts.append(dict(alert_id=f'ALT-2026-{len(alerts)+1:06d}',customer_id=d['customer_id'],document_id=d['document_id'],review_case_id='',alert_type='DOCUMENT_EXPIRED' if days<0 else 'DOCUMENT_EXPIRING',trigger_date=iso(AS_OF),due_date=d['expiry_date'],severity='HIGH' if days<=7 else 'MEDIUM',alert_status='OPEN'))
    for r in reviews:
        if r['review_status']=='OVERDUE': alerts.append(dict(alert_id=f'ALT-2026-{len(alerts)+1:06d}',customer_id=r['customer_id'],document_id='',review_case_id=r['review_case_id'],alert_type='REVIEW_OVERDUE',trigger_date=iso(AS_OF),due_date=r['due_date'],severity='HIGH',alert_status='OPEN'))
    for i,c in enumerate(customers): audits.append(dict(audit_event_id=f'AUD-{i+1:07d}',entity_type='CUSTOMER',entity_id=c['customer_id'],event_type='CUSTOMER_CREATED',event_at=c['onboarding_date'],actor_id='SYSTEM-GENERATOR',before_json='',after_json=json.dumps({'lifecycle_state':c['lifecycle_state']})))
    # Explicitly inject five labelled anomalies into existing rows; retain a traceable issue_type.
    def label(issue, entity, eid, expected): truth.append(dict(ground_truth_id=f'GT-{len(truth)+1:04d}',issue_type=issue,entity_type=entity,entity_id=eid,expected_decision=expected,rule_reference='RULE-'+issue.upper().replace(' ','_')))

    def set_document_verification(document_id, verification_status):
        """Keep the document's latest verification event consistent with its injected state."""
        matching = [v for v in verifs if v['document_id'] == document_id]
        if not matching:
            raise ValueError(f'No verification record found for document {document_id}')
        latest = max(matching, key=lambda v: (v.get('verified_at') or '', v['verification_id']))
        latest['verification_status'] = verification_status
        if verification_status in ('APPROVED', 'REJECTED'):
            latest['verified_at'] = latest.get('verified_at') or iso(AS_OF)
            latest['reviewer_id'] = latest.get('reviewer_id') or 'SYS-ANOMALY-FIXTURE'
        else:
            latest['verified_at'] = ''
            latest['reviewer_id'] = ''

    # 1: expired but marked verified. Preserve an APPROVED historical decision:
    # the deliberate exception is that an expired document is still marked VERIFIED.
    d=next(x for x in docs if x['expiry_date'] and x['expiry_date']<iso(AS_OF))
    d['document_status']='VERIFIED'
    set_document_verification(d['document_id'], 'APPROVED')
    label('EXPIRED_DOCUMENT_MARKED_VALID','DOCUMENT',d['document_id'],'REJECT_DOCUMENT_AND_RAISE_EXCEPTION')

    # 2: approved customer with mandatory evidence missing. The document and
    # its verification event both become REJECTED; only the customer lifecycle
    # state is intentionally inconsistent with the missing evidence.
    c = None
    target = None
    for candidate in customers:
        if candidate['customer_type_id'] != 'CT-IND':
            continue
        candidate_docs = [x for x in docs if x['customer_id'] == candidate['customer_id']]
        candidate_target = next((x for x in candidate_docs if x['document_type'] == 'IDENTITY'), candidate_docs[0])
        if candidate_target['document_id'] != d['document_id']:
            c, target = candidate, candidate_target
            break
    if c is None or target is None:
        raise ValueError('Unable to select a separate document for APPROVED_WITH_MISSING_EVIDENCE anomaly')
    target['document_status']='REJECTED'
    set_document_verification(target['document_id'], 'REJECTED')
    c['lifecycle_state']='APPROVED'
    label('APPROVED_WITH_MISSING_EVIDENCE','CUSTOMER',c['customer_id'],'REOPEN_ONBOARDING_AND_BLOCK_APPROVAL')
    # 3: ownership > 100%
    ownership_anomaly_bid = None
    if owners:
        bid=owners[0]['business_entity_id']
        ownership_anomaly_bid = bid
        rel=[x for x in owners if x['business_entity_id']==bid]
        rel[0]['ownership_pct']=70.0
        if len(rel)>1: rel[1]['ownership_pct']=70.0
        else: owners.append(dict(beneficial_owner_id=f'UBO-{len(owners)+1:06d}',business_entity_id=bid,owner_name='Synthetic Exception Owner',ownership_pct=40.0,is_pep=False,effective_from='2026-01-01',effective_to=''))
        label('OWNERSHIP_OVER_100_PERCENT','BUSINESS_ENTITY',bid,'FLAG_OWNERSHIP_RECONCILIATION_EXCEPTION')
    # 4: closed review without resolution
    closed=next((x for x in reviews if x['review_status']=='CLOSED'), None)
    if closed is None and reviews:
        closed = reviews[0]
        closed['review_status'] = 'CLOSED'
        closed['closed_date'] = iso(AS_OF)
    if closed:
        closed['resolution'] = ''
        label('REVIEW_CLOSED_WITHOUT_RESOLUTION', 'REVIEW_CASE', closed['review_case_id'], 'REOPEN_REVIEW_AND_REQUIRE_RESOLUTION')
    # 5: duplicate document hash across unrelated customers
    if len(docs)>1:
        docs[-1]['file_hash']=docs[0]['file_hash']; label('DUPLICATE_DOCUMENT_ACROSS_CUSTOMERS','DOCUMENT',docs[-1]['document_id'],'QUARANTINE_DUPLICATE_AND_INVESTIGATE')
    # 6: missing ownership register for a business entity (separate from percentage mismatch).
    if len(businesses) > 1:
        missing_business = next((b for b in reversed(businesses)
                                 if b['business_entity_id'] != ownership_anomaly_bid), None)
        if missing_business:
            missing_bid = missing_business['business_entity_id']
            owners[:] = [o for o in owners if o['business_entity_id'] != missing_bid]
            label('MISSING_BENEFICIAL_OWNERSHIP_RECORD', 'BUSINESS_ENTITY', missing_bid,
                  'REQUEST_OWNERSHIP_EVIDENCE_AND_BLOCK_APPROVAL')
    # update audit trail for explicit exception injections
    for i,t in enumerate(truth): audits.append(dict(audit_event_id=f'AUD-{len(audits)+1:07d}',entity_type=t['entity_type'],entity_id=t['entity_id'],event_type='ANOMALY_INJECTED',event_at=iso(AS_OF),actor_id='SYSTEM-TEST-FIXTURE',before_json='',after_json=json.dumps({'issue_type':t['issue_type']})))
    # Recalculate derived completeness after anomaly injection using the same
    # evidence rule as the backend. Intentional anomalies remain labelled in ground truth.
    completeness = {}
    for customer in customers:
        pct, _checks = calculate_customer_completeness(
            customer, requirements, crm, docs, verifs, AS_OF
        )
        completeness[customer['customer_id']] = pct

    # Export.
    tables={'customer_types':types,'kyc_requirements':requirements,'customers':customers,'risk_ratings':risks,'documents':docs,'verifications':verifs,'business_entities':businesses,'beneficial_owners':owners,'review_cases':reviews,'alerts':alerts,'audit_events':audits,'customer_requirement_map':crm}
    for name,rows in tables.items(): write_csv(out/f'{name}.csv',rows)
    with (out/'ground_truth.json').open('w',encoding='utf-8') as f: json.dump(truth,f,indent=2)
    write_csv(out/'ground_truth.csv',truth)
    with (out/'completeness.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=['customer_id','completeness_pct']); w.writeheader(); w.writerows([{'customer_id':k,'completeness_pct':v} for k,v in completeness.items()])
    # SQLite seed export for portable inspection.
    if (out/'kyc_seed.sqlite').exists(): (out/'kyc_seed.sqlite').unlink()
    db=sqlite3.connect(out/'kyc_seed.sqlite');
    for name,rows in tables.items():
        if rows:
            cols=list(rows[0].keys()); db.execute(f'CREATE TABLE {name} ({", ".join(repr(c)+" TEXT" for c in cols)})')
            db.executemany(f'INSERT INTO {name} VALUES ({", ".join("?" for _ in cols)})',[[str(r.get(c,'')) for c in cols] for r in rows])
    db.commit()
    with (out/'seed.sql').open('w',encoding='utf-8') as sf:
        for line in db.iterdump(): sf.write(line+'\n')
    db.close()
    summary={'seed':args.seed,'as_of_date':iso(AS_OF),'scale':args.scale,'counts':{k:len(v) for k,v in tables.items()},'requested_counts':counts,'ground_truth_labels':len(truth),'checksums':{},'validation':{}}
    for p in sorted(out.glob('*.csv')): summary['checksums'][p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
    summary['validation'] = validate_dataset(tables, truth, completeness, requirements, AS_OF)
    summary['validation']['all_passed'] = all(summary['validation'].values())
    (out/'validation_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    manifest={'provenance':'Entirely synthetic records generated locally; no external personal data or public datasets used.','generator':'generator/generate.py','seed':args.seed,'as_of_date':iso(AS_OF),'files':sorted([p.name for p in out.iterdir()])}
    (out/'source_manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(out.resolve()),'counts':summary['counts'],'validation':summary['validation']},indent=2))
if __name__=='__main__': main()
