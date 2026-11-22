//! Loop Cut: a ring of edges drawn all the way around a part, where a plane crosses it, so a
//! section of the part can be pushed or pulled on its own (a shoulder, a taper's start).

use sawhorse_kernel::model::{DrawTarget, Op, OpOutcome};
use sawhorse_kernel::{Document, FaceEditError, KernelError};

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

fn faces(d: &Document, o: u64) -> usize {
    d.model().object(o).expect("there").brep().face_count()
}

fn volume(d: &Document, o: u64) -> f64 {
    d.model().object(o).expect("there").volume()
}

fn loop_cut(object: u64, origin: [f64; 3], normal: [f64; 3]) -> Op {
    Op::LoopCut {
        object,
        origin,
        normal,
    }
}

#[test]
fn a_loop_cut_rings_a_board_in_one_step() {
    let mut d = Document::new();
    let board = block(&mut d, [0.0; 3], [1.0, 0.1, 0.02]);
    let h = d.hash();
    let out = ok(&mut d, loop_cut(board, [0.4, 0.05, 0.01], [1.0, 0.0, 0.0]));
    let OpOutcome::FaceSplit { faces: made } = out else {
        panic!("{out:?}");
    };
    assert_eq!(made.len(), 4, "one new face on each long side");
    assert_eq!(faces(&d, board), 10);
    assert!((volume(&d, board) - 0.002).abs() < 1e-12);
    d.undo().expect("one undo step");
    assert_eq!(d.hash(), h);
}

#[test]
fn a_slanted_loop_cut_still_goes_all_the_way_around() {
    let mut d = Document::new();
    let post = block(&mut d, [0.0; 3], [0.1, 0.1, 1.0]);
    ok(&mut d, loop_cut(post, [0.05, 0.05, 0.5], [0.3, 0.0, 1.0]));
    assert_eq!(faces(&d, post), 10);
}

#[test]
fn two_loop_cuts_leave_a_band_to_push() {
    let mut d = Document::new();
    let rail = block(&mut d, [0.0; 3], [1.0, 0.05, 0.05]);
    ok(&mut d, loop_cut(rail, [0.3, 0.0, 0.0], [1.0, 0.0, 0.0]));
    ok(&mut d, loop_cut(rail, [0.7, 0.0, 0.0], [-1.0, 0.0, 0.0]));
    assert_eq!(faces(&d, rail), 14);
}

#[test]
fn a_loop_cut_refuses_in_words() {
    let mut d = Document::new();
    let board = block(&mut d, [0.0; 3], [1.0, 0.1, 0.02]);
    let e = refused(&mut d, loop_cut(board, [2.0, 0.0, 0.0], [1.0, 0.0, 0.0]));
    assert!(
        matches!(e, KernelError::FaceEdit(FaceEditError::NothingToCut)),
        "{e}"
    );
    // Along an end: there are edges all the way around there already.
    let e = refused(&mut d, loop_cut(board, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0]));
    assert!(
        matches!(e, KernelError::FaceEdit(FaceEditError::NothingToCut)),
        "{e}"
    );
    ok(&mut d, loop_cut(board, [0.5, 0.0, 0.0], [1.0, 0.0, 0.0]));
    let e = refused(&mut d, loop_cut(board, [0.5, 0.0, 0.0], [1.0, 0.0, 0.0]));
    assert!(
        matches!(e, KernelError::FaceEdit(FaceEditError::NothingToCut)),
        "{e}"
    );
    let e = refused(&mut d, loop_cut(board, [0.5, 0.0, 0.0], [0.0, 0.0, 0.0]));
    assert!(
        matches!(e, KernelError::FaceEdit(FaceEditError::Degenerate)),
        "{e}"
    );
    let e = refused(
        &mut d,
        loop_cut(board, [f64::NAN, 0.0, 0.0], [1.0, 0.0, 0.0]),
    );
    assert!(
        matches!(e, KernelError::FaceEdit(FaceEditError::OutOfBounds)),
        "{e}"
    );
}

#[test]
fn a_loop_cut_replays_and_survives_save() {
    let mut d = Document::new();
    let board = block(&mut d, [0.0; 3], [1.0, 0.1, 0.02]);
    ok(&mut d, loop_cut(board, [0.25, 0.0, 0.0], [1.0, 0.0, 0.0]));
    let again = sawhorse_kernel::Model::replay(d.log()).unwrap();
    assert_eq!(again.hash(), d.model().hash());
    let text = serde_json::to_string(&d.model().snapshot()).unwrap();
    let back =
        sawhorse_kernel::Model::from_snapshot(&serde_json::from_str(&text).unwrap()).unwrap();
    back.validate().unwrap();
    assert_eq!(back.hash(), d.model().hash());
}

/// A solid extruded up from a footprint drawn on the ground.
fn extruded(doc: &mut Document, footprint: &[[f64; 2]], h: f64) -> u64 {
    let out = ok(
        doc,
        Op::Draw {
            target: DrawTarget::Plane {
                origin: [0.0; 3],
                normal: [0.0, 0.0, 1.0],
            },
            points: footprint.iter().map(|&[x, y]| [x, y, 0.0]).collect(),
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
    let OpOutcome::ObjectCreated { object } = ok(
        doc,
        Op::Extrude {
            sketch: sketch.expect("a new sketch"),
            region: regions[0],
            distance: h,
        },
    ) else {
        panic!("not a solid");
    };
    object
}

#[test]
fn a_loop_cut_across_both_arms_of_a_u_makes_two_rings() {
    let mut d = Document::new();
    let u = extruded(
        &mut d,
        &[
            [0.0, 0.0],
            [0.3, 0.0],
            [0.3, 0.3],
            [0.2, 0.3],
            [0.2, 0.1],
            [0.1, 0.1],
            [0.1, 0.3],
            [0.0, 0.3],
        ],
        0.05,
    );
    assert_eq!(faces(&d, u), 10);
    ok(&mut d, loop_cut(u, [0.0, 0.2, 0.0], [0.0, 1.0, 0.0]));
    assert_eq!(faces(&d, u), 18);
}

#[test]
fn a_loop_cut_through_a_mortise_says_why_it_cannot() {
    let mut d = Document::new();
    let rail = block(&mut d, [0.0; 3], [1.0, 0.1, 0.05]);
    let chisel = block(&mut d, [0.4, 0.03, -0.1], [0.2, 0.04, 0.3]);
    ok(
        &mut d,
        Op::CombineParts {
            target: sawhorse_kernel::nodes::Item::Object(rail),
            with: vec![sawhorse_kernel::nodes::Item::Object(chisel)],
            how: sawhorse_kernel::parts::PartsOp::Subtract,
        },
    );
    // Beside the mortise is fine; through it, the top and bottom faces would need a cut
    // from their edge to the hole's, which does not split them.
    ok(&mut d, loop_cut(rail, [0.2, 0.0, 0.0], [1.0, 0.0, 0.0]));
    let e = refused(&mut d, loop_cut(rail, [0.5, 0.0, 0.0], [1.0, 0.0, 0.0]));
    assert!(
        matches!(e, KernelError::FaceEdit(FaceEditError::ThroughHole)),
        "{e}"
    );
}
