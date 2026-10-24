import { NavLink } from "react-router-dom";
import { Home, BookMarked, Heart, LayoutGrid, MessageSquare, Settings, LogOut, Library, Activity } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Sidebar() {
  const { user, logout } = useAuth();
  const isStaff = ["admin", "librarian"].includes(user?.role);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Library size={22} />
        <span>Library</span>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          <Home size={18} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/my-library" className={({ isActive }) => (isActive ? "active" : "")}>
          <LayoutGrid size={18} />
          <span>My Library</span>
        </NavLink>
        <NavLink to="/my-holds" className={({ isActive }) => (isActive ? "active" : "")}>
          <BookMarked size={18} />
          <span>My Holds</span>
        </NavLink>
        <NavLink to="/my-reviews" className={({ isActive }) => (isActive ? "active" : "")}>
          <MessageSquare size={18} />
          <span>My Reviews</span>
        </NavLink>
        <NavLink to="/favorites" className={({ isActive }) => (isActive ? "active" : "")}>
          <Heart size={18} />
          <span>Favorites</span>
        </NavLink>
        {isStaff && (
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
            <Activity size={18} />
            <span>Admin</span>
          </NavLink>
        )}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>

      <button className="sidebar-logout" onClick={logout}>
        <LogOut size={18} />
        <span>Log out</span>
      </button>
    </aside>
  );
}