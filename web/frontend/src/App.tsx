import { Link, Route, Routes } from 'react-router';

import { DebuggerPage } from './pages/DebuggerPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RuleFormPage } from './pages/RuleFormPage';
import { RulesListPage } from './pages/RulesListPage';

export function App() {
  return (
    <>
      {/* App Bridge renders these links in the admin's sidebar and, when one
          is clicked, clicks the matching link here, so the router navigates
          without a page reload. */}
      <s-app-nav>
        <Link to="/" rel="home">
          Discount rules
        </Link>
        <Link to="/debugger">Rule Debugger</Link>
      </s-app-nav>

      <Routes>
        <Route path="/" element={<RulesListPage />} />
        <Route path="/rules/new" element={<RuleFormPage />} />
        <Route path="/rules/:id" element={<RuleFormPage />} />
        <Route path="/debugger" element={<DebuggerPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
