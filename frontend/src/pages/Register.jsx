import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getBranches } from "../api";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    fullName: "",
    homeBranchId: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(form);
      navigate("/");
    } catch (err) {
      setError(err?.response?.data?.error || "Could not create the account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-hero">
      <div className="auth-hero-title">
        <h1>Distributed Library</h1>
        <p>Create an account to start reserving books.</p>
      </div>

      <div className="auth-card">
        <h2>Create Account</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={form.username}
            onChange={(e) => update("username", e.target.value)}
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Full name"
            value={form.fullName}
            onChange={(e) => update("fullName", e.target.value)}
          />
          <input
            type="password"
            placeholder="Password (min. 8 characters)"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            required
          />
          {branches.length > 0 && (
            <select
              value={form.homeBranchId}
              onChange={(e) => update("homeBranchId", e.target.value)}
            >
              <option value="">Home branch (optional)</option>
              {branches.map((b) => (
                <option key={b.branch_id} value={b.branch_id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? "Creating account..." : "Register"}
          </button>
        </form>
        <p className="auth-switch">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
