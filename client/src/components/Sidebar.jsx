import { NavLink } from 'react-router-dom';
import AppIcon from './AppIcon.jsx';

const links = [
  ['/', 'Dashboard', 'dashboard'],
  ['/jobs', 'Jobs', 'jobs'],
  ['/applications', 'Applications', 'applications'],
  ['/manual-apply', 'Manual Apply', 'apply'],
  ['/hr-contacts', 'HR Contacts', 'hr'],
  ['/scrape-status', 'Scrape Status', 'scrape'],
  ['/credentials', 'Credentials', 'credentials'],
  ['/companies', 'Companies', 'companies'],
  ['/settings', 'Settings', 'settings']
];

export default function Sidebar({ isOpen = false, onClose }) {
  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><AppIcon name="sparkles" /></span>
          <span>HireMate</span>
        </div>
        <p className="sidebar-subtitle">Automate applications, outreach, and follow-up.</p>
        <nav>
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={onClose}>
              <span className="nav-icon"><AppIcon name={icon} /></span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      {isOpen && <button type="button" className="sidebar-backdrop" onClick={onClose} aria-label="Close navigation" />}
    </>
  );
}
