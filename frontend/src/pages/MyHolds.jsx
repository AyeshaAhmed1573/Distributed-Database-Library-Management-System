import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { getMyHolds, cancelHold } from "../api";

export default function MyHolds() {
  const [holds, setHolds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      setHolds(await getMyHolds());
    } catch {
      setError("Could not load your holds.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCancel(hold) {
    try {
      await cancelHold(hold.branch_id, hold.hold_id);
      setHolds((prev) => prev.filter((h) => h.hold_id !== hold.hold_id));
    } catch {
      setError("Could not cancel that hold — it may have already expired.");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query="" onQueryChange={() => {}} onSubmit={() => {}} />
        <main className="dashboard">
          <h2>My Holds</h2>
          {loading && <p className="muted">Loading...</p>}
          {error && <div className="warning-banner">{error}</div>}
          {!loading && holds.length === 0 && <p className="muted">You have no active holds.</p>}

          <div className="holds-list">
            {holds.map((h) => (
              <div className="hold-row" key={`${h.branch_id}-${h.hold_id}`}>
                <div>
                  <h4>{h.title}</h4>
                  <p className="muted">
                    ISBN {h.isbn} · Branch {h.branch_id} · expires{" "}
                    {new Date(h.expires_at).toLocaleString()}
                  </p>
                </div>
                <button onClick={() => handleCancel(h)}>Cancel</button>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
