import { staticSpaApp } from "@unimatrix/deploy-config";

export default staticSpaApp({
  appDir: "cflop",
  packageName: "@unimatrix/cflop",
  publicStatus: true,
  buildArgs: [],
});
