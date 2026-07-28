import { Toaster } from "@unimatrix/ui/editor";

import type { AdminSlotProps } from "./admin-slot";
import { AdminPage } from "./admin-page";
import { AdminShell } from "./admin-shell";
import { PostFormPage } from "./post-form-page";
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
    case "shell":
      return <AdminShell>{props.children}</AdminShell>;
    case "page":
      return <AdminPage />;
    case "post-form":
      return <PostFormPage postId={props.postId} type={props.type} />;
    case "new-post":
      return <NewPostButton type={props.type} />;
    case "post-controls":
      return <PostControls slug={props.slug} type={props.type} />;
  }
}
