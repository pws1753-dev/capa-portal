import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast-context";
import { useApiMutation, useAttachments, type ComplaintDetail } from "@/services/queries";
import { useCloudinaryUpload } from "./shared";

/** One photo per complaint, shown beside the description. Uploading a new photo replaces the old one. */
export function ComplaintPhoto({ complaint, canEdit }: { complaint: ComplaintDetail; canEdit: boolean }) {
  const toast = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const attachments = useAttachments("Complaint", complaint._id);
  const photo = (attachments.data?.attachments ?? []).find((item) => item.purpose === "complaint.photo");

  const { upload, uploading } = useCloudinaryUpload({
    entityType: "Complaint",
    entityId: complaint._id,
    purpose: "complaint.photo",
    company: complaint.company
  });
  const remove = useApiMutation<{ message: string }, string>("DELETE", (id) => `/api/attachments/${id}`, [["attachments", "Complaint", complaint._id]]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.failure(new Error("Choose an image file (JPG, PNG, WebP or GIF)."), "This is not an image");
      return;
    }
    try {
      await upload(file);
      toast.success("Photo saved", "It now shows on this complaint.");
      await attachments.refetch();
    } catch (error) {
      toast.failure(error, "The photo could not be uploaded");
    }
  }

  async function onRemove() {
    if (!photo) return;
    try {
      await remove.mutateAsync(photo._id);
      toast.success("Photo removed");
      setConfirmRemove(false);
    } catch (error) {
      toast.failure(error, "The photo could not be removed");
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-400">Complaint photo</p>
      {photo ? (
        <>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 hover:ring-2 hover:ring-brand-red/40"
            title="Click to enlarge"
          >
            <img src={photo.secureUrl} alt={photo.originalFilename} loading="lazy" className="h-44 w-full object-cover" />
          </button>
          <Modal open={previewOpen} onOpenChange={setPreviewOpen} title={photo.originalFilename}>
            <img src={photo.secureUrl} alt={photo.originalFilename} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-md object-contain" />
          </Modal>
        </>
      ) : (
        <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
          {attachments.isLoading ? "Loading…" : "No photo uploaded"}
        </div>
      )}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <label
            className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 ${uploading ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <ImagePlus className="h-4 w-4" />
            {uploading ? "Uploading" : photo ? "Replace photo" : "Upload photo"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                void onFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {photo ? (
            <Button variant="ghost" onClick={() => setConfirmRemove(true)} className="h-9 text-xs">
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the complaint photo?"
        destructive
        description="The photo is deleted from this complaint."
        confirmLabel="Remove"
        onConfirm={onRemove}
      />
    </div>
  );
}
