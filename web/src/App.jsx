import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppShell, PublicShell } from './components/Layout.jsx';
import { useAuth } from './lib/auth.jsx';
import Landing from './pages/Landing.jsx';
import { Login, Register, Verify } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import NewBottle from './pages/NewBottle.jsx';
import Bottles from './pages/Bottles.jsx';
import BottleView from './pages/BottleView.jsx';
import { Transactions, Activity } from './pages/Lists.jsx';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  const { user, ready } = useAuth();
  return (
    <>
      <ScrollTop />
      <Routes>
        <Route path="/" element={ready && user ? <Navigate to="/home" replace /> : <Landing />} />
        <Route element={<PublicShell />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify" element={<Verify />} />
        </Route>
        <Route element={<AppShell />}>
          <Route path="/home" element={<Home />} />
          <Route path="/bottles" element={<Bottles />} />
          <Route path="/bottles/new" element={<NewBottle />} />
          <Route path="/b/:id" element={<BottleView />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/transactions" element={<Transactions />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
