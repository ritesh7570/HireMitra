import { useEffect, useState } from 'react';
import ResetButton from '../components/ResetButton.jsx';
import { getProfile, uploadResume } from '../api.js';

export default function Settings() {
  const [profile, setProfile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getProfile().then(setProfile).catch((error) => setMessage(error.message));
  }, []);

  async function onUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const updated = await uploadResume(file);
      setProfile(updated);
      setMessage('Profile updated from your resume.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Local configuration helpers. File editing endpoints are coming next.</p>
        </div>
      </div>
      <div className="panel settings-grid">
        <div>
          <h2>Resume</h2>
          <p className="muted">
            Upload your latest resume (PDF or DOCX). The AI folds it into your profile,
            which every future job's tailored resume and cold email is generated from.
          </p>
          <input type="file" accept=".pdf,.docx" onChange={onUpload} disabled={uploading} />
          {uploading && <p className="muted">Updating profile from resume...</p>}
          {message && <p className="notice">{message}</p>}
          {profile?.updatedAt && (
            <p className="muted">Last updated: {new Date(profile.updatedAt).toLocaleString()}</p>
          )}
          {profile?.profileText && (
            <pre className="profile-preview">{profile.profileText}</pre>
          )}
        </div>
        <div>
          <h2>Environment</h2>
          <p className="muted">Edit `server/.env` for scrape keywords, location, threshold, and dry-run flags.</p>
        </div>
        <div>
          <h2>Reset</h2>
          <div className="inline-actions">
            <ResetButton scope="applications" />
            <ResetButton scope="jobs" />
            <ResetButton scope="all" />
          </div>
        </div>
      </div>
    </section>
  );
}
