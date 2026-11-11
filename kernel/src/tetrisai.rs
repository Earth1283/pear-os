//! A Tetris agent that learns by playing itself, inside the kernel.
//!
//! The agent works at the placement level: for the piece in hand it lists every (rotation, column) it
//! could drop it in, scores the resulting board with a weighted sum of board features (holes, bumpiness,
//! heights, transitions, wells, lines cleared), and plays the best. What it learns are the weights.
//!
//! Learning is the cross-entropy method, a policy-search flavour of reinforcement learning: each
//! generation it draws a population of weight vectors from a Gaussian, scores every one by playing the
//! same piece sequences, keeps the best quarter, and refits the Gaussian to them. The mean of that
//! Gaussian is "the agent". The board rules (shapes, rotation order, row clears) mirror
//! `src/lib/tetris.ts`, so a placement chosen here can be played in the real game by rotating,
//! shifting and dropping.

use std::cell::RefCell;
use std::sync::OnceLock;

const W: usize = 10;
const H: usize = 22;
/// Top rows of the board are the spawn area. A piece that would rest in them is a lost game.
const HIDDEN: usize = 2;
const FULL: u16 = (1 << W) - 1;

/// Features per board; the policy is one weight per feature.
const NF: usize = 8;
/// theta = [mean weights (NF), standard deviations (NF)]
const N_THETA: usize = 2 * NF;
const POP: usize = 12;
const ELITE: usize = 3;
/// How far each generation moves the distribution toward its elite (1 = jump all the way).
const SMOOTH: f32 = 0.07;
const GAMES: usize = 2;
/// A training game ends after this many pieces, which caps lines at about 4 * CAP / 10.
const CAP: u32 = 400;
const EVAL_CAP: u32 = 1_000;
const EVAL_GAMES: usize = 2;
/// An evaluation of the mean policy clearing at least this many lines, twice running, counts as solved.
const MASTER_LINES: f32 = 340.0;
const MASTER_STREAK: u32 = 2;

type Board = [u16; H];
type Feat = [f32; NF];

const SHAPES: [&[&str]; 7] = [
    &["....", "XXXX", "....", "...."],
    &["XX", "XX"],
    &[".X.", "XXX", "..."],
    &[".XX", "XX.", "..."],
    &["XX.", ".XX", "..."],
    &["X..", "XXX", "..."],
    &["..X", "XXX", "..."],
];
/// Distinct rotations per piece, in the same order the game turns them (I, O, T, S, Z, J, L).
const ROT_COUNT: [usize; 7] = [2, 1, 4, 2, 2, 4, 4];

type Cells = [(i8, i8); 4];

fn rot_table() -> &'static [[Cells; 4]; 7] {
    static T: OnceLock<[[Cells; 4]; 7]> = OnceLock::new();
    T.get_or_init(|| {
        let mut out = [[[(0i8, 0i8); 4]; 4]; 7];
        for (k, shape) in SHAPES.iter().enumerate() {
            let mut m: Vec<Vec<u8>> = shape.iter().map(|r| r.bytes().collect()).collect();
            let n = m.len();
            for rot in 0..4 {
                let mut i = 0;
                for (y, row) in m.iter().enumerate() {
                    for (x, ch) in row.iter().enumerate() {
                        if *ch == b'X' {
                            out[k][rot][i] = (x as i8, y as i8);
                            i += 1;
                        }
                    }
                }
                let prev = m.clone();
                for r in 0..n {
                    for c in 0..n {
                        m[r][c] = prev[n - 1 - c][r];
                    }
                }
            }
        }
        out
    })
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() >> 33) as usize % n.max(1)
    }
    /// Roughly standard normal (sum of uniforms), good enough for weight initialisation.
    fn gauss(&mut self) -> f32 {
        (0..6).map(|_| self.unit()).sum::<f32>() * 2.0 - 6.0
    }
}

#[derive(Clone, Copy)]
struct Cand {
    rot: u8,
    x: u8,
    board: Board,
    feat: Feat,
    lines: u8,
}

fn collides(b: &Board, cells: &Cells, dx: i32, dy: i32) -> bool {
    cells.iter().any(|&(cx, cy)| {
        let x = cx as i32 + dx;
        let y = cy as i32 + dy;
        y >= H as i32 || (b[y as usize] >> x) & 1 == 1
    })
}

fn features(b: &Board, lines: u32) -> Feat {
    let mut height = [0u32; W];
    let mut count = [0u32; W];
    let mut top = H;
    for (r, &m) in b.iter().enumerate() {
        if m == 0 {
            continue;
        }
        top = top.min(r);
        for c in 0..W {
            if (m >> c) & 1 == 1 {
                count[c] += 1;
                if height[c] == 0 {
                    height[c] = (H - r) as u32;
                }
            }
        }
    }
    let holes: u32 = (0..W).map(|c| height[c] - count[c]).sum();
    let bump: u32 = (0..W - 1).map(|c| height[c].abs_diff(height[c + 1])).sum();
    let agg: u32 = height.iter().sum();
    let max = *height.iter().max().unwrap();

    // Row transitions: filled/empty flips along each row of the stack, with the walls counting as filled.
    let mut row_t = 0u32;
    for r in top..H {
        let m = b[r] as u32 | (1 << W) | (1 << 31);
        let line = (m << 1) | 1; // wall on the left
        row_t += ((line ^ (line >> 1)) & ((1 << (W + 1)) - 1)).count_ones();
    }
    // Column transitions: flips down each column, with the floor counting as filled.
    let mut col_t = 0u32;
    for c in 0..W {
        let mut prev = true;
        for r in top..H {
            let cur = (b[r] >> c) & 1 == 1;
            if cur != prev {
                col_t += 1;
            }
            prev = cur;
        }
        if !prev {
            col_t += 1;
        }
    }
    // Wells: empty columns walled in on both sides, counted as 1 + 2 + 3 ... down the well.
    let mut wells = 0u32;
    for c in 0..W {
        let mut depth = 0;
        for r in top..H {
            let here = (b[r] >> c) & 1 == 1;
            let left = c == 0 || (b[r] >> (c - 1)) & 1 == 1;
            let right = c == W - 1 || (b[r] >> (c + 1)) & 1 == 1;
            if !here && left && right {
                depth += 1;
                wells += depth;
            } else {
                depth = 0;
            }
        }
    }
    [
        lines as f32 / 4.0,
        holes as f32 / 10.0,
        bump as f32 / 20.0,
        agg as f32 / 100.0,
        max as f32 / 20.0,
        row_t as f32 / 100.0,
        col_t as f32 / 60.0,
        wells as f32 / 40.0,
    ]
}

/// Every legal landing for `kind`. A landing that would touch the spawn rows ends the game, so it is not offered.
fn enumerate(board: &Board, kind: usize, out: &mut Vec<Cand>) {
    out.clear();
    let rots = rot_table();
    for rot in 0..ROT_COUNT[kind] {
        let cells = &rots[kind][rot];
        let minx = cells.iter().map(|c| c.0).min().unwrap() as i32;
        let maxx = cells.iter().map(|c| c.0).max().unwrap() as i32;
        for x0 in 0..=(W as i32 - 1 - (maxx - minx)) {
            let dx = x0 - minx;
            if collides(board, cells, dx, 0) {
                continue;
            }
            let mut d = 0;
            while !collides(board, cells, dx, d + 1) {
                d += 1;
            }
            if cells.iter().any(|&(_, cy)| ((cy as i32 + d) as usize) < HIDDEN) {
                continue;
            }
            let mut nb = *board;
            for &(cx, cy) in cells {
                nb[(cy as i32 + d) as usize] |= 1 << (cx as i32 + dx);
            }
            let mut lines = 0u32;
            let mut w = H;
            for r in (0..H).rev() {
                if nb[r] == FULL {
                    lines += 1;
                } else {
                    w -= 1;
                    nb[w] = nb[r];
                }
            }
            for r in 0..w {
                nb[r] = 0;
            }
            out.push(Cand { rot: rot as u8, x: x0 as u8, board: nb, feat: features(&nb, lines), lines: lines as u8 });
        }
    }
}


fn score(w: &[f32], f: &Feat) -> f32 {
    w.iter().zip(f.iter()).map(|(a, b)| a * b).sum()
}

/// Plays one game greedily with weights `w` on a fixed sequence of pieces. Returns (lines, pieces).
fn play(w: &[f32], rng: &mut Rng, cap: u32, cands: &mut Vec<Cand>) -> (u32, u32) {
    let mut board: Board = [0; H];
    let mut bag = Vec::new();
    let mut lines = 0;
    let mut n = 0;
    while n < cap {
        let kind = draw_from(&mut bag, rng);
        enumerate(&board, kind, cands);
        let mut pick = None;
        let mut bv = f32::NEG_INFINITY;
        for (i, c) in cands.iter().enumerate() {
            let v = score(w, &c.feat);
            if v > bv {
                bv = v;
                pick = Some(i);
            }
        }
        let Some(i) = pick else { break };
        lines += cands[i].lines as u32;
        board = cands[i].board;
        n += 1;
    }
    (lines, n)
}

fn draw_from(bag: &mut Vec<u8>, rng: &mut Rng) -> usize {
    if bag.is_empty() {
        *bag = (0..7).collect();
        for i in (1..7).rev() {
            let j = rng.below(i + 1);
            bag.swap(i, j);
        }
    }
    bag.pop().unwrap() as usize
}

struct Agent {
    theta: Vec<f32>,
    smooth: f32,
    pop: usize,
    elite: usize,
    rng: Rng,
    generation: u32,
    mastered: bool,
    streak: u32,
    cands: Vec<Cand>,
    /// Per generation: (generation, mean policy lines, population mean lines, population best lines).
    log: Vec<f32>,
    io: Vec<u8>,
}

impl Agent {
    fn new(seed: u32) -> Agent {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ ((seed as u64) << 17) ^ 0xD1B5_4A32_D192_ED03);
        for _ in 0..8 {
            rng.next();
        }
        let mut theta = vec![0f32; N_THETA];
        theta[NF..].fill(1.0);
        Agent { theta, smooth: SMOOTH, pop: POP, elite: ELITE, rng, generation: 0, mastered: false, streak: 0, cands: Vec::with_capacity(48), log: Vec::new(), io: vec![0; 256] }
    }

    /// One generation: sample, evaluate on shared piece sequences, refit to the elite.
    fn generation(&mut self) {
        let seeds: Vec<u64> = (0..GAMES).map(|_| self.rng.next() | 1).collect();
        let mut cands = std::mem::take(&mut self.cands);
        let mut pop: Vec<([f32; NF], f32, f32)> = Vec::with_capacity(self.pop);
        for _ in 0..self.pop {
            let mut w = [0f32; NF];
            for i in 0..NF {
                w[i] = self.theta[i] + self.theta[NF + i] * self.rng.gauss();
            }
            let mut lines = 0.0;
            let mut pieces = 0.0;
            for &sd in &seeds {
                let (l, n) = play(&w, &mut Rng(sd), CAP, &mut cands);
                lines += l as f32;
                pieces += n as f32;
            }
            let g = GAMES as f32;
            // Surviving longer breaks ties between candidates that clear nothing yet.
            pop.push((w, lines / g, lines / g + 0.001 * pieces / g));
        }
        pop.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
        let mean_lines = pop.iter().map(|p| p.1).sum::<f32>() / self.pop as f32;
        let best_lines = pop.iter().map(|p| p.1).fold(0.0, f32::max);

        // Keep a little noise early so the search does not collapse onto the first lucky weights.
        let noise = 0.12 * (1.0 - self.generation as f32 / 40.0).max(0.0);
        let e = self.elite;
        for i in 0..NF {
            let m = pop[..e].iter().map(|p| p.0[i]).sum::<f32>() / e as f32;
            let v = pop[..e].iter().map(|p| (p.0[i] - m) * (p.0[i] - m)).sum::<f32>() / e as f32;
            let sd = (v + noise * noise).sqrt().max(0.02);
            let k = self.smooth;
            self.theta[i] = k * m + (1.0 - k) * self.theta[i];
            self.theta[NF + i] = k * sd + (1.0 - k) * self.theta[NF + i];
        }
        self.generation += 1;

        // How good is the agent itself (the mean), on fresh games and a longer leash?
        let mut total = 0;
        for _ in 0..EVAL_GAMES {
            let sd = self.rng.next() | 1;
            total += play(&self.theta[..NF], &mut Rng(sd), EVAL_CAP, &mut cands).0;
        }
        let mu_lines = total as f32 / EVAL_GAMES as f32;
        self.cands = cands;
        self.log.extend_from_slice(&[self.generation as f32, mu_lines, mean_lines, best_lines]);
        self.streak = if mu_lines >= MASTER_LINES { self.streak + 1 } else { 0 };
        if self.streak >= MASTER_STREAK {
            self.mastered = true;
        }
    }
}

thread_local! {
    static AGENT: RefCell<Agent> = RefCell::new(Agent::new(1));
}

/// Forget everything and start from a blank slate (all weights zero, wide search).
#[no_mangle]
pub extern "C" fn ai_reset(seed: u32) {
    AGENT.with(|a| *a.borrow_mut() = Agent::new(seed));
}

/// Run one generation of learning. Returns the generation number reached; does nothing once mastered.
#[no_mangle]
pub extern "C" fn ai_generation() -> u32 {
    AGENT.with(|a| {
        let mut a = a.borrow_mut();
        if !a.mastered {
            a.generation();
        }
        a.generation
    })
}

/// theta: NF mean weights followed by NF standard deviations. Only the means are used to play.
#[no_mangle]
pub extern "C" fn ai_params_ptr() -> *mut f32 {
    AGENT.with(|a| a.borrow_mut().theta.as_mut_ptr())
}
#[no_mangle]
pub extern "C" fn ai_params_len() -> usize {
    N_THETA
}
/// Restore progress after loading saved weights.
#[no_mangle]
pub extern "C" fn ai_set_progress(generation: u32, mastered: u32) {
    AGENT.with(|a| {
        let mut a = a.borrow_mut();
        a.generation = generation;
        a.mastered = mastered != 0;
        a.streak = 0;
    })
}
#[no_mangle]
pub extern "C" fn ai_generation_count() -> u32 {
    AGENT.with(|a| a.borrow().generation)
}
#[no_mangle]
pub extern "C" fn ai_mastered() -> u32 {
    AGENT.with(|a| a.borrow().mastered as u32)
}
#[no_mangle]
pub extern "C" fn ai_log_ptr() -> *const f32 {
    AGENT.with(|a| a.borrow().log.as_ptr())
}
#[no_mangle]
pub extern "C" fn ai_log_len() -> usize {
    AGENT.with(|a| a.borrow().log.len())
}
#[no_mangle]
pub extern "C" fn ai_log_clear() {
    AGENT.with(|a| a.borrow_mut().log.clear())
}

/// A 256-byte scratch area for `ai_choose`: the page writes a W*H board here, one byte per cell.
#[no_mangle]
pub extern "C" fn ai_io_ptr() -> *mut u8 {
    AGENT.with(|a| a.borrow_mut().io.as_mut_ptr())
}

/// Best placement for `kind` (I, O, T, S, Z, J, L = 0..6) on the board in the scratch area, using the
/// current mean weights. Returns rotation * 16 + leftmost column, or -1 if nothing fits.
#[no_mangle]
pub extern "C" fn ai_choose(kind: u32) -> i32 {
    AGENT.with(|a| {
        let mut a = a.borrow_mut();
        let mut b: Board = [0; H];
        for r in 0..H {
            for c in 0..W {
                if a.io[r * W + c] != 0 {
                    b[r] |= 1 << c;
                }
            }
        }
        let mut cands = std::mem::take(&mut a.cands);
        enumerate(&b, (kind as usize).min(6), &mut cands);
        let mut best = None;
        let mut bv = f32::NEG_INFINITY;
        for c in &cands {
            let v = score(&a.theta[..NF], &c.feat);
            if v > bv {
                bv = v;
                best = Some((c.rot as i32) * 16 + c.x as i32);
            }
        }
        a.cands = cands;
        best.unwrap_or(-1)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotations_have_four_cells_and_match_the_game() {
        let t = rot_table();
        // T pointing right after one clockwise turn: .X. / .XX / .X.
        let mut right = t[2][1].to_vec();
        right.sort();
        assert_eq!(right, vec![(1, 0), (1, 1), (1, 2), (2, 1)]);
        // vertical I sits in column 2 of its 4x4 box
        assert!(t[0][1].iter().all(|c| c.0 == 2));
    }

    #[test]
    fn clears_a_row_and_reports_it() {
        let mut b: Board = [0; H];
        b[H - 1] = FULL & !0b1111; // columns 0..3 empty
        let mut out = Vec::new();
        enumerate(&b, 0, &mut out);
        let c = out.iter().find(|c| c.rot == 0 && c.x == 0).unwrap();
        assert_eq!(c.lines, 1);
        assert_eq!(c.board[H - 1], 0);
    }

    #[test]
    fn full_board_has_no_moves() {
        let mut b: Board = [0; H];
        for r in HIDDEN..H {
            b[r] = FULL & !1;
        }
        let mut out = Vec::new();
        enumerate(&b, 1, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn features_count_what_they_say() {
        let mut b: Board = [0; H];
        b[H - 1] = 0b0000000011; // two blocks bottom-left
        b[H - 2] = 0b0000000001; // one on top of them
        b[H - 3] = 0b0000000100; // a floating block at column 2 => holes beneath it
        let f = features(&b, 0);
        assert!((f[1] * 10.0 - 2.0).abs() < 1e-4, "holes {:?}", f); // (H-3, 2) leaves two empty cells below
        assert!(f[3] * 100.0 > 0.0 && f[4] * 20.0 == 3.0);
    }

    #[test]
    fn chosen_move_matches_the_scratch_board() {
        ai_reset(1);
        // untrained weights are zero: every move ties, so the first candidate (rot 0, column 0) wins
        let mv = ai_choose(1);
        assert_eq!(mv, 0);
        // the I piece flat on an empty board can reach columns 0..=6
        let mut out = Vec::new();
        enumerate(&[0; H], 0, &mut out);
        assert_eq!(out.len(), 7 + 10);
    }

    #[test]
    fn a_generation_runs_and_stays_finite() {
        let mut a = Agent::new(3);
        for _ in 0..3 {
            a.generation();
        }
        assert_eq!(a.generation, 3);
        assert!(a.theta.iter().all(|v| v.is_finite()));
        assert_eq!(a.log.len(), 12);
    }

    /// A hand-tuned heuristic should be able to survive for ages if the simulator and features are right.
    #[test]
    fn heuristic_baseline() {
        // lines, holes, bumpiness, aggregate height, max height, row t, col t, wells
        let w = [0.76 * 4.0, -0.36 * 10.0, -0.18 * 20.0, -0.51 * 100.0, 0.0, 0.0, 0.0, 0.0];
        let mut cands = Vec::new();
        let (lines, pieces) = play(&w, &mut Rng(99), 1000, &mut cands);
        println!("heuristic: {lines} lines in {pieces} pieces");
        assert!(lines > 300, "heuristic only cleared {lines} lines");
    }

    /// Run with: cargo test --release cem_curve -- --ignored --nocapture
    #[test]
    #[ignore]
    fn cem_curve() {
        let seed = std::env::var("SEED").ok().and_then(|v| v.parse().ok()).unwrap_or(1);
        let mut a = Agent::new(seed);
        let env = |k: &str| std::env::var(k).ok().and_then(|v| v.parse::<f32>().ok());
        if let Some(v) = env("SMOOTH") { a.smooth = v }
        if let Some(v) = env("POP") { a.pop = v as usize }
        if let Some(v) = env("ELITE") { a.elite = v as usize }
        let t0 = std::time::Instant::now();
        let mut curve = Vec::new();
        while !a.mastered && a.generation < 120 {
            a.generation();
            curve.push(a.log[a.log.len() - 3]);
        }
        println!("CURVE {:?}", curve.iter().map(|v| v.round() as i32).collect::<Vec<_>>());
        println!("RESULT seed={} mastered={} generations={} [{:.1}s]", seed, a.mastered, a.generation, t0.elapsed().as_secs_f32());
    }
}
