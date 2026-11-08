#!/usr/bin/env bash
set -euo pipefail
python generator/generate.py --scale full --seed 20261022 --out /tmp/kyc-run-a
python generator/validate.py --input /tmp/kyc-run-a
python generator/generate.py --scale full --seed 20261022 --out /tmp/kyc-run-b
python generator/validate.py --input /tmp/kyc-run-b
python - <<'PY'
import json
A=json.load(open('/tmp/kyc-run-a/validation_summary.json'))['checksums']
B=json.load(open('/tmp/kyc-run-b/validation_summary.json'))['checksums']
assert A == B, 'Reproducibility check failed'
print('PASS: same-seed CSV checksums match')
PY
