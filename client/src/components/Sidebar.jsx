import { NavLink } from 'react-router-dom';

const links = [
  ['/', 'Dashboard'],
  ['/jobs', 'Jobs'],
  ['/applications', 'Applications'],
  ['/manual-apply', 'Manual Apply'],
  ['/hr-contacts', 'HR Contacts'],
  ['/scrape-status', 'Scrape Status'],
  ['/credentials', 'Credentials'],
  ['/companies', 'Companies'],
  ['/settings', 'Settings']
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">Job Agent</div>
      <nav>
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
