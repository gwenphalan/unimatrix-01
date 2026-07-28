import { RiImageAddLine, RiLoader4Line } from "@remixicon/react";
import { useAuth } from "@unimatrix/auth/react";
import type {
  ContentPost,
  ContentPostType,
  ContentPublicationState,
  CreatePostBody,
  UpdatePostBody,
} from "@unimatrix/shared";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MarkdownEditor,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  toast,
  type MarkdownEditorHandle,
} from "@unimatrix/ui/editor";
import { useId, useRef, useState } from "react";

import { ASSET_ACCEPT, assetUrl, uploadAsset } from "./asset-upload";
import { useCreatePost, useUpdatePost } from "./mutations";

const PUBLICATION_STATES: readonly ContentPublicationState[] = ["draft", "published", "archived"];

const STATE_LABELS: Record<ContentPublicationState, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

/**
 * The form's own state, which is all strings and booleans.
 *
 * Deliberately not `CreatePostBody`: a text input's empty value is `""`, and
 * the contract wants `null` for a cleared optional and a real URL or nothing
 * for `repoUrl`. Keeping the two shapes apart means the conversion happens
 * once, in {@link toCreateBody}/{@link toUpdateBody}, rather than at every
 * `onChange`.
 */
interface PostFormState {
  slug: string;
  title: string;
  summary: string;
  description: string;
  body: string;
  publicationState: ContentPublicationState;
  featured: boolean;
  projectStatus: string;
  repoUrl: string;
  liveUrl: string;
}

const EMPTY_FORM: PostFormState = {
  slug: "",
  title: "",
  summary: "",
  description: "",
  body: "",
  publicationState: "draft",
  featured: false,
  projectStatus: "",
  repoUrl: "",
  liveUrl: "",
};

function toFormState(post: ContentPost): PostFormState {
  return {
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    description: post.description ?? "",
    body: post.body,
    publicationState: post.publicationState,
    featured: post.featured,
    projectStatus: post.projectStatus ?? "",
    repoUrl: post.repoUrl ?? "",
    liveUrl: post.liveUrl ?? "",
  };
}

/** `""` means "no value" in a text input; the contract spells that `null`. */
function orNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

function toCreateBody(form: PostFormState, type: ContentPostType): CreatePostBody {
  return {
    type,
    slug: form.slug.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    description: orNull(form.description),
    body: form.body,
    publicationState: form.publicationState,
    featured: type === "project" && form.featured,
    projectStatus: type === "project" ? orNull(form.projectStatus) : null,
    repoUrl: type === "project" ? orNull(form.repoUrl) : null,
    liveUrl: type === "project" ? orNull(form.liveUrl) : null,
  };
}

/**
 * Built field by field rather than spread from {@link toCreateBody}: the
 * update schema is a `strictObject` without `type`, so an inherited `type`
 * key — even one set to `undefined` — is an unknown key and a 400.
 */
function toUpdateBody(form: PostFormState, post: ContentPost): UpdatePostBody {
  const isProject = post.type === "project";

  return {
    id: post.id,
    slug: form.slug.trim(),
    title: form.title.trim(),
    summary: form.summary.trim(),
    description: orNull(form.description),
    body: form.body,
    publicationState: form.publicationState,
    featured: isProject && form.featured,
    projectStatus: isProject ? orNull(form.projectStatus) : null,
    repoUrl: isProject ? orNull(form.repoUrl) : null,
    liveUrl: isProject ? orNull(form.liveUrl) : null,
  };
}

export interface PostFormDialogProps {
  /** The post being edited, or `null` to create a new one. */
  post: ContentPost | null;
  /** Collection the created post belongs to. Ignored when editing. */
  type: ContentPostType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create/edit form for one post, with the markdown body edited in place.
 *
 * Slug is editable while creating and while editing: changing it is a real
 * thing an admin needs to do, and the API enforces `(type, slug)` uniqueness,
 * so a collision comes back as a 400 with a message rather than being
 * prevented by a guess here.
 */
export function PostFormDialog({ post, type, open, onOpenChange }: PostFormDialogProps) {
  const effectiveType = post?.type ?? type;
  const [form, setForm] = useState<PostFormState>(() =>
    post === null ? EMPTY_FORM : toFormState(post),
  );
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { getToken } = useAuth();
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();
  const fieldPrefix = useId();

  const isSaving = createPost.isPending || updatePost.isPending;

  function update<TKey extends keyof PostFormState>(key: TKey, value: PostFormState[TKey]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleUpload(file: File) {
    setIsUploading(true);

    try {
      const asset = await uploadAsset(file, await getToken());

      editorRef.current?.insertAtCursor(`![${file.name}](${assetUrl(asset.hash)})`);
      toast.success(`${file.name} uploaded.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      if (post === null) {
        await createPost.mutateAsync(toCreateBody(form, effectiveType));
      } else {
        await updatePost.mutateAsync(toUpdateBody(form, post));
      }

      onOpenChange(false);
    } catch {
      // The mutation's `onError` already raised a toast naming the failure,
      // and the dialog stays open so the admin keeps what they typed.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {post === null
              ? `New ${effectiveType === "blog" ? "blog post" : "project"}`
              : `Edit ${post.title}`}
          </DialogTitle>
          <DialogDescription>
            The body is markdown. Drafts stay off the public site until you publish them.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            // `onSubmit` expects a void return, so the promise is deliberately
            // not handed to React. `handleSubmit` settles its own failures.
            void handleSubmit(event);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${fieldPrefix}-title`}>Title</Label>
              <Input
                id={`${fieldPrefix}-title`}
                maxLength={200}
                onChange={(event) => {
                  update("title", event.target.value);
                }}
                required
                value={form.title}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`${fieldPrefix}-slug`}>Slug</Label>
              <Input
                id={`${fieldPrefix}-slug`}
                onChange={(event) => {
                  update("slug", event.target.value);
                }}
                pattern="[a-z0-9][a-z0-9-]*"
                required
                title="Lowercase letters, numbers and hyphens, not starting with a hyphen."
                value={form.slug}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldPrefix}-summary`}>Summary</Label>
            <Input
              id={`${fieldPrefix}-summary`}
              maxLength={500}
              onChange={(event) => {
                update("summary", event.target.value);
              }}
              required
              value={form.summary}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldPrefix}-description`}>
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${fieldPrefix}-description`}
              maxLength={1000}
              onChange={(event) => {
                update("description", event.target.value);
              }}
              value={form.description}
            />
          </div>

          {effectiveType === "project" ? (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor={`${fieldPrefix}-status`}>Project status</Label>
                  <Input
                    id={`${fieldPrefix}-status`}
                    onChange={(event) => {
                      update("projectStatus", event.target.value);
                    }}
                    placeholder="live"
                    value={form.projectStatus}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${fieldPrefix}-repo`}>Repository URL</Label>
                  <Input
                    id={`${fieldPrefix}-repo`}
                    onChange={(event) => {
                      update("repoUrl", event.target.value);
                    }}
                    type="url"
                    value={form.repoUrl}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${fieldPrefix}-live`}>Live URL</Label>
                  <Input
                    id={`${fieldPrefix}-live`}
                    onChange={(event) => {
                      update("liveUrl", event.target.value);
                    }}
                    type="url"
                    value={form.liveUrl}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.featured}
                  id={`${fieldPrefix}-featured`}
                  onCheckedChange={(checked) => {
                    update("featured", checked === true);
                  }}
                />
                <Label htmlFor={`${fieldPrefix}-featured`}>Feature on the homepage</Label>
              </div>
            </>
          ) : null}

          <Separator />

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`${fieldPrefix}-body`}>Body</Label>
              <Button
                className="gap-2"
                disabled={isUploading}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {isUploading ? (
                  <RiLoader4Line aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <RiImageAddLine aria-hidden="true" className="size-4" />
                )}
                {isUploading ? "Uploading" : "Insert image"}
              </Button>
              <input
                accept={ASSET_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  // Reset first: picking the same file twice in a row fires no
                  // change event otherwise, and re-inserting an image is a
                  // normal thing to do.
                  event.target.value = "";

                  if (file !== undefined) {
                    void handleUpload(file);
                  }
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>

            <MarkdownEditor
              label="Post body"
              onChange={(next) => {
                update("body", next);
              }}
              placeholder="Write the post in markdown."
              ref={editorRef}
              value={form.body}
            />
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground" htmlFor={`${fieldPrefix}-state`}>
                State
              </Label>
              <Select
                onValueChange={(next) => {
                  update("publicationState", next as ContentPublicationState);
                }}
                value={form.publicationState}
              >
                <SelectTrigger className="w-40" id={`${fieldPrefix}-state`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PUBLICATION_STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {STATE_LABELS[state]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                disabled={isSaving}
                onClick={() => {
                  onOpenChange(false);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={isSaving} type="submit">
                {isSaving ? "Saving" : post === null ? "Create" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
