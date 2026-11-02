import { buildApp } from "@talksume/server";

const app = buildApp({
  edition: "cloud",
  version: process.env.APP_VERSION ?? "dev",
  logger: true,
});

const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: "0.0.0.0", port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}
