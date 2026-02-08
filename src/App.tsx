import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from '@components/Layout';
import { HomePage } from '@pages/HomePage';
import { ProjectPage } from '@pages/ProjectPage';
import { EditorPage } from '@pages/EditorPage';
import { SettingsPage } from '@pages/SettingsPage';
import { OutlinePage } from '@pages/OutlinePage';
import { CharactersPage } from '@pages/CharactersPage';
import { ExportPage } from '@pages/ExportPage';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/project/:id/outline" element={<OutlinePage />} />
          <Route path="/project/:id/characters" element={<CharactersPage />} />
          <Route path="/project/:id/export" element={<ExportPage />} />
          <Route path="/editor/:projectId/:chapterId?" element={<EditorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
