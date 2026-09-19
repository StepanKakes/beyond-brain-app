import { File as FileIcon, X } from 'lucide-react';

import type { PendingAttachment } from './types';

/** Composer attachment chip — thumbnail for images, name and size for text. */
export default function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const kb = Math.max(1, Math.round(attachment.size / 1024));

  if (attachment.kind === 'image') {
    return (
      <div className="group relative flex items-center gap-2 rounded-xl bg-black/[0.04] py-1 pl-1 pr-2">
        <img
          src={attachment.data}
          alt={attachment.name}
          className="h-9 w-9 flex-shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-beyond-ink">{attachment.name}</p>
          <p className="text-[10px] text-beyond-faint">{kb} kB</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.08] hover:text-beyond-ink"
          aria-label="Odebrat"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-2 rounded-xl bg-black/[0.04] px-2 py-1.5">
      <FileIcon className="h-[14px] w-[14px] flex-shrink-0 text-beyond-faint" strokeWidth={1.8} />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-beyond-ink">{attachment.name}</p>
        <p className="text-[10px] text-beyond-faint">{kb} kB · text</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-beyond-faint transition-colors hover:bg-black/[0.08] hover:text-beyond-ink"
        aria-label="Odebrat"
      >
        <X className="h-[12px] w-[12px]" strokeWidth={2} />
      </button>
    </div>
  );
}
