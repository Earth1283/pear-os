use rapier2d::prelude::*;
use std::{cell::RefCell, collections::BTreeMap};

const PIXELS_PER_METER: f32 = 100.0;
const FIXED_TIMESTEP: f32 = 1.0 / 120.0;
const MAX_CATCHUP_STEPS: usize = 8;

struct WindowBody {
    handle: RigidBodyHandle,
    collider: ColliderHandle,
    width: f32,
    height: f32,
}

struct Grab {
    id: u32,
    pointer: RigidBodyHandle,
    joint: ImpulseJointHandle,
    target: Vector,
}

struct DesktopGravity {
    world: PhysicsWorld,
    windows: BTreeMap<u32, WindowBody>,
    walls: Vec<ColliderHandle>,
    grab: Option<Grab>,
    bounds: [f32; 4],
    scale: f32,
    upright: bool,
    accumulator: f32,
    output: Vec<f32>,
}

impl DesktopGravity {
    fn new() -> Self {
        let mut world = PhysicsWorld::new();
        world.gravity = Vector::new(0.0, 14.0);
        world.integration_parameters.dt = FIXED_TIMESTEP;
        Self {
            world,
            windows: BTreeMap::new(),
            walls: Vec::new(),
            grab: None,
            bounds: [0.0, 0.26, 14.4, 8.14],
            scale: 1.0,
            upright: false,
            accumulator: 0.0,
            output: Vec::new(),
        }
    }

    fn set_bounds(&mut self, width: f32, height: f32, top: f32, bottom: f32) {
        if ![width, height, top, bottom].iter().all(|n| n.is_finite()) {
            return;
        }
        let right = width.max(120.0) / PIXELS_PER_METER;
        let top = top.max(0.0) / PIXELS_PER_METER;
        let floor = ((height - bottom) / PIXELS_PER_METER).max(top + 1.0);
        self.bounds = [0.0, top, right, floor];
        for wall in self.walls.drain(..) {
            self.world.remove_collider(wall);
        }
        let thickness = 20.0;
        for (x, y, w, h) in [
            (
                -thickness,
                (floor + top) / 2.0,
                thickness,
                floor - top + thickness,
            ),
            (
                right + thickness,
                (floor + top) / 2.0,
                thickness,
                floor - top + thickness,
            ),
            (right / 2.0, top - thickness, right + thickness, thickness),
            (right / 2.0, floor + thickness, right + thickness, thickness),
        ] {
            self.walls.push(
                self.world.insert_collider(
                    ColliderBuilder::cuboid(w, h)
                        .translation(Vector::new(x, y))
                        .friction(0.65)
                        .restitution(0.18),
                    None,
                ),
            );
        }
        self.fit_windows_to_desktop();
        self.contain_rotated_windows();
    }

    fn fit_windows_to_desktop(&mut self) {
        let [left, top, right, bottom] = self.bounds;
        let area: f32 = self.windows.values().map(|w| w.width * w.height).sum();
        let mut scale = if area > 0.0 {
            ((right - left) * (bottom - top) * 0.48 / area)
                .sqrt()
                .min(1.0)
        } else {
            1.0
        };
        for w in self.windows.values() {
            // Leave enough room for a window to rotate without getting wedged between walls.
            scale = scale.min(0.9 * (right - left).min(bottom - top) / w.width.hypot(w.height));
        }
        if (scale - self.scale).abs() < 0.0001 {
            return;
        }
        self.release();
        self.scale = scale.max(0.01);
        for w in self.windows.values() {
            self.world.colliders[w.collider].set_shape(SharedShape::cuboid(
                w.width * self.scale / 2.0,
                w.height * self.scale / 2.0,
            ));
            let body = &mut self.world.bodies[w.handle];
            body.recompute_mass_properties_from_colliders(&self.world.colliders);
            body.wake_up(true);
        }
    }

    fn upsert_window(&mut self, id: u32, x: f32, y: f32, width: f32, height: f32, angle: f32) {
        if id == 0
            || ![x, y, width, height, angle].iter().all(|n| n.is_finite())
            || width <= 0.0
            || height <= 0.0
        {
            return;
        }
        self.remove_window(id);
        let (w, h) = (width / PIXELS_PER_METER, height / PIXELS_PER_METER);
        let (handle, collider) = self.world.insert(
            RigidBodyBuilder::dynamic()
                .translation(Vector::new(
                    (x + width / 2.0) / PIXELS_PER_METER,
                    (y + height / 2.0) / PIXELS_PER_METER,
                ))
                .rotation(if self.upright { 0.0 } else { angle })
                .linear_damping(0.35)
                .angular_damping(0.65)
                .ccd_enabled(true),
            ColliderBuilder::cuboid(w * self.scale / 2.0, h * self.scale / 2.0)
                .density(1.0)
                .friction(0.65)
                .restitution(0.22),
        );
        if self.upright {
            self.world.bodies[handle].lock_rotations(true, true);
        }
        self.windows.insert(
            id,
            WindowBody {
                handle,
                collider,
                width: w,
                height: h,
            },
        );
        self.fit_windows_to_desktop();
        self.contain_rotated_windows();
    }

    fn remove_window(&mut self, id: u32) {
        if self.grab.as_ref().is_some_and(|g| g.id == id) {
            self.release();
        }
        if let Some(w) = self.windows.remove(&id) {
            self.world.remove_body(w.handle);
        }
    }

    fn upright(&mut self, upright: bool) {
        self.upright = upright;
        for w in self.windows.values() {
            let body = &mut self.world.bodies[w.handle];
            if upright {
                body.set_rotation(Rotation::from_angle(0.0), true);
                body.set_angvel(0.0, true);
            }
            body.lock_rotations(upright, true);
        }
        self.contain_rotated_windows();
    }

    fn grab(&mut self, id: u32, x: f32, y: f32) -> bool {
        self.release();
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        let Some(w) = self.windows.get(&id) else {
            return false;
        };
        let target = Vector::new(x / PIXELS_PER_METER, y / PIXELS_PER_METER);
        let local = self.world.bodies[w.handle]
            .position()
            .inverse_transform_point(target);
        let pointer = self
            .world
            .insert_body(RigidBodyBuilder::kinematic_position_based().translation(target));
        let joint = self.world.insert_impulse_joint(
            pointer,
            w.handle,
            RevoluteJointBuilder::new()
                .local_anchor2(local)
                .contacts_enabled(false),
        );
        self.grab = Some(Grab {
            id,
            pointer,
            joint,
            target,
        });
        true
    }

    fn pointer(&mut self, x: f32, y: f32) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        if let Some(g) = &mut self.grab {
            let [left, top, right, bottom] = self.bounds;
            g.target = Vector::new(
                (x / PIXELS_PER_METER).clamp(left, right),
                (y / PIXELS_PER_METER).clamp(top, bottom),
            );
        }
    }

    fn release(&mut self) {
        if let Some(g) = self.grab.take() {
            self.world.remove_impulse_joint(g.joint);
            self.world.remove_body(g.pointer);
        }
    }

    fn contain_rotated_windows(&mut self) {
        let [left, top, right, bottom] = self.bounds;
        for w in self.windows.values() {
            let body = &mut self.world.bodies[w.handle];
            let a = body.rotation().angle();
            let (sin, cos) = a.sin_cos();
            let hx = (cos.abs() * w.width + sin.abs() * w.height) * self.scale / 2.0;
            let hy = (sin.abs() * w.width + cos.abs() * w.height) * self.scale / 2.0;
            let p = body.translation();
            let bounded = Vector::new(
                p.x.clamp(left + hx, (right - hx).max(left + hx)),
                p.y.clamp(top + hy, (bottom - hy).max(top + hy)),
            );
            if (p - bounded).length_squared() > 0.000001 {
                body.set_translation(bounded, true);
            }
        }
    }

    fn advance(&mut self, elapsed: f32) -> usize {
        if !elapsed.is_finite() || elapsed < 0.0 {
            return 0;
        }
        self.accumulator += elapsed.min(FIXED_TIMESTEP * MAX_CATCHUP_STEPS as f32);
        let mut steps = 0;
        while self.accumulator + 1.0e-7 >= FIXED_TIMESTEP && steps < MAX_CATCHUP_STEPS {
            if let Some(g) = &self.grab {
                let pointer = &mut self.world.bodies[g.pointer];
                let delta = g.target - pointer.translation();
                let next = pointer.translation() + delta.clamp_length_max(35.0 * FIXED_TIMESTEP);
                pointer.set_next_kinematic_translation(next);
            }
            self.world.step();
            self.accumulator = (self.accumulator - FIXED_TIMESTEP).max(0.0);
            steps += 1;
        }
        self.contain_rotated_windows();
        self.write_output();
        steps
    }

    fn write_output(&mut self) {
        self.output.clear();
        for (&id, w) in &self.windows {
            let body = &self.world.bodies[w.handle];
            let p = body.translation();
            self.output.extend_from_slice(&[
                id as f32,
                p.x * PIXELS_PER_METER - w.width * PIXELS_PER_METER / 2.0,
                p.y * PIXELS_PER_METER - w.height * PIXELS_PER_METER / 2.0,
                body.rotation().angle(),
                self.scale,
                if body.is_sleeping() { 1.0 } else { 0.0 },
            ]);
        }
    }

    fn active(&self) -> bool {
        self.grab.is_some()
            || self
                .windows
                .values()
                .any(|w| !self.world.bodies[w.handle].is_sleeping())
    }
}

thread_local! { static GRAVITY: RefCell<DesktopGravity> = RefCell::new(DesktopGravity::new()); }

#[no_mangle]
pub extern "C" fn gravity_reset() {
    GRAVITY.with(|g| *g.borrow_mut() = DesktopGravity::new());
}
#[no_mangle]
pub extern "C" fn gravity_bounds(width: f32, height: f32, top: f32, bottom: f32) {
    GRAVITY.with(|g| g.borrow_mut().set_bounds(width, height, top, bottom));
}
#[no_mangle]
pub extern "C" fn gravity_put(id: u32, x: f32, y: f32, w: f32, h: f32, angle: f32) {
    GRAVITY.with(|g| g.borrow_mut().upsert_window(id, x, y, w, h, angle));
}
#[no_mangle]
pub extern "C" fn gravity_remove(id: u32) {
    GRAVITY.with(|g| {
        let mut g = g.borrow_mut();
        g.remove_window(id);
        g.fit_windows_to_desktop();
    });
}
#[no_mangle]
pub extern "C" fn gravity_upright(on: u32) {
    GRAVITY.with(|g| g.borrow_mut().upright(on != 0));
}
#[no_mangle]
pub extern "C" fn gravity_grab(id: u32, x: f32, y: f32) -> u32 {
    GRAVITY.with(|g| g.borrow_mut().grab(id, x, y) as u32)
}
#[no_mangle]
pub extern "C" fn gravity_pointer(x: f32, y: f32) {
    GRAVITY.with(|g| g.borrow_mut().pointer(x, y));
}
#[no_mangle]
pub extern "C" fn gravity_release() {
    GRAVITY.with(|g| g.borrow_mut().release());
}
#[no_mangle]
pub extern "C" fn gravity_step(elapsed: f32) -> u32 {
    GRAVITY.with(|g| {
        let mut g = g.borrow_mut();
        g.advance(elapsed);
        g.active() as u32
    })
}
#[no_mangle]
pub extern "C" fn gravity_poses_ptr() -> *const f32 {
    GRAVITY.with(|g| g.borrow().output.as_ptr())
}
#[no_mangle]
pub extern "C" fn gravity_poses_len() -> usize {
    GRAVITY.with(|g| g.borrow().output.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene() -> DesktopGravity {
        let mut g = DesktopGravity::new();
        g.set_bounds(1440.0, 900.0, 26.0, 86.0);
        g
    }

    #[test]
    fn falling_windows_land_and_sleep() {
        let mut g = scene();
        g.upsert_window(1, 200.0, 80.0, 300.0, 200.0, 0.0);
        for _ in 0..2400 {
            g.advance(FIXED_TIMESTEP);
        }
        let w = &g.windows[&1];
        let body = &g.world.bodies[w.handle];
        assert!((body.translation().y + w.height * g.scale / 2.0 - g.bounds[3]).abs() < 0.03);
        assert!(body.is_sleeping());
        assert!(!g.active());
    }

    #[test]
    fn windows_stack_without_passing_through_each_other() {
        let mut g = scene();
        g.upsert_window(1, 400.0, 500.0, 300.0, 150.0, 0.0);
        g.upsert_window(2, 400.0, 100.0, 300.0, 150.0, 0.0);
        for _ in 0..2400 {
            g.advance(FIXED_TIMESTEP);
        }
        let a = g.world.bodies[g.windows[&1].handle].translation();
        let b = g.world.bodies[g.windows[&2].handle].translation();
        assert!((a.y - b.y).abs() > 1.4 * g.scale);
        assert!(!g.active(), "a resting stack should sleep");
    }

    #[test]
    fn off_center_grab_swings_and_release_preserves_momentum() {
        let mut g = scene();
        g.upsert_window(1, 300.0, 150.0, 300.0, 200.0, 0.0);
        assert!(g.grab(1, 315.0, 160.0));
        g.pointer(850.0, 180.0);
        for _ in 0..30 {
            g.advance(FIXED_TIMESTEP);
        }
        let body = &g.world.bodies[g.windows[&1].handle];
        assert!(body.rotation().angle().abs() > 0.1);
        assert!(body.linvel().length() > 0.1);
        g.release();
        assert!(g.grab.is_none());
        assert!(g.world.bodies[g.windows[&1].handle].linvel().length() > 0.1);
        for _ in 0..600 {
            g.advance(FIXED_TIMESTEP);
        }
        assert!(g.output.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn elapsed_time_is_fixed_step_and_catchup_is_bounded() {
        let mut a = scene();
        let mut b = scene();
        a.upsert_window(1, 100.0, 100.0, 300.0, 200.0, 0.0);
        b.upsert_window(1, 100.0, 100.0, 300.0, 200.0, 0.0);
        for _ in 0..60 {
            a.advance(1.0 / 60.0);
        }
        for _ in 0..120 {
            b.advance(FIXED_TIMESTEP);
        }
        assert_eq!(a.output, b.output);
        assert_eq!(a.advance(3600.0), MAX_CATCHUP_STEPS);
        assert_eq!(a.advance(f32::NAN), 0);
    }

    #[test]
    fn crowded_desktop_fits_and_resize_contains_rotated_corners() {
        let mut g = scene();
        for id in 1..=8 {
            g.upsert_window(id, 100.0 * id as f32, 100.0, 860.0, 540.0, 0.3);
        }
        assert!(g.scale < 0.6);
        g.set_bounds(390.0, 844.0, 26.0, 86.0);
        for _ in 0..1200 {
            g.advance(FIXED_TIMESTEP);
        }
        for w in g.windows.values() {
            let b = &g.world.bodies[w.handle];
            let aabb = g.world.colliders[w.collider].compute_aabb();
            assert!(b.translation().is_finite());
            assert!(aabb.mins.x >= -0.02 && aabb.maxs.x <= 3.92);
            assert!(aabb.mins.y >= 0.24 && aabb.maxs.y <= 7.60);
        }
    }

    #[test]
    fn upright_and_removing_a_grabbed_window_clean_up() {
        let mut g = scene();
        g.upsert_window(1, 100.0, 100.0, 300.0, 200.0, 0.4);
        g.upright(true);
        assert!(g.grab(1, 150.0, 120.0));
        g.pointer(700.0, 150.0);
        for _ in 0..60 {
            g.advance(FIXED_TIMESTEP);
        }
        assert!(
            g.world.bodies[g.windows[&1].handle]
                .rotation()
                .angle()
                .abs()
                < 0.001
        );
        g.remove_window(1);
        assert!(g.grab.is_none());
        assert!(g.world.bodies.is_empty());
        assert!(!g.grab(999, 10.0, 10.0));
    }
}
