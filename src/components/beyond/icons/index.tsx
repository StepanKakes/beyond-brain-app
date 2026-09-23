// ─────────────────────────────────────────────────────────────────────────
// Solar icon set (premium minimal, linear weight) wrapped as drop-in
// components named exactly like the lucide icons they replace — so migrating a
// file is just swapping the import source: `from 'lucide-react'` →
// `from '@/components/ui/icons'`. The JSX (`<Inbox size={15} />`) stays.
//
// Icons are registered OFFLINE from a 128-icon subset (src/lib/solar-icons.json)
// — no runtime CDN fetch, no flash-in. `strokeWidth` is accepted but ignored
// (Solar's stroke is baked per set); `color` maps to currentColor via style.
// AI = sparkles (Sparkles → solar:stars-minimalistic), never the wand.
//
// Cizí sada je poslední možnost, ne pohodlí: jedna ikona z jiné rodiny se
// v řadě Solar ikon pozná na první pohled podle jiné tloušťky tahu a rohů.
// Zbyl jediný případ, holé plus, které Solar nemá (má jen add-circle).
// ─────────────────────────────────────────────────────────────────────────

import * as React from 'react'
import { Icon, addCollection } from '@iconify/react'
import solarIcons from './solar-icons.json'
import lucideExtra from './lucide-extra-icons.json'
import hugeiconsExtra from './hugeicons-extra-icons.json'

// Register the subsets once, on module load (client). Renders synchronously.
// Solar is the set; extras hold what Solar genuinely lacks (bare plus).
addCollection(solarIcons as Parameters<typeof addCollection>[0])
addCollection(lucideExtra as Parameters<typeof addCollection>[0])
addCollection(hugeiconsExtra as Parameters<typeof addCollection>[0])

// SVG-compatible so existing lucide call-sites (size / fill / color / style /
// onClick / className …) keep type-checking unchanged. `strokeWidth` is
// accepted for compat but dropped (Solar's stroke is baked per set).
export type IconProps = { size?: number | string } & Omit<React.SVGProps<SVGSVGElement>, 'ref'>

export type IconComponent = React.FC<IconProps>

function make(id: string): IconComponent {
  // Bare id → Solar; an id with a prefix (e.g. "lucide:zap-off") is used as-is.
  const iconId = id.includes(':') ? id : `solar:${id}`
  const C: IconComponent = ({ size, width, height, ...rest }) => {
    // strokeWidth is a lucide prop; Solar's stroke is baked, so drop it to keep
    // every icon visually consistent (forwarding it would let call-sites thin
    // some icons and not others).
    delete (rest as { strokeWidth?: unknown }).strokeWidth
    return (
      <Icon
        icon={iconId}
        width={(size ?? width) as number | string | undefined}
        height={(size ?? height) as number | string | undefined}
        {...(rest as Record<string, unknown>)}
      />
    )
  }
  C.displayName = id
  return C
}

export const Solar = {
  Activity: make('pulse-linear'),
  AlertCircle: make('danger-circle-linear'),
  ArrowLeft: make('arrow-left-linear'),
  ArrowRight: make('arrow-right-linear'),
  ArrowUp: make('arrow-up-linear'),
  ArrowUpDown: make('sort-vertical-linear'),
  ArrowUpRight: make('arrow-right-up-linear'),
  AudioLines: make('soundwave-linear'),
  Award: make('medal-ribbon-star-linear'),
  BarChart2: make('chart-linear'),
  BarChart3: make('chart-linear'),
  Bell: make('bell-linear'),
  BookOpen: make('book-2-linear'),
  Bookmark: make('bookmark-linear'),
  Bot: make('smart-home-linear'),
  Brain: make('user-speak-rounded-linear'),
  Briefcase: make('case-linear'),
  Calendar: make('calendar-linear'),
  CalendarCheck: make('calendar-mark-linear'),
  CalendarClock: make('calendar-date-linear'),
  Camera: make('camera-linear'),
  // Holá fajfka. Fajfka v kolečku byla všude (nabídky, tlačítka, pilulky)
  // a Tim ji nechce; kolečko zůstává jen jako stavová značka (CheckCircle).
  Check: make('check-linear'),
  CheckCircle: make('check-circle-linear'),
  CheckCircle2: make('check-circle-linear'),
  ChevronDown: make('alt-arrow-down-linear'),
  ChevronLeft: make('alt-arrow-left-linear'),
  ChevronRight: make('alt-arrow-right-linear'),
  ChevronUp: make('alt-arrow-up-linear'),
  ChevronsDownUp: make('double-alt-arrow-down-linear'),
  ChevronsUpDown: make('sort-vertical-linear'),
  Circle: make('record-circle-linear'),
  Clock: make('clock-circle-linear'),
  Cloud: make('cloud-linear'),
  Coffee: make('cup-hot-linear'),
  Copy: make('copy-linear'),
  CornerDownLeft: make('arrow-left-down-linear'),
  CornerUpLeft: make('arrow-left-up-linear'),
  Cpu: make('brain-linear'),
  CreditCard: make('card-linear'),
  Crown: make('crown-linear'),
  Diamond: make('crown-linear'),
  Dna: make('dna-linear'),
  DollarSign: make('dollar-linear'),
  Download: make('download-minimalistic-linear'),
  Droplets: make('waterdrops-linear'),
  Edit2: make('pen-2-linear'),
  ExternalLink: make('square-top-down-linear'),
  Eye: make('eye-linear'),
  Feather: make('pen-linear'),
  FileText: make('document-text-linear'),
  Filter: make('filter-linear'),
  Film: make('clapperboard-play-linear'),
  Flag: make('flag-linear'),
  Flame: make('fire-linear'),
  FlaskConical: make('test-tube-minimalistic-linear'),
  Folder: make('folder-linear'),
  FolderPlus: make('add-folder-linear'),
  FolderOpen: make('folder-open-linear'),
  Gem: make('star-linear'),
  Gift: make('gift-linear'),
  GitBranch: make('branching-paths-up-linear'),
  Globe: make('global-linear'),
  GraduationCap: make('square-academic-cap-linear'),
  GripVertical: make('menu-dots-linear'),
  Cursor: make('cursor-linear'),
  Hand: make('hand-stars-linear'),
  Heart: make('heart-linear'),
  History: make('history-linear'),
  Home: make('home-2-linear'),
  Image: make('gallery-wide-linear'),
  Inbox: make('inbox-linear'),
  Key: make('key-linear'),
  Layers: make('widget-5-linear'),
  LifeBuoy: make('help-linear'),
  ListChecks: make('list-arrow-down-minimalistic-linear'),
  Loader2: make('loader-linear'),
  Lock: make('lock-linear'),
  LogOut: make('logout-2-outline'),
  Magnet: make('magnet-linear'),
  Mail: make('letter-linear'),
  Link2: make('link-minimalistic-2-linear'),
  Hash: make('hashtag-linear'),
  MapPin: make('map-point-linear'),
  Megaphone: make('call-medicine-rounded-linear'),
  MessageCircle: make('chat-round-linear'),
  MessageSquare: make('chat-square-linear'),
  MessageSquareWarning: make('danger-square-linear'),
  MessagesSquare: make('chat-square-2-linear'),
  Mic: make('microphone-large-linear'),
  Monitor: make('monitor-linear'),
  // Prosté minus, ne minus v kolečku: stojí v páru s plusem u zoomu na plátně
  // a jeden z nich měl kolečko, druhý ne, takže ta dvojice nedržela pohromadě.
  Minus: make('minus-linear'),
  Moon: make('moon-linear'),
  MoreHorizontal: make('menu-dots-linear'),
  // Solar nemá svislou variantu. Tučná mezi linkovými ikonami trčela, takže
  // obě jména vedou na stejný linkový tvar.
  MoreVertical: make('menu-dots-linear'),
  Music: make('music-note-2-linear'),
  Smartphone: make('smartphone-linear'),
  Tablet: make('tablet-linear'),
  Package: make('box-linear'),
  Pause: make('pause-linear'),
  Pencil: make('pen-linear'),
  Phone: make('phone-linear'),
  PhoneCall: make('phone-calling-linear'),
  Play: make('play-linear'),
  Plug: make('plug-circle-linear'),
  // Obyčejné plus, ne v kroužku — v kulatých tlačítkách působil kroužek v kroužku duplicitně
  Plus: make('lucide:plus'),
  RefreshCw: make('restart-linear'),
  Rocket: make('rocket-linear'),
  RotateCcw: make('restart-linear'),
  RotateCw: make('refresh-circle-linear'),
  ScrollText: make('document-text-linear'),
  Search: make('magnifer-linear'),
  Send: make('plane-linear'),
  Plain: make('plain-linear'),
  Settings: make('settings-linear'),
  Share2: make('share-linear'),
  Shield: make('shield-linear'),
  ShieldAlert: make('shield-warning-linear'),
  ShieldCheck: make('shield-check-linear'),
  ShoppingBag: make('bag-4-linear'),
  SlidersHorizontal: make('tuning-2-linear'),
  Smile: make('smile-circle-linear'),
  Snowflake: make('snowflake-linear'),
  // Dvě jiskry, kreslené pro Beo. Solar má hvězdu s pěti zaoblenými cípy, což
  // je hvězda, ne jiskra; pro označení „tohle dělá AI" se vžily dva špičaté
  // čtyřcípé tvary nad sebou. Kresba drží konvence sady: 24 mřížka, tah 1,5,
  // zaoblené spoje, obsah mezi 2 a 22.
  Sparkles: make('beo-jiskry'),
  Split: make('git-fork-linear'),
  Square: make('stop-linear'),
  Star: make('star-linear'),
  /** Plná hvězda pro označeného oblíbeného. Prázdná je nabídka, plná je stav. */
  StarPlna: make('star-bold'),
  StarFilled: make('star-bold'),
  Stethoscope: make('stethoscope-linear'),
  Sun: make('sun-linear'),
  Tag: make('tag-horizontal-linear'),
  Target: make('smile-circle-linear'),
  Terminal: make('code-square-linear'),
  Code: make('code-linear'),
  Car: make('lucide:car-front'),
  CloudRain: make('lucide:cloud-rain'),
  Building: make('lucide:building-2'),
  VolumeX: make('lucide:volume-x'),
  ThumbsDown: make('dislike-linear'),
  ThumbsUp: make('like-linear'),
  Trash2: make('trash-bin-trash-linear'),
  TrendingDown: make('diagram-down-linear'),
  TrendingUp: make('diagram-up-linear'),
  TriangleAlert: make('danger-triangle-linear'),
  Trophy: make('confetti-minimalistic-linear'),
  Type: make('text-field-linear'),
  Upload: make('upload-minimalistic-linear'),
  User: make('user-linear'),
  VerifiedCheck: make('verified-check-bold'),
  UserRound: make('user-circle-linear'),
  Users: make('users-group-rounded-linear'),
  Wand2: make('stars-minimalistic-linear'),
  X: make('close-linear'),
  XCircle: make('close-circle-linear'),
  Zap: make('bolt-linear'),
  ZapOff: make('stop-linear'),
  /** Vrátit zpět: šipka, která se otáčí, ne křížek (křížek říká „zahodit"). */
  Undo: make('undo-left-round-linear'),

  // Co potřebuje Beyond Brain navíc proti Beovi.
  ArrowDown: make('arrow-down-linear'),
  CircleDot: make('record-circle-linear'),
  Paperclip: make('paperclip-linear'),
  UserPlus: make('user-plus-linear'),
  Columns3: make('widget-4-linear'),
  Images: make('gallery-linear'),
  Clapperboard: make('clapperboard-open-linear'),
  FolderTree: make('folder-with-files-linear'),
  Gauge: make('speedometer-middle-linear'),
  PanelLeft: make('sidebar-minimalistic-linear'),
  PanelRight: make('sidebar-minimalistic-linear'),
  PanelLeftClose: make('sidebar-minimalistic-linear'),
  ListTodo: make('checklist-minimalistic-linear'),
  Puzzle: make('plug-circle-linear'),
  Video: make('videocamera-record-linear'),
  /** Lucide names this app already uses for the same thing. */
  AlertTriangle: make('danger-triangle-linear'),
  CalendarDays: make('calendar-linear'),
  Code2: make('code-linear'),
  File: make('document-text-linear'),
  ShieldOff: make('shield-cross-linear'),
  FilePen: make('pen-new-square-linear'),
  Wrench: make('settings-minimalistic-linear'),
  FileIcon: make('document-text-linear'),
}

export const {
  Activity, AlertCircle, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, AudioLines,
  Award, BarChart2, BarChart3, Bell, BookOpen, Bookmark, Bot, Brain, Briefcase, Calendar,
  CalendarCheck, CalendarClock, Camera, Check, CheckCircle, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Circle, Clock, Cloud, Coffee, Copy,
  CornerDownLeft, CornerUpLeft, Cpu, CreditCard, Crown, Cursor, Diamond, Dna, DollarSign, Download, Droplets,
  Edit2, ExternalLink, Eye, Feather, FileText, Filter, Film, Flag, Flame, FlaskConical, Folder, FolderOpen, FolderPlus,
  Gem, Gift, GitBranch, Globe, GraduationCap, GripVertical, Hand, Heart, History, Home, Image, Inbox,
  Hash, Key, Layers, LifeBuoy, Link2, ListChecks, Loader2, Lock, LogOut, Magnet, Mail, MapPin, Megaphone,
  MessageCircle, MessageSquare, MessageSquareWarning, MessagesSquare, Mic, Minus, Monitor, Moon, MoreHorizontal,
  MoreVertical, Music, Package, Pause, Pencil, Phone, PhoneCall, Play, Plug, Plus, RefreshCw, Rocket,
  RotateCcw, RotateCw, ScrollText, Search, Send, Settings, Share2, Shield, ShieldAlert, ShieldCheck,
  ShoppingBag, SlidersHorizontal, Smartphone, Smile, Snowflake, Sparkles, Split, Square, Star, StarPlna, Stethoscope, Sun,
  Tablet, Tag, Target, Terminal, ThumbsDown, ThumbsUp, Trash2, TrendingDown, TrendingUp, TriangleAlert, Trophy,
  Type, Upload, User, UserRound, Users, VerifiedCheck, Wand2, X, XCircle, Zap, ZapOff, StarFilled, Plain, Code, Car, CloudRain, Building, VolumeX, Undo,
  ArrowDown, CircleDot, Paperclip, UserPlus, Columns3, Images, Clapperboard, FolderTree, Gauge,
  PanelLeft, PanelRight, PanelLeftClose, ListTodo, Puzzle, Video, AlertTriangle, CalendarDays, Code2, File, FileIcon,
  ShieldOff, FilePen, Wrench,
} = Solar
