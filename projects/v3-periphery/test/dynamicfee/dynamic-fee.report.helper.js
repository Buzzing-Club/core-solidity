const fs = require("fs");
const path = require("path");

function ensureReportsDir() {
  const reportsDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

function writeScenarioReport({ filePrefix, title, params, rows }) {
  const reportsDir = ensureReportsDir();
  const csvPath = path.join(reportsDir, `${filePrefix}.csv`);
  const mdPath = path.join(reportsDir, `${filePrefix}.md`);
  const jsonPath = path.join(reportsDir, `${filePrefix}.json`);

  const headers = [
    "idx",
    "txHash",
    "blockNumber",
    "timestamp",
    "dtSeconds",
    "tradeSizeU",
    "currentTick",
    "ticksCrossed",
    "referenceTick",
    "referenceVolatility",
    "accumulator",
    "baseFeeUSDB",
    "variableFeeUSDB",
    "dynamicFeeUSDB",
    "dynamicFeeBps",
    "totalFeeUSDB",
    "totalFeeBps",
  ];

  const csvLines = [headers.join(",")];
  for (const r of rows) {
    csvLines.push(headers.map((h) => r[h]).join(","));
  }
  fs.writeFileSync(csvPath, `${csvLines.join("\n")}\n`, "utf8");

  const md = [];
  md.push(`# ${title}`);
  md.push("");
  md.push("## Parameters");
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(params, null, 2));
  md.push("```");
  md.push("");
  md.push("## Per-Trade Details");
  md.push("");
  md.push(`Total rows: ${rows.length}`);
  md.push("");
  md.push(`| ${headers.join(" | ")} |`);
  md.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    md.push(`| ${headers.map((h) => r[h]).join(" | ")} |`);
  }
  md.push("");
  fs.writeFileSync(mdPath, `${md.join("\n")}\n`, "utf8");

  fs.writeFileSync(jsonPath, JSON.stringify({ title, params, rows }, null, 2), "utf8");

  return { csvPath, mdPath, jsonPath };
}

module.exports = {
  writeScenarioReport,
};

