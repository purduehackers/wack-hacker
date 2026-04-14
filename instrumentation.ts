export async function register() {
  const { initLogger } = await import("evlog");
  initLogger({ env: { service: "wack-hacker" } });
}
