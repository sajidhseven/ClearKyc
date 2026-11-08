#!/usr/bin/env python3
"""Cross-file integrity and domain validation for generated CSVs."""
import csv, json, argparse
from pathlib import Path
from datetime import date

def read(p):
    with p.open(newline='',encoding='utf-8') as f:return list(csv.DictReader(f))
def unique(rows,key):return len({r[key] for r in rows})==len(rows)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',default='generator/output');a=ap.parse_args();p=Path(a.input)
    names=['customers','documents','verifications','business_entities','beneficial_owners','review_cases','alerts','audit_events','customer_requirement_map','kyc_requirements','risk_ratings']
    t={n:read(p/f'{n}.csv') for n in names}; truth=json.loads((p/'ground_truth.json').read_text())
    cids={x['customer_id'] for x in t['customers']};dids={x['document_id'] for x in t['documents']};bids={x['business_entity_id'] for x in t['business_entities']};rids={x['kyc_requirement_id'] for x in t['kyc_requirements']}
    checks={
      'customer_pk_unique':unique(t['customers'],'customer_id'), 'document_pk_unique':unique(t['documents'],'document_id'),
      'verification_pk_unique':unique(t['verifications'],'verification_id'),'review_pk_unique':unique(t['review_cases'],'review_case_id'),
      'alert_pk_unique':unique(t['alerts'],'alert_id'),'customer_document_fk':all(x['customer_id'] in cids for x in t['documents']),
      'document_verification_fk':all(x['document_id'] in dids for x in t['verifications']),'business_customer_fk':all(x['customer_id'] in cids for x in t['business_entities']),
      'owner_business_fk':all(x['business_entity_id'] in bids for x in t['beneficial_owners']),'review_customer_fk':all(x['customer_id'] in cids for x in t['review_cases']),
      'requirement_bridge_fk':all(x['customer_id'] in cids and x['kyc_requirement_id'] in rids for x in t['customer_requirement_map']),
      'document_status_enum':all(x['document_status'] in {'PENDING','VERIFIED','REJECTED','EXPIRED'} for x in t['documents']),
      'risk_enum':all(x['declared_risk'] in {'LOW','MEDIUM','HIGH'} for x in t['customers']),
      'document_date_order':all(not x['expiry_date'] or x['expiry_date']>x['issue_date'] for x in t['documents']),
      'review_date_order':all(x['due_date']>=x['opened_date'] and (not x['closed_date'] or x['closed_date']>=x['opened_date']) for x in t['review_cases']),
      'closed_review_resolution_baseline_or_labelled':all(x['review_status']!='CLOSED' or bool(x['resolution']) or any(g['entity_id']==x['review_case_id'] and g['issue_type']=='REVIEW_CLOSED_WITHOUT_RESOLUTION' for g in truth) for x in t['review_cases']),
      'ground_truth_is_separate':not any('issue_type' in x for x in t['customers']+t['documents']+t['review_cases']),
      'required_anomalies_present':all(k in {x['issue_type'] for x in truth} for k in ['EXPIRED_DOCUMENT_MARKED_VALID','APPROVED_WITH_MISSING_EVIDENCE','OWNERSHIP_OVER_100_PERCENT','REVIEW_CLOSED_WITHOUT_RESOLUTION','DUPLICATE_DOCUMENT_ACROSS_CUSTOMERS']),
    }
    ownership={}
    for x in t['beneficial_owners']:ownership.setdefault(x['business_entity_id'],0);ownership[x['business_entity_id']]+=float(x['ownership_pct'])
    checks['ownership_anomaly_labelled']=any(x['issue_type']=='OWNERSHIP_OVER_100_PERCENT' for x in truth)
    checks['missing_ownership_labelled']=any(x['issue_type']=='MISSING_BENEFICIAL_OWNERSHIP_RECORD' for x in truth)
    checks['duplicate_hash_labelled']=any(x['issue_type']=='DUPLICATE_DOCUMENT_ACROSS_CUSTOMERS' for x in truth)
    result={'input':str(p),'row_counts':{n:len(v) for n,v in t.items()},'ground_truth_rows':len(truth),'checks':checks,'all_passed':all(checks.values())}
    (p/'validation_detail.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['all_passed'] else 1)
if __name__=='__main__':main()
