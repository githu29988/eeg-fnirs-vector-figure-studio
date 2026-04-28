import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import './charts'; // side-effectful chart registration
import { AppShell } from './components/AppShell';
import { OverviewPage } from './pages/Overview';
import { ChartPage } from './pages/ChartPage';
import { DatasetProvider } from './lib/dataset';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DatasetProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="chart/:id" element={<ChartPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </DatasetProvider>
  </StrictMode>,
);
