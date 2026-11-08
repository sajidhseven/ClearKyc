
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Clock3, FileText, LayoutDashboard, LogIn, LogOut, Menu, Moon, RefreshCw, ShieldCheck, Sun, UserRound, Users, X,FileCheck2,
Building2,
ChevronRight, } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Customers from './components/Customers';
import Documents from './components/Documents';
import Reviews from './components/Reviews';
import Alerts from './components/Alerts';
import Profile from './components/Profile';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export type Tab = 'Overview' | 'Customers' | 'Documents' | 'Reviews' | 'Alerts & Exceptions' | 'My Profile';

export type Metrics = {
  customers: number;
  documents: number;
  reviews: number;
  openAlerts: number;
  businesses: number;
  approved: number;
  incomplete: number;
  expiredMarkedNotExpired: number;
  overdueReviews: number;
  riskDistribution: { declaredRisk: string; _count: { _all: number } }[];
};

export type Customer = {
  id: string;
  legalName: string;
  email: string;
  state: string;
  declaredRisk: string;
  country?: string;
  customerType?: { name: string };
  _count?: { documents: number; reviews: number };
};

export type DocumentRecord = {
  id: string;
  name?: string;
  documentType: string;
  documentNumber?: string;
  status: string;
  expiryDate?: string | null;
  customer?: { id: string; legalName: string };
};

export type Review = {
  id: string;
  reviewType: string;
  status: string;
  dueDate: string;
  customer?: { id: string; legalName: string };
};

export type Alert = {
  id: string;
  type: string;
  severity: string;
  status: string;
  dueDate?: string | null;
  customer: { id: string; legalName: string };
  document?: { documentType: string } | null;
};

export type CustomerDetail = Customer & {
  documents?: DocumentRecord[];
  reviews?: Review[];
  alerts?: Alert[];
  business?: { legalName?: string; owners?: { id: string; name: string; ownershipPercentage: number }[] };
  requirementLinks?: unknown[];
};

const emptyMetrics: Metrics = {
  customers: 0, documents: 0, reviews: 0, openAlerts: 0,
  businesses: 0, approved: 0, incomplete: 0,
  expiredMarkedNotExpired: 0, overdueReviews: 0, riskDistribution: []
};

async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || body.message || `Request failed (${response.status})`);
  }
  return body as T;
}

function rowsFrom<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'items' in result) {
    const items = (result as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

function date(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function pretty(value?: string) {
  return (value || '—').replace(/_/g, ' ');
}


type SessionProfile = {
  email?: string;
  name?: string;
  fullName?: string;
  role?: string;
  userId?: string;
  id?: string;
};

function readSessionProfile(token: string): SessionProfile {
  if (!token) return {};
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return {};
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const stringClaim = (...keys: string[]) => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) return value;
      }
      return undefined;
    };
    return {
      email: stringClaim('email', 'preferred_username', 'username'),
      name: stringClaim('name', 'fullName', 'full_name'),
      fullName: stringClaim('fullName', 'full_name', 'name'),
      role: stringClaim('role', 'userRole'),
      userId: stringClaim('userId', 'user_id', 'sub', 'id')
    };
  } catch {
    return {};
  }
}

function App() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileEmail, setProfileEmail] = useState(() => {
    try { return localStorage.getItem('clearkyc_profile_email') || ''; }
    catch { return ''; }
  });
  const [profileName, setProfileName] = useState(() => {
    try { return localStorage.getItem('clearkyc_profile_name') || ''; }
    catch { return ''; }
  });
  const [profileRole, setProfileRole] = useState(() => {
    try { return localStorage.getItem('clearkyc_profile_role') || ''; }
    catch { return ''; }
  });
  const [profileId, setProfileId] = useState(() => {
    try { return localStorage.getItem('clearkyc_profile_id') || ''; }
    catch { return ''; }
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const savedTheme = localStorage.getItem('clearkyc_theme');
      return savedTheme === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('clearkyc_theme', theme);
    } catch {
      // Theme still works for the current session if storage is unavailable.
    }
  }, [theme]);
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [token, setToken] = useState(() => localStorage.getItem('clearkyc_token') || '');
  const sessionProfile = useMemo(() => readSessionProfile(token), [token]);
  const displayedEmail = profileEmail || sessionProfile.email || '';
  const displayedName = profileName || sessionProfile.name || (displayedEmail ? displayedEmail.split('@')[0] : '') || 'Signed-in operator';
  const displayedRole = profileRole || sessionProfile.role || 'Authenticated operator';
  const displayedUserId = profileId || sessionProfile.userId || 'Not available';

  useEffect(() => {
    if (sessionProfile.email && !profileEmail) {
      setProfileEmail(sessionProfile.email);
      try { localStorage.setItem('clearkyc_profile_email', sessionProfile.email); } catch { /* optional cache */ }
    }
  }, [sessionProfile.email, profileEmail]);

  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'bootstrap'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setConnected(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [m, c, d, r, a] = await Promise.all([
        apiRequest<Metrics>('/dashboard', {}, token),
        apiRequest<unknown>(`/customers?limit=50&q=${encodeURIComponent(query)}`, {}, token),
        apiRequest<unknown>('/documents?limit=50', {}, token),
        apiRequest<unknown>('/reviews?limit=50', {}, token),
        apiRequest<unknown>('/alerts', {}, token)
      ]);
      setMetrics(m);
      setCustomers(rowsFrom<Customer>(c));
      setDocuments(rowsFrom<DocumentRecord>(d));
      setReviews(rowsFrom<Review>(r));
      setAlerts(rowsFrom<Alert>(a));
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Could not connect to the API.');
      if (e instanceof Error && /token|required|unauthori[sz]ed|401/i.test(e.message)) {
        localStorage.removeItem('clearkyc_token');
        setToken('');
        setShowAuth(true);
      }
    } finally {
      setLoading(false);
    }
  }, [query, token]);

  useEffect(() => {
    if (!token) {
      setConnected(false);
      setLoading(false);
      setShowAuth(true);
      return;
    }
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load, token]);

  const openCustomer = async (id: string) => {
    try {
      if (!token) {
        setShowAuth(true);
        return;
      }
      const detail = await apiRequest<CustomerDetail>(`/customers/${id}`, {}, token);
      setSelected(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load customer.');
    }
  };

  const authenticate = async () => {
    setActionBusy(true);
    setError('');
    try {
      if (!email.trim() || !password) {
        throw new Error('Enter your email and password.');
      }

      if (authMode === 'bootstrap') {
        if (!fullName.trim() || password.length < 12) {
          throw new Error('Enter your full name and a password with at least 12 characters.');
        }
        await apiRequest('/auth/bootstrap', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), password, fullName: fullName.trim() })
        });
      }

      // Bootstrap creates the first administrator but does not issue a JWT.
      // Sign in immediately after successful bootstrap to obtain the session token.
      const result = await apiRequest<{
        token: string;
        user?: { id?: string; email?: string; fullName?: string; role?: string };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password })
      });

      if (!result.token) throw new Error('The API did not return an access token.');
      const loggedInUser = result.user;
      const resolvedEmail = loggedInUser?.email || email.trim();
      const resolvedName = loggedInUser?.fullName || fullName.trim() || resolvedEmail.split('@')[0];
      const resolvedRole = loggedInUser?.role || '';
      const resolvedId = loggedInUser?.id || '';

      localStorage.setItem('clearkyc_token', result.token);
      localStorage.setItem('clearkyc_profile_email', resolvedEmail);
      localStorage.setItem('clearkyc_profile_name', resolvedName);
      if (resolvedRole) localStorage.setItem('clearkyc_profile_role', resolvedRole);
      if (resolvedId) localStorage.setItem('clearkyc_profile_id', resolvedId);

      setProfileEmail(resolvedEmail);
      setProfileName(resolvedName);
      setProfileRole(resolvedRole);
      setProfileId(resolvedId);
      setToken(result.token);
      setShowAuth(false);
      setPassword('');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('clearkyc_token');
    localStorage.removeItem('clearkyc_profile_email');
    localStorage.removeItem('clearkyc_profile_name');
    localStorage.removeItem('clearkyc_profile_role');
    localStorage.removeItem('clearkyc_profile_id');
    setProfileEmail('');
    setProfileName('');
    setProfileRole('');
    setProfileId('');
    setToken('');
    setMetrics(emptyMetrics);
    setCustomers([]);
    setDocuments([]);
    setReviews([]);
    setAlerts([]);
    setSelected(null);
    setConnected(false);
    setError('');
    setShowAuth(true);
    setAuthMode('login');
  };

  const runAction = async (path: string, body: unknown, successMessage: string) => {
    if (!token) {
      setShowAuth(true);
      setError('Sign in with an authorised account before performing this action.');
      return;
    }
    setActionBusy(true);
    setError('');
    try {
      await apiRequest(path, { method: 'POST', body: JSON.stringify(body) }, token);
      setError(successMessage);
      await load();
      if (selected) await openCustomer(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const verifyDocument = (doc: DocumentRecord) => {
    const decision = window.prompt('Enter decision: APPROVED or REJECTED');
    if (!decision) return;
    const normalized = decision.trim().toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(normalized)) {
      setError('Decision must be APPROVED or REJECTED.');
      return;
    }
    const notes = window.prompt('Add verification notes (required):');
    if (!notes?.trim()) {
      setError('Verification notes are required.');
      return;
    }
    void runAction(`/documents/${doc.id}/verify`, { decision: normalized, notes }, 'Document verification submitted.');
  };

  const closeReview = (review: Review) => {
    const resolution = window.prompt('Enter the review resolution:');
    if (!resolution?.trim()) return;
    void runAction(`/reviews/${review.id}/close`, { resolution }, 'Review closed successfully.');
  };

  const alertAction = (alert: Alert, action: 'acknowledge' | 'resolve') => {
    const notes = window.prompt(action === 'resolve' ? 'Enter resolution notes:' : 'Optional acknowledgement notes:');
    if (notes === null) return;
    void runAction(`/alerts/${alert.id}/${action}`, { notes }, `Alert ${action} action submitted.`);
  };

  const riskData = useMemo(
    () => metrics.riskDistribution?.map(x => ({
      name: x.declaredRisk,
      count: x._count._all
    })) || [],
    [metrics]
  );

  const nav = [
    { name: 'Overview' as Tab, icon: LayoutDashboard },
    { name: 'Customers' as Tab, icon: Users },
    { name: 'Documents' as Tab, icon: FileText },
    { name: 'Reviews' as Tab, icon: Clock3 },
    { name: 'Alerts & Exceptions' as Tab, icon: AlertTriangle },
    { name: 'My Profile' as Tab, icon: UserRound }
  ];

  const cards = [
    { label: 'Total customers', value: metrics.customers, sub: 'Onboarding population', icon: Users },
    { label: 'Evidence documents', value: metrics.documents, sub: 'Uploaded evidence records', icon: FileCheck2 },
    { label: 'Business entities', value: metrics.businesses, sub: 'Ownership monitoring', icon: Building2 },
    { label: 'Open alerts', value: metrics.openAlerts, sub: 'Require operational attention', icon: AlertTriangle }
  ];

  const filteredDocuments = documents.filter(d =>
    (filter === 'ALL' || d.status === filter) &&
    `${d.documentType} ${d.documentNumber || ''} ${d.customer?.legalName || ''}`.toLowerCase().includes(query.toLowerCase())
  );

  const filteredReviews = reviews.filter(r =>
    (filter === 'ALL' || r.status === filter) &&
    `${r.reviewType} ${r.customer?.legalName || ''}`.toLowerCase().includes(query.toLowerCase())
  );

  const filteredAlerts = alerts.filter(a =>
    (filter === 'ALL' || a.status === filter) &&
    `${a.type} ${a.customer?.legalName || ''}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="shell" data-theme={theme}>
      {mobileMenuOpen && <button className="mobile-scrim" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <div className="brandmark"><ShieldCheck size={21} /></div>
          <div><b>ClearKYC</b><span>COMPLIANCE SUITE</span></div>
        </div>
        <div className="workspace"><span className="dot" /> Workspace <ChevronRight size={14} /></div>
        <div className="navlabel">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {nav.map(n => {
            const Icon = n.icon;
            return (
              <button key={n.name} className={`navitem ${tab === n.name ? 'active' : ''}`} onClick={() => { setTab(n.name); setQuery(''); setFilter('ALL'); setMobileMenuOpen(false); }}>
                <Icon size={17} />{n.name}
                {n.name === 'Alerts & Exceptions' && metrics.openAlerts > 0 && <em>{metrics.openAlerts}</em>}
              </button>
            );
          })}
        </nav>
        <div className="sidebarbottom">
          <div className="secure"><ShieldCheck size={17} /><div><b>Audit-ready by design</b><span>Append-only event history</span></div></div>
          <div className="profile">
            <div className="avatar">OA</div>
            <div><b>{token ? displayedName : 'Demo workspace'}</b><span>{token ? (displayedEmail || 'Authenticated session') : 'Read-only access'}</span></div>
            {token && <button className="logout" onClick={logout} title="Sign out"><LogOut size={15} /></button>}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <button className="hamburgerbtn" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation menu" aria-expanded={mobileMenuOpen}>
              <Menu size={20} />
            </button>
            <span className="crumb">Workspace</span><span className="slash">/</span><b>{tab}</b>
          </div>
          <div className="topactions">
            <button
              className="themebtn"
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={theme === 'light'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span className={`api ${connected ? 'online' : ''}`}><i />{connected ? 'API connected' : 'API offline'}</span>
            {!token && <button className="textbtn" onClick={() => setShowAuth(true)}><LogIn size={14} /> Sign in</button>}
            <button className="iconbtn" onClick={() => void load()} title="Refresh"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
            <button className="avatar small profile-shortcut" onClick={() => setTab('My Profile')} title="Open profile" aria-label="Open profile">OA</button>
          </div>
        </header>

        <section className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">COMPLIANCE OPERATIONS / KYC CONTROL CENTER</div>
              <h1>{tab === 'Overview' ? 'Good day, Operations.' : tab}</h1>
              <p>Monitor onboarding evidence, risk decisions and periodic review obligations.</p>
            </div>
            {tab === 'Overview' && <button className="primary" onClick={() => setTab('Customers')}>View customer register <ArrowUpRight size={16} /></button>}
          </div>

          {error && <div className="errornotice"><AlertTriangle size={16} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}

          {tab !== 'My Profile' && <>
          <div className="notice">
            <div className="noticeicon"><Activity size={18} /></div>
            <div><b>Control center status</b><span>{connected ? 'Live records are being served by the KYC API.' : 'The API is not currently reachable. Start the backend to load records.'}</span></div>
            <span className="noticepill">{connected ? 'LIVE DATA' : 'OFFLINE'}</span>
          </div>

          {tab === 'Overview' && <Dashboard
            metrics={metrics} customers={customers} alerts={alerts} riskData={riskData}
            theme={theme} query={query} setQuery={setQuery} load={() => void load()}
            setTab={setTab} openCustomer={openCustomer} alertAction={alertAction}
          />}
          {tab === 'Customers' && <Customers customers={customers} query={query} setQuery={setQuery} onOpen={openCustomer} />}
          {tab === 'Documents' && <Documents documents={documents} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onVerify={verifyDocument} />}
          {tab === 'Reviews' && <Reviews reviews={reviews} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onClose={closeReview} />}
          {tab === 'Alerts & Exceptions' && <Alerts alerts={alerts} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onAction={alertAction} />}
          <footer>ClearKYC <span>·</span> Synthetic demonstration environment <span>·</span> Seed 20261022</footer>
          </>}



          {tab === 'My Profile' && <Profile
            token={token} name={displayedName} email={displayedEmail} role={displayedRole}
            userId={displayedUserId} theme={theme} setTheme={setTheme} logout={logout}
            onSignIn={() => setShowAuth(true)}
          />}
        </section>
      </main>

      {selected && <div className="modalback" onClick={() => setSelected(null)}>
        <div className="detailmodal" onClick={e => e.stopPropagation()}>
          <div className="modalhead"><div><span className="eyebrow">CUSTOMER PROFILE</span><h2>{selected.legalName}</h2><p>{selected.email} · {selected.id}</p></div><button className="iconbtn" onClick={() => setSelected(null)}><X /></button></div>
          <div className="detailgrid">
            <div><small>Customer status</small><b>{pretty(selected.state)}</b></div>
            <div><small>Declared risk</small><b>{pretty(selected.declaredRisk)}</b></div>
            <div><small>Customer type</small><b>{selected.customerType?.name || '—'}</b></div>
            <div><small>Country</small><b>{selected.country || '—'}</b></div>
            <div><small>Documents</small><b>{selected.documents?.length ?? selected._count?.documents ?? 0}</b></div>
            <div><small>Reviews</small><b>{selected.reviews?.length ?? selected._count?.reviews ?? 0}</b></div>
          </div>
          <h3>Documents</h3>
          {selected.documents?.length ? selected.documents.map(d => <div className="detailrow" key={d.id}><span>{pretty(d.documentType)}</span><Status value={d.status} /><small>Expires {date(d.expiryDate)}</small></div>) : <p className="muted">No document details returned.</p>}
          <h3>Reviews</h3>
          {selected.reviews?.length ? selected.reviews.map(r => <div className="detailrow" key={r.id}><span>{pretty(r.reviewType)}</span><Status value={r.status} /><small>Due {date(r.dueDate)}</small></div>) : <p className="muted">No review details returned.</p>}
          <button className="primary fullbutton" onClick={() => void runAction(`/customers/${selected.id}/approve`, {}, 'Customer approval request submitted.')}>Approve customer</button>
          <p className="muted">Approval is subject to server-side mandatory evidence and ownership checks.</p>
        </div>
      </div>}

      {showAuth && <div className="modalback" onClick={() => setShowAuth(false)}>
        <div className="authmodal" onClick={e => e.stopPropagation()}>
          <div className="modalhead"><div><span className="eyebrow">SECURE ACCESS</span><h2>{authMode === 'login' ? 'Sign in' : 'Create first administrator'}</h2><p>Protected actions require an authorised account.</p></div><button className="iconbtn" onClick={() => setShowAuth(false)}><X /></button></div>
          <div className="authswitch"><button className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>Sign in</button><button className={authMode === 'bootstrap' ? 'selected' : ''} onClick={() => setAuthMode('bootstrap')}>First admin setup</button></div>
          {authMode === 'bootstrap' && <label>Full name<input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Administrator name" /></label>}
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={authMode === 'bootstrap' ? 'At least 12 characters' : 'Your password'} /></label>
          <button className="primary fullbutton" disabled={actionBusy || !email || !password || (authMode === 'bootstrap' && (!fullName || password.length < 12))} onClick={() => void authenticate()}>{actionBusy ? 'Please wait...' : authMode === 'login' ? 'Sign in securely' : 'Create administrator'}</button>
          {authMode === 'bootstrap' && <p className="muted">First-admin setup works only when no users exist in the database.</p>}
        </div>
      </div>}
    </div>
  );
}


function Status({ value }: { value?: string }) { const v = value || 'UNKNOWN'; return <span className={`statuspill ${v.toLowerCase()}`}>{pretty(v)}</span>; }

export default App;
