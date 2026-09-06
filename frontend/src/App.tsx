import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAdmin, RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import { InstallPwaPrompt } from "./components/InstallPwaPrompt";
import { ToastHost, ToastProvider } from "./toast/ToastContext";
import { Login } from "./pages/Login";
import { AcceptInvite } from "./pages/AcceptInvite";
import { JoinGameday } from "./pages/JoinGameday";
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
      <ToastProvider>
        <div className="pwa-toast-stack">
          <PwaUpdatePrompt />
          <InstallPwaPrompt />
          <ToastHost />
        </div>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/join/:token" element={<JoinGameday />} />

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
      </ToastProvider>
    </AuthProvider>
  );
}
