import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Bounds, Center, Grid, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    s.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return s;
  }, [gltf.scene]);
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    let meshes = 0; let tris = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { meshes++; const idx = m.geometry.index; tris += (idx ? idx.count : m.geometry.attributes.position?.count ?? 0) / 3; }
    });
    console.info(`[studio] GLB loaded ${url}: ${meshes} meshes, ${Math.round(tris)} tris, size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`);
  }, [scene, url]);
  return <primitive object={scene} />;
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#dfe7ff', '#3a3326', 0.9]} />
      <directionalLight position={[4, 7, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      <directionalLight position={[-5, 3, -4]} intensity={0.6} color="#9fb7ff" />
    </>
  );
}

function Ready() {
  const { gl } = useThree();
  useEffect(() => { console.info('[studio] WebGL context ready:', gl.getContext().getParameter(gl.getContext().VERSION)); }, [gl]);
  return null;
}

class ModelErrorBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e) }; }
  render() {
    if (this.state.error) return <div className="viewer-body center"><div className="viewer-error">Could not load model: {this.state.error}</div></div>;
    return this.props.children;
  }
}

export default function ModelViewer({ url }: { url: string }) {
  return (
    <ModelErrorBoundary>
      <div className="viewer-body">
        <div className="model-view">
          <Canvas shadows dpr={[1, 2]} camera={{ position: [-3, 2.2, -4], fov: 40, near: 0.01, far: 1000 }} gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }} onCreated={({ scene, gl }) => { scene.background = new THREE.Color('#0e1015'); gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
            <Ready />
            <Lights />
            <Suspense fallback={null}>
              <Bounds fit clip observe margin={1.5}>
                <Center top>
                  <Model url={url} />
                </Center>
              </Bounds>
            </Suspense>
            <Grid
              position={[0, -0.001, 0]}
              args={[40, 40]}
              cellSize={0.25}
              cellThickness={0.6}
              cellColor="#2a3244"
              sectionSize={1}
              sectionThickness={1}
              sectionColor="#3b4763"
              fadeDistance={22}
              fadeStrength={1.2}
              infiniteGrid
            />
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.05} />
          </Canvas>
        </div>
        <div className="viewer-hint">drag to orbit · wheel to zoom · right-drag to pan</div>
      </div>
    </ModelErrorBoundary>
  );
}
