import { useCallback, useRef } from 'react';

interface ResizerProps {
  onResize: (delta: number) => void;
}

export default function Resizer({ onResize }: ResizerProps) {
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // Prevent webview from stealing mouse events during drag
      const panes = document.querySelectorAll<HTMLElement>('.pane');
      panes.forEach((p) => (p.style.pointerEvents = 'none'));

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - startX.current;
        startX.current = e.clientX;
        onResize(delta);
      };

      const handleMouseUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        panes.forEach((p) => (p.style.pointerEvents = ''));
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [onResize]
  );

  return (
    <div className="resizer" onMouseDown={handleMouseDown}>
      <div className="resizer-handle" />
    </div>
  );
}
