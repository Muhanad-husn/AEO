// The commands block-merge's shell arm is judged against, and where each one came from.
//
// Every entry is `{ command, source }`. `source` names the first build's record that
// put the case on the list, so a later reader can find the incident rather than guess
// why a string is here. The lists are data only; tests/hooks/block-merge.test.mjs runs
// them.
//
// `passes` holds commands that mention merging or deletion inside a quoted argument of
// some other program, or that name a read-only git or gh subcommand. A subagent runs
// these all day and the gate must not read the words inside them.
//
// `blocks` holds the real thing: a merge, a pull request merge, a local branch
// deletion, a remote branch deletion, each in the spellings the first build found, plus
// the same commands hidden inside an interpreter's inline string, behind a wrapper
// program, or behind two wrappers stacked, plus one command the parser cannot read at
// all.

/** Commands a subagent must be able to run. */
export const passes = [
  {
    command: 'grep -rn "git merge" plugin/',
    source: "CLAUDE.md, the harness note's known limit: a subagent cannot grep for the two words",
  },
  {
    command: 'git commit -m "docs: say git merge stays with the founder"',
    source: "CLAUDE.md, the harness note's known limit: a commit message cannot carry the two words",
  },
  {
    command: 'printf \'%s\\n\' "- git merge is the founder\'s call" >> RULES.md',
    source: 'PLAN.md section 3, the refused documentation of the rule itself',
  },
  {
    command: 'git branch --show-current && ls -d */',
    source: 'plugin/hooks/block-merge.mjs comment, an earlier false positive on the ls flag',
  },
  {
    command: 'git branch -a | sort -d',
    source: 'tests/hooks/block-merge.test.mjs, the sort -d false positive',
  },
  {
    command: 'git merge-base HEAD main',
    source: 'V-02, docs/EVIDENCE.md: merge-base is read-only',
  },
  {
    command: 'gh pr view 12 --json mergeable',
    source: 'tests/hooks/block-merge.test.mjs, the read-only gh pr call',
  },
  {
    command: 'gh api repos/o/r/pulls/1 --jq .mergeable',
    source: 'tests/hooks/block-merge.test.mjs, the read-only gh api call',
  },
  {
    command: 'echo "gh pr merge is the founder\'s"',
    source: 'PLAN.md section 3, a sentence about the rule quoted into a shell call',
  },
  {
    command: 'node -e "console.log(\'git merge\')"',
    source: "CLAUDE.md, the harness note's known limit, in its node spelling",
  },
  {
    command: 'git log --merges --oneline',
    source: 'V-02, docs/EVIDENCE.md: a read-only log filter that carries the word',
  },
  {
    command: 'git log --grep="merge"',
    source: 'V-02, docs/EVIDENCE.md: a log search whose pattern carries the word',
  },
  {
    command: 'Select-String -Pattern "git merge" -Path RULES.md',
    source: 'C-07, the PowerShell spelling of the grep case',
  },
  {
    command: 'env grep -rn "git merge" plugin/',
    source: 'this slice: a wrapper in front of the grep case, which must stay a pass',
  },
  {
    command: 'timeout 5 git merge-base HEAD main',
    source: 'this slice: a wrapper in front of a read-only git call, duration operand and all',
  },
];

/** Commands a subagent must not be able to run. */
export const blocks = [
  {
    command: 'git merge feat',
    source: 'V-02, the gate\'s first case',
  },
  {
    command: 'git -C D:/x merge feat',
    source: 'V-02, the case the skill version missed: git\'s own -C option',
  },
  {
    command: 'cd D:/x && git merge feat',
    source: 'V-02, a merge behind a cd',
  },
  {
    command: 'gh pr merge 12 --squash --delete-branch',
    source: 'D14, the pull request merge surface',
  },
  {
    command: 'gh api repos/o/r/pulls/1/merge -X PUT',
    source: 'D14, the same merge through the API',
  },
  {
    command: 'git branch -d feat',
    source: 'D14, local branch deletion, short form',
  },
  {
    command: 'git branch -D feat',
    source: 'D14, local branch deletion, force form',
  },
  {
    command: 'git push origin --delete feat',
    source: 'D30, remote branch deletion, long form',
  },
  {
    command: 'git push origin -d feat',
    source: 'D30, remote branch deletion, short form, a confirmed bypass',
  },
  {
    command: 'git push origin :feat',
    source: 'D30, the colon-deletion refspec, a confirmed bypass',
  },
  {
    command: 'git status; git push origin :feat',
    source: 'Checkpoint 1, every push in the chain is judged, not the first',
  },
  {
    command: 'bash -c "git merge feat"',
    source: 'the interpreter case this slice adds: an inline command string',
  },
  {
    command: "sh -c 'git merge feat'",
    source: 'the interpreter case this slice adds, sh spelling',
  },
  {
    command: 'pwsh -Command "git merge feat"',
    source: 'C-07, the interpreter case in its PowerShell spelling',
  },
  {
    command: 'env git merge feat',
    source: 'this slice: a wrapper program in front of the real one',
  },
  {
    command: 'sudo git merge feat',
    source: 'this slice: the same shape under sudo',
  },
  {
    command: 'timeout 30 git merge feat',
    source: 'this slice: a wrapper whose own operand is a duration, not a program',
  },
  {
    command: 'nohup git merge feat',
    source: 'this slice: a wrapper with no options of its own',
  },
  {
    command: 'nice -n 5 git merge feat',
    source: 'this slice: a wrapper option that takes a separate value',
  },
  {
    command: 'command git merge feat',
    source: "this slice: the shell's own wrapper builtin",
  },
  {
    command: 'env GIT_DIR=x git -C d merge feat',
    source: "this slice: an env assignment in front of git's own -C option",
  },
  {
    command: 'sudo env git merge feat',
    source: 'this slice: two wrappers stacked, so the unwrapping has to repeat',
  },
  {
    command: 'sudo -u me gh pr merge 1',
    source: 'this slice: a wrapper with a value-taking option in front of gh',
  },
  {
    command: 'git merge feat "unterminated',
    source: 'this slice: the parser cannot read it, so the text fallback decides',
    fallback: true,
  },
];
