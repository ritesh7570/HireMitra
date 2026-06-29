import { resetData } from '../api.js';

export default function ResetButton({ scope = 'applications', onReset }) {
  async function handleReset() {
    if (!confirm(`Reset ${scope}? This keeps generated resumes on disk.`)) return;
    await resetData(scope);
    onReset?.();
  }

  return (
    <button type="button" className="danger" onClick={handleReset}>
      Reset {scope}
    </button>
  );
}
