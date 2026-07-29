"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { ServiceId } from "@/lib/services";

const COLORS = {
  floor: "#ffffff",
  wall: "#f1fafb",
  wallShade: "#e3f3f5",
  furniture: "#dceef0",
  furnitureDark: "#bfdee1",
  primary: "#58c7c9",
  secondary: "#3a9edb",
  foreground: "#17233c",
};

const getServerSnapshot = () => false;

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", callback);
      return () => mediaQueryList.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    getServerSnapshot
  );
}

function CameraRig({ enabled }: { enabled: boolean }) {
  const { camera, invalidate } = useThree();
  const pointer = useRef(new THREE.Vector2(0, 0));
  const basePosition = useMemo(() => new THREE.Vector3(6, 4.4, 7), []);

  useEffect(() => {
    camera.position.copy(basePosition);
    camera.lookAt(0, 1.1, 0);
    invalidate();
  }, [camera, basePosition, invalidate]);

  useEffect(() => {
    if (!enabled) return;
    const handlePointerMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
      invalidate();
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [enabled, invalidate]);

  useFrame(() => {
    if (!enabled) return;
    const targetX = basePosition.x + pointer.current.x * 0.6;
    const targetY = basePosition.y - pointer.current.y * 0.3;
    camera.position.x += (targetX - camera.position.x) * 0.06;
    camera.position.y += (targetY - camera.position.y) * 0.06;
    camera.lookAt(0, 1.1, 0);
    if (Math.abs(targetX - camera.position.x) > 0.001) invalidate();
  });

  return null;
}

function FadeGroup({
  active,
  reducedMotion,
  liftY = 0,
  children,
}: {
  active: boolean;
  reducedMotion: boolean;
  liftY?: number;
  children: ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const progress = useRef(active ? 1 : 0);
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [active, invalidate]);

  useFrame((_, delta) => {
    const target = active ? 1 : 0;
    if (reducedMotion) {
      progress.current = target;
    } else if (Math.abs(target - progress.current) > 0.001) {
      progress.current += (target - progress.current) * Math.min(delta * 5, 1);
      invalidate();
    } else {
      progress.current = target;
    }

    const group = groupRef.current;
    if (!group) return;
    const p = progress.current;
    group.visible = p > 0.01;
    group.scale.setScalar(0.92 + p * 0.08);
    group.position.y = liftY * (1 - p);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const material = child.material as THREE.MeshStandardMaterial;
        material.transparent = true;
        material.opacity = p;
      }
    });
  });

  return <group ref={groupRef}>{children}</group>;
}

function Window({ isMobile }: { isMobile: boolean }) {
  return (
    <group position={[1.6, 2.3, -2.9]}>
      <RoundedBox args={[1.6, 1.2, 0.08]} radius={0.05}>
        <meshStandardMaterial color={COLORS.foreground} roughness={0.6} />
      </RoundedBox>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[1.4, 1]} />
        {isMobile ? (
          <meshStandardMaterial color="#ffffff" transparent opacity={0.35} roughness={0.2} />
        ) : (
          <meshPhysicalMaterial
            color="#ffffff"
            transparent
            opacity={0.4}
            roughness={0.05}
            transmission={0.85}
            thickness={0.3}
          />
        )}
      </mesh>
    </group>
  );
}

function Room({ detailActive, isMobile }: { detailActive: boolean; isMobile: boolean }) {
  const progress = useRef(detailActive ? 1 : 0);
  const kitchenMat = useRef<THREE.MeshStandardMaterial>(null);
  const bathMat = useRef<THREE.MeshStandardMaterial>(null);
  const baseboardMat = useRef<THREE.MeshStandardMaterial>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [detailActive, invalidate]);

  useFrame((_, delta) => {
    const target = detailActive ? 1 : 0;
    if (Math.abs(target - progress.current) > 0.001) {
      progress.current += (target - progress.current) * Math.min(delta * 5, 1);
      invalidate();
    } else {
      progress.current = target;
    }
    const intensity = progress.current * 0.8;
    if (kitchenMat.current) kitchenMat.current.emissiveIntensity = intensity;
    if (bathMat.current) bathMat.current.emissiveIntensity = intensity;
    if (baseboardMat.current) baseboardMat.current.emissiveIntensity = intensity;
  });

  return (
    <group>
      <RoundedBox args={[8, 0.2, 6]} radius={0.05} position={[0, -0.1, 0]} receiveShadow>
        <meshStandardMaterial color={COLORS.floor} roughness={0.75} />
      </RoundedBox>

      <RoundedBox args={[8, 4, 0.2]} radius={0.06} position={[0, 2, -3]} receiveShadow>
        <meshStandardMaterial color={COLORS.wall} roughness={0.9} />
      </RoundedBox>

      <RoundedBox args={[0.2, 4, 6]} radius={0.06} position={[-4, 2, 0]} receiveShadow>
        <meshStandardMaterial color={COLORS.wallShade} roughness={0.9} />
      </RoundedBox>

      <RoundedBox args={[7.6, 0.15, 0.1]} radius={0.02} position={[0, 0.08, -2.9]} castShadow={!isMobile}>
        <meshStandardMaterial
          ref={baseboardMat}
          color={COLORS.secondary}
          emissive={COLORS.secondary}
          emissiveIntensity={0}
          roughness={0.4}
        />
      </RoundedBox>

      <Window isMobile={isMobile} />

      <RoundedBox args={[1.6, 1.1, 0.6]} radius={0.06} position={[3, 0.55, -2.6]} castShadow={!isMobile} receiveShadow>
        <meshStandardMaterial color={COLORS.furniture} roughness={0.6} />
      </RoundedBox>
      <RoundedBox args={[1.7, 0.08, 0.65]} radius={0.03} position={[3, 1.14, -2.6]} castShadow={!isMobile}>
        <meshStandardMaterial
          ref={kitchenMat}
          color={COLORS.primary}
          emissive={COLORS.primary}
          emissiveIntensity={0}
          roughness={0.3}
        />
      </RoundedBox>

      <RoundedBox args={[0.9, 0.5, 0.9]} radius={0.15} position={[-3.2, 0.28, -2.3]} castShadow={!isMobile} receiveShadow>
        <meshStandardMaterial
          ref={bathMat}
          color={COLORS.wallShade}
          emissive={COLORS.secondary}
          emissiveIntensity={0}
          roughness={0.3}
        />
      </RoundedBox>
    </group>
  );
}

function Furniture({ isMobile }: { isMobile: boolean }) {
  return (
    <group position={[0, 0, 0.6]}>
      <RoundedBox args={[2.2, 0.6, 0.9]} radius={0.15} position={[-1.4, 0.32, 0.6]} castShadow={!isMobile} receiveShadow>
        <meshStandardMaterial color={COLORS.furniture} roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[2.2, 0.5, 0.4]} radius={0.15} position={[-1.4, 0.62, 0.15]} castShadow={!isMobile}>
        <meshStandardMaterial color={COLORS.furniture} roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[0.9, 0.35, 0.55]} radius={0.08} position={[0.4, 0.18, 1.1]} castShadow={!isMobile} receiveShadow>
        <meshStandardMaterial color={COLORS.furnitureDark} roughness={0.5} />
      </RoundedBox>
      <mesh position={[1.6, 0.55, 0.2]} castShadow={!isMobile}>
        <cylinderGeometry args={[0.03, 0.03, 1.1, 12]} />
        <meshStandardMaterial color={COLORS.foreground} />
      </mesh>
      <mesh position={[1.6, 1.15, 0.2]}>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color={COLORS.secondary} emissive={COLORS.secondary} emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function RecurringRing({ spinning }: { spinning: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const { invalidate } = useThree();

  useFrame((_, delta) => {
    if (!spinning || !ringRef.current) return;
    ringRef.current.rotation.z += delta * 0.2;
    invalidate();
  });

  return (
    <mesh ref={ringRef} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[2.8, 0.035, 12, 64]} />
      <meshStandardMaterial color={COLORS.primary} emissive={COLORS.primary} emissiveIntensity={0.5} roughness={0.3} />
    </mesh>
  );
}

function ResetGlow() {
  return (
    <mesh position={[0, 0.01, 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[2.2, 48]} />
      <meshStandardMaterial
        color={COLORS.primary}
        emissive={COLORS.primary}
        emissiveIntensity={0.25}
        transparent
        opacity={0.25}
      />
    </mesh>
  );
}

export default function PropertyScene({ serviceId }: { serviceId: ServiceId }) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const furnitureVisible =
    serviceId === "standard" || serviceId === "deep" || serviceId === "recurring";

  return (
    <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-background-alt to-white">
      <Canvas
        shadows={!isMobile}
        dpr={isMobile ? 1 : [1, 1.5]}
        frameloop="demand"
        camera={{ position: [6, 4.4, 7], fov: 30 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <hemisphereLight args={["#eaf7f8", "#ffffff", 0.65]} />
        <directionalLight
          position={[5, 6, 4]}
          intensity={0.9}
          castShadow={!isMobile}
          shadow-mapSize={isMobile ? [512, 512] : [1024, 1024]}
        />

        <CameraRig enabled={!reducedMotion} />

        <Room detailActive={serviceId === "deep"} isMobile={isMobile} />

        <FadeGroup active={furnitureVisible} reducedMotion={reducedMotion}>
          <Furniture isMobile={isMobile} />
        </FadeGroup>

        <FadeGroup active={serviceId === "recurring"} reducedMotion={reducedMotion}>
          <RecurringRing spinning={!reducedMotion && serviceId === "recurring"} />
        </FadeGroup>

        <FadeGroup active={serviceId === "move"} reducedMotion={reducedMotion}>
          <ResetGlow />
        </FadeGroup>

        <ContactShadows
          position={[0, -0.01, 0]}
          opacity={isMobile ? 0.25 : 0.4}
          scale={8}
          blur={2}
          far={3}
          resolution={isMobile ? 256 : 512}
          color={COLORS.foreground}
          frames={reducedMotion ? 1 : Infinity}
        />
      </Canvas>
    </div>
  );
}
