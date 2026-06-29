export default function Spinner({ label = 'Loading...' }) {
  return (
    <div className="spinner-row">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
