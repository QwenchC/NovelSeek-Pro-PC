import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Returns a "smart back" handler that mirrors the browser/mouse back button.
 *
 * Behavior:
 * - If there's history to pop within the app session, calls `navigate(-1)`.
 *   This is identical to pressing the mouse XButton1 (back) or Alt+Left, so
 *   the in-app back button and the physical back button stay in sync — neither
 *   side pushes new entries onto the history stack.
 * - If this is the first navigation entry in the session (e.g. the user opened
 *   the app and landed directly on a sub-page via a deep link / reload), there
 *   is no history to pop. In that case, falls back to `fallbackPath` so the
 *   user isn't stranded.
 *
 * React Router v6 detects this via `location.key === 'default'`, which is the
 * sentinel key it uses only for the initial entry of a fresh session.
 */
export function useSmartBack(fallbackPath: string) {
  const navigate = useNavigate();
  const location = useLocation();

  return () => {
    if (location.key === 'default') {
      navigate(fallbackPath);
    } else {
      navigate(-1);
    }
  };
}
