import { describe, expect, it } from "vitest";
import { analyse, bendSegment, circleNodes, emptyDesign, flatten, insertNode, nearestOnPath, parseDesign, partOps, pointType, rectNodes, reflected, relaxAuto, ringArea, roundCorner, setPointType, sideOffset, offsetPoint, snapToGuides, toggleSmooth, type CncDesign, type CncGuide, type CncNode, type CncPath, type Pt } from "./design";
import { fitStroke } from "./fit";

const closed = (id: number, nodes: CncNode[]): CncPath => ({ id, closed: true, nodes });
const design = (paths: CncPath[], mirrorX: number | null = null): CncDesign => ({ ...emptyDesign("t", 0.02), paths, mirrorX });

describe("flatten", () => {
  it("stays within a tenth of a millimetre of a circle and marks every point smooth", () => {
    const r = flatten(circleNodes([0, 0], 0.1));
    for (const [x, y] of r.points) expect(Math.abs(Math.hypot(x, y) - 0.1)).toBeLessThan(2.2e-4);
    expect(r.points.length).toBeGreaterThan(16);
    expect(r.smooth.length).toBe(r.points.length);
    expect(Math.abs(ringArea(r.points))).toBeCloseTo(Math.PI * 0.01, 3);
  });

  it("leaves a rectangle's four corners sharp", () => {
    const r = flatten(rectNodes([0, 0], [1, 2]));
    expect(r.points).toHaveLength(4);
    expect(r.smooth).toEqual([]);
  });

  it("a curve meeting a straight edge at an angle keeps that corner", () => {
    const r = flatten([{ p: [0, 0] }, { p: [1, 0] }, { p: [1, 1], in: [1.5, 0.5] }]);
    expect(r.smooth).not.toContain(0);
    expect(r.smooth).not.toContain(1);
  });
});

describe("analyse", () => {
  it("an outline with a hole is one part", () => {
    const a = analyse(design([closed(1, rectNodes([0, 0], [1, 1])), closed(2, circleNodes([0.5, 0.5], 0.1))]));
    expect(a.problems).toEqual([]);
    expect(a.parts).toHaveLength(1);
    expect(a.parts[0].holes).toHaveLength(1);
    expect(a.holes).toBe(1);
  });

  it("a shape inside a hole is a part of its own, and two apart are two", () => {
    const a = analyse(design([closed(1, rectNodes([0, 0], [1, 1])), closed(2, rectNodes([0.2, 0.2], [0.8, 0.8])), closed(3, rectNodes([0.4, 0.4], [0.6, 0.6])), closed(4, rectNodes([2, 0], [3, 1]))]));
    expect(a.parts).toHaveLength(3);
    expect(a.parts.map((p) => p.holes.length).sort()).toEqual([0, 0, 1]);
  });

  it("names the shape that is open, crossing or touching", () => {
    const open = analyse(design([{ id: 5, closed: false, nodes: rectNodes([0, 0], [1, 1]) }]));
    expect(open.problems[0]).toMatchObject({ pathId: 5 });
    expect(open.problems[0].text).toMatch(/open/);
    expect(open.parts).toEqual([]);
    const bow = analyse(design([closed(6, [{ p: [0, 0] }, { p: [1, 1] }, { p: [1, 0] }, { p: [0, 1] }])]));
    expect(bow.problems[0]).toMatchObject({ pathId: 6 });
    expect(bow.problems[0].text).toMatch(/crosses/);
    const over = analyse(design([closed(7, rectNodes([0, 0], [1, 1])), closed(8, rectNodes([0.5, 0.5], [2, 2]))]));
    expect(over.problems[0].text).toMatch(/cross or touch/);
  });

  it("an empty drawing is no part and no complaint", () => {
    expect(analyse(design([]))).toMatchObject({ parts: [], problems: [], bounds: null });
  });
});

describe("mirror", () => {
  const half: CncPath = { id: 1, closed: false, nodes: [{ p: [0, 0] }, { p: [1, 0.5], out: [1, 0.8] }, { p: [0, 1], in: [0.5, 1] }] };

  it("a half line with both ends on the mirror line closes into one symmetric part", () => {
    const a = analyse(design([half], 0));
    expect(a.problems).toEqual([]);
    expect(a.parts).toHaveLength(1);
    expect(a.bounds?.min[0]).toBeCloseTo(-a.bounds!.max[0], 9);
  });

  it("a half line that misses the mirror line is reported", () => {
    const a = analyse(design([half], 0.25));
    expect(a.problems[0].text).toMatch(/mirror line/);
  });

  it("a closed shape off the line gets a twin, and one across the line stays one", () => {
    expect(analyse(design([closed(1, rectNodes([1, 0], [2, 1]))], 0)).parts).toHaveLength(2);
    expect(analyse(design([closed(1, rectNodes([-1, 0], [1, 1]))], 0)).parts).toHaveLength(1);
  });

  it("reflecting swaps each point's handles", () => {
    expect(reflected(half, 0)[1]).toEqual({ p: [-1, 0.5], in: [-1, 0.8] });
  });
});

describe("partOps", () => {
  const a = analyse(design([closed(1, rectNodes([10, 10], [12, 11]))]));

  it("lies flat around the origin, or stands on the ground", () => {
    const flat = partOps(a, 0.02, false)[0] as unknown as { rings: { points: number[][] }[]; normal: number[]; distance: number };
    expect(flat.normal).toEqual([0, 0, 1]);
    expect(flat.distance).toBe(0.02);
    expect(flat.rings[0].points[0]).toEqual([-1, -0.5, 0]);
    const up = partOps(a, 0.02, true)[0] as unknown as { rings: { points: number[][] }[]; normal: number[] };
    expect(up.normal).toEqual([0, 1, 0]);
    expect(up.rings[0].points[0]).toEqual([-1, 0, 0]);
    expect(up.rings[0].points[2]).toEqual([1, 0, 1]);
  });
});

describe("editing", () => {
  it("a point inserted on a curve leaves the curve where it was", () => {
    const path = closed(1, circleNodes([0, 0], 1));
    const hit = nearestOnPath(path, [Math.SQRT1_2, Math.SQRT1_2])!;
    expect(hit.distance).toBeLessThan(0.01);
    const split = insertNode(path, hit.segment, hit.t);
    expect(split.nodes).toHaveLength(5);
    expect(Math.abs(ringArea(flatten(split.nodes).points))).toBeCloseTo(Math.abs(ringArea(flatten(path.nodes).points)), 3);
  });

  it("a corner turns smooth and back", () => {
    const path = closed(1, rectNodes([0, 0], [1, 1]));
    const round = toggleSmooth(path, 1);
    expect(round.nodes[1].in).toBeDefined();
    expect(toggleSmooth(round, 1).nodes[1].in).toBeUndefined();
  });
});

describe("parseDesign: a drawing from a file", () => {
  const good = JSON.stringify(design([closed(1, rectNodes([0, 0], [1, 1]))]));
  it("round-trips", () => expect(parseDesign(good)?.paths[0].nodes).toHaveLength(4));
  it.each([
    ["not JSON", "{"],
    ["another shape of thing", "[]"],
    ["a huge coordinate", good.replace('"p":[1,0]', '"p":[1e30,0]')],
    ["a null point", good.replace('"p":[1,0]', '"p":null')],
    ["an image path that leaves assets", JSON.stringify({ ...JSON.parse(good), reference: { path: "../x.png", x: 0, y: 0, width: 1, aspect: 1, opacity: 1 } })],
    ["an image type that is not a picture", JSON.stringify({ ...JSON.parse(good), reference: { path: "assets/a.svg", x: 0, y: 0, width: 1, aspect: 1, opacity: 1 } })],
  ])("refuses %s", (_, json) => expect(parseDesign(json)).toBeNull());
  it("cuts a long name to size", () => expect(parseDesign(good.replace('"name":"t"', `"name":"${"x".repeat(500)}"`))?.name).toHaveLength(64));
});

describe("reference lines", () => {
  const level: CncGuide = { id: 1, p: [0, 1], dir: [1, 0] };
  const plumb: CncGuide = { id: 2, p: [2, 0], dir: [0, 1] };

  it("a point near one lands on it, and near two lands where they cross", () => {
    expect(snapToGuides([5, 1.01], [level], 0.02)).toEqual([5, 1]);
    expect(snapToGuides([5, 1.5], [level], 0.02)).toBeNull();
    expect(snapToGuides([2.01, 1.01], [level, plumb], 0.02)).toEqual([2, 1]);
  });

  it("parallel lines do not count as crossing", () => {
    expect(snapToGuides([0, 1.01], [level, { id: 3, p: [0, 1.02], dir: [1, 0] }], 0.02)).toEqual([0, 1]);
  });

  it("an offset goes to the side measured", () => {
    const d = sideOffset([0, 0], [1, 0], [3, 2]);
    expect(d).toBe(2);
    expect(offsetPoint([0, 0], [1, 0], d)).toEqual([0, 2]);
    expect(sideOffset([0, 0], [1, 0], [3, -2])).toBe(-2);
  });

  it("do not change what gets cut, and come back with the drawing", () => {
    const d: CncDesign = { ...design([closed(1, rectNodes([0, 0], [1, 1]))]), guides: [level] };
    expect(analyse(d).parts).toHaveLength(1);
    expect(parseDesign(JSON.stringify(d))?.guides).toEqual([level]);
  });

  it("a drawing from before them reads as having none, and a bad one is refused", () => {
    const { guides: _guides, ...old } = design([]);
    expect(parseDesign(JSON.stringify(old))?.guides).toEqual([]);
    expect(parseDesign(JSON.stringify({ ...design([]), guides: [{ id: 1, p: [0, 0], dir: [0, 0] }] }))).toBeNull();
    expect(parseDesign(JSON.stringify({ ...design([]), guides: "x" }))).toBeNull();
  });
});

describe("the Curve tool's points", () => {
  const auto = (pts: [number, number][], closed = false): CncPath => relaxAuto({ id: 1, closed, nodes: pts.map((p) => ({ p, auto: true })) });

  it("the curve runs through every click, with a smooth point at each", () => {
    const p = auto([[0, 0], [1, 1], [2, 0], [3, 1]]);
    expect(p.nodes[1].p).toEqual([1, 1]);
    const n = p.nodes[1];
    const a = [n.p[0] - n.in![0], n.p[1] - n.in![1]];
    const b = [n.out![0] - n.p[0], n.out![1] - n.p[1]];
    expect(a[0] * b[1] - a[1] * b[0]).toBeCloseTo(0, 12);
  });

  it("a closed loop of them has no corner", () => {
    const r = flatten(auto([[0, 0], [1, 0], [1, 1], [0, 1]], true).nodes);
    expect(r.smooth).toHaveLength(r.points.length);
  });

  it("on the mirror line an end leaves square to it, so the halves meet without a kink", () => {
    const p = relaxAuto({ id: 1, closed: false, nodes: [{ p: [0, 0], auto: true }, { p: [1, 1], auto: true }, { p: [0, 2], auto: true }] }, 0);
    expect(p.nodes[0].out![1]).toBe(0);
    expect(p.nodes[2].in![1]).toBe(2);
    const a = analyse({ paths: [p], mirrorX: 0 });
    expect(a.problems).toEqual([]);
    expect(a.parts[0].outer.smooth).toHaveLength(a.parts[0].outer.points.length);
  });
});

describe("dragging a line", () => {
  it("makes a straight line a curve that passes through where it was dragged", () => {
    const path = closed(1, rectNodes([0, 0], [3, 3]));
    const bent = bendSegment(path, 0, 0.5, [0, -1]);
    expect(nearestOnPath(bent, [1.5, -1])!.distance).toBeLessThan(1e-3);
  });

  it("keeps a smooth neighbour's handles in line", () => {
    const path: CncPath = { id: 1, closed: false, nodes: [{ p: [0, 0], in: [-1, 0], out: [1, 0] }, { p: [3, 0] }] };
    const n = bendSegment(path, 0, 0.5, [0, 1]).nodes[0];
    expect((n.in![0] - n.p[0]) * (n.out![1] - n.p[1]) - (n.in![1] - n.p[1]) * (n.out![0] - n.p[0])).toBeCloseTo(0, 12);
  });

  it("a point with separate handles is left alone on its other side", () => {
    const path: CncPath = { id: 1, closed: false, nodes: [{ p: [0, 0], in: [-1, 0], out: [1, 0], corner: true }, { p: [3, 0] }] };
    expect(bendSegment(path, 0, 0.5, [0, 1]).nodes[0].in).toEqual([-1, 0]);
  });
});

describe("point types", () => {
  it("corner, smooth and curve are told apart and switch", () => {
    const path = closed(1, rectNodes([0, 0], [1, 1]));
    expect(pointType(path.nodes[1])).toBe("corner");
    const smooth = setPointType(path, 1, "smooth");
    expect(pointType(smooth.nodes[1])).toBe("smooth");
    const auto = setPointType(smooth, 1, "auto");
    expect(pointType(auto.nodes[1])).toBe("auto");
    expect(pointType(setPointType(auto, 1, "corner").nodes[1])).toBe("corner");
  });

  it("a saved drawing keeps them", () => {
    const d = design([{ id: 1, closed: true, nodes: [{ p: [0, 0], auto: true }, { p: [1, 0], corner: true, out: [1, 1] }, { p: [1, 1] }] }]);
    const back = parseDesign(JSON.stringify(d))!;
    expect(back.paths[0].nodes[0].auto).toBe(true);
    expect(back.paths[0].nodes[1].corner).toBe(true);
  });
});

describe("rounding a corner", () => {
  it("a square corner becomes a quarter circle of that radius", () => {
    const r = roundCorner(closed(1, rectNodes([0, 0], [2, 2])), 1, 0.5) as CncPath;
    expect(r.nodes).toHaveLength(5);
    expect(r.nodes[1].p).toEqual([1.5, 0]);
    expect(r.nodes[2].p[1]).toBeCloseTo(0.5, 12);
    const mid = nearestOnPath(r, [1.5 + 0.5 * Math.SQRT1_2, 0.5 - 0.5 * Math.SQRT1_2])!;
    expect(mid.distance).toBeLessThan(1e-3);
  });

  it("says why when it cannot", () => {
    expect(roundCorner(closed(1, rectNodes([0, 0], [2, 2])), 1, 5)).toMatch(/too large/);
    expect(roundCorner(closed(1, circleNodes([0, 0], 1)), 1, 0.1)).toMatch(/straight lines/);
    expect(roundCorner({ id: 1, closed: false, nodes: rectNodes([0, 0], [2, 2]) }, 0, 0.1)).toMatch(/end of an open line/);
  });
});

describe("the Pencil's fitting", () => {
  it("turns a noisy arc into a few points that stay close to it", () => {
    const samples: Pt[] = [];
    for (let i = 0; i <= 300; i++) {
      const a = (i / 300) * Math.PI;
      const wobble = 0.002 * Math.sin(i * 1.7);
      samples.push([(1 + wobble) * Math.cos(a), (1 + wobble) * Math.sin(a)]);
    }
    const nodes = fitStroke(samples, 0.01, false)!;
    expect(nodes.length).toBeLessThan(12);
    const path: CncPath = { id: 1, closed: false, nodes };
    for (const s of samples) expect(nearestOnPath(path, s)!.distance).toBeLessThan(0.015);
  });

  it("keeps a real corner", () => {
    const samples: Pt[] = [];
    for (let i = 0; i <= 40; i++) samples.push([i / 40, 0]);
    for (let i = 1; i <= 40; i++) samples.push([1, i / 40]);
    const nodes = fitStroke(samples, 0.005, false)!;
    expect(nodes.some((n) => n.corner && Math.hypot(n.p[0] - 1, n.p[1]) < 0.03)).toBe(true);
  });

  it("closes a loop into a shape that can be a part", () => {
    const samples: Pt[] = [];
    for (let i = 0; i < 200; i++) samples.push([Math.cos((i / 200) * 2 * Math.PI), Math.sin((i / 200) * 2 * Math.PI)]);
    const nodes = fitStroke(samples, 0.005, true)!;
    const a = analyse({ paths: [{ id: 1, closed: true, nodes }], mirrorX: null });
    expect(a.problems).toEqual([]);
    expect(Math.abs(ringArea(a.parts[0].outer.points))).toBeCloseTo(Math.PI, 1);
  });

  it("a dab is nothing", () => expect(fitStroke([[0, 0]], 0.01, false)).toBeNull());
});
