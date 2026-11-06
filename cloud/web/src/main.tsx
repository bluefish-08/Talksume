import { registerExtensions } from "@talksume/web/extensions.ts";
import { mountApp } from "@talksume/web/mount.tsx";
import "@talksume/web/styles/global.css";
import { cloudExtensions } from "./extensions.tsx";

registerExtensions(cloudExtensions);
mountApp();
