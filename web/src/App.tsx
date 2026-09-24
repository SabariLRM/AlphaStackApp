import { Navigate, Route, Routes } from 'react-router-dom';
import { DraftsList } from './pages/DraftsList';
import { LoginPage } from './pages/LoginPage';
import { MailLayout } from './pages/MailLayout';
import { MessageList } from './pages/MessageList';
import { MessageView } from './pages/MessageView';
import { SettingsPage } from './pages/SettingsPage';
import { TermsPage } from './pages/TermsPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route element={<MailLayout />}>
        <Route path="/mail/drafts" element={<DraftsList />} />
        <Route path="/mail/:folder" element={<MessageList />} />
        <Route path="/mail/:folder/:id" element={<MessageView />} />
        <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/mail/inbox" replace />} />
    </Routes>
  );
}
