import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAdmin, RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Overview } from "./pages/Overview";
import { GamedaysList } from "./pages/GamedaysList";
import { GamedayDetail } from "./pages/GamedayDetail";
import { Standings } from "./pages/Standings";
import { AdminUsers } from "./pages/AdminUsers";
import { PlayerProfile } from "./pages/PlayerProfile";
import { HallOfFame } from "./pages/HallOfFame";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Overview />} />
          <Route path="/gamedays" element={<GamedaysList />} />
          <Route path="/gamedays/:id" element={<GamedayDetail />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/players/:id" element={<PlayerProfile />} />
          <Route path="/hall-of-fame" element={<HallOfFame />} />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsers />
              </RequireAdmin>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
