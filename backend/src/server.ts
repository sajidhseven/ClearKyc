
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173'
}));
app.use(express.json());
app.use(morgan('dev'));

const asyncRoute = (
  fn: (req: express.Request, res: express.Response) => Promise<unknown>
) => (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  fn(req, res).catch(next);
};

type Role =
  | 'SYSTEM_ADMIN'
  | 'OPERATIONS_ANALYST'
  | 'RISK_REVIEWER';

type Actor = {
  id: string;
  email: string;
  role: Role;
};

const secret = process.env.JWT_SECRET;

if (!secret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}

const jwtSecret = secret || 'development-only-change-this-secret';

const authenticate = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({
      error: 'Bearer token required'
    });
  }

  try {
    (req as any).actor = jwt.verify(token, jwtSecret) as Actor;
    next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
};

const authorize = (...roles: Role[]) => (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const actor = (req as any).actor as Actor;

  if (!actor || !roles.includes(actor.role)) {
    return res.status(403).json({
      error: 'Insufficient role'
    });
  }

  next();
};


const startOfUtcDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const isEffectiveOn = (record: { effectiveFrom?: Date; effectiveTo?: Date | null }, asOf: Date) => {
  const day = startOfUtcDay(asOf).getTime();
  const from = record.effectiveFrom ? startOfUtcDay(new Date(record.effectiveFrom)).getTime() : Number.NEGATIVE_INFINITY;
  const to = record.effectiveTo ? startOfUtcDay(new Date(record.effectiveTo)).getTime() : Number.POSITIVE_INFINITY;
  return from <= day && to >= day;
};

type KycEvidenceCustomer = {
  requirementLinks: Array<{
    effectiveFrom: Date;
    effectiveTo: Date | null;
    requirement: {
      id: string;
      name: string;
      documentType: string;
      mandatory: boolean;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    };
  }>;
  documents: Array<{
    id: string;
    documentType: string;
    status: string;
    expiryDate: Date | null;
    nameMatchStatus: string;
    verifications: Array<{ status: string; createdAt?: Date }> ;
  }>;
  business?: { owners: Array<{ ownershipPct: unknown }> } | null;
};

/** Shared evidence rule used by both the completeness endpoint and approval gate. */
const calculateKycCompleteness = (customer: KycEvidenceCustomer, asOf = new Date()) => {
  const required = customer.requirementLinks.filter(link =>
    link.requirement.mandatory &&
    isEffectiveOn(link, asOf) &&
    isEffectiveOn(link.requirement, asOf)
  );

  const checks = required.map(link => {
    const matchingDocuments = customer.documents.filter(
      document => document.documentType === link.requirement.documentType
    );

    const satisfied = matchingDocuments.some(document => {
      const expiryValid = !document.expiryDate ||
        startOfUtcDay(new Date(document.expiryDate)).getTime() >= startOfUtcDay(asOf).getTime();
      const latestVerification = document.verifications[0];

      return document.status === 'VERIFIED' &&
        expiryValid &&
        document.nameMatchStatus === 'MATCH' &&
        latestVerification?.status === 'APPROVED';
    });

    return {
      requirementId: link.requirement.id,
      requirement: link.requirement.name,
      documentType: link.requirement.documentType,
      mandatory: true,
      satisfied
    };
  });

  const ownershipTotalPct = customer.business?.owners.reduce(
    (sum, owner) => sum + Number(owner.ownershipPct),
    0
  ) ?? 0;
  const ownershipValid = !customer.business || (
    customer.business.owners.length > 0 &&
    Math.abs(ownershipTotalPct - 100) <= 0.01
  );

  return {
    completenessPct: checks.length
      ? Math.round(100 * checks.filter(check => check.satisfied).length / checks.length)
      : 100,
    checks,
    ownershipTotalPct,
    ownershipValid
  };
};

const audit = async (
  tx: any,
  entityType: string,
  entityId: string,
  eventType: string,
  actorId: string,
  before: any,
  after: any,
  customerId?: string
) => {
  return tx.auditEvent.create({
    data: {
      id: `AUD-${randomUUID()}`,
      entityType,
      entityId,
      eventType,
      actorId,
      customerId,
      beforeJson: before ?? undefined,
      afterJson: after ?? undefined
    }
  });
};


// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'kyc-compliance-api'
  });
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

app.post('/api/auth/bootstrap', asyncRoute(async (req, res) => {
  const count = await prisma.user.count();

  if (count > 0) {
    return res.status(409).json({
      error: 'Bootstrap is disabled after the first account is created'
    });
  }

  const { email, password, fullName } = req.body;

  if (!email || !password || String(password).length < 12 || !fullName) {
    return res.status(400).json({
      error: 'email, fullName and password (12+ characters) are required'
    });
  }

  const user = await prisma.user.create({
    data: {
      email: String(email).toLowerCase(),
      fullName: String(fullName),
      passwordHash: await bcrypt.hash(String(password), 12),
      role: 'SYSTEM_ADMIN'
    }
  });

  res.status(201).json({
    id: user.id,
    email: user.email,
    role: user.role
  });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: {
      email: String(email || '').toLowerCase()
    }
  });

  if (
    !user ||
    !user.isActive ||
    !await bcrypt.compare(String(password || ''), user.passwordHash)
  ) {
    return res.status(401).json({
      error: 'Invalid credentials'
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    jwtSecret,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    },
    expiresIn: 28800
  });
}));

app.post(
  '/api/users',
  authenticate,
  authorize('SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const { email, password, fullName, role } = req.body;

    if (
      !email ||
      !password ||
      String(password).length < 12 ||
      !fullName ||
      !['SYSTEM_ADMIN', 'OPERATIONS_ANALYST', 'RISK_REVIEWER'].includes(role)
    ) {
      return res.status(400).json({
        error: 'Valid email, fullName, role and password (12+ characters) required'
      });
    }

    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        passwordHash: await bcrypt.hash(String(password), 12),
        fullName: String(fullName),
        role
      }
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role
    });
  })
);

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------


app.get('/api/dashboard', authenticate, asyncRoute(async (_req, res) => {
  const [
    customers,
    documents,
    reviews,
    alerts,
    businesses,
    risks
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.document.count(),
    prisma.reviewCase.count(),
    prisma.alert.count({
      where: { status: 'OPEN' }
    }),
    prisma.businessEntity.count(),
    prisma.customer.groupBy({
      by: ['declaredRisk'],
      _count: { _all: true }
    })
  ]);

  const [
    approved,
    expired,
    overdue,
    customersWithEvidence
  ] = await Promise.all([
    prisma.customer.count({
      where: { state: 'APPROVED' }
    }),
    prisma.document.count({
      where: {
        expiryDate: { lt: new Date() },
        status: { not: 'EXPIRED' }
      }
    }),
    prisma.reviewCase.count({
      where: {
  status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] },
  dueDate: { lt: new Date() }
}
    }),
    prisma.customer.findMany({
      include: {
        requirementLinks: {
          include: { requirement: true }
        },
        documents: {
          include: {
            verifications: {
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        },
        business: {
          include: { owners: true }
        }
      }
    })
  ]);

  // Count customers with incomplete mandatory KYC evidence
  // or invalid beneficial ownership.
  const incomplete = customersWithEvidence.filter(customer => {
    const result = calculateKycCompleteness(customer);

    return result.completenessPct < 100 || !result.ownershipValid;
  }).length;

  res.json({
    customers,
    documents,
    reviews,
    openAlerts: alerts,
    businesses,
    approved,
    incomplete,
    expiredMarkedNotExpired: expired,
    overdueReviews: overdue,
    riskDistribution: risks
  });
}));


// --------------------------------------------------
// CUSTOMER REGISTER
// --------------------------------------------------

app.get('/api/customers', authenticate, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const q = String(req.query.q || '');

  const where = q
    ? {
        OR: [
          {
            id: {
              contains: q,
              mode: 'insensitive' as const
            }
          },
          {
            legalName: {
              contains: q,
              mode: 'insensitive' as const
            }
          },
          {
            email: {
              contains: q,
              mode: 'insensitive' as const
            }
          }
        ]
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        customerType: true,
        riskRatings: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        },
        _count: {
          select: {
            documents: true,
            reviews: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.customer.count({ where })
  ]);

  res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
}));

// CUSTOMER DETAIL
app.get('/api/customers/:id',authenticate, asyncRoute(async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      customerType: true,
      documents: {
        include: {
          verifications: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      },
      riskRatings: {
        orderBy: { effectiveFrom: 'desc' }
      },
      reviews: {
        orderBy: { dueDate: 'asc' }
      },
      alerts: {
        orderBy: { triggerDate: 'desc' }
      },
      business: {
        include: { owners: true }
      },
      requirementLinks: {
        include: { requirement: true }
      },
      _count: {
        select: {
          documents: true,
          reviews: true
        }
      }
    }
  });

  if (!customer) {
    return res.status(404).json({
      error: 'Customer not found'
    });
  }

  res.json(customer);
}));

// CUSTOMER KYC COMPLETENESS
app.get('/api/customers/:id/completeness', authenticate, asyncRoute(async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      requirementLinks: {
        include: { requirement: true }
      },
      documents: {
        include: {
          verifications: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      },
      business: {
        include: { owners: true }
      }
    }
  });

  if (!customer) {
    return res.status(404).json({
      error: 'Customer not found'
    });
  }

  const result = calculateKycCompleteness(customer);

  res.json({
    customerId: customer.id,
    ...result
  });
}));

// --------------------------------------------------
// DOCUMENT REGISTER
// --------------------------------------------------

app.get('/api/documents',authenticate, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const q = String(req.query.q || '');
  const status = String(req.query.status || '');

  const where: any = {};

  if (q) {
    where.OR = [
      {
        id: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        documentType: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        customer: {
          legalName: {
            contains: q,
            mode: 'insensitive'
          }
        }
      }
    ];
  }

  if (status) {
    where.status = status;
  }

  const [items, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            legalName: true
          }
        },
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { uploadedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.document.count({ where })
  ]);

  res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
}));


// --------------------------------------------------
// DUPLICATE DOCUMENT DETECTION
// --------------------------------------------------

app.get('/api/documents/duplicates', authenticate, asyncRoute(async (_req, res) => {
  const documents = await prisma.document.findMany({
    select: {
      id: true,
      customerId: true,
      documentType: true,
      fileHash: true,
      status: true,
      customer: {
        select: {
          legalName: true
        }
      }
    },
    orderBy: { id: 'asc' }
  });

  const hashGroups = new Map<string, typeof documents>();

  for (const document of documents) {
    const group = hashGroups.get(document.fileHash) ?? [];
    group.push(document);
    hashGroups.set(document.fileHash, group);
  }

  const duplicates = Array.from(hashGroups.entries())
    .map(([fileHash, group]) => {
      const distinctCustomers = new Set(
        group.map(document => document.customerId)
      );

      if (distinctCustomers.size < 2) return null;

      return {
        fileHash,
        affectedCustomers: distinctCustomers.size,
        documents: group.map(document => ({
          id: document.id,
          customerId: document.customerId,
          customerName: document.customer.legalName,
          documentType: document.documentType,
          status: document.status
        }))
      };
    })
    .filter(Boolean);

  res.json({
    totalDuplicateGroups: duplicates.length,
    duplicates
  });
}));


// --------------------------------------------------
// REVIEWS
// --------------------------------------------------

app.get('/api/reviews', authenticate, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');

  const where: any = {};
  if (q) {
    where.OR = [
      { id: { contains: q, mode: 'insensitive' } },
      { reviewType: { contains: q, mode: 'insensitive' } },
      { customer: { legalName: { contains: q, mode: 'insensitive' } } }
    ];
  }
  if (status && status !== 'ALL') {
    if (status === 'OVERDUE') {
  where.status = { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] };
  where.dueDate = { lt: new Date() };
} else {
      where.status = status;
    }
  }

  const [items, total] = await Promise.all([
    prisma.reviewCase.findMany({
      where,
      include: {
        customer: { select: { id: true, legalName: true, declaredRisk: true } }
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.reviewCase.count({ where })
  ]);

  res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
}));

// --------------------------------------------------
// ALERTS
// --------------------------------------------------



app.get('/api/alerts', authenticate, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');

  const where: any = {};

  // Preserve status filtering.
  if (status && status !== 'ALL') {
    where.status = status;
  }

  // Search only string fields.
  // Alert type is an enum, so do not use contains on it.
  if (q) {
    where.OR = [
      {
        id: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        customer: {
          legalName: {
            contains: q,
            mode: 'insensitive'
          }
        }
      }
    ];
  }

  const [items, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            legalName: true
          }
        },
        document: true
      },
      orderBy: [
        { severity: 'desc' },
        { triggerDate: 'desc' },
        { id: 'asc' }
      ],
      skip: (page - 1) * limit,
      take: limit
    }),

    prisma.alert.count({ where })
  ]);

  res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
}));


// ACKNOWLEDGE ALERT
app.post(
  '/api/alerts/:id/acknowledge',
  authenticate,
  authorize('OPERATIONS_ANALYST', 'RISK_REVIEWER', 'SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const current = await prisma.alert.findUnique({
      where: { id: req.params.id }
    });

    if (!current) {
      return res.status(404).json({
        error: 'Alert not found'
      });
    }

    if (current.status !== 'OPEN') {
      return res.status(409).json({
        error: 'Only open alerts can be acknowledged'
      });
    }

    const actor = (req as any).actor as Actor;

    const result = await prisma.$transaction(async tx => {
      const updated = await tx.alert.update({
        where: { id: current.id },
        data: { status: 'ACKNOWLEDGED' }
      });

      await audit(
        tx,
        'ALERT',
        current.id,
        'ALERT_ACKNOWLEDGED',
        actor.id,
        { status: current.status },
        { status: updated.status },
        current.customerId
      );

      return updated;
    });

    res.json(result);
  })
);

// --------------------------------------------------
// AUDIT HISTORY
// --------------------------------------------------

app.get(
  '/api/audit/:entityType/:entityId',
  authenticate,
  authorize('SYSTEM_ADMIN', 'RISK_REVIEWER'),
  asyncRoute(async (req, res) => {
    const events = await prisma.auditEvent.findMany({
      where: {
        entityType: req.params.entityType,
        entityId: req.params.entityId
      },
      orderBy: { eventAt: 'desc' }
    });

    res.json(events);
  })
);

// --------------------------------------------------
// DOCUMENT VERIFICATION
// --------------------------------------------------

app.post(
  '/api/documents/:id/verify',
  authenticate,
  authorize('RISK_REVIEWER', 'SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const { decision, notes } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({
        error: 'decision must be APPROVED or REJECTED'
      });
    }

    const doc = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      return res.status(404).json({
        error: 'Document not found'
      });
    }

    if (doc.expiryDate && doc.expiryDate < new Date()) {
      return res.status(409).json({
        error: 'An expired document cannot be approved'
      });
    }

    const actor = (req as any).actor as Actor;

    const result = await prisma.$transaction(async tx => {
      const verification = await tx.verification.create({
        data: {
          id: `VER-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          documentId: doc.id,
          status: decision,
          verifiedAt: new Date(),
          reviewerId: actor.id,
          method: 'MANUAL_REVIEW'
        }
      });

      const updated = await tx.document.update({
        where: { id: doc.id },
        data: {
          status: decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED'
        }
      });

      await audit(
        tx,
        'DOCUMENT',
        doc.id,
        'DOCUMENT_VERIFICATION_DECIDED',
        actor.id,
        { status: doc.status },
        {
          status: updated.status,
          decision,
          notes: notes || null
        },
        doc.customerId
      );

      return {
        verification,
        document: updated
      };
    });

    res.json(result);
  })
);

// --------------------------------------------------
// CUSTOMER APPROVAL
// --------------------------------------------------

app.post(
  '/api/customers/:id/approve',
  authenticate,
  authorize('RISK_REVIEWER', 'SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        requirementLinks: {
          include: { requirement: true }
        },
        documents: {
          include: {
            verifications: {
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        },
        business: {
          include: { owners: true }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        error: 'Customer not found'
      });
    }

    const kycResult = calculateKycCompleteness(customer);
    const missing = kycResult.checks.filter(item => !item.satisfied);
    const total = kycResult.ownershipTotalPct;

    if (
      missing.length ||
      !kycResult.ownershipValid
    ) {
      return res.status(409).json({
        error: 'Approval blocked by KYC controls',
        missingRequirements: missing.map(item => item.requirement),
        ownershipTotalPct: total
      });
    }

    const actor = (req as any).actor as Actor;

    const result = await prisma.$transaction(async tx => {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { state: 'APPROVED' }
      });

      await audit(
        tx,
        'CUSTOMER',
        customer.id,
        'CUSTOMER_APPROVED',
        actor.id,
        { state: customer.state },
        { state: 'APPROVED' },
        customer.id
      );

      return updated;
    });

    res.json(result);
  })
);

// --------------------------------------------------
// REVIEW CLOSURE
// --------------------------------------------------

app.post(
  '/api/reviews/:id/close',
  authenticate,
  authorize('OPERATIONS_ANALYST', 'RISK_REVIEWER', 'SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const resolution = String(req.body.resolution || '').trim();

    if (!resolution) {
      return res.status(400).json({
        error: 'A resolution is required to close a review'
      });
    }

    const current = await prisma.reviewCase.findUnique({
      where: { id: req.params.id }
    });

    if (!current) {
      return res.status(404).json({
        error: 'Review not found'
      });
    }

    if (current.status === 'CLOSED') {
      return res.status(409).json({
        error: 'Review is already closed'
      });
    }

    const actor = (req as any).actor as Actor;

    const result = await prisma.$transaction(async tx => {
      const updated = await tx.reviewCase.update({
        where: { id: current.id },
        data: {
          status: 'CLOSED',
          resolution,
          closedDate: new Date()
        }
      });

      await audit(
        tx,
        'REVIEW_CASE',
        current.id,
        'REVIEW_CLOSED',
        actor.id,
        {
          status: current.status,
          resolution: current.resolution
        },
        {
          status: 'CLOSED',
          resolution
        },
        current.customerId
      );

      return updated;
    });

    res.json(result);
  })
);

// --------------------------------------------------
// ALERT RESOLUTION
// --------------------------------------------------

app.post(
  '/api/alerts/:id/resolve',
  authenticate,
  authorize('OPERATIONS_ANALYST', 'RISK_REVIEWER', 'SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const current = await prisma.alert.findUnique({
      where: { id: req.params.id }
    });

    if (!current) {
      return res.status(404).json({
        error: 'Alert not found'
      });
    }

    if (current.status === 'RESOLVED') {
      return res.status(409).json({
        error: 'Alert is already resolved'
      });
    }

    const actor = (req as any).actor as Actor;

    const result = await prisma.$transaction(async tx => {
      const updated = await tx.alert.update({
        where: { id: current.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date()
        }
      });

      await audit(
        tx,
        'ALERT',
        current.id,
        'ALERT_RESOLVED',
        actor.id,
        { status: current.status },
        { status: 'RESOLVED' },
        current.customerId
      );

      return updated;
    });

    res.json(result);
  })
);

// --------------------------------------------------
// BENEFICIAL OWNERSHIP
// --------------------------------------------------

app.post(
  '/api/businesses/:id/owners',
  authenticate,
  authorize('OPERATIONS_ANALYST', 'SYSTEM_ADMIN'),
  asyncRoute(async (req, res) => {
    const { ownerName, ownershipPct, isPep } = req.body;
    const pct = Number(ownershipPct);

    if (
      !ownerName ||
      !Number.isFinite(pct) ||
      pct <= 0 ||
      pct > 100
    ) {
      return res.status(400).json({
        error: 'ownerName and ownershipPct between 0 and 100 are required'
      });
    }

    const business = await prisma.businessEntity.findUnique({
      where: { id: req.params.id },
      include: { owners: true }
    });

    if (!business) {
      return res.status(404).json({
        error: 'Business entity not found'
      });
    }

    const total = business.owners
      .filter(owner => !owner.effectiveTo)
      .reduce(
        (sum, owner) => sum + Number(owner.ownershipPct),
        0
      );

    if (total + pct > 100.01) {
      return res.status(409).json({
        error: 'Ownership would exceed 100%',
        currentPct: total,
        requestedPct: pct
      });
    }

    const actor = (req as any).actor as Actor;

    const owner = await prisma.$transaction(async tx => {
      const created = await tx.beneficialOwner.create({
        data: {
          id: `UBO-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          businessEntityId: business.id,
          ownerName: String(ownerName),
          ownershipPct: pct,
          isPep: !!isPep,
          effectiveFrom: new Date()
        }
      });

      await audit(
        tx,
        'BUSINESS_ENTITY',
        business.id,
        'BENEFICIAL_OWNER_ADDED',
        actor.id,
        null,
        {
          ownerName,
          ownershipPct: pct
        },
        business.customerId
      );

      return created;
    });

    res.status(201).json(owner);
  })
);

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((
  err: Error,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  console.error(err);

  res.status(500).json({
    error: 'Internal server error'
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`KYC API listening on ${port}`);
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
