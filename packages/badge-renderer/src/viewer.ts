import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { createBadgeScene } from "./scene.ts";

async function start() {
  const viewport = document.querySelector("main");
  if (!viewport) throw new Error("Missing preview area.");
  const { renderer, scene, camera, half, dispose } = await createBadgeScene(window.badgeInput);
  viewport.append(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Interactive 3D badge preview");
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minZoom = 0.5;
  controls.maxZoom = 4;
  controls.saveState();
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener("change", draw);
  document.querySelector("button")?.addEventListener("click", () => controls.reset());
  const resize = new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect();
    const aspect = width / Math.max(height, 1);
    camera.left = -half * Math.max(aspect, 1);
    camera.right = -camera.left;
    camera.top = half / Math.min(aspect, 1);
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(width, height);
    draw();
  });
  await renderer.compileAsync(scene, camera);
  resize.observe(viewport);
  document.querySelector("[role=status]")?.remove();
  window.addEventListener(
    "pagehide",
    () => {
      resize.disconnect();
      controls.dispose();
      dispose();
    },
    { once: true },
  );
}

void start().catch(() => {
  const status = document.querySelector("[role=status]");
  if (status)
    status.textContent =
      "I couldn’t open the 3D preview. Reload the page or check the image in Discord.";
});
