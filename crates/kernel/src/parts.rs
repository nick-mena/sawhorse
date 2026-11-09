//! Adding parts together and cutting one part with another.
//!
//! The joinery case sets the rules: a tenon cuts its mortise and is still there afterwards,
//! so a cut leaves the cutter alone. An add makes one part of several, so what was added
//! goes away and the first part keeps its name, number and place in the tree.
//!
//! A part is a solid directly in the open context, or a group or component there that holds
//! solids directly. A component shared by several copies is made unique before it changes:
//! a cut aimed at one leg must not reach the other three. Cutters are only read, so they can
//! be anything that holds solids, nested groups included.

use crate::boolean::{BoolOp, BooleanError};
use crate::error::{KernelError, PartsError, StructureError};
use crate::ids::{NodeId, ObjectId, from_public, to_public};
use crate::limits::MAX_PARTS_COMBINED;
use crate::model::{Model, OpOutcome};
use crate::nodes::{Item, Kids, NodeKind, Thing};
use crate::object::Object;
use crate::tolerance::{AREA_EPS, POINT_MERGE};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[serde(rename_all = "snake_case")]
pub enum PartsOp {
    /// `with` is joined into `target` and goes away.
    Add,
    /// `with` is taken out of `target` and stays where it is.
    Cut,
}

/// A part the op will change: its solids, and the node they are in when it was named as a
/// group or component.
struct Part {
    solids: Vec<ObjectId>,
    node: Option<NodeId>,
}

/// Two volumes that differ by less than arithmetic noise: the operand was not reached.
fn same_volume(a: f64, b: f64) -> bool {
    (a - b).abs() <= (1e-12 * a.abs().max(b.abs())).max(AREA_EPS * POINT_MERGE)
}

fn boxes_meet(a: &Object, b: &Object) -> bool {
    let ((a0, a1), (b0, b1)) = (a.bounds(), b.bounds());
    a0.cmple(b1).all() && b0.cmple(a1).all()
}

fn failed(e: BooleanError) -> KernelError {
    PartsError::Failed(e.to_string()).into()
}

impl Model {
    /// The solids of a part that will be edited (see the module docs).
    fn editable_part(&self, kids: &Kids, item: Item) -> Result<Part, KernelError> {
        match item {
            Item::Object(id) => {
                let k = from_public::<ObjectId>(id);
                if !self.objects.contains_key(k) {
                    return Err(PartsError::NotASolid.into());
                }
                self.editable_object(k)?;
                Ok(Part {
                    solids: vec![k],
                    node: None,
                })
            }
            Item::Node(id) => {
                let n = self.node_key(id)?;
                self.editable_node(n)?;
                let mut solids = Vec::new();
                for &t in kids.things.get(&Some(n)).map_or(&[][..], Vec::as_slice) {
                    match t {
                        Thing::Object(k) => {
                            if self.objects[k].member.locked {
                                return Err(StructureError::Locked.into());
                            }
                            solids.push(k);
                        }
                        Thing::Node(_) => return Err(PartsError::NestedGroups.into()),
                        Thing::Mesh(_) => {}
                    }
                }
                if solids.is_empty() {
                    return Err(PartsError::NotASolid.into());
                }
                Ok(Part {
                    solids,
                    node: Some(n),
                })
            }
        }
    }

    /// Every solid an item holds, at any depth, for reading.
    fn solids_of(&self, kids: &Kids, item: Item) -> Result<Vec<ObjectId>, KernelError> {
        let found = match self.things(&[item])?[0] {
            Thing::Object(k) => vec![k],
            Thing::Mesh(_) => Vec::new(),
            Thing::Node(n) => self
                .subtree_things(kids, n)
                .into_iter()
                .filter_map(|t| match t {
                    Thing::Object(k) => Some(k),
                    _ => None,
                })
                .collect(),
        };
        if found.is_empty() {
            return Err(PartsError::NotASolid.into());
        }
        Ok(found)
    }

    /// True when the part's component is shared and was given its own definition.
    fn unshare(&mut self, part: &Part) -> bool {
        let Some(n) = part.node else { return false };
        let NodeKind::Instance(d) = self.nodes[n].kind else {
            return false;
        };
        if self.instances_of(d).len() < 2 {
            return false;
        }
        self.fork(n);
        true
    }

    /// [`Op::CombineParts`](crate::model::Op::CombineParts).
    pub(crate) fn combine_parts(
        &mut self,
        target: Item,
        with: &[Item],
        how: PartsOp,
    ) -> Result<OpOutcome, KernelError> {
        if with.is_empty() {
            return Err(StructureError::NothingSelected.into());
        }
        crate::limits::count("parts", with.len(), MAX_PARTS_COMBINED)?;
        let kids = self.kids();
        let part = self.editable_part(&kids, target)?;
        match how {
            PartsOp::Cut => self.cut_part(&kids, part, with),
            PartsOp::Add => self.add_parts(&kids, part, with),
        }
    }

    fn cut_part(
        &mut self,
        kids: &Kids,
        part: Part,
        with: &[Item],
    ) -> Result<OpOutcome, KernelError> {
        let mut cutters = Vec::new();
        for &item in with {
            for k in self.solids_of(kids, item)? {
                if part.solids.contains(&k) {
                    return Err(PartsError::SamePart.into());
                }
                if !cutters.contains(&k) {
                    cutters.push(k);
                }
            }
            crate::limits::count("parts", cutters.len(), MAX_PARTS_COMBINED)?;
        }
        let mut results = Vec::new();
        for &k in &part.solids {
            let mut now = self.objects[k].clone();
            let mut changed = false;
            for &c in &cutters {
                let cutter = &self.objects[c];
                if !boxes_meet(&now, cutter) {
                    continue;
                }
                let next = now
                    .combine(cutter, BoolOp::Difference)
                    .map_err(failed)?
                    .ok_or(PartsError::RemovesEverything)?;
                // A cutter that only rests against the part changes nothing: the part keeps
                // its faces as they were rather than taking on the engine's re-meshing.
                if !same_volume(next.volume(), now.volume()) {
                    now = next;
                    changed = true;
                }
            }
            if changed {
                results.push((k, now));
            }
        }
        if results.is_empty() {
            return Err(PartsError::NoOverlap.into());
        }
        let unique = self.unshare(&part);
        let mut objects = Vec::new();
        for (k, o) in results {
            self.objects[k] = o;
            self.touch(k);
            objects.extend(self.sever(k).into_iter().map(to_public));
        }
        Ok(OpOutcome::PartsCombined { objects, unique })
    }

    fn add_parts(
        &mut self,
        kids: &Kids,
        part: Part,
        with: &[Item],
    ) -> Result<OpOutcome, KernelError> {
        let [into] = part.solids[..] else {
            return Err(PartsError::SeveralSolids.into());
        };
        let mut now = self.objects[into].clone();
        let mut gone = Vec::new();
        let mut added = 0;
        for &item in with {
            let other = self.editable_part(kids, item)?;
            added += other.solids.len();
            crate::limits::count("parts", added, MAX_PARTS_COMBINED)?;
            if other.solids.contains(&into) {
                return Err(PartsError::SamePart.into());
            }
            for &k in &other.solids {
                now = now
                    .combine(&self.objects[k], BoolOp::Union)
                    .map_err(failed)?
                    .ok_or_else(|| PartsError::Failed("the result was empty".into()))?;
            }
            let thing = other
                .node
                .map_or(Thing::Object(other.solids[0]), Thing::Node);
            if !gone.contains(&thing) {
                gone.push(thing);
            }
        }
        // Checked once every part is in: the third part may be what bridges the first two.
        if now.piece_count() > 1 {
            return Err(PartsError::NotTouching.into());
        }
        let unique = self.unshare(&part);
        for t in gone {
            let parent = self.membership(t).expect("resolved").parent;
            self.remove_thing(kids, t);
            self.mark(parent);
        }
        self.objects[into] = now;
        self.touch(into);
        Ok(OpOutcome::PartsCombined {
            objects: vec![to_public(into)],
            unique,
        })
    }
}
