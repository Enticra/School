import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Role, User } from '@enticra/core';
import { backend, DEMO, store, type Session } from './api';
import { AppCtx, applySchoolTheme, Crest, EnticraLogo, Icon, initials, type Ctx, type Route } from './ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Attendance } from './pages/Attendance';
import { HomeworkPage } from './pages/Homework';
import { Tests, TestDetail } from './pages/Tests';
import { Correction } from './pages/Correction';
import { Students, StudentProfile } from './pages/Students';
import { Reports } from './pages/Reports';
import { Messages } from './pages/Messages';
import { Settings } from './pages/Settings';
import { ParentHome, ParentReports } from './pages/Parent';
import { Admin } from './pages/Admin';
import { Assistant, Insights, OnlineTests, QuestionBank, Syllabus, Timetable } from './showcase/Academics';
import { Career, Certificates, Records, Requests, Wellbeing } from './showcase/People';
import { Bot, Broadcast, Meetings } from './showcase/Engage';
import { Admissions, Alumni, Branches, Campus, Compliance, Fees, Staff, Transport } from './showcase/Office';
import { Doubts, MyFuture, Practice, StudentHome, StudentProgress, StudentTests } from './showcase/StudentApp';
import { ParentBus, ParentConnect, ParentFees, ParentFuture, ParentPrivacy } from './showcase/Family';
import { ExamHall, StudentExams } from './showcase/Exams';
import { ClassesAndStandards, MyClass } from './showcase/Classes';
import { StaffAttendance, StaffLeave } from './showcase/StaffDesk';
import { StudentHomework, StudentReports, Teachers, TimetableView } from './showcase/School';
import { PageHead } from './ui';

const TOKEN_KEY = 'enticra-school-token';
const THEME_KEY = 'ent-theme';

interface NavItem { page: string; label: string; icon: string; module?: string; when?: (u: User) => boolean }
const i = (page: string, label: string, icon: string, module?: string, when?: (u: User) => boolean): NavItem => ({ page, label, icon, module, when });
const NAV: Record<Role, { label?: string; items: NavItem[] }[]> = {
  principal: [
    { items: [i('home', 'Today', 'home')] },
    { label: 'Daily', items: [i('attendance', 'Student attendance', 'check', 'attendance'), i('staffatt', 'Staff attendance', 'briefcase'), i('requests', 'Staff leave', 'inbox'), i('timetable', 'Timetable', 'grid')] },
    { label: 'Academics', items: [i('tests', 'Tests and marks', 'pen', 'exams'), i('online', 'Online tests', 'list'), i('qbank', 'Question papers', 'layers'), i('examhall', 'Exams and hall tickets', 'calendar'), i('syllabus', 'Syllabus tracker', 'check'), i('reports', 'Report cards', 'file', 'reports'), i('insights', 'Analytics', 'chart')] },
    { label: 'People', items: [i('classes', 'Classes and standards', 'grid'), i('teachers', 'Teachers', 'briefcase'), i('students', 'Students', 'users'), i('career', 'Career guidance', 'compass'), i('wellbeing', 'Counselling and health', 'heart'), i('certificates', 'Certificates', 'award'), i('records', 'Student records', 'database')] },
    { label: 'Parents', items: [i('messages', 'Parent messages', 'chat'), i('bot', 'WhatsApp bot', 'bot'), i('meetings', 'PTM and surveys', 'calendar'), i('broadcast', 'Broadcast and gallery', 'megaphone')] },
    { label: 'Office', items: [i('fees', 'Fees', 'rupee'), i('admissions', 'Admissions', 'door'), i('transport', 'Transport and gate', 'bus'), i('staff', 'Staff and payroll', 'briefcase'), i('campus', 'Campus services', 'box'), i('alumni', 'Alumni', 'cap')] },
    { label: 'School', items: [i('branches', 'All branches', 'building'), i('compliance', 'Compliance and privacy', 'shield'), i('settings', 'Settings and branding', 'settings')] },
  ],
  teacher: [
    { items: [i('home', 'Today', 'home')] },
    { label: 'Daily', items: [i('attendance', 'Attendance', 'check', 'attendance'), i('homework', 'Homework', 'book', 'homework'), i('requests', 'Leave and requests', 'inbox'), i('timetable', 'Timetable', 'grid')] },
    { label: 'Academics', items: [i('tests', 'Tests and marks', 'pen', 'exams'), i('correction', 'AI correction', 'spark', 'aiGrading'), i('online', 'Online tests', 'list'), i('qbank', 'Question papers', 'layers'), i('examhall', 'Exams and hall tickets', 'calendar', undefined, (u) => !!u.examCoordinator), i('assistant', 'AI assistant', 'bot'), i('syllabus', 'Syllabus tracker', 'check'), i('reports', 'Report cards', 'file', 'reports'), i('insights', 'My analytics', 'chart')] },
    { label: 'People', items: [i('myclass', 'My class', 'home'), i('students', 'My students', 'users'), i('career', 'Career guidance', 'compass'), i('messages', 'Parent messages', 'chat')] },
  ],
  parent: [
    { items: [i('home', 'My children', 'home'), i('messages', 'WhatsApp updates', 'chat'), i('connect', 'Meetings and requests', 'calendar'), i('timetable', 'Timetable', 'grid'), i('exams', 'Exams and hall tickets', 'pen'), i('reports', 'Report cards', 'file', 'reports'), i('fees', 'Fees', 'rupee'), i('bus', 'School bus', 'bus'), i('future', 'Future pathways', 'compass'), i('privacy', 'Data and photos', 'shield')] },
  ],
  student: [
    { items: [i('home', 'Today', 'home'), i('homework', 'Homework', 'book'), i('timetable', 'Timetable', 'grid'), i('tests', 'Online tests', 'pen'), i('exams', 'Exams and hall ticket', 'calendar'), i('reports', 'Report cards', 'file', 'reports'), i('practice', 'Practice', 'layers'), i('doubts', 'Ask a doubt', 'bot'), i('progress', 'My progress', 'chart'), i('future', 'My future', 'compass')] },
  ],
  enticra_admin: [
    { items: [i('home', 'Schools', 'building')] },
  ],
};

function getTheme(): 'light' | 'dark' {
  const saved = store.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<Route>({ page: 'home' });
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ok' | 'err' }[]>([]);
  const [tick, setTick] = useState(0);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(getTheme);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const t = store.get(TOKEN_KEY);
    if (!t) { setBooting(false); return; }
    backend.restore(t).then((s) => { if (s) setSession(s); else store.del(TOKEN_KEY); setBooting(false); });
  }, []);
  useEffect(() => { applySchoolTheme(session?.school ?? null); }, [session]);

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 4200);
  }, []);

  const signIn = (s: Session) => { store.set(TOKEN_KEY, s.token); setSession(s); setRoute({ page: 'home' }); };
  const signOut = async () => { if (session) await backend.logout(session.token); store.del(TOKEN_KEY); setSession(null); applySchoolTheme(null); };

  const ctx = useMemo<Ctx | null>(() => session && ({
    session,
    api: backend.api(session.token),
    route,
    go: (r) => { setRoute(r); setMenu(false); window.scrollTo({ top: 0 }); },
    toast,
    refreshSession: async () => { const s = await backend.restore(session.token); if (s) setSession(s); },
    tick,
    bump: () => setTick((t) => t + 1),
  }), [session, route, toast, tick]);

  if (booting) return null;
  if (!session || !ctx) return (<><Login onSignedIn={signIn} theme={theme} setTheme={setTheme} /><Toasts toasts={toasts} /></>);

  const { user, school } = session;
  const nav = NAV[user.role];
  const modules = school?.settings.modules as Record<string, boolean> | undefined;
  const page = renderPage(user.role, route);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <div className={`scrim ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} />
        <aside className={`rail ${menu ? 'open' : ''}`} aria-label="Main navigation">
          <div className="rail-school">
            {school ? <Crest school={school} /> : <span className="crest" style={{ background: '#E26527', color: '#041416' }}>e</span>}
            <div style={{ minWidth: 0 }}>
              <div className="name">{school?.shortName ?? 'Enticra School'}</div>
              <div className="sub">{school ? `${school.settings.board} · ${user.role === 'parent' ? 'Parent' : user.role === 'student' ? 'Student' : user.title ?? user.role}` : 'Platform admin'}</div>
            </div>
          </div>
          <nav className="nav">
            {nav.map((g, gi) => (
              <div key={gi} className="nav">
                {g.label && <div className="nav-label">{g.label}</div>}
                {g.items.filter((i) => (!i.module || modules?.[i.module] !== false) && (!i.when || i.when(user))).map((i) => (
                  <button key={i.page} aria-current={route.page === i.page ? 'page' : undefined} onClick={() => ctx.go({ page: i.page })}>
                    <Icon name={i.icon} />{i.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="rail-foot">
            {DEMO && <button className="btn sm ghost" style={{ color: 'inherit', borderColor: 'currentColor', opacity: .8 }} onClick={() => { backend.reset?.(); try { Object.keys(localStorage).filter((k) => k.startsWith('ent-show-')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ } window.location.reload(); }}><Icon name="refresh" size={16} />Reset sample data</button>}
            <div className="powered">Powered by <EnticraLogo className="" /></div>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
            {DEMO && <span className="demo-tag">Sample data</span>}
            <div className="who">
              <button className="icon-btn" onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; setTheme(t); store.set(THEME_KEY, t); }} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
              <div className="who-name" style={{ textAlign: 'right', lineHeight: 1.2 }}>
                <div style={{ fontWeight: 650, fontSize: '.9rem' }}>{user.name}</div>
                <div className="dim small">{user.title}</div>
              </div>
              <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
              <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
            </div>
          </header>
          <main className="page" key={`${route.page}-${route.id ?? ''}`}>{page}</main>
        </div>
      </div>
      <Toasts toasts={toasts} />
    </AppCtx.Provider>
  );
}

function renderPage(role: Role, r: Route) {
  if (role === 'enticra_admin') return <Admin />;
  if (role === 'parent') {
    switch (r.page) {
      case 'messages': return <Messages />;
      case 'connect': return <ParentConnect />;
      case 'fees': return <ParentFees />;
      case 'bus': return <ParentBus />;
      case 'future': return <ParentFuture />;
      case 'privacy': return <ParentPrivacy />;
      case 'timetable': return <><PageHead eyebrow="Timetable" title="Class timetable" lede="Your child’s class timetable for the week, with the teacher for each period." /><TimetableView /></>;
      case 'exams': return <StudentExams />;
      case 'reports': return <ParentReports />;
      default: return <ParentHome />;
    }
  }
  if (role === 'student') {
    switch (r.page) {
      case 'tests': return <StudentTests />;
      case 'homework': return <StudentHomework />;
      case 'timetable': return <><PageHead eyebrow="Timetable" title="My timetable" lede="Your class timetable for the week, with the teacher for each period." /><TimetableView /></>;
      case 'exams': return <StudentExams />;
      case 'reports': return <StudentReports />;
      case 'practice': return <Practice />;
      case 'doubts': return <Doubts />;
      case 'progress': return <StudentProgress />;
      case 'future': return <MyFuture />;
      default: return <StudentHome />;
    }
  }
  switch (r.page) {
    case 'attendance': return <Attendance />;
    case 'homework': return role === 'teacher' ? <HomeworkPage /> : <Dashboard />;
    case 'tests': return r.id ? <TestDetail id={r.id} /> : <Tests />;
    case 'correction': return role === 'teacher' ? <Correction examId={r.id} /> : <Dashboard />;
    case 'students': return r.id ? <StudentProfile id={r.id} /> : <Students />;
    case 'reports': return <Reports />;
    case 'messages': return <Messages />;
    case 'settings': return <Settings />;
    case 'requests': return role === 'principal' ? <StaffLeave /> : <Requests />;
    case 'staffatt': return role === 'principal' ? <StaffAttendance /> : <Dashboard />;
    case 'timetable': return role === 'principal' ? <Timetable id={r.id} /> : <><PageHead eyebrow="Timetable" title="Timetable" lede="Your timetable, and the timetable of the class you are class advisor of." /><TimetableView /></>;
    case 'teachers': return role === 'principal' ? <Teachers /> : <Dashboard />;
    case 'classes': return role === 'principal' ? <ClassesAndStandards /> : <Dashboard />;
    case 'myclass': return role === 'teacher' ? <MyClass /> : <Dashboard />;
    case 'online': return <OnlineTests />;
    case 'qbank': return <QuestionBank />;
    case 'examhall': return <ExamHall />;
    case 'syllabus': return <Syllabus />;
    case 'assistant': return role === 'teacher' ? <Assistant /> : <Dashboard />;
    case 'insights': return <Insights />;
    case 'career': return <Career />;
    case 'wellbeing': return <Wellbeing />;
    case 'certificates': return <Certificates />;
    case 'records': return <Records />;
    case 'bot': return <Bot />;
    case 'meetings': return <Meetings />;
    case 'broadcast': return <Broadcast />;
    case 'fees': return <Fees />;
    case 'admissions': return <Admissions />;
    case 'transport': return <Transport />;
    case 'staff': return <Staff />;
    case 'campus': return <Campus />;
    case 'alumni': return <Alumni />;
    case 'branches': return <Branches />;
    case 'compliance': return <Compliance />;
    default: return <Dashboard />;
  }
}

function Toasts({ toasts }: { toasts: { id: number; text: string; kind: 'ok' | 'err' }[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}><Icon name={t.kind === 'err' ? 'alert' : 'check'} size={18} /><span>{t.text}</span></div>)}
    </div>
  );
}
