import { AlertTriangle, ArrowUpRight, Building2, Clock3, FileCheck2, FileText, Search, ShieldCheck, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Metrics, Customer, Alert, Tab } from '../App';

type Props = {
  metrics: Metrics; customers: Customer[]; alerts: Alert[]; riskData: { name: string; count: number }[];
  theme: 'dark' | 'light'; query: string; setQuery: (value: string) => void;
  load: () => void; setTab: (tab: Tab) => void; openCustomer: (id: string) => void;
  alertAction: (alert: Alert, action: 'acknowledge' | 'resolve') => void;
};

export default function Dashboard({ metrics, customers, alerts, riskData, theme, query, setQuery, load, setTab, openCustomer, alertAction }: Props) {
  const cards = [
    { label: 'Total customers', value: metrics.customers, sub: 'Onboarding population', icon: Users },
    { label: 'Evidence documents', value: metrics.documents, sub: 'Uploaded evidence records', icon: FileCheck2 },
    { label: 'Business entities', value: metrics.businesses, sub: 'Ownership monitoring', icon: Building2 },
    { label: 'Open alerts', value: metrics.openAlerts, sub: 'Require operational attention', icon: AlertTriangle }
  ];
  return <>
    <div className="sectionrow"><h2>Portfolio snapshot</h2><span>Latest system state · <button onClick={load}>Refresh data</button></span></div>
    <div className="metricgrid">{cards.map((c, i) => { const Icon = c.icon; return <div className="metric" key={c.label}><div className="metrichead"><span>{c.label}</span><div className={`metricicon tone${i}`}><Icon size={18} /></div></div><strong>{c.value.toLocaleString()}</strong><small>{c.sub}</small></div>; })}</div>
    <div className="twocol">
      <div className="panel"><div className="panelhead"><div><h3>Risk distribution</h3><p>Customer population by declared risk</p></div><span className="tag">CUSTOMERS</span></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={riskData} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#263246" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8793a7', fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#8793a7', fontSize: 11 }} /><Tooltip contentStyle={{ background: theme === 'dark' ? '#111b2c' : '#ffffff', border: `1px solid ${theme === 'dark' ? '#29364a' : '#dce3ed'}`, borderRadius: 10, color: theme === 'dark' ? '#ffffff' : '#263449' }} /><Bar dataKey="count" fill="#6c91f5" radius={[6, 6, 0, 0]} barSize={42} /></BarChart></ResponsiveContainer></div></div>
      <div className="panel"><div className="panelhead"><div><h3>Control exceptions</h3><p>Items requiring analyst attention</p></div><span className="tag warning">ACTION NEEDED</span></div><div className="exceptionlist"><div><span className="exicon red"><AlertTriangle size={16} /></span><div><b>Overdue periodic reviews</b><small>Review due date has passed</small></div><strong>{metrics.overdueReviews}</strong></div><div><span className="exicon amber"><FileText size={16} /></span><div><b>Expired, not marked expired</b><small>Document status inconsistency</small></div><strong>{metrics.expiredMarkedNotExpired}</strong></div><div><span className="exicon blue"><Clock3 size={16} /></span><div><b>Incomplete onboarding</b><small>Mandatory evidence outstanding</small></div><strong>{metrics.incomplete}</strong></div></div><div className="panelfoot"><ShieldCheck size={15} /> Exceptions remain traceable in the audit log.</div></div>
    </div>
    <div className="panel tablepanel"><div className="panelhead"><div><h3>Customer register</h3><p>Search and open customer records</p></div><div className="searchbox"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customers..." /></div></div><CustomerTable customers={customers.slice(0, 8)} onOpen={openCustomer} /></div>
    <div className="panel tablepanel"><div className="panelhead"><div><h3>Priority alerts</h3><p>Open alerts requiring operational attention</p></div><button className="textbtn" onClick={() => setTab('Alerts & Exceptions')}>View all <ArrowUpRight size={14} /></button></div><div className="alertrows">{alerts.filter(a => a.status === 'OPEN').slice(0, 5).map(a => <div className="alertrow" key={a.id}><span className={`alertdot ${a.severity.toLowerCase()}`} /><div><b>{pretty(a.type)}</b><small>{a.customer?.legalName || 'Unknown customer'}</small></div><span className="alertdate">{date(a.dueDate)}</span><Status value={a.severity} /><button className="smallaction" onClick={() => alertAction(a, 'acknowledge')}>Acknowledge</button></div>)}{!alerts.some(a => a.status === 'OPEN') && <div className="empty">No alerts returned by the API.</div>}</div></div>
  </>;
}
function CustomerTable({ customers, onOpen }: { customers: Customer[]; onOpen: (id: string) => void }) { return <div className="tablewrap"><table><thead><tr><th>CUSTOMER</th><th>TYPE</th><th>RISK</th><th>STATUS</th><th>DOCUMENTS</th><th /></tr></thead><tbody>{customers.map(c => <tr key={c.id}><td><b>{c.legalName}</b><small>{c.id} · {c.email}</small></td><td>{c.customerType?.name || '—'}</td><td><Status value={c.declaredRisk} /></td><td><Status value={c.state} /></td><td>{c._count?.documents ?? 0}</td><td><button className="smallaction" onClick={() => onOpen(c.id)}>Details</button></td></tr>)}{!customers.length && <EmptyRow text="No customer records found." cols={6} />}</tbody></table></div>; }
function Status({ value }: { value?: string }) { const v = value || 'UNKNOWN'; return <span className={`statuspill ${v.toLowerCase()}`}>{pretty(v)}</span>; }
function EmptyRow({ text, cols }: { text: string; cols: number }) { return <tr><td colSpan={cols} className="empty">{text}</td></tr>; }
function pretty(value?: string) { return (value || '—').replace(/_/g, ' '); }
function date(value?: string | null) { return value ? new Date(value).toLocaleDateString() : '—'; }
