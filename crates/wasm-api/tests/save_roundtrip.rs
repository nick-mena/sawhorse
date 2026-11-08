//! A document saves only if it reads back with the same hash (`DocCore::save_shz`), so a
//! model whose hash changes across a save cannot be saved at all (upstream #21, #34, #35).
//!
//! `model_hash` writes each solid's public id and reading a file hands out fresh ones, so
//! these models hash differently after a save with nothing wrong: the check allows for that
//! (`read_back_difference`) and must still refuse a file that really differs.

use sawhorse_wasm::DocCore;
use serde_json::{Value, json};

const IN: f64 = 0.0254;

/// `boxItem` in packages/plugin-api/src/runtime.ts.
fn box_item(name: &str, size: [f64; 3]) -> Value {
    let positions: Vec<[f64; 3]> = (0..8)
        .map(|k| {
            [
                if k & 1 != 0 { size[0] } else { 0.0 },
                if k & 2 != 0 { size[1] } else { 0.0 },
                if k & 4 != 0 { size[2] } else { 0.0 },
            ]
        })
        .collect();
    let faces = json!([
        [[0, 2, 3, 1]],
        [[4, 5, 7, 6]],
        [[0, 1, 5, 4]],
        [[2, 6, 7, 3]],
        [[0, 4, 6, 2]],
        [[1, 3, 7, 5]]
    ]);
    json!({ "name": name, "positions": positions, "faces": faces })
}

fn at(t: [f64; 3]) -> Value {
    json!({ "linear": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "translation": t })
}

/// The bundled cabinet generator's op: parts as definitions under one assembly, the left
/// side mirrored.
fn cabinet() -> Value {
    let (w, h, d, t) = (24.0 * IN, 34.5 * IN, 24.0 * IN, 0.75 * IN);
    let left = json!({ "linear": [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], "translation": [t, 0, 0] });
    let children = json!([
        { "kind": "instance", "definition": 0, "xform": left, "name": "Left side" },
        { "kind": "instance", "definition": 0, "xform": at([w - t, 0.0, 0.0]), "name": "Right side" },
        { "kind": "instance", "definition": 1, "xform": at([t, 0.0, h - t]), "name": "Top" },
        { "kind": "instance", "definition": 1, "xform": at([t, 0.0, h / 2.0]), "name": "Shelf" },
    ]);
    json!({
        "op": "import",
        "definitions": [
            { "name": "Side", "items": [box_item("Side", [t, d, h])] },
            { "name": "Panel", "items": [box_item("Panel", [w - 2.0 * t, d, t])] },
            { "name": "Cabinet", "items": [], "children": children },
        ],
        "nodes": [{ "kind": "instance", "definition": 2, "xform": at([0.0, 0.0, 0.0]), "name": "Cabinet" }],
    })
}

fn apply(d: &mut DocCore, op: Value) {
    d.apply_json(&op.to_string())
        .unwrap_or_else(|e| panic!("{op}: {e}"));
}

/// Two boards side by side on the ground.
fn two_boards() -> DocCore {
    let mut d = DocCore::default();
    apply(
        &mut d,
        json!({ "op": "new_sketch", "origin": [0, 0, 0], "normal": [0, 0, 1] }),
    );
    for x in [0.0, 1.0] {
        apply(
            &mut d,
            json!({ "op": "add_rectangle", "sketch": 1, "x": x, "y": 0, "w": 0.5, "h": 0.3 }),
        );
    }
    for region in [1, 2] {
        apply(
            &mut d,
            json!({ "op": "extrude", "sketch": 1, "region": region, "distance": 0.02 }),
        );
    }
    d
}

fn saves_and_reopens(d: &DocCore) {
    let bytes = d.save_shz("frac-in", b"", "").expect("the model saves");
    let mut back = DocCore::default();
    back.open_shz(&bytes).expect("the saved file opens");
    assert_eq!(
        back.document().model().stats().objects,
        d.document().model().stats().objects
    );
    // What was opened saves again, unchanged.
    let again = back.save_shz("frac-in", b"", "").expect("it saves again");
    let mut twice = DocCore::default();
    twice.open_shz(&again).expect("and opens again");
    assert_eq!(twice.document().hash_hex(), back.document().hash_hex());
}

#[test]
fn boards_save() {
    saves_and_reopens(&two_boards());
}

#[test]
fn a_cabinet_of_components_saves() {
    let mut d = DocCore::default();
    apply(&mut d, cabinet());
    saves_and_reopens(&d);
}

#[test]
fn a_model_saves_after_its_first_solid_is_deleted() {
    let mut d = two_boards();
    apply(&mut d, json!({ "op": "delete_object", "object": 1 }));
    saves_and_reopens(&d);
}

/// Every step of every golden op log: real modelling sequences, each one savable.
#[test]
fn every_step_of_the_golden_logs_saves() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../kernel/tests/golden");
    let mut refused = Vec::new();
    let mut steps = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let golden: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let mut d = DocCore::default();
        for (i, op) in golden["ops"].as_array().unwrap().iter().enumerate() {
            if d.apply_json(&op.to_string()).is_err() {
                continue;
            }
            steps += 1;
            if let Err(e) = d.save_shz("frac-in", b"", "") {
                refused.push(format!("{} op {i} ({}): {e}", golden["name"], op["op"]));
            }
        }
    }
    assert!(steps > 100, "only {steps} steps were tried");
    assert!(
        refused.is_empty(),
        "{} of {steps} steps:\n{}",
        refused.len(),
        refused.join("\n")
    );
}

/// The allowance for fresh ids must not excuse lost work: a file that really differs from
/// the model is still caught, whichever solid it lost.
#[test]
fn a_read_back_that_lost_a_solid_is_refused() {
    use sawhorse_kernel::hash::read_back_difference;
    let mut gapped = two_boards();
    apply(&mut gapped, json!({ "op": "delete_object", "object": 1 }));
    let model = gapped.document().model();

    let mut changed = two_boards();
    apply(&mut changed, json!({ "op": "delete_object", "object": 2 }));
    let renumbered = sawhorse_kernel::Model::from_snapshot(&changed.document().model().snapshot());
    assert!(read_back_difference(model, &renumbered.unwrap()).is_some());

    let rebuilt = sawhorse_kernel::Model::from_snapshot(&model.snapshot()).unwrap();
    assert_eq!(read_back_difference(model, &rebuilt), None);
}
