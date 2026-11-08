# Build and verification status

## Generated full dataset (seed 20261022; as-of 2026-11-06)

| Dataset | Rows |
|---|---:|
| Customers | 8,000 |
| Documents | 20,000 |
| Business entities | 1,000 |
| Review cases | 3,000 |
| Verifications | 20,000 |
| Risk ratings | 8,000 |
| Beneficial owners | 2,018 |
| Alerts | 6,295 |
| Audit events | 8,006 |
| Customer-requirement bridge links | 21,502 |
| Ground-truth exceptions | 6 |

## Checks performed

- Primary-key uniqueness and foreign-key joins: passed.
- Allowed document/risk enums: passed.
- Document and review date ordering: passed.
- Closed-review resolution exception: detected and labelled.
- Required five anomaly classes: present in separate ground truth.
- Missing beneficial ownership: present as an additional labelled exception.
- Ground truth absent from source entity feature columns: passed.
- Full dataset generated twice with seed 20261022: all CSV SHA-256 checksums matched.

## Runtime verification limitation

The Python generator and cross-file validator were executed successfully. Node package installation did not complete in the build environment, so Prisma validation and React/API dependency-backed build/runtime tests could not be run here. Follow the README quick-start commands in an environment with npm registry access and Docker/PostgreSQL.
