import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from '@components/Layout';
import { HomePage } from '@pages/HomePage';
import { LongNovelsHomePage } from '@pages/LongNovelsHomePage';
import { LongNovelPage } from '@pages/LongNovelPage';
import { LongNovelOutlinePage } from '@pages/LongNovelOutlinePage';
import { LongNovelEditorPage } from '@pages/LongNovelEditorPage';
import { LongNovelCharactersPage } from '@pages/LongNovelCharactersPage';
import { ProjectPage } from '@pages/ProjectPage';
import { EditorPage } from '@pages/EditorPage';
import { SettingsPage } from '@pages/SettingsPage';
import { OutlinePage } from '@pages/OutlinePage';
import { CharactersPage } from '@pages/CharactersPage';
import { ExportPage } from '@pages/ExportPage';
import { LongNovelExportPage } from '@pages/LongNovelExportPage';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/long-novels" element={<LongNovelsHomePage />} />
          <Route path="/long-novel/:id" element={<LongNovelPage />} />
          <Route path="/long-novel/:id/outline" element={<LongNovelOutlinePage />} />
          <Route path="/long-novel/:id/editor/:chapterId?" element={<LongNovelEditorPage />} />
          <Route path="/long-novel/:id/characters" element={<LongNovelCharactersPage />} />
          <Route path="/long-novel/:id/export" element={<LongNovelExportPage />} />
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
