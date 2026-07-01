import { useEffect, useState } from 'react';
import { getCredentials, setCredentials, deleteCredentials, testLogin } from '../api.js';

const KNOWN_PLATFORMS = ['indeed', 'naukri'];

function sessionLabel(platform) {
  if (!platform.session) return 'No session';
  if (platform.sessionFresh) {
    const days = Math.floor((Date.now() - new Date(platform.session.savedAt)) / 86400000);
    return days === 0 ? 'Session fresh (today)' : `Session fresh (${days}d ago)`;
  }
  return 'Session expired';
}

export default function Credentials() {
  const [platforms, setPlatforms] = useState(null);
  const [forms, setForms] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState('');

  async function load() {
    const data = await getCredentials();
    setPlatforms(data.platforms);
    const next = {};
    for (const platform of data.platforms) {
      next[platform.platform] = { email: platform.email, password: '', enabled: platform.enabled };
    }
    setForms(next);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  function updateForm(platform, field, value) {
    setForms((prev) => ({ ...prev, [platform]: { ...prev[platform], [field]: value } }));
  }

  async function save(platform) {
    setError('');
    setMessage('');
    try {
      const form = forms[platform];
      await setCredentials(platform, {
        email: form.email,
        password: form.password || undefined,
        enabled: form.enabled
      });
      setMessage(`Saved credentials for ${platform}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function clear(platform) {
    setError('');
    setMessage('');
    try {
      await deleteCredentials(platform);
      setMessage(`Cleared credentials for ${platform}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function runTestLogin(platform) {
    setTesting(platform);
    setError('');
    setMessage('');
    try {
      const result = await testLogin(platform);
      setMessage(result.success ? `${platform}: login succeeded, session saved.` : `${platform}: ${result.message}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting('');
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Credentials</h1>
          <p>Login credentials for platforms that support auto-apply with a session.</p>
        </div>
      </div>

      <p className="notice error">
        ⚠️ Your credentials are stored locally in <code>server/data/credentials.json</code> (encrypted at
        rest if <code>CREDENTIAL_VAULT_KEY</code> is set in <code>.env</code>, plain text otherwise — either
        way the file is gitignored). Auto-login carries a small risk of account flagging on Indeed/Naukri.
        Toggle "Enabled" only after you've reviewed the applicator behavior in DRY_RUN mode.
      </p>

      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      {!platforms ? (
        <p className="muted">Loading...</p>
      ) : (
        <div className="settings-grid">
          {KNOWN_PLATFORMS.map((platformName) => {
            const platform = platforms.find((p) => p.platform === platformName) || {
              platform: platformName,
              session: null,
              sessionFresh: false
            };
            const form = forms[platformName] || { email: '', password: '', enabled: false };
            return (
              <div key={platformName} className="panel form-stack">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ textTransform: 'capitalize' }}>{platformName}</h2>
                  <span className="badge badge-muted">{sessionLabel(platform)}</span>
                </div>
                <input
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => updateForm(platformName, 'email', e.target.value)}
                />
                <input
                  type="password"
                  placeholder={platform.hasPassword ? 'Password (leave blank to keep current)' : 'Password'}
                  value={form.password}
                  onChange={(e) => updateForm(platformName, 'password', e.target.value)}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => updateForm(platformName, 'enabled', e.target.checked)}
                  />
                  Enabled (allow auto-login for this platform)
                </label>
                <div className="inline-actions">
                  <button type="button" onClick={() => save(platformName)}>Save</button>
                  <button type="button" className="ghost" onClick={() => clear(platformName)}>Clear</button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runTestLogin(platformName)}
                    disabled={testing === platformName || !platform.hasPassword}
                  >
                    {testing === platformName ? 'Testing...' : 'Test login'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
