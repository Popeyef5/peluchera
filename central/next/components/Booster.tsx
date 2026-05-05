"use client";

import React, { Suspense, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, RoundedBox, Center, Sparkles } from "@react-three/drei";

const GLB_URL = "/booster.glb";

// Tweak if the model imports with a different "up" axis. The defaults below
// stand a horizontally-modeled pack upright facing the camera.
const GLB_ROTATION: [number, number, number] = [-Math.PI / 2, Math.PI / 2, Math.PI];
const GLB_SCALE = 0.75;

function GLTFBooster() {
	const { scene } = useGLTF(GLB_URL);
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
	{ children: React.ReactNode; fallback: React.ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		// swallow — we render fallback below
	}
	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

type Props = {
	tearing: boolean; // when true, animate the cheap-fake tear: shrink + sink + fade
};

export default function Booster({ tearing }: Props) {
	const groupRef = useRef<THREE.Group>(null);

	useFrame(() => {
		const g = groupRef.current;
		if (!g) return;
		const targetSY = tearing ? 0.04 : 1;
		const targetY  = tearing ? -0.7 : 0;
		const targetOp = tearing ? 0   : 1;
		g.scale.y    = THREE.MathUtils.lerp(g.scale.y, targetSY, 0.12);
		g.position.y = THREE.MathUtils.lerp(g.position.y, targetY, 0.12);
		// Fade by walking the group's children opacity
		g.traverse((obj) => {
			const m = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
			if (!m) return;
			const arr = Array.isArray(m) ? m : [m];
			for (const mat of arr) {
				mat.transparent = true;
				const op = "opacity" in mat ? (mat as THREE.MeshStandardMaterial).opacity : 1;
				(mat as THREE.MeshStandardMaterial).opacity = THREE.MathUtils.lerp(op, targetOp, 0.12);
			}
		});
	});

	const fallback = <ProceduralBooster />;
	return (
		<>
			<group ref={groupRef}>
				<GLBErrorBoundary fallback={fallback}>
					<Suspense fallback={fallback}>
						<GLTFBooster />
					</Suspense>
				</GLBErrorBoundary>
			</group>
			{tearing && (
				<Sparkles count={60} scale={2.4} size={6} speed={0.7} color="#fff5d6" />
			)}
		</>
	);
}
