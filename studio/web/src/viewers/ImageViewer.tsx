import { useState } from 'react';

export function ImageViewer({ url, alt }: { url: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [dims, setDims] = useState<string>();
  return (
    <div className="viewer-body">
      <div className={`img-view ${zoomed ? 'zoomed' : ''}`} onClick={() => setZoomed((z) => !z)}>
        <img src={url} alt={alt} onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />
      </div>
      <div className="viewer-hint">{dims ? `${dims} · ` : ''}{zoomed ? 'click to fit' : 'click for 1:1'}</div>
    </div>
  );
}
