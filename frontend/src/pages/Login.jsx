import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err?.response?.data?.error || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-hero">
      <div className="auth-hero-title">
        <h1>Distributed Library</h1>
        <p>Search, browse and reserve books across every branch.</p>
      </div>

      <div className="auth-card">
        <h2>Member Login</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
        <p className="auth-switch">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </div>

      <div className="auth-footer">© Distributed Library Project</div>
    </div>
  );
}
