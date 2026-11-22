//! The joinery library (ADR-0015, step 1): named joints between two square boards.
//!
//! A joint is made from two parts: the one picked first goes *into* the one clicked (a rail
//! into a leg, a shelf into a side). Where and how they meet decides the cuts, worked out
//! in the clicked board's own axes (thickness, width, length). Every cut is a box, so the
//! sizes come out exact: a 1/4 in tenon is 1/4 in, whatever the model's scale.
//!
//! - Mortise and tenon, dado and rabbet take the first board's end into a side of the
//!   clicked board. The first board is trimmed back to that side (the shoulder), then gets
//!   the tenon or tongue; the clicked board loses the same shape, plus any clearance.
//! - A half-lap takes two boards lying face to face and overlapping where they cross: each
//!   loses part of the overlap, so together they fill it once.
//!
//! A board in a component is cut in its definition, so every copy gets the joint: four legs
//! all get the mortise. Both boards remember the joint ([`JointNote`] in their part
//! attributes) with the sizes it was made with; editing or removing one comes in step 2.
//! Nothing here changes unless every cut works: a refusal leaves the model as it was.

use glam::{DVec2, DVec3};

use crate::boolean::BoolOp;
use crate::error::{KernelError, PartsError};
use crate::hash::StableHasher;
use crate::ids::{ObjectId, to_public};
use crate::model::{Model, OpOutcome};
use crate::nodes::{Item, NodeKind};
use crate::object::Object;
use crate::parts::{boxes_meet, same_volume};
use crate::plane::Plane;

/// Most joints one part may take part in.
pub const MAX_JOINTS_PER_PART: usize = 256;

/// Two sizes closer than this are the same (10 micrometres, the kernel's point merge).
const TOL: f64 = crate::tolerance::POINT_MERGE;
/// How far a cut runs past a side it opens through, so the cut's face never lies exactly on
/// the board's face (a millimetre: far more than any rounding, far less than any board).
const PAST: f64 = 1e-3;
/// Axes closer than this to parallel are parallel (cosine).
const PARALLEL: f64 = 1.0 - 1e-9;

/// The joints the library makes.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[serde(rename_all = "snake_case")]
pub enum JointKind {
    MortiseTenon,
    Dado,
    Rabbet,
    HalfLap,
}

impl JointKind {
    fn code(self) -> u64 {
        match self {
            JointKind::MortiseTenon => 0,
            JointKind::Dado => 1,
            JointKind::Rabbet => 2,
            JointKind::HalfLap => 3,
        }
    }
}

/// Which side of a joint a part is on.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[serde(rename_all = "snake_case")]
pub enum JointRole {
    /// The part clicked: it has the mortise, the dado or the rabbet.
    Receives,
    /// The part picked first: it has the tenon or the tongue.
    Inserts,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// What the person asked for. Every size is optional: a missing one takes the default a
/// woodworker would pick (see [`resolve`]). Metres.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
pub struct JointParams {
    /// The tenon's thickness (mortise and tenon only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thickness: Option<f64>,
    /// The tenon's width (mortise and tenon only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// How deep the clicked board is cut: the tenon's length, the dado's or rabbet's depth,
    /// or how much of the overlap the clicked board loses in a half-lap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    /// Room left for glue, across the thickness (and at a blind mortise's bottom). 0 when
    /// absent: the parts fit exactly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clearance: Option<f64>,
    /// A dado or rabbet stops this far short of the edge nearer `near`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop: Option<f64>,
    /// A point near the end that stops (the click), world coordinates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub near: Option<[f64; 3]>,
    /// The tenon runs all the way through.
    #[serde(default, skip_serializing_if = "is_false")]
    pub through: bool,
    /// A half-lap's other way up: the clicked board keeps the top half instead.
    #[serde(default, skip_serializing_if = "is_false")]
    pub flip: bool,
    /// Defaults in millimetres rather than inches (chisel sizes, rounding).
    #[serde(default, skip_serializing_if = "is_false")]
    pub metric: bool,
}

/// What a part remembers of a joint it was cut for. Sizes are whole nanometres, so the part's
/// attributes stay comparable and hash exactly.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
pub struct JointNote {
    /// Shared by the two parts of one joint.
    pub id: u64,
    pub kind: JointKind,
    pub role: JointRole,
    /// The tenon's thickness, the dado's or rabbet's width, a half-lap's overlap thickness.
    pub thickness_nm: i64,
    /// The tenon's width, the length of a dado or rabbet, the half-lap's overlap width.
    pub width_nm: i64,
    /// How deep the clicked board is cut (see [`JointParams::depth`]).
    pub depth_nm: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub clearance_nm: i64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub through: bool,
}

fn is_zero(n: &i64) -> bool {
    *n == 0
}

fn nm(m: f64) -> i64 {
    (m * 1e9).round() as i64
}

impl JointNote {
    pub(crate) fn hash_into(&self, h: &mut StableHasher) {
        h.u64(self.id);
        h.u64(self.kind.code());
        h.u64(u64::from(self.role == JointRole::Inserts));
        for n in [
            self.thickness_nm,
            self.width_nm,
            self.depth_nm,
            self.clearance_nm,
        ] {
            h.u64(n as u64);
        }
        h.u64(u64::from(self.through));
    }
}

/// Why a joint was not made. Nothing changed.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum JointError {
    #[error("joints are made between two separate solid parts; pick a board, then click another")]
    SamePart,
    #[error(
        "those are copies of the same component, so a cut in one would cut the other too; make one unique first"
    )]
    SameComponent,
    #[error("a joint needs each part to be one solid: open the group and pick the board inside")]
    SeveralSolids,
    #[error("joints work on square-cut boards, and one of these has angled or curved faces")]
    Shaped,
    #[error("the two boards are not square to each other, so the joint cannot line up with both")]
    NotSquare,
    #[error(
        "the first board points at the end of the board clicked; joints go into a side, not end grain"
    )]
    EndGrain,
    #[error(
        "the middle of the first board is inside the board clicked; draw it ending against a side"
    )]
    MiddleInside,
    #[error(
        "the first board does not reach the board clicked; move its end against the side it joins"
    )]
    NotReaching,
    #[error("the end of the first board does not land on the board clicked")]
    NotMeeting,
    #[error("the tenon would be as thick as the board it is on or thicker; type a thinner tenon")]
    TenonTooThick,
    #[error("the tenon would be wider than the board it is on; type a narrower tenon")]
    TenonTooWide,
    #[error(
        "the mortise would come out past a side of the board clicked; make the tenon smaller, or move the board"
    )]
    BreaksOut,
    #[error("that would cut all the way through the board clicked; type a shallower depth")]
    TooDeep,
    #[error("sizes must be more than zero")]
    TooSmall,
    #[error("the stop is longer than the joint, so nothing would be left to cut")]
    StopTooLong,
    #[error(
        "the first board sits at the edge of the board clicked, which makes a rabbet, not a dado"
    )]
    AtEdge,
    #[error(
        "the first board sits away from the edges of the board clicked, which makes a dado, not a rabbet"
    )]
    NotAtEdge,
    #[error("a half-lap joins boards lying face to face; these two face different ways")]
    LapFaces,
    #[error(
        "a half-lap needs the two boards drawn overlapping where they cross; they do not overlap"
    )]
    LapApart,
}

/// The board's extent along each of a frame's three axes: `[low, high]`, metres.
type Ranges = [[f64; 2]; 3];

/// A board seen in the clicked board's frame.
struct Board {
    k: ObjectId,
    /// Extent along the frame's axes.
    r: Ranges,
    /// Which frame axis each of the board's own axes (thickness, width, length) runs along.
    map: [usize; 3],
}

fn size(r: &[f64; 2]) -> f64 {
    r[1] - r[0]
}

fn mid(r: &[f64; 2]) -> f64 {
    0.5 * (r[0] + r[1])
}

fn overlap(a: &[f64; 2], b: &[f64; 2]) -> [f64; 2] {
    [a[0].max(b[0]), a[1].min(b[1])]
}

/// A cut box run past every side where it reaches `target`'s outside, so it opens cleanly.
fn opened(target: &Ranges, mut r: Ranges) -> Ranges {
    for i in 0..3 {
        if r[i][0] <= target[i][0] + TOL {
            r[i][0] = r[i][0].min(target[i][0]) - PAST;
        }
        if r[i][1] >= target[i][1] - TOL {
            r[i][1] = r[i][1].max(target[i][1]) + PAST;
        }
    }
    r
}

/// The solid box `r` in the frame `axes` (orthonormal).
fn block(axes: &[DVec3; 3], r: &Ranges) -> Result<Object, KernelError> {
    let [u, v, w] = *axes;
    let n = u.cross(v);
    let up = n.dot(w) > 0.0;
    let base = if up { r[2][0] } else { r[2][1] };
    let plane = Plane {
        origin: u * r[0][0] + v * r[1][0] + w * base,
        normal: n,
        u,
        v,
    };
    let (du, dv) = (size(&r[0]), size(&r[1]));
    let outer = [
        DVec2::ZERO,
        DVec2::new(du, 0.0),
        DVec2::new(du, dv),
        DVec2::new(0.0, dv),
    ];
    Object::extrude(&plane, &outer, &[], size(&r[2])).map_err(KernelError::from)
}

fn failed(e: crate::boolean::BooleanError) -> KernelError {
    PartsError::Failed(e.to_string()).into()
}

/// `o` with the box `r` taken away, refusing a cut that took nothing (it missed).
fn cut(o: &Object, axes: &[DVec3; 3], r: &Ranges) -> Result<Object, KernelError> {
    let b = block(axes, r)?;
    if !boxes_meet(o, &b) {
        return Err(JointError::NotMeeting.into());
    }
    let out = o
        .combine(&b, BoolOp::Difference)
        .map_err(failed)?
        .ok_or(PartsError::RemovesEverything)?;
    if same_volume(out.volume(), o.volume()) {
        return Err(JointError::NotMeeting.into());
    }
    Ok(out)
}

/// The defaults' step and the chisels a mortise is cut with, in the person's units.
fn units(metric: bool) -> (f64, &'static [f64]) {
    const INCH: f64 = 0.0254;
    const INCH_CHISELS: [f64; 11] = [
        INCH / 8.0,
        INCH * 3.0 / 16.0,
        INCH / 4.0,
        INCH * 5.0 / 16.0,
        INCH * 3.0 / 8.0,
        INCH * 7.0 / 16.0,
        INCH / 2.0,
        INCH * 5.0 / 8.0,
        INCH * 3.0 / 4.0,
        INCH * 7.0 / 8.0,
        INCH,
    ];
    const MM_CHISELS: [f64; 13] = [
        0.003, 0.004, 0.005, 0.006, 0.008, 0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.022, 0.025,
    ];
    if metric {
        (0.001, &MM_CHISELS)
    } else {
        (INCH / 16.0, &INCH_CHISELS)
    }
}

/// `x` to the nearest step, at least one step.
fn rounded(x: f64, step: f64) -> f64 {
    ((x / step).round() * step).max(step)
}

/// The chisel nearest a third of `board` that is thinner than it (ties go thinner).
fn chisel_for(board: f64, metric: bool) -> f64 {
    let (step, chisels) = units(metric);
    let want = board / 3.0;
    chisels
        .iter()
        .copied()
        .filter(|&c| c < board - TOL)
        .min_by(|a, b| {
            (a - want)
                .abs()
                .total_cmp(&(b - want).abs())
                .then(a.total_cmp(b))
        })
        .unwrap_or_else(|| rounded(want, step).min(want))
}

fn positive(x: Option<f64>) -> Result<Option<f64>, JointError> {
    match x {
        Some(v) if !(v.is_finite() && v > 0.0) => Err(JointError::TooSmall),
        _ => Ok(x),
    }
}

/// The sizes a joint is made with, as the outcome reports them and the parts remember them.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Made {
    thickness: f64,
    width: f64,
    depth: f64,
    clearance: f64,
    through: bool,
}

/// The cuts one joint makes: what the clicked board loses, and the first board's new shape
/// (`trim` keeps only the part of it outside the shoulder; `add` is the tenon or tongue).
struct Cuts {
    receive: Ranges,
    trim: Option<Ranges>,
    add: Option<Ranges>,
    /// A half-lap's cut of the first board.
    insert_cut: Option<Ranges>,
    made: Made,
}

/// Work out a joint's cuts from the two boards' boxes. Pure: nothing in the model changes.
fn resolve(kind: JointKind, a: &Board, b: &Board, p: &JointParams) -> Result<Cuts, JointError> {
    for v in [p.thickness, p.width, p.depth, p.stop] {
        positive(v)?;
    }
    let clearance = match p.clearance {
        Some(c) if !(c.is_finite() && c >= 0.0) => return Err(JointError::TooSmall),
        c => c.unwrap_or(0.0),
    };
    if kind == JointKind::HalfLap {
        return half_lap(a, b, p);
    }
    // The first board's end goes into a side of the clicked one: its length runs along one
    // of the clicked board's axes, `k`, and that axis cannot be the clicked board's length.
    let k = b.map[2];
    if k == 2 {
        return Err(JointError::EndGrain);
    }
    let (tb, wb) = (b.map[0], b.map[1]);
    // Which side it comes from: the shoulder is that side's face; `inward` points into the
    // clicked board.
    let centre = mid(&b.r[k]);
    let (shoulder, inward) = if centre >= a.r[k][1] - TOL {
        if b.r[k][0] > a.r[k][1] + TOL {
            return Err(JointError::NotReaching);
        }
        (a.r[k][1], -1.0)
    } else if centre <= a.r[k][0] + TOL {
        if b.r[k][1] < a.r[k][0] - TOL {
            return Err(JointError::NotReaching);
        }
        (a.r[k][0], 1.0)
    } else {
        return Err(JointError::MiddleInside);
    };
    for i in [tb, wb] {
        if size(&overlap(&a.r[i], &b.r[i])) <= TOL {
            return Err(JointError::NotMeeting);
        }
    }
    let across = size(&a.r[k]);
    let (step, _) = units(p.metric);
    // `[shoulder, shoulder + inward * d]` in order.
    let into = |d: f64| {
        let far = shoulder + inward * d;
        [shoulder.min(far), shoulder.max(far)]
    };
    let mut receive: Ranges = a.r;
    let mut add: Ranges = b.r;
    let made = match kind {
        JointKind::MortiseTenon => {
            let thick = size(&b.r[tb]);
            let t = match p.thickness {
                Some(t) => t,
                None => chisel_for(thick, p.metric),
            };
            if t >= thick - TOL {
                return Err(JointError::TenonTooThick);
            }
            let wide = size(&b.r[wb]);
            let w = match p.width {
                Some(w) => w,
                // Shoulders as wide as the tenon is thick, the classic proportion.
                None if wide - 2.0 * t > t => wide - 2.0 * t,
                None => wide,
            };
            if w > wide + TOL {
                return Err(JointError::TenonTooWide);
            }
            let through = p.through || p.depth.is_some_and(|d| d >= across - TOL);
            let d = if through {
                across
            } else {
                p.depth
                    .unwrap_or_else(|| rounded(across * 2.0 / 3.0, step).min(across - step))
            };
            if d <= 0.0 {
                return Err(JointError::TooSmall);
            }
            let (ct, cw) = (mid(&b.r[tb]), mid(&b.r[wb]));
            add[tb] = [ct - t / 2.0, ct + t / 2.0];
            add[wb] = [cw - w / 2.0, cw + w / 2.0];
            add[k] = into(d);
            receive[tb] = [ct - (t + clearance) / 2.0, ct + (t + clearance) / 2.0];
            receive[wb] = [cw - (w + clearance) / 2.0, cw + (w + clearance) / 2.0];
            receive[k] = if through { a.r[k] } else { into(d + clearance) };
            for i in [tb, wb] {
                if receive[i][0] < a.r[i][0] - TOL || receive[i][1] > a.r[i][1] + TOL {
                    return Err(JointError::BreaksOut);
                }
            }
            if !through && d + clearance >= across - TOL {
                return Err(JointError::TooDeep);
            }
            Made {
                thickness: t,
                width: w,
                depth: d,
                clearance,
                through,
            }
        }
        JointKind::Dado | JointKind::Rabbet => {
            let at_low = b.r[tb][0] <= a.r[tb][0] + TOL;
            let at_high = b.r[tb][1] >= a.r[tb][1] - TOL;
            match kind {
                JointKind::Dado if at_low || at_high => return Err(JointError::AtEdge),
                JointKind::Rabbet if !(at_low || at_high) => return Err(JointError::NotAtEdge),
                _ => {}
            }
            let d = p.depth.unwrap_or_else(|| {
                let share = if kind == JointKind::Dado { 3.0 } else { 2.0 };
                rounded(across / share, step).min(across - step)
            });
            if d >= across - TOL {
                return Err(JointError::TooDeep);
            }
            // Along the first board's width the joint runs where both boards are, less the stop.
            let mut run = overlap(&a.r[wb], &b.r[wb]);
            if let Some(stop) = p.stop {
                // `near` arrives as a position along the first board's width (its first
                // number; see `Model::make_joint`). Without it the high end stops.
                let high = p
                    .near
                    .is_none_or(|q| (q[0] - run[1]).abs() <= (q[0] - run[0]).abs());
                if stop >= size(&run) - TOL {
                    return Err(JointError::StopTooLong);
                }
                if high {
                    run[1] -= stop;
                } else {
                    run[0] += stop;
                }
            }
            let tongue = overlap(&a.r[tb], &b.r[tb]);
            add[tb] = tongue;
            add[wb] = run;
            add[k] = into(d);
            receive[wb] = run;
            receive[k] = into(d);
            // The clearance widens the groove, on the side away from the edge for a rabbet
            // (the edge side is open anyway).
            let side = |at_edge: bool| {
                if at_edge && kind == JointKind::Rabbet {
                    0.0
                } else {
                    clearance / 2.0
                }
            };
            receive[tb] = [tongue[0] - side(at_low), tongue[1] + side(at_high)];
            Made {
                thickness: size(&tongue),
                width: size(&run),
                depth: d,
                clearance,
                through: false,
            }
        }
        JointKind::HalfLap => unreachable!("handled above"),
    };
    // The first board keeps only what is outside the shoulder.
    let trim = if b.r[k][0] < shoulder - TOL && b.r[k][1] > shoulder + TOL {
        let mut keep = b.r;
        if inward < 0.0 {
            keep[k][0] = shoulder;
        } else {
            keep[k][1] = shoulder;
        }
        Some(keep)
    } else {
        None
    };
    Ok(Cuts {
        receive,
        trim,
        add: Some(add),
        insert_cut: None,
        made,
    })
}

fn half_lap(a: &Board, b: &Board, p: &JointParams) -> Result<Cuts, JointError> {
    // Face to face: the two thicknesses run the same way.
    if b.map[0] != 0 {
        return Err(JointError::LapFaces);
    }
    let o: Ranges = [0, 1, 2].map(|i| overlap(&a.r[i], &b.r[i]));
    if o.iter().any(|r| size(r) <= TOL) {
        return Err(JointError::LapApart);
    }
    let thick = size(&o[0]);
    let d = p.depth.unwrap_or(thick / 2.0);
    if d >= thick - TOL {
        return Err(JointError::TooDeep);
    }
    // The clicked board keeps the bottom (along its thickness axis) unless flipped.
    let (mut ra, mut rb) = (o, o);
    if p.flip {
        ra[0] = [o[0][0], o[0][0] + d];
        rb[0] = [o[0][0] + d, o[0][1]];
    } else {
        ra[0] = [o[0][1] - d, o[0][1]];
        rb[0] = [o[0][0], o[0][1] - d];
    }
    let width = size(&o[1]).min(size(&o[2]));
    Ok(Cuts {
        receive: ra,
        trim: None,
        add: None,
        insert_cut: Some(rb),
        made: Made {
            thickness: thick,
            width,
            depth: d,
            clearance: 0.0,
            through: false,
        },
    })
}

impl Model {
    /// One solid of a part named for a joint (see [`JointError::SeveralSolids`]).
    fn joint_board(
        &self,
        item: Item,
    ) -> Result<(ObjectId, Option<crate::ids::DefId>), KernelError> {
        let kids = self.kids();
        let part = self.editable_part(&kids, item)?;
        let [k] = part.solids[..] else {
            return Err(JointError::SeveralSolids.into());
        };
        let def = part.node.and_then(|n| match self.nodes[n].kind {
            NodeKind::Instance(d) => Some(d),
            NodeKind::Group => None,
        });
        Ok((k, def))
    }

    /// The next joint id: one past the largest any part remembers.
    fn next_joint_id(&self) -> u64 {
        let notes = self
            .objects
            .values()
            .map(|o| &o.part)
            .chain(self.nodes.values().map(|n| &n.part))
            .chain(self.defs.values().map(|d| &d.part));
        notes
            .flat_map(|p| p.joints.iter().map(|j| j.id))
            .max()
            .unwrap_or(0)
            + 1
    }

    /// [`Op::MakeJoint`](crate::model::Op::MakeJoint).
    pub(crate) fn make_joint(
        &mut self,
        kind: JointKind,
        receiving: Item,
        inserting: Item,
        params: &JointParams,
    ) -> Result<OpOutcome, KernelError> {
        let (ka, da) = self.joint_board(receiving)?;
        let (kb, db) = self.joint_board(inserting)?;
        if ka == kb {
            return Err(JointError::SamePart.into());
        }
        if da.is_some() && da == db {
            return Err(JointError::SameComponent.into());
        }
        for k in [ka, kb] {
            crate::limits::count(
                "joints on one part",
                self.objects[k].part.joints.len() + 1,
                MAX_JOINTS_PER_PART,
            )?;
        }
        let box_a = crate::cutlist::solid_box(&self.objects[ka]).ok_or(PartsError::NotASolid)?;
        let box_b = crate::cutlist::solid_box(&self.objects[kb]).ok_or(PartsError::NotASolid)?;
        if box_a.shaped || box_b.shaped {
            return Err(JointError::Shaped.into());
        }
        let axes = box_a.axes.map(DVec3::from_array);
        // A box's extent along the frame: its own axis `j` runs along frame axis `map[j]`.
        let ranges = |c: [f64; 3], s: [f64; 3], map: [usize; 3]| {
            let c = DVec3::from_array(c);
            let mut r = [[0.0; 2]; 3];
            for (j, &i) in map.iter().enumerate() {
                let m = c.dot(axes[i]);
                r[i] = [m - s[j] / 2.0, m + s[j] / 2.0];
            }
            r
        };
        let mut map_b = [0usize; 3];
        for (j, own) in box_b.axes.iter().enumerate() {
            let d = DVec3::from_array(*own);
            map_b[j] = (0..3)
                .find(|&i| d.dot(axes[i]).abs() >= PARALLEL)
                .ok_or(JointError::NotSquare)?;
        }
        let a = Board {
            k: ka,
            r: ranges(box_a.center, box_a.size, [0, 1, 2]),
            map: [0, 1, 2],
        };
        let b = Board {
            k: kb,
            r: ranges(box_b.center, box_b.size, map_b),
            map: map_b,
        };
        // A stopped dado's near point, given as a position along the first board's width.
        let mut p = params.clone();
        if let Some(q) = p.near {
            let along = DVec3::from_array(q).dot(axes[b.map[1]]);
            p.near = Some([along, 0.0, 0.0]);
        }
        let cuts = resolve(kind, &a, &b, &p)?;

        // Work out both new solids before changing anything.
        let new_a = cut(&self.objects[a.k], &axes, &opened(&a.r, cuts.receive))?;
        let mut new_b = self.objects[b.k].clone();
        if let Some(keep) = cuts.trim {
            let keep_box = block(&axes, &opened(&b.r, keep))?;
            new_b = new_b
                .combine(&keep_box, BoolOp::Intersection)
                .map_err(failed)?
                .ok_or(PartsError::RemovesEverything)?;
        }
        if let Some(add) = cuts.add {
            // Reach a hair back into the board so the two overlap rather than only touch.
            // The shoulder is the tenon's end on the first board's side of the clicked one.
            let k = b.map[2];
            let mut reach = add;
            if mid(&b.r[k]) > mid(&a.r[k]) {
                reach[k][1] += PAST;
            } else {
                reach[k][0] -= PAST;
            }
            let tenon = block(&axes, &reach)?;
            new_b = new_b
                .combine(&tenon, BoolOp::Union)
                .map_err(failed)?
                .ok_or_else(|| PartsError::Failed("the result was empty".into()))?;
        }
        if let Some(r) = cuts.insert_cut {
            new_b = cut(&new_b, &axes, &opened(&b.r, r))?;
        }

        let id = self.next_joint_id();
        let m = cuts.made;
        let note = |role| crate::joinery::JointNote {
            id,
            kind,
            role,
            thickness_nm: nm(m.thickness),
            width_nm: nm(m.width),
            depth_nm: nm(m.depth),
            clearance_nm: nm(m.clearance),
            through: m.through,
        };
        let mut objects = Vec::new();
        for (k, mut o, role) in [
            (a.k, new_a, JointRole::Receives),
            (b.k, new_b, JointRole::Inserts),
        ] {
            o.part.joints.push(note(role));
            self.objects[k] = o;
            self.touch(k);
            objects.extend(self.sever(k).into_iter().map(to_public));
        }
        let copies = da.map_or(1, |d| self.instances_of(d).len()) as u32;
        Ok(OpOutcome::JointMade {
            joint: note(JointRole::Receives),
            objects,
            copies,
        })
    }
}
