// Test harness: exercises the bot's pure-logic modules against temp data files.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATS_FILE = join(mkdtempSync(join(tmpdir(), 'stats-')), 'stats.json');
process.env.DAILY_FILE = join(mkdtempSync(join(tmpdir(), 'daily-')), 'daily.json');

const t = await import('../src/game.js');
const w = await import('../src/wordle.js');
const s = await import('../src/stats.js');
const d = await import('../src/daily.js');

let failures = 0;
function check(name, cond, extra) {
  if (!cond) { failures++; console.log('FAIL:', name, extra ?? ''); }
  else console.log('ok  :', name);
}
const ev = (g, a) => w.evaluateGuess(g, a).join(',');

// --- evaluateGuess correctness (duplicate letters) ---
check('all correct', ev('crane', 'crane') === 'correct,correct,correct,correct,correct');
check('dup guess vs single e (geese/stone)', ev('geese', 'stone') === 'absent,absent,absent,present,correct');
check('dup answer (erase/speed)', ev('erase', 'speed') === 'present,absent,absent,present,present');
check('dup both (abbey/maybe)', ev('abbey', 'maybe') === 'present,present,absent,present,present');
check('triple e vs double e (eeeee/beech)', ev('eeeee', 'beech') === 'absent,correct,correct,absent,absent');

// --- daily determinism + puzzle numbering ---
const a1 = d.getDailyAnswer('2026-11-05');
check('daily answer deterministic', a1 === d.getDailyAnswer('2026-11-05') && /^[a-z]{5}$/.test(a1));
check('puzzle #1 is 2021-06-19', d.puzzleNumber('2021-06-19') === 1);
check('puzzle #2 is 2021-06-20', d.puzzleNumber('2021-06-20') === 2);
check('puzzle number matches NYT (2026-11-05 = #1966)', d.puzzleNumber('2026-11-05') === 1966);
check('dayNumber monotonic', d.dayNumber('2026-11-05') - d.dayNumber('2026-11-04') === 1);

// --- game flow ---
const g = new t.DailyGameManager();
check('guess without start -> no-game', g.guess('alice', 'zzzzz').status === 'no-game');
const started = g.start('alice');
check('start snapshots hard mode (off)', started.hardMode === false);
check('invalid word rejected', g.guess('alice', 'qqqqq').status === 'invalid-word');
let out = g.guess('alice', 'crane');
check('first guess continues', out.status === 'continue' && out.entry.attempts.length === 1);

// --- full board + keyboard rendering ---
const board = w.renderBoard(out.entry);
check('board always shows six numbered rows', board.split('\n').length === 6 && board.startsWith('`1`  '));
check('first guess has five individually spaced tiles', /^`1`  [🟩🟨⬛] [🟩🟨⬛] [🟩🟨⬛] [🟩🟨⬛] [🟩🟨⬛]$/u.test(board.split('\n')[0]));
check('unused rows are empty tiles', board.split('\n')[5] === '`6`  ⬜ ⬜ ⬜ ⬜ ⬜');
check('next guess is marked without consuming an attempt', board.split('\n')[1].endsWith('← next guess') && out.entry.attempts.length === 1);
out = g.guess('alice', 'stone');
check('board preserves previous rows as guesses accumulate', w.renderBoard(out.entry).split('\n')[0] === board.split('\n')[0] && !w.renderBoard(out.entry).split('\n')[1].includes('⬜'));
check('next marker moves to the third row', w.renderBoard(out.entry).split('\n')[2].endsWith('← next guess'));
check('grid never prints full guess words', !w.renderBoard(out.entry).includes('CRANE') && !w.renderBoard(out.entry).includes('STONE'));
const emptyBoard = w.renderBoard({ attempts: [], status: 'playing' });
check('empty board shows six rows and marks first guess', emptyBoard.split('\n').length === 6 && emptyBoard.split('\n')[0] === '`1`  ⬜ ⬜ ⬜ ⬜ ⬜  ← next guess');
check('completed board does not invite another guess', !w.renderBoard({ ...out.entry, status: 'won' }).includes('next guess'));
const kb = w.renderKeyboard([
  { word: 'crane', result: ['correct', 'present', 'absent', 'absent', 'absent'] },
  { word: 'slate', result: ['absent', 'absent', 'present', 'absent', 'correct'] },
]);
check('letter hints have explicit categories', kb.includes('Your letter hints') && kb.includes('Not tried:'));
check('green hints show letters in confirmed positions', kb.includes('🟩 Right spot: `C _ _ _ E`'));
check('yellow hints name letters in the word', kb.includes('🟨 In word, wrong spot: `A R`'));
check('gray hints name ruled-out letters', kb.includes('⬛ Not in word: `L N S T`'));
check('unused letters stay visible', kb.includes('Not tried: `B D F G H I J K M O P Q U V W X Y Z`'));
check('full guessed words stay out of public hints', !kb.includes('CRANE') && !kb.includes('SLATE'));
const duplicateHints = w.renderKeyboard([
  { word: 'geese', result: w.evaluateGuess('geese', 'stone') },
]);
check('gray duplicate never overrides a confirmed letter', duplicateHints.includes('Right spot: `_ _ _ _ E`') && duplicateHints.includes('Not in word: `G`'));
check('a green letter is not also listed as yellow', duplicateHints.includes('In word, wrong spot: `S`'));
const retainedHints = w.renderKeyboard([
  { word: 'crane', result: w.evaluateGuess('crane', 'crone') },
  { word: 'tails', result: w.evaluateGuess('tails', 'crone') },
]);
check('confirmed positions survive later guesses', retainedHints.includes('Right spot: `C R _ N E`'));
const emptyHints = w.renderKeyboard([]);
check('empty hints have five unknown positions', emptyHints.includes('Right spot: `_ _ _ _ _`'));
check('empty categories are explained', emptyHints.includes('wrong spot: `none yet`') && emptyHints.includes('Not in word: `none yet`'));
check('empty keyboard lists all 26 unused letters', emptyHints.includes('Not tried: `A B C D E F G H I J K L M N O P Q R S T U V W X Y Z`'));

// --- hard mode ---
s.setHardMode('carol', true);
const hm = new t.DailyGameManager();
hm.start('carol');
check('hard mode snapshotted at start', hm.get('carol').hardMode === true);
const answer = hm.get('carol').answer;
// burn a first guess that reveals hints
let first = 'crane';
let hmOut = hm.guess('carol', first);
check('hard-mode first guess allowed', hmOut.status === 'continue');
// find a guess that violates: must reuse greens
const greens = {};
hmOut.entry.attempts[0].result.forEach((r, i) => { if (r === 'correct') greens[i] = first[i]; });
if (Object.keys(greens).length === 0) {
  // pick any green we can force: guess the answer minus one letter is complex; fallback: test hardModeIssues directly
  const issues = w.hardModeIssues(
    [{ word: 'crane', result: ['correct', 'present', 'absent', 'absent', 'absent'] }],
    'slate'
  );
  check('hardModeIssues catches unused green C', issues.some((i) => i.includes('C')));
} else {
  const bad = 'tails'.split('');
  for (const [pos, ch] of Object.entries(greens)) bad[Number(pos)] = bad[Number(pos)] === ch ? 'x' : bad[Number(pos)];
  const badWord = bad.join('');
  if (/^[a-z]{5}$/.test(badWord)) {
    hmOut = hm.guess('carol', badWord);
    check('hard mode rejects hint-violating guess', hmOut.status === 'hard-mode' && hmOut.issues.length > 0);
  }
}
const issuesDirect = w.hardModeIssues(
  [
    { word: 'crane', result: ['absent', 'present', 'absent', 'absent', 'absent'] }, // R yellow
    { word: 'roast', result: ['present', 'correct', 'absent', 'absent', 'absent'] }, // O green @2, R yellow
  ],
  'nasty'
);
check('hardModeIssues requires yellow R', issuesDirect.some((i) => i.includes('R')));
check('hardModeIssues requires green O in position 2', issuesDirect.some((i) => i.includes('position 2')));

// --- share text ---
const entry = g.get('alice');
check('shareGrid rows', w.shareGrid(entry.attempts).split('\n').length === entry.attempts.length);
check('share grid stays compact without numbering or empty rows', w.shareGrid(entry.attempts).split('\n').every((row) => /^[🟩🟨⬛]{5}$/u.test(row)));
check('shareScore formats', /^\d\/6\*?$|^X\/6\*?$/.test(w.shareScore(entry)));

// --- stats: NYT streak behavior ---
s.recordResult('bob', true, 3, '2026-11-01');
let st = s.recordResult('bob', true, 3, '2026-11-02');
check('consecutive-day wins continue streak', st.currentStreak === 2);
st = s.recordResult('bob', true, 3, '2026-11-05');
check('skipped day breaks streak to 1 (NYT rule)', st.currentStreak === 1 && st.maxStreak === 2);
st = s.recordResult('bob', false, 6, '2026-11-06');
check('loss resets streak', st.currentStreak === 0);
st = s.recordResult('bob', true, 4, '2026-11-07');
check('win after loss restarts streak', st.currentStreak === 1 && st.maxStreak === 2);
st = s.getStats('bob');
check('distribution recorded', st.distribution[2] === 3 && st.distribution[3] === 1 && st.distribution[5] === 0);

// --- hard mode preference round-trip ---
check('hard mode pref default off', s.getHardMode('dave') === false);
check('hard mode pref toggles', s.setHardMode('dave', true) === true && s.getHardMode('dave') === true);

// --- distribution chart ---
const chart = s.renderDistribution({ distribution: [3, 1, 0, 0, 0, 2] });
check('distribution chart has 6 rows', chart.split('\n').length === 6);
check('distribution chart scales bars', chart.split('\n')[0].includes('█') && chart.split('\n')[0].includes('3'));

// --- give up flow ---
const gu = new t.DailyGameManager();
gu.start('erin');
const guEntry = gu.giveUp('erin');
check('give up returns entry', guEntry.status === 'gaveup' && guEntry.completedAt != null);
check('give up twice returns null', gu.giveUp('erin') === null);

// --- leaderboard ordering ---
const lb = new t.DailyGameManager();
lb.start('p1'); lb.guess('p1', lb.get('p1').answer);            // win in 1
lb.start('p2'); lb.guess('p2', 'crane'); lb.giveUp('p2');       // gave up after 1
const board2 = lb.leaderboardToday();
check('leaderboard ranks winner first', board2[0].userId === 'p1');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
