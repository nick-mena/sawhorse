//! A part made straight from a closed outline and its holes (the CNC workspace, ADR-0014),
//! and the drawings that outline came from.
//!
//! The Draw and Extrude ops go through a sketch, whose insertion rules merge a stroke with
//! whatever already lies on that plane. A part brought in from a drawing must not pick up
//! lines from the ground sketch, and its curved walls must be smooth where the drawing says
//! so, which the sketch tier has no way to be told. So this op checks the outline itself and
//! builds the solid directly. An op log is untrusted input, so nothing here relies on the
//! window having checked first.

use glam::{DVec2, DVec3};

use crate::error::{KernelError, SketchError};
use crate::object::Object;
use crate::plane::Plane;
use crate::tolerance::{AREA_EPS, PLANARITY, SKETCH_MERGE, in_bounds};

/// Most points in one part, every ring counted.
pub const MAX_PROFILE_POINTS: usize = 50_000;
/// Most drawings in a document.
pub const MAX_CNC_DRAWINGS: usize = 256;
/// Largest drawing, bytes of JSON. Pixels are kept apart, as a texture.
pub const MAX_CNC_DRAWING: usize = 512 * 1024;
/// All of a document's drawings: every answer to the window carries them.
pub const MAX_CNC_TOTAL: usize = 2 * 1024 * 1024;

/// One closed ring of an [`crate::model::Op::ExtrudeProfile`].
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
pub struct ProfileRing {
    /// World points on the plane; the last joins the first and is not repeated.
    pub points: Vec<[f64; 3]>,
    /// Indices of the points where the walls on either side blend (a curve, not a corner).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub smooth: Vec<u32>,
}

fn bad(why: &'static str) -> KernelError {
    SketchError::BadProfile(why).into()
}

fn signed_area(r: &[DVec2]) -> f64 {
    let n = r.len();
    (0..n).map(|i| r[i].perp_dot(r[(i + 1) % n])).sum::<f64>() / 2.0
}

fn point_segment(p: DVec2, a: DVec2, b: DVec2) -> f64 {
    let d = b - a;
    let l = d.length_squared();
    let t = if l > 0.0 {
        ((p - a).dot(d) / l).clamp(0.0, 1.0)
    } else {
        0.0
    };
    p.distance(a + d * t)
}

fn segments_near(a: DVec2, b: DVec2, c: DVec2, d: DVec2) -> bool {
    let side = |p: DVec2, q: DVec2, r: DVec2| (q - p).perp_dot(r - p);
    let crosses = side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0;
    crosses
        || point_segment(a, c, d) <= SKETCH_MERGE
        || point_segment(b, c, d) <= SKETCH_MERGE
        || point_segment(c, a, b) <= SKETCH_MERGE
        || point_segment(d, a, b) <= SKETCH_MERGE
}

fn inside(p: DVec2, ring: &[DVec2]) -> bool {
    let n = ring.len();
    let mut odd = false;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            odd = !odd;
        }
    }
    odd
}

struct Seg {
    a: DVec2,
    b: DVec2,
    ring: usize,
    index: usize,
    len: usize,
    lo: DVec2,
    hi: DVec2,
}

/// No ring crosses or touches itself or another ring. Sorted along x, so only segments that
/// overlap in x are compared.
fn check_apart(rings: &[Vec<DVec2>]) -> Result<(), KernelError> {
    let mut segs: Vec<Seg> = Vec::new();
    for (ring, r) in rings.iter().enumerate() {
        for index in 0..r.len() {
            let (a, b) = (r[index], r[(index + 1) % r.len()]);
            segs.push(Seg {
                a,
                b,
                ring,
                index,
                len: r.len(),
                lo: a.min(b),
                hi: a.max(b),
            });
        }
    }
    segs.sort_by(|p, q| p.lo.x.total_cmp(&q.lo.x));
    for (i, s) in segs.iter().enumerate() {
        for t in &segs[i + 1..] {
            if t.lo.x > s.hi.x + SKETCH_MERGE {
                break;
            }
            if t.lo.y > s.hi.y + SKETCH_MERGE || s.lo.y > t.hi.y + SKETCH_MERGE {
                continue;
            }
            if s.ring == t.ring {
                let (first, second) = if (s.index + 1) % s.len == t.index {
                    (s, t)
                } else if (t.index + 1) % t.len == s.index {
                    (t, s)
                } else {
                    if segments_near(s.a, s.b, t.a, t.b) {
                        return Err(bad("That outline crosses or touches itself."));
                    }
                    continue;
                };
                // Neighbours share a point, and only a stroke that doubles back meets again.
                if point_segment(first.a, second.a, second.b) <= SKETCH_MERGE
                    || point_segment(second.b, first.a, first.b) <= SKETCH_MERGE
                {
                    return Err(bad("That outline doubles back on itself."));
                }
            } else if segments_near(s.a, s.b, t.a, t.b) {
                return Err(bad(
                    "A hole crosses or touches the outline or another hole.",
                ));
            }
        }
    }
    Ok(())
}

/// The solid for `rings` (the first is the outline, the rest its holes).
pub(crate) fn extrude_profile(
    origin: &[f64; 3],
    normal: &[f64; 3],
    rings: &[ProfileRing],
    distance: f64,
) -> Result<Object, KernelError> {
    let plane = Plane::new(DVec3::from_array(*origin), DVec3::from_array(*normal))
        .map_err(SketchError::from)?;
    if rings.is_empty() {
        return Err(bad("A part needs an outline."));
    }
    if rings.iter().map(|r| r.points.len()).sum::<usize>() > MAX_PROFILE_POINTS {
        return Err(bad(
            "That outline has more points than a part can hold (50,000).",
        ));
    }
    let mut local: Vec<Vec<DVec2>> = Vec::with_capacity(rings.len());
    let mut smooth: Vec<Vec<u32>> = Vec::with_capacity(rings.len());
    for ring in rings {
        if ring.points.len() < 3 {
            return Err(bad("An outline needs at least three points."));
        }
        let mut q = Vec::with_capacity(ring.points.len());
        for p in &ring.points {
            if !p.iter().all(|&v| in_bounds(v)) {
                return Err(SketchError::OutOfBounds.into());
            }
            let w = DVec3::from_array(*p);
            if plane.signed_distance(w).abs() > PLANARITY {
                return Err(SketchError::OffPlane.into());
            }
            q.push(plane.to_local(w));
        }
        let n = q.len();
        if (0..n).any(|i| q[i].distance(q[(i + 1) % n]) <= SKETCH_MERGE) {
            return Err(bad("Two points of the outline are closer than 0.01 mm."));
        }
        if ring.smooth.iter().any(|&i| i as usize >= n) {
            return Err(bad(
                "A smooth point of the outline is not one of its points.",
            ));
        }
        local.push(q);
    }
    // Crossings first: a figure eight can enclose no area at all, and that is not "too small".
    check_apart(&local)?;
    for (k, ring) in rings.iter().enumerate() {
        let q = &mut local[k];
        let n = q.len();
        let area = signed_area(q);
        if area.abs() <= AREA_EPS {
            return Err(SketchError::Degenerate.into());
        }
        let mut soft = ring.smooth.clone();
        // Object::extrude wants the outline counter-clockwise and the holes clockwise, and
        // numbers the walls in that order: settle it here so the indices follow.
        if (area > 0.0) != (k == 0) {
            q.reverse();
            for i in &mut soft {
                *i = n as u32 - 1 - *i;
            }
        }
        smooth.push(soft);
    }
    for (k, hole) in local.iter().enumerate().skip(1) {
        if !inside(hole[0], &local[0]) {
            return Err(bad("A hole lies outside the outline."));
        }
        if local
            .iter()
            .enumerate()
            .skip(1)
            .any(|(j, other)| j != k && inside(hole[0], other))
        {
            return Err(bad("One hole lies inside another."));
        }
    }
    let mut obj = Object::extrude(&plane, &local[0], &local[1..], distance)?;
    let mut wall = 3u64;
    for (ring, soft) in local.iter().zip(&smooth) {
        let n = ring.len() as u64;
        for &i in soft {
            let i = u64::from(i);
            let key = crate::edges::pair(wall + (i + n - 1) % n, wall + i);
            obj.set_edge_flags(key, crate::edges::SOFT | crate::edges::SMOOTH, 0);
        }
        wall += n;
    }
    obj.settle_edges();
    Ok(obj)
}

/// A drawing may be stored: the kernel keeps its JSON and does not read it.
pub(crate) fn check_drawing(
    id: u64,
    json: &str,
    others: impl Iterator<Item = usize>,
    count: usize,
) -> Result<(), KernelError> {
    if id == 0 || id > (1 << 53) - 1 {
        return Err(bad("That drawing has no usable number."));
    }
    if json.len() > MAX_CNC_DRAWING {
        return Err(bad(
            "That drawing is larger than a model can keep (512 KB).",
        ));
    }
    if count >= MAX_CNC_DRAWINGS {
        return Err(bad("A model can keep 256 drawings. Delete one first."));
    }
    if others.sum::<usize>() + json.len() > MAX_CNC_TOTAL {
        return Err(bad(
            "This model's drawings have reached the 2 MB they can share. Delete one first.",
        ));
    }
    Ok(())
}
