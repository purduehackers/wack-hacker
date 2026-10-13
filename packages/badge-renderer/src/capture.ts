import { createBadgeScene } from "./scene.ts";

window.renderBadge = async (input) => {
  const { renderer, scene, camera, dispose } = await createBadgeScene(input);
  try {
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  } finally {
    dispose();
  }
};
