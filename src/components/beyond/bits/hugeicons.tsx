import type { CSSProperties } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  Globe,
  LifeBuoy,
  Mail,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  TrendingUp,
  X,
  type IconComponent,
} from '../icons';

/**
 * React Bits ships its components against Hugeicons. The brain draws every
 * icon from the Solar set, so this module stands in for both Hugeicons
 * packages: the ported components keep their code, and each icon name they
 * ask for resolves to the Solar icon that means the same thing.
 */

export type IconSvgElement = IconComponent;

export function HugeiconsIcon({
  icon: Icon,
  size = 16,
  className,
  style,
}: {
  icon: IconSvgElement;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return <Icon size={size} className={className} style={style} aria-hidden="true" />;
}

export const ArrowDown01Icon = ChevronDown;
export const ArrowLeft01Icon = ChevronLeft;
export const Attachment01Icon = Paperclip;
export const Calendar03Icon = Calendar;
export const Cancel01Icon = X;
export const ChartLineData01Icon = TrendingUp;
export const CommandLineIcon = Terminal;
export const File02Icon = FileText;
export const Globe02Icon = Globe;
export const HelpCircleIcon = LifeBuoy;
export const Mail01Icon = Mail;
export const Mic01Icon = Mic;
export const PencilEdit01Icon = Pencil;
export const PlusSignIcon = Plus;
export const RefreshIcon = RefreshCw;
export const Search01Icon = Search;
export const SparklesIcon = Sparkles;
export const Tick02Icon = Check;
