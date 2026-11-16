import { useLayoutEffect, useState } from 'react';

/** Current rendered width of a standard card (it follows the --card-w clamp). */
export function useCardWidth(size: '' | 'sm' | 'xs' = ''): number {
  const [w, setW] = useState(60);
  useLayoutEffect(() => {
    const probe = document.createElement('div');
    probe.className = `card ${size}`;
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-999px;top:0';
    document.body.appendChild(probe);
    const measure = () => setW(probe.offsetWidth || 60);
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      probe.remove();
    };
  }, [size]);
  return w;
}
