import { Toaster } from "@unimatrix/ui/editor";

import type { AdminSlotProps } from "./admin-slot";
import { AdminPage } from "./admin-page";
import { NewPostButton, PostControls } from "./post-controls";

/**
 * The admin chunk's single entry point.
 *
 * Every admin placement resolves through here so there is exactly one dynamic
 * `import()` in the app — one chunk to reason about, and one thing to check
 * when asking whether admin code reached a public page.
 */
export function AdminSurface(props: AdminSlotProps) {
  switch (props.kind) {
    case "toaster":
      return <Toaster position="bottom-right" />;
    case "page":
      return <AdminPage />;
    case "new-post":
      return <NewPostButton type={props.type} />;
    case "post-controls":
      return <PostControls slug={props.slug} type={props.type} />;
  }
}
