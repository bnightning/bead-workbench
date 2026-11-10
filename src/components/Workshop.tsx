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

  useEffect(() => {
    if (!work) return;
    const snapshot = work;
    let cancelled = false;
    setUpdating(true);
    void buildGridAsync(snapshot.raster, palette.colors, {
      longestSide: snapshot.longestSide,
      minSide: MIN_SIDE,
      maxSide: MAX_SIDE,
      maxColors: Math.min(snapshot.maxColors, palette.colors.length),
      alphaThreshold: snapshot.alphaThreshold,
      minOpaqueRatio: 0.5,
    })
      .then((grid) => {
        if (cancelled) return;
        setWork((current) => {
          if (
            !current ||
            current.raster !== snapshot.raster ||
            current.longestSide !== snapshot.longestSide ||
            current.maxColors !== snapshot.maxColors ||
            current.alphaThreshold !== snapshot.alphaThreshold
          ) {
            return current;
          }
          return { ...current, grid };
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "网格计算失败");
      })
      .finally(() => {
        if (!cancelled) setUpdating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [palette, work?.alphaThreshold, work?.longestSide, work?.maxColors, work?.raster]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !work?.grid) return;
    drawPreview(canvas, work.grid, { cellSize, roundBeads, showCodes });
  }, [cellSize, roundBeads, showCodes, work?.grid]);

  const usedBeads = work?.grid?.totalBeads ?? 0;
  const laborView = useMemo(
    () =>
      resolveChargedLabor({
        mode: pricing.laborMode,
        usedBeads,
        manualHours: pricing.hours,
        beadsPerHour: pricing.beadsPerHour,
        prepMinutes: pricing.prepMinutes,
        finishMinutes: pricing.finishMinutes,
      }),
    [pricing, usedBeads],
  );
  const quoteState = useMemo(() => {
    if (!work?.grid) return null;
    return tryBuildQuote({ counts: work.grid.counts, fields: pricing, overrides, finalRaw });
  }, [finalRaw, overrides, pricing, work?.grid]);

  const quote = quoteState?.ok ? quoteState.quote : null;
  const colorMax = Math.max(palette.colors.length, 1);
  const colorValue = Math.min(colorDraft, colorMax);

  function touchPricing(key: keyof PricingFields, value: string) {
    prefsAllowed.current = false;
    setPricing((current) => ({ ...current, [key]: value }));
  }

  function chooseLaborMode(mode: LaborMode) {
    prefsAllowed.current = false;
    setPricing((current) => {
      if (mode === "manual" && current.laborMode !== "manual" && laborView.ok && laborView.labor.estimate) {
        return {
          ...current,
          laborMode: "manual",
          hours: formatScaled(laborView.labor.estimate.laborHourHundredths),
        };
      }
      return { ...current, laborMode: mode };
    });
  }

  function applyPalette(next: Palette, touchWork = true) {
    prefsAllowed.current = false;
    setPalette(next);
    setColorDraft((current) => Math.min(Math.max(current, 1), next.colors.length));
    if (touchWork) {
      setWork((current) =>
        current ? { ...current, maxColors: Math.min(current.maxColors, next.colors.length) } : current,
      );
    }
  }

  async function loadFile(file: File) {
    setError(null);
    setStatus(null);
    setPendingText("正在读取图片…");
    try {
      const loaded = await fileToRaster(file);
      const base = file.name.replace(/\.[^.]+$/, "");
      setOverrides({});
      setFinalRaw(null);
      setHover(null);
      setWork({
        name: safeFileBase(base),
        origin: "upload",
        sampleId: null,
        raster: loaded.raster,
        scaledDown: loaded.scaledDown,
        longestSide: sideDraft,
        maxColors: Math.min(colorValue, palette.colors.length),
        alphaThreshold: alphaDraft,
        grid: null,
        savedId: null,
        createdAt: null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取这张图片");
    } finally {
      setPendingText(null);
    }
  }

  function loadSample(sample: PaintedSample) {
    setError(null);
    setStatus(null);
    const unique = Math.max(countSampleColors(sample), 1);
    const longest = Math.max(sample.width, sample.height);
    const maxColors = Math.min(palette.colors.length, unique);
    setSideDraft(longest);
    setColorDraft(maxColors);
    setAlphaDraft(128);
    setOverrides({});
    setFinalRaw(null);
    setHover(null);
    setWork({
      name: sample.name,
      origin: "sample",
      sampleId: sample.id,
      raster: paintToRaster(sample),
      scaledDown: false,
      longestSide: longest,
      maxColors,
      alphaThreshold: 128,
      grid: null,
      savedId: null,
      createdAt: null,
    });
  }

  function onCanvasMove(event: MouseEvent<HTMLCanvasElement>) {
    if (!work?.grid) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = cellAtPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      work.grid.width,
      work.grid.height,
      cellSize,
    );
    if (!point) {
      setHover(null);
      return;
    }
    const index = work.grid.indices[point.y * work.grid.width + point.x] ?? -1;
    const color = work.grid.counts.find((item) => item.index === index);
    setHover({
      x: event.clientX - rect.left + 12,
      y: event.clientY - rect.top + 14,
      label: color
        ? `第 ${point.x + 1} 列，第 ${point.y + 1} 行 · ${color.code} ${color.name}`
        : `第 ${point.x + 1} 列，第 ${point.y + 1} 行 · 空位，不计豆`,
    });
  }

  async function saveProject() {
    if (!work?.grid) {
      setError("先生成图纸，再保存。");
      return;
    }
    setSaveBusy(true);
    setError(null);
    try {
      const imageBlob = await rasterToPngBlob(work.raster);
      const now = Date.now();
      const record: StoredProject = {
        id: work.savedId ?? crypto.randomUUID(),
        name: safeFileBase(work.name),
        createdAt: work.createdAt ?? now,
        updatedAt: now,
        origin: work.origin,
        sampleId: work.sampleId,
        imageBlob,
        scaledDown: work.scaledDown,
        longestSide: work.longestSide,
        maxColors: work.maxColors,
        alphaThreshold: work.alphaThreshold,
        paletteColors: palette.colors.map(({ code, name, hex }) => ({ code, name, hex })),
        paletteKind: palette.kind,
        pricing,
        unitPriceOverrides: overrides,
        finalPriceYuan: finalRaw,
        totalBeads: work.grid.totalBeads,
      };
      await saveStoredProject(record);
      setWork((current) =>
        current ? { ...current, savedId: record.id, name: record.name, createdAt: record.createdAt } : current,
      );
      setProjects(await listProjects());
      setStatus("已保存在此浏览器的 IndexedDB。换浏览器、无痕窗口或清除站点数据后会消失，不会上传。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaveBusy(false);
    }
  }

  async function openProject(id: string) {
    setError(null);
    try {
      const record = await getProject(id);
      if (!record) {
        setError("找不到这份方案，可能已经被删掉。");
        setProjects(await listProjects());
        return;
      }
      const raster = await blobToRaster(record.imageBlob);
      const validated = validatePaletteDraft(record.paletteColors);
      const nextPalette =
        record.paletteKind === "custom" && validated.ok ? paletteFromColors(validated.colors, "custom") : SAMPLE_PALETTE;
      applyPalette(nextPalette, false);
      setPricing(normalizePricing(record.pricing));
      setOverrides(record.unitPriceOverrides);
      setFinalRaw(record.finalPriceYuan);
      setSideDraft(record.longestSide);
      setColorDraft(record.maxColors);
      setAlphaDraft(record.alphaThreshold);
      setHover(null);
      setWork({
        name: record.name,
        origin: record.origin,
        sampleId: record.sampleId,
        raster,
        scaledDown: record.scaledDown,
        longestSide: record.longestSide,
        maxColors: record.maxColors,
        alphaThreshold: record.alphaThreshold,
        grid: null,
        savedId: record.id,
        createdAt: record.createdAt,
      });
      setProjectsOpen(false);
      setStatus("已打开本地方案。色板和成本参数回到保存时的样子，这不是客户单据。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "打开方案失败");
    }
  }

  async function removeProject(id: string) {
    try {
      await deleteStoredProject(id);
      if (work?.savedId === id) setWork((current) => (current ? { ...current, savedId: null } : current));
      setProjects(await listProjects());
      setPendingDelete(null);
      setStatus("已从这台浏览器删除。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  }

  async function exportPng() {
    if (!work?.grid) return;
    try {
      const canvas = renderPatternCanvas(work.grid, {
        title: work.name,
        paletteNotice: palette.notice,
        quote,
        quoteMessage: quoteState && !quoteState.ok ? quoteState.message : null,
        laborLine: laborSummaryLine(),
      });
      downloadBlob(await canvasToPngBlob(canvas), `拼豆图纸-${safeFileBase(work.name)}.png`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出图纸失败");
    }
  }

  function exportCsv() {
    if (!work?.grid) return;
    const rows = work.grid.counts.map((count) => {
      const line = quote?.lines.find((item) => item.code === count.code);
      return {
        code: count.code,
        name: count.name,
        hex: count.hex,
        used: count.count,
        purchase: line?.purchaseBeads ?? count.count,
        unitYuan: line ? formatCents(line.unitPriceCents) : "",
        amountYuan: line ? formatCents(line.amountCents) : "",
      };
    });
    const csv = buildBeadCsv({
      rows,
      usedTotal: work.grid.totalBeads,
      purchaseTotal: quote?.purchaseBeads ?? work.grid.totalBeads,
      beadCostYuan: quote ? formatCents(quote.beadCostCents) : "",
      note: `${palette.notice} 本清单不是客户订单，金额只按当前试算参数写入。`,
      labor: laborCsvFields(),
    });
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `用豆清单-${safeFileBase(work.name)}.csv`);
  }

  async function commitPalette() {
    const validated = validatePaletteDraft(paletteRows);
    if (!validated.ok) {
      setPaletteError(validated.message);
      return;
    }
    const next = paletteFromColors(validated.colors, "custom");
    applyPalette(next);
    try {
      await savePalettePreference(next);
      setStatus("自编色板已保存在此浏览器。");
      setPaletteOpen(false);
      setPaletteError(null);
    } catch (reason) {
      setPaletteError(reason instanceof Error ? reason.message : "色板没能写入本地数据库");
    }
  }

  async function restoreSamplePalette() {
    applyPalette(SAMPLE_PALETTE);
    setPaletteRows(SAMPLE_PALETTE.colors.map(({ code, name, hex }) => ({ code, name, hex })));
    try {
      await savePalettePreference(SAMPLE_PALETTE);
      setPaletteError(null);
      setStatus("已恢复纸间示例色板。");
    } catch (reason) {
      setPaletteError(reason instanceof Error ? reason.message : "没能写回示例色板");
    }
  }

  async function rememberPricing() {
    prefsAllowed.current = false;
    try {
      await savePricingPreference(pricing);
      setStatus("这组成本参数已记在此浏览器，下次打开会带上。它仍然只是你的假设，不是市场报价。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没能记住成本参数");
    }
  }

  function laborCsvFields() {
    if (!laborView.ok) return null;
    const estimate = laborView.labor.estimate;
    return {
      sourceLabel: laborView.labor.source === "auto" ? "自动估算" : "手动填写",
      chargedHours: formatScaled(laborView.labor.laborHourHundredths),
      speed: estimate ? formatScaled(estimate.beadsPerHourHundredths) : pricing.beadsPerHour,
      prepMinutes: estimate ? formatScaled(estimate.prepMinuteHundredths) : pricing.prepMinutes,
      finishMinutes: estimate ? formatScaled(estimate.finishMinuteHundredths) : pricing.finishMinutes,
      beadMinutes: estimate ? formatScaled(estimate.beadMinuteHundredths) : "",
      totalMinutes: estimate ? formatScaled(estimate.totalMinuteHundredths) : "",
      laborYuan: quote ? formatCents(quote.laborCostCents) : "",
      note: `${LABOR_ESTIMATE_NOTE} 人工成本 = 计入成本的工时 × 时薪，只算一次。`,
    };
  }

  function laborSummaryLine(): string | null {
    if (!laborView.ok) return laborView.message;
    const source = laborView.labor.source === "auto" ? "自动估算" : "手动填写";
    const hours = formatScaled(laborView.labor.laborHourHundredths);
    const basis = laborView.labor.estimate ? laborBasisText(laborView.labor.estimate) : "估算参数未通过校验。";
    return `人工按${source}的 ${hours} 小时计算，等于该工时 × 时薪，不另加一遍。${basis} ${LABOR_ESTIMATE_NOTE}`;
  }

  const legendSum = work?.grid?.counts.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const emptyCells = work?.grid ? work.grid.width * work.grid.height - work.grid.totalBeads : 0;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="grid size-11 -rotate-6 place-items-center rounded-md border-2 border-primary font-serif text-xl text-primary"
            >
              豆
            </div>
            <div>
              <h1 className="font-serif text-2xl leading-none tracking-tight">拼豆图纸工作台</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                给一个人用的出图和估价台。顾客把图发来后在这里上传，像素化、用豆和价格都在这台浏览器里算完。
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 md:ml-auto md:w-auto">
            <Button type="button" variant="outline" onClick={() => setHelpOpen(true)}>
              <CircleHelp className="size-4" />
              计价说明
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPaletteRows(palette.colors.map(({ code, name, hex }) => ({ code, name, hex })));
                setPaletteError(null);
                setPaletteOpen(true);
              }}
            >
              <PaletteIcon className="size-4" />
              色板
            </Button>
            <Button type="button" variant="outline" data-testid="open-projects" onClick={() => setProjectsOpen(true)}>
              <FolderOpen className="size-4" />
              已存方案（{projects.length}）
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 md:px-6 xl:grid-cols-[300px_minmax(0,1fr)_400px] xl:items-start">
        <div className="grid content-start gap-4">
          <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-lg">图片</h2>
              <span className="text-xs text-muted-foreground">不上传服务器</span>
            </div>
            <div
              className={cn(
                "rounded-lg border border-dashed px-3 py-4 transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border",
              )}
              onDragOver={(event: ReactDragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event: ReactDragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) void loadFile(file);
              }}
            >
              <input
                id="image-file"
                data-testid="upload-input"
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void loadFile(file);
                }}
              />
              <label
                htmlFor="image-file"
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                <ImagePlus className="size-4" />
                选择图片
              </label>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                支持 PNG、JPEG、WebP，单张不超过 8MB。也可以把文件拖到这里。透明背景不计豆，长边会保持比例。
              </p>
            </div>
            {pendingText ? (
              <p className="text-sm" aria-live="polite">
                {pendingText}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
                {error}
              </p>
            ) : null}
            {storageNote ? <p className="text-xs leading-5 text-muted-foreground">{storageNote}</p> : null}
          </section>

          <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="font-serif text-lg">网格</h2>
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <Label htmlFor="side-slider">最长边格数</Label>
                <span className="tabular">{sideDraft}</span>
              </div>
              <Slider
                id="side-slider"
                aria-label="最长边格数"
                min={MIN_SIDE}
                max={MAX_SIDE}
                step={1}
                value={[sideDraft]}
                onValueChange={(value) => setSideDraft(value[0] ?? MIN_SIDE)}
                onValueCommit={(value) => {
                  const next = value[0] ?? MIN_SIDE;
                  setSideDraft(next);
                  setWork((current) => (current ? { ...current, longestSide: next } : current));
                }}
              />
              <p className="text-xs leading-5 text-muted-foreground">另一边按原图比例取整，范围 {MIN_SIDE} 到 {MAX_SIDE}。</p>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <Label>最大颜色数</Label>
                <span className="tabular">{colorValue}</span>
              </div>
              {palette.colors.length <= 1 ? (
                <p className="text-xs text-muted-foreground">当前色板只有 1 个颜色。</p>
              ) : (
                <Slider
                  aria-label="最大颜色数"
                  min={1}
                  max={palette.colors.length}
                  step={1}
                  value={[colorValue]}
                  onValueChange={(value) => setColorDraft(value[0] ?? 1)}
                  onValueCommit={(value) => {
                    const next = Math.min(value[0] ?? 1, palette.colors.length);
                    setColorDraft(next);
                    setWork((current) => (current ? { ...current, maxColors: next } : current));
                  }}
                />
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                先就近配到色板，若颜色仍多，就把用量最少的并入最接近的保留色。
              </p>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <Label>透明判定</Label>
                <span className="tabular">Alpha ≤ {alphaDraft}</span>
              </div>
              <Slider
                aria-label="透明判定"
                min={0}
                max={255}
                step={1}
                value={[alphaDraft]}
                onValueChange={(value) => setAlphaDraft(value[0] ?? 0)}
                onValueCommit={(value) => {
                  const next = value[0] ?? 0;
                  setAlphaDraft(next);
                  setWork((current) => (current ? { ...current, alphaThreshold: next } : current));
                }}
              />
              <p className="text-xs leading-5 text-muted-foreground">低于或等于这个透明度的像素是空位。格子里不透明像素不足一半，也不计豆。</p>
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-lg">色板</h2>
              <Badge variant={palette.kind === "sample" ? "secondary" : "default"}>
                {palette.kind === "sample" ? "示例色板" : "自编色板"}
              </Badge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{palette.notice}</p>
            <div className="flex flex-wrap gap-1.5" aria-hidden>
              {palette.colors.slice(0, 16).map((color) => (
                <span key={color.code} title={`${color.code} ${color.name}`} className="size-4 rounded-full border" style={{ background: color.hex }} />
              ))}
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="font-serif text-lg">原创试用素材</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              这些图是程序逐格画的，用来试出图和估价。不是顾客交来的图，也不是真实订单。
            </p>
            <div className="grid grid-cols-2 gap-3">
              {SAMPLES.map((sample) => (
                <article key={sample.id} className="grid gap-2">
                  <SampleThumb sample={sample} />
                  <div>
                    <h3 className="text-sm font-medium">{sample.name}</h3>
                    <p className="text-xs leading-5 text-muted-foreground">{sample.caption}</p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" data-testid={`sample-${sample.id}`} onClick={() => loadSample(sample)}>
                    载入并生成
                  </Button>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid min-w-[12rem] flex-1 gap-1.5">
              <Label htmlFor="project-name">方案名称</Label>
              <Input
                id="project-name"
                data-testid="project-name"
                value={work?.name ?? ""}
                placeholder="例如：周末市集小挂件"
                disabled={!work}
                onChange={(event) => setWork((current) => (current ? { ...current, name: event.target.value } : current))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" data-testid="save-project" disabled={!work?.grid || saveBusy} onClick={() => void saveProject()}>
                <Save className="size-4" />
                {work?.savedId ? "更新此浏览器中的方案" : "保存到此浏览器"}
              </Button>
              <Button type="button" variant="outline" data-testid="export-png" disabled={!work?.grid} onClick={() => void exportPng()}>
                导出 PNG
              </Button>
              <Button type="button" variant="outline" data-testid="export-csv" disabled={!work?.grid} onClick={exportCsv}>
                导出 CSV
              </Button>
            </div>
          </div>
          {work ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{work.origin === "sample" ? "原创示例，不是客户图" : "上传的图片"}</Badge>
              {work.savedId ? <Badge variant="secondary">已存在此浏览器</Badge> : null}
              {work.grid ? (
                <p className="tabular text-muted-foreground" data-testid="total-beads">
                  {work.grid.width} × {work.grid.height} 格 · 用豆 {work.grid.totalBeads} · 空位 {emptyCells} · 图例相加 {legendSum}
                </p>
              ) : (
                <p aria-live="polite">正在铺网格…</p>
              )}
              {updating && work.grid ? <span className="text-xs text-muted-foreground">正在按新参数重算</span> : null}
            </div>
          ) : null}
          {work?.scaledDown ? (
            <p className="text-xs leading-5 text-muted-foreground">原图较长，计算前已把长边缩到 1200 像素，避免页面卡住。</p>
          ) : null}
          {legendSum !== (work?.grid?.totalBeads ?? legendSum) ? (
            <p role="alert" className="text-sm text-primary">
              图例颗数和总豆数对不上，请重新生成。
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setCellSize((size) => Math.max(8, size - 2))}>
                缩小
              </Button>
              <div className="w-36">
                <Slider aria-label="缩放" min={8} max={28} step={1} value={[cellSize]} onValueChange={(value) => setCellSize(value[0] ?? 14)} />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setCellSize((size) => Math.min(28, size + 2))}>
                放大
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="round-beads" checked={roundBeads} onCheckedChange={setRoundBeads} />
              <Label htmlFor="round-beads">圆豆</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-codes" checked={showCodes} onCheckedChange={setShowCodes} />
              <Label htmlFor="show-codes">色号</Label>
            </div>
          </div>
          <div className="checker relative max-h-[70vh] overflow-auto rounded-xl border xl:max-h-[calc(100vh-8.5rem)]">
            {work?.grid ? (
              <canvas
                ref={canvasRef}
                data-testid="grid-canvas"
                className="block"
                onMouseMove={onCanvasMove}
                onMouseLeave={() => setHover(null)}
              />
            ) : (
              <div className="grid min-h-80 place-items-center px-6 text-center">
                <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                  {pendingText || updating
                    ? "正在把图片铺成格子。"
                    : "还没有图纸。上传一张顾客发来的图，或载入旁边的原创示例。"}
                </p>
              </div>
            )}
            {hover ? (
              <div className="pointer-events-none absolute z-10 rounded-md bg-[#241c16] px-2 py-1 text-xs text-[#fbf7f0]" style={{ left: hover.x, top: hover.y }}>
                {hover.label}
              </div>
            ) : null}
          </div>
          {status ? (
            <p className="text-sm leading-6" aria-live="polite" data-testid="status">
              {status}
            </p>
          ) : null}
        </section>

        <section className="grid content-start gap-4 xl:sticky xl:top-4">
          <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-lg">用豆清单</h2>
              <span className="text-xs text-muted-foreground">{work?.grid ? `${work.grid.counts.length} 色` : "尚未生成"}</span>
            </div>
            {work?.grid && work.grid.totalBeads === 0 ? (
              <p className="text-sm leading-6">
                这张图在当前网格和透明判定下没有可拼的豆子。可以调低透明阈值，或换一张不透明的图。
              </p>
            ) : null}
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[22rem] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-medium">色</th>
                    <th className="py-1 pr-2 font-medium">代号</th>
                    <th className="py-1 pr-2 font-medium">名称</th>
                    <th className="py-1 pr-2 text-right font-medium">用量</th>
                    <th className="py-1 pr-2 text-right font-medium">采购</th>
                    <th className="py-1 pr-2 font-medium">单价</th>
                    <th className="py-1 text-right font-medium">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {work?.grid?.counts.map((count) => {
                    const line = quote?.lines.find((item) => item.code === count.code);
                    return (
                      <tr key={count.code} className="border-t">
                        <td className="py-1.5 pr-2">
                          <span className="block size-4 rounded-full border" style={{ background: count.hex }} />
                        </td>
                        <td className="py-1.5 pr-2 tabular">{count.code}</td>
                        <td className="py-1.5 pr-2">{count.name}</td>
                        <td className="py-1.5 pr-2 text-right tabular">{count.count}</td>
                        <td className="py-1.5 pr-2 text-right tabular">{line ? line.purchaseBeads : "—"}</td>
                        <td className="py-1.5 pr-2">
                          <Input
                            aria-label={`${count.code} 单价`}
                            className="h-8 w-20 px-2"
                            inputMode="decimal"
                            placeholder={pricing.unitPrice}
                            value={overrides[count.code] ?? ""}
                            onChange={(event) =>
                              setOverrides((current) => ({ ...current, [count.code]: event.target.value }))
                            }
                          />
                        </td>
                        <td className="py-1.5 text-right tabular">{line ? formatCents(line.amountCents) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">单价留空就用统一单价。采购颗数按每个颜色把损耗向上取整。</p>
          </div>

          <div className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm">
            <div>
              <h2 className="font-serif text-lg">试算估价</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{PRICING_ASSUMPTION}</p>
            </div>
            <div className="grid gap-3 rounded-lg border bg-secondary/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">预计工时</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={pricing.laborMode === "auto" ? "default" : "outline"}
                    aria-pressed={pricing.laborMode === "auto"}
                    data-testid="labor-mode-auto"
                    onClick={() => chooseLaborMode("auto")}
                  >
                    按豆数估算
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={pricing.laborMode === "manual" ? "default" : "outline"}
                    aria-pressed={pricing.laborMode === "manual"}
                    data-testid="labor-mode-manual"
                    onClick={() => chooseLaborMode("manual")}
                  >
                    手动填写
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{LABOR_ESTIMATE_NOTE}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  id="beads-per-hour"
                  testId="beads-per-hour"
                  label="拼豆速度（颗/小时）"
                  value={pricing.beadsPerHour}
                  onChange={(value) => touchPricing("beadsPerHour", value)}
                />
                <Field
                  id="prep-minutes"
                  testId="prep-minutes"
                  label="准备（分钟）"
                  value={pricing.prepMinutes}
                  onChange={(value) => touchPricing("prepMinutes", value)}
                />
                <Field
                  id="finish-minutes"
                  testId="finish-minutes"
                  label="熨烫整理（分钟）"
                  value={pricing.finishMinutes}
                  onChange={(value) => touchPricing("finishMinutes", value)}
                />
              </div>
              {laborView.ok && laborView.labor.estimate ? (
                <div className="grid gap-1 text-sm leading-6" data-testid="labor-summary">
                  <p>
                    预计总工时{" "}
                    <span className="tabular font-medium">{formatDuration(laborView.labor.estimate.totalMinuteHundredths)}</span>
                    （<span className="tabular">{formatScaled(laborView.labor.estimate.laborHourHundredths)}</span> 小时）
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">{laborBasisText(laborView.labor.estimate)}</p>
                  {usedBeads === 0 ? <p className="text-xs leading-5">当前没有计入的豆子，拼豆时段按 0 分钟，总工时只含准备和熨烫整理。</p> : null}
                </div>
              ) : (
                <p role="alert" className="text-sm text-primary" data-testid="labor-estimate-error">
                  {laborView.ok ? laborView.labor.estimateMessage : laborView.message}
                </p>
              )}
              <Field
                id="hours"
                testId="labor-hours"
                label={pricing.laborMode === "auto" ? "计入成本的工时（小时）" : "手动工时（小时）"}
                value={
                  pricing.laborMode === "auto"
                    ? laborView.ok
                      ? formatScaled(laborView.labor.laborHourHundredths)
                      : ""
                    : pricing.hours
                }
                readOnly={pricing.laborMode === "auto"}
                onChange={(value) => touchPricing("hours", value)}
                hint={
                  pricing.laborMode === "auto"
                    ? "当前成本按自动估算。人工成本 = 上面的工时 × 时薪，不会再加一遍。"
                    : "当前成本按手动工时。上面的预计只作参考，豆数变化时不会改这个数。"
                }
              />
              <p className="text-xs leading-5" data-testid="labor-source">
                {pricing.laborMode === "auto" ? "成本里的人工来自自动估算。" : "成本里的人工来自手动工时。"}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="unit-price" label="统一单价（元/颗）" value={pricing.unitPrice} onChange={(value) => touchPricing("unitPrice", value)} hint="没单独标价的颜色用它。" />
              <Field id="waste" label="损耗（%）" value={pricing.waste} onChange={(value) => touchPricing("waste", value)} hint="0 到 100。按颜色分别向上取整。" />
              <Field id="hourly" label="时薪（元/小时）" value={pricing.hourly} onChange={(value) => touchPricing("hourly", value)} hint="乘的是上面选定的那一个工时。" />
              <Field id="packaging" label="包装（元）" value={pricing.packaging} onChange={(value) => touchPricing("packaging", value)} />
              <Field id="other" label="其他成本（元）" value={pricing.other} onChange={(value) => touchPricing("other", value)} />
              <Field
                id="margin-input"
                testId="margin-input"
                label="目标毛利率（%）"
                value={pricing.margin}
                onChange={(value) => touchPricing("margin", value)}
                hint="填 40 是毛利率 40%，不是在成本上加 40%。必须小于 100。"
              />
              <Field id="min-profit" label="最低利润（元）" value={pricing.minProfit} onChange={(value) => touchPricing("minProfit", value)} hint="填 0 表示不启用。" />
              <Field id="min-labor" label="最低人工保底（元）" value={pricing.minLabor} onChange={(value) => touchPricing("minLabor", value)} hint="填 0 表示不启用。这是售价下限，不是再加一遍人工。" />
            </div>
            <Button type="button" variant="secondary" onClick={() => void rememberPricing()}>
              记住这组成本参数
            </Button>
            {quoteState && !quoteState.ok ? (
              <p role="alert" data-testid="pricing-error" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
                {quoteState.message}
              </p>
            ) : null}
            <div className="grid gap-1 text-sm leading-6">
              <p>豆材（含损耗） <span className="tabular">{quote ? `${formatCents(quote.beadCostCents)} 元` : "—"}</span></p>
              <p data-testid="labor-cost">
                人工（{pricing.laborMode === "auto" ? "估算工时" : "手动工时"} × 时薪）{" "}
                <span className="tabular">{quote ? `${formatCents(quote.laborCostCents)} 元` : "—"}</span>
              </p>
              <p>包装 <span className="tabular">{quote ? `${formatCents(quote.packagingCents)} 元` : "—"}</span></p>
              <p>其他 <span className="tabular">{quote ? `${formatCents(quote.otherCents)} 元` : "—"}</span></p>
              <p className="font-medium" data-testid="total-cost">
                成本合计 <span className="tabular">{quote ? `${formatCents(quote.totalCostCents)} 元` : "—"}</span>
              </p>
            </div>
            {quote ? (
              <div className="grid gap-1 rounded-lg bg-secondary/70 px-3 py-3 text-sm leading-6">
                <p>
                  按毛利率反推：{formatCents(quote.totalCostCents)} ÷ (1 − {pricing.margin}%) = {formatCents(quote.marginPriceCents)} 元
                </p>
                <p>{quote.minProfitPriceCents === null ? "最低利润：未启用" : `成本 + 最低利润 = ${formatCents(quote.minProfitPriceCents)} 元`}</p>
                <p>{quote.minLaborPriceCents === null ? "最低人工保底：未启用" : `售价至少 ${formatCents(quote.minLaborPriceCents)} 元`}</p>
                <p className="font-medium" data-testid="suggested-price">
                  建议售价 {formatCents(quote.suggestedPriceCents)} 元，依据：{basisLabel(quote.basis)}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">建议售价只供店主参考。取上面启用项里的最大数。</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">成本参数通过校验、并且已经生成图纸后，这里会给出建议售价。</p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="final-price">最终报价（元）</Label>
              <Input
                id="final-price"
                data-testid="final-price"
                inputMode="decimal"
                value={finalRaw ?? (quote ? formatCents(quote.suggestedPriceCents) : "")}
                onChange={(event) => setFinalRaw(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs leading-5 text-muted-foreground">不改这里就跟着建议售价。手改后按这个数计算利润。</p>
                {finalRaw !== null ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setFinalRaw(null)}>
                    改回建议售价
                  </Button>
                ) : null}
              </div>
            </div>
            {quote ? (
              <div className="grid gap-2 text-sm leading-6">
                <p className={quote.profitCents < 0 ? "text-primary" : ""}>利润 {formatCents(quote.profitCents)} 元（最终报价 − 成本合计）</p>
                <p>
                  <span className="font-medium">毛利率</span>
                  {quote.grossMarginBp === null
                    ? "：售价为 0，无法计算。"
                    : ` ${formatBp(quote.grossMarginBp)} = (${formatCents(quote.finalPriceCents)} − ${formatCents(quote.totalCostCents)}) ÷ ${formatCents(quote.finalPriceCents)}`}
                </p>
                <p>
                  <span className="font-medium">加价率</span>
                  {quote.markupBp === null
                    ? "：成本为 0，无法计算。加价率不是毛利率。"
                    : ` ${formatBp(quote.markupBp)} = (${formatCents(quote.finalPriceCents)} − ${formatCents(quote.totalCostCents)}) ÷ ${formatCents(quote.totalCostCents)}。这不是毛利率。`}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1440px] px-4 pb-8 text-xs leading-5 text-muted-foreground md:px-6">
        图片和方案只留在当前浏览器。示例色板的代号是自编的，默认价格是假设。这里没有客户账户、收款和订单。
      </footer>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>成本和建议售价怎么算</DialogTitle>
            <DialogDescription>毛利率和加价率是两个数。建议售价只给你自己看，最终报价可以手改。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm leading-6">
            <p>成本合计 = 豆材 + 人工 + 包装 + 其他。</p>
            <p>豆材 = 各颜色的含损耗采购颗数 × 该色单价。含损耗采购颗数 = 向上取整(用量 × (1 + 损耗率))，每种颜色分开算。</p>
            <p>人工 = 选定的工时 × 时薪，四舍五入到分。自动估算和手动工时只取其中一个，不会相加。</p>
            <p>预计工时 = 有效豆数 ÷ 每小时颗数 + 准备分钟 + 熨烫整理分钟。默认 300 颗/小时、准备 10 分钟、熨烫整理 15 分钟是示例假设，不是实测承诺，也不按颜色或复杂度加系数。</p>
            <p>按目标毛利率反推的售价 = 成本合计 ÷ (1 − 目标毛利率)。毛利率 = (售价 − 成本) ÷ 售价。</p>
            <p>加价率 = (售价 − 成本) ÷ 成本。成本 60 元、毛利率 40% 时，建议售价是 100 元，加价率约 66.67%。如果把 40% 当成加价率，会得到 84 元，本工具不用这种算法做建议售价。</p>
            <p>建议售价 = 下面启用项中的最大数：按毛利率反推、成本 + 最低利润、最低人工保底。填 0 的保底不参与。</p>
            <p>打开页面时的 0.05 元/颗、25 元/小时和 40% 毛利率都是示例假设，不是采购价，也不是市场成交价。</p>
            <p>色板若显示「纸间示例色板」，代号不对应任何品牌的官方色号。方案保存在此浏览器的 IndexedDB，清除站点数据后就没了。</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="w-[min(100%-2rem,760px)]">
          <DialogHeader>
            <DialogTitle>编辑色板</DialogTitle>
            <DialogDescription>
              请用你自己的代号。不要把 MARD、Perler 等品牌色号填进来冒充官方数据，本工具没有这些色库。色板只存在此浏览器。
            </DialogDescription>
          </DialogHeader>
          {paletteError ? (
            <p role="alert" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
              {paletteError}
            </p>
          ) : null}
          <div className="grid max-h-[50vh] gap-2 overflow-auto pr-1">
            {paletteRows.map((row, index) => {
              const warning = brandCodeWarning(row.code);
              const colorValue = /^#[0-9a-fA-F]{6}$/.test(row.hex) ? row.hex : "#888888";
              return (
                <div key={`${index}-${row.code}`} className="grid gap-1 border-b pb-2">
                  <div className="grid grid-cols-[auto_5rem_1fr_7rem_auto] items-center gap-2">
                    <input
                      aria-label={`${row.code || "新颜色"} 取色`}
                      type="color"
                      value={colorValue}
                      onChange={(event) =>
                        setPaletteRows((rows) => rows.map((item, cursor) => (cursor === index ? { ...item, hex: event.target.value.toUpperCase() } : item)))
                      }
                    />
                    <Input
                      aria-label="代号"
                      value={row.code}
                      onChange={(event) =>
                        setPaletteRows((rows) => rows.map((item, cursor) => (cursor === index ? { ...item, code: event.target.value } : item)))
                      }
                    />
                    <Input
                      aria-label="名称"
                      value={row.name}
                      onChange={(event) =>
                        setPaletteRows((rows) => rows.map((item, cursor) => (cursor === index ? { ...item, name: event.target.value } : item)))
                      }
                    />
                    <Input
                      aria-label="HEX"
                      value={row.hex}
                      onChange={(event) =>
                        setPaletteRows((rows) => rows.map((item, cursor) => (cursor === index ? { ...item, hex: event.target.value } : item)))
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`删除 ${row.code || "这个颜色"}`}
                      disabled={paletteRows.length <= 1}
                      onClick={() => setPaletteRows((rows) => rows.filter((_, cursor) => cursor !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {warning ? <p className="text-xs text-primary">{warning}</p> : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setPaletteRows((rows) => [...rows, { code: "", name: "", hex: "#888888" }])}>
              加一个颜色
            </Button>
            <Button type="button" variant="outline" onClick={() => void restoreSamplePalette()}>
              恢复示例色板
            </Button>
            <Button type="button" onClick={() => void commitPalette()}>
              保存色板
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={projectsOpen}
        onOpenChange={(open) => {
          setProjectsOpen(open);
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>此浏览器里的方案</DialogTitle>
            <DialogDescription>
              只存在这台浏览器的 IndexedDB，包括当时的图片副本、网格参数、色板和成本。换设备或清除站点数据后无法找回，也不会变成客户订单。
            </DialogDescription>
          </DialogHeader>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有保存在这台浏览器里的方案。</p>
          ) : (
            <ul className="grid max-h-[50vh] gap-2 overflow-auto">
              {projects.map((project) => (
                <li key={project.id} data-testid="project-item" data-project-id={project.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {project.origin === "sample" ? "由原创示例生成" : "由上传图片生成"} · {project.totalBeads} 颗 · {formatTime(project.updatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" data-testid={`open-${project.id}`} onClick={() => void openProject(project.id)}>
                      打开
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={pendingDelete === project.id ? "default" : "outline"}
                      onClick={() => {
                        if (pendingDelete === project.id) void removeProject(project.id);
                        else setPendingDelete(project.id);
                      }}
                    >
                      {pendingDelete === project.id ? "确认删除" : "删除"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
