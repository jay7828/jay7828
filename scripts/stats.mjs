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

// All-time total: one calendar per year since the account's first contribution.
let allTime = 0;
for (const year of c.contributionYears) {
  const { user: y } = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) { contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions } } }
    }`,
    { login: user, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
  );
  allTime += y.contributionsCollection.contributionCalendar.totalContributions;
}

const stats = {
  year: c.contributionCalendar.totalContributions,
  private: c.restrictedContributionsCount,
  commits: c.totalCommitContributions,
  prs: c.totalPullRequestContributions,
  stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
  allTime,
};
console.log(stats);

const fmt = (n) => n.toLocaleString("en-US");
const rows = [
  ["Contributions, past year", stats.year],
  ["In private repos", stats.private],
  ["Public commits", stats.commits],
  ["Pull requests", stats.prs],
  ["Stars earned", stats.stars],
];

function card({ text, muted, line }) {
  const rowSvg = rows
    .map(([label, value], i) => {
      const y = 70 + i * 25;
      return `<g class="row" style="animation-delay:${150 + i * 120}ms">
    <circle cx="31" cy="${y - 4}" r="3" fill="#ff5a2e"/>
    <text x="44" y="${y}" class="label">${label}</text>
    <text x="280" y="${y}" class="value" text-anchor="end">${fmt(value)}</text>
  </g>`;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="200" viewBox="0 0 495 200" role="img" aria-label="${fmt(stats.year)} contributions in the past year, ${fmt(stats.private)} of them in private repos">
  <style>
    text { font-family: "Segoe UI", Ubuntu, -apple-system, BlinkMacSystemFont, sans-serif; }
    .title { font-size: 18px; font-weight: 600; fill: #ff5a2e; }
    .label { font-size: 14px; fill: ${muted}; }
    .value { font-size: 14px; font-weight: 600; fill: ${text}; }
    .big { font-size: 44px; font-weight: 700; fill: #ff5a2e; }
    .small { font-size: 13px; fill: ${muted}; }
    .row, .side { opacity: 0; animation: fadein .6s ease-out forwards; }
    @keyframes fadein { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .row, .side { animation: none; opacity: 1; } }
  </style>
  <text x="25" y="35" class="title">${u.name || user}'s GitHub activity</text>
  ${rowSvg}
  <line x1="300" y1="58" x2="300" y2="172" stroke="${line}"/>
  <g class="side" style="animation-delay:800ms">
    <text x="397" y="112" class="big" text-anchor="middle">${fmt(stats.allTime)}</text>
    <text x="397" y="138" class="small" text-anchor="middle">contributions since ${Math.min(...c.contributionYears)}</text>
    <text x="397" y="157" class="small" text-anchor="middle">private work included</text>
  </g>
</svg>
`;
}

mkdirSync("dist", { recursive: true });
writeFileSync("dist/stats-dark.svg", card({ text: "#e6edf3", muted: "#8b949e", line: "#30363d" }));
writeFileSync("dist/stats-light.svg", card({ text: "#1f2328", muted: "#59636e", line: "#d0d7de" }));
