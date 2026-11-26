import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Box = [number, number, number];

interface Part {
  name: string;
  size: Box;
  position: [number, number, number];
  atlas: { x: number; y: number };
}

/** Atlas de skin 64×64 — positions des faces de chaque membre. */
function partsFor(model: "steve" | "alex"): Part[] {
  const armWidth = model === "alex" ? 3 : 4;
  return [
    { name: "head", size: [8, 8, 8], position: [0, 10, 0], atlas: { x: 0, y: 0 } },
    { name: "body", size: [8, 12, 4], position: [0, 0, 0], atlas: { x: 16, y: 16 } },
    { name: "arm-right", size: [armWidth, 12, 4], position: [-(6 + armWidth / 2), 0, 0], atlas: { x: 40, y: 16 } },
    { name: "arm-left", size: [armWidth, 12, 4], position: [6 + armWidth / 2, 0, 0], atlas: { x: 32, y: 48 } },
    { name: "leg-right", size: [4, 12, 4], position: [-2, -12, 0], atlas: { x: 0, y: 16 } },
    { name: "leg-left", size: [4, 12, 4], position: [2, -12, 0], atlas: { x: 16, y: 48 } },
  ];
}

function faceRects(part: Part): Array<[number, number, number, number]> {
  const [w, h, d] = part.size;
  const { x, y } = part.atlas;
  // Ordre des groupes BoxGeometry : +X, -X, +Y, -Y, +Z, -Z
  return [
    [x + d + w, y + d, d, h], // +X (droite du modèle) — vue de côté
    [x, y + d, d, h], // -X
    [x + d, y, w, d], // +Y (dessus)
    [x + d + w, y, w, d], // -Y (dessous)
    [x + d, y + d, w, h], // +Z (face avant)
    [x + d + w + d, y + d, w, h], // -Z (dos)
  ];
}

function cropTexture(image: HTMLImageElement, rect: [number, number, number, number]): THREE.CanvasTexture {
  const [sx, sy, sw, sh] = rect;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sw);
  canvas.height = Math.max(1, sh);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Rendu 3D du skin (three.js), rotation à la souris avec inertie douce. */
export function SkinViewer({ skin, model }: { skin: string | null; model: "steve" | "alex" }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !skin) return;

    setError(null);
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 200);
    camera.position.set(0, 2, 46);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("Le rendu 3D n'est pas disponible sur ce poste.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(-14, 22, 26);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8b6bff, 1.4);
    rim.position.set(20, 8, -18);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x4f9cff, 0.7);
    fill.position.set(16, -12, 12);
    scene.add(fill);

    const group = new THREE.Group();
    scene.add(group);

    const disposables: Array<THREE.Texture | THREE.Material | THREE.BufferGeometry> = [];
    const image = new Image();
    image.crossOrigin = "anonymous";

    let disposed = false;
    let animationFrame = 0;

    image.onload = () => {
      if (disposed) return;
      const parts = partsFor(model);
      for (const part of parts) {
        const geometry = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
        const materials = faceRects(part).map((rect) => {
          const texture = cropTexture(image, rect);
          disposables.push(texture);
          return new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.5 });
        });
        materials.forEach((material) => disposables.push(material));
        disposables.push(geometry);
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.position.set(part.position[0], part.position[1], part.position[2]);
        group.add(mesh);
      }
      group.position.y = 1;
    };
    image.onerror = () => setError("Impossible de charger le skin.");
    image.src = skin;

    let yaw = -0.35;
    let pitch = 0.06;
    let targetYaw = yaw;
    let targetPitch = pitch;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let lastInteraction = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      lastInteraction = Date.now();
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      targetYaw += (event.clientX - lastX) * 0.012;
      targetPitch = Math.max(-0.6, Math.min(0.6, targetPitch + (event.clientY - lastY) * 0.008));
      lastX = event.clientX;
      lastY = event.clientY;
      lastInteraction = Date.now();
    };
    const onPointerUp = () => {
      dragging = false;
      lastInteraction = Date.now();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    const clock = new THREE.Clock();
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (!dragging && Date.now() - lastInteraction > 2200) targetYaw += delta * 0.35;
      yaw += (targetYaw - yaw) * 0.12;
      pitch += (targetPitch - pitch) * 0.12;
      group.rotation.y = yaw;
      group.rotation.x = pitch * 0.5;
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      for (const item of disposables) item.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
  }, [skin, model]);

  if (!skin || error) {
    return (
      <div className="skin-stage">
        <div className="empty">{error ?? "Aucun skin importé pour l'instant."}</div>
      </div>
    );
  }

  return (
    <div className="skin-stage" ref={containerRef}>
      <div className="stage-hint">Faites glisser pour faire pivoter</div>
    </div>
  );
}
