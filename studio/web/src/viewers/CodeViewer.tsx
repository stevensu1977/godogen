import { useEffect, useState } from 'react';
import { Highlight, Prism, themes, type Language } from 'prism-react-renderer';
import { langForPath } from '../lib/format';

// prism-react-renderer bundles a small language set; pull in the rest of what a game repo contains.
let extraLangs: Promise<void> | undefined;
function loadExtraLanguages(): Promise<void> {
  if (!extraLangs) {
    (globalThis as unknown as { Prism: typeof Prism }).Prism = Prism;
    extraLangs = (async () => {
      await import('prismjs/components/prism-c');
      await Promise.all([
        import('prismjs/components/prism-csharp'),
        import('prismjs/components/prism-bash'),
        import('prismjs/components/prism-gdscript'),
        import('prismjs/components/prism-ini'),
        import('prismjs/components/prism-glsl'),
        import('prismjs/components/prism-toml'),
      ]);
    })().catch((e) => console.warn('[studio] extra prism languages failed to load', e));
  }
  return extraLangs;
}

const theme = {
  ...themes.nightOwl,
  plain: { color: '#d6deeb', backgroundColor: 'transparent' },
};

export function CodeViewer({ url, path }: { url: string; path: string }) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [langsReady, setLangsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(undefined); setError(undefined);
    fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.text();
    }).then((t) => !cancelled && setText(t)).catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => { void loadExtraLanguages().then(() => setLangsReady(true)); }, []);

  if (error) return <div className="viewer-body center"><div className="viewer-error">Could not load file: {error}</div></div>;
  if (text === undefined) return <div className="viewer-body center"><div className="viewer-loading"><span className="spin" />Loading…</div></div>;

  const lang = langForPath(path);
  const language = (langsReady || lang in Prism.languages ? lang : 'text') as Language;
  return (
    <div className="viewer-body">
      <div className="code-view">
        <Highlight theme={theme} code={text.replace(/\n$/, '')} language={language}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <pre>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })} className="line">
                  <span className="ln">{i + 1}</span>
                  <span className="lc">{line.map((token, k) => <span key={k} {...getTokenProps({ token })} />)}</span>
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}
