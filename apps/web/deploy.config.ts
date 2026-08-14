import { staticSpaApp } from "@unimatrix/deploy-config";

export default staticSpaApp({
  appDir: "web",
  packageName: "@unimatrix/web",
  buildArgs: [{ name: "VITE_API_BASE_URL", default: "/api" }],
  extraBuildPaths: ["content/home"],
});
