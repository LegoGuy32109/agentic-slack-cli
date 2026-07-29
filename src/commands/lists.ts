import { call, callMultipart, findUsers, paginateMultipart } from "../client.ts";
import { jsonInput, wireParams } from "../operations.ts";

type Column = { id: string; name: string; key?: string; type: string; options?: { choices?: Array<{ value: string; label: string }> } };
type RecordField = { column_id: string; key?: string; text?: string; value?: unknown; rich_text?: unknown[]; number?: number[]; date?: string[]; user?: string[]; select?: string[]; checkbox?: boolean };
type ListRecord = { id: string; position?: string; view_positions?: Record<string, string>; fields?: RecordField[] };

export function listId(reference: string): string | undefined {
  const match = reference.match(/^https:\/\/[^/]+\.slack\.com\/lists\/[A-Z0-9]+\/([A-Z][A-Z0-9]+)\/?$/i);
  const id = match?.[1] || reference;
  return /^F[A-Z0-9]+$/i.test(id) ? id : undefined;
}

function comparePosition(left = "", right = "") {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  if (leftWhole.length !== rightWhole.length) return leftWhole.length - rightWhole.length;
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;
  return compareRank(leftFraction, rightFraction);
}

// Slack's fractional positions follow ASCII-like base-62 order: digits,
// uppercase letters, then lowercase letters. The table UI is authoritative.
const rankAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function rankIndex(char: string) {
  const index = rankAlphabet.indexOf(char);
  if (index < 0) throw new Error(`Unsupported Slack position character: ${char}`);
  return index;
}

function compareRank(left: string, right: string) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftValue = index < left.length ? rankIndex(left[index]!) : -1;
    const rightValue = index < right.length ? rankIndex(right[index]!) : -1;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function rankAfter(rank: string) {
  if (!rank) return rankAlphabet[Math.floor(rankAlphabet.length / 2)]!;
  const last = rankIndex(rank.at(-1)!);
  return last < rankAlphabet.length - 1 ? `${rank.slice(0, -1)}${rankAlphabet[last + 1]}` : `${rank}${rankAlphabet[Math.floor(rankAlphabet.length / 2)]}`;
}

function rankBetween(lower: string, upper: string) {
  if (compareRank(lower, upper) >= 0) throw new Error("Cannot calculate a position between unordered rows.");
  let prefix = "";
  for (let index = 0; index < Math.max(lower.length, upper.length) + 1; index++) {
    const lowerValue = index < lower.length ? rankIndex(lower[index]!) : -1;
    const upperValue = index < upper.length ? rankIndex(upper[index]!) : rankAlphabet.length;
    if (upperValue - lowerValue > 1) return `${prefix}${rankAlphabet[Math.floor((lowerValue + upperValue) / 2)]}`;
    if (index < lower.length) { prefix += lower[index]!; continue; }
    // There is no shorter rank between a prefix and that prefix plus the
    // alphabet's lowest character. Slack must rebalance that rare boundary.
    throw new Error("Slack positions are too dense to insert safely; reorder the row in Slack once and retry.");
  }
  throw new Error("Could not calculate a Slack table position.");
}

function positionAfter(left: string, right: string | undefined) {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  if (!right) {
    return leftFraction ? `${leftWhole}.${rankAfter(leftFraction)}` : (BigInt(leftWhole) + 1n).toString();
  }
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  if (leftWhole === rightWhole) return `${leftWhole}.${rankBetween(leftFraction, rightFraction)}`;
  const lower = BigInt(leftWhole);
  const upper = BigInt(rightWhole);
  if (upper <= lower) throw new Error("Cannot calculate a position after an unordered row.");
  if (upper - lower > 1n) return ((lower + upper) / 2n).toString();
  return `${leftWhole}.${rankAfter(leftFraction)}`;
}

function rowPosition(record: ListRecord, viewId: string | undefined) {
  return viewId ? record.view_positions?.[viewId] || record.position || "" : record.position || "";
}

function textPayload(text: string) {
  return [{ type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }] }];
}

function preview(method: string, params: Record<string, unknown>, list: unknown) {
  return { ok: true, dry_run: true, method, list, params, wire_params: wireParams(params) };
}

async function availableLists() {
  const lists: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await call("files.list", { types: "lists", count: 100, page });
    lists.push(...(result.files || []).filter((file: any) => file.filetype === "list"));
    if (page >= (result.paging?.pages || 1)) break;
  }
  return lists;
}

function resolveListCandidate(reference: string, lists: Array<{ id: string; title?: string }>) {
  const direct = listId(reference);
  if (direct) return { id: direct, title: undefined };
  const matches = lists.filter(list => list.title?.toLowerCase() === reference.toLowerCase());
  if (matches.length !== 1) throw new Error(matches.length ? `List "${reference}" is ambiguous: ${matches.map(list => `${list.title} (${list.id})`).join(", ")}.` : `Could not find a List named "${reference}".`);
  return { id: matches[0]!.id as string, title: matches[0]!.title as string };
}

async function resolveList(reference: string) {
  return resolveListCandidate(reference, await availableLists());
}

function resolveColumn(columns: Column[], reference: string) {
  const matches = columns.filter(column => [column.id, column.name, column.key].some(value => value?.toLowerCase() === reference.toLowerCase()));
  if (matches.length !== 1) throw new Error(matches.length ? `Column "${reference}" is ambiguous.` : `Could not find a column named "${reference}".`);
  return matches[0]!;
}

function fieldValue(field: RecordField | undefined, column: Column): string {
  if (!field) return "";
  if (field.text !== undefined) return field.text;
  if (field.date) return field.date.join(", ");
  if (field.number) return field.number.join(", ");
  if (field.user) return field.user.join(", ");
  if (field.select) {
    return field.select.map(value => column.options?.choices?.find(choice => choice.value === value)?.label || value).join(", ");
  }
  if (field.checkbox !== undefined) return String(field.checkbox);
  return field.value === undefined || field.value === null ? "" : String(field.value);
}

function normalizeRecord(record: ListRecord, columns: Column[], viewId?: string) {
  const fields = new Map((record.fields || []).map(field => [field.column_id, field]));
  return {
    id: record.id,
    position: rowPosition(record, viewId),
    values: Object.fromEntries(columns.map(column => [column.name, {
      columnId: column.id, key: column.key, type: column.type, value: fieldValue(fields.get(column.id), column), raw: fields.get(column.id),
    }])),
  };
}

async function readList(reference: string) {
  const list = await resolveList(reference);
  const info = await call("files.info", { file: list.id });
  const columns = (info.file?.list_metadata?.schema || []) as Column[];
  const tableView = info.file?.list_metadata?.views?.find((view: any) => view.type === "table" && view.default_view_key === "all_items") || info.file?.list_metadata?.views?.find((view: any) => view.type === "table");
  const records = await paginateMultipart("lists.records.list", { list_id: list.id, include_subtasks: true, archived: false, include_suggested: false }, "records") as ListRecord[];
  const ordered = records.sort((left, right) => comparePosition(rowPosition(left, tableView?.id), rowPosition(right, tableView?.id)));
  return { list: { id: list.id, title: info.file?.title || list.title, access: info.file?.access, permalink: info.file?.permalink }, columns, records: ordered, tableView };
}

function parseWhere(value: string | undefined) {
  const index = value?.indexOf("=") ?? -1;
  if (index <= 0) throw new Error("--where must use Column=Value (for example, Environment=QA-7).");
  return { column: value!.slice(0, index).trim(), value: value!.slice(index + 1).trim() };
}

function selectRecords(records: ListRecord[], columns: Column[], whereText: string | undefined) {
  const where = parseWhere(whereText);
  const column = resolveColumn(columns, where.column);
  const matches = records.filter(record => fieldValue(record.fields?.find(field => field.column_id === column.id), column).toLowerCase() === where.value.toLowerCase());
  return { where, column, matches };
}

async function typedCell(column: Column, rowId: string, value: string | undefined, clear: boolean) {
  if (clear) {
    if (["text", "rich_text"].includes(column.type)) return { row_id: rowId, column_id: column.id, rich_text: [] };
    if (column.type === "number") return { row_id: rowId, column_id: column.id, number: [] };
    if (column.type === "date") return { row_id: rowId, column_id: column.id, date: [] };
    if (column.type === "user") return { row_id: rowId, column_id: column.id, user: [] };
    if (column.type === "select") return { row_id: rowId, column_id: column.id, select: [] };
    if (column.type === "checkbox") return { row_id: rowId, column_id: column.id, checkbox: false };
    throw new Error(`${column.name} (${column.type}) needs --cells because this type is not yet supported by --clear.`);
  }
  if (value === undefined) throw new Error("Provide --value or --clear.");
  if (["text", "rich_text"].includes(column.type)) return { row_id: rowId, column_id: column.id, rich_text: textPayload(value) };
  if (column.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`"${value}" is not a valid number.`);
    return { row_id: rowId, column_id: column.id, number: [number] };
  }
  if (column.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Dates must use YYYY-MM-DD.");
    return { row_id: rowId, column_id: column.id, date: [value] };
  }
  if (column.type === "user") {
    const matches = /^[UW][A-Z0-9]+$/i.test(value) ? [{ id: value }] : await findUsers(value);
    if (matches.length !== 1) throw new Error(matches.length ? `User "${value}" is ambiguous: ${matches.map(user => user.id).join(", ")}.` : `Could not find a user matching "${value}".`);
    return { row_id: rowId, column_id: column.id, user: [matches[0]!.id] };
  }
  if (column.type === "select") {
    const choice = column.options?.choices?.find(option => option.value.toLowerCase() === value.toLowerCase() || option.label.toLowerCase() === value.toLowerCase());
    if (!choice) throw new Error(`"${value}" is not an option for ${column.name}.`);
    return { row_id: rowId, column_id: column.id, select: [choice.value] };
  }
  if (column.type === "checkbox") {
    if (!["true", "false"].includes(value.toLowerCase())) throw new Error("Checkbox values must be true or false.");
    return { row_id: rowId, column_id: column.id, checkbox: value.toLowerCase() === "true" };
  }
  throw new Error(`${column.name} (${column.type}) needs --cells because this type is not yet supported by --value.`);
}

function cellMatches(field: RecordField | undefined, cell: any) {
  const keys = Object.keys(cell).filter(key => !["row_id", "column_id"].includes(key));
  if (!keys.length) return false;
  if (!field) return keys.some(key => Array.isArray(cell[key]) && cell[key].length === 0);
  return keys.every(key => {
    if (key === "rich_text") {
      const expected = cell.rich_text[0]?.elements?.[0]?.elements?.[0]?.text || "";
      return expected ? field.text === expected : !field.text;
    }
    if (["number", "date", "user", "select"].includes(key)) return JSON.stringify((field as any)[key] || []) === JSON.stringify(cell[key]);
    return JSON.stringify((field as any)[key]) === JSON.stringify(cell[key]);
  });
}

async function verifyCell(reference: string, rowId: string, cell: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readList(reference);
    const row = state.records.find(record => record.id === rowId);
    const field = row?.fields?.find(candidate => candidate.column_id === cell.column_id);
    if (cellMatches(field, cell)) return { verified: true, observed: normalizeRecord(row!, state.columns, state.tableView?.id).values };
    if (attempt < 2) await Bun.sleep(250);
  }
  throw new Error(`Slack did not confirm the requested update for row ${rowId} after readback.`);
}

async function verifyCells(reference: string, cells: any[]) {
  const invalid = cells.find(cell => !cell || typeof cell.row_id !== "string" || typeof cell.column_id !== "string");
  if (invalid) throw new Error("Every --cells entry must include string row_id and column_id values for readback verification.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readList(reference);
    const failures = cells.filter(cell => {
      const row = state.records.find(record => record.id === cell.row_id);
      return !cellMatches(row?.fields?.find(field => field.column_id === cell.column_id), cell);
    });
    if (!failures.length) return { verified: true, verifiedCells: cells.map(cell => ({ rowId: cell.row_id, columnId: cell.column_id })) };
    if (attempt < 2) await Bun.sleep(250);
  }
  throw new Error("Slack did not confirm every raw cell update after readback.");
}

async function verifyMove(reference: string, rowId: string, afterId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readList(reference);
    const afterIndex = state.records.findIndex(record => record.id === afterId);
    if (afterIndex >= 0 && state.records[afterIndex + 1]?.id === rowId) return { verified: true, order: state.records.map(record => record.id) };
    if (attempt < 2) await Bun.sleep(250);
  }
  throw new Error(`Slack did not confirm row ${rowId} immediately follows ${afterId} after readback.`);
}

export async function lists(action: string, reference: string | undefined, opts: { allowWrite: boolean; cells?: string; where?: string; after?: string; column?: string; value?: string; clear: boolean }) {
  if (action === "list") return { ok: true, lists: (await availableLists()).map(list => ({ id: list.id, title: list.title, access: list.access, permalink: list.permalink })) };
  if (!reference) throw new Error("A List URL, ID, or exact title is required.");
  const state = await readList(reference);
  if (action === "schema") return { ok: true, list: state.list, columns: state.columns };
  if (action === "rows") {
    if (!opts.where) return { ok: true, list: state.list, columns: state.columns, rows: state.records.map(record => normalizeRecord(record, state.columns, state.tableView?.id)) };
    const selected = selectRecords(state.records, state.columns, opts.where);
    return { ok: true, list: state.list, where: selected.where, rows: selected.matches.map(record => normalizeRecord(record, state.columns, state.tableView?.id)) };
  }
  if (action === "move") {
    if (!opts.where || !opts.after) throw new Error("Usage: slack-cli lists move <list> --where Column=Value --after Column=Value [--allow-write]");
    if (!state.tableView?.id) throw new Error("This List has no table view to reorder.");
    const source = selectRecords(state.records, state.columns, opts.where);
    const anchor = selectRecords(state.records, state.columns, opts.after);
    if (source.matches.length !== 1 || anchor.matches.length !== 1) return { ok: false, error: source.matches.length !== 1 ? "Source row match is ambiguous or missing." : "After-row match is ambiguous or missing.", source: source.matches.map(record => normalizeRecord(record, state.columns, state.tableView?.id)), after: anchor.matches.map(record => normalizeRecord(record, state.columns, state.tableView?.id)) };
    const sourceRow = source.matches[0]!;
    const anchorRow = anchor.matches[0]!;
    if (sourceRow.id === anchorRow.id) throw new Error("A row cannot be moved after itself.");
    const withoutSource = state.records.filter(record => record.id !== sourceRow.id);
    const anchorIndex = withoutSource.findIndex(record => record.id === anchorRow.id);
    const next = withoutSource[anchorIndex + 1];
    if (state.records.findIndex(record => record.id === anchorRow.id) + 1 === state.records.findIndex(record => record.id === sourceRow.id)) return { ok: true, moved: false, verified: true, rowId: sourceRow.id, afterId: anchorRow.id };
    const position = positionAfter(rowPosition(anchorRow, state.tableView.id), next ? rowPosition(next, state.tableView.id) : undefined);
    const params = { list_id: state.list.id, id: sourceRow.id, view_id: state.tableView.id, position };
    if (!opts.allowWrite) return preview("lists.records.reorder", params, { ...state.list, rowId: sourceRow.id, afterId: anchorRow.id, view: state.tableView.name });
    const result = await callMultipart("lists.records.reorder", params);
    return { ...result, rowId: sourceRow.id, afterId: anchorRow.id, ...(await verifyMove(reference, sourceRow.id, anchorRow.id)) };
  }
  if (action !== "update") throw new Error("Usage: slack-cli lists list|schema|rows|move|update ...");
  if (opts.cells) {
    const input = await jsonInput(opts.cells, "--cells");
    if (!Array.isArray(input.cells)) throw new Error("--cells must be a JSON object with a cells array.");
    const params = { list_id: state.list.id, cells: input.cells };
    if (!opts.allowWrite) return preview("lists.cells.update", params, state.list);
    const result = await callMultipart("lists.cells.update", params);
    return { ...result, ...(await verifyCells(reference, input.cells)) };
  }
  if (!opts.where || !opts.column || (opts.value === undefined && !opts.clear) || (opts.value !== undefined && opts.clear)) throw new Error("Usage: slack-cli lists update <list> --where Column=Value --column Column --value Value [--allow-write]");
  const selected = selectRecords(state.records, state.columns, opts.where);
  if (selected.matches.length !== 1) return { ok: false, error: selected.matches.length ? "Row match is ambiguous." : "No matching row.", where: selected.where, matches: selected.matches.map(record => normalizeRecord(record, state.columns, state.tableView?.id)) };
  const column = resolveColumn(state.columns, opts.column);
  const cell = await typedCell(column, selected.matches[0]!.id, opts.value, opts.clear);
  const params = { list_id: state.list.id, cells: [cell] };
  if (!opts.allowWrite) return preview("lists.cells.update", params, { ...state.list, rowId: selected.matches[0]!.id, column: column.name });
  const result = await callMultipart("lists.cells.update", params);
  return { ...result, rowId: selected.matches[0]!.id, column: column.name, ...(await verifyCell(reference, selected.matches[0]!.id, cell)) };
}

export const listInternals = { listId, comparePosition, positionAfter, fieldValue, parseWhere, cellMatches, resolveListCandidate, selectRecords, typedCell };
