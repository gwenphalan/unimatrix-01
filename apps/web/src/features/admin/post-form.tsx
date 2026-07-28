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

import { AdminPanel } from "./admin-shell";
import { ASSET_ACCEPT, assetUrl, uploadAsset } from "./asset-upload";
import { useCreatePost, useUpdatePost } from "./mutations";
import { slugifyTitle } from "./slugify";

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
    repoUrl: isProject ? orNull(form.repoUrl) : null,
    liveUrl: isProject ? orNull(form.liveUrl) : null,
  };
}

export interface PostFormProps {
  /** The post being edited, or `null` to create a new one. */
  post: ContentPost | null;
  /** Collection the created post belongs to. Ignored when editing. */
  type: ContentPostType;
  /** Heading for the panel this form renders as. */
  title: string;
  /** Leave the form — called after a successful save and on cancel. */
  onDone: () => void;
}

/**
 * Create/edit form for one post, with the markdown body edited in place.
 *
 * A page rather than a dialog: writing a post is the longest-running thing an
 * admin does here, and a modal caps the editor at a fraction of the viewport
 * while trapping focus. The form is height-agnostic — it fills whatever column
 * it is given and hands the leftover space to the editor — so the route decides
 * how tall it is.
 *
 * Slug is editable while creating and while editing: changing it is a real
 * thing an admin needs to do, and the API enforces `(type, slug)` uniqueness,
 * so a collision comes back as a 400 with a message rather than being
 * prevented by a guess here.
 *
 * The form owns its {@link AdminPanel} rather than being placed inside one by
 * the route: the publication state belongs in the panel header, beside the
 * title, and it has to stay inside the `<form>` element to be part of the same
 * submission and to keep its `<label for>` association.
 */
export function PostForm({ post, type, title, onDone }: PostFormProps) {
  const effectiveType = post?.type ?? type;
  const [form, setForm] = useState<PostFormState>(() =>
    post === null ? EMPTY_FORM : toFormState(post),
  );
  /**
   * Whether the slug has been typed rather than derived, which stops the title
   * from overwriting it.
   *
   * Starts `true` when editing: an existing post's slug is its published URL,
   * and having a title edit silently rewrite it would break every link to the
   * post. Clearing the field puts it back under the title's control, which is
   * the only way to get the derived value back after typing one by hand.
   */
  const [isSlugEdited, setIsSlugEdited] = useState(post !== null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { getToken } = useAuth();
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();
  const fieldPrefix = useId();
  // Mirrors the editor's own expand state. The editor cannot release a height
  // lock set above it, so the column it sits in has to stop claiming the frame
  // when the body is expanded to the whole document.
  const [bodyExpanded, setBodyExpanded] = useState(false);

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

      onDone();
    } catch {
      // The mutation's `onError` already raised a toast naming the failure,
      // and the form stays put so the admin keeps what they typed.
    }
  }

  return (
    <form
      // `min-h-0` on a flex child is what lets the editor below actually
      // shrink; without it the column's implicit `min-height: auto` lets the
      // body push the controls under it off the frame instead of scrolling
      // inside its own box. Expanded, that is exactly what is wanted, so the
      // claim on the frame is dropped and the page scrolls instead.
      className={bodyExpanded ? "flex flex-col" : "flex min-h-0 flex-1 flex-col"}
      onSubmit={(event) => {
        // `onSubmit` expects a void return, so the promise is deliberately
        // not handed to React. `handleSubmit` settles its own failures.
        void handleSubmit(event);
      }}
    >
      <AdminPanel className={bodyExpanded ? "" : "flex min-h-0 flex-1 flex-col"} title={title}>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${fieldPrefix}-title`}>Title</Label>
              <Input
                id={`${fieldPrefix}-title`}
                maxLength={200}
                onChange={(event) => {
                  const title = event.target.value;

                  setForm((current) => ({
                    ...current,
                    title,
                    slug: isSlugEdited ? current.slug : slugifyTitle(title),
                  }));
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
                  const slug = event.target.value;

                  setIsSlugEdited(slug.length > 0);
                  update("slug", slug);
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
              {/* No "project status" field. A project's status is not something
                  an admin keeps up to date by hand — it is whether the thing is
                  reachable, which `ProjectStatusBadge` answers by requesting
                  the live URL below and reporting what actually happened. A
                  typed value would only ever be a stale second opinion. */}
              <div className="grid gap-4 sm:grid-cols-2">
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
        </div>

        <Separator />

        {/* "Body" and "Insert image" are handed to the editor's own toolbar
          row rather than rendered above it, so the label sits immediately
          on top of the editing surface and the upload button lines up with
          the formatting controls it belongs beside. */}
        <MarkdownEditor
          className={bodyExpanded ? "" : "min-h-0 flex-1"}
          // Scrolls inside its box by default, so the controls under it stay
          // on screen; the expand control it draws bottom-right hands the whole
          // document to the page for anyone editing something long.
          expandable
          onExpandedChange={setBodyExpanded}
          actions={
            <>
              <Button
                aria-label={isUploading ? "Uploading image" : "Insert image"}
                className="size-8"
                disabled={isUploading}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                size="icon"
                title={isUploading ? "Uploading image" : "Insert image"}
                type="button"
                variant="ghost"
              >
                {isUploading ? (
                  <RiLoader4Line aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <RiImageAddLine aria-hidden="true" className="size-4" />
                )}
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
            </>
          }
          header={<Label>Body</Label>}
          label="Post body"
          onChange={(next) => {
            update("body", next);
          }}
          placeholder="Write the post in markdown."
          ref={editorRef}
          value={form.body}
        />

        {/* Below the body, not above it: these are what you reach for once the
            post is written. State on the left because it is a property of the
            post; the two buttons that end the edit on the right, Save last,
            where a submit button is looked for. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Off-screen. "Published" / "Draft" / "Archived" already read as a
                state, so the word in front of them is a label for a screen
                reader and clutter for everyone else. */}
            <Label className="sr-only" htmlFor={`${fieldPrefix}-state`}>
              State
            </Label>
            <Select
              onValueChange={(next) => {
                update("publicationState", next as ContentPublicationState);
              }}
              value={form.publicationState}
            >
              <SelectTrigger className="w-36 sm:w-40" id={`${fieldPrefix}-state`}>
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

          <div className="flex items-center gap-2">
            <Button disabled={isSaving} onClick={onDone} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Saving" : post === null ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </AdminPanel>
    </form>
  );
}
