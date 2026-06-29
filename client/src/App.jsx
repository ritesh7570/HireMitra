import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Jobs from './pages/Jobs.jsx';
import Applications from './pages/Applications.jsx';
import ManualApply from './pages/ManualApply.jsx';
import HrContacts from './pages/HrContacts.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/manual-apply" element={<ManualApply />} />
        <Route path="/hr-contacts" element={<HrContacts />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}
