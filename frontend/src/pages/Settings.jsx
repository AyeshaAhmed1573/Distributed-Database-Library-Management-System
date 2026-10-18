import { useState } from "react";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { getTheme, applyTheme } from "../utils/theme";

export default function Settings() {
  const { user } = useAuth();
  const [dark, setDark] = useState(() => getTheme() === "dark");

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    applyTheme(next);
    setDark(!dark);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar query="" onQueryChange={() => {}} onSubmit={() => {}} />
        <main className="dashboard">
          <div className="section-heading">
            <h3>Settings</h3>
          </div>

          <div className="panel-card settings-card">
            <div className="settings-row">
              <div>
                <h4>Dark mode</h4>
                <p className="muted">Switch the app to a darker color scheme.</p>
              </div>
              <button
                className={`toggle-switch ${dark ? "on" : ""}`}
                onClick={toggleTheme}
                aria-pressed={dark}
                aria-label="Toggle dark mode"
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          <div className="panel-card settings-card">
            <h4>Account</h4>
            <p className="muted">Username: {user?.username}</p>
            <p className="muted">Email: {user?.email}</p>
          </div>
        </main>
      </div>
    </div>
  );
}