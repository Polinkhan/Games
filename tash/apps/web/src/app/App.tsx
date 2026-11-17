import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toasts } from '../components/Sheet';
import { Home } from '../screens/Home';
import { HowToScreen } from '../screens/HowTo';
import { RoomScreen } from '../screens/Room';
import { SoloScreen } from '../screens/Solo';
import { applyDocumentSettings, useSettings } from './settings';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/solo/:gameId', element: <SoloScreen /> },
  { path: '/room/:code', element: <RoomScreen /> },
  { path: '/how/:gameId', element: <HowToScreen /> },
  { path: '*', element: <Home /> },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

export function App() {
  useEffect(() => {
    applyDocumentSettings(useSettings.getState());
    return useSettings.subscribe((s) => applyDocumentSettings(s));
  }, []);
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  );
}
