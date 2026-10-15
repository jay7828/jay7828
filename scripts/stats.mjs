// Draws the README stats card from GitHub's GraphQL API, private contributions included
// (the shared github-readme-stats server only sees public commits). Writes dist/stats-{dark,light}.svg.
import { mkdirSync, writeFileSync } from "node:fs";

const user = process.env.GH_USER || "jay7828";
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set");

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const { user: u } = await gql(
  `query($login: String!) {
    user(login: $login) {
      name
      contributionsCollection {
        contributionYears
        restrictedContributionsCount
        totalCommitContributions
        totalPullRequestContributions
        contributionCalendar { totalContributions }
      }
      repositories(ownerAffiliations: OWNER, first: 100, isFork: false) { nodes { stargazerCount } }
    }
  }`,
  { login: user },
);
const c = u.contributionsCollection;

// All-time total and streaks: one calendar per year since the account's first contribution, day by day.
let allTime = 0;
const days = new Map();
for (const year of c.contributionYears) {
  const { user: y } = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) { contributionsCollection(from: $from, to: $to) { contributionCalendar {
        totalContributions weeks { contributionDays { date contributionCount } }
      } } }
    }`,
    { login: user, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
  );
  const cal = y.contributionsCollection.contributionCalendar;
  allTime += cal.totalContributions;
  for (const w of cal.weeks) for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
}
const today = new Date().toISOString().slice(0, 10);
const dates = [...days.keys()].filter((d) => d <= today).sort();
let longest = { len: 0, start: "", end: "" };
let run = { len: 0, start: "" };
for (const d of dates) {
  if (days.get(d) > 0) {
    run = run.len ? { len: run.len + 1, start: run.start } : { len: 1, start: d };
    if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d };
  } else run = { len: 0, start: "" };
}
// The current streak survives a quiet today: count back from yesterday when today is still zero.
let i = dates.length - 1;
if (i >= 0 && days.get(dates[i]) === 0) i--;
let current = { len: 0, start: "", end: dates[i] || today };
for (; i >= 0 && days.get(dates[i]) > 0; i--) current = { len: current.len + 1, start: dates[i], end: current.end };

const stats = {
  year: c.contributionCalendar.totalContributions,
  private: c.restrictedContributionsCount,
  commits: c.totalCommitContributions,
  prs: c.totalPullRequestContributions,
  stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
  allTime,
  current,
  longest,
};
console.log(stats);

const fmt = (n) => n.toLocaleString("en-US");
const rows = [
  ["Past year", stats.year],
  ["In private repos", stats.private],
  ["Public commits", stats.commits],
  ["Pull requests", stats.prs],
  ["Stars earned", stats.stars],
];

// Dates outside the current year carry their year ("Dec 1 - Dec 24, 2025").
const thisYear = today.slice(0, 4);
const short = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const withYear = (d) => (d.slice(0, 4) === thisYear ? short(d) : `${short(d)}, ${d.slice(0, 4)}`);
const range = (a, b) => (a ? (a === b ? withYear(a) : `${a.slice(0, 4) === b.slice(0, 4) ? short(a) : withYear(a)} - ${withYear(b)}`) : "start one today");

// One row: current streak (ring), longest streak, all-time total, then the past-year breakdown.
function card({ text, muted, line, ringBg }) {
  const rowSvg = rows
    .map(([label, value], i) => {
      const y = 62 + i * 24;
      return `<g class="row" style="animation-delay:${700 + i * 100}ms">
    <circle cx="616" cy="${y - 4}" r="3" fill="#ff5a2e"/>
    <text x="628" y="${y}" class="label">${label}</text>
    <text x="835" y="${y}" class="value" text-anchor="end">${fmt(value)}</text>
  </g>`;
    })
    .join("\n  ");
  const r = 42, circ = 2 * Math.PI * r;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="200" viewBox="0 0 860 200" role="img" aria-label="Current streak ${stats.current.len} days, longest ${stats.longest.len} days, ${fmt(stats.allTime)} contributions since ${Math.min(...c.contributionYears)}, ${fmt(stats.year)} in the past year with ${fmt(stats.private)} in private repos">
  <style>
    text { font-family: "Segoe UI", Ubuntu, -apple-system, BlinkMacSystemFont, sans-serif; }
    .label { font-size: 14px; fill: ${muted}; }
    .value { font-size: 14px; font-weight: 600; fill: ${text}; }
    .num { font-size: 34px; font-weight: 700; fill: ${text}; }
    .accent { fill: #ff5a2e; }
    .cap { font-size: 14px; font-weight: 600; fill: ${text}; }
    .small { font-size: 12px; fill: ${muted}; }
    .ring { stroke-dasharray: ${circ.toFixed(1)}; stroke-dashoffset: ${circ.toFixed(1)}; animation: draw 1.2s .2s ease-out forwards; }
    .row, .side { opacity: 0; animation: fadein .6s ease-out forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .ring { animation: none; stroke-dashoffset: 0; } .row, .side { animation: none; opacity: 1; } }
  </style>
  <g transform="translate(95 82)">
    <circle r="${r}" fill="none" stroke="${ringBg}" stroke-width="5"/>
    <circle r="${r}" fill="none" stroke="#ff5a2e" stroke-width="5" stroke-linecap="round" transform="rotate(-90)" class="ring"/>
    <text y="12" class="num accent" text-anchor="middle">${stats.current.len}</text>
  </g>
  <g class="side" style="animation-delay:300ms">
    <text x="95" y="155" class="cap accent" text-anchor="middle">Current streak</text>
    <text x="95" y="176" class="small" text-anchor="middle">${range(stats.current.start, stats.current.end)}</text>
  </g>
  <line x1="195" y1="40" x2="195" y2="170" stroke="${line}"/>
  <g class="side" style="animation-delay:450ms">
    <text x="290" y="96" class="num" text-anchor="middle">${stats.longest.len}</text>
    <text x="290" y="155" class="cap" text-anchor="middle">Longest streak</text>
    <text x="290" y="176" class="small" text-anchor="middle">${range(stats.longest.start, stats.longest.end)}</text>
  </g>
  <line x1="385" y1="40" x2="385" y2="170" stroke="${line}"/>
  <g class="side" style="animation-delay:600ms">
    <text x="490" y="96" class="num accent" text-anchor="middle">${fmt(stats.allTime)}</text>
    <text x="490" y="155" class="cap" text-anchor="middle">Contributions</text>
    <text x="490" y="176" class="small" text-anchor="middle">since ${Math.min(...c.contributionYears)}, private included</text>
  </g>
  <line x1="595" y1="40" x2="595" y2="170" stroke="${line}"/>
  ${rowSvg}
</svg>
`;
}

mkdirSync("dist", { recursive: true });
writeFileSync("dist/stats-dark.svg", card({ text: "#e6edf3", muted: "#8b949e", line: "#30363d", ringBg: "#3a1c14" }));
writeFileSync("dist/stats-light.svg", card({ text: "#1f2328", muted: "#59636e", line: "#d0d7de", ringBg: "#fde0d6" }));
