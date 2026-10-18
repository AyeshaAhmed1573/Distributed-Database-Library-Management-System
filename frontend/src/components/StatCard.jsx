export default function StatCard({ icon, label, value, tone = "purple" }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
