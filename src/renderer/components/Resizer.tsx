import { useCallback, useRef } from 'react';

interface ResizerProps {
  onResize: (delta: number) => void;
}

export default function Resizer({ onResize }: ResizerProps) {
  const isDragging = useRef(false);
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = e.clientX - startX.current;
        startX.current = e.clientX;
        onResize(delta);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
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
