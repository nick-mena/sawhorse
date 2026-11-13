//! Inference engine (lane 3): candidate ranking, pixel tolerance in both projections,
//! axis inference and axis locks, parallel / perpendicular, intersections, centres,
//! from-point, drawing planes, the ground grid, and occlusion.

use glam::DVec3;
use sawhorse_inference::InferenceKind as K;
use sawhorse_inference::geom::PixelModel;
use sawhorse_inference::infer::{InferQuery, Inference, LockQ, PlaneQ, infer};
use sawhorse_inference::scene::Scene;
use sawhorse_kernel::model::{Model, Op};

const IN: f64 = 0.0254;

fn model(ops: &[Op]) -> Model {
    let mut m = Model::with_ground_sketch();
    for (i, op) in ops.iter().enumerate() {
        m.apply(op).unwrap_or_else(|e| panic!("op {i}: {e}"));
    }
    m
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Op {
    Op::AddRectangle {
        sketch: 1,
        x,
        y,
        w,
        h,
    }
}

fn extrude(region: u64, d: f64) -> Op {
    Op::Extrude {
        sketch: 1,
        region,
        distance: d,
    }
}

/// Looking straight down at (x, y) from z = 10 with `mpp` metres per pixel (parallel).
fn down(x: f64, y: f64, mpp: f64) -> InferQuery {
    InferQuery {
        origin: [x, y, 10.0],
        dir: [0.0, 0.0, -1.0],
        px: PixelModel {
            ortho: true,
            scale: mpp,
            eye: [x, y, 10.0],
            forward: [0.0, 0.0, -1.0],
        },
        start: None,
        plane: None,
        lock: None,
        refs: vec![],
        anchors: vec![],
        grid: true,
        grid_step: Some([IN, 12.0 * IN]),
        point_px: 10.0,
        line_px: 7.0,
        soft: false,
    }
}

fn run(m: &Model, q: &InferQuery) -> Inference {
    infer(&Scene::build(m), q).expect("an inference")
}

fn close(a: [f64; 3], b: [f64; 3]) -> bool {
    (DVec3::from_array(a) - DVec3::from_array(b)).length() < 1e-12
}

fn unit_box() -> Model {
    model(&[rect(0.0, 0.0, 1.0, 1.0), extrude(1, 1.0)])
}

/// Boxes `(x, y, w, h, height)` on the ground, each extruded from the region its rectangle
/// drew (region ids are slot ids, so read them from the outcome).
fn boxes(spec: &[(f64, f64, f64, f64, f64)]) -> Model {
    let mut m = Model::with_ground_sketch();
    for &(x, y, w, h, d) in spec {
        let out = m.apply(&rect(x, y, w, h)).unwrap();
        let sawhorse_kernel::OpOutcome::SketchEdited { regions } = out else {
            panic!("{out:?}")
        };
        m.apply(&extrude(regions[0], d)).unwrap();
    }
    m
}

#[test]
fn endpoints_beat_midpoints_beat_edges_beat_faces() {
    let m = unit_box();
    let mm = 0.001; // 1 mm per pixel
    let r = run(&m, &down(1.0 - 0.004, 1.0 + 0.003, mm));
    assert_eq!(r.kind, K::Endpoint);
    assert!(close(r.point, [1.0, 1.0, 1.0]), "{:?}", r.point);
    let r = run(&m, &down(0.502, 1.002, mm));
    assert_eq!(r.kind, K::Midpoint);
    assert!(close(r.point, [0.5, 1.0, 1.0]));
    let r = run(&m, &down(0.25, 1.004, mm));
    assert_eq!(r.kind, K::OnEdge);
    assert!(
        close(r.point, [0.25, 1.0, 1.0]),
        "exactly on the edge: {:?}",
        r.point
    );
    let r = run(&m, &down(0.3, 0.4, mm));
    assert_eq!(r.kind, K::OnFace);
    assert!(close(r.point, [0.3, 0.4, 1.0]));
    assert!(matches!(
        r.entity,
        Some(sawhorse_inference::pick::Entity::Face { object: 1, face: 2 })
    ));
    assert_eq!(r.tip, "On Face");
}

#[test]
fn an_endpoint_wins_over_a_slightly_nearer_midpoint() {
    // A 6 mm edge seen at 1 mm per pixel: its midpoint is 3 px from each end.
    let m = model(&[Op::InsertSegment {
        sketch: 1,
        a: [0.0, 0.0],
        b: [0.006, 0.0],
    }]);
    // 1 px from the midpoint, 2 px from the end: the endpoint still wins (rank first).
    let r = run(&m, &down(0.004, 0.0, 0.001));
    assert_eq!(r.kind, K::Endpoint);
    // Right on the midpoint (3 px from both ends): the midpoint wins.
    let r = run(&m, &down(0.003, 0.0, 0.001));
    assert_eq!(r.kind, K::Midpoint);
}

#[test]
fn tolerance_is_in_pixels_at_any_zoom() {
    let m = unit_box();
    // 9 mm off the corner: 9 px at 1 mm/px (snaps), 18 px at 0.5 mm/px (does not).
    let q = down(1.0 + 0.009, 1.0, 0.001);
    assert_eq!(run(&m, &q).kind, K::Endpoint);
    let q = down(1.0 + 0.009, 1.0, 0.0005);
    assert_ne!(run(&m, &q).kind, K::Endpoint);
    // Zoomed far out (1 cm/px) 9 cm is 9 px: snaps again.
    assert_eq!(run(&m, &down(1.09, 1.0, 0.01)).kind, K::Endpoint);
}

#[test]
fn perspective_tolerance_grows_with_depth() {
    // A ground corner seen in perspective from 10 m and from 20 m up: a pixel is 5 mm at
    // 10 m and 10 mm at 20 m (0.5 mm per pixel per metre of depth), so 60 mm off the corner
    // is 12 px (no snap) from 10 m but 6 px (snap) from 20 m.
    let m = model(&[rect(3.0, 0.0, 1.0, 1.0)]);
    let persp = |x: f64, y: f64, h: f64| InferQuery {
        origin: [x, y, h],
        px: PixelModel {
            ortho: false,
            scale: 0.0005,
            eye: [x, y, h],
            forward: [0.0, 0.0, -1.0],
        },
        grid: false,
        ..down(x, y, 0.0)
    };
    assert_ne!(run(&m, &persp(4.06, 1.0, 10.0)).kind, K::Endpoint);
    let r = run(&m, &persp(4.06, 1.0, 20.0));
    assert_eq!(r.kind, K::Endpoint);
    assert!(close(r.point, [4.0, 1.0, 0.0]));
    // 40 mm off from 10 m is 8 px: snaps.
    assert_eq!(run(&m, &persp(4.04, 1.0, 10.0)).kind, K::Endpoint);
}

#[test]
fn hidden_points_do_not_snap() {
    // A box with a second, taller box in front of it seen from the side: the hidden
    // corner of the back box does not snap through the front box's face.
    let m = boxes(&[(0.0, 0.0, 1.0, 1.0, 1.0), (0.0, -2.0, 2.0, 0.5, 2.0)]);
    let side = |x: f64, z: f64| InferQuery {
        origin: [x, -10.0, z],
        dir: [0.0, 1.0, 0.0],
        px: PixelModel {
            ortho: true,
            scale: 0.001,
            eye: [x, -10.0, z],
            forward: [0.0, 1.0, 0.0],
        },
        ..down(0.0, 0.0, 0.001)
    };
    let r = run(&m, &side(1.002, 1.0));
    assert_ne!(r.kind, K::Endpoint, "{r:?}");
    assert_eq!(r.kind, K::OnFace);
}

#[test]
fn axis_lines_from_the_start_point() {
    let m = model(&[]);
    let mut q = down(0.5, 0.003, 0.001);
    q.start = Some([0.0, 0.0, 0.0]);
    q.grid = false;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::AxisX);
    assert_eq!(r.point, [0.5, 0.0, 0.0], "exactly on the red axis");
    assert_eq!(r.tip, "On Red Axis");
    assert_eq!(r.lines.len(), 1);
    q.origin = [0.004, 0.37, 10.0];
    q.px.eye = q.origin;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::AxisY);
    assert_eq!(r.point, [0.0, 0.37, 0.0]);
    // 20 px off both axes: free.
    q.origin = [0.3, 0.02, 10.0];
    q.px.eye = q.origin;
    assert_eq!(run(&m, &q).kind, K::Free);
}

#[test]
fn locks_force_the_line_and_project_point_snaps_onto_it() {
    let m = model(&[rect(0.5, 0.5, 0.2, 0.2)]);
    let mut q = down(0.3, 0.4, 0.001);
    q.start = Some([0.0, 0.0, 0.0]);
    q.lock = Some(LockQ {
        dir: [0.0, 1.0, 0.0],
        kind: K::AxisY,
    });
    let r = run(&m, &q);
    assert_eq!(r.kind, K::AxisY);
    assert!(close(r.point, [0.0, 0.4, 0.0]), "{:?}", r.point);
    // Hovering the rectangle's corner (0.7, 0.7) while locked to green: projected.
    q.origin = [0.701, 0.7, 10.0];
    q.px.eye = q.origin;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::FromPoint);
    assert!(close(r.point, [0.0, 0.7, 0.0]), "{:?}", r.point);
    assert_eq!(r.lines.len(), 2, "the locked axis and the dotted alignment");
    // Blue lock from a ground start: the closest point of the vertical line to the ray.
    let mut q = InferQuery {
        origin: [-10.0, 0.0, 0.25],
        dir: [1.0, 0.0, 0.0],
        px: PixelModel {
            ortho: true,
            scale: 0.001,
            eye: [-10.0, 0.0, 0.25],
            forward: [1.0, 0.0, 0.0],
        },
        ..down(0.0, 0.0, 0.001)
    };
    q.start = Some([0.0, 0.0, 0.0]);
    q.lock = Some(LockQ {
        dir: [0.0, 0.0, 1.0],
        kind: K::AxisZ,
    });
    let r = run(&m, &q);
    assert_eq!(r.kind, K::AxisZ);
    // Length snapping rounds 0.25 m to 10 in (4 px away at 1 mm / px)...
    assert!(close(r.point, [0.0, 0.0, 10.0 * IN]), "{:?}", r.point);
    // ...and without grid snapping the height is exactly where the cursor is.
    q.grid = false;
    let r = run(&m, &q);
    assert!(close(r.point, [0.0, 0.0, 0.25]));
}

#[test]
fn parallel_and_perpendicular_to_a_reference_edge() {
    let m = model(&[Op::InsertSegment {
        sketch: 1,
        a: [0.0, 0.0],
        b: [1.0, 1.0],
    }]);
    let r2 = std::f64::consts::FRAC_1_SQRT_2;
    let mut q = down(2.0 + 0.5, 0.5 + 0.002, 0.001);
    q.start = Some([2.0, 0.0, 0.0]);
    q.refs = vec![[[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]];
    q.grid = false;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Parallel);
    let p = DVec3::from_array(r.point) - DVec3::new(2.0, 0.0, 0.0);
    assert!(p.normalize().dot(DVec3::new(r2, r2, 0.0)) > 1.0 - 1e-12);
    q.origin = [2.5, -0.5 + 0.003, 10.0];
    q.px.eye = q.origin;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Perpendicular);
    let p = DVec3::from_array(r.point) - DVec3::new(2.0, 0.0, 0.0);
    assert!(p.normalize().dot(DVec3::new(r2, -r2, 0.0)).abs() > 1.0 - 1e-12);
}

#[test]
fn intersections_and_centres() {
    let circle: Vec<[f64; 2]> = (0..24)
        .map(|k| {
            let a = std::f64::consts::TAU * f64::from(k) / 24.0;
            [3.0 + 0.5 * a.cos(), 0.5 * a.sin()]
        })
        .collect();
    let m = model(&[
        Op::InsertSegment {
            sketch: 1,
            a: [0.0, 0.0],
            b: [1.0, 1.0],
        },
        Op::AddPolyline {
            sketch: 1,
            points: circle,
            closed: true,
        },
    ]);
    // The diagonal and a vertical guide-free stroke crossing it.
    let mut m = m;
    m.apply(&Op::InsertSegment {
        sketch: 1,
        a: [0.0, 1.0],
        b: [1.0, 0.0],
    })
    .unwrap();
    // The sketch split both strokes at the crossing, so it is an endpoint now; an
    // intersection of two *unsplit* lines is tested with guides in the tape tests. Here:
    let r = run(&m, &down(0.502, 0.499, 0.001));
    assert_eq!(r.kind, K::Endpoint);
    assert!(close(r.point, [0.5, 0.5, 0.0]));
    let r = run(&m, &down(3.004, 0.003, 0.001));
    assert_eq!(r.kind, K::Centre);
    assert!((DVec3::from_array(r.point) - DVec3::new(3.0, 0.0, 0.0)).length() < 1e-9);
}

#[test]
fn edges_of_different_solids_cross_as_intersections() {
    // Two boxes overlapping in plan, the second taller; seen from the top, the first box's
    // top edge (z = 1) and... edges at different heights do not intersect in 3D, so the
    // crossing is not an intersection. Coplanar crossing edges are: two boxes of equal
    // height crossing in plan have top edges crossing at z = 1.
    let m = model(&[
        rect(0.0, 0.0, 1.0, 1.0),
        extrude(1, 1.0),
        rect(0.3, -0.5, 0.2, 2.0),
    ]);
    // Region edge x = 0.3 (ground) and box bottom edge y = 0 (ground) cross at (0.3, 0).
    // From below (the ground is not a solid face) look up at the crossing.
    let q = InferQuery {
        origin: [0.302, 0.002, -10.0],
        dir: [0.0, 0.0, 1.0],
        px: PixelModel {
            ortho: true,
            scale: 0.001,
            eye: [0.302, 0.002, -10.0],
            forward: [0.0, 0.0, 1.0],
        },
        ..down(0.0, 0.0, 0.001)
    };
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Intersection, "{r:?}");
    assert!(close(r.point, [0.3, 0.0, 0.0]), "{:?}", r.point);
}

#[test]
fn from_point_aligns_with_a_hovered_point() {
    let m = model(&[]);
    let mut q = down(1.003, 0.004, 0.001);
    q.start = Some([0.0, 0.0, 0.0]);
    q.anchors = vec![[1.0, 0.5, 0.0]];
    q.grid = false;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::FromPoint);
    assert_eq!(
        r.point,
        [1.0, 0.0, 0.0],
        "red from the start meets green from the anchor"
    );
    assert_eq!(r.lines.len(), 2);
    // Without a start: the anchor's own axis lines.
    let mut q = down(1.004, 0.3, 0.001);
    q.anchors = vec![[1.0, 0.5, 0.0]];
    q.grid = false;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::FromPoint);
    assert!(close(r.point, [1.0, 0.3, 0.0]));
}

#[test]
fn a_drawing_plane_keeps_results_on_it() {
    // Drawing on the top of a 1 m box (z = 1): a lower box's corner projects up.
    let m = boxes(&[(0.0, 0.0, 1.0, 1.0, 1.0), (2.0, 0.0, 0.5, 0.5, 0.5)]);
    let mut q = down(2.5 + 0.003, 0.5, 0.001);
    q.plane = Some(PlaneQ {
        origin: [0.0, 0.0, 1.0],
        normal: [0.0, 0.0, 1.0],
    });
    let r = run(&m, &q);
    assert_eq!(r.kind, K::FromPoint);
    assert!(close(r.point, [2.5, 0.5, 1.0]), "{:?}", r.point);
    // Nothing near: the point is on the plane, not on the ground.
    let mut q = down(4.0, 4.0, 0.001);
    q.plane = Some(PlaneQ {
        origin: [0.0, 0.0, 1.0],
        normal: [0.0, 0.0, 1.0],
    });
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Free);
    assert!(close(r.point, [4.0, 4.0, 1.0]));
}

#[test]
fn the_grid_snaps_only_when_nothing_else_is_near() {
    let m = model(&[]);
    let r = run(&m, &down(3.0 * IN + 0.001, 5.0 * IN - 0.002, 0.001));
    assert_eq!(r.kind, K::Grid);
    assert!(
        close(r.point, [3.0 * IN, 5.0 * IN, 0.0]),
        "exact inches: {:?}",
        r.point
    );
    // Halfway between grid lines: free.
    assert_eq!(run(&m, &down(3.5 * IN, 5.5 * IN, 0.001)).kind, K::Free);
    // Zoomed out (1 cm/px): 1 in cells are 2.5 px, too dense; the 1 ft grid takes over.
    let r = run(&m, &down(12.0 * IN + 0.05, 0.03, 0.01));
    assert_eq!(r.kind, K::Grid);
    assert!(close(r.point, [12.0 * IN, 0.0, 0.0]));
    // Metric steps.
    let mut q = down(0.031, 0.069, 0.001);
    q.grid_step = Some([0.01, 0.1]);
    let r = run(&m, &q);
    assert!(close(r.point, [0.03, 0.07, 0.0]));
    // A region on the ground still snaps to the grid; a solid's top face does not.
    let m = model(&[rect(0.0, 0.0, 1.0, 1.0)]);
    assert_eq!(
        run(&m, &down(2.0 * IN + 0.001, 2.0 * IN, 0.001)).kind,
        K::Grid
    );
    let m = unit_box();
    assert_eq!(
        run(&m, &down(5.0 * IN + 0.001, 5.0 * IN, 0.001)).kind,
        K::OnFace
    );
    // Something near beats the grid: the box's ground corner is an endpoint.
    let m = model(&[rect(0.0, 0.0, 1.0, 1.0)]);
    assert_eq!(run(&m, &down(0.003, 0.002, 0.001)).kind, K::Endpoint);
}

#[test]
fn an_axis_crossing_an_edge_snaps_to_the_crossing() {
    // Drawing from (0, 0.5) along red toward the box's left wall at x = 1 (ground edge
    // x = 1, y in 0..1 belongs to the region outline).
    let m = model(&[rect(1.0, 0.0, 1.0, 1.0)]);
    let mut q = down(1.0 + 0.004, 0.5 + 0.003, 0.001);
    q.start = Some([0.0, 0.5, 0.0]);
    q.grid = false;
    let r = run(&m, &q);
    assert!(close(r.point, [1.0, 0.5, 0.0]), "{:?}", r);
    assert!(matches!(r.kind, K::OnEdge | K::Midpoint), "{:?}", r.kind);
}

#[test]
fn an_edge_beats_an_alignment_line_running_along_it() {
    // The cursor near the top front edge after hovering its corner: the corner's red
    // alignment line runs along the very same edge. The edge (a real entity) wins.
    let m = unit_box();
    let mut q = down(0.25, 0.003, 0.001);
    q.anchors = vec![[1.0, 0.0, 1.0]];
    let r = run(&m, &q);
    assert_eq!(r.kind, K::OnEdge, "{r:?}");
    assert!(close(r.point, [0.25, 0.0, 1.0]));
}

#[test]
fn lengths_along_an_axis_snap_to_whole_grid_steps() {
    let m = model(&[]);
    let mut q = down(7.3 * IN, 0.002, 0.001); // 1 in = 25.4 px
    q.start = Some([1.0 * IN, 0.0, 0.0]);
    let r = run(&m, &q);
    assert_eq!(r.kind, K::AxisX);
    // 6.3 in from the start: rounded to 6 in (7.6 px away on the axis: within reach? no,
    // 0.3 in = 7.6 px > 7 px line reach), so it stays continuous...
    assert!((r.point[0] - 7.3 * IN).abs() < 1e-9);
    // ...while 6.2 in rounds to exactly 6 in (5.1 px).
    q.origin = [7.2 * IN, 0.002, 10.0];
    q.px.eye = q.origin;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::AxisX);
    assert_eq!(r.point, [7.0 * IN, 0.0, 0.0]);
    // Off when grid snapping is off.
    q.grid = false;
    assert!((run(&m, &q).point[0] - 7.2 * IN).abs() < 1e-9);
}

#[test]
fn an_edge_snap_names_the_face_beside_it_that_faces_the_eye() {
    // Looking down just outside the box's top front edge: the ray misses the box, but the
    // snap on the edge reports the top face (facing the eye), not the front face.
    let m = unit_box();
    let r = run(&m, &down(0.5, -0.003, 0.001));
    assert_eq!(r.kind, K::Midpoint);
    assert!(r.surface.is_none());
    let adj = r.adjacent.expect("a face beside the edge");
    assert_eq!(adj.frame.normal, [0.0, 0.0, 1.0]);
    assert!(matches!(
        adj.at,
        sawhorse_inference::scene::SurfaceRef::Face { object: 1, face: 2 }
    ));
    // On the ground away from everything: none.
    assert!(run(&m, &down(3.0, 3.0, 0.001)).adjacent.is_none());
}

#[test]
fn guides_snap_and_cross_edges() {
    // A bookshelf side's inner face (x = 3/4 in) with a guide 21 1/2 in up across it:
    // the guide meets the face's front edge (x = 3/4, y = 0) at an exact intersection.
    let mut m = boxes(&[(0.0, 0.0, 0.75 * IN, 11.25 * IN, 72.0 * IN)]);
    let z = 21.5 * IN;
    m.apply(&Op::AddGuide {
        point: [0.75 * IN, 0.0, z],
        dir: Some([0.0, 1.0, 0.0]),
    })
    .unwrap();
    m.apply(&Op::AddGuide {
        point: [3.0, 3.0, 0.0],
        dir: None,
    })
    .unwrap();
    // Looking at the inner face from +x (Right view direction).
    let side = |y: f64, zz: f64| InferQuery {
        origin: [10.0, y, zz],
        dir: [-1.0, 0.0, 0.0],
        px: PixelModel {
            ortho: true,
            scale: 0.0005,
            eye: [10.0, y, zz],
            forward: [-1.0, 0.0, 0.0],
        },
        ..down(0.0, 0.0, 0.001)
    };
    let r = run(&m, &side(0.001, z + 0.001));
    assert_eq!(r.kind, K::Intersection, "{r:?}");
    assert!(close(r.point, [0.75 * IN, 0.0, z]), "{:?}", r.point);
    let r = run(&m, &side(5.0 * IN, z + 0.002));
    assert_eq!(r.kind, K::OnGuide);
    assert!(close(r.point, [0.75 * IN, 5.0 * IN, z]));
    // The guide point.
    let r = run(&m, &down(3.003, 3.002, 0.001));
    assert_eq!(r.kind, K::GuidePoint);
    assert_eq!(r.point, [3.0, 3.0, 0.0]);
    // Picking a guide gives the guide entity.
    let p = sawhorse_inference::pick::pick(
        &Scene::build(&m),
        &sawhorse_inference::pick::PickQuery {
            origin: [10.0, 5.0 * IN, z + 0.001],
            dir: [-1.0, 0.0, 0.0],
            px: side(0.0, 0.0).px,
            point_px: 8.0,
            edge_px: 5.0,
            soft: false,
        },
    )
    .unwrap();
    assert!(
        matches!(
            p.entity,
            sawhorse_inference::pick::Entity::Guide { guide: 1 }
        ),
        "{p:?}"
    );
}

#[test]
fn an_edge_of_the_face_under_the_cursor_is_not_hidden_by_it_when_seen_obliquely() {
    // A tall box seen from a steep angle: the cursor 4 px above the face's bottom edge hits
    // the face at a point well in front of the edge along the ray. The edge still snaps.
    let m = boxes(&[(0.0, 0.0, 1.0, 1.0, 2.0)]);
    let dir = DVec3::new(0.3, 1.0, -1.0).normalize();
    // Aim at the front face (y = 0) 6 mm above its bottom edge, steeply from above.
    let target = DVec3::new(0.3, 0.0, 0.006);
    let origin = target - dir * 10.0;
    let q = InferQuery {
        origin: origin.to_array(),
        dir: dir.to_array(),
        px: PixelModel {
            ortho: true,
            scale: 0.001,
            eye: origin.to_array(),
            forward: dir.to_array(),
        },
        ..down(0.0, 0.0, 0.001)
    };
    let r = run(&m, &q);
    assert_eq!(r.kind, K::OnEdge, "{r:?}");
    assert!(r.point[2].abs() < 1e-12);
}

#[test]
fn the_origin_is_a_point_to_snap_to() {
    // A millimetre a pixel, 5 px away: on the bare ground there is nothing else to find.
    let bare = model(&[]);
    let r = run(&bare, &down(0.005, 0.0, 0.001));
    assert_eq!(r.kind, K::Origin);
    assert!(close(r.point, [0.0, 0.0, 0.0]));
    // Past the snap distance it lets go.
    assert_ne!(run(&bare, &down(0.03, 0.0, 0.001)).kind, K::Origin);
}

#[test]
fn a_corner_at_the_origin_stays_a_corner_and_a_covered_origin_does_not_snap() {
    let at_origin = unit_box();
    assert_eq!(run(&at_origin, &down(0.0, 0.0, 0.001)).kind, K::Endpoint);
    let over = boxes(&[(-1.0, -1.0, 2.0, 2.0, 1.0)]);
    assert_ne!(run(&over, &down(0.0, 0.0, 0.001)).kind, K::Origin);
}

#[test]
fn a_drawing_plane_away_from_the_origin_gets_no_ghost_of_it() {
    let bare = model(&[]);
    let mut q = down(0.005, 0.0, 0.001);
    q.plane = Some(PlaneQ {
        origin: [0.0, 0.0, 1.0],
        normal: [0.0, 0.0, 1.0],
    });
    let r = run(&bare, &q);
    assert_ne!(r.kind, K::FromPoint);
    assert_ne!(r.kind, K::Origin);
}

/// `down` with the ground grid off, so only the axis itself can answer on open ground.
fn no_grid(x: f64, y: f64) -> InferQuery {
    let mut q = down(x, y, 0.001);
    q.grid = false;
    q
}

#[test]
fn the_red_and_green_axes_snap_along_their_length() {
    let bare = model(&[]);
    let r = run(&bare, &no_grid(0.5, 0.004));
    assert_eq!(r.kind, K::OnAxisX);
    assert!(close(r.point, [0.5, 0.0, 0.0]));
    let g = run(&bare, &no_grid(-0.004, -0.7));
    assert_eq!(g.kind, K::OnAxisY);
    assert!(close(g.point, [0.0, -0.7, 0.0]));
    // Past the line snap distance it lets go.
    assert_ne!(run(&bare, &no_grid(0.5, 0.02)).kind, K::OnAxisX);
}

#[test]
fn a_whole_grid_step_on_an_axis_is_still_a_grid_point() {
    let r = run(&model(&[]), &down(20.0 * IN, 0.002, 0.001));
    assert_eq!(r.kind, K::Grid);
    assert!(close(r.point, [20.0 * IN, 0.0, 0.0]));
}

#[test]
fn drawing_along_an_axis_keeps_the_gestures_own_axis_inference() {
    let mut q = no_grid(0.5, 0.002);
    q.start = Some([-1.0, 0.0, 0.0]);
    assert_eq!(run(&model(&[]), &q).kind, K::AxisX);
}

#[test]
fn an_edge_crossing_an_axis_is_an_intersection_and_a_covered_axis_does_not_snap() {
    let crossed = model(&[rect(0.5, -0.3, 1.0, 1.0)]);
    let r = run(&crossed, &no_grid(0.5, 0.003));
    assert_eq!(r.kind, K::Intersection);
    assert!(close(r.point, [0.5, 0.0, 0.0]));
    let over = boxes(&[(-1.0, -1.0, 2.0, 2.0, 1.0)]);
    assert_ne!(run(&over, &no_grid(0.4, 0.002)).kind, K::OnAxisX);
}

#[test]
fn a_plane_that_misses_the_axes_gets_no_axis_snap() {
    let mut q = no_grid(0.5, 0.002);
    q.plane = Some(PlaneQ {
        origin: [0.0, 0.0, 1.0],
        normal: [0.0, 0.0, 1.0],
    });
    assert_ne!(run(&model(&[]), &q).kind, K::OnAxisX);
}

/// Looking along +Y, level, at height `z`, `x` metres right of the origin (a millimetre a pixel).
fn side(x: f64, z: f64) -> InferQuery {
    let mut q = no_grid(0.0, 0.0);
    q.origin = [x, -10.0, z];
    q.dir = [0.0, 1.0, 0.0];
    q.px.eye = q.origin;
    q.px.forward = q.dir;
    q
}

#[test]
fn the_blue_axis_snaps_but_gives_way_to_a_face_behind_it() {
    let r = run(&model(&[]), &side(0.004, 0.5));
    assert_eq!(r.kind, K::OnAxisZ);
    assert!(close(r.point, [0.0, 0.0, 0.5]));
    // A box standing behind the axis: what is under the cursor is its face.
    let behind = boxes(&[(-1.0, 2.0, 2.0, 2.0, 1.0)]);
    assert_ne!(run(&behind, &side(0.004, 0.5)).kind, K::OnAxisZ);
}

/// Looking level along -x from (10, y, z), parallel projection: the Right view.
fn from_the_right(y: f64, z: f64, mpp: f64) -> InferQuery {
    let mut q = down(0.0, 0.0, mpp);
    q.origin = [10.0, y, z];
    q.dir = [-1.0, 0.0, 0.0];
    q.px.eye = q.origin;
    q.px.forward = q.dir;
    q
}

#[test]
fn a_level_view_over_empty_space_lands_on_an_upright_plane_facing_the_eye() {
    // The ground is a line on screen from here: nothing to land on, and the click was lost.
    let m = model(&[]);
    let r = run(&m, &from_the_right(0.3, 0.5, 0.001));
    assert_eq!(r.kind, K::Free);
    assert!(
        close(r.point, [0.0, 0.3, 0.5]),
        "through the origin: {:?}",
        r.point
    );
}

#[test]
fn a_level_view_keeps_the_rubber_band_on_the_plane_of_its_start() {
    let m = model(&[]);
    let mut q = from_the_right(0.3, 0.5, 0.001);
    q.start = Some([0.25, -0.2, 0.1]);
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Free);
    assert!(
        close(r.point, [0.25, 0.3, 0.5]),
        "through the start: {:?}",
        r.point
    );
}

#[test]
fn a_nearly_level_view_does_not_land_on_ground_far_behind_the_model() {
    let m = model(&[]);
    let mut q = from_the_right(0.3, 0.5, 0.001);
    q.dir = DVec3::new(-1.0, 0.0, -0.001).normalize().to_array();
    q.px.forward = q.dir;
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Free);
    assert!(
        r.point[0].abs() < 1e-9,
        "stays near the model: {:?}",
        r.point
    );
}

#[test]
fn a_cursor_above_the_horizon_still_lands_somewhere() {
    // Perspective, looking down a little, the cursor up in the sky.
    let m = model(&[]);
    let mut q = from_the_right(0.5, 1.0, 0.001);
    q.px.ortho = false;
    q.px.forward = DVec3::new(-1.0, 0.0, -0.2).normalize().to_array();
    q.dir = DVec3::new(-1.0, 0.0, 0.1).normalize().to_array();
    let r = run(&m, &q);
    assert_eq!(r.kind, K::Free);
    assert!(
        r.point[0].abs() < 1e-9,
        "on the upright plane: {:?}",
        r.point
    );
}

#[test]
fn a_view_that_looks_down_still_draws_on_the_ground() {
    let m = model(&[]);
    let mut q = from_the_right(0.0, 1.0, 0.001);
    q.dir = DVec3::new(-1.0, 0.0, -1.0).normalize().to_array();
    q.px.forward = q.dir;
    let r = run(&m, &q);
    assert!(r.point[2].abs() < 1e-12, "on the ground: {:?}", r.point);
}
