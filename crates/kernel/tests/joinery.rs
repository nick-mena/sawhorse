//! The joinery library (ADR-0015, step 1): `Op::MakeJoint`. Sizes are in inches here, as a
//! woodworker would check them, and every joint is checked by volume: what one board loses
//! is what the other gains (plus any clearance), so nothing is made or lost by the cut.

use sawhorse_kernel::joinery::{JointError, JointKind, JointParams, JointRole};
use sawhorse_kernel::model::{DrawTarget, Op, OpOutcome};
use sawhorse_kernel::nodes::Item;
use sawhorse_kernel::testing::check_model;
use sawhorse_kernel::transform::Xform;
use sawhorse_kernel::{Document, KernelError, Model};

const IN: f64 = 0.0254;
const CU_IN: f64 = IN * IN * IN;

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

fn joint_error(e: KernelError) -> JointError {
    match e {
        KernelError::Joint(j) => j,
        other => panic!("not a joint refusal: {other}"),
    }
}

/// A box from `min`, `size` across, in inches.
fn board(doc: &mut Document, min: [f64; 3], size: [f64; 3]) -> u64 {
    let [x, y, z] = min.map(|v| v * IN);
    let [w, d, h] = size.map(|v| v * IN);
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

fn joint(kind: JointKind, receiving: u64, inserting: u64, params: JointParams) -> Op {
    Op::MakeJoint {
        kind,
        receiving: Item::Object(receiving),
        inserting: Item::Object(inserting),
        params,
    }
}

/// Cubic inches.
fn volume(d: &Document, o: u64) -> f64 {
    d.model().object(o).expect("still there").volume() / CU_IN
}

fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6 * b.abs().max(1.0), "{a} vs {b}");
}

/// A 1-3/4 in square leg, 29 in tall, and a 3/4 x 3 in rail running off its +X side,
/// centred on it, `into` inches into the leg (0: it butts against the side).
fn leg_and_rail(d: &mut Document, into: f64) -> (u64, u64) {
    let leg = board(d, [0.0, 0.0, 0.0], [1.75, 1.75, 29.0]);
    let rail = board(d, [1.75 - into, 0.5, 20.0], [20.0 + into, 0.75, 3.0]);
    (leg, rail)
}

fn made(out: &OpOutcome) -> (&sawhorse_kernel::joinery::JointNote, u32) {
    let OpOutcome::JointMade { joint, copies, .. } = out else {
        panic!("{out:?}");
    };
    (joint, *copies)
}

#[test]
fn a_mortise_and_tenon_takes_a_woodworker_s_defaults() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    let (leg0, rail0) = (volume(&d, leg), volume(&d, rail));
    let out = ok(
        &mut d,
        joint(JointKind::MortiseTenon, leg, rail, JointParams::default()),
    );
    let (note, copies) = made(&out);
    assert_eq!(copies, 1);
    // A third of the rail's 3/4 in is a 1/4 in chisel; shoulders as wide as the tenon is
    // thick leave 2-1/2 in of a 3 in rail; two thirds of the leg, to the sixteenth: 1-3/16.
    near(note.thickness_nm as f64 / 1e9 / IN, 0.25);
    near(note.width_nm as f64 / 1e9 / IN, 2.5);
    near(note.depth_nm as f64 / 1e9 / IN, 1.1875);
    assert!(!note.through);
    let tenon = 0.25 * 2.5 * 1.1875;
    near(volume(&d, leg), leg0 - tenon);
    near(volume(&d, rail), rail0 + tenon);
    // Both boards remember the same joint, one on each side of it.
    let m = d.model();
    let roles: Vec<_> = [leg, rail]
        .iter()
        .map(|&o| {
            let j = &m.object(o).unwrap().part().joints;
            assert_eq!(j.len(), 1);
            assert_eq!(j[0].id, note.id);
            j[0].role
        })
        .collect();
    assert_eq!(roles, [JointRole::Receives, JointRole::Inserts]);
    check_model(m).unwrap();
    d.undo().expect("one undo step");
    near(volume(&d, leg), leg0);
    near(volume(&d, rail), rail0);
    assert!(d.model().object(leg).unwrap().part().joints.is_empty());
}

#[test]
fn a_rail_drawn_into_the_leg_is_trimmed_back_to_its_shoulder() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.5);
    let leg0 = volume(&d, leg);
    ok(
        &mut d,
        joint(JointKind::MortiseTenon, leg, rail, JointParams::default()),
    );
    let tenon = 0.25 * 2.5 * 1.1875;
    near(volume(&d, leg), leg0 - tenon);
    // The half inch it ran into the leg is gone; the tenon is all that goes in.
    near(volume(&d, rail), 0.75 * 3.0 * 20.0 + tenon);
    check_model(d.model()).unwrap();
}

#[test]
fn typed_sizes_and_clearance_make_the_mortise_that_much_bigger() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    let leg0 = volume(&d, leg);
    let p = JointParams {
        thickness: Some(0.375 * IN),
        width: Some(2.0 * IN),
        depth: Some(1.0 * IN),
        clearance: Some(0.01 * IN),
        ..Default::default()
    };
    let out = ok(&mut d, joint(JointKind::MortiseTenon, leg, rail, p));
    near(made(&out).0.clearance_nm as f64 / 1e9 / IN, 0.01);
    near(volume(&d, leg), leg0 - 0.385 * 2.01 * 1.01);
    near(volume(&d, rail), 0.75 * 3.0 * 20.0 + 0.375 * 2.0 * 1.0);
}

#[test]
fn a_through_tenon_runs_out_the_far_side() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    let leg0 = volume(&d, leg);
    let p = JointParams {
        through: true,
        ..Default::default()
    };
    let out = ok(&mut d, joint(JointKind::MortiseTenon, leg, rail, p));
    assert!(made(&out).0.through);
    near(volume(&d, leg), leg0 - 0.25 * 2.5 * 1.75);
    // A depth typed as the leg's whole thickness is a through tenon too.
    d.undo().unwrap();
    let p = JointParams {
        depth: Some(1.75 * IN),
        ..Default::default()
    };
    assert!(
        made(&ok(&mut d, joint(JointKind::MortiseTenon, leg, rail, p)))
            .0
            .through
    );
}

/// A 3/4 in case side standing on its edge (thickness along X), 11-1/4 in deep and 30 in
/// tall, and a shelf the same depth running off its +X face at `z` inches up.
fn side_and_shelf(d: &mut Document, z: f64) -> (u64, u64) {
    let side = board(d, [0.0, 0.0, 0.0], [0.75, 11.25, 30.0]);
    let shelf = board(d, [0.75, 0.0, z], [20.0, 11.25, 0.75]);
    (side, shelf)
}

#[test]
fn a_dado_houses_the_shelf_a_third_of_the_way_in() {
    let mut d = Document::new();
    let (side, shelf) = side_and_shelf(&mut d, 10.0);
    let (side0, shelf0) = (volume(&d, side), volume(&d, shelf));
    let out = ok(
        &mut d,
        joint(JointKind::Dado, side, shelf, JointParams::default()),
    );
    near(made(&out).0.depth_nm as f64 / 1e9 / IN, 0.25);
    let groove = 0.75 * 11.25 * 0.25;
    near(volume(&d, side), side0 - groove);
    near(volume(&d, shelf), shelf0 + groove);
    check_model(d.model()).unwrap();
}

#[test]
fn a_stopped_dado_stops_short_of_the_end_clicked_near() {
    let mut d = Document::new();
    let (side, shelf) = side_and_shelf(&mut d, 10.0);
    let side0 = volume(&d, side);
    let p = JointParams {
        stop: Some(0.5 * IN),
        // Near the front (low Y).
        near: Some([0.0, 0.2 * IN, 10.0 * IN]),
        ..Default::default()
    };
    let out = ok(&mut d, joint(JointKind::Dado, side, shelf, p));
    near(made(&out).0.width_nm as f64 / 1e9 / IN, 10.75);
    near(volume(&d, side), side0 - 0.75 * 10.75 * 0.25);
    // The front half inch of the side is whole: a block there takes nothing from it.
    let m = d.model();
    check_model(m).unwrap();
    let probe = |y: f64| {
        let mut p = Document::new();
        let o = board(&mut p, [0.5, y, 10.0], [0.25, 0.25, 0.75]);
        p.model().object(o).unwrap().clone()
    };
    let solid = m.object(side).unwrap();
    let inside = |y: f64| {
        solid
            .combine(&probe(y), sawhorse_kernel::boolean::BoolOp::Intersection)
            .unwrap()
            .map_or(0.0, |o| o.volume())
    };
    near(inside(0.1) / CU_IN, 0.25 * 0.25 * 0.75);
    assert!(inside(5.0) < 1e-12, "the groove is there further back");
}

#[test]
fn a_rabbet_is_a_dado_at_the_edge() {
    let mut d = Document::new();
    // The shelf's top is flush with the side's top: that is a rabbet.
    let (side, top) = side_and_shelf(&mut d, 29.25);
    let side0 = volume(&d, side);
    let e = refused(
        &mut d,
        joint(JointKind::Dado, side, top, JointParams::default()),
    );
    assert_eq!(joint_error(e), JointError::AtEdge);
    let out = ok(
        &mut d,
        joint(JointKind::Rabbet, side, top, JointParams::default()),
    );
    // Half the side's 3/4 in, to the sixteenth: 3/8.
    near(made(&out).0.depth_nm as f64 / 1e9 / IN, 0.375);
    near(volume(&d, side), side0 - 0.75 * 11.25 * 0.375);
    check_model(d.model()).unwrap();
    // A shelf away from the edges is a dado, not a rabbet.
    let mut d = Document::new();
    let (side, shelf) = side_and_shelf(&mut d, 10.0);
    let e = refused(
        &mut d,
        joint(JointKind::Rabbet, side, shelf, JointParams::default()),
    );
    assert_eq!(joint_error(e), JointError::NotAtEdge);
}

#[test]
fn a_half_lap_shares_the_crossing_between_the_two_boards() {
    let mut d = Document::new();
    let a = board(&mut d, [0.0, 0.0, 0.0], [20.0, 3.0, 0.75]);
    let b = board(&mut d, [8.0, -8.0, 0.0], [3.0, 20.0, 0.75]);
    let (a0, b0) = (volume(&d, a), volume(&d, b));
    let out = ok(
        &mut d,
        joint(JointKind::HalfLap, a, b, JointParams::default()),
    );
    near(made(&out).0.depth_nm as f64 / 1e9 / IN, 0.375);
    let half = 3.0 * 3.0 * 0.375;
    near(volume(&d, a), a0 - half);
    near(volume(&d, b), b0 - half);
    // Together they fill the crossing exactly once: they no longer overlap.
    let m = d.model();
    let (oa, ob) = (m.object(a).unwrap(), m.object(b).unwrap());
    let both = oa
        .combine(ob, sawhorse_kernel::boolean::BoolOp::Intersection)
        .unwrap();
    assert!(
        both.is_none_or(|o| o.volume() < 1e-12),
        "the halves overlap"
    );
    check_model(m).unwrap();
}

#[test]
fn joints_refuse_what_they_cannot_make_in_words() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    let far = board(&mut d, [5.0, 0.5, 10.0], [10.0, 0.75, 3.0]);
    let cases: Vec<(Op, JointError)> = vec![
        (
            joint(JointKind::MortiseTenon, leg, far, JointParams::default()),
            JointError::NotReaching,
        ),
        (
            joint(JointKind::MortiseTenon, leg, leg, JointParams::default()),
            JointError::SamePart,
        ),
        (
            joint(
                JointKind::MortiseTenon,
                leg,
                rail,
                JointParams {
                    thickness: Some(0.75 * IN),
                    ..Default::default()
                },
            ),
            JointError::TenonTooThick,
        ),
        (
            joint(
                JointKind::MortiseTenon,
                leg,
                rail,
                JointParams {
                    width: Some(4.0 * IN),
                    ..Default::default()
                },
            ),
            JointError::TenonTooWide,
        ),
        (
            joint(
                JointKind::MortiseTenon,
                leg,
                rail,
                JointParams {
                    thickness: Some(0.0),
                    ..Default::default()
                },
            ),
            JointError::TooSmall,
        ),
        (
            joint(JointKind::HalfLap, leg, rail, JointParams::default()),
            JointError::LapApart,
        ),
    ];
    for (op, want) in cases {
        assert_eq!(joint_error(refused(&mut d, op)), want);
    }
    // A rail standing on the leg's top meets end grain.
    let post = board(&mut d, [0.0, 10.0, 0.0], [1.75, 1.75, 29.0]);
    let up = board(&mut d, [0.5, 10.5, 29.0], [0.75, 0.75, 10.0]);
    let e = refused(
        &mut d,
        joint(JointKind::MortiseTenon, post, up, JointParams::default()),
    );
    assert_eq!(joint_error(e), JointError::EndGrain);
    // A rail wider than the leg would break out of it.
    let wide = board(&mut d, [1.75, -1.0, 5.0], [10.0, 3.0, 3.0]);
    let p = JointParams {
        thickness: Some(2.5 * IN),
        ..Default::default()
    };
    let e = refused(&mut d, joint(JointKind::MortiseTenon, leg, wide, p));
    assert_eq!(joint_error(e), JointError::BreaksOut);
}

#[test]
fn a_joint_on_a_component_cuts_every_copy() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    let leg0 = volume(&d, leg);
    let out = ok(
        &mut d,
        Op::MakeComponent {
            items: vec![Item::Object(leg)],
            name: "Leg".into(),
        },
    );
    let OpOutcome::ComponentCreated { instance, .. } = out else {
        panic!("{out:?}");
    };
    ok(
        &mut d,
        Op::Copy {
            objects: vec![],
            nodes: vec![instance],
            xform: Xform::translation([0.0, 30.0 * IN, 0.0].into()),
        },
    );
    let out = ok(
        &mut d,
        Op::MakeJoint {
            kind: JointKind::MortiseTenon,
            receiving: Item::Node(instance),
            inserting: Item::Object(rail),
            params: JointParams::default(),
        },
    );
    assert_eq!(made(&out).1, 2);
    let m = d.model();
    let legs: Vec<_> = m
        .objects()
        .into_iter()
        .filter(|(id, _)| *id != rail)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(legs.len(), 2);
    for o in legs {
        near(o.volume() / CU_IN, leg0 - 0.25 * 2.5 * 1.1875);
        assert_eq!(o.part().joints.len(), 1, "every copy remembers the joint");
    }
    check_model(m).unwrap();
}

#[test]
fn joints_are_saved_with_the_model_and_hashed() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    ok(
        &mut d,
        joint(JointKind::MortiseTenon, leg, rail, JointParams::default()),
    );
    let (side, shelf) = side_and_shelf(&mut d, 10.0);
    let out = ok(
        &mut d,
        joint(JointKind::Dado, side, shelf, JointParams::default()),
    );
    assert_eq!(made(&out).0.id, 2, "each joint gets the next id");
    let json = serde_json::to_string(&d.model().snapshot()).unwrap();
    assert!(
        json.contains("\"joints\":[{\"id\":1,\"kind\":\"mortise_tenon\""),
        "{json}"
    );
    let back = Model::from_snapshot(&serde_json::from_str(&json).unwrap()).unwrap();
    assert_eq!(back.hash(), d.model().hash());
    // The notes are part of the hash: the same shapes without them hash differently.
    let mut bare: serde_json::Value = serde_json::from_str(&json).unwrap();
    strip_joints(&mut bare);
    let bare = Model::from_snapshot(&serde_json::from_value(bare).unwrap()).unwrap();
    assert_ne!(bare.hash(), d.model().hash());
}

fn strip_joints(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(m) => {
            m.remove("joints");
            m.values_mut().for_each(strip_joints);
        }
        serde_json::Value::Array(a) => a.iter_mut().for_each(strip_joints),
        _ => {}
    }
}

#[test]
fn a_file_claiming_too_many_joints_on_one_part_is_refused() {
    let mut d = Document::new();
    let (leg, rail) = leg_and_rail(&mut d, 0.0);
    ok(
        &mut d,
        joint(JointKind::MortiseTenon, leg, rail, JointParams::default()),
    );
    let mut v: serde_json::Value = serde_json::to_value(d.model().snapshot()).unwrap();
    let objects = v["objects"].as_array_mut().unwrap();
    let held = objects
        .iter_mut()
        .find(|o| o["part"]["joints"].is_array())
        .expect("a part with a joint");
    let one = held["part"]["joints"][0].clone();
    let many = sawhorse_kernel::joinery::MAX_JOINTS_PER_PART + 1;
    held["part"]["joints"] = serde_json::Value::Array(vec![one; many]);
    let e = Model::from_snapshot(&serde_json::from_value(v).unwrap()).expect_err("over the limit");
    assert!(e.to_string().contains("joints on one part"), "{e}");
}
