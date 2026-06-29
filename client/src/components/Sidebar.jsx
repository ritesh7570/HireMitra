import { NavLink } from 'react-router-dom';

const links = [
  ['/', 'Dashboard'],
  ['/jobs', 'Jobs'],
  ['/applications', 'Applications'],
  ['/manual-apply', 'Manual Apply'],
  ['/hr-contacts', 'HR Contacts'],
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
