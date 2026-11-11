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
const NF: usize = 12;
/// theta = [mean weights (NF), standard deviations (NF)]
const N_THETA: usize = 2 * NF;
const POP: usize = 16;
const ELITE: usize = 4;
/// How far each generation moves the distribution toward its elite (1 = jump all the way).
const SMOOTH: f32 = 0.07;
const GAMES: usize = 2;
/// A training game ends after this many pieces, which caps lines at about 4 * CAP / 10. The cap rises
/// whenever the best candidates start surviving it, so there is always something left to learn.
const TRAIN_CAP: u32 = 300;
const TRAIN_CAP_MAX: u32 = 3_000;
const EVAL_GAMES: usize = 2;
/// The exam ladder. Levels 0..=4 double the game length from 1,000 pieces. After that the length holds at
/// 16,000 and garbage rows start rising from the floor, faster each level. Past the last of those the
/// length doubles again. The top rung is where compute and physics (garbage faster than a row every
/// three pieces cannot be cleared) run out.
const LEN_LEVELS: u32 = 4;
const GARBAGE_LEVELS: u32 = 12;
const MAX_LEVEL: u32 = LEN_LEVELS + 1 + GARBAGE_LEVELS + 3;

/// (pieces in the exam game, pieces between garbage rows or 0 for none) at `level`.
fn exam(level: u32) -> (u32, u32) {
    let level = level.min(MAX_LEVEL);
    if level <= LEN_LEVELS {
        return (1_000 << level, 0);
    }
    let k = level - LEN_LEVELS - 1;
    if k <= GARBAGE_LEVELS {
        return (16_000, ((24.0 * 0.85f32.powi(k as i32)).round() as u32).max(3));
    }
    (16_000 << (k - GARBAGE_LEVELS).min(3), 3)
}
/// Surviving every evaluation game this many generations running passes the level.
const LEVEL_STREAK: u32 = 2;
/// The weights keep this much random spread even once the elite agree, so learning never freezes.
const SD_FLOOR: f32 = 0.02;

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

fn features(b: &Board, lines: u32, landing: f32, eroded: u32) -> Feat {
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
    // Rows that hide a hole, and the blocks stacked above the first hole of each column (what it costs to dig out).
    let mut hole_rows = 0u32;
    let mut blockades = 0u32;
    let mut covered = 0u16;
    for r in top..H {
        if covered & !b[r] != 0 {
            hole_rows += 1;
        }
        covered |= b[r];
    }
    for c in 0..W {
        let mut filled = 0;
        for r in top..H {
            if (b[r] >> c) & 1 == 1 {
                filled += 1;
            } else if filled > 0 {
                blockades += filled;
                break;
            }
        }
    }
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
        landing / 20.0,
        eroded as f32 / 8.0,
        hole_rows as f32 / 10.0,
        blockades as f32 / 20.0,
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
            let mut eroded = 0u32;
            let mut w = H;
            for r in (0..H).rev() {
                if nb[r] == FULL {
                    lines += 1;
                    eroded += cells.iter().filter(|&&(_, cy)| (cy as i32 + d) as usize == r).count() as u32;
                } else {
                    w -= 1;
                    nb[w] = nb[r];
                }
            }
            for r in 0..w {
                nb[r] = 0;
            }
            let landing = cells.iter().map(|&(_, cy)| (H as i32 - (cy as i32 + d)) as f32).sum::<f32>() / 4.0;
            out.push(Cand { rot: rot as u8, x: x0 as u8, board: nb, feat: features(&nb, lines, landing, lines * eroded), lines: lines as u8 });
        }
    }
}

fn score(w: &[f32], f: &Feat) -> f32 {
    w.iter().zip(f.iter()).map(|(a, b)| a * b).sum()
}

/// How much a move that leaves the next piece nowhere to go is worth: less than anything else.
const DEATH: f32 = -1e6;

/// The piece sequence of a game: a 7-bag, drawn lazily so the agent can peek at what comes next.
struct Pieces {
    seq: Vec<u8>,
}

impl Pieces {
    fn get(&mut self, i: usize, rng: &mut Rng) -> usize {
        while self.seq.len() <= i {
            let mut bag: [u8; 7] = [0, 1, 2, 3, 4, 5, 6];
            for j in (1..7).rev() {
                bag.swap(j, rng.below(j + 1));
            }
            self.seq.extend_from_slice(&bag);
        }
        self.seq[i] as usize
    }
}

/// Index of the best landing for `kind`. With `next` known it looks one piece further: each landing is worth
/// its own score plus the best score the next piece can get on the resulting board.
fn best_move(w: &[f32], board: &Board, kind: usize, next: Option<usize>, cands: &mut Vec<Cand>, scratch: &mut Vec<Cand>) -> Option<usize> {
    enumerate(board, kind, cands);
    let mut pick = None;
    let mut bv = f32::NEG_INFINITY;
    for (i, c) in cands.iter().enumerate() {
        let mut v = score(w, &c.feat);
        if let Some(n) = next {
            enumerate(&c.board, n, scratch);
            v += scratch.iter().map(|s| score(w, &s.feat)).fold(DEATH, f32::max);
        }
        if v > bv {
            bv = v;
            pick = Some(i);
        }
    }
    pick
}

/// Pushes one garbage row up from the floor with a single gap. Returns false if that overflows the board.
fn add_garbage(board: &mut Board, rng: &mut Rng) -> bool {
    if board[0] | board[1] != 0 {
        return false;
    }
    for r in 0..H - 1 {
        board[r] = board[r + 1];
    }
    board[H - 1] = FULL & !(1 << rng.below(W));
    true
}

/// Plays one game with weights `w` on a fixed sequence of pieces. Returns (lines, pieces).
/// Every `garbage` pieces (0 = never) a row of junk rises from the floor.
fn play(w: &[f32], rng: &mut Rng, cap: u32, garbage: u32, look: bool, cands: &mut Vec<Cand>, scratch: &mut Vec<Cand>) -> (u32, u32) {
    let mut board: Board = [0; H];
    let mut pieces = Pieces { seq: Vec::new() };
    let mut lines = 0;
    let mut n = 0;
    while n < cap {
        let kind = pieces.get(n as usize, rng);
        let next = look.then(|| pieces.get(n as usize + 1, rng));
        let Some(i) = best_move(w, &board, kind, next, cands, scratch) else { break };
        lines += cands[i].lines as u32;
        board = cands[i].board;
        n += 1;
        if garbage > 0 && n % garbage == 0 && !add_garbage(&mut board, rng) {
            break;
        }
    }
    (lines, n)
}

struct Agent {
    theta: Vec<f32>,
    smooth: f32,
    pop: usize,
    elite: usize,
    /// Whether training and exam games look one piece ahead. Off: it is 25 times slower, and the weights
    /// carry over to the lookahead the game uses.
    look: bool,
    rng: Rng,
    generation: u32,
    /// Difficulty level, an index into `exam`.
    level: u32,
    train_cap: u32,
    /// In bounded mode, passing a level at all ends training (the old "mastered").
    bounded: bool,
    mastered: bool,
    streak: u32,
    cands: Vec<Cand>,
    scratch: Vec<Cand>,
    /// Per generation: (generation, mean policy lines, population mean lines, population best lines, level, fraction of the exam survived).
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
        Agent {
            theta,
            smooth: SMOOTH,
            pop: POP,
            elite: ELITE,
            look: false,
            rng,
            generation: 0,
            level: 0,
            train_cap: TRAIN_CAP,
            bounded: false,
            mastered: false,
            streak: 0,
            cands: Vec::with_capacity(48),
            scratch: Vec::with_capacity(48),
            log: Vec::new(),
            io: vec![0; 256],
        }
    }

    fn eval_cap(&self) -> u32 {
        exam(self.level).0
    }

    /// One generation: sample, evaluate on shared piece sequences, refit to the elite.
    fn generation(&mut self) {
        let seeds: Vec<u64> = (0..GAMES).map(|_| self.rng.next() | 1).collect();
        let mut cands = std::mem::take(&mut self.cands);
        let mut scratch = std::mem::take(&mut self.scratch);
        let mut pop: Vec<([f32; NF], f32, f32)> = Vec::with_capacity(self.pop);
        let cap = self.train_cap;
        let garbage = exam(self.level).1;
        let mut survivors = 0;
        for _ in 0..self.pop {
            let mut w = [0f32; NF];
            for i in 0..NF {
                w[i] = self.theta[i] + self.theta[NF + i] * self.rng.gauss();
            }
            let mut lines = 0.0;
            let mut pieces = 0.0;
            let mut lived = true;
            for &sd in &seeds {
                let (l, n) = play(&w, &mut Rng(sd), cap, garbage, self.look, &mut cands, &mut scratch);
                lines += l as f32;
                pieces += n as f32;
                lived &= n >= cap;
            }
            let g = GAMES as f32;
            if lived {
                survivors += 1;
            }
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
            let sd = (v + noise * noise).sqrt().max(SD_FLOOR);
            let k = self.smooth;
            self.theta[i] = k * m + (1.0 - k) * self.theta[i];
            self.theta[NF + i] = k * sd + (1.0 - k) * self.theta[NF + i];
        }
        self.generation += 1;
        // When the elite all live out the game, the game is too short to tell them apart: make it longer.
        if survivors >= self.elite {
            self.train_cap = (self.train_cap * 3 / 2).min(TRAIN_CAP_MAX);
        }

        // How good is the agent itself (the mean), on fresh games at the current level?
        let (ecap, egarbage) = exam(self.level);
        let mut total = 0;
        let mut alive = 0;
        let mut all_lived = true;
        for _ in 0..EVAL_GAMES {
            let sd = self.rng.next() | 1;
            let (l, n) = play(&self.theta[..NF], &mut Rng(sd), ecap, egarbage, self.look, &mut cands, &mut scratch);
            total += l;
            alive += n;
            all_lived &= n >= ecap;
        }
        let mu_lines = total as f32 / EVAL_GAMES as f32;
        let survived = alive as f32 / (EVAL_GAMES as f32 * ecap as f32);
        self.cands = cands;
        self.scratch = scratch;
        self.log.extend_from_slice(&[self.generation as f32, mu_lines, mean_lines, best_lines, self.level as f32, survived]);
        self.streak = if all_lived { self.streak + 1 } else { 0 };
        if self.streak >= LEVEL_STREAK {
            self.streak = 0;
            if self.bounded {
                self.mastered = true;
            } else if self.level < MAX_LEVEL {
                self.level += 1;
            }
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
pub extern "C" fn ai_set_progress(generation: u32, mastered: u32, level: u32, train_cap: u32) {
    AGENT.with(|a| {
        let mut a = a.borrow_mut();
        a.generation = generation;
        a.mastered = mastered != 0;
        a.level = level.min(30);
        a.train_cap = train_cap.clamp(TRAIN_CAP, TRAIN_CAP_MAX);
        a.streak = 0;
    })
}
/// Bounded mode stops training once a level is passed; unbounded mode raises the bar and carries on.
#[no_mangle]
pub extern "C" fn ai_set_bounded(bounded: u32) {
    AGENT.with(|a| {
        let mut a = a.borrow_mut();
        a.bounded = bounded != 0;
        if !a.bounded {
            a.mastered = false;
        }
        a.streak = 0;
    })
}
#[no_mangle]
pub extern "C" fn ai_level() -> u32 {
    AGENT.with(|a| a.borrow().level)
}
#[no_mangle]
pub extern "C" fn ai_eval_cap() -> u32 {
    AGENT.with(|a| a.borrow().eval_cap())
}
#[no_mangle]
pub extern "C" fn ai_train_cap() -> u32 {
    AGENT.with(|a| a.borrow().train_cap)
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
/// current mean weights. `next` is the piece after it, or anything above 6 if unknown. Returns
/// rotation * 16 + leftmost column, or -1 if nothing fits.
#[no_mangle]
pub extern "C" fn ai_choose(kind: u32, next: u32) -> i32 {
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
        let mut scratch = std::mem::take(&mut a.scratch);
        let next = (next < 7).then_some(next as usize);
        let best = best_move(&a.theta[..NF], &b, (kind as usize).min(6), next, &mut cands, &mut scratch).map(|i| cands[i].rot as i32 * 16 + cands[i].x as i32);
        a.cands = cands;
        a.scratch = scratch;
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
        let f = features(&b, 0, 0.0, 0);
        assert!((f[1] * 10.0 - 2.0).abs() < 1e-4, "holes {:?}", f); // (H-3, 2) leaves two empty cells below
        assert!(f[3] * 100.0 > 0.0 && f[4] * 20.0 == 3.0);
    }

    #[test]
    fn chosen_move_matches_the_scratch_board() {
        ai_reset(1);
        // untrained weights are zero: every move ties, so the first candidate (rot 0, column 0) wins
        let mv = ai_choose(1, 9);
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
        assert_eq!(a.log.len(), 18);
    }

    /// A hand-tuned heuristic should be able to survive for ages if the simulator and features are right.
    #[test]
    fn heuristic_baseline() {
        // lines, holes, bumpiness, aggregate height, max height, row t, col t, wells
        let mut w = [0f32; NF];
        w[..4].copy_from_slice(&[0.76 * 4.0, -0.36 * 10.0, -0.18 * 20.0, -0.51 * 100.0]);
        let (mut cands, mut scratch) = (Vec::new(), Vec::new());
        let results: Vec<(u32, u32)> = (0..12).map(|i| play(&w, &mut Rng(99 + i * 31), 1000, 0, false, &mut cands, &mut scratch)).collect();
        println!("heuristic (lines, pieces): {results:?}");
        let mean = results.iter().map(|r| r.0).sum::<u32>() / results.len() as u32;
        assert!(mean > 300, "heuristic only averaged {mean} lines");
    }

    #[test]
    fn the_ladder_gets_harder_every_rung() {
        let mut prev = (0, u32::MAX);
        for l in 0..=MAX_LEVEL {
            let (cap, gar) = exam(l);
            let gar_key = if gar == 0 { u32::MAX } else { gar };
            assert!(cap >= prev.0 && gar_key <= prev.1 && (cap, gar_key) != prev, "level {l}: {cap} {gar}");
            prev = (cap, gar_key);
        }
        assert_eq!(exam(MAX_LEVEL + 9), exam(MAX_LEVEL));
    }

    #[test]
    fn garbage_rises_and_overflows() {
        let mut b: Board = [0; H];
        let mut rng = Rng(5);
        assert!(add_garbage(&mut b, &mut rng));
        assert_eq!(b[H - 1].count_ones(), 9);
        let mut n = 1;
        while add_garbage(&mut b, &mut rng) {
            n += 1;
        }
        assert_eq!(n, H - 1);
    }

    fn env(k: &str) -> Option<f32> {
        std::env::var(k).ok().and_then(|v| v.parse::<f32>().ok())
    }

    /// Run with: cargo test --release cem_curve -- --ignored --nocapture
    /// Env: SEED, GENS, BOUNDED=1, LOOK=0, SMOOTH, POP, ELITE.
    #[test]
    #[ignore]
    fn cem_curve() {
        let seed = env("SEED").unwrap_or(1.0) as u32;
        let mut a = Agent::new(seed);
        a.bounded = env("BOUNDED").is_some();
        if let Some(v) = env("SMOOTH") { a.smooth = v }
        if let Some(v) = env("POP") { a.pop = v as usize }
        if let Some(v) = env("ELITE") { a.elite = v as usize }
        if let Some(v) = env("LOOK") { a.look = v != 0.0 }
        let gens = env("GENS").unwrap_or(120.0) as u32;
        let t0 = std::time::Instant::now();
        let mut curve = Vec::new();
        while !a.mastered && a.generation < gens {
            a.generation();
            let n = a.log.len();
            curve.push((a.log[n - 5].round() as i32, a.log[n - 2] as i32));
        }
        println!("CURVE (lines, level) {:?}", curve);
        println!("RESULT seed={} mastered={} generations={} level={} train_cap={} [{:.1}s]", seed, a.mastered, a.generation, a.level, a.train_cap, t0.elapsed().as_secs_f32());
        println!("THETA {:?}", &a.theta[..NF]);
    }

    /// How long do the learned weights survive on games they have never seen? Env: SEED, GENS, GAMES, LEN.
    #[test]
    #[ignore]
    fn strength() {
        let seed = env("SEED").unwrap_or(1.0) as u32;
        let mut a = Agent::new(seed);
        if let Some(v) = env("LOOK") { a.look = v != 0.0 }
        for _ in 0..env("GENS").unwrap_or(60.0) as u32 {
            a.generation();
        }
        let games = env("GAMES").unwrap_or(10.0) as u32;
        let len = env("LEN").unwrap_or(20_000.0) as u32;
        let garbage = env("GARBAGE").unwrap_or(0.0) as u32;
        let look = env("PLAYLOOK").map_or(true, |v| v != 0.0);
        let (mut cands, mut scratch) = (Vec::new(), Vec::new());
        let mut out = Vec::new();
        for g in 0..games {
            out.push(play(&a.theta[..NF], &mut Rng(0xABCD + g as u64 * 7919), len, garbage, look, &mut cands, &mut scratch).1);
        }
        let mean = out.iter().sum::<u32>() as f32 / games as f32;
        println!("STRENGTH seed={seed} gens={} level={} mean_pieces={mean:.0} of {len}: {out:?}", a.generation, a.level);
    }
}
