import { Search, UserCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Navbar({ query, onQueryChange, onSubmit }) {
  const { user } = useAuth();

  return (
    <header className="navbar">
      <form
        className="navbar-search"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <Search size={18} />
        <input
          type="text"
          placeholder="Search by title, author or ISBN..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </form>

      <div className="navbar-user">
        <UserCircle size={26} />
        <span>{user?.username || "Guest"}</span>
      </div>
    </header>
  );
}
