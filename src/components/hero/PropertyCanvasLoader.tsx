"use client";

import { Component, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { ServiceId } from "@/lib/services";
import PropertyFallback from "./PropertyFallback";

const PropertyScene = dynamic(() => import("./PropertyScene"), { ssr: false });

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

const subscribeNever = () => () => {};
const getServerSnapshot = () => false;

function useWebGLSupport(): boolean {
  return useSyncExternalStore(subscribeNever, hasWebGL, getServerSnapshot);
}

class CanvasErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default function PropertyCanvasLoader({ serviceId }: { serviceId: ServiceId }) {
  const webglReady = useWebGLSupport();

  if (!webglReady) {
    return <PropertyFallback serviceId={serviceId} />;
  }

  return (
    <CanvasErrorBoundary fallback={<PropertyFallback serviceId={serviceId} />}>
      <PropertyScene serviceId={serviceId} />
    </CanvasErrorBoundary>
  );
}
