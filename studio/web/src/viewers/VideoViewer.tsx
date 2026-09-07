export function VideoViewer({ url }: { url: string }) {
  return (
    <div className="viewer-body">
      <div className="video-view">
        <video src={url} controls autoPlay muted loop playsInline preload="metadata" />
      </div>
    </div>
  );
}
