import { copyFile, mkdir } from "node:fs/promises";

await mkdir(".pages-dist/v2", { recursive: true });
await copyFile(".pages-dist/index.html", ".pages-dist/v2/index.html");
await copyFile(".pages-dist/index.html", ".pages-dist/404.html");
