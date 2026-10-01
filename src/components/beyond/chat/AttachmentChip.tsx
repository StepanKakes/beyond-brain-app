import { File as FileIcon, X } from '../icons';

import type { PendingAttachment } from './types';

/**
 * Composer attachment chip, the React Bits PromptBar chip: pops in, name
 * truncates, a small cross removes it. Images carry their thumbnail.
 */
export default function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const kb = Math.max(1, Math.round(attachment.size / 1024));
  const image = attachment.kind === 'image';

  return (
    <span className="prompt-bar__chip bb-pb__chip" data-image={image ? '' : undefined} title={`${attachment.name}, ${kb} kB`}>
      {image ? (
        <img src={attachment.data} alt="" className="bb-pb__thumb" />
      ) : (
        <FileIcon size={12} />
      )}
      <span className="prompt-bar__chip-name">{attachment.name}</span>
      <span className="bb-pb__size">{kb} kB</span>
      <button type="button" className="prompt-bar__chip-x" aria-label={`Odebrat ${attachment.name}`} onClick={onRemove}>
        <X size={10} />
      </button>
    </span>
  );
}
