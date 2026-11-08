# ClearKYC

### KYC Compliance Management System

A full-stack KYC compliance operations platform for customer onboarding,
evidence verification, risk-based due diligence, beneficial ownership
monitoring, periodic reviews, alerts, and audit traceability.

ClearKYC demonstrates how a compliance operations team can manage
customer records and evidence, apply server-side business rules,
identify operational exceptions, and retain an auditable history of
state-changing actions.

> **Project scope:** ClearKYC is an engineering assessment and
> demonstration project built with synthetic data. It is not a certified
> production banking, legal, or regulatory compliance solution.

------------------------------------------------------------------------

## Table of contents

-   [Project overview](#project-overview)
-   [Key capabilities](#key-capabilities)
-   [Technology stack](#technology-stack)
-   [Architecture](#architecture)
-   [Repository structure](#repository-structure)
-   [Getting started](#getting-started)
-   [Create the first administrator](#create-the-first-administrator)
-   [Run the application](#run-the-application)
-   [How to evaluate the application](#how-to-evaluate-the-application)
-   [API overview](#api-overview)
-   [Business rules](#business-rules)
-   [Synthetic data and
    reproducibility](#synthetic-data-and-reproducibility)
-   [Validation performed](#validation-performed)
-   [Security and data privacy](#security-and-data-privacy)
-   [Known scope and production
    considerations](#known-scope-and-production-considerations)
-   [Author](#author)

------------------------------------------------------------------------

## Project overview

ClearKYC brings together a React-based operations dashboard, a REST API,
a PostgreSQL database, and a reproducible synthetic-data generator.

The application covers the core operational areas of a KYC workflow:

-   Customer records and KYC requirements
-   Document evidence and verification decisions
-   KYC completeness evaluation
-   Risk classifications and periodic reviews
-   Compliance alerts and exception handling
-   Business entities and beneficial ownership
-   Audit history for operational changes

### Demonstration dataset

The full synthetic dataset is designed around the following scale:

  Data area                Records
  ---------------------- ---------
  Customers                  8,000
  Documents                 20,000
  Verification records      20,000
  Business entities          1,000
  Review cases               3,000

The generator also creates related requirements, risk ratings,
beneficial-owner records, alerts, audit events, and ground-truth
exception labels.

## Key capabilities

  -----------------------------------------------------------------------
  Area                                What the application demonstrates
  ----------------------------------- -----------------------------------
  Customer management                 Searchable customer register,
                                      customer classification, risk
                                      information, and KYC status

  Document management                 Evidence register, verification
                                      decisions, and expiry-aware
                                      validation

  KYC completeness                    Requirement-based calculation using
                                      mandatory evidence

  Risk and reviews                    Risk-oriented review tracking, due
                                      dates, overdue identification, and
                                      closure workflow

  Alerts                              Alert listing, acknowledgement, and
                                      resolution

  Beneficial ownership                Business ownership records and
                                      percentage validation

  Audit history                       Traceability of state-changing
                                      operations, including actor,
                                      timestamp, entity, and state
                                      changes

  Operations dashboard                Summary metrics and visual overview
                                      of the KYC workload
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## Technology stack

  Layer                         Technologies
  ----------------------------- -----------------------------------------
  Frontend                      React, TypeScript, Vite
  UI and charts                 Custom React UI, Recharts, Lucide icons
  Backend                       Node.js, Express.js, TypeScript
  Database                      PostgreSQL
  ORM                           Prisma
  Authentication                JWT, bcrypt
  Security middleware           Helmet, CORS
  Data generation               Python, CSV, JSON, SQLite
  Local infrastructure          Docker Compose
  Development and API testing   npm, Git, Postman

## Architecture

``` text
                 ClearKYC Web Application
                           |
              +------------+------------+
              |                         |
        React + TypeScript          REST API
          Frontend              Node + Express
              |                         |
              |                 JWT authentication
              |                 Role-based access
              |                         |
              +------------+------------+
                           |
                       Prisma ORM
                           |
                       PostgreSQL
                           |
             +-------------+-------------+
             |                           |
       KYC operations                Audit events
             |
  Customers | Documents | Reviews
  Alerts    | Ownership | Risk data


             Synthetic data pipeline
                        |
                 Python generator
                        |
                   CSV / JSON
                        |
               PostgreSQL loader
                        |
                  PostgreSQL
```

## Repository structure

``` text
ClearKYC/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   └── server.ts
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Customers.tsx
│   │   │   ├── Documents.tsx
│   │   │   ├── Reviews.tsx
│   │   │   ├── Alerts.tsx
│   │   │   └── Profile.tsx
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── style.css
│   ├── index.html
│   └── package.json
│
├── generator/
│   ├── generate.py
│   ├── load_postgres.py
│   ├── validate.py
│   └── requirements.txt
│
├── docs/
├── docker-compose.yml
├── .gitignore
└── README.md
```

The frontend is organized by application area. Each page component is
responsible for its corresponding section, while `App.tsx` coordinates
the application shell and navigation.

------------------------------------------------------------------------

## Getting started

The following instructions describe a local development setup from a
fresh clone.

### Prerequisites

Install:

-   **Git**
-   **Node.js** (a current LTS release) and npm
-   **Python 3.10 or later**
-   **Docker Desktop** with Docker Compose

Check the installations:

``` bash
git --version
node --version
npm --version
python --version
docker --version
docker compose version
```

### 1. Clone the repository

Replace the URL with the public GitHub repository URL:

``` bash
git clone https://github.com/sajidhseven/ClearKyc.git
cd ClearKyc
```

### 2. Start PostgreSQL

From the repository root:

``` bash
docker compose up -d postgres
docker compose ps
```

The supplied Compose configuration is intended for local development.
Review `docker-compose.yml` before using it in any shared or production
environment.

### 3. Configure the backend

Open a terminal at the repository root:

``` bash
cd backend
```

Create the local environment file.

**Windows PowerShell:**

``` powershell
Copy-Item .env.example .env
```

**macOS / Linux:**

``` bash
cp .env.example .env
```

Open `backend/.env` and check the database connection, port, CORS
origin, and JWT secret. The example values are for local development
only. Use a unique, strong JWT secret for your own environment.

Install backend dependencies and prepare Prisma:

``` bash
npm install
npx prisma generate
npx prisma db push
```

`prisma db push` applies the Prisma schema to the configured database.
Use a dedicated local assessment database, not a database containing
important data.

### 4. Generate the synthetic dataset

Open a new terminal at the repository root.

Install the Python dependencies:

``` bash
python -m pip install -r generator/requirements.txt
```

Generate the full dataset:

``` bash
python generator/generate.py --scale full --seed 20261022 --out generator/output-full
```

The fixed seed makes the generated dataset reproducible for the same
generator version and arguments.

### 5. Load the dataset into PostgreSQL

Use a database URL that matches the local PostgreSQL credentials and
database name configured for your environment.

Example for the local development database:

``` bash
python generator/load_postgres.py --input generator/output-full --database-url "postgresql://kyc:kycpass@localhost:5432/kycdb?schema=public" --truncate
```

> **Important:** `--truncate` clears the target application tables
> before importing the generated data. Run this only against a dedicated
> local assessment database. Do not point it at a database containing
> data you need to retain.

If you change the database name, username, or password in your local
setup, update the connection string accordingly.

### 6. Start the backend API

In a terminal:

``` bash
cd backend
npm run dev
```

The API runs at:

``` text
http://localhost:4000
```

Check its health endpoint:

``` text
http://localhost:4000/api/health
```

You should receive a successful health response when the backend is
running.

------------------------------------------------------------------------

## Create the first administrator

The initial administrator is created through the bootstrap endpoint.
This endpoint is available only while no user account exists.

**Windows PowerShell:**

``` powershell
$body = @{
  email = "admin@example.test"
  fullName = "System Administrator"
  password = "ChangeThisPassword123!"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/auth/bootstrap" `
  -ContentType "application/json" `
  -Body $body
```

Use a unique password for your local environment. The example password
is illustrative and should not be reused.

After the first account is created, the bootstrap endpoint is disabled.
Sign in through the application using the administrator credentials.

If an administrator already exists in the database, do not run bootstrap
again. Use the existing account or reset your dedicated local assessment
database if you intentionally want to start from a clean state.

------------------------------------------------------------------------

## Run the application

### Start the frontend

Open another terminal:

``` bash
cd frontend
npm install
npm run dev
```

Open the application:

**http://localhost:5173**

Keep the backend and frontend terminals running while using the
application.

### Production frontend build

To compile TypeScript and create the Vite production build:

``` bash
cd frontend
npm run build
```

To preview the generated frontend build locally:

``` bash
npm run preview
```

### Backend build

To compile the backend TypeScript:

``` bash
cd backend
npm run build
```

------------------------------------------------------------------------

## How to evaluate the application

After signing in, use the navigation to explore the following areas:

1.  **Dashboard** --- review the high-level operational metrics and
    workload overview.
2.  **Customers** --- search and inspect customer records, risk
    information, and KYC status.
3.  **Documents** --- inspect evidence records and exercise the document
    verification workflow.
4.  **Reviews** --- inspect review cases, due dates, and review closure
    workflow.
5.  **Alerts** --- inspect compliance alerts and exercise
    acknowledgement and resolution.
6.  **Profile** --- view the signed-in user information.

### Suggested workflow checks

Use the synthetic records and the application UI/API to explore these
controls:

-   Attempt to approve an expired document. The API should reject the
    operation.
-   Attempt to approve a customer with missing mandatory evidence. The
    API should reject the operation.
-   Attempt to close a review without a resolution. The API should
    reject the operation.
-   Attempt an ownership change that would take active ownership above
    100%. The API should reject the operation.
-   Acknowledge and resolve an alert, then inspect the corresponding
    audit history.

These are examples of business-rule checks implemented by the backend.
Use a local assessment database because successful workflow actions can
change record state.

------------------------------------------------------------------------

## API overview

The API is served from `http://localhost:4000`. Protected endpoints
require a valid bearer token.

  ------------------------------------------------------------------------------------
  Method                  Endpoint                             Purpose
  ----------------------- ------------------------------------ -----------------------
  GET                     `/api/health`                        API health check

  POST                    `/api/auth/bootstrap`                Create the initial
                                                               administrator when no
                                                               user exists

  POST                    `/api/auth/login`                    Authenticate a user

  POST                    `/api/users`                         Create a user
                                                               (authorized role
                                                               required)

  GET                     `/api/dashboard`                     Retrieve dashboard
                                                               metrics

  GET                     `/api/customers`                     Retrieve the customer
                                                               register

  GET                     `/api/customers/:id`                 Retrieve customer
                                                               details

  GET                     `/api/customers/:id/completeness`    Retrieve customer KYC
                                                               completeness

  GET                     `/api/documents`                     Retrieve the document
                                                               register

  GET                     `/api/documents/duplicates`          Retrieve
                                                               duplicate-document
                                                               findings

  GET                     `/api/reviews`                       Retrieve review cases

  GET                     `/api/alerts`                        Retrieve compliance
                                                               alerts

  POST                    `/api/documents/:id/verify`          Verify or reject a
                                                               document

  POST                    `/api/customers/:id/approve`         Approve a customer,
                                                               subject to KYC controls

  POST                    `/api/reviews/:id/close`             Close a review with a
                                                               resolution

  POST                    `/api/alerts/:id/acknowledge`        Acknowledge an alert

  POST                    `/api/alerts/:id/resolve`            Resolve an alert

  POST                    `/api/businesses/:id/owners`         Add a beneficial owner

  GET                     `/api/audit/:entityType/:entityId`   Retrieve entity audit
                                                               history
  ------------------------------------------------------------------------------------

For protected requests, include:

``` http
Authorization: Bearer <JWT_TOKEN>
```

The API applies server-side authentication, authorization, request
validation, and compliance business rules. Exact request fields and
response shapes can be inspected in `backend/src/server.ts`.

------------------------------------------------------------------------

## Business rules

The main compliance controls demonstrated by the application include:

1.  Mandatory KYC requirements are evaluated against the applicable
    customer type and active requirements.
2.  Evidence must be verified, unexpired, name-matched, and have an
    approved latest verification decision to satisfy a mandatory
    requirement.
3.  Customer approval is blocked when mandatory KYC evidence is
    incomplete.
4.  Expired documents cannot be approved.
5.  Active beneficial ownership must reconcile to 100%, within the
    implemented tolerance.
6.  Review closure requires a resolution.
7.  Alerts support acknowledgement and resolution state changes.
8.  State-changing operational workflows generate audit events.
9.  Duplicate-document findings are exposed through a read-only API
    endpoint.

KYC completeness is calculated as:

**Completeness (%) = (Satisfied mandatory requirements / Total mandatory
requirements) × 100**

The implementation evaluates applicable active mandatory requirements
rather than simply counting uploaded documents.

------------------------------------------------------------------------

## Synthetic data and reproducibility

The Python generator supports full, starter, and custom dataset sizes.

### Full dataset

``` bash
python generator/generate.py --scale full --seed 20261022 --out generator/output-full
```

### Starter dataset

``` bash
python generator/generate.py --scale starter --out generator/output-starter
```

### Custom dataset

``` bash
python generator/generate.py --customers 500 --documents 1300 --businesses 60 --reviews 180 --seed 20261022 --out generator/output-custom
```

### Validate generated data

``` bash
python generator/validate.py --input generator/output-full
```

The generator produces structured synthetic records and validation
outputs. Ground-truth exception labels are maintained separately from
operational application records; they are intended for evaluation and
validation, not as application workflow state.

------------------------------------------------------------------------

## Validation performed

During development, the following areas were exercised:

-   Frontend production compilation.
-   Backend TypeScript compilation.
-   Database connectivity and imported record counts.
-   Authentication and protected API access.
-   Customer, document, review, and alert retrieval.
-   KYC completeness calculations.
-   Document verification and expired-document rejection.
-   Customer approval restrictions for incomplete KYC.
-   Review closure validation.
-   Alert acknowledgement and resolution.
-   Beneficial ownership percentage validation.
-   Audit event creation and retrieval.
-   Generator validation and deterministic output checks.

The above describes development validation, not a claim of comprehensive
automated test-suite coverage. For a fresh checkout, use the build and
workflow checks in this README to verify your local environment.

------------------------------------------------------------------------

## Security and data privacy

-   All generated customer and business records are synthetic.
-   The project does not require real customer information.
-   `.env` files and local secrets must remain uncommitted.
-   The repository includes `.env.example` as a configuration template.
-   Passwords are hashed using bcrypt.
-   Protected API routes use JWT authentication and role-based
    authorization.
-   The local Docker Compose credentials are development-only and must
    be changed for any shared deployment.

Never commit database passwords, JWT secrets, API keys, real identity
documents, database dumps, or local environment files.

------------------------------------------------------------------------

## Known scope and production considerations

ClearKYC is an assessment project demonstrating selected KYC operations
and backend controls. It should not be represented as a certified
production compliance platform.

A production deployment would require additional engineering and
governance, including:

-   Enterprise identity integration and multi-factor authentication.
-   Secure document storage, retention policies, and malware scanning.
-   Production secrets management and key rotation.
-   Comprehensive automated integration, security, and performance
    testing.
-   Centralized monitoring, alerting, and incident response.
-   Backup, disaster recovery, and operational access policies.
-   Formal legal, regulatory, and compliance review.
-   A controlled production deployment and change-management process.

------------------------------------------------------------------------

## Author

**Mohammad Sajidh Ali**  
Full-Stack Developer | React.js | TypeScript | Node.js | Express.js

- **Portfolio:** [Visit My Portfolio](https://sajidhh-portfolio.vercel.app/)
- **LinkedIn:** [Connect with Me](https://www.linkedin.com/in/mohammad-sajidh-ali-633bb3212/)
- **GitHub:** [View My GitHub](https://github.com/sajidhseven)

------------------------------------------------------------------------

*ClearKYC was built to demonstrate full-stack application development,
relational data modeling, compliance-oriented business logic,
server-side validation, reproducible synthetic data generation, and
auditable operational workflows.*
