//! Adding parts together and cutting one part with another: the joinery the kernel promises
//! through `Op::CombineParts`.

use sawhorse_kernel::curve::CurveSpec;
use sawhorse_kernel::model::{DrawTarget, Op, OpOutcome};
use sawhorse_kernel::nodes::Item;
use sawhorse_kernel::parts::PartsOp;
use sawhorse_kernel::transform::Xform;
use sawhorse_kernel::{Document, KernelError, PartsError};

fn ok(d: &mut Document, op: Op) -> OpOutcome {
    d.apply(&op).unwrap_or_else(|e| panic!("{op:?}: {e}"))
}

fn refused(d: &mut Document, op: Op) -> KernelError {
    let (h, log, depth) = (d.hash(), d.log().len(), d.depth());
    let e = d.apply(&op).expect_err("should be refused");
    assert!(!e.is_bug(), "{op:?}: {e}");
    assert_eq!(
        (d.hash(), d.log().len(), d.depth()),
        (h, log, depth),
        "a refusal changes nothing"
    );
    e
}

/// A box from `min`, `size` across, in the open context.
fn block(doc: &mut Document, min: [f64; 3], size: [f64; 3]) -> u64 {
    let [x, y, z] = min;
    let [w, d, h] = size;
    let out = ok(
        doc,
        Op::Draw {
            target: DrawTarget::Plane {
                origin: [0.0, 0.0, z],
                normal: [0.0, 0.0, 1.0],
            },
            points: vec![[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]],
            closed: true,
            curve: None,
        },
    );
    let OpOutcome::Drawn {
        sketch, regions, ..
    } = out
    else {
        panic!("{out:?}");
    };
    let out = ok(
        doc,
        Op::Extrude {
            sketch: sketch.expect("a new sketch"),
            region: regions[0],
            distance: h,
        },
    );
    let OpOutcome::ObjectCreated { object } = out else {
        panic!("{out:?}");
    };
    object
}

fn cut(target: u64, with: u64) -> Op {
    Op::CombineParts {
        target: Item::Object(target),
        with: vec![Item::Object(with)],
        how: PartsOp::Cut,
    }
}

fn add(target: u64, with: &[u64]) -> Op {
    Op::CombineParts {
        target: Item::Object(target),
        with: with.iter().map(|&o| Item::Object(o)).collect(),
        how: PartsOp::Add,
    }
}

fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-9, "{a} is not {b}");
}

fn volume(d: &Document, o: u64) -> f64 {
    d.model().object(o).expect("still there").volume()
}

#[test]
fn a_tenon_cuts_its_mortise_and_is_still_there() {
    let mut d = Document::new();
    let leg = block(&mut d, [0.0; 3], [0.1, 0.1, 0.5]);
    let tenon = block(&mut d, [0.03, 0.03, 0.3], [0.04, 0.04, 0.3]);
    let before = volume(&d, tenon);
    let out = ok(&mut d, cut(leg, tenon));
    assert_eq!(
        out,
        OpOutcome::PartsCombined {
            objects: vec![leg],
            unique: false
        }
    );
    near(volume(&d, leg), 0.1 * 0.1 * 0.5 - 0.04 * 0.04 * 0.2);
    assert_eq!(volume(&d, tenon), before, "the cutter is untouched");
    assert_eq!(d.model().object(tenon).unwrap().number(), 2);
    d.undo().expect("one undo step");
    near(volume(&d, leg), 0.1 * 0.1 * 0.5);
}

#[test]
fn a_cut_can_be_repeated_with_the_cutter_moved() {
    let mut d = Document::new();
    let rail = block(&mut d, [0.0; 3], [1.0, 0.1, 0.1]);
    for x in [0.1, 0.5] {
        let dowel = block(&mut d, [x, 0.03, -0.1], [0.02, 0.02, 0.3]);
        ok(&mut d, cut(rail, dowel));
    }
    near(volume(&d, rail), 0.01 - 2.0 * 0.02 * 0.02 * 0.1);
}

#[test]
fn a_cut_right_through_the_middle_leaves_two_parts() {
    let mut d = Document::new();
    let board = block(&mut d, [0.0; 3], [1.0, 0.1, 0.02]);
    let saw = block(&mut d, [0.4, -0.1, -0.1], [0.01, 0.3, 0.3]);
    let out = ok(&mut d, cut(board, saw));
    let OpOutcome::PartsCombined { objects, .. } = out else {
        panic!("{out:?}");
    };
    assert_eq!(objects.len(), 2);
    assert_eq!(objects[0], board);
    near(
        objects.iter().map(|&o| volume(&d, o)).sum::<f64>(),
        0.99 * 0.1 * 0.02,
    );
}

#[test]
fn cutting_refuses_what_it_cannot_do_in_words() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let far = block(&mut d, [1.0, 0.0, 0.0], [0.1, 0.1, 0.1]);
    let resting = block(&mut d, [0.1, 0.0, 0.0], [0.1, 0.1, 0.1]);
    let huge = block(&mut d, [-1.0, -1.0, -1.0], [3.0, 3.0, 3.0]);
    for (with, want) in [
        (far, PartsError::NoOverlap),
        (resting, PartsError::NoOverlap),
        (huge, PartsError::RemovesEverything),
        (a, PartsError::SamePart),
    ] {
        match refused(&mut d, cut(a, with)) {
            KernelError::Parts(e) => assert_eq!(e, want),
            e => panic!("{e}"),
        }
    }
}

#[test]
fn a_cut_keeps_the_part_s_paint_off_the_cutter_s_colours() {
    let mut d = Document::new();
    let leg = block(&mut d, [0.0; 3], [0.1, 0.1, 0.5]);
    let tenon = block(&mut d, [0.03, 0.03, 0.3], [0.04, 0.04, 0.3]);
    ok(
        &mut d,
        Op::DefineMaterial {
            name: "Maple".into(),
            color: [240, 220, 180, 255],
            texture: None,
            size: None,
            rotation: 0.0,
            offset: [0.0, 0.0],
            stock: None,
        },
    );
    ok(
        &mut d,
        Op::SetMaterial {
            object: tenon,
            material: Some("Maple".into()),
        },
    );
    ok(&mut d, cut(leg, tenon));
    let o = d.model().object(leg).unwrap();
    assert!(o.face_paint().is_empty(), "{:?}", o.face_paint());
    assert_eq!(o.material(), None);
}

#[test]
fn parts_add_into_one_and_the_first_keeps_its_identity() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [0.05, 0.0, 0.0], [0.1, 0.1, 0.1]);
    ok(
        &mut d,
        Op::Rename {
            item: Item::Object(a),
            name: Some("Apron".into()),
        },
    );
    let out = ok(&mut d, add(a, &[b]));
    assert_eq!(
        out,
        OpOutcome::PartsCombined {
            objects: vec![a],
            unique: false
        }
    );
    near(volume(&d, a), 0.15 * 0.1 * 0.1);
    assert!(d.model().object(b).is_none(), "what was added is gone");
    assert_eq!(d.model().object(a).unwrap().name(), Some("Apron"));
    d.undo().expect("one undo step");
    assert!(d.model().object(b).is_some());
}

#[test]
fn parts_resting_flush_add_into_one() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [0.1, 0.0, 0.0], [0.1, 0.1, 0.1]);
    ok(&mut d, add(a, &[b]));
    near(volume(&d, a), 0.2 * 0.1 * 0.1);
    assert_eq!(d.model().object(a).unwrap().piece_count(), 1);
}

#[test]
fn a_third_part_can_bridge_the_first_two() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [0.3, 0.0, 0.0], [0.1, 0.1, 0.1]);
    let bridge = block(&mut d, [0.05, 0.0, 0.0], [0.3, 0.1, 0.1]);
    ok(&mut d, add(a, &[b, bridge]));
    near(volume(&d, a), 0.4 * 0.1 * 0.1);
}

#[test]
fn parts_that_do_not_touch_will_not_add() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [1.0, 0.0, 0.0], [0.1, 0.1, 0.1]);
    match refused(&mut d, add(a, &[b])) {
        KernelError::Parts(e) => assert_eq!(e, PartsError::NotTouching),
        e => panic!("{e}"),
    }
}

#[test]
fn parts_meeting_only_along_an_edge_are_refused_in_words() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [0.1, 0.1, 0.0], [0.1, 0.1, 0.1]);
    assert!(matches!(
        refused(&mut d, add(a, &[b])),
        KernelError::Parts(_)
    ));
}

#[test]
fn an_add_keeps_each_part_s_own_look() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [0.05, 0.0, 0.0], [0.1, 0.1, 0.1]);
    ok(
        &mut d,
        Op::DefineMaterial {
            name: "Maple".into(),
            color: [240, 220, 180, 255],
            texture: None,
            size: None,
            rotation: 0.0,
            offset: [0.0, 0.0],
            stock: None,
        },
    );
    ok(
        &mut d,
        Op::SetMaterial {
            object: b,
            material: Some("Maple".into()),
        },
    );
    ok(&mut d, add(a, &[b]));
    let o = d.model().object(a).unwrap();
    assert_eq!(o.material(), None);
    assert!(
        !o.face_paint().is_empty()
            && o.face_paint()
                .values()
                .all(|p| p.material.as_deref() == Some("Maple"))
    );
}

fn component(d: &mut Document, o: u64) -> (u64, u64) {
    let out = ok(
        d,
        Op::MakeComponent {
            items: vec![Item::Object(o)],
            name: "Leg".into(),
        },
    );
    let OpOutcome::ComponentCreated { instance, .. } = out else {
        panic!("{out:?}");
    };
    let out = ok(
        d,
        Op::Copy {
            objects: vec![],
            nodes: vec![instance],
            xform: Xform::translation([1.0, 0.0, 0.0].into()),
        },
    );
    let OpOutcome::Copied { nodes, .. } = out else {
        panic!("{out:?}");
    };
    (instance, nodes[0])
}

#[test]
fn cutting_one_copy_of_a_component_leaves_the_others_alone() {
    let mut d = Document::new();
    let leg = block(&mut d, [0.0; 3], [0.1, 0.1, 0.5]);
    let (one, other) = component(&mut d, leg);
    let tenon = block(&mut d, [0.03, 0.03, 0.3], [0.04, 0.04, 0.3]);
    let out = ok(
        &mut d,
        Op::CombineParts {
            target: Item::Node(one),
            with: vec![Item::Object(tenon)],
            how: PartsOp::Cut,
        },
    );
    let OpOutcome::PartsCombined { unique, .. } = out else {
        panic!("{out:?}");
    };
    assert!(unique);
    let m = d.model();
    let solid_in = |n: u64| {
        m.objects()
            .into_iter()
            .find(|(_, o)| o.membership().parent() == Some(n))
            .expect("a solid")
            .1
            .volume()
    };
    near(solid_in(one), 0.1 * 0.1 * 0.5 - 0.04 * 0.04 * 0.2);
    near(solid_in(other), 0.1 * 0.1 * 0.5);
}

#[test]
fn a_locked_part_cannot_be_cut_but_can_do_the_cutting() {
    let mut d = Document::new();
    let a = block(&mut d, [0.0; 3], [0.1, 0.1, 0.1]);
    let b = block(&mut d, [0.05, 0.0, 0.0], [0.1, 0.1, 0.1]);
    ok(
        &mut d,
        Op::SetLocked {
            items: vec![Item::Object(a)],
            locked: true,
        },
    );
    assert!(matches!(
        refused(&mut d, cut(a, b)),
        KernelError::Structure(_)
    ));
    ok(&mut d, cut(b, a));
    near(volume(&d, b), 0.05 * 0.1 * 0.1);
}

/// A dowel of 24 sides, standing from `z`, turned into the solid a circle pushes up.
fn dowel(doc: &mut Document, c: [f64; 2], r: f64, z: f64, h: f64) -> u64 {
    use sawhorse_kernel::curve::CurveKind;
    let points = (0..24)
        .map(|i| {
            let t = i as f64 / 24.0 * std::f64::consts::TAU;
            [c[0] + r * t.cos(), c[1] + r * t.sin(), z]
        })
        .collect();
    let out = ok(
        doc,
        Op::Draw {
            target: DrawTarget::Plane {
                origin: [0.0, 0.0, z],
                normal: [0.0, 0.0, 1.0],
            },
            points,
            closed: true,
            curve: Some(CurveSpec {
                kind: CurveKind::Circle,
                centre: Some([c[0], c[1], z]),
            }),
        },
    );
    let OpOutcome::Drawn {
        sketch: Some(sketch),
        inside: Some(region),
        ..
    } = out
    else {
        panic!("{out:?}");
    };
    let out = ok(
        doc,
        Op::Extrude {
            sketch,
            region,
            distance: h,
        },
    );
    let OpOutcome::ObjectCreated { object } = out else {
        panic!("{out:?}");
    };
    object
}

#[test]
fn a_dowel_leaves_a_smooth_round_hole() {
    let mut d = Document::new();
    let rail = block(&mut d, [0.0; 3], [0.2, 0.1, 0.05]);
    let peg = dowel(&mut d, [0.1, 0.05], 0.01, -0.05, 0.2);
    ok(&mut d, cut(rail, peg));
    let o = d.model().object(rail).unwrap();
    assert_eq!(o.edge_flags().len(), 24, "the hole's walls stay soft");
    assert!(o.edge_flags().values().all(|f| *f == 3));
}

#[test]
fn a_cutter_at_an_angle_still_cuts_cleanly() {
    let mut d = Document::new();
    let board = block(&mut d, [0.0; 3], [0.5, 0.2, 0.03]);
    let brace = block(&mut d, [0.2, 0.05, -0.1], [0.05, 0.05, 0.3]);
    let o = glam::DVec3::new(0.225, 0.075, 0.015);
    ok(
        &mut d,
        Op::Transform {
            objects: vec![brace],
            nodes: vec![],
            xform: Xform::rotation(o, glam::DVec3::Y, 0.4),
        },
    );
    let whole = volume(&d, board);
    ok(&mut d, cut(board, brace));
    let left = volume(&d, board);
    assert!(left < whole && left > whole * 0.9, "{left} of {whole}");
    assert_eq!(d.model().object(board).unwrap().piece_count(), 1);
}

#[test]
fn cutting_again_with_the_same_cutter_is_refused() {
    let mut d = Document::new();
    let leg = block(&mut d, [0.0; 3], [0.1, 0.1, 0.5]);
    let tenon = block(&mut d, [0.03, 0.03, 0.3], [0.04, 0.04, 0.3]);
    ok(&mut d, cut(leg, tenon));
    match refused(&mut d, cut(leg, tenon)) {
        KernelError::Parts(e) => assert_eq!(e, PartsError::NoOverlap),
        e => panic!("{e}"),
    }
}

#[test]
fn a_cut_survives_save_and_open() {
    let mut d = Document::new();
    let leg = block(&mut d, [0.0; 3], [0.1, 0.1, 0.5]);
    let peg = dowel(&mut d, [0.05, 0.05], 0.01, 0.3, 0.3);
    ok(&mut d, cut(leg, peg));
    let text = serde_json::to_string(&d.model().snapshot()).unwrap();
    let back =
        sawhorse_kernel::Model::from_snapshot(&serde_json::from_str(&text).unwrap()).unwrap();
    back.validate().unwrap();
    assert_eq!(back.hash(), d.model().hash());
}

#[test]
fn the_op_replays_to_the_same_model() {
    let mut d = Document::new();
    let leg = block(&mut d, [0.0; 3], [0.1, 0.1, 0.5]);
    let tenon = block(&mut d, [0.03, 0.03, 0.3], [0.04, 0.04, 0.3]);
    ok(&mut d, cut(leg, tenon));
    ok(&mut d, add(leg, &[tenon]));
    let again = sawhorse_kernel::Model::replay(d.log()).unwrap();
    assert_eq!(again.hash(), d.model().hash());
}
