import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Only admins and librarians get in; everyone else goes back to the home page.
export default function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!["admin", "librarian"].includes(user.role)) return <Navigate to="/" replace />;
  return children;
}