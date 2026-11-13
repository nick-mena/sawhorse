//! ExtrudeProfile and SetCncDrawing (ADR-0014): a part straight from an outline and its holes,
//! and the drawings a model keeps.

use sawhorse_kernel::document::Document;
use sawhorse_kernel::model::{Model, Op, OpOutcome};
use sawhorse_kernel::profile::ProfileRing;

fn ring(points: &[[f64; 2]]) -> ProfileRing {
    ProfileRing {
        points: points.iter().map(|p| [p[0], p[1], 0.0]).collect(),
        smooth: vec![],
    }
}

fn square(x: f64, y: f64, s: f64) -> ProfileRing {
    ring(&[[x, y], [x + s, y], [x + s, y + s], [x, y + s]])
}

fn op(rings: Vec<ProfileRing>) -> Op {
    Op::ExtrudeProfile {
        origin: [0.0; 3],
        normal: [0.0, 0.0, 1.0],
        rings,
        distance: 0.02,
        name: None,
    }
}

fn refused(rings: Vec<ProfileRing>, words: &str) {
    let mut m = Model::with_ground_sketch();
    let before = m.hash();
    let e = m.apply(&op(rings)).expect_err("refused").to_string();
    assert!(e.contains(words), "{e}");
    assert_eq!(
        m.hash(),
        before,
        "a refused op leaves the document as it was"
    );
}

#[test]
fn an_outline_with_a_hole_is_one_watertight_solid_in_one_undo() {
    let mut d = Document::new();
    let before = d.model().hash();
    let out = d
        .apply(&op(vec![square(0.0, 0.0, 1.0), square(0.25, 0.25, 0.5)]))
        .unwrap();
    assert!(matches!(out, OpOutcome::ObjectCreated { .. }));
    let o = d.model().objects();
    assert_eq!(o.len(), 1);
    assert!((o[0].1.volume() - 0.02 * 0.75).abs() < 1e-9);
    d.undo().unwrap();
    assert_eq!(d.model().hash(), before);
}

#[test]
fn nothing_on_the_ground_is_disturbed() {
    let mut m = Model::with_ground_sketch();
    m.apply(&Op::AddRectangle {
        sketch: 1,
        x: 0.5,
        y: 0.5,
        w: 1.0,
        h: 1.0,
    })
    .unwrap();
    let regions = m.stats().regions;
    m.apply(&op(vec![square(0.0, 0.0, 1.0)])).unwrap();
    assert_eq!(m.stats().regions, regions);
}

#[test]
fn either_winding_gives_the_same_solid() {
    let mut a = Model::with_ground_sketch();
    let mut b = Model::with_ground_sketch();
    a.apply(&op(vec![square(0.0, 0.0, 1.0)])).unwrap();
    let mut r = square(0.0, 0.0, 1.0);
    r.points.reverse();
    b.apply(&op(vec![r])).unwrap();
    assert!((a.objects()[0].1.volume() - b.objects()[0].1.volume()).abs() < 1e-12);
}

#[test]
fn smooth_points_soften_the_walls_beside_them_whichever_way_the_ring_runs() {
    for reversed in [false, true] {
        let mut m = Model::with_ground_sketch();
        let mut r = ring(&[[0.0, 0.0], [1.0, 0.0], [1.2, 0.5], [1.0, 1.0], [0.0, 1.0]]);
        r.smooth = vec![2];
        if reversed {
            r.points.reverse();
            r.smooth = vec![2]; // the middle point again
        }
        m.apply(&op(vec![r])).unwrap();
        assert_eq!(
            m.objects()[0].1.edge_flags().len(),
            1,
            "reversed: {reversed}"
        );
    }
}

#[test]
fn bad_outlines_are_refused_in_words() {
    refused(
        vec![ring(&[[0.0, 0.0], [1.0, 1.0], [1.0, 0.0], [0.0, 1.0]])],
        "crosses or touches itself",
    );
    refused(vec![ring(&[[0.0, 0.0], [1.0, 0.0]])], "three points");
    refused(
        vec![square(0.0, 0.0, 1.0), square(2.0, 2.0, 0.5)],
        "outside the outline",
    );
    refused(
        vec![square(0.0, 0.0, 1.0), square(0.75, 0.25, 0.5)],
        "crosses or touches",
    );
    refused(
        vec![
            square(0.0, 0.0, 1.0),
            square(0.1, 0.1, 0.8),
            square(0.3, 0.3, 0.2),
        ],
        "inside another",
    );
    refused(
        vec![ring(&[
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [1.0, 0.5],
            [0.0, 1.0],
        ])],
        "itself",
    );
    refused(
        vec![ring(&[[0.0, 0.0], [1.0, 0.0], [1.000001, 0.0], [0.0, 1.0]])],
        "closer than 0.01 mm",
    );
    let mut off = square(0.0, 0.0, 1.0);
    off.points[1][2] = 0.1;
    refused(vec![off], "off the sketch's plane");
    let mut wrong = square(0.0, 0.0, 1.0);
    wrong.smooth = vec![9];
    refused(vec![wrong], "smooth point");
}

#[test]
fn a_drawing_is_kept_through_undo_and_a_snapshot_and_changes_the_hash_only_when_present() {
    let mut m = Model::with_ground_sketch();
    let empty = m.hash();
    m.apply(&Op::SetCncDrawing {
        id: 7,
        json: Some("{\"a\":1}".into()),
    })
    .unwrap();
    assert_ne!(m.hash(), empty);
    let back = Model::from_snapshot(&m.snapshot()).unwrap();
    assert_eq!(
        back.cnc_drawings().get(&7).map(String::as_str),
        Some("{\"a\":1}")
    );
    assert_eq!(back.hash(), m.hash());
    let mut d = Document::with_ground_sketch();
    d.apply(&Op::SetCncDrawing {
        id: 7,
        json: Some("{}".into()),
    })
    .unwrap();
    d.undo().unwrap();
    assert!(d.model().cnc_drawings().is_empty());
    assert_eq!(d.model().hash(), empty);
}

#[test]
fn drawing_limits_are_refused() {
    let mut m = Model::with_ground_sketch();
    assert!(
        m.apply(&Op::SetCncDrawing {
            id: 1,
            json: Some("x".repeat(512 * 1024 + 1))
        })
        .is_err()
    );
    assert!(
        m.apply(&Op::SetCncDrawing {
            id: 0,
            json: Some("{}".into())
        })
        .is_err()
    );
    assert!(m.apply(&Op::SetCncDrawing { id: 4, json: None }).is_err());
    for id in 1..=256 {
        m.apply(&Op::SetCncDrawing {
            id,
            json: Some("{}".into()),
        })
        .unwrap();
    }
    assert!(
        m.apply(&Op::SetCncDrawing {
            id: 257,
            json: Some("{}".into())
        })
        .is_err()
    );
    m.apply(&Op::SetCncDrawing {
        id: 256,
        json: Some("{\"b\":2}".into()),
    })
    .unwrap();
}

#[test]
fn a_part_takes_the_drawings_name_in_the_same_step() {
    let mut d = Document::new();
    let before = d.model().hash();
    d.apply(&Op::ExtrudeProfile {
        origin: [0.0; 3],
        normal: [0.0, 0.0, 1.0],
        rings: vec![square(0.0, 0.0, 1.0)],
        distance: 0.02,
        name: Some("Rocker".into()),
    })
    .unwrap();
    assert_eq!(d.model().objects()[0].1.name(), Some("Rocker"));
    d.undo().unwrap();
    assert_eq!(
        d.model().hash(),
        before,
        "one undo takes the part and its name"
    );
    // A name the model would refuse anywhere refuses the whole op.
    let mut m = Model::with_ground_sketch();
    let was = m.hash();
    assert!(
        m.apply(&Op::ExtrudeProfile {
            origin: [0.0; 3],
            normal: [0.0, 0.0, 1.0],
            rings: vec![square(0.0, 0.0, 1.0)],
            distance: 0.02,
            name: Some("x".repeat(10_000)),
        })
        .is_err()
    );
    assert_eq!(m.hash(), was);
}
