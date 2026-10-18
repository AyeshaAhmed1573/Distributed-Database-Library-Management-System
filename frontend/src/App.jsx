import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import MyHolds from "./pages/MyHolds";
import Favorites from "./pages/Favorites";
import MyLibrary from "./pages/MyLibrary";
import Settings from "./pages/Settings";
import MyReviews from "./pages/MyReviews";

export default function App() {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/my-library" element={<ProtectedRoute><MyLibrary /></ProtectedRoute>} />
          <Route path="/my-holds" element={<ProtectedRoute><MyHolds /></ProtectedRoute>} />
          <Route path="/my-reviews" element={<ProtectedRoute><MyReviews /></ProtectedRoute>} />
          <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        </Routes>
      </FavoritesProvider>
    </AuthProvider>
  );
}