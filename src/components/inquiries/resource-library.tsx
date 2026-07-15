"use client";

// The persistent "helpful resources" library for the Inquiries section — the
// photos and documents reps send customers constantly (4-stall photos, ADA
// trailer photos, spec sheets...). Rendered as a compact button in the
// SectionTabs strip (so it's pinned top-right on every inquiries view, app and
// embed alike) that opens a slide-out panel of folder-organized files. Every
// file lives in the public inquiry-resources bucket, so "Copy link" yields a
// stable URL a rep can paste straight into an email.

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FolderOpen,
  Folder,
  FolderPlus,
  Upload,
  Link as LinkIcon,
  Download,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useResources } from "@/lib/inquiries/use-resources";
import {
  publicResourceUrl,
  downloadResourceUrl,
  isImage,
  fmtSize,
  type ResourceFolder,
  type ResourceItem,
} from "@/lib/inquiries/resources";

function copyLink(item: ResourceItem) {
  navigator.clipboard
    .writeText(publicResourceUrl(item.file_path))
    .then(() => toast.success("Link copied — paste it into any email"))
    .catch(() => toast.error("Couldn't copy the link"));
}

function ResourceRow({
  item,
  folders,
  onRename,
  onMove,
  onDelete,
}: {
  item: ResourceItem;
  folders: ResourceFolder[];
  onRename: (label: string) => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const url = publicResourceUrl(item.file_path);

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
      {isImage(item) ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny public-bucket thumbnail; next/image gains nothing here
        <img
          src={url}
          alt={item.label}
          className="size-9 shrink-0 rounded object-cover ring-1 ring-border"
          loading="lazy"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted">
          <FileText className="size-4 text-muted-foreground" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) onRename(draft.trim());
              setEditing(false);
            }}
          >
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setEditing(false)}
              className="h-7 text-sm"
            />
          </form>
        ) : (
          <>
            <div className="truncate text-sm">{item.label}</div>
            <div className="text-[11px] text-muted-foreground">{fmtSize(item.size_bytes)}</div>
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        title="Copy link"
        onClick={() => copyLink(item)}
      >
        <LinkIcon className="size-3.5" />
      </Button>
      <a
        href={downloadResourceUrl(item)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Download"
      >
        <Download className="size-3.5" />
      </a>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Open"
      >
        <ExternalLink className="size-3.5" />
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0">
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setDraft(item.label);
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
          {folders
            .filter((f) => f.id !== item.folder_id)
            .map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => onMove(f.id)}>
                <Folder className="size-3.5" /> {f.name}
              </DropdownMenuItem>
            ))}
          {item.folder_id != null && (
            <DropdownMenuItem onClick={() => onMove(null)}>
              <Folder className="size-3.5" /> Unfiled
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FolderSection({
  folder,
  items,
  folders,
  uploading,
  onUpload,
  onRenameFolder,
  onDeleteFolder,
  lib,
}: {
  folder: ResourceFolder | null; // null = Unfiled
  items: ResourceItem[];
  folders: ResourceFolder[];
  uploading: boolean;
  onUpload: (files: FileList) => void;
  onRenameFolder?: (name: string) => void;
  onDeleteFolder?: () => void;
  lib: ReturnType<typeof useResources>;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder?.name ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!folder && items.length === 0) return null;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="size-4 shrink-0 text-amber-600" />
          {editing && folder ? (
            <form
              className="flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) onRenameFolder?.(draft.trim());
                setEditing(false);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(false)}
                className="h-7 text-sm"
              />
            </form>
          ) : (
            <span className="truncate text-sm font-medium">
              {folder ? folder.name : "Unfiled"}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{items.length}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Upload files here"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
        </Button>
        {folder && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setDraft(folder.name);
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" /> Rename folder
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDeleteFolder}>
                <Trash2 className="size-3.5" /> Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && (
        <div className="border-t px-1 py-1">
          {items.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Empty — use the upload arrow to add photos or documents.
            </p>
          ) : (
            items.map((item) => (
              <ResourceRow
                key={item.id}
                item={item}
                folders={folders}
                onRename={(label) => lib.updateResource(item.id, { label })}
                onMove={(folderId) => lib.updateResource(item.id, { folder_id: folderId })}
                onDelete={() => lib.deleteResource(item.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ResourceLibrary({ entityId }: { entityId: string }) {
  const lib = useResources(entityId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  const [uploadingIn, setUploadingIn] = useState<string | "unfiled" | null>(null);

  const upload = async (files: FileList, folderId: string | null) => {
    setUploadingIn(folderId ?? "unfiled");
    try {
      for (const file of Array.from(files)) {
        await lib.uploadResource(file, folderId);
      }
    } finally {
      setUploadingIn(null);
    }
  };

  const byFolder = (id: string | null) =>
    lib.resources.filter((r) => (r.folder_id ?? null) === id);

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 whitespace-nowrap">
          <FolderOpen className="size-3.5" />
          Resources
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-[420px]">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="size-4" /> Resource library
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Photos and documents you send customers all the time. Copy a link and paste it
            into any email — links are permanent and public.
          </p>
        </SheetHeader>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {lib.loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {lib.folders.map((f) => (
                <FolderSection
                  key={f.id}
                  folder={f}
                  items={byFolder(f.id)}
                  folders={lib.folders}
                  uploading={uploadingIn === f.id}
                  onUpload={(files) => upload(files, f.id)}
                  onRenameFolder={(name) => lib.renameFolder(f.id, name)}
                  onDeleteFolder={() => lib.deleteFolder(f.id)}
                  lib={lib}
                />
              ))}
              <FolderSection
                folder={null}
                items={byFolder(null)}
                folders={lib.folders}
                uploading={uploadingIn === "unfiled"}
                onUpload={(files) => upload(files, null)}
                lib={lib}
              />
              {addingFolder ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newFolder.trim()) {
                      lib.createFolder(newFolder.trim());
                      setNewFolder("");
                      setAddingFolder(false);
                    }
                  }}
                >
                  <Input
                    autoFocus
                    placeholder="Folder name"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" className="h-8">
                    Add
                  </Button>
                </form>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground"
                  onClick={() => setAddingFolder(true)}
                >
                  <FolderPlus className="size-3.5" /> New folder
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
