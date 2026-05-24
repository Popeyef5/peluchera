"use client";

import React, { Suspense } from "react";
import { useGLTF, RoundedBox, Center } from "@react-three/drei";

const GLB_URL = "/booster.glb";

// Warm the GLB cache as soon as this module is imported (which happens at
// page load via WinChoiceModal). By the time the user wins, the mesh is
// already parsed and ready, so useGLTF resolves synchronously and the rise
// animation doesn't race the fetch.
if (typeof window !== "undefined") {
	useGLTF.preload(GLB_URL);
}

// Tweak if the model imports with a different "up" axis. The defaults below
// stand a horizontally-modeled pack upright facing the camera.
const GLB_ROTATION: [number, number, number] = [-Math.PI / 2, Math.PI / 2, Math.PI];
const GLB_SCALE = 0.7;

function GLTFBooster({ onReady }: { onReady?: () => void }) {
	const { scene } = useGLTF(GLB_URL);
	// Fire once after the GLTF has resolved and the component has mounted.
	// onReady is captured at mount so we don't re-fire if the parent passes
	// a new closure each render.
	const readyRef = React.useRef(onReady);
	readyRef.current = onReady;
	React.useEffect(() => { readyRef.current?.(); }, []);
	return (
		<Center>
			<group rotation={GLB_ROTATION} scale={GLB_SCALE}>
				<primitive object={scene} />
			</group>
		</Center>
	);
}

function ProceduralBooster() {
	return (
		<group rotation={[0, 0, 0]}>
			<RoundedBox args={[0.9, 1.4, 0.05]} radius={0.04} smoothness={6} castShadow receiveShadow>
				<meshPhysicalMaterial
					color="#cfc7b3"
					metalness={1}
					roughness={0.18}
					iridescence={1}
					iridescenceIOR={1.35}
					iridescenceThicknessRange={[120, 420]}
					clearcoat={1}
					clearcoatRoughness={0.22}
					envMapIntensity={1.2}
				/>
			</RoundedBox>
			<RoundedBox args={[0.86, 0.36, 0.052]} radius={0.02} smoothness={4} position={[0, 0.42, 0.001]}>
				<meshPhysicalMaterial
					color="#1f1d1a"
					metalness={0.5}
					roughness={0.35}
					clearcoat={0.6}
				/>
			</RoundedBox>
		</group>
	);
}

class GLBErrorBoundary extends React.Component<
	{ children: React.ReactNode; fallback: React.ReactNode; onFailed?: () => void },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		// swallow — we render fallback below. onFailed tells the parent it's
		// safe to start the entry animation: the GLB won't be coming, but the
		// procedural fallback is on screen so the rise has something to show.
		this.props.onFailed?.();
	}
	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

// The "tear" animation is now done by CSS-translating the entire canvas Box
// downward off the bottom of the screen (see WinChoiceModal). This component
// just renders the pack in place.
//
// `onReady` fires once we have something to show — either the real GLB has
// loaded, or the error boundary kicked in and the procedural fallback is up.
// The Suspense fallback is `null` (not the procedural pack) so a slow-loading
// GLB shows transparency instead of popping a different mesh mid-rise; the
// parent gates the rise animation on this callback.
export default function Booster({ onReady }: { onReady?: () => void }) {
	return (
		<GLBErrorBoundary fallback={<ProceduralBooster />} onFailed={onReady}>
			<Suspense fallback={null}>
				<GLTFBooster onReady={onReady} />
			</Suspense>
		</GLBErrorBoundary>
	);
}
