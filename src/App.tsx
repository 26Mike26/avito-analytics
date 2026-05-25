import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import KpiCenter from './pages/KpiCenter';
import Items from './pages/Items';
import ItemDetail from './pages/ItemDetail';
import Bids from './pages/Bids';
import Recommendations from './pages/Recommendations';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Accounts from './pages/Accounts';
import ActionLog from './pages/ActionLog';
import Compare from './pages/Compare';
import Insights from './pages/Insights';
import ClientDashboard from './pages/client/ClientDashboard';
import ClientAnalytics from './pages/client/ClientAnalytics';
import ClientRecommendations from './pages/client/ClientRecommendations';
import ClientActionLog from './pages/client/ClientActionLog';
import { ProtectedRoute } from './components/ProtectedRoute';

/**
 * Короткая ссылка для клиента: /c/<token> → /client?ct=<token>.
 * Сам токен резолвится в useStore.bootstrap().
 */
function ClientShareEntry() {
  const { token } = useParams<{ token: string }>();
  return (
    <Navigate to={`/client?ct=${encodeURIComponent(token ?? '')}`} replace />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/c/:token" element={<ClientShareEntry />} />
      <Route
        path="/client"
        element={
          <ProtectedRoute>
            <ClientDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/client/analytics"
        element={
          <ProtectedRoute>
            <ClientAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/client/recommendations"
        element={
          <ProtectedRoute>
            <ClientRecommendations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/client/log"
        element={
          <ProtectedRoute>
            <ClientActionLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute access="platform">
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/kpi"
        element={
          <ProtectedRoute access="platform">
            <KpiCenter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/items"
        element={
          <ProtectedRoute access="platform">
            <Items />
          </ProtectedRoute>
        }
      />
      <Route
        path="/items/:id"
        element={
          <ProtectedRoute access="platform">
            <ItemDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bids"
        element={
          <ProtectedRoute access="platform">
            <Bids />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recommendations"
        element={
          <ProtectedRoute access="platform">
            <Recommendations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute access="platform">
            <Analytics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/compare"
        element={
          <ProtectedRoute access="platform">
            <Compare />
          </ProtectedRoute>
        }
      />
      <Route
        path="/insights"
        element={
          <ProtectedRoute access="platform">
            <Insights />
          </ProtectedRoute>
        }
      />
      <Route
        path="/accounts"
        element={
          <ProtectedRoute access="platform">
            <Accounts />
          </ProtectedRoute>
        }
      />
      <Route
        path="/log"
        element={
          <ProtectedRoute access="platform">
            <ActionLog />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute access="platform">
            <Settings />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
