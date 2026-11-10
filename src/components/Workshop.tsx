import { CircleHelp, FolderOpen, ImagePlus, Palette as PaletteIcon, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent } from "react";
import { cellAtPoint } from "@/lib/boardLayout.ts";
import { buildBeadCsv } from "@/lib/csv.ts";
import { downloadBlob } from "@/lib/download.ts";
import { canvasToPngBlob, drawPreview, renderPatternCanvas } from "@/lib/drawPattern.ts";
import { safeFileBase } from "@/lib/filename.ts";
import { buildGridAsync, type GridResult, type RgbaRaster } from "@/lib/grid.ts";
import { blobToRaster, fileToRaster, rasterToPngBlob } from "@/lib/loadRaster.ts";
import {
  SAMPLE_PALETTE,
  brandCodeWarning,
  paletteFromColors,
  validatePaletteDraft,
  type Palette,
} from "@/lib/palette.ts";
import { basisLabel, formatBp, formatCents } from "@/lib/pricing.ts";
import { LABOR_ESTIMATE_NOTE, formatDuration, formatScaled, laborBasisText } from "@/lib/laborEstimate.ts";
import {
  DEFAULT_PRICING_FIELDS,
  PRICING_ASSUMPTION,
  normalizePricing,
  resolveChargedLabor,
  tryBuildQuote,
  type LaborMode,
  type PricingFields,
} from "@/lib/quoteForm.ts";
import { SAMPLES, countSampleColors, paintToRaster, type PaintedSample } from "@/lib/samples.ts";
import {
  deleteStoredProject,
  getProject,
  listProjects,
  loadPreferences,
  savePalettePreference,
  savePricingPreference,
  saveStoredProject,
  type ProjectSummary,
  type StoredProject,
} from "@/lib/storage.ts";
import { cn } from "@/lib/utils.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Slider } from "@/components/ui/slider.tsx";
import { Switch } from "@/components/ui/switch.tsx";

const MIN_SIDE = 8;
const MAX_SIDE = 120;

interface Work {
  name: string;
  origin: "upload" | "sample";
  sampleId: string | null;
  raster: RgbaRaster;
  scaledDown: boolean;
  longestSide: number;
  maxColors: number;
  alphaThreshold: number;
  grid: GridResult | null;
  savedId: string | null;
  createdAt: number | null;
}

interface PaletteRow {
  code: string;
  name: string;
  hex: string;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  testId,
  readOnly = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  testId?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        data-testid={testId}
        inputMode="decimal"
        autoComplete="off"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SampleThumb({ sample }: { sample: PaintedSample }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scale = 3;
    canvas.width = sample.width * scale;
    canvas.height = sample.height * scale;
    const context = canvas.getContext("2d");
    const raster = paintToRaster(sample);
    const source = document.createElement("canvas");
    source.width = sample.width;
    source.height = sample.height;
    const sourceContext = source.getContext("2d");
    if (!context || !sourceContext) return;
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(raster.data), sample.width, sample.height), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [sample]);
  return <canvas ref={ref} className="checker h-20 w-full rounded-md border object-contain" />;
}

export function Workshop() {
  const prefsAllowed = useRef(true);
  const [palette, setPalette] = useState<Palette>(SAMPLE_PALETTE);
  const [pricing, setPricing] = useState<PricingFields>({ ...DEFAULT_PRICING_FIELDS, laborMode: "auto" });
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [finalRaw, setFinalRaw] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [work, setWork] = useState<Work | null>(null);
  const [sideDraft, setSideDraft] = useState(40);
  const [colorDraft, setColorDraft] = useState(16);
  const [alphaDraft, setAlphaDraft] = useState(128);
  const [cellSize, setCellSize] = useState(14);
  const [roundBeads, setRoundBeads] = useState(true);
  const [showCodes, setShowCodes] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteRows, setPaletteRows] = useState<PaletteRow[]>([]);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const prevent = (event: globalThis.DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [prefs, list] = await Promise.all([loadPreferences(), listProjects()]);
        if (!live) return;
        setProjects(list);
        if (!prefsAllowed.current) return;
        if (prefs.pricing) setPricing(normalizePricing(prefs.pricing));
        if (prefs.palette) {
          setPalette(prefs.palette);
          setColorDraft((current) => Math.min(current, prefs.palette?.colors.length ?? current));
        }
      } catch {
        if (live) setStorageNote("这个浏览器暂时读不了本地数据库。出图和导出还可以用，但刷新后不会留下方案。");
      }
    })();
    return () => {
      live = false;
    };
  }, []);
