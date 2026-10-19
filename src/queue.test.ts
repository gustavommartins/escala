import { describe, expect, it } from "vitest";
import type { ProbeResult, Resolution } from "./api";
import {
  defaultHeight,
  effectiveHeight,
  globalOptions,
  makeItems,
  nextToStart,
  overallPercent,
  startable,
  summary,
  type QueueItem,
} from "./queue";

const res = (height: number, recommended = false): Resolution => ({ height, label: `${height}p`, recommended });

function probe(heights: number[] = [1080, 720], duration = 100, size = 1000, recommended?: number): ProbeResult {
  return {
    name: "v",
    info: {
      width: 1920,
      height: 1080,
      duration_s: duration,
      size_bytes: size,
      audio_codec: null,
      video_codec: null,
      hdr: false,
    },
    resolutions: heights.map((h) => res(h, h === recommended)),
  };
}

let n = 0;
function item(over: Partial<QueueItem> = {}): QueueItem {
  n++;
  return { id: `t${n}`, path: `/x/${n}.mp4`, name: `${n}.mp4`, status: "ready", percent: 0, ...over };
}

describe("makeItems", () => {
  it("cria itens probing para caminhos válidos", () => {
    const { added, rejected } = makeItems([], ["C:\\v\\a.MP4", "/v/b.mkv"]);
    expect(rejected).toBe(0);
    expect(added.map((i) => i.name)).toEqual(["a.MP4", "b.mkv"]);
    expect(added.every((i) => i.status === "probing" && i.percent === 0)).toBe(true);
  });

  it("rejeita extensões inválidas e conta rejected", () => {
    const { added, rejected } = makeItems([], ["a.txt", "b.mp4", "semext", "c.png"]);
    expect(added).toHaveLength(1);
    expect(rejected).toBe(3);
  });

  it("deduplica contra a fila existente e dentro da própria lista, sem contar como rejected", () => {
    const existing = [item({ path: "a.mp4" })];
    const { added, rejected } = makeItems(existing, ["a.mp4", "b.mp4", "b.mp4"]);
    expect(added.map((i) => i.path)).toEqual(["b.mp4"]);
    expect(rejected).toBe(0);
  });

  it("gera ids únicos", () => {
    const { added } = makeItems([], ["1.mp4", "2.mp4", "3.mp4"]);
    const { added: more } = makeItems(added, ["4.mp4"]);
    const ids = [...added, ...more].map((i) => i.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("effectiveHeight", () => {
  it("override vence a global", () => {
    expect(effectiveHeight(item({ probe: probe(), override: 720 }), 1080)).toBe(720);
  });
  it("usa a global sem override", () => {
    expect(effectiveHeight(item({ probe: probe() }), 1080)).toBe(1080);
  });
  it("null se resolução indisponível no probe", () => {
    expect(effectiveHeight(item({ probe: probe([720]) }), 1080)).toBeNull();
    expect(effectiveHeight(item({ probe: probe(), override: 480 }), 1080)).toBeNull();
  });
  it("null sem probe", () => {
    expect(effectiveHeight(item(), 1080)).toBeNull();
    expect(effectiveHeight(item({ override: 720 }), null)).toBeNull();
  });
  it("null se não há global nem override", () => {
    expect(effectiveHeight(item({ probe: probe() }), null)).toBeNull();
  });
});

describe("globalOptions", () => {
  it("une resoluções sem duplicar, em ordem decrescente", () => {
    const opts = globalOptions([
      item({ probe: probe([720, 480]) }),
      item({ probe: probe([1080, 720]) }),
      item(),
    ]);
    expect(opts.map((r) => r.height)).toEqual([1080, 720, 480]);
  });
  it("vazio sem probes", () => {
    expect(globalOptions([item()])).toEqual([]);
  });
});

describe("defaultHeight", () => {
  it("prefere a recomendada", () => {
    expect(defaultHeight([res(1080), res(720, true), res(480)])).toBe(720);
  });
  it("senão a primeira (maior)", () => {
    expect(defaultHeight([res(1080), res(720)])).toBe(1080);
  });
  it("null se vazio", () => {
    expect(defaultHeight([])).toBeNull();
  });
});

describe("startable", () => {
  it.each(["ready", "cancelled", "error"] as const)("%s com altura válida é startable", (status) => {
    expect(startable(item({ status, probe: probe() }), 720)).toBe(true);
  });
  it.each(["probing", "skipped", "queued", "converting", "finalizing", "done"] as const)(
    "%s não é startable",
    (status) => {
      expect(startable(item({ status, probe: probe() }), 720)).toBe(false);
    },
  );
  it("não é startable sem altura efetiva", () => {
    expect(startable(item({ status: "ready", probe: probe([720]) }), 1080)).toBe(false);
  });
});

describe("nextToStart", () => {
  it("respeita o limite", () => {
    const items = [item({ status: "queued" }), item({ status: "queued" }), item({ status: "queued" })];
    expect(nextToStart(items, 2)).toEqual(items.slice(0, 2));
  });
  it("desconta converting e finalizing", () => {
    const q = [item({ status: "queued" }), item({ status: "queued" })];
    const items = [item({ status: "converting" }), item({ status: "finalizing" }), ...q];
    expect(nextToStart(items, 3)).toEqual([q[0]]);
  });
  it("vazio quando o limite já foi atingido ou excedido", () => {
    const items = [item({ status: "converting" }), item({ status: "converting" }), item({ status: "queued" })];
    expect(nextToStart(items, 2)).toEqual([]);
    expect(nextToStart(items, 1)).toEqual([]);
  });
  it("limite 0 não inicia nada", () => {
    expect(nextToStart([item({ status: "queued" })], 0)).toEqual([]);
  });
});

describe("overallPercent", () => {
  it("0 sem itens participantes", () => {
    expect(overallPercent([])).toBe(0);
    expect(overallPercent([item({ status: "ready", percent: 50 }), item({ status: "skipped" })])).toBe(0);
  });
  it("pondera pela duração", () => {
    const items = [
      item({ status: "converting", percent: 50, probe: probe([720], 100) }),
      item({ status: "queued", percent: 0, probe: probe([720], 300) }),
    ];
    expect(overallPercent(items)).toBeCloseTo(12.5);
  });
  it("done conta como 100 independentemente de percent", () => {
    const items = [
      item({ status: "done", percent: 0, probe: probe([720], 100) }),
      item({ status: "converting", percent: 0, probe: probe([720], 100) }),
    ];
    expect(overallPercent(items)).toBe(50);
  });
  it("ignora ready/skipped mesmo com duração", () => {
    const items = [
      item({ status: "done", probe: probe([720], 10) }),
      item({ status: "ready", percent: 0, probe: probe([720], 1000) }),
      item({ status: "skipped", percent: 0, probe: probe([720], 1000) }),
    ];
    expect(overallPercent(items)).toBe(100);
  });
  it("usa peso 1 sem probe ou com duração 0", () => {
    const items = [item({ status: "done" }), item({ status: "converting", percent: 0, probe: probe([720], 0) })];
    expect(overallPercent(items)).toBe(50);
  });
});

describe("summary", () => {
  it("conta e soma economia só de itens done", () => {
    const items = [
      item({ status: "done", probe: probe([720], 1, 1000), outputSize: 300 }),
      item({ status: "done", probe: probe([720], 1, 500), outputSize: 100 }),
      item({ status: "converting", probe: probe([720], 1, 9999), outputSize: 1 }),
      item({ status: "error", probe: probe([720], 1, 9999) }),
    ];
    expect(summary(items)).toEqual({ count: 2, savedBytes: 1100 });
  });
  it("zeros sem itens done", () => {
    expect(summary([item()])).toEqual({ count: 0, savedBytes: 0 });
  });
  it("trata ausência de probe/outputSize como 0", () => {
    expect(summary([item({ status: "done", outputSize: 40 })])).toEqual({ count: 1, savedBytes: -40 });
  });
});
