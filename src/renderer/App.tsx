import { useState, useCallback } from 'react';
import Browser from './components/Browser';
import Terminal from './components/Terminal';
import Resizer from './components/Resizer';

export default function App() {
  const [browserWidth, setBrowserWidth] = useState(60); // percentage
  const [annotateMode, setAnnotateMode] = useState(true);

  const handleResize = useCallback((delta: number) => {
    setBrowserWidth((prev) => {
      const newWidth = prev + (delta / window.innerWidth) * 100;
      return Math.max(30, Math.min(70, newWidth));
    });
  }, []);

  return (
    <div className="app">
      <div className="panes">
        <div className="pane browser-pane" style={{ width: `${browserWidth}%` }}>
          <Browser
            annotateMode={annotateMode}
            onAnnotateModeChange={setAnnotateMode}
          />
        </div>
        <Resizer onResize={handleResize} />
        <div className="pane terminal-pane" style={{ width: `${100 - browserWidth}%` }}>
          <Terminal />
        </div>
      </div>
    </div>
  );
}
