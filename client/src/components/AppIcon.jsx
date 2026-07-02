export default function AppIcon({ name, className = '' }) {
  const shared = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
  };

  const icons = {
    dashboard: (
      <svg {...shared}>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="4" rx="1.5" />
        <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      </svg>
    ),
    jobs: (
      <svg {...shared}>
        <path d="M7 6.5h10a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 17 19.5H7A1.5 1.5 0 0 1 5.5 18V8A1.5 1.5 0 0 1 7 6.5Z" />
        <path d="M9 6V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6" />
        <path d="M9 11h6" />
        <path d="M9 14h4" />
      </svg>
    ),
    applications: (
      <svg {...shared}>
        <path d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 17 19.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5Z" />
        <path d="m8.5 9 2 2 4-4" />
      </svg>
    ),
    apply: (
      <svg {...shared}>
        <path d="M6 5.5h12" />
        <path d="M8 3.5h8" />
        <path d="M7 8.5h10" />
        <path d="M7 13.5h6" />
        <path d="M7 18.5h4" />
      </svg>
    ),
    hr: (
      <svg {...shared}>
        <path d="M7.5 18.5a3.5 3.5 0 1 1 7 0" />
        <circle cx="11" cy="8.5" r="3" />
        <path d="M17.5 18.5a2.5 2.5 0 0 0-2-2.4" />
        <path d="M4.5 18.5a2.5 2.5 0 0 1 2-2.4" />
      </svg>
    ),
    scrape: (
      <svg {...shared}>
        <path d="M5 5.5h14" />
        <path d="M5 12h8" />
        <path d="M5 18.5h10" />
        <circle cx="18" cy="18" r="2.5" />
      </svg>
    ),
    credentials: (
      <svg {...shared}>
        <rect x="4.5" y="8.5" width="15" height="10" rx="2" />
        <path d="M8 8.5V7a4 4 0 0 1 8 0v1.5" />
        <path d="M12 13.5v2" />
      </svg>
    ),
    companies: (
      <svg {...shared}>
        <path d="M4.5 19.5V7.5a1.5 1.5 0 0 1 1.5-1.5h3V4.5A1.5 1.5 0 0 1 10.5 3h3a1.5 1.5 0 0 1 1.5 1.5v1.5h3a1.5 1.5 0 0 1 1.5 1.5v12" />
        <path d="M8.5 10.5h2" />
        <path d="M13.5 10.5h2" />
        <path d="M8.5 14.5h2" />
        <path d="M13.5 14.5h2" />
      </svg>
    ),
    settings: (
      <svg {...shared}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19 12a7.2 7.2 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.8 7.8 0 0 0-2.1-1.2L14 2h-4l-.5 2.6a7.8 7.8 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5A7.2 7.2 0 0 0 5 12a7.2 7.2 0 0 0 .1 1.2l-2 1.5 2 3.4 2.4-1a7.8 7.8 0 0 0 2.1 1.2L10 22h4l.5-2.6a7.8 7.8 0 0 0 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
      </svg>
    ),
    sparkles: (
      <svg {...shared}>
        <path d="m12 3 1.4 4.2L18 8.8l-4.6 1.6L12 14.6l-1.4-4.2L6 8.8l4.6-1.6Z" />
        <path d="m18.5 14.5 1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1Z" />
      </svg>
    ),
    company: (
      <svg {...shared}>
        <path d="M4 21V10.5L12 3l8 7.5V21" />
        <path d="M9 21V13h6v8" />
      </svg>
    ),
    source: (
      <svg {...shared}>
        <path d="M4.5 10.5v-6A1.5 1.5 0 0 1 6 3h7l5 5v6a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 10.5Z" />
        <path d="M14 6h2" />
      </svg>
    ),
    tag: (
      <svg {...shared}>
        <path d="M4.5 11.5V6.5A2 2 0 0 1 6.5 4.5h5.5l4 4v4.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2Z" />
        <path d="M8.5 8.5h.01" />
      </svg>
    ),
    location: (
      <svg {...shared}>
        <path d="M12 21s6-5.5 6-10.5A6 6 0 0 0 6 10.5C6 15.5 12 21 12 21Z" />
        <circle cx="12" cy="10.5" r="2.5" />
      </svg>
    ),
    email: (
      <svg {...shared}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="m3 8 9 6 9-6" />
      </svg>
    ),
    link: (
      <svg {...shared}>
        <path d="M10 14a4 4 0 0 1 0-5.66l4.68-4.68A4 4 0 0 1 19.66 6.34l-2.2 2.2" />
        <path d="M14 10a4 4 0 0 1 0 5.66l-4.68 4.68A4 4 0 0 1 4.34 17.66l2.2-2.2" />
      </svg>
    ),
    trash: (
      <svg {...shared}>
        <path d="M6 7h12" />
        <path d="M9 7v11" />
        <path d="M15 7v11" />
        <path d="M5.5 7h13l-1 12.5H6.5L5.5 7Z" />
      </svg>
    ),
    profile: (
      <svg {...shared}>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 21c0-4 3.5-7 6.5-7s6.5 3 6.5 7" />
      </svg>
    ),
    calendar: (
      <svg {...shared}>
        <rect x="4" y="6" width="16" height="14" rx="2" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M4 10h16" />
      </svg>
    ),
    check: (
      <svg {...shared}>
        <path d="M6 12l4 4 8-8" />
      </svg>
    ),
    linkedin: (
      <svg {...shared}>
        <path d="M4 21V9" />
        <path d="M4 7h.01" />
        <path d="M8 21V13a3 3 0 0 1 6 0v8" />
      </svg>
    ),
  };

  return icons[name] || icons.dashboard;
}
