"use client";

import React, { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF, useTexture, RoundedBox, Center } from "@react-three/drei";

const GLB_URL = "/booster.glb";

// Per-SKU artwork registry. Drop new packs at
//   /public/boosters/<sku>/{front,back}.png
// and add the entry below. Source images should match the original UV layout —
// the front/back faces in the GLB are UV-mapped to fill the full image
// rectangle (~0.54 portrait aspect). Higher resolution than the embedded
// 238x441 is encouraged since the pack is the focal element of the win modal.
const BOOSTER_TEXTURES: Record<string, { front: string; back: string }> = {
	test: { front: "/boosters/test/front.webp", back: "/boosters/test/back.webp" },
};

// Warm caches as soon as this module is imported (page load via
// WinChoiceModal). By the time the user wins, both the mesh and every known
// SKU's textures are parsed and ready — useGLTF / useTexture resolve
// synchronously and the rise animation doesn't race the fetch.
if (typeof window !== "undefined") {
	useGLTF.preload(GLB_URL);
	for (const sku of Object.keys(BOOSTER_TEXTURES)) {
		const t = BOOSTER_TEXTURES[sku];
		useTexture.preload(t.front);
		useTexture.preload(t.back);
	}
}

// Tweak if the model imports with a different "up" axis. The defaults below
// stand a horizontally-modeled pack upright facing the camera.
const GLB_ROTATION: [number, number, number] = [-Math.PI / 2, Math.PI / 2, Math.PI];
const GLB_SCALE = 0.7;

// useGLTF returns a singleton scene shared across all instances of this
// component. Mutating materials on it would leak into future renders, so each
// skinned render gets its own deep-cloned tree with cloned materials.
function cloneSceneWithMaterials(scene: THREE.Object3D): THREE.Object3D {
	const cloned = scene.clone(true);
	cloned.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.material) return;
		if (Array.isArray(mesh.material)) {
			mesh.material = mesh.material.map((m) => m.clone());
		} else {
			mesh.material = mesh.material.clone();
		}
	});
	return cloned;
}

// Bind per-SKU baseColor textures to the materials named 'front' and 'back' in
// the source GLB. Other map slots (normal map shared between both faces) stay
// bound to the originals so the embossing/foil detail is preserved.
function applyMaterialTextures(
	scene: THREE.Object3D,
	front: THREE.Texture,
	back: THREE.Texture,
) {
	// glTF UV convention is Y-down. External PNGs/WebPs loaded via TextureLoader
	// default to Y-up (flipY = true), which would render upside-down on these
	// UVs. sRGB tag is required so the base color isn't double-corrected.
	for (const tex of [front, back]) {
		tex.flipY = false;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.needsUpdate = true;
	}
	scene.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.material) return;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const m of mats) {
			const mat = m as THREE.MeshStandardMaterial;
			if (mat.name === "front") mat.map = front;
			else if (mat.name === "back") mat.map = back;
			mat.needsUpdate = true;
		}
	});
}

// onReady fires once after first paint — captured at mount so a new closure
// each render doesn't refire. Shared by both bare and skinned variants.
function useFireOnReady(onReady?: () => void) {
	const ref = useRef(onReady);
	ref.current = onReady;
	useEffect(() => { ref.current?.(); }, []);
}

function GLTFBoosterBare({ onReady }: { onReady?: () => void }) {
	const { scene } = useGLTF(GLB_URL);
	useFireOnReady(onReady);
	return (
		<Center>
			<group rotation={GLB_ROTATION} scale={GLB_SCALE}>
				<primitive object={scene} />
			</group>
		</Center>
	);
}

function GLTFBoosterSkinned({ sku, onReady }: { sku: string; onReady?: () => void }) {
	const { scene } = useGLTF(GLB_URL);
	const skin = BOOSTER_TEXTURES[sku];
	const [front, back] = useTexture([skin.front, skin.back]) as THREE.Texture[];
	const cloned = useMemo(() => {
		const c = cloneSceneWithMaterials(scene);
		applyMaterialTextures(c, front, back);
		return c;
	}, [scene, front, back]);
	useFireOnReady(onReady);
	return (
		<Center>
			<group rotation={GLB_ROTATION} scale={GLB_SCALE}>
				<primitive object={cloned} />
			</group>
		</Center>
	);
}

function GLTFBooster({ sku, onReady }: { sku?: string; onReady?: () => void }) {
	if (sku && BOOSTER_TEXTURES[sku]) {
		return <GLTFBoosterSkinned sku={sku} onReady={onReady} />;
	}
	return <GLTFBoosterBare onReady={onReady} />;
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
// `sku` selects per-SKU artwork from BOOSTER_TEXTURES. Unknown / undefined →
// the GLB's embedded textures render as-is (current behavior).
//
// `onReady` fires once we have something to show — either the real GLB has
// loaded (and any SKU textures applied), or the error boundary kicked in and
// the procedural fallback is up. The Suspense fallback is `null` (not the
// procedural pack) so a slow-loading GLB shows transparency instead of popping
// a different mesh mid-rise; the parent gates the rise animation on this
// callback.
export default function Booster({ sku, onReady }: { sku?: string; onReady?: () => void }) {
	return (
		<GLBErrorBoundary fallback={<ProceduralBooster />} onFailed={onReady}>
			<Suspense fallback={null}>
				<GLTFBooster sku={sku} onReady={onReady} />
			</Suspense>
		</GLBErrorBoundary>
	);
}
